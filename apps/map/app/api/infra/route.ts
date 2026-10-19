// Infrastructure API: transmission lines, pipelines, rail, public-use airports,
// dams, hospitals, power plants, Quaternary faults, landslides, the PLSS grid with its
// Township-Range-Section search, and the geologic map unit at a point. Keyless
// federal services (and Macrostrat), CORS open and edge-cached like /api/land,
// with the shared envelope (lib/server/respond.ts).
//
//   /api/infra?op=transmission&bbox=w,s,e,n  HIFLD transmission lines (the archived 2024-09-30
//                                            snapshot Esri hosts): voltage, owner, substations.
//                                            Box at most 2 degrees; highest voltage first.
//   /api/infra?op=pipelines&bbox=…           EIA natural gas, crude, products and HGL pipelines
//                                            (Esri's federal caches). Box at most 4 degrees.
//   /api/infra?op=rail&bbox=…                FRA/BTS North American Rail Network lines, minus
//                                            removed track and trails. Box at most 1 degree.
//   /api/infra?op=airports&bbox=…            FAA public-use airports, heliports and seaplane
//                                            bases (PRIVATEUSE=0 only). Box at most 8 degrees.
//   /api/infra?op=dams&bbox=…                USACE National Inventory of Dams: hazard potential,
//                                            condition, height, storage. Box at most 1.5 degrees.
//   /api/infra?op=hospitals&bbox=…[&status=all] HIFLD hospitals (FEMA RAPT's copy, the last
//                                            public one). A box over 20 degrees gets every
//                                            hospital nationally as packed rows (one pull held
//                                            a day); a smaller box the full record as GeoJSON.
//                                            Open only unless status=all.
//   /api/infra?op=plants&bbox=…&min=MW       EIA-860M plants (bundled monthly snapshot) and
//                                            Wikidata nuclear plants outside the US. Any box;
//                                            past one response's size, the largest US plants.
//   /api/infra?op=faults&bbox=…              USGS Quaternary faults. Box at most 1.5 degrees.
//   /api/infra?op=landslides&bbox=…          USGS landslide inventory points. Box at most 0.5.
//   /api/infra?op=plss&bbox=…&level=section  BLM PLSS townships (2 degrees) or sections (0.4).
//   /api/infra?op=plss-search&q=T12N R3W S33 the townships or sections a T-R-S names.
//   /api/infra?op=geology&lon=..&lat=..      Macrostrat geologic map units at a point.
//
// Every query asks for an explicit field list: owner and operator names are
// relayed as the registry publishes them, but NID's representative and
// designer names, any street address, and free-text notes (the landslide
// inventory's quote news stories naming homeowners) are never requested. The one
// address requested is a hospital's: an institution's, as its state licensing
// source publishes it; its telephone and staff count are not. Nothing here
// searches by an owner or operator; the T-R-S search reads survey numbers only.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { arcgisQuery, envelope, truncated, type ArcgisFc } from "@/lib/server/arcgis";
import { jsonError, polite, upstreamJson } from "@/lib/server/upstream";
import { badRequest, ok, options, withCors } from "@/lib/server/respond";
import { preferIpv4, retrying } from "@/lib/server/net";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source, type SourceId } from "@/lib/provenance/sources";
import type { LayerFeature } from "@/lib/layers/types";
import {
  buildAirports,
  buildDams,
  buildFaults,
  buildLandslides,
  buildPipelines,
  buildPlss,
  buildRail,
  buildTransmission,
  PIPELINE_LABEL,
  type PipelineKind,
  type Row,
} from "@/lib/infra/features";
import { eiaPlants, largestFirst, wikidataNuclear, type EiaSnapshot, type WikidataSnapshot } from "@/lib/infra/plants";
import { parseTrs, plssCandidates, sectionWhere, townshipWhere, trsLabel } from "@/lib/infra/plss";
import { parseMacrostrat } from "@/lib/infra/geology";
import {
  buildHospitals,
  HOSPITAL_FIELDS,
  HOSPITAL_NATIONAL_FIELDS,
  HOSPITALS_BOX_MAX_DEG,
  HOSPITALS_CAVEAT,
  HOSPITALS_DATA_EDIT,
  HOSPITALS_MAX_PAGES,
  HOSPITALS_NATIONAL_MIN_DEG,
  HOSPITALS_PAGE,
  HOSPITALS_URL,
  hospitalWhere,
  NATIONAL_COLUMNS,
  packNational,
  type HospitalStatus,
} from "@/lib/infra/hospitals";
import { CMS_RATINGS_CAVEAT, CMS_QUERY, type CmsBake } from "@/lib/infra/cms";

export const maxDuration = 60;
export const OPTIONS = options;

// earthquake.usgs.gov (Qfaults) sits behind CloudFront, whose IPv6 path reset connections in probing.
preferIpv4();

const ESRI_FED = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services";
const TRANSMISSION = `${ESRI_FED}/US_Electric_Power_Transmission_Lines/FeatureServer/0`;
const PIPELINES: Record<PipelineKind, string> = {
  natgas: `${ESRI_FED}/Natural_Gas_Interstate_and_Intrastate_Pipelines_1/FeatureServer/0`,
  crude: `${ESRI_FED}/Crude_Oil_Trunk_Pipelines_1/FeatureServer/0`,
  products: `${ESRI_FED}/Petroleum_Products_Pipelines_1/FeatureServer/0`,
  hgl: `${ESRI_FED}/Hydrocarbon_Gas_Liquids_Pipelines_1/FeatureServer/0`,
};
const RAIL = "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0";
const AIRPORTS = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0";
const NID = "https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0";
const QFAULTS = "https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer/21";
const LANDSLIDES = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/US_Landslide_point_v2/FeatureServer/11";
const PLSS = "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer";
const MACROSTRAT = "https://macrostrat.org/api/v2/geologic_units/map";

/** HIFLD's own words on the archived item (arcgis.com item d4090758…, read 2026-09-26). */
const HIFLD_LAST_UPDATE = "2024-09-30";

const DAY = 24 * 3600_000;
const INFRA_DEADLINE = { deadlineMs: 50_000 };
/** Vercel refuses function bodies over 4.5 MB; line layers re-ask coarser past this. */
const MAX_BYTES = 3_200_000;

const fetchedAt = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();
const BOX_CAVEAT = "Only the returned `bbox` was loaded; outside it nothing is loaded, which is not the same as nothing being there.";

type Bbox = [number, number, number, number];

/** Clamp to `span` degrees around the centre and snap outward to a `grid` degree grid. */
function snapBbox(v: Bbox, span: number, grid: number): Bbox {
  let [w, s, e, n] = v;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  w = Math.max(w, cx - span / 2, -180);
  e = Math.min(e, cx + span / 2, 180);
  s = Math.max(s, cy - span / 2, -90);
  n = Math.min(n, cy + span / 2, 90);
  const f = (x: number) => Number((Math.floor(x / grid) * grid).toFixed(4));
  const c = (x: number) => Number((Math.ceil(x / grid) * grid).toFixed(4));
  return [f(w), f(s), c(e), c(n)];
}

function parseBbox(raw: string | null, span: number, grid: number): Bbox | null {
  const v = (raw ?? "").split(",").map((x) => (x.trim() === "" ? NaN : Number(x)));
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  if (v[0] >= v[2] || v[1] >= v[3]) return null;
  return snapBbox(v as Bbox, span, grid);
}

interface OpResult {
  data: unknown;
  meta: Record<string, unknown>;
  ttlS: number;
  provenance: Provenance[];
  caveats?: string[];
}

interface BoxQuery {
  name: SourceId;
  url: string;
  gate: string;
  where?: string;
  outFields: string;
  /** Generalisation in degrees for line and polygon layers. */
  offset?: number;
  orderBy?: string;
  max?: number;
  timeoutMs?: number;
  tries?: number;
}

function boxQuery(bbox: Bbox, q: BoxQuery, offset = q.offset, max = q.max): Promise<ArcgisFc> {
  return arcgisQuery(
    q.name,
    q.url,
    {
      where: q.where ?? "1=1",
      ...envelope(bbox),
      outFields: q.outFields,
      returnGeometry: "true",
      ...(offset != null ? { maxAllowableOffset: String(offset), geometryPrecision: "5" } : {}),
      ...(q.orderBy ? { orderByFields: q.orderBy } : {}),
      ...(max ? { resultRecordCount: String(max) } : {}),
    },
    { gate: q.gate, minIntervalMs: 250, timeoutMs: q.timeoutMs ?? 25_000, tries: q.tries ?? 2 },
  );
}

/**
 * A line layer's box: one query, and if the built answer would pass the response
 * budget, one coarser query with half the records (largest first) instead of an
 * answer the platform refuses.
 */
async function lineBox(bbox: Bbox, q: BoxQuery, build: (rows: Row[]) => LayerFeature[]) {
  let offset = q.offset;
  let fc = await boxQuery(bbox, q, offset);
  let features = build(fc.features as Row[]);
  let capped = truncated(fc);
  let coarsened = false;
  if (JSON.stringify(features).length > MAX_BYTES && offset != null) {
    offset *= 3;
    fc = await boxQuery(bbox, q, offset, Math.max(200, Math.floor(fc.features.length / 2)));
    features = build(fc.features as Row[]);
    capped = true;
    coarsened = true;
  }
  return { features, truncated: capped, coarsened, offset };
}

const fc = (features: LayerFeature[]) => ({ type: "FeatureCollection", features });

function boxMeta(label: string, bbox: Bbox, r: { truncated: boolean; coarsened?: boolean; offset?: number }, age: number, extra: Record<string, unknown> = {}) {
  return { source: label, bbox, truncated: r.truncated, coarsenedForSize: r.coarsened ?? false, generalisationDeg: r.offset ?? null, cacheAge: age, ...extra };
}

// ---------------------------------------------------------------- transmission

async function opTransmission(bbox: Bbox): Promise<OpResult> {
  const wide = bbox[3] - bbox[1] > 1;
  const q: BoxQuery = {
    name: "hifld-transmission",
    url: TRANSMISSION,
    gate: "esri-federal",
    outFields: "ID,TYPE,STATUS,OWNER,VOLTAGE,VOLT_CLASS,INFERRED,SUB_1,SUB_2,SOURCEDATE,VAL_DATE",
    offset: wide ? 0.002 : 0.0003,
    orderBy: "VOLTAGE DESC",
  };
  const r = await cached("tl:" + bbox.join(","), 7 * DAY, () => lineBox(bbox, q, (rows) => buildTransmission(rows as never)), INFRA_DEADLINE);
  const caveats = [
    `HIFLD archived this map: its last data update was ${HIFLD_LAST_UPDATE}, so lines built, rebuilt or retired since are not shown as they are now.`,
    "Owners and substations are as HIFLD published them; they are not searchable here and nothing is joined from another source.",
    BOX_CAVEAT,
  ];
  if (r.value.truncated) caveats.push("The service's record limit was hit: the highest-voltage lines in the box are returned first; ask for a smaller box for the rest.");
  return {
    data: fc(r.value.features),
    meta: boxMeta("HIFLD U.S. Electric Power Transmission Lines (archive)", bbox, r.value, r.age, { lastDataUpdate: HIFLD_LAST_UPDATE }),
    ttlS: 6 * 3600,
    provenance: [
      provenance(source("hifld-transmission"), {
        kind: "published",
        seriesId: "US_Electric_Power_Transmission_Lines FeatureServer layer 0",
        upstreamUrl: TRANSMISSION,
        period: HIFLD_LAST_UPDATE,
        retrievedAt: fetchedAt(r.age),
        revision: "archived: \"It will no longer be updated or maintained\"",
        notes: [`bbox ${bbox.join(",")}`],
      }),
    ],
    caveats,
  };
}

// ---------------------------------------------------------------- pipelines

async function opPipelines(bbox: Bbox): Promise<OpResult> {
  const wide = bbox[3] - bbox[1] > 2;
  const kinds = Object.keys(PIPELINES) as PipelineKind[];
  // Each commodity is cached on its own: a service that fails is not stored, so the
  // next caller re-asks only that one instead of inheriting a partial answer for a day.
  const parts = await Promise.all(
    kinds.map(async (kind) => {
      const q: BoxQuery = {
        name: "eia-pipelines",
        url: PIPELINES[kind],
        gate: "esri-federal",
        outFields: kind === "natgas" ? "FID,TYPEPIPE,Operator,Status" : "FID,Opername,Pipename",
        offset: wide ? 0.004 : 0.001,
      };
      try {
        const r = await cached(`pipe:${kind}:${bbox.join(",")}`, DAY, () => lineBox(bbox, q, (rows) => buildPipelines(kind, rows)), INFRA_DEADLINE);
        return { kind, ...r.value, age: r.age, error: undefined as string | undefined };
      } catch (err) {
        return { kind, features: [] as LayerFeature[], truncated: false, coarsened: false, offset: q.offset, age: 0, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  if (parts.every((p) => p.error)) throw new Error(`EIA pipelines: ${parts[0].error}`);
  const age = Math.max(...parts.filter((p) => !p.error).map((p) => p.age));
  const features = parts.flatMap((p) => p.features);
  const counts = Object.fromEntries(parts.map((p) => [p.kind, p.error ? null : p.features.length]));
  const caveats = [
    "EIA's generalized national pipeline maps: routes are approximate, with no diameter, pressure, capacity or depth, and they are not for locating a line before digging (call 811).",
    "Operators are as EIA published them; they are not searchable here.",
    BOX_CAVEAT,
  ];
  for (const p of parts) {
    if (p.error) caveats.push(`${PIPELINE_LABEL[p.kind]} pipelines did not answer (${p.error.slice(0, 80)}); they are missing, not absent.`);
    else if (p.coarsened) caveats.push(`${PIPELINE_LABEL[p.kind]} pipelines were too large for one response: fewer segments were asked for, drawn coarser; ask for a smaller box for the rest.`);
    else if (p.truncated) caveats.push(`${PIPELINE_LABEL[p.kind]} pipelines hit the record limit; ask for a smaller box.`);
  }
  return {
    data: fc(features),
    meta: { source: "EIA pipelines (Esri federal caches)", bbox, counts, truncated: parts.some((p) => p.truncated), coarsenedForSize: parts.some((p) => p.coarsened), cacheAge: age },
    ttlS: parts.some((p) => p.error) ? 600 : 6 * 3600,
    provenance: parts
      .filter((p) => !p.error)
      .map((p) =>
        provenance(source("eia-pipelines"), {
          kind: "published",
          seriesId: `${PIPELINE_LABEL[p.kind]} pipelines`,
          upstreamUrl: PIPELINES[p.kind],
          retrievedAt: fetchedAt(p.age),
          notes: [`bbox ${bbox.join(",")}`, `${p.features.length} segments`],
        }),
      ),
    caveats,
  };
}

// ---------------------------------------------------------------- rail

async function opRail(bbox: Bbox): Promise<OpResult> {
  const q: BoxQuery = {
    name: "bts-narn",
    url: RAIL,
    gate: "bts-narn",
    // Physically removed track and rail-trails are not rail.
    where: "NET NOT IN ('R','T')",
    outFields: "FRAARCID,RROWNER1,RROWNER2,RROWNER3,TRKRGHTS1,TRKRGHTS2,TRKRGHTS3,SUBDIV,YARDNAME,PASSNGR,STRACNET,TRACKS,NET,MILES,STATEAB,COUNTRY",
    offset: bbox[3] - bbox[1] > 0.5 ? 0.0005 : 0.0002,
    orderBy: "MILES DESC",
    timeoutMs: 30_000,
  };
  const r = await cached("rail:" + bbox.join(","), DAY, () => lineBox(bbox, q, buildRail), INFRA_DEADLINE);
  const caveats = [
    "Owning railroads are FRA's reporting marks, as published; they are not searchable here.",
    "Abandoned and out-of-service lines are drawn as such; track physically removed and rail-trails are left out.",
    BOX_CAVEAT,
  ];
  if (r.value.truncated) caveats.push("The record limit was hit: the longest segments are returned first; ask for a smaller box for the rest.");
  return {
    data: fc(r.value.features),
    meta: boxMeta("BTS NTAD North American Rail Network Lines", bbox, r.value, r.age),
    ttlS: 6 * 3600,
    provenance: [
      provenance(source("bts-narn"), {
        kind: "published",
        seriesId: "NTAD_North_American_Rail_Network_Lines FeatureServer layer 0",
        upstreamUrl: RAIL,
        retrievedAt: fetchedAt(r.age),
        revision: "updated by FRA and BTS (last on 2026-07-21 when read)",
        notes: [`bbox ${bbox.join(",")}`, "NET not in (R, T)"],
      }),
    ],
    caveats,
  };
}

// ---------------------------------------------------------------- airports

async function opAirports(bbox: Bbox): Promise<OpResult> {
  const r = await cached(
    "air:" + bbox.join(","),
    DAY,
    async () => {
      const f = await boxQuery(bbox, {
        name: "faa-airports",
        url: AIRPORTS,
        gate: "faa-adds",
        // Public use only: a private-use strip often carries a family or ranch name.
        where: "PRIVATEUSE=0",
        outFields: "GLOBAL_ID,IDENT,NAME,ICAO_ID,TYPE_CODE,SERVCITY,STATE,COUNTRY,OPERSTATUS,PRIVATEUSE,ELEVATION,MIL_CODE,IAPEXISTS",
      });
      return { features: buildAirports(f.features as Row[]), truncated: truncated(f) };
    },
    INFRA_DEADLINE,
  );
  const caveats = ["Public-use facilities only (FAA PRIVATEUSE = 0); private-use strips and heliports are left out on purpose.", "Not for navigation: use the FAA's current charts and NOTAMs.", BOX_CAVEAT];
  if (r.value.truncated) caveats.push("The FAA service's record limit was hit; ask for a smaller box.");
  return {
    data: fc(r.value.features),
    meta: { source: "FAA ADDS Airports (public use)", bbox, truncated: r.value.truncated, cacheAge: r.age },
    ttlS: 6 * 3600,
    provenance: [
      provenance(source("faa-airports"), {
        kind: "published",
        seriesId: "US_Airport FeatureServer layer 0, PRIVATEUSE=0",
        upstreamUrl: AIRPORTS,
        retrievedAt: fetchedAt(r.age),
        revision: "FAA republishes airport data every eight weeks (the 56-day cycle)",
        notes: [`bbox ${bbox.join(",")}`],
      }),
    ],
    caveats,
  };
}

// ---------------------------------------------------------------- dams

const NID_FIELDS = [
  "NIDID",
  "NAME",
  "PRIMARY_OWNER_TYPE",
  "PRIMARY_PURPOSE",
  "PURPOSES",
  "PRIMARY_DAM_TYPE",
  "NID_HEIGHT",
  "NID_STORAGE",
  "YEAR_COMPLETED",
  "HAZARD_POTENTIAL",
  "CONDITION_ASSESSMENT",
  "CONDITION_ASSESS_DATE",
  "EAP_PREPARED",
  "RIVER_OR_STREAM",
  "STATE",
  "COUNTYSTATE",
  "OPERATIONAL_STATUS",
  "DATA_UPDATED",
  "SURFACE_AREA",
  "DRAINAGE_AREA",
  "LATITUDE",
  "LONGITUDE",
] as const;

async function opDams(bbox: Bbox): Promise<OpResult> {
  const r = await cached(
    "nid:" + bbox.join(","),
    DAY,
    async () => {
      // No ordering: NID_STORAGE DESC puts the dams with no storage figure first (probed), so a capped answer would not be "largest first".
      const f = await boxQuery(bbox, { name: "usace-nid", url: NID, gate: "usace-nid", outFields: NID_FIELDS.join(",") });
      return { features: buildDams(f.features as Row[]), truncated: truncated(f) };
    },
    INFRA_DEADLINE,
  );
  const caveats = [
    "Hazard potential is the damage a failure would cause downstream (High: loss of life likely), not the dam's condition and not how likely it is to fail.",
    "Condition assessments are the regulating agency's, with the date it assessed; many dams have none published.",
    "No owner or representative names are requested; the owner type is NID's.",
    BOX_CAVEAT,
  ];
  if (r.value.truncated) caveats.push("NID's record limit was hit; ask for a smaller box for every dam.");
  return {
    data: fc(r.value.features),
    meta: { source: "USACE National Inventory of Dams", bbox, truncated: r.value.truncated, cacheAge: r.age },
    ttlS: 6 * 3600,
    provenance: [
      provenance(source("usace-nid"), {
        kind: "published",
        seriesId: "National_Inventory_of_Dams_Public_Service FeatureServer layer 0",
        upstreamUrl: NID,
        retrievedAt: fetchedAt(r.age),
        revision: "NID is updated continuously by the states and federal agencies; each record carries its own update date",
        notes: [`bbox ${bbox.join(",")}`],
      }),
    ],
    caveats,
  };
}

// ---------------------------------------------------------------- hospitals (HIFLD via FEMA RAPT)

/** The baked CMS join (round 8, about 400 kB, loaded on the first box-tier call): the full record carries CMS's star rating where one CMS row and one HIFLD row share an address. */
let cmsData: Promise<CmsBake> | null = null;
function cmsBake() {
  cmsData ??= import("@/lib/infra/data/cms-hospitals.json").then((m) => (m.default ?? m) as unknown as CmsBake);
  return cmsData;
}
const HOSPITALS_GATE = { gate: "fema-rapt-hospitals", minIntervalMs: 250, timeoutMs: 25_000, tries: 2 };

/** Every hospital of a status, paged by FID until FEMA says the answer is whole. */
async function hospitalsNational(status: HospitalStatus) {
  const rows: ArcgisFc["features"] = [];
  let cut = false;
  for (let page = 0; page < HOSPITALS_MAX_PAGES; page++) {
    const f = await arcgisQuery(
      "hifld-hospitals",
      HOSPITALS_URL,
      { where: hospitalWhere(status), outFields: HOSPITAL_NATIONAL_FIELDS.join(","), returnGeometry: "true", outSR: "4326", geometryPrecision: "5", orderByFields: "FID", resultRecordCount: String(HOSPITALS_PAGE), resultOffset: String(page * HOSPITALS_PAGE) },
      HOSPITALS_GATE,
    );
    rows.push(...f.features);
    cut = truncated(f);
    if (!cut) break;
  }
  return { rows: packNational(rows as Row[]), truncated: cut };
}

async function opHospitals(bbox: Bbox, status: HospitalStatus): Promise<OpResult> {
  const national = bbox[2] - bbox[0] > HOSPITALS_NATIONAL_MIN_DEG || bbox[3] - bbox[1] > HOSPITALS_NATIONAL_MIN_DEG;
  const box: Bbox = national ? bbox : snapBbox(bbox, HOSPITALS_BOX_MAX_DEG, 0.25);
  if (national) {
    const n = await cached(`hosp:national:${status}`, DAY, () => hospitalsNational(status), INFRA_DEADLINE);
    return hospitalsResult({ columns: [...NATIONAL_COLUMNS], rows: n.value.rows }, n.value.rows.length, n.value.truncated, n.age, true, bbox, status);
  }
  const r = await cached(
    `hosp:${status}:${box.join(",")}`,
    DAY,
    async () => {
      const f = await boxQuery(box, { name: "hifld-hospitals", url: HOSPITALS_URL, gate: HOSPITALS_GATE.gate, where: hospitalWhere(status), outFields: HOSPITAL_FIELDS.join(","), orderBy: "FID" });
      const cms = await cmsBake();
      return { features: buildHospitals(f.features as Row[], false, { rows: cms.rows, modified: cms.meta.cmsModified }), truncated: truncated(f) };
    },
    INFRA_DEADLINE,
  );
  return hospitalsResult(fc(r.value.features), r.value.features.length, r.value.truncated, r.age, false, box, status);
}

function hospitalsResult(data: unknown, count: number, cut: boolean, age: number, national: boolean, box: Bbox, status: HospitalStatus): OpResult {
  const caveats = [
    HOSPITALS_CAVEAT,
    "Beds and trauma levels are as published; -999 beds and 'NOT AVAILABLE' are shown as not published, never 0. Names and addresses are institutions' as their licensing sources publish them; no telephone, staff or patient field is requested.",
    status === "open" ? "Open hospitals only (STATUS = 'OPEN'); ask status=all for the hospitals HIFLD lists as closed too." : "Open and closed hospitals, as HIFLD's STATUS says.",
  ];
  if (national) caveats.push("Every hospital in the United States and territories as packed rows (`columns`, then `rows`: ID, NAME, CITY, STATE, TYPE, STATUS, BEDS, TRAUMA, COUNTYFIPS, lon, lat, values as published); ask a box of 20 degrees or less for the full record as GeoJSON (clamped to 6 degrees around its centre).");
  else caveats.push(BOX_CAVEAT, CMS_RATINGS_CAVEAT);
  if (cut) caveats.push(national ? `FEMA's answer was still cut after ${HOSPITALS_MAX_PAGES} pages: some hospitals are missing from this answer.` : "The record limit was hit; ask a smaller box for every hospital.");
  return {
    data,
    meta: { source: "HIFLD Hospitals (FEMA RAPT copy)", bbox: national ? null : box, national, status, count, truncated: cut, dataLastEdited: HOSPITALS_DATA_EDIT, cacheAge: age },
    ttlS: 6 * 3600,
    provenance: [
      provenance(source("hifld-hospitals"), {
        kind: "published",
        seriesId: `Hospitals_RAPT FeatureServer layer 6, ${hospitalWhere(status)}${national ? ", national, packed rows" : ""}`,
        upstreamUrl: HOSPITALS_URL,
        period: `data last edited ${HOSPITALS_DATA_EDIT}`,
        retrievedAt: fetchedAt(age),
        revision: "FEMA's copy of HIFLD's hospital layer; each row carries its own SOURCEDATE",
        notes: national ? ["national"] : [`bbox ${box.join(",")}`],
      }),
      ...(national
        ? []
        : [
            provenance(source("cms-provider-data"), {
              kind: "published",
              seriesId: "Hospital General Information (xubh-q36u): hospital_overall_rating and its footnote, hospital_type, hospital_ownership, emergency_services, birthing-friendly; joined to HIFLD by street address + ZIP, one to one only, exactly or in a second pass with a PO box or drawer removed, ordinal street words as numbers and U S as US (lib/infra/data/cms-hospitals.json)",
              upstreamUrl: CMS_QUERY,
              period: "dataset modified 2026-07-22",
              retrievedAt: "2026-10-17T00:00:00.000Z",
              method: "baked by scripts/bake-cms-hospitals.mjs; a key shared by two hospitals on either side is never attached, and a match whose HIFLD name or type marks a tenant of another hospital is refused (tenantConflict)",
              notes: ["Centers for Medicare & Medicaid Services, Care Compare (Hospital General Information); no licence stated"],
            }),
          ]),
    ],
    caveats,
  };
}

// ---------------------------------------------------------------- power plants (bundled snapshots)

let eiaData: Promise<EiaSnapshot> | null = null;
let wdData: Promise<WikidataSnapshot> | null = null;
function plantData() {
  eiaData ??= import("@/lib/infra/data/plants-eia860m.json").then((m) => (m.default ?? m) as unknown as EiaSnapshot);
  wdData ??= import("@/lib/infra/data/nuclear-wikidata.json").then((m) => (m.default ?? m) as unknown as WikidataSnapshot);
  return Promise.all([eiaData, wdData]);
}

async function opPlants(bbox: Bbox, minMw: number): Promise<OpResult> {
  const [eia, wd] = await plantData();
  const nuclear = wikidataNuclear(wd, bbox);
  // Every US plant in a large box does not fit in one response (the world at min=0 is
  // about 12 MB): past the budget, the largest are kept. The Wikidata set is small and
  // always sent whole.
  const matched = eiaPlants(eia, bbox, minMw);
  const cap = largestFirst(matched, MAX_BYTES - JSON.stringify(nuclear).length);
  const us = cap.features;
  const caveats = [
    `EIA-860M is EIA's preliminary monthly inventory (${eia.inventoryAsOf}); capacities are nameplate megawatts summed over each plant's generators of 1 MW or more, and a generator with no nameplate value is counted, not added as 0.`,
    "Outside the United States, only nuclear plants are shown, from Wikidata (CC0); their status and capacity are Wikidata's and can be missing. Capacity is Wikidata's best-rank nameplate statement (its preferred one when it marks one), with the dates Wikidata gives; where several figures remain, the most recent sizes the plant, and none does when Wikidata's figures are not dated well enough to tell which is current.",
    "The reporting entity is as EIA publishes it; it is not searchable here and nothing is joined across the two sources.",
  ];
  if (minMw > 0) caveats.push(`Only US plants of at least ${minMw} MW (operating or planned) are returned; ask with min=0 (and a box small enough to fit one response) for every plant.`);
  if (cap.truncated)
    caveats.push(
      `This box holds ${matched.length.toLocaleString("en-US")} US plants, more than one response carries: the ${us.length.toLocaleString("en-US")} largest are returned (by the larger of operating and planned nameplate MW, down to ${cap.floorMw ?? 0} MW). Ask with a higher min or a smaller box for the rest.`,
    );
  return {
    data: fc([...us, ...nuclear]),
    meta: { source: "EIA-860M + Wikidata", bbox, minMW: minMw, truncated: cap.truncated, counts: { eia: us.length, wikidata: nuclear.length }, matched: { eia: matched.length }, inventoryAsOf: eia.inventoryAsOf, snapshotsPulled: { eia: eia.pulled, wikidata: wd.pulled } },
    ttlS: 24 * 3600,
    provenance: [
      provenance(source("eia-860m"), {
        kind: "published",
        seriesId: eia.file.replace(/^.*\//, ""),
        upstreamUrl: eia.file,
        period: eia.inventoryAsOf,
        releasedAt: eia.lastModified ? new Date(eia.lastModified).toISOString().slice(0, 10) : undefined,
        retrievedAt: `${eia.pulled}T00:00:00.000Z`,
        revision: "preliminary; EIA replaces it each month and with the annual EIA-860",
        notes: ["bundled snapshot (scripts/infra-data.mjs)", `bbox ${bbox.join(",")}`],
      }),
      provenance(source("wikidata"), {
        kind: "published",
        seriesId: "SPARQL: instance of nuclear power plant (Q134447) or a subclass, with coordinates, outside the US",
        upstreamUrl: "https://query.wikidata.org/",
        retrievedAt: `${wd.pulled}T00:00:00.000Z`,
        notes: ["bundled snapshot (scripts/infra-data.mjs)"],
      }),
    ],
    caveats,
  };
}

// ---------------------------------------------------------------- faults and landslides

async function opFaults(bbox: Bbox): Promise<OpResult> {
  const q: BoxQuery = {
    name: "usgs-qfaults",
    url: QFAULTS,
    gate: "usgs-qfaults",
    outFields: "fault_name,section_name,fault_id,section_id,age,slip_rate,slip_sense,mapped_scale,class,mapped_certainty,dip_direction,linetype,fault_url,last_review",
    offset: bbox[3] - bbox[1] > 0.6 ? 0.0015 : 0.0004,
    // Longest traces first, so a capped answer keeps the major faults (probed: supportsOrderBy).
    orderBy: "Shape_Length DESC",
    timeoutMs: 20_000,
    // The Qfaults host reset connections in probing; three tries.
    tries: 3,
  };
  const r = await cached("qf:" + bbox.join(","), 7 * DAY, () => lineBox(bbox, q, buildFaults), INFRA_DEADLINE);
  const caveats = [
    "Faults USGS judges active in the Quaternary (about the last 1.6 million years), coloured by the age of the most recent deformation; this is not a forecast of earthquakes, and a place with no mapped fault is not a place with no earthquake hazard.",
    "Positions are as mapped, at the scale in each record; an inferred trace is drawn dashed.",
    BOX_CAVEAT,
  ];
  if (r.value.truncated) caveats.push("The record limit was hit: the longest traces are returned first; ask for a smaller box for every fault.");
  return {
    data: fc(r.value.features),
    meta: boxMeta("USGS Quaternary Fault and Fold Database", bbox, r.value, r.age),
    ttlS: 12 * 3600,
    provenance: [provenance(source("usgs-qfaults"), { kind: "published", seriesId: "Qfaults MapServer layer 21 (National Database)", upstreamUrl: QFAULTS, retrievedAt: fetchedAt(r.age), notes: [`bbox ${bbox.join(",")}`] })],
    caveats,
  };
}

async function opLandslides(bbox: Bbox): Promise<OpResult> {
  const r = await cached(
    "usls:" + bbox.join(","),
    7 * DAY,
    async () => {
      const f = await boxQuery(bbox, {
        name: "usgs-landslides",
        url: LANDSLIDES,
        gate: "usgs-landslides",
        // No Notes: its free text quotes news stories that name homeowners and give street addresses.
        outFields: "USGS_ID,Date_Min,Date_Max,Fatalities,Confidence,LS_Type,Inventory,Inv_URL,Info_Sourc",
        orderBy: "Confidence DESC",
      });
      return { features: buildLandslides(f.features as Row[]), truncated: truncated(f) };
    },
    INFRA_DEADLINE,
  );
  const caveats = [
    "A compilation of other inventories: coverage depends on where someone mapped landslides, so a place with none mapped is not a place without landslides.",
    "Confidence is USGS's rating of the entry's location and extent (higher is more confident); the rules differ by source inventory (us_ls_v3_analyses.csv in the data release).",
    BOX_CAVEAT,
  ];
  if (r.value.truncated) caveats.push("The record limit was hit: the most confident entries are returned first; ask for a smaller box for the rest.");
  return {
    data: fc(r.value.features),
    meta: { source: "USGS Landslide Inventories across the United States v3", bbox, truncated: r.value.truncated, cacheAge: r.age },
    ttlS: 12 * 3600,
    provenance: [
      provenance(source("usgs-landslides"), {
        kind: "published",
        seriesId: "US_Landslide_point_v2 FeatureServer layer 11 (US_Landslide_v3point)",
        upstreamUrl: LANDSLIDES,
        period: "version 3.0, 2025-02",
        retrievedAt: fetchedAt(r.age),
        notes: [`bbox ${bbox.join(",")}`],
      }),
    ],
    caveats,
  };
}

// ---------------------------------------------------------------- PLSS

async function opPlss(bbox: Bbox, level: "township" | "section"): Promise<OpResult> {
  const q: BoxQuery =
    level === "township"
      ? { name: "blm-plss", url: `${PLSS}/1`, gate: "blm-plss", outFields: "PLSSID,STATEABBR,PRINMERCD,PRINMER,TWNSHPLAB", offset: 0.001 }
      : { name: "blm-plss", url: `${PLSS}/2`, gate: "blm-plss", outFields: "PLSSID,FRSTDIVID,FRSTDIVNO,FRSTDIVLAB,FRSTDIVTXT", offset: 0.0001 };
  const r = await cached(`plss:${level}:${bbox.join(",")}`, 30 * DAY, () => lineBox(bbox, q, (rows) => buildPlss(level, rows)), INFRA_DEADLINE);
  const caveats = [
    "The Public Land Survey System covers 30 states; Texas and the original colonies were never surveyed into townships and sections, so there is nothing to draw there.",
    "BLM's compiled grid (CadNSDI), for reference: not a survey, and not a parcel boundary.",
    BOX_CAVEAT,
  ];
  if (r.value.truncated) caveats.push("The record limit was hit; ask for a smaller box.");
  return {
    data: fc(r.value.features),
    meta: boxMeta(`BLM National PLSS (CadNSDI) ${level}s`, bbox, r.value, r.age, { level }),
    ttlS: 24 * 3600,
    provenance: [provenance(source("blm-plss"), { kind: "published", seriesId: `CadNSDI MapServer layer ${level === "township" ? 1 : 2} (PLSS ${level === "township" ? "Township" : "Section"})`, upstreamUrl: PLSS, retrievedAt: fetchedAt(r.age), notes: [`bbox ${bbox.join(",")}`] })],
    caveats,
  };
}

async function opPlssSearch(raw: string): Promise<OpResult | null> {
  const q = parseTrs(raw);
  if (!q) return null;
  const key = `plss-search:${trsLabel(q)}:${q.state ?? ""}`;
  const r = await cached(
    key,
    30 * DAY,
    async () => {
      const t = await arcgisQuery(
        "blm-plss",
        `${PLSS}/1`,
        { where: townshipWhere(q), outFields: "PLSSID,STATEABBR,PRINMER,TWNSHPLAB", returnGeometry: "true", maxAllowableOffset: "0.005", geometryPrecision: "4", outSR: "4326" },
        { gate: "blm-plss", minIntervalMs: 250, timeoutMs: 20_000, tries: 2 },
      );
      let s: ArcgisFc | null = null;
      if (q.section != null && t.features.length) {
        const ids = t.features.map((f) => String((f.properties as Record<string, unknown>).PLSSID ?? "")).slice(0, 60);
        s = await arcgisQuery(
          "blm-plss",
          `${PLSS}/2`,
          { where: sectionWhere(ids, q.section), outFields: "PLSSID,FRSTDIVID,FRSTDIVNO,FRSTDIVTXT", returnGeometry: "true", maxAllowableOffset: "0.0005", geometryPrecision: "5", outSR: "4326" },
          { gate: "blm-plss", minIntervalMs: 250, timeoutMs: 20_000, tries: 2 },
        );
      }
      return plssCandidates(q, t.features as Row[], s ? (s.features as Row[]) : null);
    },
    { deadlineMs: 25_000 },
  );
  return {
    data: r.value,
    meta: { source: "BLM National PLSS (CadNSDI)", query: trsLabel(q) + (q.state ? ` ${q.state}` : ""), parsed: q, count: r.value.length, cacheAge: r.age },
    ttlS: 24 * 3600,
    provenance: [provenance(source("blm-plss"), { kind: "published", seriesId: "CadNSDI layers 1 and 2", upstreamUrl: PLSS, retrievedAt: fetchedAt(r.age) })],
    caveats: [
      "A township and range repeat under every principal meridian: without a state, every match is listed.",
      "The search reads survey numbers only; it never reads an owner, a name or an address.",
    ],
  };
}

// ---------------------------------------------------------------- geology at a point

async function opGeology(lon: number, lat: number): Promise<OpResult> {
  const x = Number(lon.toFixed(4));
  const y = Number(lat.toFixed(4));
  const url = `${MACROSTRAT}?lat=${y}&lng=${x}`;
  const r = await cached(
    `geo:${x},${y}`,
    30 * DAY,
    () => retrying(() => polite("macrostrat", 200, 30_000, () => upstreamJson("macrostrat", url, { timeoutMs: 15_000 })), 2).then(parseMacrostrat),
    { deadlineMs: 20_000 },
  );
  return {
    data: { lon: x, lat: y, ...r.value },
    meta: { source: "Macrostrat geologic_units/map", cacheAge: r.age },
    ttlS: 24 * 3600,
    provenance: [provenance(source("macrostrat"), { kind: "published", seriesId: "geologic_units/map", upstreamUrl: url, retrievedAt: fetchedAt(r.age), notes: r.value.units.length ? [`${r.value.units.length} map units at this point, most detailed map first`] : ["no mapped unit at this point"] })],
    caveats: [
      "Macrostrat's compilation of published geologic maps at several scales; the first unit is from the most detailed map it holds here, and a unit is drawn at that map's scale.",
      "Cite the map each unit comes from (its `source`) as well as Macrostrat (CC BY 4.0).",
    ],
  };
}

function respond(r: OpResult) {
  return ok(r.data, { meta: r.meta, provenance: r.provenance, caveats: r.caveats, ttlS: r.ttlS });
}

/** A query parameter as a finite number; a missing or blank one is null, never 0 (Number(null) is 0). */
function numParam(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const BBOX_HELP = "bbox=w,s,e,n required, west < east and south < north, e.g. bbox=-98.8,29.2,-98.3,29.6";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  const box = (span: number, grid: number) => parseBbox(q.get("bbox"), span, grid);
  try {
    switch (op) {
      case "transmission": {
        const b = box(2, 0.25);
        return b ? respond(await opTransmission(b)) : badRequest(BBOX_HELP);
      }
      case "pipelines": {
        const b = box(4, 0.5);
        return b ? respond(await opPipelines(b)) : badRequest(BBOX_HELP);
      }
      case "rail": {
        const b = box(1, 0.1);
        return b ? respond(await opRail(b)) : badRequest(BBOX_HELP);
      }
      case "airports": {
        const b = box(8, 1);
        return b ? respond(await opAirports(b)) : badRequest(BBOX_HELP);
      }
      case "dams": {
        const b = box(1.5, 0.25);
        return b ? respond(await opDams(b)) : badRequest(BBOX_HELP);
      }
      case "hospitals": {
        const b = box(360, 0.25);
        if (!b) return badRequest(BBOX_HELP);
        const st = q.get("status") ?? "open";
        if (st !== "open" && st !== "all") return badRequest("status=open (default) | all");
        return respond(await opHospitals(b, st));
      }
      case "plants": {
        const b = box(360, 1);
        if (!b) return badRequest(BBOX_HELP);
        const min = numParam(q.get("min")) ?? 0;
        if (min < 0 || min > 5000) return badRequest("min is a nameplate MW floor from 0 to 5000");
        return respond(await opPlants(b, min));
      }
      case "faults": {
        const b = box(1.5, 0.25);
        return b ? respond(await opFaults(b)) : badRequest(BBOX_HELP);
      }
      case "landslides": {
        const b = box(0.5, 0.1);
        return b ? respond(await opLandslides(b)) : badRequest(BBOX_HELP);
      }
      case "plss": {
        const level = q.get("level") === "township" ? "township" : "section";
        const b = level === "township" ? box(2, 0.25) : box(0.4, 0.05);
        return b ? respond(await opPlss(b, level)) : badRequest(BBOX_HELP);
      }
      case "plss-search": {
        const r = await opPlssSearch(q.get("q") ?? "");
        return r ? respond(r) : badRequest("q must be a township, range and optional section, e.g. q=T12N R3W S33 (optionally followed by a PLSS state, e.g. OK)");
      }
      case "geology": {
        const lon = numParam(q.get("lon"));
        const lat = numParam(q.get("lat"));
        if (lon == null || lat == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return badRequest("lon and lat required, e.g. lon=-104.95&lat=38.85");
        return respond(await opGeology(lon, lat));
      }
      default:
        return badRequest("unknown op: transmission | pipelines | rail | airports | dams | hospitals | plants | faults | landslides | plss | plss-search | geology");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
