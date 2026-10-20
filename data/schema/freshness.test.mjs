// Tests for data/schema/freshness.mjs, the weekly line that lists collections past their publisher's stated cadence.
// Plain Node, no install.
//   node data/schema/freshness.test.mjs
// data/schema/validate.test.mjs runs this file, so the data.yml "schema and fixture tests" step does too.
//
// Each case builds a small manifests folder and cadence table in a temp folder and runs the script on it with a fixed
// --today, so the output does not depend on the clock. The script reports and never gates: exit 0 for any content.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const SCRIPT = path.join(HERE, "freshness.mjs");

let passed = 0;
let failed = 0;
const check = (ok, msg, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  freshness: ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const attempt = (msg, fn) => {
  try {
    const r = fn();
    check(r === true, msg, typeof r === "string" ? r : "");
  } catch (e) {
    check(false, msg, String(e?.message ?? e));
  }
};

// ---------------------------------------------------------------- fixtures (made-up names; nothing here is fetched)
/** A folder holding manifests (just the fields the script reads) and a cadence table. */
function tree(snapshots, rows) {
  const dir = mkdtempSync(path.join(tmpdir(), "gt-fresh-"));
  for (const [id, createdAt] of snapshots) {
    const [collection, region] = id.split(".");
    mkdirSync(path.join(dir, "manifests", collection), { recursive: true });
    writeFileSync(path.join(dir, "manifests", collection, `${id}.json`), JSON.stringify({ snapshotId: id, collection, region: { id: region }, createdAt }) + "\n");
  }
  const cadence = path.join(dir, "cadence.json");
  writeFileSync(cadence, JSON.stringify({ schemaVersion: "cadence/1", collections: rows }) + "\n");
  return { manifests: path.join(dir, "manifests"), cadence };
}
const src = [{ url: "https://example.org/about", quote: "Data are published annually.", readAt: "2026-10-20" }];
const annual = (collection) => ({ collection, publisher: "Some Agency", statedCadence: "annual", expectedDays: 365, sources: src });
const weekly = (collection) => ({ collection, publisher: "Some Agency", statedCadence: "weekly", expectedDays: 7, sources: src });
const nullRow = (collection) => ({ collection, publisher: "Some Agency", expectedDays: null, reason: "publisher-cadence-unstated", sources: src });

const run = (t, today = "2026-10-20", extra = []) =>
  spawnSync(process.execPath, [SCRIPT, "--today", today, "--manifests", t.manifests, "--cadence", t.cadence, ...extra], { encoding: "utf8" });
const lines = (r) => r.stdout.split("\n").filter(Boolean);

// ---------------------------------------------------------------- overdue
attempt("a collection whose newest manifest is older than its cadence is listed overdue, and the exit is 0", () => {
  const t = tree([["alpha.north.2025-01-01", "2025-01-01T06:00:00Z"]], [annual("alpha")]);
  const r = run(t);
  const want = /^overdue: alpha newest 2025-01-01 cadence 365 \(age 657 days\)$/m;
  if (r.status !== 0) return `exit ${r.status}: ${r.stderr}`.slice(0, 500);
  if (!want.test(r.stdout)) return `no overdue line for alpha:\n${r.stdout}${r.stderr}`.slice(0, 600);
  return /^none overdue$/m.test(r.stdout) ? "printed 'none overdue' beside an overdue line" : true;
});
attempt("age equal to the cadence is not overdue; one day more is", () => {
  const t = tree([["alpha.north.2026-10-13", "2026-10-13T06:00:00Z"]], [weekly("alpha")]);
  const edge = run(t, "2026-10-20"); // 7 days old, cadence 7
  const over = run(t, "2026-10-21"); // 8 days old
  if (/^overdue:/m.test(edge.stdout) || !/^none overdue$/m.test(edge.stdout)) return `7 of 7 days read as overdue:\n${edge.stdout}`;
  return /^overdue: alpha newest 2026-10-13 cadence 7 \(age 8 days\)$/m.test(over.stdout) ? true : `8 of 7 days not overdue:\n${over.stdout}`;
});
attempt("a fresh collection prints 'none overdue' and no overdue line", () => {
  const t = tree([["alpha.north.2026-10-19", "2026-10-19T06:00:00Z"]], [annual("alpha")]);
  const r = run(t);
  return r.status === 0 && /^none overdue$/m.test(r.stdout) && !/^overdue:/m.test(r.stdout) ? true : `exit ${r.status}:\n${r.stdout}${r.stderr}`.slice(0, 500);
});
attempt("the newest manifest across regions decides, not the oldest", () => {
  const t = tree([["alpha.north.2024-01-01", "2024-01-01T06:00:00Z"], ["alpha.south.2026-10-01", "2026-10-01T06:00:00Z"]], [annual("alpha")]);
  const r = run(t);
  return /^none overdue$/m.test(r.stdout) && /^held: alpha newest 2026-10-01 \(alpha\.south\.2026-10-01\)/m.test(r.stdout) ? true : r.stdout.slice(0, 500);
});
attempt("several overdue collections are all listed, in name order", () => {
  const t = tree(
    [["zulu.north.2020-01-01", "2020-01-01T00:00:00Z"], ["alpha.north.2020-01-01", "2020-01-01T00:00:00Z"], ["mike.north.2026-10-19", "2026-10-19T00:00:00Z"]],
    [annual("zulu"), annual("alpha"), annual("mike")],
  );
  const o = lines(run(t)).filter((l) => l.startsWith("overdue:")).map((l) => l.split(" ")[1]);
  return o.join(",") === "alpha,zulu" ? true : `overdue order: ${o.join(",")}`;
});

// ---------------------------------------------------------------- unstated
attempt("a null cadence is listed unstated with its reason, and never overdue however old", () => {
  const t = tree([["beta.north.2015-01-01", "2015-01-01T00:00:00Z"]], [nullRow("beta")]);
  const r = run(t);
  if (r.status !== 0) return `exit ${r.status}: ${r.stderr}`.slice(0, 500);
  if (/^overdue:/m.test(r.stdout)) return `a null cadence was called overdue:\n${r.stdout}`;
  if (!/^unstated: beta \(publisher-cadence-unstated\)$/m.test(r.stdout)) return `no unstated line for beta:\n${r.stdout}`;
  return /^none overdue$/m.test(r.stdout) ? true : `expected 'none overdue':\n${r.stdout}`;
});
attempt("unstated and overdue are told apart in one run", () => {
  const t = tree([["alpha.north.2020-01-01", "2020-01-01T00:00:00Z"], ["beta.north.2020-01-01", "2020-01-01T00:00:00Z"]], [annual("alpha"), nullRow("beta")]);
  const r = run(t);
  const overdueNames = lines(r).filter((l) => l.startsWith("overdue:")).map((l) => l.split(" ")[1]);
  return overdueNames.join(",") === "alpha" && /^unstated: beta \(/m.test(r.stdout) ? true : r.stdout.slice(0, 500);
});
attempt("nothing unstated prints 'unstated: none'", () => {
  const t = tree([["alpha.north.2026-10-19", "2026-10-19T00:00:00Z"]], [annual("alpha")]);
  return /^unstated: none$/m.test(run(t).stdout) ? true : run(t).stdout.slice(0, 400);
});

// ---------------------------------------------------------------- the table and the manifests disagree
attempt("a collection with manifests but no cadence row is named, not guessed at, and the exit stays 0", () => {
  const t = tree([["alpha.north.2020-01-01", "2020-01-01T00:00:00Z"]], []);
  const r = run(t);
  return r.status === 0 && /^missing cadence row: alpha$/m.test(r.stdout) && !/^overdue:/m.test(r.stdout) ? true : `exit ${r.status}:\n${r.stdout}${r.stderr}`.slice(0, 500);
});
attempt("a cadence row with no manifest is named, and the exit stays 0", () => {
  const t = tree([["alpha.north.2026-10-19", "2026-10-19T00:00:00Z"]], [annual("alpha"), annual("ghost")]);
  const r = run(t);
  return r.status === 0 && /^no manifest for cadence row: ghost$/m.test(r.stdout) ? true : `exit ${r.status}:\n${r.stdout}${r.stderr}`.slice(0, 500);
});

// ---------------------------------------------------------------- shape of the output
attempt("the first line gives the date the ages are counted to; each collection has one held line with its inputs", () => {
  const t = tree([["alpha.north.2026-10-10", "2026-10-10T00:00:00Z"], ["beta.north.2026-10-19", "2026-10-19T00:00:00Z"]], [annual("alpha"), nullRow("beta")]);
  const ls = lines(run(t));
  const a = ls.find((l) => l.startsWith("held: alpha "));
  const b = ls.find((l) => l.startsWith("held: beta "));
  if (ls[0] !== "freshness as of 2026-10-20") return `first line: ${ls[0]}`;
  if (a !== "held: alpha newest 2026-10-10 (alpha.north.2026-10-10) age 10 days, cadence 365 days") return `alpha: ${a}`;
  return b === "held: beta newest 2026-10-19 (beta.north.2026-10-19) age 1 days, cadence unstated" ? true : `beta: ${b}`;
});
attempt("the same inputs give the same bytes", () => {
  const t = tree([["alpha.north.2020-01-01", "2020-01-01T00:00:00Z"], ["beta.north.2026-10-19", "2026-10-19T00:00:00Z"]], [annual("alpha"), nullRow("beta")]);
  return run(t).stdout === run(t).stdout && run(t).stdout.length > 0 ? true : "two runs differ, or the output is empty";
});
attempt("--today must be a calendar day; a bad one is a usage error (exit 2), not a silent default", () => {
  const t = tree([["alpha.north.2026-10-19", "2026-10-19T00:00:00Z"]], [annual("alpha")]);
  const r = run(t, "2026-02-31");
  return r.status === 2 ? true : `exit ${r.status}: ${r.stdout}${r.stderr}`.slice(0, 400);
});
attempt("an unreadable cadence table is exit 2 with a message, not a quiet 'none overdue'", () => {
  const t = tree([["alpha.north.2026-10-19", "2026-10-19T00:00:00Z"]], [annual("alpha")]);
  const r = spawnSync(process.execPath, [SCRIPT, "--today", "2026-10-20", "--manifests", t.manifests, "--cadence", path.join(path.dirname(t.manifests), "absent.json")], { encoding: "utf8" });
  return r.status === 2 && !/none overdue/.test(r.stdout) && r.stderr.length > 0 ? true : `exit ${r.status}: ${r.stdout}${r.stderr}`.slice(0, 400);
});
attempt("an unreadable manifests folder is exit 2", () => {
  const t = tree([["alpha.north.2026-10-19", "2026-10-19T00:00:00Z"]], [annual("alpha")]);
  const r = spawnSync(process.execPath, [SCRIPT, "--today", "2026-10-20", "--manifests", path.join(path.dirname(t.manifests), "absent"), "--cadence", t.cadence], { encoding: "utf8" });
  return r.status === 2 ? true : `exit ${r.status}: ${r.stdout}${r.stderr}`.slice(0, 400);
});

// ---------------------------------------------------------------- the committed tree
attempt("on the committed manifests and cadence table: exit 0, a first line, and one held line per committed collection", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--today", "2026-10-20"], { encoding: "utf8", cwd: ROOT });
  if (r.status !== 0) return `exit ${r.status}: ${r.stdout}${r.stderr}`.slice(0, 500);
  const cols = readdirSync(path.join(ROOT, "data", "manifests"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const held = lines(r).filter((l) => l.startsWith("held: ")).map((l) => l.split(" ")[1]).sort();
  if (lines(r)[0] !== "freshness as of 2026-10-20") return `first line: ${lines(r)[0]}`;
  return held.join(",") === cols.sort().join(",") ? true : `held lines for ${held.join(",")}, committed collections ${cols.join(",")}`;
});
attempt("the same run from another working directory prints the same bytes (paths come from the script, not the cwd)", () => {
  const a = spawnSync(process.execPath, [SCRIPT, "--today", "2026-10-20"], { encoding: "utf8", cwd: ROOT });
  const b = spawnSync(process.execPath, [SCRIPT, "--today", "2026-10-20"], { encoding: "utf8", cwd: tmpdir() });
  return a.stdout.length > 0 && a.stdout === b.stdout ? true : "outputs differ or are empty";
});

console.log(`\nfreshness: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
