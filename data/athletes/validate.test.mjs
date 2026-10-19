// Tests for data/athletes/validate.mjs. Plain Node, no install.
//   node data/athletes/validate.test.mjs
// The allowlist is pinned here, so widening it is a visible change to this file and to apps/map/docs/PEOPLE.md
// (Athletes), which must list the same fields. Every never-list field fails, at the top and inside a source
// entry, and so does any key not on the allowlist. Never-list values smuggled into allowed fields fail by shape.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWLIST, CITABLE, recordKey, validateAthlete } from "./validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const FIXTURE = path.join(HERE, "fixtures", "athlete.fixture.json");
const valid = () => JSON.parse(readFileSync(FIXTURE, "utf8"));

let failed = 0;
let passed = 0;
const check = (ok, msg, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const show = (errs) => errs.map((e) => `${e.code} ${e.path} ${e.message}`).join("; ") || "no errors";
const fails = (rec, code, at) => {
  const errs = validateAthlete(rec);
  return { ok: errs.some((e) => e.code === code && (at === undefined || e.path === at)), errs };
};
/** The fixture with extra top-level fields. */
const withField = (extra) => ({ ...valid(), ...extra });

// ---------------------------------------------------------------- the allowlist, pinned

const RECORD_FIELDS = [
  "schemaVersion", "id", "name", "league", "team", "teamCity", "arena", "season", "school",
  "birthCity", "birthRegion", "birthCountry", "sources",
];
const SOURCE_FIELDS = ["sourceId", "upstreamId", "url", "retrievedAt", "fields"];
check(JSON.stringify(Object.keys(ALLOWLIST.fields)) === JSON.stringify(RECORD_FIELDS), "the record allowlist is exactly the pinned fields", Object.keys(ALLOWLIST.fields).join(", "));
check(JSON.stringify(Object.keys(ALLOWLIST.sourceFields)) === JSON.stringify(SOURCE_FIELDS), "the source-entry allowlist is exactly the pinned fields", Object.keys(ALLOWLIST.sourceFields).join(", "));
check(JSON.stringify(ALLOWLIST.leagues) === JSON.stringify(["NBA", "NFL"]), "leagues are the pinned v1 leagues, the NBA and the NFL");
for (const league of ["WNBA", "MLB", "NHL", "MLS", "NWSL"]) {
  check(validateAthlete({ ...valid(), league }).some((e) => e.code === "enum" && e.path === "/league"), `league ${league} fails until AD5 is decided (it can roster minors)`);
}
const required = Object.entries(ALLOWLIST.fields).filter(([, s]) => s.required).map(([k]) => k);
check(JSON.stringify(required) === JSON.stringify(["schemaVersion", "id", "name", "league", "sources"]), "required fields are schemaVersion, id, name, league, sources", required.join(", "));

// PEOPLE.md's athlete field table lists the same fields as allowlist.json.
const people = readFileSync(path.join(REPO, "apps/map/docs/PEOPLE.md"), "utf8").replace(/\r\n/g, "\n");
const athletes = people.split("\n## Athletes\n")[1]?.split("\n## ")[0] ?? "";
check(athletes.length > 0, "apps/map/docs/PEOPLE.md has an Athletes section");
const table = athletes.split("### The record\n")[1]?.split("\n### ")[0] ?? "";
const docFields = [...table.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((m) => m[1]);
check(JSON.stringify(docFields) === JSON.stringify(RECORD_FIELDS), "PEOPLE.md's athlete record table lists exactly allowlist.json's fields, in order", docFields.join(", "));

// ---------------------------------------------------------------- the fixture passes

check(validateAthlete(valid()).length === 0, "the fixture is a valid athlete record", show(validateAthlete(valid())));
{
  const r = valid();
  for (const k of ["team", "teamCity", "arena", "season", "school", "birthCity", "birthRegion", "birthCountry"]) delete r[k];
  r.sources = [{ ...r.sources[0], fields: ["name", "league"] }];
  check(validateAthlete(r).length === 0, "a record with only the required fields is valid", show(validateAthlete(r)));
}
{
  const r = valid();
  r.season = "2025";
  check(validateAthlete(r).length === 0, "a single-year season (NFL, MLB) is valid", show(validateAthlete(r)));
}

// ---------------------------------------------------------------- the never-list fails, by name

const NEVER = {
  birthDate: "fixture value",
  birth_date: "fixture value",
  BIRTHDATE: "fixture value",
  dateOfBirth: "fixture value",
  dob: "fixture value",
  born: "fixture value",
  birthYear: "fixture value",
  age: "fixture value",
  ageYears: "fixture value",
  address: "fixture value",
  homeAddress: "fixture value",
  street: "fixture value",
  zip: "fixture value",
  postalCode: "fixture value",
  residence: "fixture value",
  family: "fixture value",
  spouse: "fixture value",
  children: "fixture value",
  mother: "fixture value",
  father: "fixture value",
  parents: "fixture value",
  siblings: "fixture value",
  relatives: "fixture value",
  phone: "fixture value",
  mobile: "fixture value",
  email: "fixture value",
  contact: "fixture value",
  instagram: "fixture value",
  health: "fixture value",
  injury: "fixture value",
  injuries: "fixture value",
  medicalNotes: "fixture value",
  injuryStatus: "fixture value",
  availability: "fixture value",
  height: "fixture value",
  weight: "fixture value",
  birthLatitude: "fixture value",
  birthplaceCoordinates: "fixture value",
};
for (const [k, v] of Object.entries(NEVER)) {
  const { ok, errs } = fails(withField({ [k]: v }), "denied", `/${k}`);
  check(ok, `a top-level ${k} fails with denied`, show(errs));
}
for (const k of ["birthDate", "age", "address", "family", "phone", "email", "injury"]) {
  const r = valid();
  r.sources[0][k] = "fixture value";
  const { ok, errs } = fails(r, "denied", `/sources/0/${k}`);
  check(ok, `${k} inside a source entry fails with denied`, show(errs));
}
for (const v of [null, 0, true, {}, [], { year: "x" }]) {
  const { ok, errs } = fails(withField({ birthDate: v }), "denied", "/birthDate");
  check(ok, `birthDate fails whatever its value (${JSON.stringify(v)})`, show(errs));
}

// ---------------------------------------------------------------- anything else off the allowlist fails

for (const k of ["hometown", "nickname", "jerseyNumber", "position", "college_name", "draftYear", "personId", "notes", "extra", "Name", "TEAM"]) {
  const { errs } = fails(withField({ [k]: "fixture value" }));
  check(errs.some((e) => (e.code === "field" || e.code === "denied") && e.path === `/${k}`), `a top-level ${k} (not on the allowlist) fails`, show(errs));
}
{
  const { ok, errs } = fails(withField({ nickname: "fixture value" }), "field", "/nickname");
  check(ok, "an innocent key off the allowlist fails with field, not denied", show(errs));
}
{
  const r = valid();
  r.sources[0].licence = "fixture value";
  const { ok, errs } = fails(r, "field", "/sources/0/licence");
  check(ok, "a key off the source-entry allowlist fails with field", show(errs));
}
{
  const r = valid();
  r.birthplace = { city: "Fixture Town" };
  const { errs } = fails(r);
  check(errs.some((e) => e.path === "/birthplace"), "a nested birthplace object (not a field) fails", show(errs));
}

// ---------------------------------------------------------------- never-list values in allowed fields fail by shape

const SMUGGLED = [
  ["birthCity", "Fixture Town 1990-04-02"],
  ["birthCity", "Fixture Town, 4/2/1990"],
  ["birthCity", "Fixture Town (born March 4, 1990)"],
  ["birthCity", "Fixture Town 4 March 1990"],
  ["birthCity", "Fixture Town 1990"],
  ["name", "Test Fixture Player (1990)"],
  ["name", "Test Fixture Player, age 27"],
  ["name", "Test Fixture Player, 27 years old"],
  ["school", "Fixture State University, class of 2018"],
  ["birthCity", "123 Fixture Street"],
  ["birthCity", "Fixture Town 12345"],
  ["birthCity", "PO Box 9"],
  ["arena", "Fixture Arena, call 555-010-0199"],
  ["teamCity", "fixture@example.invalid"],
  ["birthCity", "30.2672, -97.7431"],
];
for (const [k, v] of SMUGGLED) {
  const r = valid();
  r[k] = v;
  const { ok, errs } = fails(r, "shape", `/${k}`);
  check(ok, `${k} = ${JSON.stringify(v)} fails with shape`, show(errs));
}

// ---------------------------------------------------------------- the rest of the record rules

for (const k of ["schemaVersion", "id", "name", "league", "sources"]) {
  const r = valid();
  delete r[k];
  const { ok, errs } = fails(r, "required", `/${k}`);
  check(ok, `a record without ${k} fails with required`, show(errs));
}
for (const v of ["", "  ", "N/A", "null", "TBD", "Unknown", "None", "-"]) {
  const r = valid();
  r.school = v;
  const { ok, errs } = fails(r, "placeholder", "/school");
  check(ok, `school = ${JSON.stringify(v)} fails with placeholder`, show(errs));
}
for (const v of [null, 7, ["x"], { name: "x" }]) {
  const r = valid();
  r.team = v;
  const { ok, errs } = fails(r, "type", "/team");
  check(ok, `team = ${JSON.stringify(v)} fails with type`, show(errs));
}
{
  const r = valid();
  r.league = "NCAA";
  check(fails(r, "enum", "/league").ok, "a league off the professional list (NCAA) fails with enum");
}
for (const v of ["2544", "nba 2544", "nba:Test Fixture Player", "NBA:fixture-1"]) {
  const r = valid();
  r.id = v;
  check(fails(r, "pattern", "/id").ok, `id = ${JSON.stringify(v)} fails with pattern`);
}
for (const k of ["teamCity", "arena", "season"]) {
  const r = valid();
  delete r.team;
  r.sources[0].fields = r.sources[0].fields.filter((f) => f !== "team");
  const { ok, errs } = fails(r, "needs", `/${k}`);
  check(ok, `${k} without a team fails with needs`, show(errs));
}
{
  const r = valid();
  r.season = "the 2025 season";
  check(fails(r, "pattern", "/season").ok, "a free-text season fails with pattern");
}

// Every record cites its source.
{
  const r = valid();
  r.sources = [];
  check(fails(r, "type", "/sources").ok, "an empty sources list fails");
}
{
  const r = valid();
  r.sources = [r.sources[0]];
  const { errs } = fails(r);
  const uncited = errs.filter((e) => e.code === "uncited").map((e) => e.path).sort();
  check(JSON.stringify(uncited) === JSON.stringify(["/birthCity", "/birthCountry", "/birthRegion"]), "a field no source cites fails with uncited", uncited.join(", "));
}
{
  const r = valid();
  delete r.school;
  check(fails(r, "uncited", "/sources/0/fields/6").ok, "a source citing a field the record lacks fails with uncited");
}
{
  const r = valid();
  r.sources[1].fields = ["birthDate"];
  check(fails(r, "uncited", "/sources/1/fields/0").ok, "a source citing a field off the allowlist (birthDate) fails");
}
for (const [k, v, code] of [
  ["url", "http://example.invalid/x", "pattern"],
  ["url", "example.invalid/x", "pattern"],
  ["retrievedAt", "2026-10-18", "pattern"],
  ["retrievedAt", "2026-10-18T12:00:00+01:00", "pattern"],
  ["retrievedAt", "2026-02-31T12:00:00Z", "pattern"],
  ["sourceId", "", "placeholder"],
]) {
  const r = valid();
  r.sources[0][k] = v;
  check(fails(r, code, `/sources/0/${k}`).ok, `source ${k} = ${JSON.stringify(v)} fails with ${code}`);
}
for (const k of ["sourceId", "url", "retrievedAt", "fields"]) {
  const r = valid();
  delete r.sources[0][k];
  check(fails(r, "required", `/sources/0/${k}`).ok, `a source entry without ${k} fails with required`);
}
check(validateAthlete([valid()]).some((e) => e.code === "type"), "an array is not a record");
check(JSON.stringify(CITABLE) === JSON.stringify(RECORD_FIELDS.filter((k) => !["schemaVersion", "id", "sources"].includes(k))), "every field but schemaVersion, id and sources must be cited");

// ---------------------------------------------------------------- the command line

const cli = (...files) => spawnSync(process.execPath, [path.join(HERE, "validate.mjs"), ...files], { encoding: "utf8" });
{
  const res = cli(FIXTURE);
  check(res.status === 0, "validate.mjs exits 0 on the fixture", res.stdout + res.stderr);
}
{
  const dir = mkdtempSync(path.join(tmpdir(), "athletes-"));
  try {
    const good = JSON.stringify(valid());
    const bad = JSON.stringify({ ...valid(), id: "nba:fixture-2", birthDate: "fixture value" });
    const jsonl = path.join(dir, "records.jsonl");
    writeFileSync(jsonl, `${good}\n${bad}\n`);
    const res = cli(jsonl);
    check(res.status === 1 && /records\.jsonl:2: denied \/birthDate/.test(res.stdout), "validate.mjs exits 1 on a JSONL file with a birth date and names the line", res.stdout);
    const dup = path.join(dir, "dup.jsonl");
    writeFileSync(dup, `${good}\n${good}\n`);
    const res2 = cli(dup);
    check(res2.status === 1 && /duplicate/.test(res2.stdout), "validate.mjs exits 1 on a repeated id, season and team", res2.stdout);
    const nextSeason = JSON.stringify({ ...valid(), season: "2024-25" });
    const traded = JSON.stringify({ ...valid(), team: "Fixture Town Traders" });
    const grain = path.join(dir, "grain.jsonl");
    writeFileSync(grain, `${good}\n${nextSeason}\n${traded}\n`);
    const res3 = cli(grain);
    check(res3.status === 0, "validate.mjs accepts one id in two seasons, and in two teams in one season", res3.stdout);
    const noTeam = { ...valid() };
    for (const k of ["team", "teamCity", "arena", "season"]) delete noTeam[k];
    noTeam.sources = noTeam.sources.map((s) => ({ ...s, fields: s.fields.filter((f) => !["team", "teamCity", "arena", "season"].includes(f)) }));
    const bare = path.join(dir, "bare.jsonl");
    writeFileSync(bare, `${JSON.stringify(noTeam)}\n${JSON.stringify(noTeam)}\n`);
    const res4 = cli(bare);
    check(res4.status === 1 && /duplicate/.test(res4.stdout), "validate.mjs exits 1 on a repeated id with no season or team", res4.stdout);
    check(recordKey(valid()) !== recordKey({ ...valid(), season: "2024-25" }) && recordKey(valid()) !== recordKey({ ...valid(), team: "x" }), "recordKey is id, season and team");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  check(cli().status === 2, "validate.mjs exits 2 with no files");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
