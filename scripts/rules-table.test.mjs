// Test for AGENTS.md's rules table: a row marked Checked here must name a mutant. Plain Node, no install.
//   node scripts/rules-table.test.mjs                     the table against the registry (names exist, allowlist consistent)
//   node scripts/rules-table.test.mjs --table <json>      also: every named mutant is killed in the recorded kill table
//   node scripts/rules-table.test.mjs --propose           print each Checked row with the mutants that point at it
//
// A "Checked here" row is one whose Status starts with Checked and says here, the same criterion as
// scripts/guard.mjs's rules check. Its Enforced-by cell must carry `Mutants: `name`, `name`` with names from
// apps/map/scripts/rule-mutate.mjs: a break of that rule that the named tests kill. Without --table this
// can only show that the names exist; "killed" is what CI's recorded kill table shows
// (.github/workflows/rule-mutations.yml passes it with --table).
//
// ALLOWLIST is the 2026-10-20 snapshot of the Checked rows that name no mutant yet. Builders may not edit
// AGENTS.md, so the proposed rows (see --propose) go in the PR body and the docs follow-up PR adds them and
// deletes ALLOWLIST. Until then the allowlist can only shrink: a Checked row that is neither listed nor
// naming a mutant fails, a listed row that now names a mutant fails (delete its entry), and a listed row
// that no longer exists fails.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MUTANTS } from "../apps/map/scripts/rule-mutate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The Checked rows that named no mutant on 2026-10-20, by the first 60 characters of their Rule cell. */
export const ALLOWLIST = {
  date: "2026-10-20",
  rows: [],
};

const KEY_LENGTH = 60;
export const keyOf = (rule) => rule.slice(0, KEY_LENGTH);

/** The rows of the "Record rules and what enforces them" table: {line, rule, by, status}, plus problems with its shape. */
export function tableRows(text) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^#+\s*Record rules and what enforces them\s*$/.test(l));
  if (at < 0) return { rows: [], problems: ['no "Record rules and what enforces them" heading'] };
  const rows = [];
  const problems = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#+\s/.test(l)) break;
    if (!l.startsWith("|")) continue;
    const cells = l.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
    if (cells[0] === "Rule" || /^:?-+:?$/.test(cells[0])) continue;
    if (cells.length !== 3) {
      problems.push(`AGENTS.md:${i + 1} row has ${cells.length} cells, not 3`);
      continue;
    }
    rows.push({ line: i + 1, rule: cells[0], by: cells[1], status: cells[2] });
  }
  if (!rows.length) problems.push("the table has no rows");
  return { rows, problems };
}

/** guard.mjs's criterion: Status starts with Checked and says here. */
export const checkedHere = (row) => /^Checked/.test(row.status) && /\bhere\b/i.test(row.status);

/** The mutant names an Enforced-by cell carries: "Mutants: `a`, `b`". */
export function namedMutants(by) {
  const m = /\bMutants?:\s*((?:`[^`]+`[\s,]*(?:and\s+)?)+)/.exec(by);
  return m ? [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1].trim()) : [];
}

/**
 * Every finding against the table. mutants: [{name, row}] (the registry); table: a Map of mutant name to its
 * result in the recorded kill table, or null when none was given; allowlist: the keys of rows allowed to name none.
 */
export function judge({ rows, mutants, table = null, allowlist }) {
  const out = [];
  const names = new Set(mutants.map((m) => m.name));
  const checked = rows.filter(checkedHere);
  for (const m of mutants) {
    if (!rows.some((r) => r.rule.startsWith(m.row))) out.push(`mutant ${m.name} points at the row "${m.row}", which is not in AGENTS.md`);
  }
  for (const r of checked) {
    const key = keyOf(r.rule);
    const named = namedMutants(r.by);
    const listed = allowlist.includes(key);
    if (!mutants.some((m) => r.rule.startsWith(m.row))) out.push(`AGENTS.md:${r.line} "${key}" is Checked here and no mutant in rule-mutate.mjs points at it`);
    if (named.length === 0) {
      if (!listed) out.push(`AGENTS.md:${r.line} "${key}" is Checked here and names no mutant; add "Mutants: \`name\`" to its Enforced-by cell`);
      continue;
    }
    if (listed) out.push(`AGENTS.md:${r.line} "${key}" names a mutant now, so delete its allowlist entry`);
    for (const n of named) {
      if (!names.has(n)) out.push(`AGENTS.md:${r.line} "${key}" names mutant ${n}, which is not in rule-mutate.mjs`);
      else if (table && table.get(n) !== "killed") out.push(`AGENTS.md:${r.line} "${key}" names mutant ${n}, which the recorded kill table shows as ${table.get(n) ?? "absent"}`);
    }
  }
  for (const key of allowlist) {
    if (!checked.some((r) => keyOf(r.rule) === key)) out.push(`allowlist entry "${key}" matches no Checked row`);
  }
  return out;
}

// ---------------------------------------------------------------- the self-test and the real table

function main(argv) {
  let failed = 0;
  const check = (ok, msg, detail = "") => {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"}  ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
  };
  const real = tableRows(readFileSync(path.join(ROOT, "AGENTS.md"), "utf8"));

  if (argv[0] === "--propose") {
    for (const r of real.rows.filter(checkedHere)) {
      const ms = MUTANTS.filter((m) => r.rule.startsWith(m.row)).map((m) => m.name);
      console.log(`AGENTS.md:${r.line} ${keyOf(r.rule)}\n    add to the Enforced-by cell: Mutants: ${ms.map((n) => `\`${n}\``).join(", ") || "(none in the registry)"}.`);
    }
    return 0;
  }

  // synthetic tables
  const md = (...rows) => `# Rules\n\n## Record rules and what enforces them\n\n| Rule | Enforced by | Status |\n|---|---|---|\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}\n\nAfter.\n`;
  const reg = [
    { name: "alpha-break", row: "Rule A" },
    { name: "beta-break", row: "Rule B" },
  ];
  // The registry is cut to the rows in the table unless a case says otherwise, so each case judges one thing.
  const run = (rows, extra = {}) => {
    const parsed = tableRows(md(...rows)).rows;
    return judge({ rows: parsed, mutants: reg.filter((m) => parsed.some((r) => r.rule.startsWith(m.row))), allowlist: [], ...extra });
  };
  const A = ["Rule A", "`a.mjs`. Mutants: `alpha-break`.", "Checked here"];
  const B = ["Rule B", "`b.mjs`", "Checked here"];
  check(run([A]).length === 0, "a Checked row naming a mutant in the registry passes");
  check(run([A, ["Rule B", "`b.mjs`. Mutants: `beta-break`, `alpha-break`", "Checked here, for those only"]]).length === 0, "several mutants, and a Status that starts Checked and says here, pass");
  check(run([A, ["Judgement", "Nothing yet", "Review only"], ["Eye only", "eye: `x.ts`", "Checked in eye"]]).length === 0, "a row that is not Checked here is not judged");
  check(run([A, B]).some((f) => /"Rule B" is Checked here and names no mutant/.test(f)), "a Checked row naming no mutant fails");
  check(run([A, B], { allowlist: ["Rule B"] }).length === 0, "the allowlist excuses a row that names none");
  check(run([A], { allowlist: ["Rule Z"] }).some((f) => /allowlist entry "Rule Z" matches no Checked row/.test(f)), "an allowlist entry that matches no row fails");
  check(run([A], { allowlist: ["Rule A"] }).some((f) => /now, so delete its allowlist entry/.test(f)), "an allowlist entry for a row that now names a mutant fails");
  check(run([["Rule A", "`a.mjs`. Mutants: `nope-break`.", "Checked here"]]).some((f) => /names mutant nope-break, which is not in rule-mutate.mjs/.test(f)), "a named mutant that is not in the registry fails");
  check(run([["Rule A", "`a.mjs`. Mutants: `alpha-break`.", "Checked here"], ["Rule C", "`c.mjs`. Mutants: `alpha-break`.", "Checked here"]]).some((f) => /Rule C.*no mutant in rule-mutate.mjs points at it/.test(f)), "a Checked row no registry mutant points at fails even when it names one");
  check(judge({ rows: tableRows(md(A)).rows, mutants: reg, allowlist: [] }).some((f) => /mutant beta-break points at the row "Rule B", which is not in AGENTS.md/.test(f)), "a mutant that points at a row that is not in the table fails");
  const killed = new Map([["alpha-break", "killed"], ["beta-break", "survived"]]);
  check(run([A], { table: killed }).length === 0, "with a recorded table, a named mutant that was killed passes");
  check(run([["Rule B", "`b.mjs`. Mutants: `beta-break`.", "Checked here"]], { table: killed }).some((f) => /beta-break, which the recorded kill table shows as survived/.test(f)), "with a recorded table, a named mutant that survived fails");
  check(run([A], { table: new Map() }).some((f) => /alpha-break, which the recorded kill table shows as absent/.test(f)), "with a recorded table, a named mutant missing from it fails");
  check(namedMutants("x. Mutants: `a-b`, `c-d` and `e-f`. More `g-h`.").join() === "a-b,c-d,e-f", "namedMutants reads the names after Mutants: and no other backticks");
  check(namedMutants("`a-b` and `c-d`").length === 0, "backticked words without the Mutants: marker name nothing");

  // the real table
  check(real.problems.length === 0, "AGENTS.md's rules table is found and well formed", real.problems.join("; "));
  const checked = real.rows.filter(checkedHere);
  check(checked.length > 0, `the table has Checked rows (${checked.length})`);
  let recorded = null;
  if (argv[0] === "--table") {
    const doc = JSON.parse(readFileSync(path.resolve(argv[1] ?? ""), "utf8"));
    check(doc.schema === "rule-mutations/1", "the recorded kill table is rule-mutations/1");
    const got = (doc.mutants ?? []).map((m) => m.name).join(",");
    check(got === MUTANTS.map((m) => m.name).join(","), "the recorded table lists exactly the registry's mutants, in order", got);
    recorded = new Map((doc.mutants ?? []).map((m) => [m.name, m.result]));
  }
  const findings = judge({ rows: real.rows, mutants: MUTANTS, table: recorded, allowlist: ALLOWLIST.rows });
  check(findings.length === 0, `every Checked row names a ${recorded ? "killed " : ""}mutant or is on the ${ALLOWLIST.date} allowlist (${ALLOWLIST.rows.length} listed)`, findings.join("\n      "));
  console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
