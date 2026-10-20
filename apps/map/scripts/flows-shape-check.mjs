// Shape check for a flow data refresh (apps/map/scripts/flows-data.mjs writes
// lib/flows/data/wind.json and currents.json every 6 h from Scout's cron, and
// each run opens a data-only pull request). A refresh may change the numbers
// and the as-of time and nothing else. This compares the working-tree files
// with the same paths at a base ref, read with `git show <ref>:<path>` (no
// checkout), and passes a file only if:
//
//   keys     the top-level keys are the same set
//   grid     every field of `grid` is identical (lat0, lon0, dlat, dlon, nlat, nlon)
//   length   u, v (and sst for currents) are arrays of the same length as the base
//   nulls    each array has the same count of non-null entries. Land is null and
//            stays null: a zero fill would read as calm water
//   mask     with equal counts, the null entries sit at the same indices
//   source   `source` is the same string
//   asof     `asof` parses, is strictly newer than the base's, and is not in the
//            future. Open-Meteo's `current.time` is a 15-minute slot, so an hour
//            of slack covers slot rounding and clock skew between the cron and CI
//   range    every entry is null or a finite number within a sane range, in the
//            units flows-data.mjs writes: wind u, v in m/s (|x| <= 120); current
//            u, v in m/s (|x| <= 10, converted from km/h); sst in degC (-5..45)
//
// A file whose bytes equal the base's is reported as unchanged and passes, so a
// refresh of one file does not fail on the other, and a no-change tree passes.
// A file that is not valid JSON fails with reason `parse`.
//
// Prints one line per file, PASS or FAIL with every reason, and exits 1 if any
// file fails. Plain Node, no install, no network. Reports only; merges nothing.
//
//   node apps/map/scripts/flows-shape-check.mjs                  against origin/master
//   node apps/map/scripts/flows-shape-check.mjs --base <ref>     against another ref
//   node apps/map/scripts/flows-shape-check.mjs --root <dir>     another checkout (the self-test)
//
// The two files are read from <root>/apps/map/lib/flows/data, where <root> is
// the checkout this script lives in unless --root says otherwise.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = "apps/map/lib/flows/data";
export const FUTURE_SLACK_MS = 60 * 60_000;

/** What each bundle must hold: its arrays, and each one's [low, high, unit]. */
export const SPECS = {
  "wind.json": { u: [-120, 120, "m/s"], v: [-120, 120, "m/s"] },
  "currents.json": { u: [-10, 10, "m/s"], v: [-10, 10, "m/s"], sst: [-5, 45, "degC"] },
};
export const FILES = Object.keys(SPECS);

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
const plain = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

/** Fields on which two plain objects differ, as "name: base -> head" strings. */
function gridDiff(base, head) {
  const names = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  const show = (v) => (v === undefined ? "absent" : JSON.stringify(v));
  return names.filter((k) => !Object.is(base[k], head[k])).map((k) => `${k} ${show(base[k])} -> ${show(head[k])}`);
}

/**
 * Compare one bundle against its base. Pure: no git, no clock beyond `now`.
 * Returns { ok, reasons, summary }: reasons are "<rule>: <what changed>" strings,
 * summary is a short description of a passing file.
 */
export function compare(name, base, head, { now = Date.now() } = {}) {
  const spec = SPECS[name];
  if (!spec) throw new Error(`no spec for ${name}`);
  const reasons = [];
  if (!plain(base)) return { ok: false, reasons: ["base: not a JSON object"], summary: "" };
  if (!plain(head)) return { ok: false, reasons: ["head: not a JSON object"], summary: "" };

  // keys
  const bk = Object.keys(base);
  const hk = Object.keys(head);
  if (!sameSet(bk, hk)) {
    const missing = bk.filter((k) => !hk.includes(k));
    const extra = hk.filter((k) => !bk.includes(k));
    const parts = [];
    if (missing.length) parts.push(`missing ${missing.map((k) => JSON.stringify(k)).join(", ")}`);
    if (extra.length) parts.push(`added ${extra.map((k) => JSON.stringify(k)).join(", ")}`);
    reasons.push(`keys: ${parts.join("; ")}`);
  }

  // grid
  if (!plain(base.grid) || !plain(head.grid)) {
    reasons.push(`grid: ${plain(head.grid) ? "base has no grid object" : "not an object"}`);
  } else {
    const diff = gridDiff(base.grid, head.grid);
    if (diff.length) reasons.push(`grid: ${diff.join(", ")}`);
  }

  // length, nulls, mask, range: per array
  const counts = [];
  const spans = [];
  for (const k of Object.keys(spec)) {
    const b = base[k];
    const h = head[k];
    if (!Array.isArray(h)) {
      reasons.push(`length: ${k} is ${h === undefined ? "missing" : "not an array"}`);
      continue;
    }
    if (!Array.isArray(b)) {
      reasons.push(`length: ${k} is not an array in the base`);
      continue;
    }
    if (h.length !== b.length) reasons.push(`length: ${k} ${b.length} -> ${h.length}`);

    const bHave = b.filter((x) => x != null).length;
    const hHave = h.filter((x) => x != null).length;
    if (hHave !== bHave) {
      reasons.push(`nulls: ${k} non-null ${bHave} -> ${hHave}`);
    } else if (h.length === b.length) {
      let moved = 0;
      for (let i = 0; i < h.length; i++) if ((b[i] == null) !== (h[i] == null)) moved++;
      if (moved) reasons.push(`mask: ${k} null entries moved at ${moved} ${moved === 1 ? "index" : "indices"}`);
    }
    counts.push(`${k} ${h.length} long, ${hHave} non-null`);

    const [lo, hi, unit] = spec[k];
    const bad = [];
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < h.length; i++) {
      const x = h[i];
      if (x == null) continue;
      if (typeof x !== "number" || !Number.isFinite(x)) {
        bad.push(`${k}[${i}] = ${typeof x === "number" ? String(x) : JSON.stringify(x)}`);
      } else if (x < lo || x > hi) {
        bad.push(`${k}[${i}] = ${x}`);
      } else {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
    if (bad.length) {
      const shown = bad.slice(0, 3).join(", ");
      const more = bad.length > 3 ? ` and ${bad.length - 3} more` : "";
      reasons.push(`range: ${shown}${more} outside ${lo}..${hi} ${unit} or not finite`);
    } else if (hHave) {
      spans.push(`${k} ${min}..${max} ${unit}`);
    }
  }

  // source
  if (head.source !== base.source) {
    reasons.push(`source: ${JSON.stringify(base.source)} -> ${JSON.stringify(head.source)}`);
  }

  // asof
  const bAsof = Date.parse(base.asof);
  const hAsof = Date.parse(head.asof);
  if (typeof head.asof !== "string" || !Number.isFinite(hAsof)) {
    reasons.push(`asof: ${JSON.stringify(head.asof)} does not parse as a date`);
  } else if (!Number.isFinite(bAsof)) {
    reasons.push(`asof: base ${JSON.stringify(base.asof)} does not parse as a date`);
  } else {
    if (hAsof <= bAsof) reasons.push(`asof: ${head.asof} is not newer than base ${base.asof}`);
    if (hAsof > now + FUTURE_SLACK_MS) {
      reasons.push(`asof: ${head.asof} is in the future (now ${new Date(now).toISOString()})`);
    }
  }

  const summary = reasons.length
    ? ""
    : `asof ${base.asof} -> ${head.asof}; keys, grid ${head.grid.nlat}x${head.grid.nlon}, source unchanged; ` +
      `${counts.join("; ")}; ${spans.join(", ")}`;
  return { ok: reasons.length === 0, reasons, summary };
}

function parse(label, text) {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: `parse: ${label} is not valid JSON (${err.message})` };
  }
}

/** The base ref's copy of one file, or an error line. */
function baseText(root, ref, rel) {
  try {
    return { text: execFileSync("git", ["-C", root, "show", `${ref}:${rel}`], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (err) {
    const msg = String(err.stderr || err.message).trim().split("\n")[0];
    return { error: `base: cannot read ${ref}:${rel} (${msg})` };
  }
}

/** One file's verdict as { ok, line }. */
export function checkFile(root, ref, name, { now = Date.now() } = {}) {
  const rel = `${DATA_DIR}/${name}`;
  const file = path.join(root, ...rel.split("/"));
  const pad = name.padEnd(14);
  if (!existsSync(file)) return { ok: false, line: `${pad} FAIL  head: ${rel} is missing from the working tree` };
  const headRaw = readFileSync(file, "utf8");
  const base = baseText(root, ref, rel);
  if (base.error) return { ok: false, line: `${pad} FAIL  ${base.error}` };
  if (base.text === headRaw) return { ok: true, line: `${pad} PASS  unchanged from ${ref}` };
  const h = parse("head", headRaw);
  if (h.error) return { ok: false, line: `${pad} FAIL  ${h.error}` };
  const b = parse(`base ${ref}`, base.text);
  if (b.error) return { ok: false, line: `${pad} FAIL  ${b.error}` };
  const r = compare(name, b.value, h.value, { now });
  return r.ok
    ? { ok: true, line: `${pad} PASS  ${r.summary}` }
    : { ok: false, line: `${pad} FAIL  ${r.reasons.join("; ")}` };
}

function parseArgs(argv) {
  const opts = { base: "origin/master", root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base" && argv[i + 1]) opts.base = argv[++i];
    else if (a === "--root" && argv[i + 1]) opts.root = argv[++i];
    else if (a === "-h" || a === "--help") opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log("usage: node apps/map/scripts/flows-shape-check.mjs [--base <ref>] [--root <dir>]");
    process.exit(0);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = opts.root
    ? path.resolve(opts.root)
    : execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  let failed = 0;
  for (const name of FILES) {
    const r = checkFile(root, opts.base, name);
    if (!r.ok) failed++;
    console.log(r.line);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
