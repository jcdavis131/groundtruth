// Water API. One route, several ops, every upstream keyless, CORS open, so
// anyone can call it from a notebook, a script or their own page:
//
//   /api/water?op=gauges&bbox=w,s,e,n   USGS latest-continuous (flow, stage,
//                                       temperature, DO, conductance, pH,
//                                       turbidity, reservoir elevation/storage)
//                                       joined with monitoring-locations for names.
//   /api/water?op=nwps&bbox=w,s,e,n     NOAA NWPS gauges with flood categories.
//   /api/water?op=twdb                  Texas Water Development Board reservoirs.
//   /api/water?op=wells&bbox=w,s,e,n    USGS latest-daily groundwater levels
//                                       (72019 depth to water, 62610/62611
//                                       water-level elevation) joined with
//                                       aquifer names.
//   /api/water?op=drought               US Drought Monitor current polygons
//                                       (simplified, via the USDM ArcGIS service).
//   /api/water?op=history&site=..&param=..            USGS daily values, 365 d.
//   /api/water?op=matchup&site=..&param=..&from=..&to=..  USGS instantaneous values.
//   /api/water?op=normals&sites=08158000,..&date=09-23
//                                       USGS daily-mean discharge percentiles
//                                       (5th to 95th) for a calendar day,
//                                       per site; what the field's streamflow
//                                       condition compares the latest flow to.
//   /api/water?op=impaired&bbox=w,s,e,n EPA ATTAINS assessment units states report
//                                       as impaired (isimpaired='Y'), lines and
//                                       areas, with category, 303(d) listing, TMDL,
//                                       cycle and EPA action status. Box at most
//                                       0.12 degrees, snapped to 0.02; 2,000 per
//                                       layer. A failed layer is unknown, not none.
//   /api/water?op=pfas&bbox=w,s,e,n[&polygons=1]
//                                       PFAS in public drinking water: EPA UCMR 5
//                                       (2023-2025) results per water system that
//                                       serves the box, drawn on EPA's service-area
//                                       polygon (polygons=1) or at EPA's estimated
//                                       location; each system detected, not-detected,
//                                       not-in-ucmr5 or unknown. Box at most 0.12
//                                       degrees, snapped to 0.02. ng/L, never compared
//                                       with a health limit.
//   /api/water?op=reach&lon=..&lat=..   The NHDPlus V2 reach a point drains to: USGS NLDI's
//                                       catchment at the point (comid), then EPA's NHDPlus
//                                       V2.1 attributes by comid (name, NHD type, stream
//                                       order, drainage area, modelled mean annual flow).
//                                       Point snapped to 0.001 degrees; held 30 days. A point
//                                       NLDI has no catchment for answers comid null, not 404.
//   /api/water?op=trace&comid=..&mode=down|basin|gauges[&distance=km]
//                                       One USGS NLDI navigation from that reach: the main
//                                       stem downstream (default 100 km), the drainage basin
//                                       (at most 2,000 vertices), or the USGS stream gauges
//                                       upstream (default 150 km); distance at most 500 km.
//                                       Held 30 days (the network is static between releases).
//   /api/water?op=report&lon=..&lat=..  The community water report for a point,
//                                       built server-side from the ops above
//                                       (no satellite turbidity: that needs a
//                                       browser).
//
// Every response carries `provenance` (one record per upstream the values
// came from, with site, parameter codes and observation time where the call
// knew them) and `generatedAt`; the tabular ops (gauges, wells, nwps, twdb,
// history, matchup) also answer `format=csv` with the provenance as `#`
// footer lines. See docs/API.md.
//
// The USGS API has no documented keyless quota but does throttle; every bbox
// is snapped to a coarse grid so a panning browser reuses the cache, the
// polite() gate keeps concurrent tabs from stampeding one upstream, and
// Cache-Control lets Vercel's edge absorb repeat callers.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError } from "@/lib/server/upstream";
import { badRequest, csv as csvResponse, ok, options, parseFormat, withCors, type CsvRow, type ResponseFormat } from "@/lib/server/respond";
import type { Provenance } from "@/lib/provenance/types";
import { arcgisQuery, arcgisRowsCapped, envelope as arcgisEnvelope, truncated } from "@/lib/server/arcgis";
import { parseBbox as gridBbox, type Bbox as GridBbox } from "@/lib/civic/bbox";
import { ATTAINS, ATTAINS_FIELDS, ATTAINS_LAYERS, ATTAINS_MAX, ATTAINS_WHERE, buildImpaired, IMPAIRED_CAVEAT } from "@/lib/water/impaired";
import type { LayerFeature } from "@/lib/layers/types";
import {
  buildPfasSystems,
  chunkIds,
  CWS_BOUNDARIES,
  CWS_CAVEAT,
  CWS_MAX,
  cwsParams,
  PAT,
  patCentroidParams,
  patResultsParams,
  PFAS_CAVEAT,
  PFAS_MAX_BYTES,
  PFAS_OFFSET,
  PFAS_OFFSET_COARSE,
  pfasFeatures,
  UCMR5,
  type PfasState,
} from "@/lib/water/pfas";
import { usgsProvenance } from "@/lib/water/provenance";
import {
  basinPolygon,
  BASIN_MAX_VERTICES,
  EPA_V21,
  flowlines,
  FLOW_CAVEAT,
  HYDRO_CAVEAT,
  isTraceMode,
  parseComid,
  parseV21,
  positionUrl,
  snapPoint,
  traceDistance,
  traceUrl,
  upstreamGauges,
  v21Params,
  type Reach,
  type TraceMode,
} from "@/lib/water/nldi";
import { polite, UpstreamError, upstreamJson } from "@/lib/server/upstream";
import { retrying } from "@/lib/server/net";
import { flowNormals, MAX_SITES } from "@/lib/water/normals";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { flattenGauges, flattenHistory, flattenMatchup, flattenNwps, flattenTwdb, flattenWells, GAUGE_COLUMNS, HISTORY_COLUMNS, MATCHUP_COLUMNS, NWPS_COLUMNS, TWDB_COLUMNS, WELL_COLUMNS } from "@/lib/water/flatten";
import {
  opDrought,
  opGauges,
  opNwps,
  opTwdb,
  opWells,
  retrievedAt,
  snapBbox,
  usgsItems,
  waterReportAt,
  type Bbox,
  type UsgsRow,
  type WaterOp,
} from "@/lib/water/assemble";

// The readings the layers and the flatteners type against are declared where
// they are produced; re-exported here because that is where they have always
// been imported from.
export type { GaugeReading, WellReading } from "@/lib/water/assemble";

export const maxDuration = 60;

function parseBbox(raw: string | null): Bbox | null {
  const v = (raw ?? "").split(",").map(Number);
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  return snapBbox(v as Bbox);
}

const SITE_RE = /^USGS-\w+$/;
const PARAM_RE = /^\d{5}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ---- op envelopes (each returns data + meta + a TTL for the edge cache). The
// upstream calls, their cache keys and the report assembly live in
// lib/water/assemble.ts so a page can use them without going through HTTP.

interface OpResult {
  data: unknown;
  meta: Record<string, unknown>;
  ttlS: number;
  /** One record per upstream the payload was read from. */
  provenance: Provenance[];
  caveats?: string[];
  /** Tabular ops: how to flatten `data` for `format=csv`. Absent means CSV is not offered for this op. */
  csv?: () => { rows: CsvRow[]; columns: readonly string[]; filename: string };
}

/** This route's envelope around an assembled upstream answer, plus the CSV flattener for the tabular ops. */
function envelope<T>(r: WaterOp<T>, csv?: OpResult["csv"]): OpResult {
  return { data: r.data, meta: r.meta, ttlS: r.ttlS, provenance: r.provenance, csv };
}

async function gaugesOp(bbox: Bbox, param?: string | null): Promise<OpResult> {
  const r = await opGauges(bbox, param);
  const key = bbox.join(",");
  return envelope(r, () => ({ rows: flattenGauges(r.data), columns: GAUGE_COLUMNS, filename: `water-gauges-${key.replace(/,/g, "_")}.csv` }));
}

async function wellsOp(bbox: Bbox): Promise<OpResult> {
  const r = await opWells(bbox);
  const key = bbox.join(",");
  return envelope(r, () => ({ rows: flattenWells(r.data), columns: WELL_COLUMNS, filename: `water-wells-${key.replace(/,/g, "_")}.csv` }));
}

async function nwpsOp(bbox: Bbox): Promise<OpResult> {
  const r = await opNwps(bbox);
  return envelope(r, () => ({ rows: flattenNwps(r.data), columns: NWPS_COLUMNS, filename: `water-nwps-${bbox.join("_")}.csv` }));
}

async function twdbOp(): Promise<OpResult> {
  const r = await opTwdb();
  return envelope(r, () => ({ rows: flattenTwdb(r.data), columns: TWDB_COLUMNS, filename: "water-twdb-reservoirs.csv" }));
}

async function droughtOp(): Promise<OpResult> {
  return envelope(await opDrought());
}

async function opHistory(site: string, param: string): Promise<OpResult> {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 86_400_000);
  const range = from.toISOString().slice(0, 10) + "/" + to.toISOString().slice(0, 10);
  const r = await cached("usgs:daily:" + site + ":" + param, 60 * 60_000, async () => {
    const j = await usgsItems<UsgsRow>("daily", { monitoring_location_id: site, parameter_code: param, datetime: range });
    return j.features
      .filter((f) => f.properties.value != null && (f.properties.statistic_id ?? "00003") === "00003")
      .map((f) => [f.properties.time, Number(f.properties.value)] as [string, number])
      .filter((x) => Number.isFinite(x[1]))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  });
  return {
    data: r.value,
    meta: { source: "usgs", site, param, range, cacheAge: r.age },
    ttlS: 3600,
    provenance: [usgsProvenance({ collection: "daily", site, params: [param], period: range, retrievedAt: retrievedAt(r.age), notes: ["daily mean (statistic 00003)"] })],
    csv: () => ({ rows: flattenHistory(site, param, r.value), columns: HISTORY_COLUMNS, filename: `water-history-${site}-${param}.csv` }),
  };
}

async function opMatchup(site: string, param: string, from: string, to: string): Promise<OpResult> {
  const r = await cached("usgs:iv:" + site + ":" + param + ":" + from + ":" + to, 60 * 60_000, async () => {
    const j = await usgsItems<UsgsRow>("continuous", {
      monitoring_location_id: site,
      parameter_code: param,
      datetime: from + "/" + to,
      limit: "500",
    });
    return j.features
      .filter((f) => f.properties.value != null)
      .map((f) => [f.properties.time, Number(f.properties.value), f.properties.unit_of_measure] as [string, number, string]);
  });
  return {
    data: r.value,
    meta: { source: "usgs", site, param, cacheAge: r.age },
    ttlS: 3600,
    provenance: [usgsProvenance({ collection: "continuous", site, params: [param], period: `${from}/${to}`, retrievedAt: retrievedAt(r.age) })],
    csv: () => ({ rows: flattenMatchup(site, param, r.value), columns: MATCHUP_COLUMNS, filename: `water-matchup-${site}-${param}.csv` }),
  };
}

async function normalsOp(sites: string[], month: number, day: number): Promise<OpResult> {
  const data = await flowNormals(sites, month, day);
  const rated = Object.values(data).filter(Boolean).length;
  return {
    data,
    meta: { source: "usgs-stat", month, day, sites: Object.keys(data).length, rated },
    ttlS: 24 * 3600,
    provenance: [
      provenance(source("usgs-stat"), {
        kind: "published",
        period: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        method: "observationNormals, day of year: percentiles (5th to 95th) of approved daily-mean discharge (00060) for the calendar day",
      }),
    ],
    caveats: [
      "Percentiles are of approved daily means; comparing an instantaneous reading with them is an estimate of where today stands.",
      "A site with fewer years of record, or regulated flow, has less meaningful percentiles; `years` says how many are behind each table.",
    ],
  };
}

/** The community water report, server-side, plus the globe permalink that reproduces it in the browser. */
async function reportOp(lon: number, lat: number, origin: string): Promise<OpResult> {
  const a = await waterReportAt(lon, lat);
  const globe = `${origin}/?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&h=120000&layers=water,groundwater,turbidity&report=1`;
  // Per-section provenance and citations live on the report; the envelope repeats the union.
  return { data: a.report, meta: { source: "usgs+nwps+twdb+usdm", bbox: a.bbox, globe }, ttlS: 300, provenance: a.report.provenance, caveats: a.report.caveats };
}

const DAY_MS = 24 * 3600_000;

/**
 * EPA ATTAINS impaired assessment units in a box: lines (layer 1) and areas (layer 2) in
 * parallel, each cached a day. A layer that fails is reported as unknown in `coverage`
 * (count null), never as none; both failing is an upstream error.
 */
async function impairedOp(bbox: GridBbox): Promise<OpResult> {
  const ask = (shape: "lines" | "areas") =>
    cached(`attains:${shape}:${bbox.join(",")}`, DAY_MS, async () => {
      const fc = await arcgisQuery(
        "epa-attains",
        `${ATTAINS}/${ATTAINS_LAYERS[shape]}`,
        {
          where: ATTAINS_WHERE,
          ...arcgisEnvelope(bbox),
          outFields: ATTAINS_FIELDS.join(","),
          returnGeometry: "true",
          geometryPrecision: "5",
          maxAllowableOffset: "0.0002",
          resultRecordCount: String(ATTAINS_MAX),
        },
        { gate: "epa-attains", minIntervalMs: 250, timeoutMs: 25_000, tries: 2 },
      );
      return { features: buildImpaired(fc.features, shape === "lines" ? "line" : "area"), truncated: truncated(fc) || fc.features.length >= ATTAINS_MAX };
    });
  const [l, a] = await Promise.all([ask("lines").catch((e: unknown) => e as Error), ask("areas").catch((e: unknown) => e as Error)]);
  if (l instanceof Error && a instanceof Error) throw l;
  const lines = l instanceof Error ? null : l;
  const areas = a instanceof Error ? null : a;
  const features: LayerFeature[] = [...(lines?.value.features ?? []), ...(areas?.value.features ?? [])];
  const coverage = [
    { id: "lines", name: "ATTAINS lines (streams)", state: lines ? (lines.value.truncated ? "partial" : "covered") : "error", count: lines ? lines.value.features.length : null },
    { id: "areas", name: "ATTAINS areas (lakes, estuaries, watersheds)", state: areas ? (areas.value.truncated ? "partial" : "covered") : "error", count: areas ? areas.value.features.length : null },
  ];
  const caveats = [IMPAIRED_CAVEAT, "Only the returned `bbox` was loaded; outside it nothing is loaded, which is not the same as nothing being there."];
  if (lines?.value.truncated) caveats.push(`lines: the first ${ATTAINS_MAX.toLocaleString("en-US")} in this box; zoom in for the rest.`);
  if (areas?.value.truncated) caveats.push(`areas: the first ${ATTAINS_MAX.toLocaleString("en-US")} in this box; zoom in for the rest.`);
  if (!lines) caveats.push("EPA's ATTAINS line layer did not answer this time; impaired streams here are unknown, not absent.");
  if (!areas) caveats.push("EPA's ATTAINS area layer did not answer this time; impaired lakes, estuaries and watersheds here are unknown, not absent.");
  const age = Math.max(lines?.age ?? 0, areas?.age ?? 0);
  const prov: Provenance[] = [];
  for (const [shape, r] of [["lines", lines], ["areas", areas]] as const) {
    if (r) prov.push(provenance(source("epa-attains"), { kind: "published", seriesId: `ATTAINS_Assessment FeatureServer layer ${ATTAINS_LAYERS[shape]} (${shape}), ${ATTAINS_WHERE}`, upstreamUrl: `${ATTAINS}/${ATTAINS_LAYERS[shape]}`, retrievedAt: new Date(Date.now() - r.age).toISOString(), notes: [`bbox ${bbox.join(",")}`] }));
  }
  return {
    data: { type: "FeatureCollection", features },
    meta: { source: "U.S. EPA ATTAINS (state, territorial and tribal Integrated Reports)", bbox, coverage, truncated: !!(lines?.value.truncated || areas?.value.truncated), maxRecords: ATTAINS_MAX, cacheAge: age },
    ttlS: lines && areas ? 3600 : 300,
    provenance: prov,
    caveats,
  };
}

/**
 * Seconds for one PAT results chunk. The group-by is slow cold (4.3 s for 17 systems, 11.3 s for
 * 50, 2026-10-15) and fast warm; chunks run in parallel, each is cached a day, and a chunk that
 * does not answer leaves its systems "unknown", never "not detected".
 */
const PAT_TIMEOUT_MS = 20_000;

/**
 * PFAS in public drinking water (UCMR 5) for the systems that serve a box: service areas first
 * (EPA's CWS boundaries; polygons only with `polygons`), then systems EPA places in the box by an
 * estimated location only, then their UCMR 5 results by PWSID. Each cached a day. One answer
 * failing leaves the others; both system lists failing is an upstream error.
 */
async function pfasOp(bbox: GridBbox, polygons: boolean): Promise<OpResult> {
  const box = bbox.join(",");
  const cwsAsk = async () => {
    const q = (offset: string) => arcgisQuery("epa-cws-boundaries", CWS_BOUNDARIES, cwsParams(bbox, polygons, offset), { gate: "epa-cws-boundaries", minIntervalMs: 250, timeoutMs: 25_000, tries: 2 });
    let fc = await q(PFAS_OFFSET);
    let coarse = false;
    if (polygons && JSON.stringify(fc.features).length > PFAS_MAX_BYTES) {
      fc = await q(PFAS_OFFSET_COARSE);
      coarse = true;
    }
    return { features: fc.features.map((f) => ({ geometry: f.geometry, properties: f.properties })), truncated: truncated(fc) || fc.features.length >= CWS_MAX, coarse };
  };
  const [cws, cen] = await Promise.all([
    cached(`pfas-cws:${box}:${polygons ? "poly" : "rows"}`, DAY_MS, cwsAsk).catch((e: unknown) => e as Error),
    cached(`pfas-pat-centroid:${box}`, DAY_MS, () => arcgisRowsCapped("epa-ucmr5-pat", PAT, patCentroidParams(bbox), { gate: "epa-ucmr5-pat", minIntervalMs: 250, timeoutMs: PAT_TIMEOUT_MS, tries: 1 })).catch((e: unknown) => e as Error),
  ]);
  if (cws instanceof Error && cen instanceof Error) throw cws;
  const cwsOk = cws instanceof Error ? null : cws;
  const cenOk = cen instanceof Error ? null : cen;
  const ids = new Set<string>();
  for (const f of cwsOk?.value.features ?? []) if (typeof f.properties?.PWSID === "string") ids.add(f.properties.PWSID.trim());
  for (const a of cenOk?.value.rows ?? []) if (typeof a.F_PWS_ID === "string") ids.add(a.F_PWS_ID.trim());
  const chunks = patResultsParams([...ids]);
  const parts = await Promise.all(
    chunks.map((params) =>
      cached(`pfas-pat-results:${params.where}`, DAY_MS, () => arcgisRowsCapped("epa-ucmr5-pat", PAT, params, { gate: "epa-ucmr5-pat", minIntervalMs: 250, timeoutMs: PAT_TIMEOUT_MS, tries: 1 })).catch((e: unknown) => e as Error),
    ),
  );
  const rows: Array<Record<string, unknown>> = [];
  const unknownIds = new Set<string>();
  let answered = 0;
  let cut = 0;
  let resultsAge = 0;
  parts.forEach((r, i) => {
    // A chunk that failed, or that the server cut at its record cap, leaves its systems unknown.
    if (r instanceof Error || r.value.exceeded) {
      if (!(r instanceof Error)) cut++;
      for (const id of chunkIds(chunks[i].where)) unknownIds.add(id);
      return;
    }
    answered++;
    resultsAge = Math.max(resultsAge, r.age);
    rows.push(...r.value.rows);
  });
  const allFailed = chunks.length > 0 && answered === 0;
  const systems = buildPfasSystems(cwsOk?.value.features ?? null, cenOk?.value.rows ?? null, allFailed ? null : rows, unknownIds);
  const { features, notDrawn } = pfasFeatures(systems, polygons);
  const counts: Record<PfasState, number> = { detected: 0, "not-detected": 0, "not-in-ucmr5": 0, unknown: 0 };
  for (const s of systems) counts[s.state]++;
  const resultsState = !chunks.length ? "covered" : answered === chunks.length ? "covered" : answered ? "partial" : "error";
  const coverage = [
    { id: "service-areas", name: "EPA community water system service areas", state: cwsOk ? (cwsOk.value.truncated ? "partial" : "covered") : "error", count: cwsOk ? cwsOk.value.features.length : null },
    { id: "estimated-locations", name: "EPA UCMR 5 systems placed by estimated location", state: cenOk ? (cenOk.value.exceeded ? "partial" : "covered") : "error", count: cenOk ? new Set(cenOk.value.rows.map((a) => a.F_PWS_ID)).size : null },
    { id: "results", name: "EPA UCMR 5 results", state: resultsState, count: resultsState === "error" ? null : systems.filter((s) => s.state === "detected" || s.state === "not-detected").length },
  ];
  const caveats = [PFAS_CAVEAT, CWS_CAVEAT, "Water system names are as EPA lists them and can be an apartment complex, a nursing home or a rental park; they are shown in the record and on the label only and never searched. A system is found by its PWSID.", "Only the returned `bbox` was loaded; systems whose service areas and estimated locations are both outside it are not loaded, which is not the same as none being there."];
  if (!polygons) caveats.push("Service-area polygons are sent only with polygons=1 (the layer asks below 10 km); without them each sampled system is a point at EPA's estimated location, drawn as a ring, and systems EPA gives no location are listed in `notDrawn`.");
  if (cwsOk?.value.coarse) caveats.push(`The service areas in this box were large: they were simplified to about 200 m (maxAllowableOffset ${PFAS_OFFSET_COARSE}) to stay under ${(PFAS_MAX_BYTES / 1e6).toFixed(1)} MB.`);
  if (!cwsOk) caveats.push("EPA's service-area layer did not answer this time: systems are placed by estimated location only, and systems with no UCMR 5 rows are missing from this answer, not absent.");
  if (!cenOk) caveats.push("EPA's estimated-location query did not answer this time: systems without a service-area polygon are missing from this answer, not absent.");
  if (resultsState !== "covered") caveats.push(`EPA's UCMR 5 results did not answer for ${unknownIds.size} of ${ids.size} systems this time${cut ? " (part of the answer was cut at the service's record cap)" : ""}: they are "unknown", never "not detected".`);
  const prov: Provenance[] = [];
  if (cwsOk) prov.push(provenance(source("epa-cws-boundaries"), { kind: "published", seriesId: `Water_System_Boundaries FeatureServer layer 0${polygons ? `, simplified to ${cwsOk.value.coarse ? PFAS_OFFSET_COARSE : PFAS_OFFSET} degrees` : ", attributes only"}`, upstreamUrl: CWS_BOUNDARIES, retrievedAt: new Date(Date.now() - cwsOk.age).toISOString(), notes: [`bbox ${box}`] }));
  if (cenOk || answered) prov.push(provenance(source("epa-ucmr5-pat"), { kind: "published", seriesId: `PFAS_Analytic_Tools_Layers FeatureServer layer 1, UCMR_Cycle='${UCMR5}', grouped by PWSID and contaminant`, upstreamUrl: PAT, retrievedAt: new Date(Date.now() - Math.max(resultsAge, cenOk?.age ?? 0)).toISOString(), notes: [`${ids.size} systems asked, ${answered} of ${chunks.length} result chunks answered`] }));
  return {
    data: { type: "FeatureCollection", features },
    meta: {
      source: "U.S. EPA UCMR 5 via the PFAS Analytic Tools, drawn on EPA's Community Water System service areas",
      bbox,
      polygons,
      units: "ng/L",
      systems: counts,
      notDrawn,
      coverage,
      cacheAge: Math.max(cwsOk?.age ?? 0, cenOk?.age ?? 0, resultsAge),
    },
    ttlS: resultsState === "covered" && cwsOk && cenOk ? 3600 : 300,
    provenance: prov,
    caveats,
  };
}

const MONTH_MS = 30 * DAY_MS;

/** One NLDI GET through its gate (four a second), retrying a reset or a 5xx once. A 404 is an answer: "nothing here". */
async function nldiGet(url: string, timeoutMs = 20_000): Promise<unknown | null> {
  try {
    return await retrying(() => polite("usgs-nldi", 250, 30_000, () => upstreamJson<unknown>("usgs-nldi", url, { timeoutMs })), 2);
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }
}

/**
 * The NHDPlus V2 reach a point drains to: NLDI's catchment at the point (comid), then EPA's
 * V2.1 attributes by comid. No catchment is an answer (comid null), not an error; EPA failing
 * leaves the comid with its attributes unknown.
 */
async function reachOp(lon: number, lat: number): Promise<OpResult> {
  const [x, y] = snapPoint(lon, lat);
  const pos = await cached(`nldi:position:${x},${y}`, MONTH_MS, async () => parseComid(await nldiGet(positionUrl(x, y))), { deadlineMs: REACH_POSITION_DEADLINE_MS });
  const comid = pos.value;
  let reach: Reach | null = null;
  let epaAge = 0;
  let epaFailed = false;
  if (comid != null) {
    try {
      const r = await cached(`epa-v21:${comid}`, MONTH_MS, async () => {
        const j = await arcgisRowsCapped<Record<string, unknown>>("epa-nhdplus-v21", EPA_V21, v21Params(comid), { gate: "epa-watersgeo", minIntervalMs: 500, timeoutMs: 15_000, tries: 2 });
        return parseV21({ features: j.rows.map((attributes) => ({ attributes })) }, comid);
      }, { deadlineMs: REACH_EPA_DEADLINE_MS });
      reach = r.value;
      epaAge = r.age;
    } catch {
      epaFailed = true;
    }
  }
  const caveats = [HYDRO_CAVEAT];
  if (comid == null) caveats.push("NLDI found no NHDPlus V2 catchment at this point (open water, the Great Lakes, or outside the conterminous US): no reach here, not an error.");
  else {
    caveats.push("The reach is the one whose NHDPlus V2 catchment contains the point, so it is where the point drains to, which near a small stream can be a larger river.");
    if (reach) caveats.push(FLOW_CAVEAT);
    if (epaFailed) caveats.push("EPA's NHDPlus V2.1 service did not answer this time: the reach's name, order, area and flow are unknown, not absent.");
    else if (!reach) caveats.push(`EPA's NHDPlus V2.1 layer has no row for comid ${comid}: its attributes are not published there.`);
  }
  const prov: Provenance[] = [
    provenance(source("usgs-nldi"), { kind: "published", seriesId: "NLDI comid/position (NHDPlus V2 catchment containing the point)", upstreamUrl: positionUrl(x, y), retrievedAt: retrievedAt(pos.age), notes: [`point ${x},${y}`] }),
  ];
  if (reach) prov.push(provenance(source("epa-nhdplus-v21"), { kind: "published", seriesId: `NHDPlus MapServer layer 2 (Network Flowline), comid=${comid}`, upstreamUrl: EPA_V21, retrievedAt: retrievedAt(epaAge) }));
  return {
    data: { lon: x, lat: y, comid, reach },
    meta: { source: "USGS NLDI + EPA NHDPlus V2.1", network: "NHDPlus V2", cacheAge: Math.max(pos.age, epaAge) },
    ttlS: epaFailed ? 300 : 7 * 86_400,
    provenance: prov,
    caveats,
  };
}

interface TraceAnswer {
  features: GeoJSON.Feature[];
  count: number;
  /** NLDI answered 404: no such reach. */
  missing: boolean;
  /** Basin: whether it was cut further here. */
  cut: boolean;
  /** Basin: holes and islands left out to fit the cap, and the area under which they were. */
  droppedRings?: number;
  droppedUnderKm2?: number;
}

/** No op here may outlast the function's 60 s: each answers or fails inside these. */
const TRACE_DEADLINE_MS = 40_000;
const REACH_POSITION_DEADLINE_MS = 20_000;
const REACH_EPA_DEADLINE_MS = 20_000;

/** One NLDI navigation from a reach, as GeoJSON: the main stem downstream, the basin, or the gauges upstream. */
async function traceOp(comid: number, mode: TraceMode, distanceRaw: string | null): Promise<OpResult> {
  const km = mode === "basin" ? null : traceDistance(mode, distanceRaw);
  const url = traceUrl(comid, mode, km ?? 0);
  const r = await cached(`nldi:trace:${comid}:${mode}:${km ?? "-"}`, MONTH_MS, async (): Promise<TraceAnswer> => {
    const j = await nldiGet(url, 25_000);
    if (j == null) return { features: [], count: 0, missing: true, cut: false };
    if (mode === "down") {
      const f = flowlines(j);
      return { features: f.count ? [{ type: "Feature", geometry: f.geometry, properties: { comid, mode, flowlines: f.count } }] : [], count: f.count, missing: false, cut: false };
    }
    if (mode === "gauges") {
      const g = upstreamGauges(j);
      return {
        features: g.map((x) => ({ type: "Feature", geometry: { type: "Point", coordinates: [x.lon, x.lat] }, properties: { identifier: x.identifier, siteNo: x.siteNo, name: x.name, comid: x.comid, uri: x.uri } })),
        count: g.length,
        missing: false,
        cut: false,
      };
    }
    const b = basinPolygon(j);
    if (!b) throw new UpstreamError("usgs-nldi", 502, `usgs-nldi: basin for ${comid} came back with no polygon`);
    return {
      features: [{ type: "Feature", geometry: b.geometry, properties: { comid, mode, vertices: b.vertices, sentVertices: b.sent, droppedRings: b.droppedRings, droppedUnderKm2: b.droppedUnderKm2 } }],
      count: 1,
      missing: false,
      cut: b.tolerance != null,
      droppedRings: b.droppedRings,
      droppedUnderKm2: b.droppedUnderKm2,
    };
  }, { deadlineMs: TRACE_DEADLINE_MS });
  const caveats = [HYDRO_CAVEAT];
  if (r.value.missing) caveats.push(`NLDI has no reach ${comid}: nothing to trace.`);
  if (mode === "down") caveats.push(`The NHDPlus V2 main stem downstream for ${km} km (or to the network's end), as NLDI navigates it: a river path, not the watersheds it passes through (those are /api/fabric?op=downstream, by HUC-12).`);
  if (mode === "gauges") caveats.push(`USGS stream gauges NLDI indexes on the network upstream within ${km} km of channel; the count depends on the distance asked, and a gauge listed here may be inactive.`);
  if (mode === "basin") caveats.push(`The drainage basin of reach ${comid} as NLDI publishes it (simplified), at most ${BASIN_MAX_VERTICES.toLocaleString("en-US")} vertices${r.value.cut ? "; cut further here, so its edge is approximate" : ""}.`);
  if (mode === "basin" && r.value.droppedRings) caveats.push(`${r.value.droppedRings.toLocaleString("en-US")} of NLDI's rings were left out to fit: holes (areas inside the basin that do not drain to it) and islands smaller than about ${r.value.droppedUnderKm2!.toLocaleString("en-US")} km². A dropped hole means the outline covers some ground that does not drain here; a dropped island means it leaves out some ground that does.`);
  return {
    data: { type: "FeatureCollection", features: r.value.features },
    meta: { source: "USGS NLDI", comid, mode, distanceKm: km, count: r.value.count, cacheAge: r.age },
    ttlS: 7 * 86_400,
    provenance: [
      provenance(source("usgs-nldi"), {
        kind: "published",
        seriesId: mode === "basin" ? `NLDI comid/${comid}/basin (simplified)` : `NLDI comid/${comid}/navigation/${mode === "down" ? "DM/flowlines" : "UT/nwissite"}, distance ${km} km`,
        upstreamUrl: url,
        retrievedAt: retrievedAt(r.age),
      }),
    ],
    caveats,
  };
}

/** JSON envelope, or CSV when asked and the op is tabular. */
function respond(r: OpResult, format: ResponseFormat = "json", op = "") {
  if (format === "csv") {
    if (!r.csv) return badRequest(`format=csv is not offered for op=${op}; tabular ops are gauges, wells, nwps, twdb, history, matchup`);
    const t = r.csv();
    return csvResponse(t.rows, { columns: [...t.columns], filename: t.filename, provenance: r.provenance, caveats: r.caveats, ttlS: r.ttlS });
  }
  return ok(r.data, { meta: r.meta, provenance: r.provenance, caveats: r.caveats, ttlS: r.ttlS });
}

const bad = badRequest;

export const OPTIONS = options;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  const format = parseFormat(req);
  try {
    switch (op) {
      case "gauges": {
        const b = parseBbox(q.get("bbox"));
        if (!b) return bad("bbox=w,s,e,n required");
        const param = q.get("param");
        if (param && !/^\d{5}(,\d{5})*$/.test(param)) return bad("param=00060 or a comma list of five-digit USGS parameter codes");
        return respond(await gaugesOp(b, param), format, op);
      }
      case "wells": {
        const b = parseBbox(q.get("bbox"));
        if (!b) return bad("bbox=w,s,e,n required");
        return respond(await wellsOp(b), format, op);
      }
      case "nwps": {
        const b = parseBbox(q.get("bbox"));
        if (!b) return bad("bbox=w,s,e,n required");
        return respond(await nwpsOp(b), format, op);
      }
      case "twdb":
        return respond(await twdbOp(), format, op);
      case "drought":
        return respond(await droughtOp(), format, op);
      case "history": {
        const site = q.get("site") ?? "";
        const param = q.get("param") ?? "";
        if (!SITE_RE.test(site) || !PARAM_RE.test(param)) return bad("site=USGS-xxxx and param=00060 required");
        return respond(await opHistory(site, param), format, op);
      }
      case "matchup": {
        const site = q.get("site") ?? "";
        const param = q.get("param") ?? "";
        const from = q.get("from") ?? "";
        const to = q.get("to") ?? "";
        if (!SITE_RE.test(site) || !PARAM_RE.test(param) || !ISO_RE.test(from) || !ISO_RE.test(to)) {
          return bad("site, param, from, to (ISO Z) required");
        }
        if (from >= to) return bad("from must be before to");
        return respond(await opMatchup(site, param, from, to), format, op);
      }
      case "normals": {
        const sites = (q.get("sites") ?? "").split(",").filter(Boolean);
        if (!sites.length || sites.length > MAX_SITES || !sites.every((s) => /^(USGS-)?\d{8,15}$/.test(s))) return bad(`sites=08158000,... (1 to ${MAX_SITES} USGS site numbers) required`);
        const d = /^(\d{2})-(\d{2})$/.exec(q.get("date") ?? "");
        const now = new Date();
        const month = d ? Number(d[1]) : now.getUTCMonth() + 1;
        const day = d ? Number(d[2]) : now.getUTCDate();
        if (month < 1 || month > 12 || day < 1 || day > 31) return bad("date=MM-DD");
        return respond(await normalsOp(sites, month, day), format, op);
      }
      case "impaired": {
        const b = gridBbox(q.get("bbox"), 0.12, 0.02);
        if (!b) return bad("bbox=w,s,e,n required, west < east and south < north, e.g. bbox=-76.62,39.26,-76.58,39.30");
        return respond(await impairedOp(b), format, op);
      }
      case "pfas": {
        const b = gridBbox(q.get("bbox"), 0.12, 0.02);
        if (!b) return bad("bbox=w,s,e,n required, west < east and south < north, e.g. bbox=-75.54,40.12,-75.40,40.26");
        return respond(await pfasOp(b, q.get("polygons") === "1"), format, op);
      }
      case "reach": {
        const lon = Number(q.get("lon"));
        const lat = Number(q.get("lat"));
        if (!q.get("lon") || !q.get("lat") || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          return bad("lon and lat required, e.g. lon=-116.2023&lat=43.6150");
        }
        return respond(await reachOp(lon, lat), format, op);
      }
      case "trace": {
        const raw = q.get("comid") ?? "";
        const mode = q.get("mode");
        if (!/^\d{1,12}$/.test(raw) || Number(raw) <= 0) return bad("comid=<NHDPlus V2 comid> required, e.g. comid=23398863 (from op=reach)");
        if (!isTraceMode(mode)) return bad("mode=down | basin | gauges required");
        const d = q.get("distance");
        if (d != null && d !== "" && !/^\d{1,4}$/.test(d)) return bad("distance=km, a whole number (1 to 500)");
        return respond(await traceOp(Number(raw), mode, d), format, op);
      }
      case "report": {
        const lon = Number(q.get("lon"));
        const lat = Number(q.get("lat"));
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          return bad("lon and lat required");
        }
        return respond(await reportOp(lon, lat, req.nextUrl.origin), format, op);
      }
      default:
        return bad("unknown op: gauges | wells | nwps | twdb | drought | history | matchup | normals | impaired | pfas | reach | trace | report");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
