// Self-test for eval/lineage.mjs. Plain Node, no install, no network.
//   node eval/lineage.test.mjs
// The `sources` strings are copied verbatim from task-pool/pool.json (frozen, sha 6c970b30..., on groundtruth#15), except the item named "p19 birthplaces (audit-sourced)",
// whose leading home-directory prefix is removed because guard.mjs forbids home paths in tracked files:
// the one audit-sourced item and five clean ones, including a gods-eye-view PR with the same number as a
// groundtruth PR in the lineage list (a different repo, so not lineage).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lineageFlags } from "./lineage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const list = JSON.parse(readFileSync(path.join(here, "lineage-list.json"), "utf8"));
const items = [
  {
    name: "p19 birthplaces (audit-sourced)",
    question: "Which Wikidata places of birth for NBA players stop at a state, country, county or island instead of a city?",
    sources: ["writeups/jev-2026-10-18/p19-audit/FINDING.md:13 (instances at p19-audit/raw.csv:1018-1019, :2956, :4014; also groundtruth PR #15 body line 22, dropped-coarser 52 NBA / 281 NFL)"],
  },
  { name: "NRHP restricted", question: "q-nrhp", sources: ["writeups/eye-layers-2026-10-12/BUILD.md:165"] },
  { name: "Alaska storm events", question: "q-ak", sources: ["writeups/eye-layers-2026-10-12/round8/BUILD.md:45"] },
  { name: "reservoir", question: "q-res", sources: ["apps/map/docs/INDICATORS.md:15"] },
  { name: "port", question: "q-port", sources: ["apps/map/README.md:48"] },
  { name: "metro (same PR number, other repo)", question: "q-metro", sources: ["gods-eye-view PR #18 body line 20 ('metros.json')", "gods-eye-view docs/PLACES.md:76,78", "apps/map/docs/PLACES.md:78"] },
];
let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
};

const flags = lineageFlags(items, list);
const flagged = new Set(flags.map((f) => f.question));
check(flagged.has(items[0].question), "flags the audit-sourced item");
check(flags.find((f) => f.question === items[0].question)?.rule === "p19-audit", "and names the rule (p19-audit)");
for (const it of items.slice(1)) check(!flagged.has(it.question), `does not flag ${it.name}`);
check(flags.length === 1, `exactly one flag (${flags.length})`);

const rules = [
  ["fema-fips-audit", [{ name: "x", question: "q1", sources: ["writeups/unify-2026-10-18/fema-fips-audit/README.md:3"] }]],
  ["fema-history-ts", [{ name: "x", question: "q2", sources: ["apps/map/lib/hazards/history.ts:40"] }]],
  ["pr-18", [{ name: "x", question: "q3", sources: ["groundtruth PR #18 body line 4"] }]],
  ["pr-52", [{ name: "x", question: "q4", sources: ["groundtruth PR #52 comment"] }]],
];
for (const [rule, its] of rules) check(lineageFlags(its, list)[0]?.rule === rule, `rule ${rule} fires on its own sources`);
check(lineageFlags([{ question: "q5", sources: ["groundtruth PR #180 body"] }], list).length === 0, "PR #180 is not PR #18");
check(lineageFlags([{ question: "q6", sources: ["writeups\\p19-audit\\FINDING.md:1"] }], list).length === 1, "Windows separators are normalised");

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
process.exitCode = failed ? 1 : 0;
