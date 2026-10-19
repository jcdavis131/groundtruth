// Builds the valid fixtures from eye's live API: three small snapshots (records.jsonl + manifest.json) and one
// record per snapshot under record/valid/. Plain Node 22, no install. Network: eye.jcamd.com and the two
// publishers' public ArcGIS services, keyless. Run by hand; CI only validates what it wrote.
//
//   node data/schema/fixtures/build-fixtures.mjs
//
// It refuses to run when validate.mjs or this file has uncommitted changes, because the manifests name the
// commit that built them (builder.gitSha).
//
// What it does to eye's features (data/SCHEMA.md, "From eye's LayerFeature"):
//   keeps id, layer, name, kind, details and extra.embedText (as text); takes provenance from the envelope;
//   keeps features inside the region box; drops a Point's height when it is 0 (ArcGIS fills it, it is not a
//   measurement); drops null details and the fields the collection withholds; adds place codes from the
//   source's own fields; sorts by id.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embeddableFor } from "../embeddable.mjs";
import { STATES, validateManifest, validateRecord, verifyFiles } from "../validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "0.1.0";
const UA = { "user-agent": "groundtruth-fixtures/0.1 (eye.jcamd.com)" };
const EYE = "https://eye.jcamd.com";

const USPS_BY_FIPS = new Map(STATES.map(([f, u]) => [f, u]));
const BY_NAME = new Map(STATES.map(([f, u, n]) => [n.toUpperCase(), { stateFips: f, stateUsps: u }]));

const arcgisQuery = (layer, bbox, extra) =>
  `${layer}/query?where=1%3D1&geometry=${bbox.join("%2C")}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&${extra}&f=json`;

const COLLECTIONS = {
  "nces-public-schools": {
    route: (b) => `${EYE}/api/civic?op=schools&bbox=${b.join(",")}`,
    layer: "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1",
    gapFields: "NCESSCH,SY_STATUS_TEXT",
    upstreamId: (a) => `nces:${a.NCESSCH}`,
    upstreamWhy: (a) => `status ${a.SY_STATUS_TEXT}`,
    nameRule: "public-name",
    // details.county reads "Travis County (48453)": the county FIPS is NCES's own CNTY field.
    place: (d) => {
      const m = /\((\d{5})\)\s*$/.exec(String(d.county ?? ""));
      if (!m) return null;
      const stateFips = m[1].slice(0, 2);
      return { stateFips, stateUsps: USPS_BY_FIPS.get(stateFips), countyFips: m[1], method: "source-field" };
    },
    withheld: [],
  },
  "nrhp-listed": {
    route: (b) => `${EYE}/api/land?op=historic&bbox=${b.join(",")}`,
    layer: "https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/nrhp_locations/MapServer/0",
    gapFields: "OBJECTID,STATUS",
    upstreamId: (a) => `nrhp:pt:${a.OBJECTID}`,
    upstreamWhy: (a) => `STATUS ${a.STATUS}`,
    nameRule: "label-by-id",
    // details.state reads "TEXAS": a state name matched to the code table. NPS gives no county code.
    place: (d) => {
      const s = BY_NAME.get(String(d.state ?? "").trim().toUpperCase());
      return s ? { ...s, method: "name-lookup" } : null;
    },
    withheld: [
      {
        field: "property name (as NPS lists it)",
        why: "NPS's RESNAME can be a person's name (eye's nrhp-listed card: never searched or embedded); a training snapshot leaves it out",
      },
    ],
  },
};

const SNAPSHOTS = [
  { collection: "nces-public-schools", region: { id: "austin-east", name: "East Austin, Texas (small test box)", bbox: [-97.72, 30.26, -97.7, 30.28] } },
  { collection: "nces-public-schools", region: { id: "austin-downtown", name: "Downtown Austin, Texas (small test box)", bbox: [-97.75, 30.26, -97.73, 30.28] } },
  { collection: "nrhp-listed", region: { id: "austin-east", name: "East Austin, Texas (small test box)", bbox: [-97.72, 30.26, -97.7, 30.28] } },
];

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
async function get(url, purpose, log) {
  const r = await fetch(url, { headers: UA });
  const buf = Buffer.from(await r.arrayBuffer());
  log.push({ purpose, url, status: r.status, retrievedAt: new Date().toISOString(), bytes: buf.length, sha256: sha256(buf) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return JSON.parse(buf.toString("utf8"));
}

const inBox = ([x, y], [w, s, e, n]) => x >= w && x <= e && y >= s && y <= n;

function toRecord(f, env, cfg, collection, snapshotId) {
  const p = f.properties;
  const prov = env.provenance[0];
  const withheld = new Set(cfg.withheld.map((w) => w.field));
  const details = {};
  for (const [k, v] of Object.entries(p.details ?? {})) if (v !== null && v !== undefined && !withheld.has(k)) details[k] = v;
  let geometry = f.geometry;
  if (geometry.type === "Point" && geometry.coordinates.length === 3 && geometry.coordinates[2] === 0)
    geometry = { type: "Point", coordinates: geometry.coordinates.slice(0, 2) };
  const place = cfg.place(p.details ?? {});
  if (!place) throw new Error(`${p.id}: no place join`);
  const text = p.extra?.embedText;
  const provenance = {
    sourceId: prov.source.id,
    sourceName: prov.source.name,
    publisher: prov.source.publisher,
    licence: prov.source.license,
    ...(prov.seriesId ? { seriesId: prov.seriesId } : {}),
    upstreamUrl: prov.upstreamUrl,
    ...(prov.period ? { period: prov.period } : {}),
    ...(prov.releasedAt ? { releasedAt: prov.releasedAt } : {}),
    retrievedAt: prov.retrievedAt,
    kind: prov.kind,
    ...(prov.notes?.length ? { notes: prov.notes } : {}),
  };
  return {
    schemaVersion: "record/1",
    id: p.id,
    collection,
    layer: p.layer,
    name: p.name,
    nameRule: cfg.nameRule,
    ...(p.kind ? { kind: p.kind } : {}),
    geometry,
    place,
    details,
    ...(typeof text === "string" && text.trim() ? { text } : {}),
    provenance,
    snapshotId,
  };
}

async function build({ collection, region }, gitSha) {
  const cfg = COLLECTIONS[collection];
  const createdAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const snapshotId = `${collection}.${region.id}.${createdAt.slice(0, 10)}`;
  const requests = [];
  const env = await get(cfg.route(region.bbox), "records", requests);
  const feats = env.data.features.filter((f) => f.geometry?.type === "Point" && inBox(f.geometry.coordinates, region.bbox));
  const records = feats.map((f) => toRecord(f, env, cfg, collection, snapshotId)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const countUrl = arcgisQuery(cfg.layer, region.bbox, "returnCountOnly=true");
  const count = await get(countUrl, "count", requests);
  const countedAt = requests[requests.length - 1].retrievedAt.replace(/\.\d+Z$/, "Z");
  const publisherCount = {
    value: count.count,
    method: "ArcGIS REST query on the publisher's layer: where 1=1, the region box as an esriGeometryEnvelope (inSR 4326, intersects), returnCountOnly=true",
    url: countUrl,
    countedAt,
  };
  if (count.count !== records.length) {
    const rows = (await get(arcgisQuery(cfg.layer, region.bbox, `outFields=${cfg.gapFields}&returnGeometry=false`), "gap", requests)).features.map((x) => x.attributes);
    const have = new Set(records.map((r) => r.id));
    const missing = rows.filter((a) => !have.has(cfg.upstreamId(a)));
    const theirs = new Set(rows.map(cfg.upstreamId));
    const extra = records.filter((r) => !theirs.has(r.id));
    publisherCount.gap =
      `${missing.length} publisher row(s) in the box are not records here: ${missing.map((a) => `${cfg.upstreamId(a)} (${cfg.upstreamWhy(a)})`).join(", ") || "none"}` +
      (extra.length ? `; ${extra.length} record(s) the publisher's query did not return: ${extra.map((r) => r.id).join(", ")}` : "") +
      (env.hidden ? `. eye's route reports ${env.hidden} hidden row(s) in its own, larger box.` : ".");
  }
  const dir = path.join(HERE, "snapshots", snapshotId);
  mkdirSync(dir, { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(path.join(dir, "records.jsonl"), body);
  const manifest = {
    schemaVersion: "manifest/1",
    snapshotId,
    collection,
    region: { ...region, rule: "point-in-bbox", definition: "Point records whose longitude and latitude fall inside the box, edges included; the publisher's count uses the same box." },
    createdAt,
    builder: { name: "groundtruth data/schema/fixtures/build-fixtures.mjs", version: VERSION, gitSha, repo: "github.com/jcdavis131/groundtruth" },
    recordSchemaVersion: "record/1",
    sources: [...new Map(records.map((r) => [r.provenance.sourceId, { sourceId: r.provenance.sourceId, licence: r.provenance.licence }])).values()],
    requests,
    recordCount: records.length,
    publisherCount,
    files: [{ path: "records.jsonl", format: "jsonl", sha256: sha256(Buffer.from(body)), bytes: Buffer.byteLength(body), records: records.length }],
    ...(cfg.withheld.length ? { withheldFields: cfg.withheld } : {}),
    ...embeddableFor(collection),
  };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const errs = [...validateManifest(manifest), ...verifyFiles(manifest, dir), ...records.flatMap(validateRecord)];
  if (errs.length) throw new Error(`${snapshotId} is not valid:\n${errs.map((e) => `  ${e.code} ${e.path} ${e.message}`).join("\n")}`);
  return { snapshotId, records };
}

const repo = path.resolve(HERE, "../../..");
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--", "data/schema/validate.mjs", "data/schema/embeddable.mjs", "apps/map/lib/catalog/embedFields.ts", "data/schema/fixtures/build-fixtures.mjs", "data/schema/record.schema.json", "data/schema/manifest.schema.json"))
  throw new Error("commit the validator, schemas and this builder first: the manifests name that commit");
const gitSha = git("rev-parse", "HEAD");
mkdirSync(path.join(HERE, "record", "valid"), { recursive: true });
for (const s of SNAPSHOTS) {
  const { snapshotId, records } = await build(s, gitSha);
  const first = records[0];
  writeFileSync(path.join(HERE, "record", "valid", `${snapshotId.split(".").slice(0, 2).join(".")}.json`), JSON.stringify(first, null, 2) + "\n");
  console.log(`${snapshotId}: ${records.length} records`);
}
