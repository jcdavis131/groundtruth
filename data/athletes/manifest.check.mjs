// Checks the committed athlete manifests (data/athletes/manifests/*.json). Plain Node, no install.
//   node data/athletes/manifest.check.mjs
// The records themselves live outside git under <data-root>; only the manifest is committed. This checks
// that each manifest is small, says what it should (counts, coverage, A5a outcomes, a sha256 per file),
// that its counts agree with its file list, that the A5a trace check found no failures, and that it carries
// no never-list key and no bare calendar date (the shape a birth date would have).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "manifests");
const NEVER_KEYS = new Set(["birthdate", "birth_date", "dateofbirth", "dob", "age", "birthyear", "address", "height", "weight"]);
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

let files = [];
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
} catch {
  files = [];
}
const problems = [];
for (const f of files) {
  const full = path.join(DIR, f);
  const p = (m) => problems.push(`${f}: ${m}`);
  if (statSync(full).size > 1_000_000) p("larger than 1 MB; a manifest describes the data, it does not carry it");
  const m = JSON.parse(readFileSync(full, "utf8"));
  if (m.schemaVersion !== "athletes-manifest/1") p("schemaVersion is not athletes-manifest/1");
  if (!/^[0-9a-f]{40}$/.test(m.builder?.gitSha ?? "")) p("builder.gitSha is not a commit sha");
  for (const league of ["NBA", "NFL"]) {
    const file = m.files?.find((x) => x.path === `${league.toLowerCase()}.jsonl`);
    if (!file) p(`no ${league.toLowerCase()}.jsonl in files`);
    else if (file.records !== m.counts?.[league]?.records) p(`${league}: files says ${file.records} records, counts says ${m.counts?.[league]?.records}`);
    if (!m.coverage?.[league]?.birthCity || !m.coverage?.[league]?.school) p(`${league}: coverage lacks birthCity or school`);
    if (!m.birthplace?.outcomesPerAthlete?.[league]) p(`${league}: no A5a outcome counts`);
  }
  for (const x of m.files ?? []) if (!/^[0-9a-f]{64}$/.test(x.sha256 ?? "")) p(`${x.path}: no sha256`);
  if (m.birthplace?.traceCheck?.failures !== 0) p("the A5a trace check did not pass");
  if (m.directory && !m.directory.startsWith("<data-root>/")) p("directory is not written as <data-root>/...");
  const walk = (v, at) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}/${i}`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (NEVER_KEYS.has(k.toLowerCase())) p(`${at}/${k}: a never-list key`);
        walk(x, `${at}/${k}`);
      }
    } else if (typeof v === "string" && BARE_DATE.test(v)) p(`${at}: a bare calendar date (${v})`);
  };
  walk(m, "");
}
for (const x of problems) console.log(x);
console.log(`${files.length} manifest(s), ${problems.length} problem(s)`);
process.exitCode = problems.length ? 1 : 0;
