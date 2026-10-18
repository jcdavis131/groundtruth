// Tests for data/schema/validate.mjs. Plain Node, no install.
//   node data/schema/validate.test.mjs
// Every valid fixture must pass; every invalid one must fail with the reason make-invalid.mjs gives it; the
// invalid files must match their source; each snapshot's files must hash to what its manifest says.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, build, fileOf } from "./fixtures/make-invalid.mjs";
import { MANIFEST_SCHEMA, RECORD_SCHEMA, schemaErrors, validateManifest, validateRecord, verifyFiles } from "./validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const list = (dir) => readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

let failed = 0;
let passed = 0;
const check = (ok, msg, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const show = (errs) => errs.map((e) => `${e.code} ${e.path} ${e.message}`).join("; ");

// Valid records: the one picked from each snapshot, and every line of every snapshot.
const validRecords = list(path.join(FIX, "record", "valid"));
check(validRecords.length >= 3, `at least 3 valid record fixtures (${validRecords.length})`);
for (const f of validRecords) {
  const errs = validateRecord(json(path.join(FIX, "record", "valid", f)));
  check(errs.length === 0, `valid record ${f}`, show(errs));
}

// Valid manifests: each snapshot folder, files included.
const snaps = readdirSync(path.join(FIX, "snapshots")).sort();
check(snaps.length >= 3, `at least 3 valid snapshot manifests (${snaps.length})`);
for (const s of snaps) {
  const dir = path.join(FIX, "snapshots", s);
  const m = json(path.join(dir, "manifest.json"));
  const errs = [...validateManifest(m), ...verifyFiles(m, dir)];
  check(errs.length === 0, `valid manifest ${s} and its files`, show(errs));
  check(m.snapshotId === s, `snapshot folder ${s} is named by its snapshot id`);
}

// Invalid fixtures: present, current with their source, and failing for the stated reason.
for (const [kind, cases] of Object.entries(CASES)) {
  check(cases.length >= 6, `at least 6 invalid ${kind} fixtures (${cases.length})`);
  const onDisk = list(path.join(FIX, kind, "invalid"));
  const named = cases.map((c) => `${c.name}.json`).sort();
  check(JSON.stringify(onDisk) === JSON.stringify(named), `${kind}/invalid holds exactly the cases in make-invalid.mjs`, `on disk: ${onDisk.join(", ")}`);
  for (const c of cases) {
    const file = fileOf(kind, c);
    let text = null;
    try {
      text = readFileSync(file, "utf8");
    } catch {}
    check(text === build(kind, c), `${kind}/invalid/${c.name}.json matches make-invalid.mjs (run it to refresh)`);
    if (text === null) continue;
    const errs = kind === "record" ? validateRecord(JSON.parse(text)) : validateManifest(JSON.parse(text));
    const hit = errs.some((e) => e.code === c.expect.code && e.path === c.expect.path);
    check(hit, `invalid ${kind} ${c.name} fails with ${c.expect.code} at ${c.expect.path}`, `got: ${show(errs) || "no errors"}`);
  }
}

// Rules with no fixture file of their own.
const school = json(path.join(FIX, "record", "valid", "nces-public-schools.austin-east.json"));
const [x, y] = school.geometry.coordinates;
const square = [[x - 0.001, y - 0.001], [x + 0.001, y - 0.001], [x + 0.001, y + 0.001], [x - 0.001, y + 0.001]];
check(validateRecord({ ...school, geometry: { type: "Polygon", coordinates: [[...square, square[0]]] } }).length === 0, "a closed polygon ring passes");
check(
  validateRecord({ ...school, geometry: { type: "Polygon", coordinates: [[...square, square[1]]] } }).some((e) => e.code === "ring"),
  "an unclosed polygon ring fails with ring",
);
check(validateRecord({ ...school, details: { ...school.details, x: -9999 } }).some((e) => e.code === "placeholder"), "a -9999 fill value fails with placeholder");
check(validateRecord({ ...school, details: { ...school.details, status: "not reported" } }).length === 0, "a publisher's own coded state (\"not reported\") is a value, not a placeholder");
check(validateRecord({ ...school, snapshotId: school.snapshotId.replace(/\d{4}-\d{2}-\d{2}$/, "2026-02-31") }).some((e) => e.code === "snapshot"), "a snapshot id on a day that doesn't exist fails");

const sdir = path.join(FIX, "snapshots", snaps[0]);
const m0 = json(path.join(sdir, "manifest.json"));
const tampered = { ...m0, files: [{ ...m0.files[0], sha256: "0".repeat(64) }] };
check(verifyFiles(tampered, sdir).some((e) => e.code === "file-sha"), "a file whose bytes don't match the manifest's sha256 fails with file-sha");
check(verifyFiles({ ...m0, files: [{ ...m0.files[0], records: m0.files[0].records + 1 }] }, sdir).some((e) => e.code === "file-records"), "a wrong per-file record count fails with file-records");
check(verifyFiles({ ...m0, snapshotId: "nrhp-listed.elsewhere.2026-10-18" }, sdir).some((e) => e.code === "file-record"), "records from another snapshot fail with file-record");

// The evaluator refuses keywords it does not implement, so a schema can't claim more than is checked.
let threw = false;
try {
  schemaErrors("x", { type: "string", format: "email" });
} catch {
  threw = true;
}
check(threw, "an unsupported schema keyword is an error, not ignored");
for (const [n, s] of [["record", RECORD_SCHEMA], ["manifest", MANIFEST_SCHEMA]])
  check(s.$schema === "https://json-schema.org/draft/2020-12/schema", `${n}.schema.json declares JSON Schema 2020-12`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
