// Tests for data/LICENSES.md: one row per publisher, each with the terms URL(s) it was read from, what the publisher's
// own page grants (a quote of under 25 words, or that the page states no licence, or that no terms page was found), and
// what we grant on top (nothing). Plain Node, no install, no network.
//   node data/schema/licenses.test.mjs
// data/schema/validate.test.mjs runs this file, so the data.yml "schema and fixture tests" step does too.
//
// The checker is in this file on purpose: the rule is the table's shape and its coverage of data/manifests, and a
// reader should see both in one place. Nothing here fetches a page. data/licenses.lock.json holds what
// data/pipeline/licenses_fetch.py found when it did (status, bytes, sha256, and whether each quote was on the page);
// these tests hold LICENSES.md to that lock, and the lock's own fetch is by hand, not in CI.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const MANIFESTS = path.join(ROOT, "data", "manifests");
const LICENSES = path.join(ROOT, "data", "LICENSES.md");
const LOCK = path.join(ROOT, "data", "licenses.lock.json");
const HF_README = path.join(ROOT, "data", "hf", "README.md");
const PIPELINE_MD = path.join(ROOT, "data", "PIPELINE.md");
const SERVER_TS = path.join(ROOT, "apps", "map", "lib", "mcp", "server.ts");
const MCP_MD = path.join(ROOT, "apps", "map", "docs", "MCP.md");

/** Cam's open decision (board cam_asks licence-line): the line is written as given, with a plain apostrophe. */
export const COMPILATION_LINE =
  "Compilation licence: not yet chosen (Cam decides; until then the bundle carries no licence of its own and each record stays under its publisher's terms)";
export const LICENSES_URL = "https://github.com/jcdavis131/groundtruth/blob/master/data/LICENSES.md";
const ON_TOP = "nothing beyond their terms";

let passed = 0;
let failed = 0;
const check = (ok, msg, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  licenses: ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
};
/** Runs fn; it returns true, or a string saying what was wrong. A throw is a failure with the message as detail. */
const attempt = (msg, fn) => {
  try {
    const r = fn();
    check(r === true, msg, typeof r === "string" ? r : "");
  } catch (e) {
    check(false, msg, String(e?.message ?? e));
  }
};

// ---------------------------------------------------------------- the checker

const COLUMNS = ["publisher", "collections", "terms url", "what they grant", "what we grant on top", "retrieved"];
const entries = (cell) => cell.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

/** The table's rows, by header name. Returns { rows, problems }. */
export function parseTable(md) {
  const problems = [];
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\|/.test(l) && /publisher/i.test(l) && /terms url/i.test(l));
  if (at < 0) return { rows: [], problems: ["no table with Publisher and Terms URL columns"] };
  const split = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const head = split(lines[at]).map((h) => h.toLowerCase());
  const col = Object.fromEntries(COLUMNS.map((c) => [c, head.indexOf(c)]));
  for (const c of COLUMNS) if (col[c] < 0) problems.push(`the table has no "${c}" column`);
  if (problems.length) return { rows: [], problems };
  const rows = [];
  for (let i = at + 2; i < lines.length && /^\|/.test(lines[i]); i++) {
    const cells = split(lines[i]);
    if (cells.length !== head.length) {
      problems.push(`row ${i - at - 1} has ${cells.length} cells, the header has ${head.length} (a "|" inside a cell?)`);
      continue;
    }
    rows.push({
      publisher: cells[col.publisher],
      collections: [...cells[col.collections].matchAll(/`([^`]+)`/g)].map((m) => m[1]),
      urls: entries(cells[col["terms url"]]),
      grants: entries(cells[col["what they grant"]]),
      onTop: cells[col["what we grant on top"]],
      retrieved: cells[col.retrieved],
    });
  }
  return { rows, problems };
}

/** Everything wrong with a licences table, its lock and the collections it must cover; empty when they agree. */
export function licenseProblems(md, collections, lock) {
  const out = [];
  const { rows, problems } = parseTable(md);
  out.push(...problems.map((p) => `licenses: ${p}`));
  if (!md.includes(COMPILATION_LINE)) out.push(`licenses: the compilation licence line is missing or reworded ("${COMPILATION_LINE.slice(0, 60)}...")`);
  const seen = new Set();
  const byUrl = new Map((lock?.fetches ?? []).map((f) => [f.url, f]));
  for (const r of rows) {
    const who = r.publisher || "(row with no publisher)";
    if (!r.publisher) out.push("licenses: a row has no publisher");
    if (seen.has(r.publisher)) out.push(`licenses: ${who} is listed twice`);
    seen.add(r.publisher);
    if (r.collections.length === 0) out.push(`licenses: ${who} names no collection`);
    if (r.urls.length === 0) out.push(`licenses: ${who} has no terms URL`);
    for (const u of r.urls) {
      if (/^http:\/\//i.test(u)) out.push(`licenses: ${who}: terms URL is not https: ${u}`);
      else if (!/^https:\/\/[^\s<>]+$/.test(u)) out.push(`licenses: ${who}: terms URL is not a plain https URL: ${u}`);
    }
    if (r.grants.length !== r.urls.length) out.push(`licenses: ${who} has ${r.urls.length} terms URL(s) and ${r.grants.length} statement(s) of what they grant; one each, in the same order`);
    if (r.onTop !== ON_TOP) out.push(`licenses: ${who}: what we grant on top must read "${ON_TOP}", not "${r.onTop}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.retrieved)) out.push(`licenses: ${who}: retrieved is not a YYYY-MM-DD day: ${r.retrieved}`);
    r.urls.forEach((u, i) => {
      const g = r.grants[i];
      if (g === undefined) return;
      const f = byUrl.get(u);
      if (!f) out.push(`licenses: ${who}: ${u} has no entry in data/licenses.lock.json`);
      else {
        if (f.status !== 200) out.push(`licenses: ${who}: ${u} was last fetched with status ${f.status}, not 200`);
        if (!/^[0-9a-f]{64}$/.test(f.sha256 ?? "") || !(f.bytes > 0)) out.push(`licenses: ${who}: ${u} has no sha256 and byte count in the lock`);
        if (f.retrievedAt?.slice(0, 10) !== r.retrieved) out.push(`licenses: ${who}: retrieved ${r.retrieved} is not the lock's fetch day ${f.retrievedAt?.slice(0, 10)} for ${u}`);
      }
      const q = /^"([^"]+)"/.exec(g);
      if (q) {
        if (words(q[1]) >= 25) out.push(`licenses: ${who}: the quote for ${u} is ${words(q[1])} words; under 25`);
        if (f && (f.kind !== "quote" || f.quote !== q[1] || f.quoteFound !== true)) out.push(`licenses: ${who}: the quote for ${u} is not the one the lock found on the page`);
      } else if (/^(terms page states no licence|no terms page found)/.test(g)) {
        if (f && (f.kind !== "no-licence" || f.matches !== 0)) out.push(`licenses: ${who}: the lock does not show ${u} free of licence words`);
      } else {
        out.push(`licenses: ${who}: what they grant for ${u} is none of: a quote in double quotes, "terms page states no licence", "no terms page found" (${g.slice(0, 50)})`);
      }
    });
  }
  const named = new Set(rows.flatMap((r) => r.collections));
  for (const c of collections) if (!named.has(c)) out.push(`licenses: collection ${c} has no publisher row`);
  const cited = new Set(rows.flatMap((r) => r.urls));
  for (const f of lock?.fetches ?? []) if (!cited.has(f.url)) out.push(`licenses: ${f.url} is in the lock but in no row`);
  return out;
}

// ---------------------------------------------------------------- fixtures (made-up names; nothing here is fetched)
const HEADER = "| Publisher | Collections | Terms URL | What they grant | What we grant on top | Retrieved |\n|---|---|---|---|---|---|\n";
const Q = "Alpha data may be reused by anyone for any purpose";
const row = (o = {}) => {
  const r = { publisher: "Alpha Agency", collections: "`alpha-things`", urls: "https://example.org/alpha/terms", grants: `"${Q}"`, onTop: ON_TOP, retrieved: "2026-10-21", ...o };
  return `| ${r.publisher} | ${r.collections} | ${r.urls} | ${r.grants} | ${r.onTop} | ${r.retrieved} |\n`;
};
const table = (...rows) => `# Licences\n\n${COMPILATION_LINE}\n\n${HEADER}${rows.join("")}`;
const fetched = (url, o = {}) => ({ url, kind: "quote", status: 200, bytes: 1234, sha256: "a".repeat(64), retrievedAt: "2026-10-21T05:00:00.000Z", quote: Q, quoteFound: true, quoteWords: words(Q), ...o });
const lockOf = (...fs) => ({ schemaVersion: "licenses-lock/1", fetches: fs });
const ALPHA = "https://example.org/alpha/terms";
const BETA = "https://example.org/beta/terms";
const goodLock = () => lockOf(fetched(ALPHA));
const show = (errs) => errs.join("; ") || "no problems";
const has = (errs, re) => errs.some((e) => re.test(e));

// ---------------------------------------------------------------- the rules, one fixture each
attempt("a faithful table (one row per publisher, https terms URLs, a quote or a stated absence for each, nothing granted on top) passes", () => {
  const beta = row({
    publisher: "Beta Bureau",
    collections: "`beta-things`",
    urls: `${BETA}<br>https://example.org/beta/data?f=json`,
    grants: `"${Q}"<br>terms page states no licence`,
  });
  const lock = lockOf(
    fetched(ALPHA),
    fetched(BETA),
    fetched("https://example.org/beta/data?f=json", { kind: "no-licence", matches: 0, textChars: 400, quote: undefined, quoteFound: undefined, quoteWords: undefined }),
  );
  const errs = licenseProblems(table(row(), beta), ["alpha-things", "beta-things"], lock);
  return errs.length === 0 ? true : show(errs);
});
attempt("a manifest collection no row names fails, naming the collection", () => {
  const errs = licenseProblems(table(row()), ["alpha-things", "beta-things"], goodLock());
  return has(errs, /collection beta-things has no publisher row/) ? true : show(errs);
});
attempt("a terms URL that is not https fails, naming the publisher", () => {
  const url = "http://example.org/alpha/terms";
  const errs = licenseProblems(table(row({ urls: url })), ["alpha-things"], lockOf(fetched(url)));
  return has(errs, /Alpha Agency: terms URL is not https/) ? true : show(errs);
});
attempt("a row with no terms URL fails", () => {
  const errs = licenseProblems(table(row({ urls: "" })), ["alpha-things"], goodLock());
  return has(errs, /Alpha Agency has no terms URL/) ? true : show(errs);
});
attempt("a grant that is not a quote, 'terms page states no licence' or 'no terms page found' fails (no licence name is made up)", () => {
  const a = licenseProblems(table(row({ grants: "CC BY 4.0" })), ["alpha-things"], goodLock());
  const b = licenseProblems(table(row({ grants: "public domain" })), ["alpha-things"], goodLock());
  const c = licenseProblems(table(row({ grants: "" })), ["alpha-things"], goodLock());
  return has(a, /none of: a quote/) && has(b, /none of: a quote/) && c.length > 0 ? true : `CC BY: ${show(a)}; public domain: ${show(b)}; empty: ${show(c)}`;
});
attempt("a quote of 25 words or more fails", () => {
  const long = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
  const errs = licenseProblems(table(row({ grants: `"${long}"` })), ["alpha-things"], lockOf(fetched(ALPHA, { quote: long, quoteWords: 25 })));
  const ok24 = licenseProblems(table(row({ grants: `"${long.split(" ").slice(0, 24).join(" ")}"` })), ["alpha-things"], lockOf(fetched(ALPHA, { quote: long.split(" ").slice(0, 24).join(" "), quoteWords: 24 })));
  return has(errs, /25 words; under 25/) && ok24.length === 0 ? true : `25: ${show(errs)}; 24: ${show(ok24)}`;
});
attempt("a row that grants anything on top of the publisher's terms fails", () => {
  const errs = licenseProblems(table(row({ onTop: "CC BY 4.0" })), ["alpha-things"], goodLock());
  return has(errs, /what we grant on top must read "nothing beyond their terms"/) ? true : show(errs);
});
attempt("a quote that is not the one the lock found on the page fails", () => {
  const errs = licenseProblems(table(row()), ["alpha-things"], lockOf(fetched(ALPHA, { quote: "Alpha data may be reused by anyone for some purpose" })));
  const notFound = licenseProblems(table(row()), ["alpha-things"], lockOf(fetched(ALPHA, { quoteFound: false })));
  return has(errs, /not the one the lock found/) && has(notFound, /not the one the lock found/) ? true : `reworded: ${show(errs)}; not found: ${show(notFound)}`;
});
attempt("a terms URL with no 200 in the lock fails", () => {
  const missing = licenseProblems(table(row()), ["alpha-things"], lockOf());
  const bad = licenseProblems(table(row()), ["alpha-things"], lockOf(fetched(ALPHA, { status: 404 })));
  const nohash = licenseProblems(table(row()), ["alpha-things"], lockOf(fetched(ALPHA, { sha256: "" })));
  return has(missing, /no entry in data\/licenses\.lock\.json/) && has(bad, /status 404/) && has(nohash, /no sha256/) ? true : `missing: ${show(missing)}; 404: ${show(bad)}; no hash: ${show(nohash)}`;
});
attempt("a stated absence the lock does not back fails", () => {
  const errs = licenseProblems(table(row({ grants: "terms page states no licence" })), ["alpha-things"], lockOf(fetched(ALPHA, { kind: "no-licence", matches: 3 })));
  return has(errs, /does not show .* free of licence words/) ? true : show(errs);
});
attempt("a publisher listed twice fails", () => {
  const errs = licenseProblems(table(row(), row()), ["alpha-things"], goodLock());
  return has(errs, /Alpha Agency is listed twice/) ? true : show(errs);
});
attempt("a table without the compilation licence line fails", () => {
  const md = table(row()).replace(COMPILATION_LINE, "Compilation licence: CC BY 4.0");
  const errs = licenseProblems(md, ["alpha-things"], goodLock());
  return has(errs, /compilation licence line is missing or reworded/) ? true : show(errs);
});
attempt("a retrieved date that is not the lock's fetch day fails", () => {
  const errs = licenseProblems(table(row({ retrieved: "2026-10-19" })), ["alpha-things"], goodLock());
  return has(errs, /is not the lock's fetch day 2026-10-21/) ? true : show(errs);
});
attempt("a URL in the lock that no row cites fails", () => {
  const errs = licenseProblems(table(row()), ["alpha-things"], lockOf(fetched(ALPHA), fetched(BETA)));
  return has(errs, /example\.org\/beta\/terms is in the lock but in no row/) ? true : show(errs);
});
attempt("a row with a different number of URLs and statements fails", () => {
  const errs = licenseProblems(table(row({ urls: `${ALPHA}<br>${BETA}` })), ["alpha-things"], lockOf(fetched(ALPHA), fetched(BETA)));
  return has(errs, /2 terms URL\(s\) and 1 statement/) ? true : show(errs);
});

// ---------------------------------------------------------------- the committed files
const manifestCollections = () =>
  readdirSync(MANIFESTS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
const read = (p) => readFileSync(p, "utf8");

attempt("data/LICENSES.md passes against the committed manifests and data/licenses.lock.json", () => {
  const errs = licenseProblems(read(LICENSES), manifestCollections(), JSON.parse(read(LOCK)));
  return errs.length === 0 ? true : show(errs);
});
attempt("every collection in data/manifests has a publisher row in data/LICENSES.md", () => {
  const { rows } = parseTable(read(LICENSES));
  const named = new Set(rows.flatMap((r) => r.collections));
  const cs = manifestCollections();
  const missing = cs.filter((c) => !named.has(c));
  return cs.length > 0 && missing.length === 0 ? true : `no row for: ${missing.join(", ") || "(data/manifests has no collection folders)"}`;
});
attempt("data/LICENSES.md and data/licenses.lock.json name the same terms URLs", () => {
  const { rows } = parseTable(read(LICENSES));
  const a = new Set(rows.flatMap((r) => r.urls));
  const b = new Set(JSON.parse(read(LOCK)).fetches.map((f) => f.url));
  const onlyMd = [...a].filter((u) => !b.has(u));
  const onlyLock = [...b].filter((u) => !a.has(u));
  return a.size > 0 && !onlyMd.length && !onlyLock.length ? true : `only in LICENSES.md: ${onlyMd.join(" ")}; only in the lock: ${onlyLock.join(" ")}`;
});
attempt("the Hugging Face dataset card links data/LICENSES.md and carries the compilation licence line", () => {
  const md = read(HF_README);
  return md.includes(LICENSES_URL) && md.includes(COMPILATION_LINE) ? true : `link ${md.includes(LICENSES_URL)}, line ${md.includes(COMPILATION_LINE)}`;
});
attempt("the MCP server instructions link data/LICENSES.md, and docs/MCP.md carries it with them", () => {
  const m = /export const INSTRUCTIONS = \[([\s\S]*?)\]\.join\("\\n"\)/.exec(read(SERVER_TS));
  if (!m) return "INSTRUCTIONS not found in apps/map/lib/mcp/server.ts";
  if (!m[1].includes(LICENSES_URL)) return "INSTRUCTIONS does not name " + LICENSES_URL;
  return read(MCP_MD).includes(LICENSES_URL) ? true : "apps/map/docs/MCP.md does not carry the link";
});
attempt("data/PIPELINE.md has a Licences section naming data/LICENSES.md and this test", () => {
  const md = read(PIPELINE_MD);
  const at = md.search(/^## Licences\s*$/m);
  if (at < 0) return "no '## Licences' heading";
  const section = md.slice(at).split(/^## /m)[1] ?? "";
  return /LICENSES\.md/.test(section) && /licenses\.test\.mjs/.test(section) ? true : "the section does not name LICENSES.md and licenses.test.mjs";
});

console.log(`\nlicenses: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
