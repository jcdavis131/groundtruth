// Test for apps/map/scripts/rule-mutate.mjs: the registry is sound and its anchors are found exactly once; a
// full apply then restore of every break, on a copy of the tree, gives back the same sha256; and the ways it
// must refuse (an anchor that moved or occurs twice, a file already mutated, a file edited after the apply)
// do refuse and leave the bytes alone. Plain Node, no install; the .mjs extension keeps vitest's glob off it.
//   node apps/map/scripts/rule-mutate.test.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROOT, MUTANTS, ROW, applyMutant, parseResults, registryProblems, renderTable, restoreMutant } from "./rule-mutate.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "rule-mutate.mjs");
let failed = 0;
const check = (ok, msg, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const shaOf = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// Importing the module ran no CLI.
check(process.exitCode === undefined, "importing rule-mutate.mjs runs no CLI");

// ---------------------------------------------------------------- the registry

check(MUTANTS.length >= 14, `at least 14 mutants (${MUTANTS.length})`);
const problems = registryProblems(DEFAULT_ROOT);
check(problems.length === 0, "the registry is sound and every anchor is found exactly once on this tree", problems.join("; "));
for (const [key, row] of Object.entries(ROW)) {
  check(MUTANTS.some((m) => m.row === row), `AGENTS.md row "${key}" has at least one mutant`);
}
check(MUTANTS.every((m) => m.from !== m.to && m.to !== ""), "every break changes its anchor, and no break is a deletion to nothing");

// ---------------------------------------------------------------- a copy of the tree: every mutant's file and test files

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rule-mutate-test-"));
const copy = (rel) => {
  const to = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(DEFAULT_ROOT, rel), to);
};
for (const m of MUTANTS) {
  copy(m.file);
  for (const f of m.vitest) copy(`apps/map/${f}`);
  for (const f of m.node) copy(f);
}
const state = path.join(tmp, ".state");
const at = (m) => path.join(tmp, m.file);
const byName = (n) => MUTANTS.find((m) => m.name === n);
check(registryProblems(tmp).length === 0, "the copy passes the registry check too", registryProblems(tmp).join("; "));

// ---------------------------------------------------------------- apply then restore, every break

for (const m of MUTANTS) {
  const before = shaOf(at(m));
  const a = applyMutant(m.name, { root: tmp, state });
  check(a.code === 0, `${m.name}: applies`, a.message);
  const text = fs.readFileSync(at(m));
  check(shaOf(at(m)) !== before && text.includes(Buffer.from(m.to)), `${m.name}: the file holds the break while it is applied`);
  const r = restoreMutant(m.name, { root: tmp, state });
  check(r.code === 0 && shaOf(at(m)) === before, `${m.name}: restoring gives back sha256 ${before.slice(0, 12)}`, r.message);
}
check(!fs.existsSync(path.join(state, "applied.json")) || fs.readFileSync(path.join(state, "applied.json"), "utf8").trim() === "{}", "nothing is left applied");

// ---------------------------------------------------------------- the ways it must refuse

{
  const one = byName("borrowed-citation");
  const two = byName("missing-source-yields-value");
  const before = shaOf(at(one));
  check(applyMutant(one.name, { root: tmp, state }).code === 0, "refusal setup: the first break applies");
  const mid = shaOf(at(one));
  const clash = applyMutant(two.name, { root: tmp, state });
  check(clash.code === 4 && shaOf(at(one)) === mid, "a second break on a file that already has one is refused (exit 4) and changes nothing", clash.message);
  check(restoreMutant(two.name, { root: tmp, state }).code === 2, "restoring a break that is not applied is exit 2");
  fs.appendFileSync(at(one), "\n// an edit made after the break was applied\n");
  const edited = shaOf(at(one));
  const r = restoreMutant(one.name, { root: tmp, state });
  check(r.code === 5 && shaOf(at(one)) === edited, "restoring a file edited after the apply is refused (exit 5) and overwrites nothing", r.message);
  fs.writeFileSync(at(one), fs.readFileSync(at(one), "utf8").replace("\n// an edit made after the break was applied\n", ""));
  const ok = restoreMutant(one.name, { root: tmp, state });
  check(ok.code === 0 && shaOf(at(one)) === before, "with the edit taken out, the restore gives back the first sha256", ok.message);
  check(applyMutant("no-such-mutant", { root: tmp, state }).code === 2, "an unknown mutant is exit 2");
}

{
  const m = byName("withheld-null-becomes-0");
  const original = fs.readFileSync(at(m), "utf8");
  // the anchor has moved
  fs.writeFileSync(at(m), original.replace(m.from, "// moved"));
  const moved = shaOf(at(m));
  const a = applyMutant(m.name, { root: tmp, state });
  check(a.code === 3 && shaOf(at(m)) === moved, "an anchor that has moved is refused (exit 3) and the file is untouched", a.message);
  check(registryProblems(tmp).some((p) => p.startsWith(`${m.name}: anchor found 0 times`)), "--check names an anchor found 0 times");
  // the anchor occurs twice
  fs.writeFileSync(at(m), `${original}\n${m.from}\n`);
  const twice = shaOf(at(m));
  const b = applyMutant(m.name, { root: tmp, state });
  check(b.code === 3 && shaOf(at(m)) === twice, "an anchor found twice is refused (exit 3) and the file is untouched", b.message);
  check(registryProblems(tmp).some((p) => p.startsWith(`${m.name}: anchor found 2 times`)), "--check names an anchor found 2 times");
  fs.writeFileSync(at(m), original);
  check(registryProblems(tmp).length === 0, "put back, the copy passes the registry check again");
}

// ---------------------------------------------------------------- the CLI, on the copy

const env = { ...process.env, RULE_MUT_ROOT: tmp, RULE_MUT_STATE: path.join(tmp, ".cli-state") };
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
check(cli("--check").status === 0, "--check exits 0 on a sound tree");
check(cli("--list").stdout.trim().split("\n").join(",") === MUTANTS.map((m) => m.name).join(","), "--list prints every name, in order");
check(cli("--vitest", "borrowed-citation").stdout.trim() === "lib/mcp/world.test.ts", "--vitest prints the files that must kill a break");
check(cli("--node", "guard-pin-check-dropped").stdout.trim() === "scripts/guard.test.mjs", "--node prints the files that must kill a break");
check(cli("--apply", "no-such-mutant").status === 2, "--apply of an unknown name exits 2");
{
  const m = byName("guard-size-limit-lifted");
  const before = shaOf(at(m));
  const a = cli("--apply", m.name);
  check(a.status === 0 && shaOf(at(m)) !== before, "--apply rewrites the file");
  check(cli("--status").stdout.trim() === m.name, "--status names the break applied");
  const r = cli("--restore");
  check(r.status === 0 && shaOf(at(m)) === before && cli("--status").stdout.trim() === "", "--restore with no name puts every break back", r.stdout + r.stderr);
}
{
  const m = byName("borrowed-citation");
  fs.writeFileSync(at(m), fs.readFileSync(at(m), "utf8").replace(m.from, "// moved"));
  check(cli("--check").status === 1, "--check exits 1 once an anchor has moved");
  fs.copyFileSync(path.join(DEFAULT_ROOT, m.file), at(m));
  check(cli("--check").status === 0, "and 0 again once it is put back");
}

// ---------------------------------------------------------------- the kill table

{
  const all = (result) => MUTANTS.map((m) => `${m.name}\t${result}\tFAIL  a test | with a bar`).join("\n");
  const killed = renderTable(parseResults(all("killed")), "abc123");
  const json = JSON.parse(killed.json);
  check(json.schema === "rule-mutations/1" && json.sha === "abc123" && json.counts.killed === MUTANTS.length && json.counts.survived === 0 && json.counts.notApplied === 0, "an all-killed table counts every mutant killed");
  check(json.mutants.length === MUTANTS.length && json.mutants.every((x) => x.result === "killed" && typeof x.row === "string"), "the JSON lists each mutant with its row and result");
  check(killed.md.includes("a test \\| with a bar") && killed.md.includes(`**${MUTANTS.length} killed, 0 survived, 0 not applied, of ${MUTANTS.length}.**`), "the Markdown escapes a bar and states the totals");
  check(renderTable(parseResults(all("killed")), "abc123", "def456").md.includes("the job checked out `def456`") && !killed.md.includes("checked out"), "the Markdown names the checked-out commit only when it differs from the one the table is for");
  const mixed = `${all("killed").split("\n").slice(1).join("\n")}\n${MUTANTS[0].name}\tsurvived\t`;
  const t = renderTable(parseResults(mixed), null);
  check(t.counts.survived === 1 && t.md.includes("**SURVIVED**"), "a survivor is counted and shown in capitals");
  check(renderTable(parseResults(""), null).counts.notApplied === MUTANTS.length, "a mutant with no result is not-applied, never killed");
  let threw = false;
  try {
    parseResults("no-such-mutant\tkilled\t");
  } catch {
    threw = true;
  }
  check(threw, "a result for an unknown mutant is an error");
  threw = false;
  try {
    parseResults(`${MUTANTS[0].name}\tfine\t`);
  } catch {
    threw = true;
  }
  check(threw, "a result that is not killed, survived or not-applied is an error");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
process.exitCode = failed ? 1 : 0;
