// Tests for data/schema/validate.mjs. Plain Node, no install.
//   node data/schema/validate.test.mjs
// Every valid fixture must pass; every invalid one must fail with the reason make-invalid.mjs gives it; the
// invalid files must match their source; each snapshot's files must hash to what its manifest says.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, build, fileOf } from "./fixtures/make-invalid.mjs";
import { MANIFEST_SCHEMA, RECORD_SCHEMA, damOwnerProblem, schemaErrors, validateManifest, validateRecord, verifyFiles } from "./validate.mjs";

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

// Dams: a name is allowed only on a dam eye names; a label by id never says public-name; published name never rides along.
const privateDam = json(path.join(FIX, "record", "valid", "nid-dams.texas-private.json"));
const publicDam = json(path.join(FIX, "record", "valid", "nid-dams.texas-public.json"));
check(privateDam.nameRule === "label-by-id" && privateDam.name === `Dam ${privateDam.details["NID id"]}` && privateDam.details["owner type"] === "Private", "the private dam fixture is labelled by its NID id");
check(publicDam.nameRule === "public-name" && publicDam.details["owner type"] !== "Private", "the public dam fixture keeps its published name");
check(
  validateRecord({ ...publicDam, nameRule: "label-by-id", text: publicDam.text.replace("; name: Bardwell Dam", "") }).length === 0,
  "a dam may always be labelled by id (its name out of the record text)",
);
check(
  validateRecord({ ...publicDam, name: `Dam ${publicDam.details["NID id"]}` }).some((e) => e.code === "public-name"),
  "a dam named \"Dam <NIDID>\" that says public-name fails with public-name, whatever its owner type",
);
check(validateRecord({ ...publicDam, name: "Dam Site 7" }).length === 0, "a published name that starts with \"Dam\" but is not an NID id is not a label by id");
// A dam keeps its name only under public owner types (eye's damIsNamed): every non-answer is labelled by id.
const withOwners = (primary, list) => {
  const d = { ...publicDam.details };
  if (primary === undefined) delete d["owner type"];
  else d["owner type"] = primary;
  if (list === undefined) delete d["owner types"];
  else d["owner types"] = list;
  return { ...publicDam, details: d };
};
for (const t of ["Federal", "State", "Local Government", "Public Utility", "Tribal Government"])
  check(validateRecord(withOwners(t, t)).length === 0, `a ${t} dam may keep its published name`);
check(validateRecord(withOwners("State", "Local Government, State")).length === 0, "a dam whose owner types are all public may keep its name");
check(validateRecord(withOwners("Federal")).some((e) => e.code === "public-name"), "no owner-types list fails closed: it can't show every owner is public");

// One case table for all three copies of the dam naming rule (eye's damIsNamed, this validator, the builder's
// dam_name_rule): every owner pair NID publishes, plus edge cases. Each copy must agree with "named" on every case.
const damCases = json(path.join(FIX, "dam-owner-cases.json"));
for (const c of damCases.cases) {
  const details = { "owner type": c.primary };
  if (!c.absent) details["owner types"] = c.ownerTypes;
  check((damOwnerProblem(details) === null) === c.named, `dam rule parity: ${JSON.stringify(c.primary)} / ${c.absent ? "(no owner types)" : JSON.stringify(c.ownerTypes)} is ${c.named ? "named" : "labelled by id"}`);
}
check(damCases.cases.filter((c) => c.from === "NID").reduce((n, c) => n + c.dams, 0) === damCases.dams, "dam case table: the NID pairs sum to its dam count");
for (const [primary, list, why] of [
  ["Not Listed", undefined, "Not Listed"],
  ["not listed", "Not Listed", "Not Listed, any case"],
  [undefined, undefined, "no owner type"],
  ["Private", undefined, "Private"],
  ["Unknown", undefined, "a value NID has never used"],
  ["Local Government", "Local Government, Private", "Private second in OWNER_TYPES"],
  ["Local Government", "Private", "OWNER_TYPES contradicting the primary"],
  ["Federal", "", "an empty OWNER_TYPES"],
  ["State", "State, Not Listed", "Not Listed in OWNER_TYPES"],
])
  check(
    validateRecord(withOwners(primary, list)).some((e) => e.code === "public-name" && e.path === "/nameRule"),
    `a dam that says public-name fails with public-name under ${why}`,
  );
check(validateRecord({ ...withOwners("Not Listed"), nameRule: "label-by-id", name: `Dam ${publicDam.details["NID id"]}`, text: publicDam.text.replace("; name: Bardwell Dam", "") }).length === 0, "a Not Listed dam labelled by id, its name out of the text, is valid");
check(
  validateRecord({ ...publicDam, nameRule: "label-by-id", name: `Dam ${publicDam.details["NID id"]}` }).some((e) => e.code === "public-name" && e.path === "/text"),
  "a dam labelled by id whose record text keeps \"name: <published name>\" fails with public-name at /text",
);
check(
  validateRecord({ ...school, collection: "padus-units", snapshotId: school.snapshotId.replace(/^[^.]+/, "padus-units"), name: "Conservation Easement · PAD-US 41234" }).some(
    (e) => e.code === "public-name" && e.path === "/nameRule",
  ),
  "a PAD-US unit labelled by id that says public-name fails with public-name",
);
check(
  validateRecord({ ...school, details: { ...school.details, "published name": "x" } }).length === 0,
  "\"published name\" is withheld only where a collection lists it (not schools)",
);

const sdir = path.join(FIX, "snapshots", snaps[0]);
const m0 = json(path.join(sdir, "manifest.json"));
const tampered = { ...m0, files: [{ ...m0.files[0], sha256: "0".repeat(64) }] };
check(verifyFiles(tampered, sdir).some((e) => e.code === "file-sha"), "a file whose bytes don't match the manifest's sha256 fails with file-sha");
check(verifyFiles({ ...m0, files: [{ ...m0.files[0], records: m0.files[0].records + 1 }] }, sdir).some((e) => e.code === "file-records"), "a wrong per-file record count fails with file-records");
check(verifyFiles({ ...m0, snapshotId: "nrhp-listed.elsewhere.2026-10-18" }, sdir).some((e) => e.code === "file-record"), "records from another snapshot fail with file-record");

// GeoParquet files (data/pipeline) are checked by bytes, sha256 and the PAR1 magic; a jsonl file posing as one fails.
const pq = Buffer.from("PAR1 not a real footer PAR1", "latin1");
const pqDir = mkdtempSync(path.join(tmpdir(), "gt-pq-"));
writeFileSync(path.join(pqDir, "records.parquet"), pq);
const pqFile = { path: "records.parquet", format: "geoparquet", sha256: createHash("sha256").update(pq).digest("hex"), bytes: pq.length, records: m0.recordCount };
const pqManifest = { ...m0, files: [pqFile] };
check(validateManifest(pqManifest).length === 0 && verifyFiles(pqManifest, pqDir).length === 0, "a geoparquet file whose bytes and sha256 match passes");
check(verifyFiles({ ...pqManifest, files: [{ ...pqFile, sha256: "0".repeat(64) }] }, pqDir).some((e) => e.code === "file-sha"), "a tampered geoparquet file fails with file-sha");
check(verifyFiles({ ...m0, files: [{ ...m0.files[0], format: "geoparquet" }] }, sdir).some((e) => e.code === "file-format"), "a jsonl file listed as geoparquet fails with file-format");
const polyRegion = { ...m0.region, rule: "point-in-polygon" };
check(validateManifest({ ...m0, region: polyRegion }).length === 0, "region rule point-in-polygon is accepted");
check(validateManifest({ ...m0, requests: [...m0.requests, { ...m0.requests[0], purpose: "region" }] }).length === 0, "request purpose region is accepted");
check(validateManifest({ ...m0, region: { ...m0.region, rule: "inside-texas" } }).some((e) => e.code === "enum"), "an unknown region rule fails with enum");

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
