// Self-test for eval/split.mjs. Plain Node, no install, no network.
//   node eval/split.test.mjs
// The test pool has the real pool's shape ({question, placeKind}) and uneven placeKind sizes; the questions
// are labels for the test only, never graded.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "split.mjs");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const id = (q) => sha(q).slice(0, 12);
let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
};

const kinds = { county: 7, hospital: 3, metro: 4, "FUDS property": 3, reservoir: 1, port: 1, "tribal land": 2, "storm events": 5 };
const pool = [];
for (const [k, n] of Object.entries(kinds)) for (let i = 0; i < n; i++) pool.push({ question: `test question ${k} ${i}`, placeKind: k, sources: ["t"] });
const dir = mkdtempSync(path.join(tmpdir(), "split-"));
const poolFile = path.join(dir, "pool.json");
writeFileSync(poolFile, JSON.stringify({ pool }));
const exclFile = path.join(dir, "exclusions.json");
const excluded = [pool[0], pool[9], pool[20]].map((p) => ({ id: id(p.question), rule: "test", arm: "both" }));
writeFileSync(exclFile, JSON.stringify({ excluded }));
const run = (out, extra = []) =>
  spawnSync(process.execPath, [script, "--pool", poolFile, "--exclusions", exclFile, "--out", out, ...extra], { encoding: "utf8" });

const out1 = path.join(dir, "split1.json");
const r1 = run(out1);
check(r1.status === 0, `writes a split${r1.status ? ": " + r1.stderr : ""}`);
const bytes = readFileSync(out1);
const split = JSON.parse(bytes);
check(r1.stdout.includes(sha(bytes)), "prints the sha256 of the split file");
check(r1.stdout.includes(sha(readFileSync(exclFile))), "prints the sha256 of the exclusion list it applied");
check(split.seed === 20261019, "the seed is 20261019");
check(typeof split.marker === "string" && split.marker.length > 0, "the split carries a header marker");

const all = [...split.open, ...split.sealed];
const kept = pool.filter((p) => !excluded.some((e) => e.id === id(p.question)));
check(all.length === kept.length && new Set(all).size === all.length, "every non-excluded item is in exactly one half");
check(excluded.every((e) => !all.includes(e.id)), "excluded items are in neither half");
check(JSON.stringify(split.excluded) === JSON.stringify(excluded.map((e) => e.id).sort()), "the excluded ids are recorded");
const kindOf = new Map(pool.map((p) => [id(p.question), p.placeKind]));
let worst = 0;
for (const k of Object.keys(kinds)) {
  const o = split.open.filter((i) => kindOf.get(i) === k).length;
  const s = split.sealed.filter((i) => kindOf.get(i) === k).length;
  worst = Math.max(worst, Math.abs(o - s));
}
check(worst <= 1, `every placeKind is within one item of proportional across halves (worst gap ${worst})`);
check(Math.abs(split.open.length - split.sealed.length) <= 1, "the halves differ in size by at most one");

const before = readFileSync(out1);
const r2 = run(out1);
check(r2.status !== 0 && /exist|overwrite|refus/i.test(r2.stderr), "refuses to overwrite an existing split.json");
check(Buffer.compare(before, readFileSync(out1)) === 0, "the existing file is untouched after a refusal");

const out3 = path.join(dir, "split3.json");
run(out3);
check(Buffer.compare(readFileSync(out1), readFileSync(out3)) === 0, "same inputs and seed give byte-identical files");
const out4 = path.join(dir, "split4.json");
run(out4, ["--seed", "1"]);
check(readFileSync(out4, "utf8") !== readFileSync(out1, "utf8"), "a different seed gives a different split");
const noExcl = spawnSync(process.execPath, [script, "--pool", poolFile, "--out", path.join(dir, "x.json")], { encoding: "utf8" });
check(noExcl.status !== 0 && !existsSync(path.join(dir, "x.json")), "refuses to run without an exclusion list");

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
process.exitCode = failed ? 1 : 0;
