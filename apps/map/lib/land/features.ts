// Row -> feature builders for the three land layers (flood zones, wetlands,
// public & protected lands) and the elevation readout. Plain functions with
// no Cesium or React in them, shared by /api/land and the browser layers.
//
// Every label here is either the upstream's own value or its published
// definition: FEMA's zone meanings, the Cowardin names decoded from NWI's
// own ATTRIBUTE code, PAD-US's coded-value domains read from the
// layer's metadata. Sentinels (-9999, -1000000) become undefined.

import type { MultiPolygon, Polygon } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";

type Poly = Polygon | MultiPolygon;

function isPoly(g: GeoJSON.Geometry | null | undefined): g is Poly {
  return !!g && (g.type === "Polygon" || g.type === "MultiPolygon");
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function finite(v: unknown, sentinel?: number): number | undefined {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (sentinel != null && n <= sentinel) return undefined;
  return n;
}

// ---------------------------------------------------------------- FEMA NFHL

export interface FloodZoneExtra {
  zone: string;
  subtype?: string;
  /** Special Flood Hazard Area (the 1 % annual-chance floodplain), as FEMA flags it. */
  sfha?: boolean;
  /** Static base flood elevation, only where FEMA publishes one. */
  bfe?: number;
  /** Flood depth for AO zones. */
  depth?: number;
  unit?: string;
  datum?: string;
  dfirm?: string;
  studyType?: string;
  /** Hazard class used for colour; derived from the zone and subtype FEMA published. */
  hazard: "coastal" | "sfha" | "moderate" | "minimal" | "undetermined" | "water" | "other";
}

/** FEMA's own zone definitions (FEMA "Flood Zones", fema.gov/glossary/flood-zones). */
export function floodZoneMeaning(zone: string, subtype?: string): string {
  const z = zone.toUpperCase();
  if (z === "VE" || z === "V") return "coastal high-hazard area: 1 % annual-chance flood with storm-induced waves (base flood)";
  if (z === "AE" || z === "A" || z === "AH" || z === "AO" || z === "AR" || z === "A99") {
    const extra =
      z === "AO" ? " shallow flooding (sheet flow), depth given" :
      z === "AH" ? " shallow ponding, elevation given" :
      z === "AR" ? " temporarily increased risk while a levee is restored" :
      z === "A99" ? " to be protected by a federal flood-protection system under construction" :
      z === "A" ? " no base flood elevation determined" : "";
    return `1 % annual-chance flood (base flood, "100-year")${extra ? ";" + extra : ""}`;
  }
  if (z === "X") {
    const s = (subtype ?? "").toUpperCase();
    if (s.includes("0.2 PCT")) return "0.2 % annual-chance flood (\"500-year\") or 1 % with average depth under 1 ft";
    if (s.includes("LEVEE")) return "reduced flood risk due to a levee";
    if (s.includes("FUTURE")) return "1 % annual-chance flood under future conditions (a local study, not the regulatory base flood)";
    if (s.includes("MINIMAL")) return "area of minimal flood hazard (outside the 0.2 % annual-chance floodplain)";
    return subtype ? subtype.toLowerCase() : "outside the special flood hazard area";
  }
  if (z === "D") return "possible but undetermined flood hazard: no FEMA analysis";
  if (z === "OPEN WATER") return "open water";
  return subtype ? `${zone}: ${subtype.toLowerCase()}` : zone;
}

function floodHazard(zone: string, subtype: string | undefined, sfha: boolean | undefined): FloodZoneExtra["hazard"] {
  const z = zone.toUpperCase();
  if (z === "VE" || z === "V") return "coastal";
  if (sfha || z.startsWith("A")) return "sfha";
  if (z === "D") return "undetermined";
  if (z === "OPEN WATER") return "water";
  if (z === "X") {
    const s = (subtype ?? "").toUpperCase();
    if (s.includes("MINIMAL")) return "minimal";
    return "moderate";
  }
  return "other";
}

export interface NfhlProps {
  FLD_AR_ID?: string | null;
  FLD_ZONE?: string | null;
  ZONE_SUBTY?: string | null;
  SFHA_TF?: string | null;
  STATIC_BFE?: number | null;
  DEPTH?: number | null;
  LEN_UNIT?: string | null;
  V_DATUM?: string | null;
  DFIRM_ID?: string | null;
  STUDY_TYP?: string | null;
}

export function buildFloodZones(rows: Array<{ geometry: GeoJSON.Geometry | null; properties: NfhlProps }>): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    if (!isPoly(r.geometry)) return;
    const p = r.properties;
    const zone = str(p.FLD_ZONE) ?? "unknown";
    const subtype = str(p.ZONE_SUBTY);
    const sfha = p.SFHA_TF === "T" ? true : p.SFHA_TF === "F" ? false : undefined;
    const bfe = finite(p.STATIC_BFE, -9998);
    const depth = finite(p.DEPTH, -9998);
    const unit = str(p.LEN_UNIT);
    const datum = str(p.V_DATUM);
    const u = unit ? ` ${unit.toLowerCase()}` : "";
    const extra: FloodZoneExtra = {
      zone,
      subtype,
      sfha,
      bfe,
      depth,
      unit,
      datum,
      dfirm: str(p.DFIRM_ID),
      studyType: str(p.STUDY_TYP),
      hazard: floodHazard(zone, subtype, sfha),
    };
    const id = str(p.FLD_AR_ID) ?? `${extra.dfirm ?? "nfhl"}:${i}`;
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id: `nfhl:${id}`,
        layer: "flood",
        name: `Zone ${zone}${bfe != null ? ` · BFE ${bfe}${u}` : ""}`,
        kind: extra.hazard,
        source: "FEMA NFHL",
        details: {
          zone,
          meaning: floodZoneMeaning(zone, subtype),
          subtype,
          "special flood hazard area": sfha,
          "base flood elevation": bfe != null ? `${bfe}${u}${datum ? " " + datum : ""}` : undefined,
          depth: depth != null ? `${depth}${u}` : undefined,
          "FIRM database": extra.dfirm,
          study: extra.studyType,
          "what this is": "FEMA's regulatory flood map (FIRM), not a forecast of any flood",
          "fema map service": "https://msc.fema.gov/portal/home",
        },
        extra: withEmbedText(
          extra,
          recordText("fema-nfhl-zones", {
            FLD_ZONE: zone === "unknown" ? undefined : `${zone} (${floodZoneMeaning(zone, subtype)})`,
            ZONE_SUBTY: subtype,
            SFHA_TF: sfha == null ? undefined : sfha ? "yes" : "no",
            STUDY_TYP: extra.studyType,
          }),
        ),
      },
    });
  });
  return out;
}

// ---------------------------------------------------------------- USFWS NWI

/** USFWS's own caveat for NWI maps ("Wetlands Data Limitations, Exclusions and Precautions"). */
export const NWI_CAVEAT = "Wetlands or other mapped features may have changed since the date of the imagery and/or field work.";

/** One NWI mapping project (a quad) from the Data_Source layer: when and from what it was mapped. */
export interface NwiSource {
  project?: string;
  /** Year of the imagery the polygons were drawn from. */
  year?: number;
  /** Imagery date as NWI publishes it, e.g. "03/83". */
  date?: string;
  /** Imagery scale denominator, e.g. 58000 for 1:58,000. */
  scale?: number;
  /** CIR colour infrared, TC true colour, BW black and white, Scalable. */
  imageType?: string;
  /** Outer rings of the project area, [lon, lat]. */
  rings: number[][][];
}

export function parseNwiSources(rows: Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }>): NwiSource[] {
  const out: NwiSource[] = [];
  for (const r of rows) {
    if (!isPoly(r.geometry)) continue;
    const p = r.properties;
    const polys = r.geometry.type === "Polygon" ? [r.geometry.coordinates] : r.geometry.coordinates;
    const year = finite(p.IMAGE_YR);
    out.push({
      project: str(p.PROJECT_NAME),
      // NWI uses 0 where the year is not recorded.
      year: year != null && year > 1900 ? year : undefined,
      date: str(p.IMAGE_DATE),
      scale: finite(p.IMAGE_SCALE, 0),
      imageType: str(p.SOURCE_TYPE) ?? str(p.EMULSION),
      rings: polys.map((poly) => poly[0]).filter((ring) => Array.isArray(ring) && ring.length > 2),
    });
  }
  return out;
}

/** Even-odd point-in-ring test on [lon, lat] pairs. */
export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** "1983 imagery (Southton, CIR 1:58,000, 03/83)". */
export function nwiSourceText(s: NwiSource): string {
  const bits = [s.project, [s.imageType, s.scale ? `1:${s.scale.toLocaleString("en-US")}` : undefined].filter(Boolean).join(" ") || undefined, s.date].filter(Boolean);
  return `${s.year != null ? `${s.year} imagery` : "imagery of unrecorded year"}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/** The mapping project whose area holds the middle of this polygon's outer ring, if any. */
function sourceFor(g: Poly, sources: NwiSource[]): NwiSource | undefined {
  const ring = (g.type === "Polygon" ? g.coordinates : g.coordinates[0])?.[0];
  if (!ring?.length) return undefined;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  const lon = (w + e) / 2;
  const lat = (s + n) / 2;
  return sources.find((src) => src.rings.some((r) => pointInRing(lon, lat, r)));
}

export interface WetlandExtra {
  /** Cowardin code, e.g. PEM1A. */
  code: string;
  type?: string;
  acres?: number;
  system?: string;
  subsystem?: string;
  cls?: string;
  regime?: string;
  /** Year of the imagery the polygon was drawn from (NWI Data_Source); undefined when not found. */
  imageYear?: number;
}

/** Cowardin system letters (first character of the ATTRIBUTE code). */
const COWARDIN_SYSTEMS: Record<string, string> = {
  M: "Marine",
  E: "Estuarine",
  R: "Riverine",
  L: "Lacustrine",
  P: "Palustrine",
};

/** Cowardin subsystems (digit after the system letter; Palustrine has none). */
const COWARDIN_SUBSYSTEMS: Record<string, Record<string, string>> = {
  M: { 1: "Subtidal", 2: "Intertidal" },
  E: { 1: "Subtidal", 2: "Intertidal" },
  // R5 is NWI's own "Unknown Perennial" (NWI's code table names it so, 2026-10-12).
  R: { 1: "Tidal", 2: "Lower Perennial", 3: "Upper Perennial", 4: "Intermittent", 5: "Unknown Perennial" },
  L: { 1: "Limnetic", 2: "Littoral" },
};

/** Cowardin class letters (two letters after the system/subsystem). */
const COWARDIN_CLASSES: Record<string, string> = {
  RB: "Rock Bottom",
  UB: "Unconsolidated Bottom",
  AB: "Aquatic Bed",
  RF: "Reef",
  US: "Unconsolidated Shore",
  ML: "Moss-Lichen",
  EM: "Emergent",
  SS: "Scrub-Shrub",
  FO: "Forested",
  SB: "Streambed",
  RS: "Rocky Shore",
  OW: "Open Water",
};

/** Cowardin water-regime letters (letter after the class + subclass digit). */
const COWARDIN_REGIMES: Record<string, string> = {
  A: "Temporarily Flooded",
  B: "Saturated",
  C: "Seasonally Flooded",
  D: "Seasonally Flooded–Well Drained",
  E: "Seasonally Flooded–Saturated",
  F: "Semipermanently Flooded",
  G: "Intermittently Exposed",
  H: "Permanently Flooded",
  J: "Intermittently Flooded",
  K: "Artificially Flooded",
  L: "Subtidal",
  M: "Irregularly Exposed",
  N: "Regularly Flooded",
  P: "Irregularly Flooded",
  S: "Temporarily Flooded–Fresh Tidal",
  T: "Semipermanently Flooded–Fresh Tidal",
  V: "Permanently Flooded–Fresh Tidal",
};

/**
 * Decode the Cowardin system/subsystem/class/water-regime names from an NWI
 * ATTRIBUTE code (e.g. PEM1A → Palustrine / Emergent / Temporarily Flooded).
 * Local replacement for the NWI_Wetland_Codes join, which USFWS stopped
 * publishing with the 11.5 service republish; no second upstream call.
 * Unknown parts stay undefined — never guessed.
 */
export function decodeCowardin(code: string): {
  system?: string;
  subsystem?: string;
  cls?: string;
  regime?: string;
} {
  const out: { system?: string; subsystem?: string; cls?: string; regime?: string } = {};
  if (!code) return out;
  const system = COWARDIN_SYSTEMS[code[0]];
  if (!system) return out;
  out.system = system;
  let rest = code.slice(1);
  const subs = COWARDIN_SUBSYSTEMS[code[0]];
  if (subs && /^\d/.test(rest)) {
    out.subsystem = subs[rest[0]];
    rest = rest.slice(1);
  }
  const cls = COWARDIN_CLASSES[rest.slice(0, 2)];
  if (!cls) return out;
  out.cls = cls;
  rest = rest.slice(2).replace(/^\d/, ""); // skip the subclass digit
  const regime = COWARDIN_REGIMES[rest[0]];
  if (regime) out.regime = regime;
  return out;
}

/**
 * Wetland polygons from NWI's Wetlands layer 0 (plain fields ATTRIBUTE,
 * WETLAND_TYPE, ACRES, OBJECTID since USFWS dropped the joined code table in
 * 2026), the Cowardin names decoded locally from the code.
 */
export function buildWetlands(
  rows: Array<{ id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>,
  sources: NwiSource[] = [],
): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    if (!isPoly(r.geometry)) return;
    const p = r.properties ?? {};
    const code = str(p.ATTRIBUTE) ?? "unclassified";
    const cow = decodeCowardin(code);
    const src = sourceFor(r.geometry, sources);
    const x: WetlandExtra = {
      code,
      type: str(p.WETLAND_TYPE),
      acres: finite(p.ACRES),
      system: cow.system,
      subsystem: cow.subsystem,
      cls: cow.cls,
      regime: cow.regime,
      imageYear: src?.year,
    };
    const oid = str(p.OBJECTID) ?? str(r.id) ?? `${code}:${i}`;
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id: `nwi:${oid}`,
        layer: "wetlands",
        name: x.type ? `${x.type} · ${code}` : code,
        kind: x.type ?? "wetland",
        source: "USFWS NWI",
        details: {
          type: x.type,
          "cowardin code": code,
          system: x.system,
          subsystem: x.subsystem,
          class: x.cls,
          "water regime": x.regime,
          acres: x.acres != null ? x.acres.toFixed(x.acres < 10 ? 2 : 1) : undefined,
          "mapped from": src ? nwiSourceText(src) : "imagery date not found in NWI's source layer",
          "what this is": "a wetland habitat mapped from that imagery, not a jurisdictional (Clean Water Act) delineation",
          "usfws caveat": NWI_CAVEAT,
          "nwi code guide": "https://www.fws.gov/program/national-wetlands-inventory/classification-codes",
        },
        extra: withEmbedText(x, recordText("nwi-wetlands", { WETLAND_TYPE: x.type, SYSTEM_NAME: x.system, CLASS_NAME: x.cls, WATER_REGIME_NAME: x.regime })),
      },
    });
  });
  return out;
}

/** Imagery years across the projects in a box, oldest first, and their names. */
export function nwiImagerySummary(sources: NwiSource[]): { years: number[]; projects: string[] } {
  const years = [...new Set(sources.map((s) => s.year).filter((y): y is number => y != null))].sort((a, b) => a - b);
  const projects = [...new Set(sources.map((s) => s.project).filter((p): p is string => !!p))].sort();
  return { years, projects };
}

// ---------------------------------------------------------------- NPS National Register

/**
 * The National Historic Landmarks clause (NPS flags an NHL with Is_NHL = 'X'), ANDed onto the
 * route's where, never replacing it: the listed-only and restricted-address exclusions stay.
 * 1,196 listed NHL points on layer 0 and 1,700 boundaries on layer 1 (1,699 after the
 * restricted-address exclusion), counted 2026-10-16.
 */
export const NHL_CLAUSE = "Is_NHL='X'";

/** The where for NRHP listings, narrowed to National Historic Landmarks when asked. */
export function nrhpWhere(base: string, nhlOnly: boolean): string {
  return nhlOnly ? `${base} AND ${NHL_CLAUSE}` : base;
}

/**
 * The fields the route asks NPS's nrhp_locations layers for. Address, Vicinity and every
 * bookkeeping field stay at the source: no street address is ever requested.
 */
export const NRHP_FIELDS = ["OBJECTID", "NRIS_Refnum", "RESNAME", "ResType", "City", "County", "State", "Is_NHL", "CertDate", "NARA_URL"] as const;

/** What NPS publishes, and what it withholds (route caveat, InfoPanel banner, README). */
export const NRHP_CAVEAT =
  "Only National Register properties that NPS publishes as non-restricted (NPS describes the service as \"all public, NON-SENSITIVE OR RESTRICTED historic properties\"). Archaeological sites whose locations are withheld under NHPA section 304 / ARPA are not in this source and are not shown. Absence on the map does not mean no resource is present. This is not a substitute for Section 106 consultation or a SHPO file search.";

export interface HistoricExtra {
  /** NRIS reference number, NPS's id for the listing. */
  refnum?: string;
  /** building, structure, district, site or object, as NPS types it. */
  resType?: string;
  /** NPS flags National Historic Landmarks with "X"; anything else is not flagged. */
  nhl: boolean;
  /** Listing (certification) date as far as NPS publishes it: "2007-10" or "2007-10-15". */
  listed?: string;
  shape: "point" | "boundary";
}

/**
 * NPS's CertDate, leniently: it is usually "YYYY-MM-" (no day). "2007-10-" is 2007-10,
 * "2007-10-15" stays a day, "2007" a year; a blank or anything else is no date, never a guess.
 */
export function parseCertDate(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?-?$/);
  if (!m) return undefined;
  const y = Number(m[1]);
  if (y < 1966 || y > 2100) return undefined;
  if (m[2] && (Number(m[2]) < 1 || Number(m[2]) > 12)) return undefined;
  if (m[3] && (Number(m[3]) < 1 || Number(m[3]) > 31)) return undefined;
  return [m[1], m[2], m[3]].filter(Boolean).join("-");
}

/**
 * National Register listings as NPS publishes them: points (layer 0) or boundaries
 * (layer 1). The feature is named by its NRIS number and type, so the search palette
 * (which matches names) never goes from a person's name to a place: a property's name
 * can be one ("Milam, Ben, Statue"). That name is shown in the dossier and drawn as
 * the globe's label (lib/globe/landStyles.ts historicLabel), as NPS lists it, but it is
 * never the feature's name and never searched.
 */
export function buildHistoric(
  rows: Array<{ id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>,
  shape: HistoricExtra["shape"],
): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    const g = r.geometry;
    if (!g) return;
    if (shape === "point" ? g.type !== "Point" : !isPoly(g)) return;
    const p = r.properties ?? {};
    const refnum = str(p.NRIS_Refnum);
    const resType = str(p.ResType)?.toLowerCase();
    const x: HistoricExtra = { refnum, resType, nhl: str(p.Is_NHL)?.toUpperCase() === "X", listed: parseCertDate(p.CertDate), shape };
    const oid = str(p.OBJECTID) ?? str(r.id) ?? `${refnum ?? "nrhp"}:${i}`;
    const nara = str(p.NARA_URL);
    out.push({
      type: "Feature",
      geometry: g,
      properties: {
        id: `nrhp:${shape === "point" ? "pt" : "bnd"}:${oid}`,
        layer: "historic",
        name: `NRHP ${refnum ?? "listing"}${resType ? ` · ${resType}` : ""}${x.nhl ? " · NHL" : ""}`,
        kind: resType ?? "property",
        source: "NPS National Register",
        details: {
          "property name (as NPS lists it)": str(p.RESNAME),
          "resource type": resType,
          "national historic landmark": x.nhl ? "yes (NPS flags it as an NHL)" : undefined,
          listed: x.listed,
          city: str(p.City),
          county: str(p.County),
          state: str(p.State),
          "nris refnum": refnum,
          "nomination (National Archives)": nara && /^https:\/\//.test(nara) ? nara : undefined,
          drawn: shape === "point" ? "NPS's point for the listing" : "NPS's boundary for the listing",
          "what this is": "a property listed on the National Register of Historic Places, as NPS's public spatial data shows it",
          "not shown": "archaeological sites whose locations are restricted under NHPA section 304 / ARPA; absence here is not absence on the ground",
        },
        extra: withEmbedText(
          x,
          recordText("nrhp-listed", { ResType: resType, Is_NHL: x.nhl ? "yes" : undefined, CertDate: x.listed, City: str(p.City), County: str(p.County), State: str(p.State) }),
        ),
      },
    });
  });
  return out;
}

// ---------------------------------------------------------------- USFWS critical habitat

/** What a critical habitat designation is and is not (route caveat, picture note, README). */
export const CRITHAB_CAVEAT =
  "USFWS designated critical habitat, final and proposed: regulatory designations under the Endangered Species Act, not species range or occurrence. Many listed species have no designation, and a polygon does not mean the species is present. FWS says these GIS files are not the legal boundary; the Federal Register rule and 50 CFR 17 are. Marine and anadromous species under NOAA Fisheries come from NOAA's own layers, listed with the agency named.";

/** FWS fills some text fields with this instead of a value; it is no value, never shown. */
export const FWS_PLACEHOLDER = "Please check current species specific shapefile";

export interface CritHabSpecies {
  common?: string;
  scientific?: string;
  /** Listing status as FWS publishes it: "Endangered", "Threatened", "Proposed Threatened"... */
  listing?: string;
  /** "Final" or "Proposed" (the designation, not the listing). */
  designation?: string;
  /** Federal Register citation of the rule, e.g. "78FR51328 51379". */
  fedreg?: string;
  /** Publication date of that rule, YYYY-MM-DD. */
  published?: string;
}

/** FWS's text with its placeholder (and blanks) read as no value. */
function fwsText(v: unknown): string | undefined {
  const s = str(v);
  if (!s || s.toLowerCase().startsWith(FWS_PLACEHOLDER.toLowerCase())) return undefined;
  return s;
}

/** "20130820" -> "2013-08-20"; anything else is no date. */
export function fwsDate(v: unknown): string | undefined {
  const s = fwsText(v);
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  if (Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Point-query rows from FWS's final (layer 0) or proposed (layer 2) critical habitat, one per species and rule. */
export function parseCritHab(rows: Array<{ properties: Record<string, unknown> | null }>): CritHabSpecies[] {
  const out: CritHabSpecies[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const p = r.properties ?? {};
    const sp: CritHabSpecies = {
      common: fwsText(p.comname),
      scientific: fwsText(p.sciname),
      listing: fwsText(p.listing_status),
      designation: fwsText(p.status),
      fedreg: fwsText(p.fedreg),
      published: fwsDate(p.pubdate),
    };
    // A species' habitat can come back as several units of the same rule: one line each rule.
    const key = [sp.scientific, sp.common, sp.designation, sp.fedreg].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sp);
  }
  return out;
}

/** One species' line in the ground dossier: proposed designations always say so. */
export function critHabText(s: CritHabSpecies): string {
  const name = [s.common, s.scientific ? `(${s.scientific})` : undefined].filter(Boolean).join(" ") || "species not named by FWS";
  const designation = s.designation?.toLowerCase() === "proposed" ? "PROPOSED critical habitat (not final)" : s.designation?.toLowerCase() === "final" ? "final critical habitat" : `critical habitat (${s.designation ?? "designation status not published"})`;
  const rule = [s.fedreg ? `${s.fedreg.replace(/^(\d+)FR(\d+)/, "$1 FR $2")}` : undefined, s.published ? `published ${s.published}` : undefined].filter(Boolean).join(", ");
  return `${name} · ${s.listing ?? "listing status not published"} · ${designation}${rule ? ` · ${rule}` : ""}`;
}

// ---------------------------------------------------------------- NOAA Fisheries critical habitat

/** What NOAA's layers are and are not (route caveat, picture note, README). */
export const NMFS_CAVEAT =
  "Marine and anadromous species come from NOAA Fisheries. NOAA's combined polygon layer is dated 2023-05-02 in its name but holds rules to July 2025; its line layer ends in 2017. The eCFR text is the legal boundary. A line row is one within about 200 m of the point, not one the point is on.";

export interface NmfsSpecies {
  agency: "NOAA Fisheries";
  /** "area" from the polygon layer (226), "line" from the line layer (2, within about 200 m). */
  shape: "area" | "line";
  common?: string;
  scientific?: string;
  listing?: string;
  /** "Final" or "Proposed". */
  designation?: string;
  unit?: string;
  /** The Federal Register citation NOAA links, split from its HTML anchor. */
  fr?: { text: string; url?: string };
  /** eCFR section, a link. */
  ecfr?: string;
  published?: string;
  effective?: string;
  habitat?: string;
}

/**
 * "8/17/2017" or "08/09/2023" -> "2017-08-17"; NOAA also has one "20240102" (yyyymmdd) among its
 * 30 publication dates (2026-10-13). Anything else is no date.
 */
export function nmfsDate(v: unknown): string | undefined {
  const s = str(v);
  const ymd = s?.match(/^(\d{4})(\d{2})(\d{2})$/);
  const m = ymd ? [s!, ymd[2], ymd[3], ymd[1]] : s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** NOAA's FR field: "<a href='URL' ...>71 FR 69054</a>" -> {text, url}; plain text stays text; a non-https link is dropped. */
export function nmfsFr(v: unknown): NmfsSpecies["fr"] {
  const s = str(v);
  if (!s) return undefined;
  const m = s.match(/^<a\s+href=['"]([^'"]+)['"][^>]*>([^<]*)<\/a>$/i);
  if (!m) return /</.test(s) ? undefined : { text: s };
  const text = m[2].trim();
  const url = /^https:\/\//.test(m[1]) ? m[1] : undefined;
  return text ? { text, url } : url ? { text: url, url } : undefined;
}

/** NOAA point (layer 226) or envelope (layer 2) rows, one per species, unit and rule. */
export function parseNmfs(rows: Array<{ properties: Record<string, unknown> | null }>, shape: NmfsSpecies["shape"]): NmfsSpecies[] {
  const out: NmfsSpecies[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const p = r.properties ?? {};
    const ecfr = str(p.ECFR);
    const sp: NmfsSpecies = {
      agency: "NOAA Fisheries",
      shape,
      common: str(p.COMNAME),
      scientific: str(p.SCIENAME),
      listing: str(p.LISTSTATUS),
      designation: str(p.CHSTATUS),
      unit: str(p.UNIT),
      fr: nmfsFr(p.FR),
      ecfr: ecfr && /^https:\/\/www\.ecfr\.gov\//.test(ecfr) ? ecfr : undefined,
      published: nmfsDate(p.PUBDATE),
      effective: nmfsDate(p.EFFECTDATE),
      habitat: str(p.HABTYPE),
    };
    const key = [sp.scientific, sp.common, sp.designation, sp.unit, sp.fr?.text].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sp);
  }
  return out;
}

/** One NOAA species' line in the ground dossier: proposed designations always say so; line rows say "within about 200 m". */
export function nmfsText(s: NmfsSpecies): string {
  const name = [s.common, s.scientific ? `(${s.scientific})` : undefined].filter(Boolean).join(" ") || "species not named by NOAA";
  const designation = s.designation?.toLowerCase() === "proposed" ? "PROPOSED critical habitat (not final)" : s.designation?.toLowerCase() === "final" ? "final critical habitat" : `critical habitat (${s.designation ?? "designation status not published"})`;
  const rule = [s.fr?.text, s.published ? `published ${s.published}` : undefined].filter(Boolean).join(", ");
  const where = s.shape === "line" ? "a river or stream unit within about 200 m" : s.unit ? `unit ${s.unit}` : undefined;
  return [`${name} · ${s.listing ?? "listing status not published"} · ${designation}`, where, rule || undefined, "NOAA Fisheries"].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- EPA OPP species ranges

/** What a species range is and is not (route caveat, dossier, catalogue). */
export const RANGES_CAVEAT =
  "A range is where a species could occur, as USFWS or NOAA delineate it; it is not presence. It includes proposed species. Range dates differ by species (2014-2026 at the points checked, 2026-10-13).";

export interface RangeSpecies {
  common?: string;
  scientific?: string;
  /** ESA listing status as published: Endangered, Threatened, Proposed Threatened, Experimental Population... */
  listing?: string;
  /** The listed entity, e.g. "Wherever found" or a distinct population segment. */
  entity?: string;
  /** FWS or NMFS. */
  agency?: string;
  group?: string;
  /** "Listed" or "Proposed for Listing". */
  category?: string;
  /** When the range shapefile was last updated, YYYY-MM-DD. */
  rangeUpdated?: string;
  /** The species' ECOS page. */
  ecos?: string;
}

/** Species_Ranges point rows (f=json attributes, distinct) -> one entry per species, entity and status. */
export function parseRanges(rows: Array<Record<string, unknown>>): RangeSpecies[] {
  const out: RangeSpecies[] = [];
  const seen = new Set<string>();
  for (const a of rows) {
    const epoch = typeof a.Range_Shapefile_Last_Updated === "number" && Number.isFinite(a.Range_Shapefile_Last_Updated) ? a.Range_Shapefile_Last_Updated : null;
    const id = str(a.ECOS_Listed_Species_ID);
    const sp: RangeSpecies = {
      common: str(a.Common_Name),
      scientific: str(a.Scientific_Name),
      listing: str(a.ESA_Listing_Status),
      entity: str(a.Entity_Description),
      agency: str(a.Lead_Agency),
      group: str(a.Taxonomic_Group),
      category: str(a.Status_Category),
      rangeUpdated: epoch != null ? new Date(epoch).toISOString().slice(0, 10) : undefined,
      ecos: id && /^\d{1,7}$/.test(id) ? `https://ecos.fws.gov/ecp/species/${id}` : undefined,
    };
    const key = [sp.scientific, sp.common, sp.entity, sp.listing].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sp);
  }
  return out.sort((x, y) => (x.common ?? x.scientific ?? "").localeCompare(y.common ?? y.scientific ?? ""));
}

/** The dossier's status groups: Endangered, Threatened, Proposed, then anything else as published. */
export function rangeGroup(s: RangeSpecies): string {
  const l = s.listing?.toLowerCase() ?? "";
  if (l.startsWith("proposed")) return "proposed";
  if (l === "endangered") return "endangered";
  if (l === "threatened") return "threatened";
  return s.listing ? s.listing.toLowerCase() : "status not published";
}

/** One species in a range group: "Bone Cave harvestman (Texella reyesi; arachnids; FWS; range 2018-01-24)". */
export function rangeText(s: RangeSpecies): string {
  const name = s.common ?? s.scientific ?? "species not named";
  const bits = [s.common && s.scientific ? s.scientific : undefined, s.entity && s.entity !== "Wherever found" ? s.entity : undefined, rangeGroup(s) === "proposed" ? s.listing : undefined, s.group?.toLowerCase(), s.agency, s.rangeUpdated ? `range ${s.rangeUpdated}` : undefined].filter(Boolean);
  return bits.length ? `${name} (${bits.join("; ")})` : name;
}

// ---------------------------------------------------------------- USGS PAD-US

export type Access = "open" | "restricted" | "closed" | "unknown";

/**
 * What the style and the layer note need. Every other attribute travels once,
 * as a dossier line, so a 2 degree box does not carry each string twice.
 */
export interface PublicLandExtra {
  category: string;
  access: Access;
  acres?: number;
}

/** The PAD-US categories the route asks for: every one that draws a unit on land. */
export const PADUS_CATEGORIES = ["Fee", "Easement", "Designation", "Proclamation"] as const;

/**
 * The outFields the route asks PAD-US for, ownership included: the owner and
 * manager agencies, the local owner and the easement holder as PAD-US
 * publishes them. Fields outside this list (source bookkeeping, comments) stay
 * at the source.
 */
export const PADUS_FIELDS = [
  "OBJECTID",
  "Category",
  "Own_Type",
  "Own_Name",
  "Loc_Own",
  "Mang_Type",
  "Mang_Name",
  "Des_Tp",
  "Unit_Nm",
  "Loc_Nm",
  "State_Nm",
  "GIS_Acres",
  "Pub_Access",
  "GAP_Sts",
  "IUCN_Cat",
  "Date_Est",
  "EsmtHldr",
  "EHoldTyp",
] as const;

const ACCESS: Record<string, Access> = { OA: "open", RA: "restricted", XA: "closed", UK: "unknown" };

/**
 * Drop the parts of a multipolygon that lie wholly outside `box` or are
 * smaller than `minDeg` across, keeping at least the largest part that
 * touches the box. ArcGIS returns a unit whole, not clipped: the California
 * Coastal National Monument is some 20,000 islets along the whole state and
 * alone was 2.2 MB of a 2 degree Bay Area answer.
 */
export function trimParts(g: Poly, box: [number, number, number, number], minDeg: number): { geometry: Poly; dropped: number } {
  if (g.type !== "MultiPolygon") return { geometry: g, dropped: 0 };
  const [bw, bs, be, bn] = box;
  let best: { part: number[][][]; size: number } | null = null;
  const kept: number[][][][] = [];
  for (const part of g.coordinates) {
    const ring = part[0];
    if (!ring?.length) continue;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
    if (e < bw || w > be || n < bs || s > bn) continue;
    const size = Math.max(e - w, n - s);
    if (!best || size > best.size) best = { part, size };
    if (size >= minDeg) kept.push(part);
  }
  if (!kept.length && best) kept.push(best.part);
  const dropped = g.coordinates.length - kept.length;
  return dropped ? { geometry: { type: "MultiPolygon", coordinates: kept }, dropped } : { geometry: g, dropped: 0 };
}

/** PAD-US owner types (Own_Type codes) whose unit name may be embedded in record text (B0): federal and state land only. */
export const PADUS_NAMED_OWNERS: ReadonlySet<string> = new Set(["FED", "STAT"]);

export function buildPublicLands(
  rows: Array<{ id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }>,
  domains: Map<string, Map<string, string>>,
  /** Box asked for and the generalisation used: parts outside it or smaller than it are left out (see trimParts). */
  trim?: { box: [number, number, number, number]; minDeg: number },
): LayerFeature[] {
  // Coded values decode through the layer's own domains; an unknown code stays as the code.
  const label = (field: string, v: unknown): string | undefined => {
    const s = str(v);
    if (!s) return undefined;
    return domains.get(field)?.get(s) ?? s;
  };
  // EHoldTyp carries no domain on this service; PAD-US codes it from the same agency-type
  // list as Own_Type, so that label is shown beside the published code, never instead of it.
  const holderType = (v: unknown): string | undefined => {
    const code = str(v);
    if (!code) return undefined;
    const name = domains.get("Own_Type")?.get(code);
    return name && name !== code ? `${code} (${name})` : code;
  };
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    if (!isPoly(r.geometry)) return;
    const p = r.properties;
    const category = str(p.Category) ?? "Unknown";
    const accessCode = str(p.Pub_Access);
    const x: PublicLandExtra = {
      category,
      access: (accessCode && ACCESS[accessCode]) || "unknown",
      acres: finite(p.GIS_Acres),
    };
    const unit = str(p.Unit_Nm);
    const localName = str(p.Loc_Nm);
    const designation = label("Des_Tp", p.Des_Tp);
    const oid = str(p.OBJECTID) ?? str(r.id) ?? `${category}:${i}`;
    const accessText =
      x.access === "unknown" ? "unknown (not reported to PAD-US)" : label("Pub_Access", accessCode)?.toLowerCase() ?? x.access;
    const easement = category === "Easement";
    // Privately owned units and easements are often named for a family
    // ("Smith Family Farm"), and the palette matches feature names and the
    // "local name" detail, so they are labelled by PAD-US id; the published
    // name stays in the dossier under a key the palette never searches.
    const isPrivate = str(p.Own_Type) === "PVT";
    const publishedName = unit ?? localName;
    const t = trim ? trimParts(r.geometry, trim.box, trim.minDeg) : { geometry: r.geometry, dropped: 0 };
    out.push({
      type: "Feature",
      geometry: t.geometry,
      properties: {
        id: `padus:${oid}`,
        layer: "publiclands",
        name: isPrivate ? `${designation ?? category} · PAD-US ${oid}` : unit ?? localName ?? designation ?? "protected area",
        kind: category.toLowerCase(),
        source: "USGS PAD-US 4.1",
        details: {
          category: label("Category", category),
          "public access": accessText,
          manager: label("Mang_Name", p.Mang_Name),
          "manager type": label("Mang_Type", p.Mang_Type),
          owner: label("Own_Name", p.Own_Name),
          "owner type": label("Own_Type", p.Own_Type),
          "local owner": str(p.Loc_Own),
          "easement holder": easement ? str(p.EsmtHldr) : undefined,
          "easement holder type": easement ? holderType(p.EHoldTyp) : undefined,
          designation,
          "published name": isPrivate ? publishedName : undefined,
          "local name": !isPrivate && localName !== unit ? localName : undefined,
          state: label("State_Nm", p.State_Nm),
          acres: x.acres != null ? x.acres.toLocaleString("en-US") : undefined,
          "GAP status": label("GAP_Sts", p.GAP_Sts),
          "IUCN category": label("IUCN_Cat", p.IUCN_Cat),
          established: str(p.Date_Est),
          outline: t.dropped
            ? `${t.dropped.toLocaleString("en-US")} of its ${(t.dropped + (t.geometry.type === "MultiPolygon" ? t.geometry.coordinates.length : 1)).toLocaleString("en-US")} parts not drawn at this zoom (outside the loaded box, or under ~${Math.max(1, Math.round((trim!.minDeg * 111_320) / 10) * 10)} m across)`
            : undefined,
          note:
            category === "Proclamation"
              ? "an approved or proclamation boundary: the land inside is not all public"
              : category === "Designation"
                ? "a designation drawn over land it does not by itself own or open"
                : easement
                  ? "an easement: the owner keeps the land and the holder has the rights the easement grants; public access as PAD-US codes it"
                  : undefined,
        },
        extra: withEmbedText(
          x,
          recordText("padus-units", {
            Category: label("Category", category),
            Own_Type: label("Own_Type", p.Own_Type),
            Mang_Type: label("Mang_Type", p.Mang_Type),
            Des_Tp: designation,
            State_Nm: label("State_Nm", p.State_Nm),
            Pub_Access: x.access === "unknown" ? undefined : label("Pub_Access", accessCode),
            GAP_Sts: label("GAP_Sts", p.GAP_Sts),
            IUCN_Cat: label("IUCN_Cat", p.IUCN_Cat),
          // B0: the unit's name only for federal and state land (a national forest, park or refuge). Local,
          // district, joint and NGO units are often acquisitions named for the former owner ("<Surname> Ranch").
          }, !easement && PADUS_NAMED_OWNERS.has(str(p.Own_Type) ?? "") ? unit : null),
        ),
      },
    });
  });
  return out;
}

// ---------------------------------------------------------------- USGS EPQS

export interface ElevationReading {
  lon: number;
  lat: number;
  /** Metres above the vertical datum of the 3DEP DEM; undefined where EPQS has no data. */
  metres?: number;
  /** Source DEM resolution in metres, as EPQS reports it. */
  resolutionM?: number;
  rasterId?: number;
  /** What EPQS said instead of a value (outside its coverage it answers 200 with plain text). */
  note?: string;
}

/** EPQS answers `value` as a string and uses -1000000 for "no data here". */
export function parseEpqs(lon: number, lat: number, j: { value?: string | number | null; resolution?: number | null; rasterId?: number | null }): ElevationReading {
  const v = finite(j.value, -999_999);
  return {
    lon,
    lat,
    metres: v,
    resolutionM: finite(j.resolution) ?? undefined,
    rasterId: finite(j.rasterId) ?? undefined,
  };
}
