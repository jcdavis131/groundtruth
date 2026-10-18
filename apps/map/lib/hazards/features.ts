// Row -> feature builders for the three hazard layers: wildfire (NIFC WFIGS
// perimeters and incident points), active fires (NASA FIRMS hotspots) and
// hazard alerts (NWS, GDACS, NASA EONET volcanoes). Plain functions shared by
// /api/hazards and the browser layers; nothing here fetches.
//
// Severity is always the publisher's own word: NWS severity, GDACS alert
// level, FIRMS confidence on each instrument's own scale. Where a source
// publishes no severity (EONET, NWS "Unknown") the feature says "not rated by
// source" and is drawn in a colour that no rated level uses, never as calm.

import type { MultiPolygon, Point, Polygon } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import { haversine } from "@/lib/globe/geo";
import { LIVE_SEVERITIES } from "@/lib/live/live";

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function isoMinute(ms: number | undefined): string | undefined {
  return ms != null && Number.isFinite(ms) ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z" : undefined;
}

/** "3 h", "2 d": how old a timestamp is. */
export function ageText(ms: number | undefined, now: number): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  const h = (now - ms) / 3600_000;
  if (h < 0) return "in the future (as published)";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}

// ---------------------------------------------------------------- NIFC WFIGS

export const WFIGS_PERIMETER_FIELDS = [
  "poly_IncidentName",
  "poly_GISAcres",
  "poly_PolygonDateTime",
  "poly_DateCurrent",
  "poly_IRWINID",
  "attr_IrwinID",
  "attr_IncidentName",
  "attr_IncidentTypeCategory",
  "attr_PercentContained",
  "attr_FireDiscoveryDateTime",
  "attr_IncidentSize",
  "attr_POOState",
  "attr_POOCounty",
  "attr_FireCauseGeneral",
  "attr_TotalIncidentPersonnel",
  "attr_GACC",
  "attr_POOProtectingAgency",
  "attr_ModifiedOnDateTime_dt",
  "attr_UniqueFireIdentifier",
] as const;

export const WFIGS_INCIDENT_FIELDS = [
  "IncidentName",
  "IncidentTypeCategory",
  "IncidentSize",
  "PercentContained",
  "FireDiscoveryDateTime",
  "ModifiedOnDateTime_dt",
  "IrwinID",
  "POOState",
  "POOCounty",
  "FireCauseGeneral",
  "TotalIncidentPersonnel",
  "GACC",
  "POOProtectingAgency",
  "UniqueFireIdentifier",
] as const;

export interface FireExtra {
  /** IRWIN incident type as published: WF wildfire, RX prescribed fire. */
  type: string;
  /** Perimeter GIS acres (perimeters) or the reported incident size (points). */
  acres?: number;
  reportedAcres?: number;
  /** Percent contained; undefined when the incident reports none. */
  contained?: number;
  discoveredAt?: number;
  /**
   * When the perimeter polygon was captured (WFIGS poly_PolygonDateTime,
   * perimeters only). Undefined when WFIGS publishes none; never filled from
   * another date.
   */
  perimeterAt?: number;
  /** When the perimeter record was last edited (poly_DateCurrent). Not when it was drawn. */
  perimeterEditedAt?: number;
  /** When the incident record was last modified (IRWIN ModifiedOnDateTime). */
  updatedAt?: number;
  hasPerimeter: boolean;
}

export function fireKind(type: string | undefined): string {
  if (type === "WF") return "wildfire";
  if (type === "RX") return "prescribed";
  return type ? type.toLowerCase() : "incident";
}

function fireDetails(
  x: FireExtra,
  p: {
    state?: string;
    county?: string;
    cause?: string;
    personnel?: number;
    gacc?: string;
    agency?: string;
    uid?: string;
  },
): Record<string, string | number | boolean | undefined> {
  return {
    type: x.type === "WF" ? "wildfire" : x.type === "RX" ? "prescribed fire" : x.type,
    "perimeter acres": x.hasPerimeter && x.acres != null ? Math.round(x.acres).toLocaleString("en-US") : undefined,
    "reported size": x.reportedAcres != null ? `${Math.round(x.reportedAcres).toLocaleString("en-US")} ac` : undefined,
    contained: x.contained != null ? `${Math.round(x.contained)} %` : "not reported",
    discovered: isoMinute(x.discoveredAt),
    // WFIGS: poly_PolygonDateTime is when the polygon data was captured; poly_DateCurrent
    // only when the record was last edited, which can run weeks later.
    "perimeter captured": x.hasPerimeter ? (isoMinute(x.perimeterAt) ?? "not published by WFIGS") : undefined,
    "perimeter record edited": isoMinute(x.perimeterEditedAt),
    "incident updated": isoMinute(x.updatedAt),
    state: p.state?.replace(/^US-/, ""),
    county: p.county,
    cause: p.cause,
    personnel: p.personnel,
    "coordination center": p.gacc,
    "protecting agency": p.agency,
    "fire id": p.uid,
    "what this is": x.hasPerimeter
      ? "an operational fire perimeter from WFIGS; NIFC: not a legal document, no warranty"
      : "the incident's reported point; no public perimeter yet",
  };
}

export function buildWildfire(
  perims: Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }>,
  incidents: Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }>,
): { features: LayerFeature[]; perimeters: number; points: number } {
  const out: LayerFeature[] = [];
  const withPerimeter = new Set<string>();
  const incidentAt = new Map<string, [number, number]>();
  for (const r of incidents) {
    const id = str(r.properties.IrwinID)?.toUpperCase().replace(/[{}]/g, "");
    if (id && r.geometry?.type === "Point") incidentAt.set(id, [r.geometry.coordinates[0], r.geometry.coordinates[1]]);
  }
  perims.forEach((r, i) => {
    const g = r.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return;
    const p = r.properties;
    const irwin = (str(p.poly_IRWINID) ?? str(p.attr_IrwinID))?.toUpperCase().replace(/[{}]/g, "");
    if (irwin) withPerimeter.add(irwin);
    const type = str(p.attr_IncidentTypeCategory) ?? "unknown";
    const x: FireExtra = {
      type,
      acres: num(p.poly_GISAcres),
      reportedAcres: num(p.attr_IncidentSize),
      contained: num(p.attr_PercentContained),
      discoveredAt: num(p.attr_FireDiscoveryDateTime),
      perimeterAt: num(p.poly_PolygonDateTime),
      perimeterEditedAt: num(p.poly_DateCurrent),
      updatedAt: num(p.attr_ModifiedOnDateTime_dt),
      hasPerimeter: true,
    };
    const name = str(p.attr_IncidentName) ?? str(p.poly_IncidentName) ?? "unnamed fire";
    out.push({
      type: "Feature",
      geometry: g as Polygon | MultiPolygon,
      properties: {
        id: `wfigs:${irwin ?? i}`,
        layer: "wildfire",
        name,
        kind: fireKind(type),
        // The capture time, or nothing: the incident record's edit time says
        // nothing about when this polygon was drawn (the dossier lists it as
        // "incident updated").
        observedAt: x.perimeterAt,
        source: "NIFC WFIGS",
        anchor: irwin ? incidentAt.get(irwin) : undefined,
        details: fireDetails(x, {
          state: str(p.attr_POOState),
          county: str(p.attr_POOCounty),
          cause: str(p.attr_FireCauseGeneral),
          personnel: num(p.attr_TotalIncidentPersonnel),
          gacc: str(p.attr_GACC),
          agency: str(p.attr_POOProtectingAgency),
          uid: str(p.attr_UniqueFireIdentifier),
        }),
        extra: x,
      },
    });
  });
  const perimeters = out.length;
  let points = 0;
  incidents.forEach((r, i) => {
    if (r.geometry?.type !== "Point") return;
    const p = r.properties;
    const irwin = str(p.IrwinID)?.toUpperCase().replace(/[{}]/g, "");
    // The perimeter feature already carries this incident's attributes.
    if (irwin && withPerimeter.has(irwin)) return;
    const type = str(p.IncidentTypeCategory) ?? "unknown";
    const x: FireExtra = {
      type,
      acres: num(p.IncidentSize),
      reportedAcres: num(p.IncidentSize),
      contained: num(p.PercentContained),
      discoveredAt: num(p.FireDiscoveryDateTime),
      updatedAt: num(p.ModifiedOnDateTime_dt),
      hasPerimeter: false,
    };
    const [lon, lat] = r.geometry.coordinates;
    points++;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat, 0] },
      properties: {
        id: `wfigs-inc:${irwin ?? i}`,
        layer: "wildfire",
        name: str(p.IncidentName) ?? "unnamed fire",
        kind: fireKind(type),
        altitude: 0,
        observedAt: x.updatedAt ?? x.discoveredAt,
        source: "NIFC WFIGS",
        details: fireDetails(x, {
          state: str(p.POOState),
          county: str(p.POOCounty),
          cause: str(p.FireCauseGeneral),
          personnel: num(p.TotalIncidentPersonnel),
          gacc: str(p.GACC),
          agency: str(p.POOProtectingAgency),
          uid: str(p.UniqueFireIdentifier),
        }),
        extra: x,
      },
    });
  });
  return { features: out, perimeters, points };
}

// ---------------------------------------------------------------- NASA FIRMS

export type Instrument = "VIIRS" | "MODIS";

/** One FIRMS 24 h CSV held in typed arrays (about 100k rows per VIIRS file). */
export interface FirmsTable {
  instrument: Instrument;
  product: string;
  n: number;
  lon: Float32Array;
  lat: Float32Array;
  /** Fire radiative power, MW; NaN when blank. */
  frp: Float32Array;
  /** Acquisition time, epoch ms UTC. */
  t: Float64Array;
  /** VIIRS: 0 low, 1 nominal, 2 high. MODIS: 0–100 %. 255 = blank. */
  conf: Uint8Array;
  /** 0 day, 1 night, 2 blank. */
  dn: Uint8Array;
  sat: string[];
  satIndex: Uint8Array;
  version: string;
}

const VIIRS_CONF: Record<string, number> = { l: 0, low: 0, n: 1, nominal: 1, h: 2, high: 2 };
export const VIIRS_CONF_LABEL = ["low", "nominal", "high"];

/** A CSV cell as a number; a blank cell is NaN, never 0 (Number("") is 0). */
function csvNum(v: string | undefined): number {
  const s = (v ?? "").trim();
  return s === "" ? NaN : Number(s);
}

export function parseFirmsCsv(text: string, instrument: Instrument, product: string): FirmsTable {
  const lines = text.split("\n");
  const header = (lines[0] ?? "").trim().split(",");
  const col = (name: string) => header.indexOf(name);
  const iLat = col("latitude");
  const iLon = col("longitude");
  const iFrp = col("frp");
  const iDate = col("acq_date");
  const iTime = col("acq_time");
  const iConf = col("confidence");
  const iDn = col("daynight");
  const iSat = col("satellite");
  const iVer = col("version");
  const cap = Math.max(0, lines.length - 1);
  const t: FirmsTable = {
    instrument,
    product,
    n: 0,
    lon: new Float32Array(cap),
    lat: new Float32Array(cap),
    frp: new Float32Array(cap),
    t: new Float64Array(cap),
    conf: new Uint8Array(cap),
    dn: new Uint8Array(cap),
    sat: [],
    satIndex: new Uint8Array(cap),
    version: "",
  };
  if (iLat < 0 || iLon < 0) return t;
  const satPos = new Map<string, number>();
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    const c = line.split(",");
    const lat = csvNum(c[iLat]);
    const lon = csvNum(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const k = t.n;
    t.lat[k] = lat;
    t.lon[k] = lon;
    const frp = iFrp >= 0 ? csvNum(c[iFrp]) : NaN;
    t.frp[k] = Number.isFinite(frp) ? frp : NaN;
    const hhmm = iTime >= 0 ? String(c[iTime] ?? "").trim().padStart(4, "0") : "";
    const date = iDate >= 0 ? String(c[iDate] ?? "").trim() : "";
    const ms = date && /^\d{4}$/.test(hhmm) ? Date.parse(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`) : NaN;
    t.t[k] = ms;
    const rawConf = iConf >= 0 ? String(c[iConf] ?? "").trim().toLowerCase() : "";
    if (instrument === "VIIRS") t.conf[k] = VIIRS_CONF[rawConf] ?? 255;
    else {
      const pct = Number(rawConf);
      t.conf[k] = rawConf !== "" && Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 255;
    }
    const dn = iDn >= 0 ? String(c[iDn] ?? "").trim() : "";
    t.dn[k] = dn === "D" ? 0 : dn === "N" ? 1 : 2;
    const sat = iSat >= 0 ? String(c[iSat] ?? "").trim() : "";
    let si = satPos.get(sat);
    if (si == null) {
      si = t.sat.length;
      t.sat.push(sat);
      satPos.set(sat, si);
    }
    t.satIndex[k] = si;
    if (!t.version && iVer >= 0) t.version = String(c[iVer] ?? "").trim();
    t.n++;
  }
  return t;
}

/**
 * One hotspot row as the route sends it:
 * [lon, lat, frpMW|null, epochMs|null, satellite, instrument, confidence, dayNight, detectionsInCell]
 * confidence is "low" | "nominal" | "high" for VIIRS and a 0–100 number for MODIS; null when blank.
 */
export type FireRow = [number, number, number | null, number | null, string, Instrument, string | number | null, "D" | "N" | null, number];

export const FIRE_ROW_COLUMNS = ["lon", "lat", "frp_mw", "acquired_ms", "satellite", "instrument", "confidence", "day_night", "detections"];

/** MODIS confidence classes as FIRMS documents them (0–29 low, 30–79 nominal, 80–100 high); colour only. */
export function modisClass(pct: number): "low" | "nominal" | "high" {
  return pct < 30 ? "low" : pct < 80 ? "nominal" : "high";
}

/**
 * Hotspots inside a box. When there are more than `max`, they are binned on a
 * square grid (cell grows until the occupied cells fit) and each cell keeps
 * its brightest detection (max FRP) with the count it stands for.
 */
export function selectFires(
  tables: FirmsTable[],
  bbox: [number, number, number, number],
  max = 5000,
): { rows: FireRow[]; total: number; cellDeg: number | null } {
  const [w, s, e, n] = bbox;
  const idx: Array<[FirmsTable, number]> = [];
  for (const tb of tables) {
    for (let i = 0; i < tb.n; i++) {
      const lo = tb.lon[i];
      const la = tb.lat[i];
      if (lo >= w && lo <= e && la >= s && la <= n) idx.push([tb, i]);
    }
  }
  const row = (tb: FirmsTable, i: number, count: number): FireRow => {
    const conf = tb.conf[i];
    return [
      Math.round(tb.lon[i] * 1e5) / 1e5,
      Math.round(tb.lat[i] * 1e5) / 1e5,
      Number.isFinite(tb.frp[i]) ? Math.round(tb.frp[i] * 100) / 100 : null,
      Number.isFinite(tb.t[i]) ? tb.t[i] : null,
      tb.sat[tb.satIndex[i]] ?? "",
      tb.instrument,
      conf === 255 ? null : tb.instrument === "VIIRS" ? VIIRS_CONF_LABEL[conf] : conf,
      tb.dn[i] === 0 ? "D" : tb.dn[i] === 1 ? "N" : null,
      count,
    ];
  };
  if (idx.length <= max) return { rows: idx.map(([tb, i]) => row(tb, i, 1)), total: idx.length, cellDeg: null };
  // Start fine and grow by half until the occupied cells fit, so the budget is used, not wasted.
  let cell = Math.max(e - w, n - s) / 1000;
  for (let pass = 0; pass < 14; pass++) {
    const best = new Map<number, { tb: FirmsTable; i: number; count: number }>();
    const cols = Math.ceil((e - w) / cell) + 1;
    for (const [tb, i] of idx) {
      const key = Math.floor((tb.lat[i] - s) / cell) * cols + Math.floor((tb.lon[i] - w) / cell);
      const cur = best.get(key);
      if (!cur) best.set(key, { tb, i, count: 1 });
      else {
        cur.count++;
        const a = cur.tb.frp[cur.i];
        const b = tb.frp[i];
        if (Number.isFinite(b) && (!Number.isFinite(a) || b > a)) {
          cur.tb = tb;
          cur.i = i;
        }
      }
    }
    if (best.size <= max || pass === 13) {
      return { rows: [...best.values()].map((c) => row(c.tb, c.i, c.count)), total: idx.length, cellDeg: cell };
    }
    cell *= 1.5;
  }
  return { rows: [], total: idx.length, cellDeg: cell };
}

// ---------------------------------------------------------------- alerts

export type AlertSource = "NWS" | "GDACS" | "EONET";

export interface HazardAlertExtra {
  source: AlertSource;
  /** The publisher's own severity word: NWS severity, GDACS alert level; undefined = not rated. */
  severity?: string;
  event: string;
  /** How the area on the globe was drawn. */
  drawnAs: "polygon" | "counties" | "point";
  expires?: number;
  start?: number;
  /**
   * GDACS earthquakes only: the USGS 24 h feed the Earthquakes layer draws has
   * a quake within 100 km and 30 min of this one.
   */
  alsoInUsgs?: boolean;
  /** NWS alerts only: the alert's own NWS id (Live warnings draws it as liveAlertId(nwsId)). */
  nwsId?: string;
  /**
   * NWS alerts only: the live feed Live warnings draws (/api/live) outlined
   * this alert when the answer was made. Set by markLiveOutlined; absent when
   * it did not, or when that feed failed or was not checked.
   */
  liveOutlined?: boolean;
}

/** NWS alert trimmed to what the layer shows (the raw feed is ~2.8 MB, mostly prose). */
export interface NwsAlert {
  id: string;
  event: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  headline?: string;
  area?: string;
  sent?: string;
  effective?: string;
  onset?: string;
  expires?: string;
  ends?: string;
  sender?: string;
  messageType?: string;
  url?: string;
  /** County GEOIDs from the alert's SAME codes (first digit, the county-part code, dropped). */
  counties: string[];
  zones: number;
  geometry: Polygon | MultiPolygon | null;
}

export function trimNwsAlert(f: { id?: string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }): NwsAlert | null {
  const p = f.properties;
  const id = str(p.id) ?? str(f.id);
  if (!id) return null;
  // A cancellation ends an alert; it is not an alert in force (lib/live/live.ts parseAlerts skips it too).
  if (str(p.messageType) === "Cancel") return null;
  const geocode = (p.geocode ?? {}) as { SAME?: string[]; UGC?: string[] };
  const counties = [...new Set((geocode.SAME ?? []).filter((c) => /^\d{6}$/.test(c)).map((c) => c.slice(1)))];
  const g = f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") ? f.geometry : null;
  return {
    id,
    event: str(p.event) ?? "alert",
    severity: str(p.severity),
    urgency: str(p.urgency),
    certainty: str(p.certainty),
    headline: str(p.headline),
    area: str(p.areaDesc)?.slice(0, 240),
    sent: str(p.sent),
    effective: str(p.effective),
    onset: str(p.onset),
    expires: str(p.expires),
    ends: str(p.ends),
    sender: str(p.senderName),
    messageType: str(p.messageType),
    url: str(p["@id"]),
    counties,
    zones: (geocode.UGC ?? []).length,
    geometry: g as Polygon | MultiPolygon | null,
  };
}

/** Severity words as NWS publishes them; anything else (incl. "Unknown") is unrated. */
export const NWS_SEVERITIES = ["Extreme", "Severe", "Moderate", "Minor"];

/**
 * Whether an NWS alert on this layer may be left to Live warnings: rated one
 * of the severities that layer's feed asks NWS for (LIVE_SEVERITIES), and
 * marked as outlined by that feed (markLiveOutlined). An alert Live warnings
 * could not outline (its zone budget ran out, a zone had no geometry) or a
 * feed that failed marks nothing, so those stay here. The layer also checks
 * that Live warnings holds the alert right now (lib/layers/hazards.ts
 * stepAside). Moderate, Minor and unrated NWS alerts, GDACS and EONET events
 * are never left.
 */
export function leftToLiveWarnings(x: HazardAlertExtra | undefined): boolean {
  return x?.source === "NWS" && x.liveOutlined === true && x.severity != null && (LIVE_SEVERITIES as readonly string[]).includes(x.severity);
}

/**
 * Mark the NWS alerts the live feed outlined (`outlined`: their NWS ids, from
 * liveDrawnIds), on copies: the features come out of a shared cache and are
 * never mutated. `outlined` null means that feed failed or was not checked:
 * nothing is marked, so nothing is left to Live warnings.
 */
export function markLiveOutlined(features: LayerFeature[], outlined: ReadonlySet<string> | null): { features: LayerFeature[]; marked: number } {
  if (!outlined?.size) return { features, marked: 0 };
  let marked = 0;
  const out = features.map((f) => {
    const x = f.properties.extra as HazardAlertExtra | undefined;
    if (x?.source !== "NWS" || !x.nwsId || !outlined.has(x.nwsId)) return f;
    marked++;
    return {
      ...f,
      properties: {
        ...f.properties,
        details: { ...f.properties.details, "also on Live warnings": "yes: its feed outlines this alert; drawn there instead while that layer is on and drawing it" },
        extra: { ...x, liveOutlined: true },
      },
    };
  });
  return { features: out, marked };
}

export function buildNwsAlerts(
  alerts: NwsAlert[],
  counties: Map<string, { name: string; geometry: Polygon | MultiPolygon }>,
): { features: LayerFeature[]; drawnPolygon: number; drawnCounties: number; undrawn: number } {
  const out: LayerFeature[] = [];
  let drawnPolygon = 0;
  let drawnCounties = 0;
  let undrawn = 0;
  for (const a of alerts) {
    let geometry: Polygon | MultiPolygon | null = a.geometry;
    let drawnAs: HazardAlertExtra["drawnAs"] = "polygon";
    let countyNames: string[] = [];
    if (!geometry) {
      const polys: number[][][][] = [];
      for (const geoid of a.counties) {
        const c = counties.get(geoid);
        if (!c) continue;
        countyNames.push(c.name);
        if (c.geometry.type === "Polygon") polys.push(c.geometry.coordinates);
        else polys.push(...c.geometry.coordinates);
      }
      if (polys.length) {
        geometry = { type: "MultiPolygon", coordinates: polys };
        drawnAs = "counties";
      }
    }
    if (!geometry) {
      undrawn++;
      continue;
    }
    if (drawnAs === "polygon") drawnPolygon++;
    else drawnCounties++;
    const rated = a.severity && NWS_SEVERITIES.includes(a.severity) ? a.severity : undefined;
    const expires = a.ends ?? a.expires;
    const x: HazardAlertExtra = {
      source: "NWS",
      severity: rated,
      event: a.event,
      drawnAs,
      expires: expires ? Date.parse(expires) : undefined,
      start: a.onset ? Date.parse(a.onset) : a.effective ? Date.parse(a.effective) : undefined,
      nwsId: a.id,
    };
    countyNames = [...new Set(countyNames)];
    out.push({
      type: "Feature",
      geometry,
      properties: {
        id: `nws:${a.id}`,
        layer: "hazards",
        name: a.event,
        kind: "nws",
        observedAt: a.sent ? Date.parse(a.sent) : undefined,
        source: "NWS",
        details: {
          severity: rated ?? `not rated by source (NWS: ${a.severity ?? "none"})`,
          urgency: a.urgency,
          certainty: a.certainty,
          headline: a.headline,
          area: a.area,
          effective: a.effective,
          onset: a.onset,
          expires: a.expires,
          ends: a.ends,
          "message type": a.messageType,
          "issued by": a.sender,
          "area drawn as":
            drawnAs === "polygon"
              ? "the polygon NWS published"
              : `the ${countyNames.length} ${countyNames.length === 1 ? "county" : "counties"} the alert lists (SAME codes); NWS issued it for forecast zones inside ${countyNames.length === 1 ? "it" : "them"}`,
          counties: drawnAs === "counties" ? countyNames.slice(0, 12).join(", ") + (countyNames.length > 12 ? ` +${countyNames.length - 12}` : "") : undefined,
          "nws record": a.url,
        },
        extra: x,
      },
    });
  }
  return { features: out, drawnPolygon, drawnCounties, undrawn };
}

/**
 * One current GDACS event, read from the RSS feed or from the GeoJSON event
 * lists (EVENTS4APP, SEARCH). Only events GDACS marks iscurrent=true get here.
 */
export interface GdacsEvent {
  eventtype: string;
  eventid: string;
  episodeid?: string;
  name?: string;
  description?: string;
  alertlevel?: string;
  country?: string;
  fromdate?: string;
  todate?: string;
  datemodified?: string;
  severitytext?: string;
  report?: string;
  lon: number;
  lat: number;
  /** Set by flagQuakesInUsgs. */
  alsoInUsgs?: boolean;
}

export const GDACS_TYPES: Record<string, string> = {
  EQ: "earthquake",
  TC: "tropical cyclone",
  FL: "flood",
  VO: "volcano",
  DR: "drought",
  WF: "wildfire",
  TS: "tsunami",
};

/** GDACS publishes dates without a zone; they are UTC. */
export function gdacsTime(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) || /GMT$/.test(s) ? s : `${s}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

export function buildGdacs(events: GdacsEvent[]): LayerFeature<Point>[] {
  return events.map((ev) => {
    const level = ev.alertlevel && /^(green|orange|red)$/i.test(ev.alertlevel) ? ev.alertlevel[0].toUpperCase() + ev.alertlevel.slice(1).toLowerCase() : undefined;
    const kind = GDACS_TYPES[ev.eventtype] ?? ev.eventtype.toLowerCase();
    const x: HazardAlertExtra = {
      source: "GDACS",
      severity: level,
      event: kind,
      drawnAs: "point",
      start: gdacsTime(ev.fromdate),
      expires: gdacsTime(ev.todate),
      alsoInUsgs: ev.alsoInUsgs || undefined,
    };
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [ev.lon, ev.lat, 0] },
      properties: {
        id: `gdacs:${ev.eventtype}${ev.eventid}`,
        layer: "hazards",
        name: ev.name || ev.description || `${kind} (GDACS)`,
        kind: `gdacs-${ev.eventtype.toLowerCase()}`,
        altitude: 0,
        observedAt: gdacsTime(ev.datemodified) ?? gdacsTime(ev.fromdate),
        source: "GDACS",
        details: {
          "GDACS alert level": level ?? `not rated by source (${ev.alertlevel ?? "none"})`,
          event: kind,
          severity: ev.severitytext?.trim() || undefined,
          country: ev.country,
          from: ev.fromdate,
          to: ev.todate,
          modified: ev.datemodified,
          "what the level means": "GDACS's estimate of humanitarian impact (Green, Orange, Red), not the physical size alone",
          "also on the Earthquakes layer": ev.alsoInUsgs ? "yes: the USGS 24 h feed has a quake within 100 km and 30 min" : undefined,
          "gdacs report": ev.report,
        },
        extra: x,
      },
    };
  });
}

/**
 * Mark GDACS earthquakes that are the same event as one in the USGS 24 h
 * feed the Earthquakes layer draws (within 100 km and 30 min). Nothing is
 * dropped here: the browser decides what to hide, and only while that layer
 * is on.
 */
export function flagQuakesInUsgs(events: GdacsEvent[], usgs: Array<{ lon: number; lat: number; t: number }>): { events: GdacsEvent[]; flagged: number } {
  let flagged = 0;
  const out = events.map((ev) => {
    if (ev.eventtype !== "EQ") return ev;
    const t = gdacsTime(ev.fromdate);
    // A quake with no readable time is never called a duplicate.
    const dup = t != null && usgs.some((q) => Math.abs(q.t - t) <= 30 * 60_000 && haversine(ev.lat, ev.lon, q.lat, q.lon) <= 100_000);
    if (!dup) return ev;
    flagged++;
    return { ...ev, alsoInUsgs: true };
  });
  return { events: out, flagged };
}

/** Whether a GDACS quake may be hidden while the Earthquakes layer is on: only Green ones USGS also has. */
export function hideableQuake(x: HazardAlertExtra): boolean {
  return x.source === "GDACS" && x.event === "earthquake" && x.alsoInUsgs === true && x.severity === "Green";
}

export interface EonetEvent {
  id: string;
  title: string;
  link?: string;
  sources?: Array<{ id: string; url: string }>;
  geometry?: Array<{ date: string; type: string; coordinates: number[] }>;
}

export function buildEonetVolcanoes(events: EonetEvent[]): LayerFeature<Point>[] {
  const out: LayerFeature<Point>[] = [];
  for (const ev of events) {
    const pts = (ev.geometry ?? []).filter((g) => g.type === "Point" && Array.isArray(g.coordinates) && g.coordinates.length >= 2);
    if (!pts.length) continue;
    const latest = pts.reduce((a, b) => (Date.parse(b.date) > Date.parse(a.date) ? b : a));
    const [lon, lat] = latest.coordinates;
    const x: HazardAlertExtra = { source: "EONET", event: "volcano", drawnAs: "point", start: Date.parse(latest.date) || undefined };
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat, 0] },
      properties: {
        id: `eonet:${ev.id}`,
        layer: "hazards",
        name: ev.title,
        kind: "volcano",
        altitude: 0,
        observedAt: x.start,
        source: "NASA EONET",
        details: {
          severity: "not rated by source (EONET lists open events without a level)",
          event: "volcanic activity (open event)",
          "latest report": latest.date,
          reports: pts.length,
          sources: (ev.sources ?? []).map((s) => s.id).join(", ") || undefined,
          "source page": ev.sources?.[0]?.url,
          "eonet record": ev.link,
        },
        extra: x,
      },
    });
  }
  return out;
}

/**
 * Pull the current events out of the GDACS RSS feed (~1 MB of XML) without an
 * XML library. The feed also carries events that have ended (54 of 280 on
 * 2026-09-26, five Orange droughts among them); only items GDACS marks
 * <gdacs:iscurrent>true</gdacs:iscurrent> are kept, and an item that does not
 * say is not assumed current.
 */
export function parseGdacsRss(xml: string): GdacsEvent[] {
  const out: GdacsEvent[] = [];
  const tag = (block: string, name: string): string | undefined => {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
    if (!m) return undefined;
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() || undefined;
  };
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    if (tag(b, "gdacs:iscurrent")?.toLowerCase() !== "true") continue;
    const lat = Number(tag(b, "geo:lat"));
    const lon = Number(tag(b, "geo:long"));
    const eventtype = tag(b, "gdacs:eventtype");
    const eventid = tag(b, "gdacs:eventid");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !eventtype || !eventid) continue;
    out.push({
      eventtype,
      eventid,
      episodeid: tag(b, "gdacs:episodeid"),
      name: tag(b, "title"),
      description: tag(b, "description"),
      alertlevel: tag(b, "gdacs:alertlevel"),
      country: tag(b, "gdacs:country"),
      fromdate: tag(b, "gdacs:fromdate"),
      todate: tag(b, "gdacs:todate"),
      datemodified: tag(b, "gdacs:datemodified"),
      severitytext: tag(b, "gdacs:severity"),
      report: tag(b, "link"),
      lon,
      lat,
    });
  }
  return out;
}

/** GDACS GeoJSON event list (EVENTS4APP and geteventlist/SEARCH share this shape). */
export interface GdacsGeoJson {
  features?: Array<{
    geometry: GeoJSON.Geometry | null;
    properties: {
      eventtype: string;
      eventid: number | string;
      episodeid?: number | string;
      name?: string;
      description?: string;
      alertlevel?: string;
      iscurrent?: string | boolean;
      country?: string;
      fromdate?: string;
      todate?: string;
      datemodified?: string;
      severitydata?: { severitytext?: string };
      url?: { report?: string };
    };
  }>;
}

/**
 * Current events from a GDACS GeoJSON list, plus how many rows the answer
 * held: both lists stop at 100 rows a page, so a full page may be cut.
 */
export function parseGdacsGeoJson(j: GdacsGeoJson): { events: GdacsEvent[]; rows: number } {
  const rows = j.features ?? [];
  const events: GdacsEvent[] = [];
  for (const f of rows) {
    const g = f.geometry;
    const p = f.properties;
    if (!g || g.type !== "Point" || !p || !p.eventtype || p.eventid == null) continue;
    if (String(p.iscurrent).toLowerCase() !== "true") continue;
    events.push({
      eventtype: p.eventtype,
      eventid: String(p.eventid),
      episodeid: p.episodeid != null ? String(p.episodeid) : undefined,
      name: p.name,
      description: p.description,
      alertlevel: p.alertlevel,
      country: p.country,
      fromdate: p.fromdate,
      todate: p.todate,
      datemodified: p.datemodified,
      severitytext: p.severitydata?.severitytext,
      report: p.url?.report,
      lon: g.coordinates[0],
      lat: g.coordinates[1],
    });
  }
  return { events, rows: rows.length };
}

/**
 * One record per GDACS event (eventtype + eventid) across several lists; when
 * two lists carry the same event, the most recently modified record wins,
 * and on a tie the earlier list.
 */
export function mergeGdacs(lists: GdacsEvent[][]): GdacsEvent[] {
  const byId = new Map<string, GdacsEvent>();
  for (const list of lists) {
    for (const ev of list) {
      const key = `${ev.eventtype}${ev.eventid}`;
      const cur = byId.get(key);
      if (!cur || (gdacsTime(ev.datemodified) ?? -Infinity) > (gdacsTime(cur.datemodified) ?? -Infinity)) byId.set(key, ev);
    }
  }
  return [...byId.values()];
}
