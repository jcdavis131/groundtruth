// Tests for the changelog rule in data/schema/validate.mjs (data/CHANGELOG.md). Plain Node, no install.
//   node data/schema/changelog.test.mjs
// data/schema/validate.test.mjs runs this file, so the data.yml "schema and fixture tests" step does too.
//
// The rule: every committed manifest whose snapshot day is after 2026-10-19 has a "## <snapshot id>" entry in
// data/CHANGELOG.md. With a predecessor (the previous day's snapshot of the same collection and region) the entry
// is the output of data/pipeline/diff.py against it; without one it says so. What this can check offline is the
// arithmetic: the entry's record counts equal the two manifests' recordCount, the removal classes add up, and
// added, removed, changed and unchanged agree with the record counts. That the counts reproduce from diff.py
// needs the snapshot files in the data root, so a reviewer runs diff.py; nothing here claims it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const VALIDATE = path.join(HERE, "validate.mjs");
const REAL_MANIFESTS = path.join(ROOT, "data", "manifests");
const REAL_CHANGELOG = path.join(ROOT, "data", "CHANGELOG.md");

let passed = 0;
let failed = 0;
const check = (ok, msg, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  changelog: ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const attempt = (msg, fn) => {
  try {
    const r = fn();
    check(r === true, msg, typeof r === "string" ? r : "");
  } catch (e) {
    check(false, msg, String(e?.message ?? e));
  }
};

const V = await import("./validate.mjs");
const call = (name, ...args) => {
  if (typeof V[name] !== "function") throw new Error(`validate.mjs does not export ${name}`);
  return V[name](...args);
};
const show = (errs) => errs.map((e) => `${e.code} ${e.path} ${e.message}`).join("; ") || "no problems";
const probs = (manifests, text) => call("changelogProblems", manifests, text);
const hasProblem = (errs, re) => errs.some((e) => e.code === "changelog" && re.test(`${e.path} ${e.message}`));

// ---------------------------------------------------------------- fixtures (made-up collections)
const man = (snapshotId, recordCount) => ({ snapshotId, recordCount });
const MANIFESTS = [
  man("things.north.2026-10-19", 10), // on the cutoff day: needs no entry
  man("things.north.2026-10-20", 10),
  man("things.north.2026-10-27", 12),
  man("things.south.2026-10-20", 5), // the first snapshot of its region
  man("other.north.2026-10-20", 7), // the first snapshot of its collection
];

/** One entry with a predecessor, in the form data/CHANGELOG.md documents. */
const diffEntry = (id, pred, o) => {
  const unknown = o.unknown ?? [];
  const by = o.by ?? [0, 0, 0, 0];
  const removed = o.removed ?? by.reduce((a, b) => a + b, 0);
  return [
    `## ${id}`,
    "",
    `- Predecessor: ${pred}`,
    `- Command: \`python data/pipeline/diff.py ${o.cmdPred ?? pred} ${id}\` (diff.py 0.1.0, exit ${o.exit ?? 0}, run 2026-10-20)`,
    `- Records: ${o.from} -> ${o.to}`,
    `- Added: ${o.added}`,
    `- Removed: ${removed} (publisher-status ${by[0]}, our-rule ${by[1]}, id-churn ${by[2]}, unknown ${by[3]})`,
    `- Changed: ${o.changed}`,
    `- Unchanged: ${o.unchanged}`,
    unknown.length ? `- Unknown removals: ${unknown.length}\n${unknown.map(([i, w]) => `  - ${i}: ${w}`).join("\n")}` : "- Unknown removals: none",
    "",
  ].join("\n");
};
const firstEntry = (id, col, reg) => `## ${id}\n\n- Predecessor: none (first snapshot of ${col} for ${reg})\n- Records: ${MANIFESTS.find((m) => m.snapshotId === id).recordCount}\n`;

const E_N20 = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", { from: 10, to: 10, added: 1, by: [1, 0, 0, 0], changed: 4, unchanged: 5 });
const E_N27 = diffEntry("things.north.2026-10-27", "things.north.2026-10-20", { from: 10, to: 12, added: 3, by: [0, 1, 0, 0], changed: 2, unchanged: 7 });
const E_S20 = firstEntry("things.south.2026-10-20", "things", "south");
const E_O20 = firstEntry("other.north.2026-10-20", "other", "north");
// The head of the real file shows the entry format in a code fence; a "## " line in a fence is an example, not an entry.
const HEAD = "# Data changelog\n\nSome words before the first entry.\n\n```\n## <snapshot id>\n\n- Predecessor: <previous snapshot id>\n```\n\n";
const doc = (...entries) => HEAD + entries.join("\n");
const GOOD = doc(E_N20, E_N27, E_S20, E_O20);

// ---------------------------------------------------------------- the rule, one fixture each
attempt("validate.mjs exports changelogProblems and the cutoff day 2026-10-19", () => (typeof V.changelogProblems === "function" && V.CHANGELOG_SINCE === "2026-10-19" ? true : "missing export or wrong cutoff"));
attempt("a faithful changelog (diff entries, two first-snapshot entries, none for the cutoff day) passes", () => {
  const errs = probs(MANIFESTS, GOOD);
  return errs.length === 0 ? true : show(errs);
});
attempt("a manifest after the cutoff with no entry fails, naming its snapshot id", () => {
  const errs = probs(MANIFESTS, doc(E_N20, E_S20, E_O20));
  return hasProblem(errs, /things\.north\.2026-10-27.*no entry/) ? true : show(errs);
});
attempt("a first snapshot with no entry fails: it needs an entry saying it has no predecessor", () => {
  const errs = probs(MANIFESTS, doc(E_N20, E_N27, E_O20));
  return hasProblem(errs, /things\.south\.2026-10-20.*no entry/) ? true : show(errs);
});
attempt("an empty changelog fails once per manifest after the cutoff, and not for the cutoff day", () => {
  const errs = probs(MANIFESTS, "");
  const named = errs.filter((e) => /no entry/.test(e.message)).map((e) => e.message.match(/\S+\.\d{4}-\d{2}-\d{2}/)?.[0]).sort();
  return named.join(",") === "other.north.2026-10-20,things.north.2026-10-20,things.north.2026-10-27,things.south.2026-10-20" ? true : `named: ${named.join(",")}`;
});
attempt("a first-snapshot entry for a snapshot that has a predecessor fails", () => {
  const wrong = firstEntry("things.north.2026-10-20", "things", "north");
  const errs = probs(MANIFESTS, doc(wrong, E_N27, E_S20, E_O20));
  return hasProblem(errs, /things\.north\.2026-10-20.*predecessor/) ? true : show(errs);
});
attempt("an entry that names a predecessor for a first snapshot fails", () => {
  const wrong = diffEntry("things.south.2026-10-20", "things.south.2026-10-19", { from: 5, to: 5, added: 0, changed: 0, unchanged: 5 });
  const errs = probs(MANIFESTS, doc(E_N20, E_N27, wrong, E_O20));
  return hasProblem(errs, /things\.south\.2026-10-20.*predecessor/) ? true : show(errs);
});
attempt("an entry naming the wrong predecessor fails", () => {
  const wrong = diffEntry("things.north.2026-10-27", "things.north.2026-10-19", { from: 10, to: 12, added: 3, by: [0, 1, 0, 0], changed: 2, unchanged: 7 });
  const errs = probs(MANIFESTS, doc(E_N20, wrong, E_S20, E_O20));
  return hasProblem(errs, /things\.north\.2026-10-27.*predecessor/) ? true : show(errs);
});
attempt("a heading that names no committed snapshot fails", () => {
  const errs = probs(MANIFESTS, GOOD + "\n## things.north.2026-11-03\n\n- Predecessor: none (first snapshot of things for north)\n");
  return hasProblem(errs, /things\.north\.2026-11-03.*no committed manifest/) ? true : show(errs);
});
attempt("a snapshot with two entries fails", () => {
  const errs = probs(MANIFESTS, GOOD + "\n" + E_N20);
  return hasProblem(errs, /things\.north\.2026-10-20.*twice/) ? true : show(errs);
});
attempt("Records that disagree with the predecessor's recordCount, or the snapshot's own, fail", () => {
  const badFrom = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", { from: 11, to: 10, added: 0, by: [1, 0, 0, 0], changed: 4, unchanged: 5 });
  const badTo = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", { from: 10, to: 9, added: 0, by: [1, 0, 0, 0], changed: 4, unchanged: 5 });
  const a = probs(MANIFESTS, doc(badFrom, E_N27, E_S20, E_O20));
  const b = probs(MANIFESTS, doc(badTo, E_N27, E_S20, E_O20));
  return hasProblem(a, /things\.north\.2026-10-20.*Records/) && hasProblem(b, /things\.north\.2026-10-20.*Records/) ? true : `from: ${show(a)}; to: ${show(b)}`;
});
attempt("a first snapshot whose Records disagree with its manifest fails", () => {
  const wrong = E_S20.replace("- Records: 5", "- Records: 6");
  const errs = probs(MANIFESTS, doc(E_N20, E_N27, wrong, E_O20));
  return hasProblem(errs, /things\.south\.2026-10-20.*Records/) ? true : show(errs);
});
attempt("removal classes that do not add up to Removed fail", () => {
  const bad = E_N20.replace("- Removed: 1 (publisher-status 1,", "- Removed: 2 (publisher-status 1,");
  const errs = probs(MANIFESTS, doc(bad, E_N27, E_S20, E_O20));
  return hasProblem(errs, /things\.north\.2026-10-20.*Removed/) ? true : show(errs);
});
attempt("Added minus Removed that is not the change in record count fails", () => {
  const bad = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", { from: 10, to: 10, added: 3, by: [1, 0, 0, 0], changed: 4, unchanged: 5 });
  const errs = probs(MANIFESTS, doc(bad, E_N27, E_S20, E_O20));
  return hasProblem(errs, /things\.north\.2026-10-20.*Added/) ? true : show(errs);
});
attempt("Changed plus Unchanged that is not the records present on both days fails", () => {
  const bad = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", { from: 10, to: 10, added: 1, by: [1, 0, 0, 0], changed: 4, unchanged: 6 });
  const errs = probs(MANIFESTS, doc(bad, E_N27, E_S20, E_O20));
  return hasProblem(errs, /things\.north\.2026-10-20.*Unchanged/) ? true : show(errs);
});
attempt("unknown removals that are not listed one by one fail", () => {
  const bad = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", { from: 10, to: 10, added: 2, by: [0, 0, 0, 2], changed: 4, unchanged: 4 }).replace(/- Unknown removals: none/, "- Unknown removals: 2");
  const errs = probs(MANIFESTS, doc(bad, E_N27, E_S20, E_O20));
  return hasProblem(errs, /things\.north\.2026-10-20.*nknown/) ? true : show(errs);
});
attempt("unknown removals listed with their ids and reasons pass", () => {
  const ok = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", {
    from: 10, to: 10, added: 2, by: [0, 0, 0, 2], changed: 4, unchanged: 4,
    unknown: [["things:1", "no gap item names it and no added record has the key"], ["things:2", "no gap item names it and no added record has the key"]],
  });
  const errs = probs(MANIFESTS, doc(ok, E_N27, E_S20, E_O20));
  return errs.length === 0 ? true : show(errs);
});
attempt("a zero unknown count that is not written 'none' fails; so does 'none' beside a nonzero count", () => {
  const zero = E_N20.replace("- Unknown removals: none", "- Unknown removals: 0");
  const a = probs(MANIFESTS, doc(zero, E_N27, E_S20, E_O20));
  const nonzero = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", { from: 10, to: 10, added: 1, by: [0, 0, 0, 1], changed: 4, unchanged: 5 });
  const b = probs(MANIFESTS, doc(nonzero, E_N27, E_S20, E_O20));
  return hasProblem(a, /things\.north\.2026-10-20.*nknown/) && hasProblem(b, /things\.north\.2026-10-20.*nknown/) ? true : `zero: ${show(a)}; none-beside-nonzero: ${show(b)}`;
});
attempt("a Command that does not name the pair, or did not exit 0, fails", () => {
  const wrongPair = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", { from: 10, to: 10, added: 1, by: [1, 0, 0, 0], changed: 4, unchanged: 5, cmdPred: "things.south.2026-10-19" });
  const failedRun = diffEntry("things.north.2026-10-20", "things.north.2026-10-19", { from: 10, to: 10, added: 1, by: [1, 0, 0, 0], changed: 4, unchanged: 5, exit: 1 });
  const a = probs(MANIFESTS, doc(wrongPair, E_N27, E_S20, E_O20));
  const b = probs(MANIFESTS, doc(failedRun, E_N27, E_S20, E_O20));
  return hasProblem(a, /things\.north\.2026-10-20.*Command/) && hasProblem(b, /things\.north\.2026-10-20.*Command/) ? true : `pair: ${show(a)}; exit: ${show(b)}`;
});
attempt("an entry missing a required line, or with a garbled one, fails", () => {
  const noChanged = E_N20.replace(/- Changed: 4\n/, "");
  const garbled = E_N20.replace("- Removed: 1 (publisher-status 1, our-rule 0, id-churn 0, unknown 0)", "- Removed: one");
  const a = probs(MANIFESTS, doc(noChanged, E_N27, E_S20, E_O20));
  const b = probs(MANIFESTS, doc(garbled, E_N27, E_S20, E_O20));
  return hasProblem(a, /things\.north\.2026-10-20.*Changed/) && hasProblem(b, /things\.north\.2026-10-20.*Removed/) ? true : `missing: ${show(a)}; garbled: ${show(b)}`;
});

// ---------------------------------------------------------------- the committed changelog
const realManifests = () => call("readManifestSummaries", REAL_MANIFESTS);
attempt("data/CHANGELOG.md passes against the committed manifests", () => {
  const errs = probs(realManifests(), readFileSync(REAL_CHANGELOG, "utf8"));
  return errs.length === 0 ? true : show(errs);
});
attempt("every committed 2026-10-20 snapshot has an entry whose predecessor is its 2026-10-19 snapshot, with unknown removals 0 or listed", () => {
  const text = readFileSync(REAL_CHANGELOG, "utf8");
  const ids = realManifests().map((m) => m.snapshotId).filter((id) => id.endsWith(".2026-10-20"));
  if (ids.length < 6) return `only ${ids.length} snapshots of 2026-10-20 are committed`;
  for (const id of ids) {
    const at = text.indexOf(`\n## ${id}\n`);
    if (at < 0) return `no entry for ${id}`;
    const body = text.slice(at + 1).split(/\n## /)[0];
    const pred = id.replace(/2026-10-20$/, "2026-10-19");
    if (!body.includes(`- Predecessor: ${pred}\n`)) return `${id}: predecessor line is not ${pred}`;
    if (!/- Removed: \d+ \(publisher-status \d+, our-rule \d+, id-churn \d+, unknown \d+\)/.test(body)) return `${id}: no removal classes`;
    if (!/- Unknown removals: (none|\d+\n(  - \S+: .+\n?)+)/.test(body)) return `${id}: unknown removals neither none nor listed`;
  }
  return true;
});

// ---------------------------------------------------------------- the CLI, on a temp tree
/** A folder holding the fixture manifests as files (the fields the rule reads) and a changelog. */
function tree(manifests, text) {
  const dir = mkdtempSync(path.join(tmpdir(), "gt-changelog-"));
  for (const m of manifests) {
    const [collection, region] = m.snapshotId.split(".");
    mkdirSync(path.join(dir, "manifests", collection), { recursive: true });
    writeFileSync(path.join(dir, "manifests", collection, `${m.snapshotId}.json`), JSON.stringify({ ...m, collection, region: { id: region } }) + "\n");
  }
  const changelog = path.join(dir, "CHANGELOG.md");
  writeFileSync(changelog, text);
  return { manifests: path.join(dir, "manifests"), changelog };
}
const cli = (t) => spawnSync(process.execPath, [VALIDATE, "changelog", "--manifests", t.manifests, "--changelog", t.changelog], { encoding: "utf8" });
attempt("validate.mjs changelog exits 0 on the committed changelog", () => {
  const r = spawnSync(process.execPath, [VALIDATE, "changelog"], { encoding: "utf8" });
  return r.status === 0 && /ok /.test(r.stdout) ? true : `exit ${r.status}: ${r.stdout}${r.stderr}`.slice(0, 600);
});
attempt("validate.mjs changelog fails a new manifest that has no entry (exit 1, names its id) and passes once the entry is added", () => {
  const without = cli(tree(MANIFESTS, doc(E_N20, E_S20, E_O20)));
  const withIt = cli(tree(MANIFESTS, GOOD));
  if (!(without.status === 1 && without.stdout.includes("FAIL") && without.stdout.includes("things.north.2026-10-27"))) return `without the entry: exit ${without.status}: ${without.stdout}${without.stderr}`.slice(0, 600);
  return withIt.status === 0 ? true : `with the entry: exit ${withIt.status}: ${withIt.stdout}${withIt.stderr}`.slice(0, 600);
});
console.log(`\nchangelog: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
