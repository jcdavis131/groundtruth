// Self-test for scripts/prereg-check.mjs on recorded `gh api repos/jcdavis131/groundtruth/issues/15/comments`
// JSON (scripts/fixtures/prereg-issue15-comments.json: three real comments, the middle one carries the v3 hash).
// A hash comment later than the run's first file fails; an earlier one passes. Plain Node, no install.
//   node scripts/prereg-check.test.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "prereg-check.mjs");
const fixture = path.join(here, "fixtures", "prereg-issue15-comments.json");
const HASH = "1f6cf84f8ae21acb67eec276a0daa1cf1cc5a9829aa47ee90d80a5a66d31b559";
const POSTED = "2026-10-19T19:18:37Z"; // created_at of the comment carrying HASH, as recorded
const made = [];
function runFolder(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "prereg-"));
  made.push(dir);
  for (const [name, iso] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), "x\n");
    const t = new Date(iso);
    utimesSync(path.join(dir, name), t, t);
  }
  return dir;
}
const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: "utf8" });
let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
};

const early = runFolder({ "plan-1.json": "2026-10-19T19:19:18Z", "sub/plan-2.json": "2026-10-19T20:00:00Z" });
const late = runFolder({ "plan-1.json": "2026-10-19T19:10:00Z", "plan-2.json": "2026-10-19T20:00:00Z" });

const a = run("--hash", HASH, "--run", early, "--comments", fixture);
check(a.status === 0, `a hash posted before the first file passes${a.status ? ": " + a.stdout + a.stderr : ""}`);
check(a.stdout.includes(POSTED) && a.stdout.includes("2026-10-19T19:19:18"), "it prints both timestamps");
const b = run("--hash", HASH, "--run", late, "--comments", fixture);
check(b.status === 1, "a hash posted after the first file fails");
check(b.stdout.includes(POSTED) && b.stdout.includes("2026-10-19T19:10:00"), "a failure prints both timestamps");
const c = run("--hash", HASH, "--run", late, "--comments", fixture, "--first-plan", "2026-10-19T19:19:18Z");
check(c.status === 0, "--first-plan overrides the folder's earliest mtime");
const d = run("--hash", HASH, "--run", early, "--comments", fixture, "--first-plan", "2026-10-19T19:00:00Z");
check(d.status === 1, "--first-plan earlier than the comment fails");
const e = run("--hash", "0".repeat(64), "--run", early, "--comments", fixture);
check(e.status === 1 && /no comment/i.test(e.stdout + e.stderr), "a hash no comment contains fails");
const f = run("--hash", HASH, "--run", path.join(early, "nope"), "--comments", fixture);
check(f.status === 1, "a missing run folder fails");
const g = run("--run", early, "--comments", fixture);
check(g.status === 1, "no hash fails");

// Plan time comes from the run folder's own run-*.log timestamps, not from older setup files beside them.
const logged = runFolder({ "freeze.py": "2026-10-19T19:16:54Z", "run-t1-C.log": "2026-10-19T20:30:00Z", "run-t3-C.log": "2026-10-19T20:40:00Z" });
writeFileSync(path.join(logged, "run-t1-C.log"), "2026-10-19T19:19:18Z C county_history {}\n2026-10-19T19:19:20Z C x {}\n");
writeFileSync(path.join(logged, "run-t3-C.log"), "2026-10-19T19:19:22Z C world_context {}\n");
const h = run("--hash", HASH, "--run", logged, "--comments", fixture);
check(h.status === 0 && h.stdout.includes("2026-10-19T19:19:18.000Z"), `setup file older than the hash beside later plan logs: default passes from run-*.log${h.status ? ": " + h.stdout : ""}`);
const lateLogged = runFolder({ "freeze.py": "2026-10-19T19:00:00Z", "run-t1-C.log": "2026-10-19T20:00:00Z" });
writeFileSync(path.join(lateLogged, "run-t1-C.log"), "2026-10-19T19:10:00Z C a {}\n");
check(run("--hash", HASH, "--run", lateLogged, "--comments", fixture).status === 1, "a log line earlier than the hash comment fails");
const i = run("--hash", HASH, "--run", logged, "--comments", fixture, "--first-plan", "2026-10-19T19:19:18Z");
check(i.status === 0 && /operator-supplied/.test(i.stdout), "--first-plan prints that it was operator-supplied");

for (const d of made) rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
process.exitCode = failed ? 1 : 0;
