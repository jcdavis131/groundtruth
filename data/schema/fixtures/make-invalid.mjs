// The invalid fixtures: each is a valid fixture with one thing broken, and the reason the validator must give.
// This file is their source; the .json files under record/invalid/ and manifest/invalid/ are its output, and
// validate.test.mjs fails if they drift from it.
//
//   node data/schema/fixtures/make-invalid.mjs      rewrite record/invalid/ and manifest/invalid/
//
// `expect` is {code, path}: the validator must report a problem with that code at that path (other problems may
// come with it).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(path.join(HERE, p), "utf8"));
const SCHOOL = "record/valid/nces-public-schools.austin-east.json";
const HISTORIC = "record/valid/nrhp-listed.austin-east.json";
const PRIVATE_DAM = "record/valid/nid-dams.texas-private.json";
const PUBLIC_DAM = "record/valid/nid-dams.texas-public.json";
const ATHLETE = "person/athletes.fixture.json"; // fictional, in a person-typed collection (person-fields.json)
const MANIFEST = "snapshots/nrhp-listed.austin-east.2026-10-18/manifest.json";

/**
 * A joins block that is consistent with the fixture snapshot MANIFEST names: every record placed or listed, the
 * methods adding up. The invalid cases below break one thing in it. (The fixture records carry no countyFips, so
 * every one is unplaced here, with the reason the builder would give.)
 */
export function goodJoins(m, base = MANIFEST) {
  const recs = readFileSync(path.join(HERE, path.dirname(base), m.files[0].path), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const placed = recs.filter((r) => r.place.countyFips);
  const unplaced = recs.filter((r) => !r.place.countyFips).map((r) => ({ id: r.id, reason: "no county polygon contains the point (TIGER/Line 2025); publisher county string " + JSON.stringify(r.details.county ?? null) }));
  const methods = { "point-in-polygon": 0, "source-field": 0, "name-lookup": 0 };
  for (const r of placed) methods[r.place.method]++;
  return {
    field: "place.countyFips",
    boundary: {
      publisher: "U.S. Census Bureau",
      product: "TIGER/Line 2025 COUNTY",
      vintage: "2025",
      url: "https://www2.census.gov/geo/tiger/TIGER2025/COUNTY/tl_2025_us_county.zip",
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      retrievedAt: "2026-10-20T06:00:00.000Z",
    },
    methods,
    crossCheck: { source: "details.county (publisher's county name, joined by the countyJoin name rule)", agree: 0, disagree: 0, unchecked: recs.length },
    placed: placed.length,
    unplaced,
    disagreements: [],
  };
}

export const CASES = {
  record: [
    { name: "missing-id", base: SCHOOL, expect: { code: "required", path: "/id" }, mutate: (r) => void delete r.id },
    { name: "placeholder-value", base: SCHOOL, expect: { code: "placeholder", path: "/details/enrollment" }, mutate: (r) => void (r.details.enrollment = "N/A") },
    {
      name: "lat-lon-swapped",
      base: SCHOOL,
      expect: { code: "range", path: "/geometry/coordinates/1" },
      mutate: (r) => void (r.geometry.coordinates = [r.geometry.coordinates[1], r.geometry.coordinates[0]]),
    },
    { name: "missing-provenance", base: SCHOOL, expect: { code: "required", path: "/provenance" }, mutate: (r) => void delete r.provenance },
    { name: "missing-retrieved-at", base: HISTORIC, expect: { code: "required", path: "/provenance/retrievedAt" }, mutate: (r) => void delete r.provenance.retrievedAt },
    { name: "null-detail", base: SCHOOL, expect: { code: "type", path: "/details/virtual" }, mutate: (r) => void (r.details.virtual = null) },
    { name: "text-literal-null", base: HISTORIC, expect: { code: "pattern", path: "/text" }, mutate: (r) => void (r.text = "null") },
    { name: "public-name-not-allowed", base: HISTORIC, expect: { code: "public-name", path: "/nameRule" }, mutate: (r) => void (r.nameRule = "public-name") },
    // A private dam labelled "Dam <NIDID>" that still says public-name (PR #12's first build did this for every dam).
    { name: "label-by-id-name-says-public", base: PRIVATE_DAM, expect: { code: "public-name", path: "/nameRule" }, mutate: (r) => void (r.nameRule = "public-name") },
    // A private dam whose owner-named published name rides along in details.
    {
      name: "dam-published-name-carried",
      base: PRIVATE_DAM,
      expect: { code: "withheld", path: "/details/published name" },
      mutate: (r) => void (r.details["published name"] = "Cj Gerlach Dam"),
    },
    // A Not Listed dam that keeps its published name (eye named these before 2026-10-19; TX09788 is a real one).
    {
      name: "not-listed-dam-says-public",
      base: PUBLIC_DAM,
      expect: { code: "public-name", path: "/nameRule" },
      mutate: (r) => void (r.details["owner type"] = "Not Listed"),
    },
    // A dam that is Local Government first and Private too in NID's OWNER_TYPES (104 nationally, 33 in Texas).
    {
      name: "mixed-owner-dam-says-public",
      base: PUBLIC_DAM,
      expect: { code: "public-name", path: "/nameRule" },
      mutate: (r) => void Object.assign(r.details, { "owner type": "Local Government", "owner types": "Local Government, Private" }),
    },
    // A public-looking dam with no owner-types list (a stale tile): it can't show every owner is public.
    {
      name: "no-owner-types-dam-says-public",
      base: PUBLIC_DAM,
      expect: { code: "public-name", path: "/nameRule" },
      mutate: (r) => void delete r.details["owner types"],
    },
    // A dam labelled by id whose record text still names it (eye's text for a Not Listed dam before 2026-10-19).
    {
      name: "label-by-id-text-names-dam",
      base: PRIVATE_DAM,
      expect: { code: "public-name", path: "/text" },
      mutate: (r) => void (r.text = r.text.replace("; county: ", "; name: Cj Gerlach Dam; county: ")),
    },
    // The detail is withheld on every dam, not only a private one.
    { name: "public-dam-published-name-carried", base: PUBLIC_DAM, expect: { code: "withheld", path: "/details/published name" }, mutate: (r) => void (r.details["published name"] = r.name) },
    { name: "county-outside-state", base: SCHOOL, expect: { code: "county", path: "/place/countyFips" }, mutate: (r) => void (r.place.countyFips = "06453") },
    { name: "state-codes-disagree", base: HISTORIC, expect: { code: "state", path: "/place/stateUsps" }, mutate: (r) => void (r.place.stateUsps = "OK") },
    {
      name: "snapshot-of-another-collection",
      base: SCHOOL,
      expect: { code: "snapshot", path: "/snapshotId" },
      mutate: (r) => void (r.snapshotId = r.snapshotId.replace(/^[^.]+/, "nrhp-listed")),
    },
    // A person-typed collection (person-fields.json) never carries a birth date, a home address, or any field off its list.
    { name: "person-birth-date", base: ATHLETE, expect: { code: "person-fields", path: "/details/birth_date" }, mutate: (r) => void (r.details.birth_date = "2000-01-01") },
    { name: "person-home-address", base: ATHLETE, expect: { code: "person-fields", path: "/details/home address" }, mutate: (r) => void (r.details["home address"] = "1 Fixture Lane") },
    { name: "person-field-off-list", base: ATHLETE, expect: { code: "person-fields", path: "/details/mascot" }, mutate: (r) => void (r.details.mascot = "Fixture the Tester") },
    // eye's HUD source string is not a record field: provenance carries the source.
    { name: "unknown-field", base: HISTORIC, expect: { code: "additional", path: "/source" }, mutate: (r) => void (r.source = "NPS National Register") },
  ],
  manifest: [
    { name: "missing-snapshot-id", base: MANIFEST, expect: { code: "required", path: "/snapshotId" }, mutate: (m) => void delete m.snapshotId },
    { name: "short-file-sha", base: MANIFEST, expect: { code: "pattern", path: "/files/0/sha256" }, mutate: (m) => void (m.files[0].sha256 = m.files[0].sha256.slice(1)) },
    { name: "short-git-sha", base: MANIFEST, expect: { code: "pattern", path: "/builder/gitSha" }, mutate: (m) => void (m.builder.gitSha = m.builder.gitSha.slice(0, 7)) },
    { name: "placeholder-version", base: MANIFEST, expect: { code: "placeholder", path: "/builder/version" }, mutate: (m) => void (m.builder.version = "TBD") },
    {
      name: "snapshot-id-wrong-day",
      base: MANIFEST,
      expect: { code: "snapshot", path: "/snapshotId" },
      mutate: (m) => void (m.snapshotId = m.snapshotId.replace(/\d{4}-\d{2}-\d{2}$/, "2026-10-17")),
    },
    { name: "record-count-disagrees", base: MANIFEST, expect: { code: "count", path: "/recordCount" }, mutate: (m) => void (m.recordCount += 1) },
    { name: "count-gap-unexplained", base: MANIFEST, expect: { code: "gap", path: "/publisherCount/gap" }, mutate: (m) => void delete m.publisherCount.gap },
    { name: "bbox-inverted", base: MANIFEST, expect: { code: "bbox", path: "/region/bbox" }, mutate: (m) => void ([m.region.bbox[0], m.region.bbox[2]] = [m.region.bbox[2], m.region.bbox[0]]) },
    { name: "missing-publisher-count", base: MANIFEST, expect: { code: "required", path: "/publisherCount" }, mutate: (m) => void delete m.publisherCount },
    // embeddableFields drifted from eye's EMBED_TEXT: an NRHP listing's refnum is an id, matched by letters, never embedded.
    {
      name: "embeddable-fields-drift",
      base: MANIFEST,
      expect: { code: "embeddable", path: "/embeddableFields" },
      mutate: (m) => void m.embeddableFields.push("nris refnum"),
    },
    // An NRHP property's name can be a person's: PUBLIC_NAME_RULE has no nrhp-listed entry, so its name is never embedded.
    {
      name: "embeddable-name-not-allowed",
      base: MANIFEST,
      expect: { code: "embeddable", path: "/embeddableName" },
      mutate: (m) => void (m.embeddableName = "when-nameRule-public-name"),
    },
    // The joins block (added 2026-10-20): every record is placed or listed unplaced with a reason.
    {
      name: "joins-count-disagrees",
      base: MANIFEST,
      expect: { code: "joins", path: "/joins/0/placed" },
      mutate: (m) => void (m.joins = [{ ...goodJoins(m), unplaced: goodJoins(m).unplaced.slice(1) }]),
    },
    // An unplaced entry for an id the snapshot's files don't hold (checked with the files).
    {
      name: "joins-unplaced-id-unknown",
      base: MANIFEST,
      withFiles: true,
      expect: { code: "joins", path: "/joins/0/unplaced/0/id" },
      mutate: (m) => {
        const j = goodJoins(m);
        j.unplaced[0] = { ...j.unplaced[0], id: "nrhp:pt:0000000" };
        m.joins = [j];
      },
    },
    // The publisher's count must equal the records, plus the gap items, plus the repeated-id rows.
    {
      name: "gap-items-count-disagrees",
      base: MANIFEST,
      expect: { code: "gap", path: "/publisherCount/gapItems" },
      mutate: (m) => {
        m.publisherCount.value = m.recordCount + 2;
        m.publisherCount.gap = "The publisher counts two more than this snapshot holds: two rows are not records.";
        m.publisherCount.gapItems = [{ id: "nrhp:pt:1", reason: "NPS STATUS Removed: not a current listing" }];
      },
    },
  ],
};

/** Each case's fixture body, as the file holds it. */
export function build(kind, c) {
  const doc = read(c.base);
  c.mutate(doc);
  return JSON.stringify(doc, null, 2) + "\n";
}

export const fileOf = (kind, c) => path.join(HERE, kind, "invalid", `${c.name}.json`);

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  for (const [kind, cases] of Object.entries(CASES)) {
    mkdirSync(path.join(HERE, kind, "invalid"), { recursive: true });
    for (const c of cases) writeFileSync(fileOf(kind, c), build(kind, c));
    console.log(`${kind}: ${cases.length} invalid fixtures`);
  }
}
