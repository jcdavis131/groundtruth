// Tests for data/schema/validate.mjs. Plain Node, no install.
//   node data/schema/validate.test.mjs
// Every valid fixture must pass; every invalid one must fail with the reason make-invalid.mjs gives it; the
// invalid files must match their source; each snapshot's files must hash to what its manifest says.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, build, fileOf, goodJoins } from "./fixtures/make-invalid.mjs";
import { LOCK_PATH, MANIFESTS_DIR, lockErrors, writeLock } from "./lock.mjs";
import { DETAILS_KEY, embeddableFor, withEmbeddable } from "./embeddable.mjs";
import { CITABLE } from "../athletes/validate.mjs";
import { MANIFEST_SCHEMA, PUBLIC_NAME_COLLECTIONS, RECORD_SCHEMA, damOwnerProblem, schemaErrors, validateManifest, validateRecord, verifyFiles } from "./validate.mjs";

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
    const doc = JSON.parse(text);
    const errs = kind === "record" ? validateRecord(doc) : [...validateManifest(doc), ...(c.withFiles ? verifyFiles(doc, path.dirname(path.join(FIX, c.base))) : [])];
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

// embeddableFields and embeddableName: derived from eye's embedFields.ts, carried by every snapshot this repo
// holds, and failing on drift. A manifest from before 2026-10-19 without them is still manifest/1 valid.
const committed = path.join(HERE, "..", "manifests");
const holders = [
  ...snaps.map((s) => path.join(FIX, "snapshots", s, "manifest.json")),
  ...readdirSync(committed, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).flatMap((c) => list(path.join(committed, c)).map((f) => path.join(committed, c, f))),
];
check(holders.length >= 6, `at least 6 manifests carry the embeddable fields (${holders.length})`);
for (const p of holders) {
  const m = json(p);
  const rel = path.relative(path.join(HERE, "..", ".."), p).replaceAll("\\", "/");
  let want = null;
  try {
    want = embeddableFor(m.collection);
  } catch (e) {
    check(false, `${rel}: eye's embedFields.ts derives its embeddable fields`, e.message);
    continue;
  }
  check(JSON.stringify(m.embeddableFields) === JSON.stringify(want.embeddableFields), `${rel} embeddableFields match embedFields.ts`, `has ${JSON.stringify(m.embeddableFields)}, derived ${JSON.stringify(want.embeddableFields)}`);
  check(m.embeddableName === want.embeddableName, `${rel} embeddableName matches PUBLIC_NAME_RULE`, `has ${JSON.stringify(m.embeddableName)}, derived ${want.embeddableName}`);
  check(readFileSync(p, "utf8") === withEmbeddable(readFileSync(p, "utf8")), `${rel} is what embeddable.mjs --backfill writes`);
}
const { embeddableFields: _f, embeddableName: _n, ...bare } = m0;
check(validateManifest(bare).length === 0, "a manifest without embeddableFields and embeddableName is still valid manifest/1");
check(validateManifest({ ...bare, embeddableFields: m0.embeddableFields }).some((e) => e.code === "embeddable"), "embeddableFields without embeddableName fails with embeddable");
check(
  validateManifest({ ...m0, embeddableFields: [...m0.embeddableFields].reverse() }).some((e) => e.code === "embeddable" && e.path === "/embeddableFields"),
  "embeddableFields in another order than EMBED_TEXT's fails with embeddable",
);

// Every EMBED_TEXT field of a snapshot collection is mapped, every derived key is a key the builder writes, and
// what may never be embedded (the street address, owners, published names, ids) never is.
const fixtureDetails = {};
for (const f of validRecords) {
  const r = json(path.join(FIX, "record", "valid", f));
  (fixtureDetails[r.collection] ??= new Set());
  for (const k of Object.keys(r.details)) fixtureDetails[r.collection].add(k);
}
for (const c of Object.keys(DETAILS_KEY)) {
  let derived;
  try {
    derived = embeddableFor(c);
  } catch (e) {
    check(false, `${c}: DETAILS_KEY covers eye's EMBED_TEXT`, e.message);
    continue;
  }
  const { embeddableFields: keys, embeddableName: rule } = derived;
  check(keys.length > 0, `${c}: at least one details key is embeddable`);
  for (const k of ["address", "owner type", "owner types", "published name", "property name (as NPS lists it)", "NID id", "NCES school id", "nris refnum", "district"])
    check(!keys.includes(k), `${c}: ${JSON.stringify(k)} is never embeddable`);
  if (fixtureDetails[c]) {
    const unseen = keys.filter((k) => !fixtureDetails[c].has(k) && k !== "national historic landmark" && k !== "condition assessment");
    check(unseen.length === 0, `${c}: every embeddable key appears in a valid record fixture's details`, `not seen: ${unseen.join(", ")}`);
  }
  check((rule === "when-nameRule-public-name") === PUBLIC_NAME_COLLECTIONS.has(c), `${c}: embeddableName agrees with validate.mjs's public-name list`);
}
check(Object.keys(DETAILS_KEY).sort().join() === ["nces-public-schools", "nid-dams", "nrhp-listed"].join(), "DETAILS_KEY covers the collections data/pipeline/cards.py builds");
let bit = null;
try {
  embeddableFor("hifld-hospitals");
} catch (e) {
  bit = e.message;
}
check(bit !== null && /DETAILS_KEY/.test(bit), "a collection with no DETAILS_KEY table can't be given embeddable fields", bit ?? "no error");

// The joins block and gapItems (added 2026-10-20): a consistent one passes; the 2026-10-19 manifests, which carry
// neither, still pass; every snapshot built on or after 2026-10-20 carries both.
const gj = goodJoins(m0, `snapshots/${snaps[0]}/manifest.json`);
check(validateManifest({ ...m0, joins: [gj] }).length === 0 && verifyFiles({ ...m0, joins: [gj] }, sdir).length === 0, "a consistent joins block passes, with its files");
check(validateManifest({ ...m0, joins: [{ ...gj, methods: { ...gj.methods, "point-in-polygon": 1 } }] }).some((e) => e.code === "joins" && e.path === "/joins/0/methods"), "methods that don't add up to placed fail with joins");
check(validateManifest({ ...m0, joins: [{ ...gj, crossCheck: { ...gj.crossCheck, disagree: 1 } }] }).some((e) => e.code === "joins"), "a cross-check disagree count that isn't the listed disagreements fails with joins");
check(validateManifest({ ...m0, joins: [{ ...gj, methods: { "point-in-polygon": 0, "source-field": 0, "name-lookup": 0, "guess": 1 } }] }).some((e) => e.code === "additional"), "a place method outside the enum fails in the joins methods");
check(verifyFiles({ ...m0, joins: [{ ...gj, placed: 1, unplaced: gj.unplaced.slice(1), methods: { ...gj.methods, "name-lookup": 1 } }] }, sdir).some((e) => e.code === "joins"), "a placed count the records don't bear out fails with joins (files)");
const gapOk = { ...m0, recordCount: m0.recordCount, publisherCount: { ...m0.publisherCount, value: m0.recordCount + 3, gap: "x", gapItems: [{ id: "a:1", reason: "removed" }], duplicateRows: 2 } };
check(validateManifest(gapOk).length === 0, "gapItems plus duplicateRows that add up to the publisher's count pass");
check(validateManifest({ ...gapOk, publisherCount: { ...gapOk.publisherCount, duplicateRows: 1 } }).some((e) => e.code === "gap" && e.path === "/publisherCount/gapItems"), "duplicateRows that don't add up fail with gap");
check(validateManifest({ ...gapOk, publisherCount: { ...gapOk.publisherCount, gapItems: [{ id: "a:1", reason: "x" }, { id: "a:1", reason: "x" }], duplicateRows: 1 } }).some((e) => e.code === "gap"), "a repeated gap item id fails with gap");
for (const p of holders) {
  const m = json(p);
  const day = m.snapshotId.split(".")[2];
  const rel = path.relative(path.join(HERE, "..", ".."), p).replaceAll("\\", "/");
  if (day >= "2026-10-20" && rel.startsWith("data/manifests/")) {
    check(Array.isArray(m.joins) && m.joins.length === 1, `${rel} carries a joins block`);
    check(Array.isArray(m.publisherCount.gapItems), `${rel} carries gapItems`);
    check(validateManifest(m).length === 0, `${rel} is valid`, show(validateManifest(m)));
    const j = m.joins?.[0];
    if (j) check(j.placed + j.unplaced.length === m.recordCount && j.unplaced.every((u) => u.reason.length > 0), `${rel}: placed + unplaced = recordCount, and every unplaced record has a reason`);
  }
}

// The snapshot lock (data/manifests/LOCK.json): snapshotId -> sha256 of the committed manifest. Flip one byte of a
// copied manifest and lock --check fails by code lock; a missing or untracked manifest fails too; --write adds new
// ids and refuses to change an existing one.
{
  const realLock = json(LOCK_PATH);
  const ids = Object.keys(realLock.snapshots);
  const realErrs = lockErrors(MANIFESTS_DIR, realLock);
  check(realErrs.length === 0 && ids.length >= 12, "the committed LOCK.json holds every committed manifest and they all match", show(realErrs));
  const tmpM = mkdtempSync(path.join(tmpdir(), "gt-lock-"));
  const src = (id) => path.join(MANIFESTS_DIR, id.split(".")[0], `${id}.json`);
  const dst = (id) => path.join(tmpM, id.split(".")[0], `${id}.json`);
  for (const id of ids) {
    mkdirSync(path.dirname(dst(id)), { recursive: true });
    copyFileSync(src(id), dst(id));
  }
  check(lockErrors(tmpM, realLock).length === 0, "a faithful copy of the manifests passes lock --check");
  const [first, second] = ids;
  const good = readFileSync(dst(first));
  const flippedBytes = Buffer.from(good);
  flippedBytes[flippedBytes.length - 2] ^= 1; // one bit of one byte
  writeFileSync(dst(first), flippedBytes);
  const flipped = lockErrors(tmpM, realLock);
  check(flipped.length === 1 && flipped[0].code === "lock" && flipped[0].message.includes(first), "one flipped byte in a manifest fails with code lock, naming the snapshot", show(flipped));
  writeFileSync(dst(first), good);
  unlinkSync(dst(second));
  check(lockErrors(tmpM, realLock).some((e) => e.code === "lock" && /missing/.test(e.message) && e.message.includes(second)), "a locked manifest that is missing fails with code lock");
  copyFileSync(src(second), dst(second));
  const extra = path.join(tmpM, "nid-dams", "nid-dams.ohio.2026-10-21.json");
  writeFileSync(extra, '{"snapshotId":"nid-dams.ohio.2026-10-21"}\n');
  check(lockErrors(tmpM, realLock).some((e) => e.code === "lock" && /untracked/.test(e.message) && e.message.includes("nid-dams.ohio.2026-10-21")), "a manifest the lock doesn't list fails with code lock (untracked)");
  // --write adds the new id, keeps the old ones, and refuses to change an existing id's sha.
  const lockFile = path.join(tmpM, "LOCK.json");
  writeFileSync(lockFile, JSON.stringify(realLock, null, 2) + "\n");
  const wrote = writeLock(tmpM, lockFile);
  check(wrote.added.length === 1 && wrote.added[0] === "nid-dams.ohio.2026-10-21" && lockErrors(tmpM, json(lockFile)).length === 0, "--write adds a new id and the lock then passes");
  const before = readFileSync(lockFile, "utf8");
  writeFileSync(dst(first), flippedBytes);
  let refused = "";
  try {
    writeLock(tmpM, lockFile);
  } catch (e) {
    refused = String(e.message);
  }
  check(/refus/.test(refused) && refused.includes(first) && readFileSync(lockFile, "utf8") === before, "--write refuses to change an existing id's sha, and leaves the lock untouched", refused);
}

// Person-typed collections (person-fields.json, code person-fields): the no-private-individuals rule as a test.
// A record of a collection declared person-typed fails on a never-list field name anywhere in it, and on a details
// key outside the allowed list; a record of any other collection is not read by this rule. The fixture is fictional.
{
  let pf = null;
  try {
    pf = json(path.join(HERE, "person-fields.json"));
  } catch (e) {
    check(false, "person-fields.json is readable", e.message);
  }
  const athlete = json(path.join(FIX, "person", "athletes.fixture.json"));
  const personHits = (errs, p) => errs.filter((e) => e.code === "person-fields" && (p === undefined || e.path === p));
  const withDetails = (d) => ({ ...athlete, details: d });
  const spaced = (k) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

  check(athlete.collection === "athletes" && athlete.nameRule === "label-by-id", "the athlete fixture is a label-by-id record of the athletes collection");
  check(validateRecord(athlete).length === 0, "a person record with only allowed fields passes", show(validateRecord(athlete)));

  // The three invalid fixtures (make-invalid.mjs) are checked above; these are the same rule on spellings and neighbours.
  for (const k of [
    "birth_date", "birthDate", "BIRTH-DATE", "Birth Date", "dateOfBirth", "date_of_birth", "dob", "DOB", "birthday",
    "home address", "homeAddress", "address", "street", "phone", "phone_number", "e-mail", "email", "SSN", "spouseName", "spouse",
    "parents", "parent", "child", "children", "family", "contact", "health", "age", "home",
  ]) {
    const errs = validateRecord(withDetails({ ...athlete.details, [k]: "x" }));
    check(personHits(errs, `/details/${k}`).some((e) => /never-list/.test(e.message)), `a person record with a "${k}" detail fails with person-fields, on the never-list`, `got: ${show(errs) || "no errors"}`);
  }
  {
    const errs = validateRecord(withDetails({ ...athlete.details, mascot: "x" }));
    check(personHits(errs, "/details/mascot").some((e) => /not on the allowed list/.test(e.message) && !/never-list/.test(e.message)), "a person record with a detail outside the allowed list fails with person-fields, not as a never-list name", `got: ${show(errs) || "no errors"}`);
  }
  // Whole words, so a harmless neighbour is off the list but not called a never-list name.
  for (const k of ["stage", "adobe", "classname", "agent"]) {
    const errs = personHits(validateRecord(withDetails({ ...athlete.details, [k]: "x" })), `/details/${k}`);
    check(errs.length === 1 && !/never-list/.test(errs[0].message), `"${k}" is off the allowed list but is not mistaken for a never-list name`, show(errs) || "no person-fields error");
  }
  // A never-list name nested inside a detail is found too (the schema also refuses the object).
  check(
    personHits(validateRecord(withDetails({ ...athlete.details, contact: { phone: "x" } })), "/details/contact/phone").some((e) => /never-list/.test(e.message)),
    "a never-list name nested inside a detail fails with person-fields at its own path",
  );
  // A never-list field at the top level fails by code person-fields as well as the schema's 'additional'.
  {
    const errs = validateRecord({ ...athlete, birth_date: "2000-01-01" });
    check(personHits(errs, "/birth_date").length === 1 && errs.some((e) => e.code === "additional" && e.path === "/birth_date"), "a top-level birth_date fails with person-fields and with additional", show(errs) || "no errors");
  }

  // A record of a collection that is not person-typed is not read by this rule: a school's street address is a place's.
  const schoolErrs = validateRecord(school);
  check(typeof school.details.address === "string" && schoolErrs.length === 0, "a non-person record with an address detail passes", show(schoolErrs));
  check(
    personHits(validateRecord({ ...school, collection: "athletes", snapshotId: school.snapshotId.replace(/^[^.]+/, "athletes") }), "/details/address").length === 1,
    "the same address detail on a record of the person-typed athletes collection fails with person-fields",
  );

  // Through a snapshot's files and from the command line.
  {
    const bad = json(path.join(FIX, "record", "invalid", "person-birth-date.json"));
    const body = `${JSON.stringify(bad)}\n`;
    const dir = mkdtempSync(path.join(tmpdir(), "gt-person-"));
    writeFileSync(path.join(dir, "records.jsonl"), body);
    const mp = { ...m0, snapshotId: bad.snapshotId, collection: "athletes", recordCount: 1, files: [{ path: "records.jsonl", format: "jsonl", sha256: createHash("sha256").update(body).digest("hex"), bytes: Buffer.byteLength(body), records: 1 }] };
    check(verifyFiles(mp, dir).some((e) => e.code === "file-record" && /\/details\/birth_date: person-fields/.test(e.message)), "a snapshot file holding a person record with a birth_date fails with file-record naming person-fields");
    const cli = spawnSync(process.execPath, [path.join(HERE, "validate.mjs"), "record", path.join(FIX, "record", "invalid", "person-birth-date.json")], { encoding: "utf8" });
    check(cli.status === 1 && /person-fields \/details\/birth_date/.test(cli.stdout), "validate.mjs record on the birth_date fixture exits 1 and prints person-fields", `exit ${cli.status}: ${cli.stdout}`);
    const cliOk = spawnSync(process.execPath, [path.join(HERE, "validate.mjs"), "record", path.join(FIX, "person", "athletes.fixture.json")], { encoding: "utf8" });
    check(cliOk.status === 0, "validate.mjs record on the allowed-fields fixture exits 0", `exit ${cliOk.status}: ${cliOk.stdout}`);
  }

  // The list itself.
  if (pf) {
    const squash = (k) => spaced(k).split(/[^a-z0-9]+/).filter(Boolean).join("");
    check(pf.schemaVersion === "person-fields/1", "person-fields.json is person-fields/1");
    check(Array.isArray(pf.personTypedCollections) && pf.personTypedCollections.includes("athletes"), "athletes is a declared person-typed collection");
    check(pf.personTypedCollections.every((c) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c)) && new Set(pf.personTypedCollections).size === pf.personTypedCollections.length, "person-typed collections are distinct slugs");
    check(Array.isArray(pf.allowedFields) && pf.allowedFields.length > 0 && new Set(pf.allowedFields.map(squash)).size === pf.allowedFields.length, "the allowed fields are distinct names");
    check(Array.isArray(pf.forbiddenPatterns) && pf.forbiddenPatterns.length > 0 && new Set(pf.forbiddenPatterns.map(squash)).size === pf.forbiddenPatterns.length, "the never-list patterns are distinct");
    for (const p of ["dob", "birth_date", "birthdate", "dateofbirth", "date_of_birth", "address", "street", "phone", "email", "ssn", "spouse", "parent", "child", "family", "home"])
      check(pf.forbiddenPatterns.includes(p), `the never-list names ${p}`);
    // Every allowed name is accepted as written, spaced or in snake case, so none of them is a never-list name.
    for (const k of pf.allowedFields ?? [])
      for (const v of new Set([k, spaced(k), spaced(k).replaceAll(" ", "_")])) {
        const errs = personHits(validateRecord(withDetails({ [v]: "x" })));
        check(errs.length === 0, `the allowed field ${JSON.stringify(v)} is accepted on a person record`, show(errs));
      }
    // Drift: the allowed list is the athlete/1 allowlist's record fields (data/athletes/allowlist.json), no more and no fewer.
    check(
      JSON.stringify([...pf.allowedFields].sort()) === JSON.stringify([...CITABLE].sort()),
      "the allowed fields equal data/athletes/allowlist.json's record fields",
      `person-fields.json: ${[...pf.allowedFields].sort().join(", ")}; allowlist.json: ${[...CITABLE].sort().join(", ")}`,
    );
    // The exception is quoted from AGENTS.md word for word, so a reworded rule shows up here.
    const agents = readFileSync(path.join(HERE, "..", "..", "AGENTS.md"), "utf8");
    check(typeof pf.exception === "string" && pf.exception.length > 80 && agents.includes(pf.exception), "the quoted exception is a substring of AGENTS.md");
    check(/never a birth date, age, address, family, contact or health/.test(pf.exception ?? ""), "the quoted exception carries the never-list sentence");
  }
}

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

// The cadence table, the weekly freshness line and the changelog rule each have a test file of their own. They run
// from here so the data.yml "schema and fixture tests" step covers them, the way scripts/guard.test.mjs runs
// scripts/prereg-check.test.mjs. A failing file shows its FAIL lines below.
for (const file of ["cadence.test.mjs", "freshness.test.mjs", "changelog.test.mjs"]) {
  const r = spawnSync(process.execPath, [path.join(HERE, file)], { encoding: "utf8" });
  const fails = `${r.stdout}${r.stderr}`.split("\n").filter((l) => /^FAIL|^\s+\S|passed, \d+ failed/.test(l) && !/ExperimentalWarning|trace-warnings/.test(l));
  check(r.status === 0, `${file} passes`, fails.slice(0, 60).join("\n      "));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
