// The pre-registration gate: every RESULT.md in the repo names the hash it was preregistered under, and that hash
// was posted on groundtruth#15 before the run's first plan. Plain Node, no install, no network.
//
//   node eval/prereg-gate.mjs [--root <dir>] [--skip <path under root>]...
//
// For each RESULT.md found under --root (default: the repo root; .git and node_modules are not entered):
//   1. It names its hash on a line `Prereg: sha256 <64 hex>`. A RESULT.md that names none fails: a gate that
//      skips what is not named gates nothing. Every hash so named must pass step 4. A later amendment is not
//      named on such a line (say `Amendment after the plan began: sha256 ...`), so it is not held to this rule.
//   2. `prereg-comments.json` sits beside it: the output of
//        gh api repos/jcdavis131/groundtruth/issues/15/comments --paginate > prereg-comments.json
//      recorded when the result was written. CI is offline, so this is the only source of comment times it has.
//   3. At least one `run-*.log` beside it has a line that begins with an ISO timestamp, the run's own record of
//      when it began. File times do not count: a git checkout sets every mtime to the checkout time, which is
//      later than any comment, so scripts/prereg-check.mjs's mtime fallback would pass every late hash in CI.
//   4. node scripts/prereg-check.mjs --hash <hash> --run <folder> --comments prereg-comments.json exits 0,
//      that is, the earliest comment carrying the hash was created before the first plan.
// Exit 0: all pass, or there is no RESULT.md (printed as such). Exit 1: any fails. Exit 2: usage.
//
// What CI cannot see: that prereg-comments.json is what GitHub holds. It checks the recording against the run
// folder, not against GitHub; the line it prints for each hash gives the comment's id so a reviewer can open it.
// --skip is how the test fixtures (eval/fixtures) are kept out of the real scan, by name.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(here, "..", "scripts", "prereg-check.mjs");
const IGNORED = new Set([".git", "node_modules", ".next", ".venv", "__pycache__"]);

const argv = process.argv.slice(2);
let root = path.resolve(here, "..");
const skips = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--root" && argv[i + 1]) root = path.resolve(argv[++i]);
  else if (argv[i] === "--skip" && argv[i + 1]) skips.push(argv[++i].replace(/\\/g, "/").replace(/\/+$/, ""));
  else {
    console.log("usage: node eval/prereg-gate.mjs [--root <dir>] [--skip <path under root>]...");
    process.exit(2);
  }
}
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.log(`root not found: ${root}`);
  process.exit(2);
}

const rel = (p) => path.relative(root, p).split(path.sep).join("/") || ".";

function findResults() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const r = rel(full);
      if (skips.some((s) => r === s || r.startsWith(s + "/"))) continue;
      if (e.isDirectory()) {
        if (!IGNORED.has(e.name)) walk(full);
      } else if (e.name === "RESULT.md") out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

// scripts/prereg-check.mjs reads exactly these: run-*.log in the run folder, a leading ISO timestamp and a space.
const ISO_LINE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\s/m;
const hasPlanStart = (dir) => readdirSync(dir).some((n) => /^run-.*\.log$/.test(n) && ISO_LINE.test(readFileSync(path.join(dir, n), "utf8")));

const results = findResults();
let failed = 0;
for (const file of results) {
  const dir = path.dirname(file);
  const name = rel(file);
  const problems = [];
  const hashes = [...new Set([...readFileSync(file, "utf8").matchAll(/^[ \t]*Prereg:[ \t]*sha256[ \t]+([0-9a-f]{64})\b/gim)].map((m) => m[1].toLowerCase()))];
  const comments = path.join(dir, "prereg-comments.json");
  if (!hashes.length) problems.push('names no prereg sha256 (add a line "Prereg: sha256 <64 hex>")');
  if (!existsSync(comments)) problems.push("no prereg-comments.json beside it (record it: gh api repos/jcdavis131/groundtruth/issues/15/comments --paginate > prereg-comments.json)");
  if (!hasPlanStart(dir)) problems.push("no run-*.log beside it has a line that starts with an ISO timestamp, so there is no recorded plan start (file times are the checkout time in CI and prove nothing)");
  if (problems.length) {
    failed++;
    console.log(`FAIL ${name}`);
    for (const p of problems) console.log(`  ${p}`);
    continue;
  }
  let bad = false;
  const lines = [];
  for (const h of hashes) {
    const r = spawnSync(process.execPath, [checker, "--hash", h, "--run", dir, "--comments", comments], { encoding: "utf8" });
    lines.push(`  ${h}`);
    for (const l of `${r.stdout}${r.stderr}`.split(/\r?\n/).filter(Boolean)) lines.push(`    ${l}`);
    if (r.status !== 0) bad = true;
  }
  if (bad) failed++;
  console.log(`${bad ? "FAIL" : "ok  "} ${name}`);
  for (const l of lines) console.log(l);
}
if (!results.length) console.log(`prereg-gate: no RESULT.md under ${root}${skips.length ? " (skipping " + skips.join(", ") + ")" : ""}; nothing to check`);
else console.log(`prereg-gate: ${results.length} RESULT.md checked, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
