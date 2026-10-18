// Row -> feature builders for the infrastructure and geohazard layers:
// transmission lines, pipelines, rail, public-use airports, dams, power
// plants, Quaternary faults, landslides and the PLSS grid. Plain functions
// with no Cesium or React in them, shared by /api/infra and the browser
// layers, tested next to this file on payloads captured from each service.
//
// Every value is the publisher's own. Sentinels become undefined, never 0:
// HIFLD writes -999999 for a voltage it does not have and "NOT AVAILABLE" or
// "UNKNOWN<n>" for a substation it could not name. Coded values are decoded
// with the service's own domains (FRA's track network codes, passenger
// service codes), quoted in RAIL_NET / RAIL_PASSENGER below.
//
// Operators and owners (a transmission line's OWNER, a pipeline's operator,
// a railroad's reporting marks, a power plant's EIA entity) are shown as the
// public registry publishes them, in `details` only: never in a feature's
// `name`, never on the search allowlist (lib/search/allowlist.ts), never
// joined across sources. Street addresses, contact people and free-text notes
// are never read: the queries ask for explicit outFields that leave them out
// (NID's CONG_REPRESNTATIVE, OTHER_NAMES, FORMER_NAMES and DESIGNER_NAMES, and
// the landslide inventory's Notes, which quotes news stories naming homeowners).

import type { LineString, MultiLineString, MultiPolygon, Point, Polygon } from "geojson";
import type { LayerFeature, LayerId } from "@/lib/layers/types";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";

type Line = LineString | MultiLineString;
type Poly = Polygon | MultiPolygon;
export interface Row<P = Record<string, unknown>> {
  id?: number | string;
  geometry: GeoJSON.Geometry | null;
  properties: P;
}

export function isLine(g: GeoJSON.Geometry | null | undefined): g is Line {
  return !!g && (g.type === "LineString" || g.type === "MultiLineString");
}

export function isPoly(g: GeoJSON.Geometry | null | undefined): g is Poly {
  return !!g && (g.type === "Polygon" || g.type === "MultiPolygon");
}

function isPoint(g: GeoJSON.Geometry | null | undefined): g is Point {
  return !!g && g.type === "Point" && Number.isFinite(g.coordinates[0]) && Number.isFinite(g.coordinates[1]);
}

/** A trimmed string, or undefined for null, blank and the publisher's "not available" words. */
export function str(v: unknown, blanks: readonly string[] = []): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  const u = s.toUpperCase();
  if (u === "NOT AVAILABLE" || u === "N/A" || u === "NULL") return undefined;
  if (blanks.some((b) => u === b.toUpperCase())) return undefined;
  return s;
}

/** A finite number, or undefined for null, "" and anything at or below `sentinel` (Number(null) and Number("") are 0, not missing). */
export function finite(v: unknown, sentinel?: number): number | undefined {
  const n = typeof v === "number" ? v : v == null || (typeof v === "string" && v.trim() === "") ? NaN : Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (sentinel != null && n <= sentinel) return undefined;
  return n;
}

/** Epoch ms from ArcGIS (a number) to YYYY-MM-DD; undefined when missing. */
export function isoDay(v: unknown): string | undefined {
  const n = finite(v);
  if (n == null) return undefined;
  const d = new Date(n);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : undefined;
}

function fmtInt(n: number | undefined): string | undefined {
  return n == null ? undefined : Math.round(n).toLocaleString("en-US");
}

// ---------------------------------------------------------------- transmission lines (HIFLD archive)

export interface TransmissionProps {
  ID?: string | number | null;
  TYPE?: string | null;
  STATUS?: string | null;
  OWNER?: string | null;
  VOLTAGE?: number | null;
  VOLT_CLASS?: string | null;
  INFERRED?: string | null;
  SUB_1?: string | null;
  SUB_2?: string | null;
  SOURCEDATE?: number | null;
  VAL_DATE?: number | null;
}

export interface TransmissionExtra {
  /** kV as HIFLD publishes it; undefined where HIFLD wrote its -999999 sentinel. */
  kv?: number;
  voltClass?: string;
  /** Colour band: the published class, or "unknown". */
  band: "765" | "500" | "345" | "220-287" | "100-161" | "under-100" | "dc" | "unknown";
}

export function voltBand(kv: number | undefined, cls: string | undefined, type: string | undefined): TransmissionExtra["band"] {
  if ((type ?? "").toUpperCase().startsWith("DC") || (cls ?? "").toUpperCase() === "DC") return "dc";
  if (kv == null) {
    const c = (cls ?? "").toUpperCase();
    if (c.startsWith("735")) return "765";
    if (c === "500") return "500";
    if (c === "345") return "345";
    if (c === "220-287") return "220-287";
    if (c === "100-161") return "100-161";
    if (c === "UNDER 100" || c === "SUB 100") return "under-100";
    return "unknown";
  }
  if (kv >= 735) return "765";
  if (kv >= 450) return "500";
  if (kv >= 300) return "345";
  if (kv >= 200) return "220-287";
  if (kv >= 100) return "100-161";
  return "under-100";
}

/** HIFLD's placeholder substation names ("UNKNOWN304956", "TAP123", "NOT AVAILABLE") are not names. */
function substation(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (/^UNKNOWN\d*$/i.test(s)) return undefined;
  return s;
}

export function buildTransmission(rows: Row<TransmissionProps>[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    if (!isLine(r.geometry)) return;
    const p = r.properties;
    const kv = finite(p.VOLTAGE, 0);
    const cls = str(p.VOLT_CLASS, ["UNKNOWN"]);
    const type = str(p.TYPE);
    const from = substation(p.SUB_1);
    const to = substation(p.SUB_2);
    const extra: TransmissionExtra = { kv, voltClass: cls, band: voltBand(kv, cls, type) };
    const id = str(p.ID) ?? String(r.id ?? i);
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id: `hifld-tl:${id}`,
        layer: "transmission",
        name: kv != null ? `${kv} kV line` : cls ? `Transmission line (${cls.toLowerCase()} kV class)` : "Transmission line (voltage not published)",
        kind: extra.band,
        source: "HIFLD transmission lines (archive)",
        details: {
          voltage: kv != null ? `${kv} kV` : "not published",
          "voltage class": cls,
          "line type": type,
          status: str(p.STATUS),
          // As HIFLD published it; not searchable (lib/search/allowlist.ts).
          owner: str(p.OWNER),
          "from substation": from,
          "to substation": to,
          "attributes inferred by HIFLD": p.INFERRED === "Y" ? "yes" : p.INFERRED === "N" ? "no" : undefined,
          "source date": isoDay(p.SOURCEDATE),
          "validated": isoDay(p.VAL_DATE),
          "HIFLD id": id,
          "what this is": "HIFLD's archived map of lines at 69 kV and above, last updated 2024-09-30; lines built or retired since are not in it",
        },
        extra,
      },
    });
  });
  return out;
}

// ---------------------------------------------------------------- pipelines (EIA, via Esri's federal caches)

export type PipelineKind = "natgas" | "crude" | "products" | "hgl";

export const PIPELINE_LABEL: Record<PipelineKind, string> = {
  natgas: "Natural gas",
  crude: "Crude oil",
  products: "Petroleum products",
  hgl: "Hydrocarbon gas liquids",
};

export interface PipelineExtra {
  commodity: PipelineKind;
  pipeType?: string;
}

export function buildPipelines(kind: PipelineKind, rows: Row[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    if (!isLine(r.geometry)) return;
    const p = r.properties;
    // Natural gas: TYPEPIPE, Operator, Status. The liquids layers: Opername, Pipename.
    const pipename = str(p.Pipename);
    const operator = str(p.Operator) ?? str(p.Opername);
    const pipeType = str(p.TYPEPIPE);
    const fid = finite(p.FID) ?? r.id ?? i;
    const label = PIPELINE_LABEL[kind];
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id: `eia-pipe:${kind}:${fid}`,
        layer: "pipelines",
        // A system name as EIA publishes it ("Colonial", "Longhorn"); otherwise the commodity.
        name: pipename ? `${pipename} (${label.toLowerCase()})` : `${label} pipeline${pipeType ? ` · ${pipeType.toLowerCase()}` : ""}`,
        kind,
        source: "EIA pipelines (Esri federal cache)",
        details: {
          commodity: label,
          system: pipename,
          type: pipeType,
          status: str(p.Status),
          operator,
          "EIA feature id": String(fid),
          "what this is": "EIA's generalized national pipeline map: routes are approximate, with no diameter, pressure or capacity",
        },
        extra: { commodity: kind, pipeType } satisfies PipelineExtra,
      },
    });
  });
  return out;
}

// ---------------------------------------------------------------- rail (BTS NTAD North American Rail Network)

/** FRA's NET codes, as the service's coded-value domain publishes them. */
export const RAIL_NET: Record<string, string> = {
  M: "Main sub network",
  I: "Major Industrial Lead",
  O: "Other track (minor industrial leads)",
  S: "Passing sidings over 4000 feet long",
  Y: "Yard Tracks",
  F: "Rail ferry connection",
  X: "Out of service line",
  A: "Abandoned rail line",
  R: "Abandoned line that has been physicaly removed",
  T: "Trail on former rail right-of-way",
  Z: "Transit-only rail line or museum/tourist operation",
};

/** The service's PASSNGR domain. */
export const RAIL_PASSENGER: Record<string, string> = {
  A: "Amtrak",
  B: "Amtrak & Commuter",
  C: "Commuter",
  T: "Tourist, museum, or science passenger service",
  R: "Rapid Transit",
  D: "Alaska Railroad passenger service",
  O: "Ontario Northland (Canada Network Only)",
  V: "Via Rail Canada (Canada Network Only)",
  I: "Intercity HSR",
  E: "Intercity HSR & Commuter",
};

/** The service's STRACNET domain (the Strategic Rail Corridor Network). */
export const RAIL_STRACNET: Record<string, string> = { S: "STRACNET designated line", C: "Connector designated line" };

export interface RailExtra {
  net?: string;
  passenger?: string;
  tracks?: number;
  /** Colour class. */
  cls: "main" | "passenger" | "branch" | "yard" | "inactive";
}

function railClass(net: string | undefined, passenger: string | undefined): RailExtra["cls"] {
  if (net === "X" || net === "A" || net === "R" || net === "T") return "inactive";
  if (passenger) return "passenger";
  if (net === "M") return "main";
  if (net === "Y") return "yard";
  return "branch";
}

export function buildRail(rows: Row[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    if (!isLine(r.geometry)) return;
    const p = r.properties;
    const net = str(p.NET);
    const passenger = str(p.PASSNGR);
    const tracks = finite(p.TRACKS, 0);
    const subdiv = str(p.SUBDIV)?.replace(/\s+/g, " ");
    const yard = str(p.YARDNAME)?.replace(/\s+/g, " ");
    const owners = [p.RROWNER1, p.RROWNER2, p.RROWNER3].map((v) => str(v)).filter((v): v is string => !!v);
    const rights = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => str(p[`TRKRGHTS${k}`])).filter((v): v is string => !!v);
    const id = finite(p.FRAARCID) ?? r.id ?? i;
    const extra: RailExtra = { net, passenger, tracks, cls: railClass(net, passenger) };
    const miles = finite(p.MILES, 0);
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id: `narn:${id}`,
        layer: "rail",
        // FRA's subdivision or yard name; the railroad's reporting marks stay in details.
        name: yard ? (/\b(YARD|TERMINAL|TERM)\b/i.test(yard) ? yard : `${yard} yard`) : subdiv ? `${subdiv} subdivision` : net ? RAIL_NET[net] ?? "Rail line" : "Rail line",
        kind: extra.cls,
        source: "BTS NTAD North American Rail Network",
        details: {
          network: net ? `${RAIL_NET[net] ?? net} (${net})` : undefined,
          subdivision: subdiv,
          yard,
          "owning railroads (reporting marks)": owners.length ? owners.join(", ") : undefined,
          "trackage rights": rights.length ? rights.join(", ") : undefined,
          "passenger service": passenger ? RAIL_PASSENGER[passenger] ?? passenger : undefined,
          STRACNET: str(p.STRACNET) ? RAIL_STRACNET[String(p.STRACNET)] ?? String(p.STRACNET) : undefined,
          tracks,
          "segment length": miles != null ? `${miles.toFixed(2)} mi` : undefined,
          state: str(p.STATEAB),
          "FRA arc id": String(id),
        },
        extra,
      },
    });
  });
  return out;
}

// ---------------------------------------------------------------- airports (FAA ADDS, public use only)

/** FAA TYPE_CODE values in the ADDS Airports layer. */
export const AIRPORT_TYPE: Record<string, string> = {
  AD: "airport",
  HP: "heliport",
  SP: "seaplane base",
  UL: "ultralight park",
  GL: "gliderport",
  BP: "balloonport",
};

export interface AirportExtra {
  type?: string;
  military?: string;
  ident?: string;
}

export function buildAirports(rows: Row[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  for (const r of rows) {
    if (!isPoint(r.geometry)) continue;
    const p = r.properties;
    // The query asks for PRIVATEUSE=0; a private-use strip that slipped through is dropped here too.
    if (finite(p.PRIVATEUSE) !== 0) continue;
    const ident = str(p.IDENT);
    const icao = str(p.ICAO_ID);
    const type = str(p.TYPE_CODE);
    const name = str(p.NAME) ?? ident ?? "Airport";
    const elevation = finite(p.ELEVATION);
    const id = ident ?? str(p.GLOBAL_ID) ?? `${r.geometry.coordinates[0]},${r.geometry.coordinates[1]}`;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.geometry.coordinates[0], r.geometry.coordinates[1], 0] },
      properties: {
        id: `faa:${id}`,
        layer: "airports",
        name: ident ? `${name} (${ident})` : name,
        kind: type ? AIRPORT_TYPE[type] ?? type : "airport",
        source: "FAA ADDS airports",
        details: {
          "FAA location id": ident,
          "ICAO code": icao,
          type: type ? `${AIRPORT_TYPE[type] ?? type} (${type})` : undefined,
          use: "public use",
          "serves city": str(p.SERVCITY),
          state: str(p.STATE),
          country: str(p.COUNTRY),
          status: str(p.OPERSTATUS),
          military: str(p.MIL_CODE),
          "field elevation": elevation != null ? `${elevation} ft` : undefined,
          "instrument approach published": p.IAPEXISTS === 1 ? "yes" : p.IAPEXISTS === 0 ? "no" : undefined,
        },
        extra: { type, military: str(p.MIL_CODE), ident } satisfies AirportExtra,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------- dams (USACE National Inventory of Dams)

export interface DamExtra {
  /** NID hazard potential classification as published: High, Significant, Low, Undetermined. */
  hazard?: string;
  condition?: string;
  heightFt?: number;
  storageAcFt?: number;
}

export function buildDams(rows: Row[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  for (const r of rows) {
    const p = r.properties;
    // The service's own point, or its published LATITUDE/LONGITUDE.
    let lon: number | undefined;
    let lat: number | undefined;
    if (isPoint(r.geometry)) [lon, lat] = r.geometry.coordinates;
    else {
      lon = finite(p.LONGITUDE);
      lat = finite(p.LATITUDE);
    }
    if (lon == null || lat == null || (lon === 0 && lat === 0)) continue;
    const nid = str(p.NIDID);
    if (!nid) continue;
    const hazard = str(p.HAZARD_POTENTIAL);
    const condition = str(p.CONDITION_ASSESSMENT);
    const heightFt = finite(p.NID_HEIGHT, 0);
    const storageAcFt = finite(p.NID_STORAGE, 0);
    const year = finite(p.YEAR_COMPLETED, 0);
    // A privately owned dam is often named for its owner ("<Surname> Pond Dam"),
    // and the palette matches feature names, so it is labelled by its NID id;
    // the published name stays in the dossier under a key the palette never searches.
    const isPrivate = str(p.PRIMARY_OWNER_TYPE)?.toLowerCase() === "private";
    const damName = str(p.NAME);
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat, 0] },
      properties: {
        id: `nid:${nid}`,
        layer: "dams",
        name: isPrivate || !damName ? `Dam ${nid}` : damName,
        kind: (hazard ?? "not rated").toLowerCase(),
        source: "USACE National Inventory of Dams",
        details: {
          "NID id": nid,
          "published name": isPrivate ? damName : undefined,
          "hazard potential": hazard ?? "not rated by source",
          "what hazard potential means": "the damage a failure would cause downstream (High: loss of life likely), not the dam's condition or how likely it is to fail",
          "condition assessment": condition,
          "condition assessed": isoDay(p.CONDITION_ASSESS_DATE),
          "primary purpose": str(p.PRIMARY_PURPOSE),
          purposes: str(p.PURPOSES),
          "dam type": str(p.PRIMARY_DAM_TYPE),
          "NID height": heightFt != null ? `${fmtInt(heightFt)} ft` : undefined,
          "NID storage": storageAcFt != null ? `${fmtInt(storageAcFt)} acre-ft` : undefined,
          "surface area": finite(p.SURFACE_AREA, 0) != null ? `${fmtInt(finite(p.SURFACE_AREA, 0))} acres` : undefined,
          "drainage area": finite(p.DRAINAGE_AREA, 0) != null ? `${finite(p.DRAINAGE_AREA, 0)} sq mi` : undefined,
          "year completed": year,
          "river or stream": str(p.RIVER_OR_STREAM),
          county: str(p.COUNTYSTATE),
          state: str(p.STATE),
          "owner type": str(p.PRIMARY_OWNER_TYPE),
          "emergency action plan": str(p.EAP_PREPARED),
          "operational status": str(p.OPERATIONAL_STATUS),
          "NID record updated": isoDay(p.DATA_UPDATED),
        },
        // Record text: the published name only when the dam is not private (B0; a private dam's name never),
        // never the NID id (matched by letters), never a height or storage (measured).
        extra: withEmbedText(
          { hazard, condition, heightFt, storageAcFt } satisfies DamExtra,
          recordText(
            "nid-dams",
            { PRIMARY_PURPOSE: str(p.PRIMARY_PURPOSE), PRIMARY_DAM_TYPE: str(p.PRIMARY_DAM_TYPE), HAZARD_POTENTIAL: hazard, CONDITION_ASSESSMENT: condition, COUNTYSTATE: str(p.COUNTYSTATE), STATE: str(p.STATE), YEAR_COMPLETED: year },
            // A missing owner type is unknown, not public: named only when a non-private owner type is published.
            isPrivate || !str(p.PRIMARY_OWNER_TYPE) ? null : damName,
          ),
        ),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------- Quaternary faults (USGS Qfaults, National Database)

export interface FaultExtra {
  /** Age of most recent deformation as USGS writes it ("historic", "latest Quaternary", …). */
  age?: string;
  /** Colour class from the published age. */
  ageClass: "historic" | "latest" | "late" | "middle-late" | "undifferentiated" | "unspecified";
  lineType?: string;
}

/** The age classes in USGS's own legend for this layer (MapServer/legend, layer 21). */
export const FAULT_AGE_LEGEND: Record<FaultExtra["ageClass"], string> = {
  historic: "Historic (< 150 years)",
  latest: "Latest Quaternary (<15,000 years)",
  late: "Late Quaternary (< 130,000 years)",
  "middle-late": "Middle and late Quaternary (< 750,000 years)",
  undifferentiated: "Undifferentiated Quaternary (< 1.6 million years)",
  unspecified: "Unspecified age, or Class B (various age)",
};

export function faultAgeClass(age: string | undefined): FaultExtra["ageClass"] {
  const a = (age ?? "").trim().toLowerCase();
  if (a === "historic") return "historic";
  if (a === "latest quaternary") return "latest";
  if (a === "middle and late quaternary") return "middle-late";
  if (a === "late quaternary") return "late";
  if (a === "undifferentiated quaternary") return "undifferentiated";
  // "unspecified", "class B" and anything new: not rated by source, never drawn as the oldest class.
  return "unspecified";
}

export function buildFaults(rows: Row[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    if (!isLine(r.geometry)) return;
    const p = r.properties;
    const fault = str(p.fault_name);
    const section = str(p.section_name);
    const faultId = str(p.fault_id);
    const sectionId = str(p.section_id);
    const age = str(p.age);
    const lineType = str(p.linetype);
    const extra: FaultExtra = { age, ageClass: faultAgeClass(age), lineType };
    const reviewed = isoDay(p.last_review);
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id: `qfault:${faultId ?? "x"}${sectionId ? "-" + sectionId : ""}:${r.id ?? i}`,
        layer: "faults",
        name: fault ? `${fault}${section ? `, ${section}` : ""}` : "Quaternary fault",
        kind: extra.ageClass,
        source: "USGS Quaternary Fault and Fold Database",
        details: {
          fault,
          section,
          "fault number": faultId ? `${faultId}${sectionId ? sectionId : ""}` : undefined,
          "age of most recent deformation": age ? `${age}${extra.ageClass !== "unspecified" ? ` · ${FAULT_AGE_LEGEND[extra.ageClass]}` : ""}` : "unspecified",
          "slip rate": str(p.slip_rate),
          "slip sense": str(p.slip_sense),
          "dip direction": str(p.dip_direction),
          "fault class": str(p.class),
          "line type": lineType,
          "mapping certainty": str(p.mapped_certainty),
          "mapped at": str(p.mapped_scale),
          "last reviewed": reviewed,
          "USGS fault report": str(p.fault_url),
          "what this is": "a fault USGS judges active in the Quaternary (the last ~1.6 million years); not a forecast of earthquakes",
        },
        extra,
      },
    });
  });
  return out;
}

// ---------------------------------------------------------------- landslides (USGS US Landslide Inventory v3, points)

export interface LandslideExtra {
  confidence?: number;
  type?: string;
  fatalities?: number;
}

/** "2017/01/01 00:00:00.000" -> "2017-01-01". */
function slDate(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

export function buildLandslides(rows: Row[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  for (const r of rows) {
    if (!isPoint(r.geometry)) continue;
    const p = r.properties;
    const id = str(p.USGS_ID);
    if (!id) continue;
    const type = str(p.LS_Type);
    const confidence = finite(p.Confidence);
    const fatalities = finite(p.Fatalities);
    const from = slDate(p.Date_Min);
    const to = slDate(p.Date_Max);
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.geometry.coordinates[0], r.geometry.coordinates[1], 0] },
      properties: {
        id: `usls:${id}`,
        layer: "landslides",
        name: type ? `Landslide · ${type}` : "Landslide (type not recorded)",
        kind: type ?? "not recorded",
        source: "USGS US Landslide Inventory v3",
        details: {
          "USGS id": id,
          type: type ?? "not recorded in the source inventory",
          // USGS: the date is a range when the event is not known to the day.
          date: from && to ? `between ${from} and ${to}` : from ? from : to ? `on or before ${to}` : "not recorded",
          confidence:
            confidence != null
              ? `${confidence} (USGS's confidence in the entry's location and extent; higher is more confident, and the rules differ by source inventory)`
              : undefined,
          fatalities,
          "source inventory": str(p.Inventory),
          "inventory link": str(p.Inv_URL),
          "information source": str(p.Info_Sourc),
        },
        extra: { confidence, type, fatalities } satisfies LandslideExtra,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------- PLSS (BLM CadNSDI)

export interface PlssExtra {
  level: "township" | "section";
  plssId?: string;
  label?: string;
}

/**
 * BLM's township label as "T12N R3W". Most states write "12N 3W"; Washington writes
 * "T12N R03W"; fractional townships are "12.5N 3W". Leading zeros go, nothing else changes.
 */
export function townshipName(label: string | undefined): { township?: string; range?: string } {
  const parts = (label ?? "").trim().split(/\s+/);
  if (parts.length !== 2) return {};
  const t = parts[0].replace(/^T/i, "").replace(/^0+(?=\d)/, "");
  const r = parts[1].replace(/^R/i, "").replace(/^0+(?=\d)/, "");
  return { township: `T${t}`, range: `R${r}` };
}

/** Townships (layer 1) and sections (layer 2) as outlines, labelled with BLM's own labels. */
export function buildPlss(level: PlssExtra["level"], rows: Row[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    if (!isPoly(r.geometry)) return;
    const p = r.properties;
    const plssId = str(p.PLSSID);
    if (level === "township") {
      const label = str(p.TWNSHPLAB);
      const tr = townshipName(label);
      out.push({
        type: "Feature",
        geometry: r.geometry,
        properties: {
          id: `plss-t:${plssId ?? i}`,
          layer: "plss",
          name: tr.township ? `${tr.township} ${tr.range}${str(p.STATEABBR) ? ` · ${str(p.STATEABBR)}` : ""}` : "PLSS township",
          kind: "township",
          source: "BLM National PLSS (CadNSDI)",
          details: {
            township: tr.township,
            range: tr.range,
            "principal meridian": str(p.PRINMER),
            state: str(p.STATEABBR),
            "PLSS id": plssId,
          },
          extra: { level, plssId, label } satisfies PlssExtra,
        },
      });
    } else {
      // Alaska writes "SEC 33" where the other states write "33".
      const label = (str(p.FRSTDIVLAB) ?? str(p.FRSTDIVNO))?.replace(/^SEC\.?\s*/i, "");
      const what = str(p.FRSTDIVTXT) ?? "Section";
      out.push({
        type: "Feature",
        geometry: r.geometry,
        properties: {
          id: `plss-s:${str(p.FRSTDIVID) ?? i}`,
          layer: "plss",
          name: label ? `${what} ${label}` : what,
          kind: "section",
          source: "BLM National PLSS (CadNSDI)",
          details: {
            section: label,
            division: what,
            "PLSS id": plssId,
            "first division id": str(p.FRSTDIVID),
          },
          extra: { level, plssId, label } satisfies PlssExtra,
        },
      });
    }
  });
  return out;
}

/** The layer ids this module builds for (the route checks what it serves). */
export const INFRA_BUILT: readonly LayerId[] = ["transmission", "pipelines", "rail", "airports", "dams", "faults", "landslides", "plss"];
