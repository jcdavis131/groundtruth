// Validator for groundtruth records and snapshot manifests. Plain Node, no install.
//
//   node data/schema/validate.mjs record <file.json | file.jsonl> ...
//   node data/schema/validate.mjs manifest <manifest.json> ...   (also checks the files it lists, next to it)
//   node data/schema/validate.mjs manifest --no-files <manifest.json> ...   (the manifest alone)
//
// Two layers of checks:
//   1. The JSON Schema in record.schema.json / manifest.schema.json, read by a small evaluator for the subset
//      those files use: type, const, enum, required, properties, additionalProperties, pattern, minLength,
//      maxLength, minimum, maximum, items, prefixItems, minItems, maxItems, allOf, if/then and local $ref.
//      Any other keyword in a schema is an error, so the schema can't quietly say more than this checks.
//   2. Rules JSON Schema can't say (data/SCHEMA.md, "Checks beyond the schema"): no placeholder values, closed
//      polygon rings, state and county codes that agree, the snapshot id's parts, the public-name list, no
//      public-name on a name in label-by-id form, a dam's public-name only under public owner types, no name segment
//      in a label-by-id record's text, no withheld detail (a dam's published name), the count gap, embeddableFields
//      and embeddableName as embeddable.mjs derives them from eye's embedFields.ts, and the listed files' bytes,
//      sha256 and record counts.
//      The joins block (data/SCHEMA.md, Joins): placed + unplaced = recordCount, the methods add up, the cross-check adds up
//      and, with a jsonl file, every record without a countyFips has an unplaced entry and every unplaced id is a record.
//      gapItems: the publisher's count is recordCount + gapItems.length + duplicateRows.
// Each problem is {code, path, message}. Exit 0 when every input is valid, 1 otherwise.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { embeddableProblems } from "./embeddable.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RECORD_SCHEMA = JSON.parse(readFileSync(path.join(HERE, "record.schema.json"), "utf8"));
export const MANIFEST_SCHEMA = JSON.parse(readFileSync(path.join(HERE, "manifest.schema.json"), "utf8"));

// ---------------------------------------------------------------- JSON Schema subset

const KNOWN = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description", "type", "const", "enum", "required", "properties",
  "additionalProperties", "pattern", "minLength", "maxLength", "minimum", "maximum", "items", "prefixItems",
  "minItems", "maxItems", "allOf", "if", "then",
]);

const typeOf = (v) =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;
const isType = (v, t) => (t === "number" ? typeof v === "number" && Number.isFinite(v) : t === "integer" ? Number.isInteger(v) : typeOf(v) === t);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolve(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`only local $ref is supported: ${ref}`);
  return ref.slice(2).split("/").reduce((o, k) => o?.[k], root) ?? (() => { throw new Error(`unresolved $ref ${ref}`); })();
}

/** Problems with `v` against `schema` (a subset evaluator; see the header). */
export function schemaErrors(v, schema, root = schema, at = "") {
  const out = [];
  const err = (code, message, p = at) => out.push({ code, path: p || "/", message });
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`schema keyword ${k} at ${at || "/"} is not supported`);
  if (schema.$ref) out.push(...schemaErrors(v, resolve(root, schema.$ref), root, at));
  if (schema.type !== undefined) {
    const ts = [].concat(schema.type);
    if (!ts.some((t) => isType(v, t))) {
      err("type", `expected ${ts.join(" or ")}, got ${typeOf(v)}`);
      return out; // nothing else is meaningful on the wrong type
    }
  }
  if ("const" in schema && !same(v, schema.const)) err("const", `expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => same(v, e))) err("enum", `expected one of ${schema.enum.join(", ")}`);
  if (typeof v === "string") {
    if (schema.minLength !== undefined && v.length < schema.minLength) err("minLength", `shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && v.length > schema.maxLength) err("maxLength", `longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(v)) err("pattern", `does not match ${schema.pattern}`);
  }
  if (typeof v === "number") {
    if (schema.minimum !== undefined && v < schema.minimum) err("range", `${v} < ${schema.minimum}`);
    if (schema.maximum !== undefined && v > schema.maximum) err("range", `${v} > ${schema.maximum}`);
  }
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) err("minItems", `fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && v.length > schema.maxItems) err("maxItems", `more than ${schema.maxItems} items`);
    const pre = schema.prefixItems ?? [];
    v.forEach((x, i) => {
      const s = i < pre.length ? pre[i] : schema.items;
      if (s === false) err("items", `no item allowed at ${i}`, `${at}/${i}`);
      else if (s) out.push(...schemaErrors(x, s, root, `${at}/${i}`));
    });
  }
  if (typeOf(v) === "object") {
    for (const k of schema.required ?? []) if (!(k in v)) err("required", `missing ${k}`, `${at}/${k}`);
    for (const [k, x] of Object.entries(v)) {
      const s = schema.properties?.[k];
      if (s) out.push(...schemaErrors(x, s, root, `${at}/${k}`));
      else if (schema.additionalProperties === false) err("additional", `unknown field ${k}`, `${at}/${k}`);
      else if (typeof schema.additionalProperties === "object") out.push(...schemaErrors(x, schema.additionalProperties, root, `${at}/${k}`));
    }
  }
  for (const s of schema.allOf ?? []) out.push(...schemaErrors(v, s, root, at));
  if (schema.if && schemaErrors(v, schema.if, root, at).length === 0 && schema.then) out.push(...schemaErrors(v, schema.then, root, at));
  return out;
}

// ---------------------------------------------------------------- shared rules

/** State and territory codes: [FIPS, USPS, name as Census writes it]. */
export const STATES = [
  ["01", "AL", "Alabama"], ["02", "AK", "Alaska"], ["04", "AZ", "Arizona"], ["05", "AR", "Arkansas"], ["06", "CA", "California"],
  ["08", "CO", "Colorado"], ["09", "CT", "Connecticut"], ["10", "DE", "Delaware"], ["11", "DC", "District of Columbia"],
  ["12", "FL", "Florida"], ["13", "GA", "Georgia"], ["15", "HI", "Hawaii"], ["16", "ID", "Idaho"], ["17", "IL", "Illinois"],
  ["18", "IN", "Indiana"], ["19", "IA", "Iowa"], ["20", "KS", "Kansas"], ["21", "KY", "Kentucky"], ["22", "LA", "Louisiana"],
  ["23", "ME", "Maine"], ["24", "MD", "Maryland"], ["25", "MA", "Massachusetts"], ["26", "MI", "Michigan"], ["27", "MN", "Minnesota"],
  ["28", "MS", "Mississippi"], ["29", "MO", "Missouri"], ["30", "MT", "Montana"], ["31", "NE", "Nebraska"], ["32", "NV", "Nevada"],
  ["33", "NH", "New Hampshire"], ["34", "NJ", "New Jersey"], ["35", "NM", "New Mexico"], ["36", "NY", "New York"],
  ["37", "NC", "North Carolina"], ["38", "ND", "North Dakota"], ["39", "OH", "Ohio"], ["40", "OK", "Oklahoma"], ["41", "OR", "Oregon"],
  ["42", "PA", "Pennsylvania"], ["44", "RI", "Rhode Island"], ["45", "SC", "South Carolina"], ["46", "SD", "South Dakota"],
  ["47", "TN", "Tennessee"], ["48", "TX", "Texas"], ["49", "UT", "Utah"], ["50", "VT", "Vermont"], ["51", "VA", "Virginia"],
  ["53", "WA", "Washington"], ["54", "WV", "West Virginia"], ["55", "WI", "Wisconsin"], ["56", "WY", "Wyoming"],
  ["60", "AS", "American Samoa"], ["66", "GU", "Guam"], ["69", "MP", "Northern Mariana Islands"], ["72", "PR", "Puerto Rico"],
  ["78", "VI", "U.S. Virgin Islands"],
];
const USPS_BY_FIPS = new Map(STATES.map(([f, u]) => [f, u]));

/**
 * Collections whose records may carry their published name (nameRule "public-name"). eye's PUBLIC_NAME_RULE in
 * lib/catalog/embedFields.ts, 2026-10-18; a collection joins only by a reviewed change to both lists.
 */
export const PUBLIC_NAME_COLLECTIONS = new Set(["hifld-hospitals", "nces-public-schools", "nid-dams", "padus-units"]);

/**
 * The label-by-id form eye gives a record whose name it may not show (lib/infra/features.ts, lib/land/features.ts).
 * A record whose name has this form is labelled by id, so it can't say public-name.
 */
export const LABEL_BY_ID_FORM = {
  "nid-dams": /^Dam [A-Z]{2}\d+$/, // a private dam, or one with no name: "Dam TX00028"
  "padus-units": / · PAD-US \d+$/, // a privately owned unit: "<designation> · PAD-US 12345"
};

/**
 * The owner types under which a dam may keep its published name (eye's DAM_NAMED_OWNER_TYPES, lib/infra/features.ts):
 * a public-name dam's "owner type" and every entry of its "owner types" must be one of these. Private, Not Listed,
 * a missing owner type and anything else are labelled by id.
 */
export const DAM_NAMED_OWNER_TYPES = new Set(["federal", "state", "local government", "public utility", "tribal government"]);

export function damOwnerProblem(details) {
  const d = details && typeof details === "object" ? details : {};
  const primary = typeof d["owner type"] === "string" ? d["owner type"].trim().toLowerCase() : "";
  if (!DAM_NAMED_OWNER_TYPES.has(primary)) return `owner type ${JSON.stringify(d["owner type"] ?? null)} is not public (Not Listed or missing is unknown, not public)`;
  // No owner-types list can't show that every owner is public: fail closed, as the builder and eye do.
  if (!Object.hasOwn(d, "owner types")) return "owner types missing: a public-name dam must show every owner is public";
  const bad = String(d["owner types"] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((e) => !DAM_NAMED_OWNER_TYPES.has(e));
  if (bad.length) return `owner types ${JSON.stringify(d["owner types"])} include a non-public entry`;
  return null;
}

/**
 * Detail keys a snapshot never carries: eye shows them on click, but they hold the published name of a record
 * labelled by id, which can be a person's. The snapshot's manifest lists them under withheldFields.
 */
export const WITHHELD_DETAILS = {
  "nid-dams": ["published name"],
  "padus-units": ["published name"],
};

/**
 * Strings that stand in for a missing value. Compared trimmed and case-folded. A publisher's own coded state in
 * its own words ("not reported", "not applicable", "Unknown" as a published category) is a value, not one of these.
 */
export const PLACEHOLDER_STRINGS = new Set(["", "null", "nil", "undefined", "nan", "n/a", "tbd", "todo", "placeholder", "lorem ipsum", "-", "--", "?", "xxx", "missing"]);
/** Numbers used as fill values. */
export const PLACEHOLDER_NUMBERS = new Set([-9999, -99999, -999999]);

function placeholders(v, at, out) {
  if (typeof v === "string" && PLACEHOLDER_STRINGS.has(v.trim().toLowerCase()))
    out.push({ code: "placeholder", path: at, message: `placeholder value ${JSON.stringify(v)}: leave the field out instead` });
  else if (typeof v === "number" && PLACEHOLDER_NUMBERS.has(v))
    out.push({ code: "placeholder", path: at, message: `fill value ${v}: leave the field out instead` });
  else if (Array.isArray(v)) v.forEach((x, i) => placeholders(x, `${at}/${i}`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) placeholders(x, `${at}/${k}`, out);
}

const dateOf = (snapshotId) => snapshotId.split(".")[2];
const realDate = (d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

// ---------------------------------------------------------------- records

function rings(g) {
  if (g.type === "Polygon") return g.coordinates;
  if (g.type === "MultiPolygon") return g.coordinates.flat();
  return [];
}

/** Problems with one record. */
export function validateRecord(r) {
  const out = schemaErrors(r, RECORD_SCHEMA);
  if (typeOf(r) !== "object") return out;
  placeholders(r, "", out);
  const g = r.geometry;
  if (g && Array.isArray(g.coordinates))
    rings(g).forEach((ring, i) => {
      if (Array.isArray(ring) && ring.length >= 4 && !same(ring[0], ring[ring.length - 1]))
        out.push({ code: "ring", path: "/geometry/coordinates", message: `ring ${i} is not closed (first and last positions differ)` });
    });
  const p = r.place;
  if (p && typeof p.stateFips === "string" && typeof p.stateUsps === "string") {
    const usps = USPS_BY_FIPS.get(p.stateFips);
    if (!usps) out.push({ code: "state", path: "/place/stateFips", message: `${p.stateFips} is not a state or territory FIPS code` });
    else if (usps !== p.stateUsps) out.push({ code: "state", path: "/place/stateUsps", message: `FIPS ${p.stateFips} is ${usps}, not ${p.stateUsps}` });
    if (typeof p.countyFips === "string" && !p.countyFips.startsWith(p.stateFips))
      out.push({ code: "county", path: "/place/countyFips", message: `county ${p.countyFips} is not in state ${p.stateFips}` });
  }
  if (typeof r.snapshotId === "string" && typeof r.collection === "string") {
    const [col, , day] = r.snapshotId.split(".");
    if (col !== r.collection) out.push({ code: "snapshot", path: "/snapshotId", message: `snapshot is of ${col}, record is of ${r.collection}` });
    if (day && !realDate(day)) out.push({ code: "snapshot", path: "/snapshotId", message: `${day} is not a calendar date` });
    const got = r.provenance?.retrievedAt;
    if (day && realDate(day) && typeof got === "string" && got.slice(0, 10) > day)
      out.push({ code: "time", path: "/provenance/retrievedAt", message: `retrieved ${got}, after the snapshot's day ${day}` });
  }
  if (r.nameRule === "public-name" && !PUBLIC_NAME_COLLECTIONS.has(r.collection))
    out.push({ code: "public-name", path: "/nameRule", message: `${r.collection} has no public-name rule; label the record by id` });
  const form = LABEL_BY_ID_FORM[r.collection];
  if (r.nameRule === "public-name" && form && typeof r.name === "string" && form.test(r.name))
    out.push({ code: "public-name", path: "/nameRule", message: `${JSON.stringify(r.name)} is a label by id, so the record's nameRule is label-by-id` });
  if (r.collection === "nid-dams" && r.nameRule === "public-name") {
    const why = damOwnerProblem(r.details);
    if (why) out.push({ code: "public-name", path: "/nameRule", message: `${why}, so the dam is labelled by id` });
  }
  // A record labelled by id never carries a name in its record text (eye's "name: <published name>" segment).
  if (r.nameRule === "label-by-id" && PUBLIC_NAME_COLLECTIONS.has(r.collection) && typeof r.text === "string" && r.text.split("; ").some((s) => s.startsWith("name: ")))
    out.push({ code: "public-name", path: "/text", message: "a record labelled by id has a name segment in its record text" });
  if (r.details && typeof r.details === "object")
    for (const k of WITHHELD_DETAILS[r.collection] ?? [])
      if (Object.hasOwn(r.details, k))
        out.push({ code: "withheld", path: `/details/${k}`, message: `${r.collection} never carries ${JSON.stringify(k)}: it can be a person's name; leave it out and list it in the manifest's withheldFields` });
  return out;
}

// ---------------------------------------------------------------- manifests

/** Problems with one manifest, without reading its files. */
export function validateManifest(m) {
  const out = schemaErrors(m, MANIFEST_SCHEMA);
  if (typeOf(m) !== "object") return out;
  placeholders(m, "", out);
  if (typeof m.snapshotId === "string" && typeof m.createdAt === "string" && m.region && typeof m.region.id === "string") {
    const want = `${m.collection}.${m.region.id}.${m.createdAt.slice(0, 10)}`;
    if (m.snapshotId !== want) out.push({ code: "snapshot", path: "/snapshotId", message: `expected ${want} from collection, region id and createdAt's UTC date` });
  }
  const b = m.region?.bbox;
  if (Array.isArray(b) && b.length === 4 && b.every((x) => typeof x === "number") && !(b[0] < b[2] && b[1] < b[3]))
    out.push({ code: "bbox", path: "/region/bbox", message: "bbox must be [west, south, east, north] with west < east and south < north" });
  if (Array.isArray(m.files)) {
    const sum = m.files.reduce((s, f) => s + (Number.isInteger(f?.records) ? f.records : 0), 0);
    if (Number.isInteger(m.recordCount) && sum !== m.recordCount)
      out.push({ code: "count", path: "/recordCount", message: `recordCount ${m.recordCount} but the files hold ${sum}` });
    const seen = new Set();
    m.files.forEach((f, i) => {
      if (typeof f?.path !== "string") return;
      if (seen.has(f.path)) out.push({ code: "duplicate", path: `/files/${i}/path`, message: `${f.path} listed twice` });
      if (f.path.split("/").includes("..")) out.push({ code: "pattern", path: `/files/${i}/path`, message: "path may not leave the snapshot folder" });
      seen.add(f.path);
    });
  }
  const pc = m.publisherCount;
  if (pc && Number.isInteger(pc.value) && Number.isInteger(m.recordCount) && pc.value !== m.recordCount && !pc.gap)
    out.push({ code: "gap", path: "/publisherCount/gap", message: `publisher counts ${pc.value}, snapshot holds ${m.recordCount}: say why in gap` });
  // gapItems (added 2026-10-20): the publisher's count is the records, plus one item per publisher id that isn't one,
  // plus the extra rows of ids the publisher repeats. The 2026-10-19 manifests carry the prose gap only and skip this.
  if (pc && Array.isArray(pc.gapItems) && Number.isInteger(pc.value) && Number.isInteger(m.recordCount)) {
    const dup = Number.isInteger(pc.duplicateRows) ? pc.duplicateRows : 0;
    if (pc.value !== m.recordCount + pc.gapItems.length + dup)
      out.push({ code: "gap", path: "/publisherCount/gapItems", message: `publisher counts ${pc.value}, but recordCount ${m.recordCount} + ${pc.gapItems.length} gapItems + ${dup} duplicate rows = ${m.recordCount + pc.gapItems.length + dup}` });
    const seenGap = new Set();
    pc.gapItems.forEach((g, i) => {
      if (typeof g?.id === "string" && seenGap.has(g.id)) out.push({ code: "gap", path: `/publisherCount/gapItems/${i}/id`, message: `${g.id} listed twice` });
      seenGap.add(g?.id);
    });
  }
  out.push(...joinsProblems(m));
  if (("embeddableFields" in m) !== ("embeddableName" in m))
    out.push({ code: "embeddable", path: "embeddableFields" in m ? "/embeddableName" : "/embeddableFields", message: "embeddableFields and embeddableName come together" });
  out.push(...embeddableProblems(m));
  return out;
}


/**
 * The joins block's own arithmetic, without the files: every record is placed or listed unplaced, once; the
 * methods add up to placed; the cross-check adds up and its disagreements are the listed ones.
 */
function joinsProblems(m) {
  const out = [];
  if (!Array.isArray(m.joins) || !Number.isInteger(m.recordCount)) return out;
  m.joins.forEach((j, i) => {
    const at = `/joins/${i}`;
    if (!j || typeof j !== "object" || !Array.isArray(j.unplaced) || !Number.isInteger(j.placed)) return;
    if (j.placed + j.unplaced.length !== m.recordCount)
      out.push({ code: "joins", path: `${at}/placed`, message: `placed ${j.placed} + ${j.unplaced.length} unplaced is ${j.placed + j.unplaced.length}, recordCount is ${m.recordCount}: every record is placed or says why not` });
    const seen = new Set();
    j.unplaced.forEach((u, n) => {
      if (typeof u?.id === "string" && seen.has(u.id)) out.push({ code: "joins", path: `${at}/unplaced/${n}/id`, message: `${u.id} listed unplaced twice` });
      seen.add(u?.id);
    });
    const ms = j.methods && typeof j.methods === "object" ? Object.values(j.methods).reduce((s, x) => s + (Number.isInteger(x) ? x : 0), 0) : null;
    if (ms !== null && ms !== j.placed) out.push({ code: "joins", path: `${at}/methods`, message: `methods add up to ${ms}, placed is ${j.placed}` });
    const cc = j.crossCheck;
    if (cc && Array.isArray(j.disagreements) && Number.isInteger(cc.disagree) && cc.disagree !== j.disagreements.length)
      out.push({ code: "joins", path: `${at}/crossCheck/disagree`, message: `disagree ${cc.disagree}, but ${j.disagreements.length} disagreements are listed` });
    if (cc && [cc.agree, cc.disagree].every(Number.isInteger)) {
      const total = cc.agree + cc.disagree + (Number.isInteger(cc.unchecked) ? cc.unchecked : 0);
      if (total !== m.recordCount) out.push({ code: "joins", path: `${at}/crossCheck`, message: `agree + disagree + unchecked is ${total}, recordCount is ${m.recordCount}` });
    }
  });
  return out;
}

/** Problems with the files a manifest lists, read from `dir`: bytes, sha256, line count, and every line a valid record of this snapshot. */
export function verifyFiles(m, dir) {
  const out = [];
  const ids = new Set();
  const withCounty = new Map();
  (m.files ?? []).forEach((f, i) => {
    const full = path.join(dir, f.path);
    if (!existsSync(full)) return out.push({ code: "file-missing", path: `/files/${i}`, message: `${f.path} not found` });
    const buf = readFileSync(full);
    if (buf.length !== f.bytes) out.push({ code: "file-bytes", path: `/files/${i}/bytes`, message: `${f.path} is ${buf.length} bytes, manifest says ${f.bytes}` });
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== f.sha256) out.push({ code: "file-sha", path: `/files/${i}/sha256`, message: `${f.path} hashes to ${sha}` });
    if (f.format === "geoparquet") {
      // Plain Node can't read Parquet, so a GeoParquet file is checked by bytes, sha256 and its PAR1 magic here;
      // data/pipeline/read.py checks its row count and records when it reads it.
      const magic = (b) => b.length >= 4 && b.subarray(0, 4).toString("latin1") === "PAR1";
      if (buf.length < 8 || !magic(buf) || !magic(buf.subarray(buf.length - 4)))
        out.push({ code: "file-format", path: `/files/${i}/format`, message: `${f.path} is not a Parquet file (no PAR1 magic at both ends)` });
      return;
    }
    const lines = buf.toString("utf8").split("\n").filter((l) => l.length);
    if (lines.length !== f.records) out.push({ code: "file-records", path: `/files/${i}/records`, message: `${f.path} holds ${lines.length} records, manifest says ${f.records}` });
    lines.forEach((l, n) => {
      let r;
      try {
        r = JSON.parse(l);
      } catch {
        return out.push({ code: "file-record", path: `/files/${i}`, message: `${f.path} line ${n + 1} is not JSON` });
      }
      for (const e of validateRecord(r)) out.push({ ...e, code: "file-record", message: `${f.path} line ${n + 1} ${e.path}: ${e.code} ${e.message}` });
      if (r.snapshotId !== m.snapshotId) out.push({ code: "file-record", path: `/files/${i}`, message: `${f.path} line ${n + 1} belongs to ${r.snapshotId}` });
      if (ids.has(r.id)) out.push({ code: "file-record", path: `/files/${i}`, message: `${f.path} line ${n + 1} repeats id ${r.id}` });
      ids.add(r.id);
      withCounty.set(r.id, typeof r.place?.countyFips === "string");
    });
  });
  // The joins block against the records themselves (jsonl files; plain Node can't read Parquet, so
  // data/pipeline/read.py makes the same check on a GeoParquet snapshot).
  if (Array.isArray(m.joins) && (m.files ?? []).every((f) => f.format === "jsonl"))
    m.joins.forEach((j, i) => {
      const placedHere = [...withCounty.values()].filter(Boolean).length;
      if (Number.isInteger(j.placed) && j.placed !== placedHere)
        out.push({ code: "joins", path: `/joins/${i}/placed`, message: `placed is ${j.placed}, but ${placedHere} records carry a countyFips` });
      const listed = new Set();
      (j.unplaced ?? []).forEach((u, n) => {
        listed.add(u.id);
        if (!withCounty.has(u.id)) out.push({ code: "joins", path: `/joins/${i}/unplaced/${n}/id`, message: `${u.id} is not among the files' ids` });
        else if (withCounty.get(u.id)) out.push({ code: "joins", path: `/joins/${i}/unplaced/${n}/id`, message: `${u.id} is listed unplaced but carries a countyFips` });
      });
      for (const [id, has] of withCounty) if (!has && !listed.has(id)) out.push({ code: "joins", path: `/joins/${i}/unplaced`, message: `${id} has no countyFips and no unplaced entry with a reason` });
    });
  return out;
}

// ---------------------------------------------------------------- CLI

function main(argv) {
  const [what, ...rest] = argv;
  // --no-files: check a manifest alone, for the committed copies under data/manifests/ whose files live in the
  // data root, outside git.
  const noFiles = rest.includes("--no-files");
  const files = rest.filter((a) => a !== "--no-files");
  if (!["record", "manifest"].includes(what) || !files.length || (noFiles && what !== "manifest")) {
    console.log("usage: node data/schema/validate.mjs record <file> ... | manifest [--no-files] <file> ...");
    return 2;
  }
  let bad = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const docs = f.endsWith(".jsonl") ? text.split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [JSON.parse(text)];
    docs.forEach((d, n) => {
      const errs = what === "record" ? validateRecord(d) : [...validateManifest(d), ...(noFiles ? [] : verifyFiles(d, path.dirname(f)))];
      const label = docs.length > 1 ? `${f}:${n + 1}` : f;
      if (errs.length) bad++;
      console.log(errs.length ? `FAIL  ${label}` : `ok    ${label}`);
      for (const e of errs) console.log(`      ${e.code} ${e.path} ${e.message}`);
    });
  }
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
