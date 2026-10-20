// Pre-registration witness check: was the hash posted on the PR before the run's first plan?
//   node scripts/prereg-check.mjs --hash <sha256> --run <folder> [--pr 15] [--first-plan <ISO time>]
// Reads the PR's comments with `gh api repos/jcdavis131/groundtruth/issues/<pr>/comments --paginate`, finds the
// comment containing the hash (the earliest one, if several), and exits 1 unless its created_at is before the
// earliest file mtime under the run folder, or before --first-plan when given (use it when the folder also holds
// setup files older than the first plan). Prints both timestamps either way. Exit 2: usage or gh failure.
// --comments <file> reads recorded gh JSON instead of calling gh (the self-test uses it).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const hash = opt("--hash");
const run = opt("--run");
const pr = opt("--pr") ?? "15";
const firstPlan = opt("--first-plan");
const recorded = opt("--comments");
const die = (msg, code = 1) => {
  console.log(msg);
  process.exit(code);
};
if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) die("usage: --hash <64 hex sha256> --run <folder> [--pr 15] [--first-plan ISO]", 1);
if (!run || !existsSync(run) || !statSync(run).isDirectory()) die(`run folder not found: ${run}`);
if (!/^\d+$/.test(pr)) die(`bad PR number: ${pr}`);

function earliest(dir) {
  let min = null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    const t = e.isDirectory() ? earliest(f) : statSync(f).mtimeMs;
    if (t !== null && (min === null || t < min)) min = t;
  }
  return min;
}

let raw;
if (recorded) raw = readFileSync(recorded, "utf8");
else {
  const r = spawnSync("gh", ["api", `repos/jcdavis131/groundtruth/issues/${pr}/comments`, "--paginate"], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) die(`gh api failed (exit ${r.status}): ${(r.stderr || "").trim().slice(0, 300)}`, 2);
  raw = r.stdout;
}
let comments;
try {
  comments = JSON.parse(raw.replace(/\]\s*\[/g, ",")); // --paginate prints one array per page
} catch (e) {
  die(`could not parse the comments JSON: ${e.message}`, 2);
}
const needle = hash.toLowerCase();
const hit = comments
  .filter((c) => typeof c.body === "string" && c.body.toLowerCase().includes(needle))
  .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at))[0];
if (!hit) die(`FAIL: no comment on #${pr} contains ${hash}`);

const posted = Date.parse(hit.created_at);
let planMs, planLabel;
if (firstPlan) {
  planMs = Date.parse(firstPlan);
  if (Number.isNaN(planMs)) die(`bad --first-plan: ${firstPlan}`);
  planLabel = "first plan (--first-plan)";
} else {
  planMs = earliest(run);
  if (planMs === null) die(`run folder has no files: ${run}`);
  planLabel = "earliest file mtime in the run folder";
}
console.log(`hash comment created_at: ${hit.created_at}  (#${pr}, comment ${hit.id})`);
console.log(`${planLabel}: ${new Date(planMs).toISOString()}`);
if (posted < planMs) console.log("PASS: the hash was posted before the first plan");
else die("FAIL: the hash was posted at or after the first plan");
