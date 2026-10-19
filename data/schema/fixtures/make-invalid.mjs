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
const MANIFEST = "snapshots/nrhp-listed.austin-east.2026-10-18/manifest.json";

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
