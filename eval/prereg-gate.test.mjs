// Self-test for eval/prereg-gate.mjs, on the recorded #15 comments in eval/fixtures/prereg-gate/. Plain Node, no
// install, no network (eval.yml runs it with no interface).
//   node eval/prereg-gate.test.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(here, "prereg-gate.mjs");
const fixtures = path.join(here, "fixtures", "prereg-gate");
const made = [];
let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
};
const run = (...a) => {
  const r = spawnSync(process.execPath, [gate, ...a], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
/** A copy of the passing fixture in a temp folder, for a case that breaks one thing about it. */
function copyOfEarly() {
  const dir = mkdtempSync(path.join(tmpdir(), "prereg-gate-"));
  made.push(dir);
  cpSync(path.join(fixtures, "early-ok"), path.join(dir, "run"), { recursive: true });
  return path.join(dir, "run");
}

const early = run("--root", path.join(fixtures, "early-ok"));
check(early.status === 0 && /1 RESULT\.md checked, 0 failed/.test(early.out), `a hash posted before the first plan passes${early.status ? ": " + early.out : ""}`);
check(early.out.includes("2026-10-19T19:18:37Z") && early.out.includes("2026-10-19T19:19:18"), "it prints the comment's created_at and the first plan");

const late = run("--root", path.join(fixtures, "late-expected-red"));
check(late.status === 1 && /FAIL: the hash was posted at or after the first plan/.test(late.out), `a hash posted after the first plan fails${late.status !== 1 ? ": " + late.out : ""}`);
check(late.out.includes("2026-10-19T19:18:37Z") && late.out.includes("2026-10-19T19:10:00"), "a failure prints both timestamps");

const both = run("--root", fixtures);
check(both.status === 1 && /2 RESULT\.md checked, 1 failed/.test(both.out), "the whole fixture folder fails on the late case alone");
const skipped = run("--root", fixtures, "--skip", "late-expected-red");
check(skipped.status === 0 && /1 RESULT\.md checked, 0 failed/.test(skipped.out), "--skip leaves a folder out by name");

const none = mkdtempSync(path.join(tmpdir(), "prereg-gate-"));
made.push(none);
const empty = run("--root", none);
check(empty.status === 0 && /no RESULT\.md/.test(empty.out), "a root with no RESULT.md says so and passes");

// A RESULT.md that names no hash is not skipped.
const noHash = copyOfEarly();
writeFileSync(path.join(noHash, "RESULT.md"), "# a result with no preregistration named\n");
const a = run("--root", noHash);
check(a.status === 1 && /names no prereg sha256/.test(a.out), "a RESULT.md that names no prereg hash fails");

// A hash no #15 comment carries.
const unknown = copyOfEarly();
writeFileSync(path.join(unknown, "RESULT.md"), `Prereg: sha256 ${"0".repeat(64)}\n`);
const b = run("--root", unknown);
check(b.status === 1 && /no comment on #15 contains/.test(b.out), "a hash no comment contains fails");

// No recorded comments: CI is offline, so there is nothing to check against.
const noComments = copyOfEarly();
rmSync(path.join(noComments, "prereg-comments.json"));
const c = run("--root", noComments);
check(c.status === 1 && /no prereg-comments\.json/.test(c.out), "a RESULT.md with no recorded comments fails");

// No timestamped run log: file times must not stand in for the plan start. Old mtimes would make the hash look
// early, which is exactly what a git checkout can never show, so the gate refuses to look.
const noLog = copyOfEarly();
writeFileSync(path.join(noLog, "run-t1-C.log"), "a log whose lines carry no timestamp\n");
const old = new Date("2026-10-19T19:30:00Z");
utimesSync(path.join(noLog, "run-t1-C.log"), old, old);
const d = run("--root", noLog);
check(d.status === 1 && /no recorded plan start/.test(d.out), "a run with no timestamped log line fails, whatever its file times say");

// A nested result is found, and two hashes on two lines are both held to the rule.
const nested = copyOfEarly();
mkdirSync(path.join(nested, "deeper"), { recursive: true });
for (const f of ["prereg-comments.json", "run-t1-C.log"]) cpSync(path.join(nested, f), path.join(nested, "deeper", f));
writeFileSync(path.join(nested, "deeper", "RESULT.md"), `Prereg: sha256 ${readFileSync(path.join(fixtures, "early-ok", "RESULT.md"), "utf8").match(/[0-9a-f]{64}/)[0]}\nPrereg: sha256 ${"1".repeat(64)}\n`);
const e = run("--root", nested);
check(e.status === 1 && /2 RESULT\.md checked, 1 failed/.test(e.out), "a RESULT.md in a subfolder is found, and every hash it names must pass");

for (const dir of made) rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
process.exitCode = failed ? 1 : 0;
