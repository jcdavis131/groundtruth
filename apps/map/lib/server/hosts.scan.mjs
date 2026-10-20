// Which hosts does the app's own code name? One scanner, two readers: lib/server/hosts.test.ts (vitest, in map-ci)
// and scripts/hosts-check.mjs (plain Node, in guard.yml), so the check has a single code path.
//
// The rule it serves is AGENTS.md's "Public, keyless sources only. No paid APIs". The check is a tripwire on a
// decision, not a proof of keylessness: every http(s) or ws(s) host written in non-test source under SCAN_DIRS
// must have an entry in hosts.allow.json that says what the host is (request, link or identifier) and, for a host
// the app requests, who publishes it and whether it needs a key. A new host fails until someone writes that entry.
//
// What it sees: a host spelled out in a string, template or JSX text. Comment lines (a line that starts with //,
// /* or *) and trailing // comments are skipped, so a documentation URL in a comment needs no entry; a comment
// whose lines do not start with * is still scanned, which costs an extra entry and never hides a host.
// What it cannot see: a host assembled at run time (https://${host}/ is reported as dynamic and must be named
// in the allowlist's `dynamic` list), a host an upstream returns in its reply (a STAC asset href), a key sent in a
// header, and whether a `link` host is also fetched. `keyless: true` is a reviewed claim; the only machine check
// on it is that a URL literal carrying ?key=, apikey=, token= and the like is not on a host marked keyless.
//
// Scanned: non-test .ts .tsx .mts .js .mjs .cjs .py under lib, app, components, scripts, dataops and ml in apps/map.
// Not scanned: the repo-root data/ pipeline and eval/ (their own items own those), public/ and vendored code.
//
// Plain JS on purpose: no install, no TypeScript, so guard.yml can run it with setup-node alone.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {{ file: string, line: number }} At
 * @typedef {{ hosts: Map<string, At[]>, dynamic: At[], keyed: Array<At & { host: string }>, files: number }} Scan
 * @typedef {{
 *   unlisted: Array<{ host: string, at: At[] }>, stale: string[], invalid: Array<{ host: string, why: string }>,
 *   keyed: Array<At & { host: string }>, dynamic: At[], badDynamic: unknown[]
 * }} Problems
 */

/** Directories under apps/map whose non-test source is scanned. */
export const SCAN_DIRS = ["lib", "app", "components", "scripts", "dataops", "ml"];

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/;
const SKIP_FILE = /\.test\.[cm]?[jt]sx?$|\.d\.ts$|(?:^|\/)test_[^/]*\.py$|_test\.py$/;
const SKIP_DIR = new Set(["node_modules", "__fixtures__", ".next", ".tmp-mcp", ".tmp-turb"]);
const HOST_RE = /\b(?:https?|wss?):\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)/g;
const DYNAMIC_RE = /\b(?:https?|wss?):\/\/\$\{/;
const KEY_PARAM_RE = /[?&](?:key|apikey|api_key|api-key|token|access_token|appid|app_id|client_secret)=/i;

/** The kinds an allowlist entry can have. */
export const KINDS = ["request", "link", "identifier"];

/**
 * The part of a source line that is code: whole-line comments are empty, a trailing comment is cut. `py` for Python (# comments).
 * @param {string} line
 * @param {boolean} [py]
 * @returns {string}
 */
export function codeOnly(line, py = false) {
  const t = line.trimStart();
  if (py) {
    if (t.startsWith("#")) return "";
  } else if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) return "";
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || (c === "`" && !py)) quote = c;
    else if (py ? c === "#" && (i === 0 || /\s/.test(line[i - 1])) : c === "/" && line[i + 1] === "/" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line;
}

function* walk(dir, base) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) yield* walk(full, base);
    } else if (SOURCE_FILE.test(e.name) && !SKIP_FILE.test(e.name)) {
      yield { full, rel: path.relative(base, full).split(path.sep).join("/") };
    }
  }
}

/**
 * Scan `root` (the apps/map directory). Returns
 *   hosts   Map host(lower case) -> [{ file, line }]
 *   dynamic [{ file, line }]   an https://${...} whose host is built at run time
 *   keyed   [{ host, file, line }]   a URL literal that carries a key-like query parameter
 *   files   number of files read
 * @param {string} root
 * @param {string[]} [dirs]
 * @returns {Scan}
 */
export function scanHosts(root, dirs = SCAN_DIRS) {
  const hosts = new Map();
  const dynamic = [];
  const keyed = [];
  let files = 0;
  for (const d of dirs) {
    for (const f of walk(path.join(root, d), root)) {
      files++;
      const py = f.rel.endsWith(".py");
      const lines = readFileSync(f.full, "utf8").split("\n");
      lines.forEach((raw, i) => {
        const code = codeOnly(raw, py);
        if (!code) return;
        if (DYNAMIC_RE.test(code)) dynamic.push({ file: f.rel, line: i + 1 });
        for (const m of code.matchAll(HOST_RE)) {
          const host = m[1].toLowerCase().replace(/\.$/, "");
          if (!hosts.has(host)) hosts.set(host, []);
          hosts.get(host).push({ file: f.rel, line: i + 1 });
          // a key-like parameter within this URL literal (up to the next quote or space)
          const rest = code.slice(m.index);
          const lit = rest.split(/["'`\s]/)[0];
          if (KEY_PARAM_RE.test(lit)) keyed.push({ host, file: f.rel, line: i + 1 });
        }
      });
    }
  }
  return { hosts, dynamic, keyed, files };
}

/**
 * The ids of the optional, user-entered keys the app knows (lib/store/settings.ts API_KEYS).
 * @param {string} root
 * @returns {Set<string>}
 */
export function settingsKeyIds(root) {
  const text = readFileSync(path.join(root, "lib/store/settings.ts"), "utf8");
  const block = text.slice(text.indexOf("export const API_KEYS"));
  const end = block.indexOf("\n];");
  return new Set([...block.slice(0, end === -1 ? undefined : end).matchAll(/\bid:\s*"([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]));
}

const isText = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Compare a scan with the allowlist. Every list in the result must be empty for the check to pass.
 *   unlisted  a host the code names that has no entry
 *   stale     an entry no scanned file names any more (an allowlist that only grows hides a re-added host)
 *   invalid   an entry that is not well formed, with why
 *   keyed     a host marked keyless that appears in a URL literal with a key-like parameter
 *   dynamic   an https://${...} not named in allow.dynamic
 *   badDynamic  an allow.dynamic entry that is not well formed or no longer matches a line
 */
/**
 * @param {Scan} scan
 * @param {any} allow
 * @param {{ keyIds?: Set<string> | null }} [opts]
 * @returns {Problems}
 */
export function checkAllowlist(scan, allow, opts = {}) {
  const entries = allow && typeof allow.hosts === "object" && allow.hosts !== null ? allow.hosts : {};
  const keyIds = opts.keyIds ?? null;
  /** @type {Problems} */
  const res = { unlisted: [], stale: [], invalid: [], keyed: [], dynamic: [], badDynamic: [] };
  for (const host of [...scan.hosts.keys()].sort()) {
    if (!Object.prototype.hasOwnProperty.call(entries, host)) res.unlisted.push({ host, at: scan.hosts.get(host).slice(0, 3) });
  }
  for (const [host, e] of Object.entries(entries)) {
    if (!scan.hosts.has(host)) {
      res.stale.push(host);
      continue;
    }
    const bad = (why) => res.invalid.push({ host, why });
    if (host !== host.toLowerCase()) bad("host must be lower case");
    if (typeof e !== "object" || e === null) {
      bad("entry must be an object");
      continue;
    }
    if (!KINDS.includes(e.kind)) {
      bad(`kind must be one of ${KINDS.join(", ")}`);
      continue;
    }
    if (e.kind === "request") {
      if (!isText(e.publisher)) bad("a request host needs a publisher");
      if (typeof e.keyless !== "boolean") bad("a request host needs keyless: true or false");
      if (e.keyless === false) {
        const ids = Array.isArray(e.keyIds) ? e.keyIds : [];
        if (ids.length === 0) bad("keyless: false needs keyIds (ids from lib/store/settings.ts API_KEYS)");
        if (keyIds) for (const id of ids) if (!keyIds.has(id)) bad(`keyId ${id} is not in settings.ts API_KEYS`);
        if (e.optional !== true) bad("keyless: false is allowed only for an optional, user-entered key (optional: true)");
        if (!isText(e.note)) bad("keyless: false needs a note saying what the key unlocks and what the app does without it");
      } else if (e.keyless === true && (e.keyIds !== undefined || e.optional !== undefined)) {
        bad("keyless: true takes no keyIds or optional");
      }
    } else if (e.publisher !== undefined && !isText(e.publisher)) bad("publisher must be text when present");
  }
  for (const k of scan.keyed) {
    const e = entries[k.host];
    if (e && e.kind === "request" && e.keyless === true && !isText(e.keyParamNote)) res.keyed.push(k);
  }
  const declared = Array.isArray(allow?.dynamic) ? allow.dynamic : [];
  for (const d of declared) {
    if (!d || !isText(d.file) || !isText(d.why)) res.badDynamic.push(d);
    else if (!scan.dynamic.some((s) => s.file === d.file)) res.badDynamic.push(d);
  }
  for (const s of scan.dynamic) {
    if (!declared.some((d) => d && d.file === s.file)) res.dynamic.push(s);
  }
  return res;
}

/**
 * One line per problem, for the script and for a test's failure message.
 * @param {Problems} res
 * @returns {string[]}
 */
export function describeProblems(res) {
  const out = [];
  for (const u of res.unlisted) out.push(`unlisted  ${u.host}  (${u.at.map((a) => `${a.file}:${a.line}`).join(", ")})`);
  for (const h of res.stale) out.push(`stale     ${h}  (no scanned file names it; remove the entry)`);
  for (const i of res.invalid) out.push(`invalid   ${i.host}  ${i.why}`);
  for (const k of res.keyed) out.push(`keyed     ${k.host} is marked keyless but ${k.file}:${k.line} puts a key-like parameter on it`);
  for (const d of res.dynamic) out.push(`dynamic   ${d.file}:${d.line}  a host built at run time; name the file and why in allow.dynamic`);
  for (const d of res.badDynamic) out.push(`dynamic   allow.dynamic entry ${JSON.stringify(d)} is malformed or matches no line`);
  return out;
}

/**
 * Read an allowlist file.
 * @param {string} file
 * @returns {any}
 */
export function loadAllowlist(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
