// Upstream answers -> ConstructNode[]. One pure function per upstream, each
// taking the parsed JSON exactly as the service sent it, so the tests run on
// recorded answers and the route stays a thin fetcher.
//
// Rules the parsers keep (the app's rules): a field the upstream did not send
// stays out; sentinel values (-9999 base flood elevations, -1000000
// elevations) are dropped rather than shown; nothing is inferred beyond what
// the unit system defines.

import { countyByFips, metroByCbsa, stateByFips } from "@/lib/places/registry";
import { KINDS } from "./catalog";
import { roundRings } from "./geo";
import { epaRegion, fedDistrict, femaRegion, roman } from "./regions";
import type { ConstructEdge, ConstructKind, ConstructNode } from "./types";

/** ArcGIS MapServer identify answer. */
export interface IdentifyResponse {
  results?: Array<{
    layerId: number;
    layerName?: string;
    attributes?: Record<string, string | number | null>;
    geometry?: { rings?: number[][][] } | null;
  }>;
  error?: { code?: number; message?: string };
}

type Attrs = Record<string, string | number | null>;

/** Attribute names differ in case between services and even layers (HUC2 vs AREASQKM); read them case-blind. */
function lower(a: Attrs | undefined): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(a ?? {})) out[k.toLowerCase()] = v;
  return out;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : undefined;
}

function numOf(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/^\+/, ""));
  return Number.isFinite(n) ? n : undefined;
}

function node(kind: ConstructKind, code: string, name: string, source: ConstructNode["source"], extra: Partial<ConstructNode> = {}): ConstructNode {
  return { id: `${kind}:${code}`, kind, domain: KINDS[kind].domain, name, code, facts: {}, links: [], source, ...extra };
}

function ringsOf(g: { rings?: number[][][] } | null | undefined): number[][][] | undefined {
  if (!g?.rings?.length) return undefined;
  const r = roundRings(g.rings);
  return r.length ? r : undefined;
}

// ------------------------------------------------------------------ TIGERweb

/** tigerWMS_Current layer ids this module asks about, and the construct each one is. */
export const TIGER_LAYERS: Record<number, ConstructKind> = {
  2: "zcta",
  8: "tract",
  14: "school",
  16: "school",
  18: "school",
  28: "place",
  30: "cdp",
  32: "tribal",
  36: "tribal",
  38: "tribal",
  46: "tribal",
  54: "cd",
  56: "sldu",
  58: "sldl",
  60: "census-division",
  62: "census-region",
  80: "state",
  82: "county",
  88: "urban",
  91: "cbsa",
  93: "cbsa",
  97: "csa",
};

/** Layers small enough to outline at fine detail. */
export const TIGER_FINE = [2, 8, 14, 16, 18, 28, 30, 36, 38, 56, 58, 82, 88];
/** Large units: outlined at coarse detail. */
export const TIGER_COARSE = [32, 46, 54, 60, 62, 80, 91, 93, 97];

const SCHOOL_TYPE: Record<number, string> = { 14: "unified", 16: "secondary", 18: "elementary" };

export function parseTiger(res: IdentifyResponse): ConstructNode[] {
  const out: ConstructNode[] = [];
  for (const r of res.results ?? []) {
    const kind = TIGER_LAYERS[r.layerId];
    if (!kind) continue;
    const a = lower(r.attributes);
    const geoid = str(a.geoid);
    const rawName = str(a.name) ?? str(a.basename);
    if (!geoid || !rawName) continue;
    const land = numOf(a.arealand);
    const lat = numOf(a.intptlat);
    const lon = numOf(a.intptlon);
    const stateFips = /^\d{2}/.test(geoid) ? geoid.slice(0, 2) : undefined;
    const st = stateFips ? stateByFips(stateFips) : null;
    let name = rawName;
    const facts: ConstructNode["facts"] = {};
    const links: ConstructNode["links"] = [];
    if (kind === "cd") {
      const n = str(a.basename) ?? "";
      name = st ? `${st.usps}-${/^\d+$/.test(n) ? n.padStart(2, "0") : n}` : rawName;
      facts.district = rawName;
      if (/at large/i.test(n) || geoid.endsWith("00")) facts.note = "at-large district";
    } else if ((kind === "sldu" || kind === "sldl") && st) {
      name = `${st.name} ${rawName}`;
    } else if (kind === "state" && st) {
      links.push({ label: "State page", url: `/state/${st.usps}` });
    } else if (kind === "county" && st) {
      name = `${rawName}, ${st.usps}`;
      if (countyByFips(geoid)) links.push({ label: "County page", url: `/place/${geoid}` });
    } else if (kind === "cbsa") {
      facts.type = r.layerId === 93 ? "metropolitan" : "micropolitan";
      if (metroByCbsa(geoid)) links.push({ label: "Metro page", url: `/metro/${geoid}` });
    } else if (kind === "zcta") {
      name = str(a.basename) ?? geoid;
    } else if (kind === "school") {
      facts.type = SCHOOL_TYPE[r.layerId];
    }
    const funcstat = str(a.funcstat);
    if (funcstat === "A" && (kind === "place" || kind === "county")) facts.government = "active government";
    // The same kind can answer twice (unified + elementary school district,
    // reservation + trust land); the layer id keeps the node ids distinct.
    const code = kind === "school" || kind === "tribal" ? `${r.layerId}-${geoid}` : geoid;
    out.push(
      node(kind, code, name, "census-tigerweb", {
        code: geoid,
        areaKm2: land != null ? Math.round((land / 1e6) * 100) / 100 : undefined,
        areaBasis: land != null ? "land" : undefined,
        anchor: lat != null && lon != null ? [lon, lat] : undefined,
        rings: ringsOf(r.geometry),
        facts,
        links,
      }),
    );
  }
  return out;
}

// ------------------------------------------------------------- USGS WBD

const HUC_BY_LAYER: Record<number, ConstructKind> = { 1: "huc2", 2: "huc4", 3: "huc6", 4: "huc8", 5: "huc10", 6: "huc12" };

export function parseWbd(res: IdentifyResponse): { nodes: ConstructNode[]; edges: ConstructEdge[] } {
  const nodes: ConstructNode[] = [];
  const edges: ConstructEdge[] = [];
  for (const r of res.results ?? []) {
    const kind = HUC_BY_LAYER[r.layerId];
    if (!kind) continue;
    const a = lower(r.attributes);
    const huc = str(a[kind]);
    const name = str(a.name);
    if (!huc || !name) continue;
    const facts: ConstructNode["facts"] = {};
    const states = str(a.states);
    if (states) facts.states = states;
    const hutype = str(a.hutype);
    if (hutype && hutype !== "Standard") facts["unit type"] = hutype;
    const n = node(kind, huc, name, "usgs-wbd", {
      areaKm2: numOf(a.areasqkm),
      areaBasis: numOf(a.areasqkm) != null ? "total" : undefined,
      rings: ringsOf(r.geometry),
      facts,
    });
    nodes.push(n);
    const to = str(a.tohuc);
    if (kind === "huc12" && to && /^\d{12}$/.test(to)) {
      facts["drains to"] = to;
      edges.push({ from: n.id, to: `huc12:${to}`, relation: "drains-to", basis: "USGS WBD ToHUC", external: true });
    } else if (kind === "huc12" && to) {
      // OCEAN, CANADA, MEXICO, CLOSED BASIN: a terminal, not a unit.
      facts["drains to"] = to.toLowerCase();
    }
  }
  return { nodes, edges };
}

// ------------------------------------------------------------ EPA ecoregions

export function parseEcoregions(res: IdentifyResponse): ConstructNode[] {
  const out: ConstructNode[] = [];
  const seen = new Set<string>();
  for (const r of res.results ?? []) {
    const a = lower(r.attributes);
    const l4 = str(a.us_l4code);
    const l3 = str(a.us_l3code);
    const kind: ConstructKind = l4 ? "eco4" : "eco3";
    const code = l4 ?? l3;
    const name = l4 ? str(a.us_l4name) : str(a.us_l3name);
    if (!code || !name || seen.has(`${kind}:${code}`)) continue;
    seen.add(`${kind}:${code}`);
    const facts: ConstructNode["facts"] = {};
    if (l4 && str(a.us_l3name)) facts["level III"] = `${l3} ${str(a.us_l3name)}`;
    if (str(a.na_l2name)) facts["level II"] = `${str(a.na_l2code)} ${titleCase(str(a.na_l2name)!)}`;
    if (str(a.na_l1name)) facts["level I"] = `${str(a.na_l1code)} ${titleCase(str(a.na_l1name)!)}`;
    out.push(
      node(kind, code, name, "epa-ecoregions", {
        rings: ringsOf(r.geometry),
        facts,
        links: [{ label: "EPA ecoregions", url: "https://www.epa.gov/eco-research/ecoregions" }],
      }),
    );
  }
  return out;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// ------------------------------------------------------------- FEMA NFHL

export function parseNfhl(res: IdentifyResponse): ConstructNode[] {
  const out: ConstructNode[] = [];
  let panel: { id?: string; effective?: string } | null = null;
  for (const r of res.results ?? []) {
    if (r.layerId === 3) {
      const a = lower(r.attributes);
      panel = { id: str(a.firm_pan), effective: str(a.eff_date) };
    }
  }
  for (const r of res.results ?? []) {
    const a = lower(r.attributes);
    if (r.layerId === 28) {
      const zone = str(a.fld_zone);
      if (!zone) continue;
      const sub = str(a.zone_subty);
      const facts: ConstructNode["facts"] = {};
      const sfha = str(a.sfha_tf);
      if (sfha) facts["special flood hazard area"] = sfha === "T" ? "yes" : "no";
      if (sub) facts.subtype = sub.toLowerCase();
      const bfe = numOf(a.static_bfe);
      if (bfe != null && bfe > -9000) facts["base flood elevation"] = `${bfe} ${str(a.len_unit) ?? ""}`.trim();
      const depth = numOf(a.depth);
      if (depth != null && depth > -9000) facts["flood depth"] = `${depth} ${str(a.len_unit) ?? ""}`.trim();
      if (str(a.dfirm_id)) facts["FIRM database"] = str(a.dfirm_id)!;
      if (panel?.id) facts["FIRM panel"] = panel.id;
      if (panel?.effective) facts["panel effective"] = panel.effective;
      out.push(
        node("flood", `${str(a.dfirm_id) ?? "nfhl"}-${str(a.fld_ar_id) ?? zone}`, `Flood zone ${zone}`, "fema-nfhl", {
          code: zone,
          facts,
          links: [{ label: "FEMA Flood Map Service Center", url: "https://msc.fema.gov/portal/home" }],
        }),
      );
    } else if (r.layerId === 22) {
      const name = str(a.pol_name1);
      const cid = str(a.cid);
      if (!name || !cid) continue;
      out.push(node("flood-community", cid, titleCase(name), "fema-nfhl", { facts: { "NFIP community id": cid } }));
    }
  }
  return out;
}

// ------------------------------------------------------------- NWS

export interface NwsPoints {
  properties?: {
    cwa?: string;
    forecastZone?: string;
    county?: string;
    fireWeatherZone?: string;
    timeZone?: string;
    radarStation?: string;
    gridId?: string;
    gridX?: number;
    gridY?: number;
  };
}

export interface NwsNamed {
  properties?: { name?: string; id?: string; state?: string };
  /** /offices/{id} answers the name at the top level. */
  name?: string;
}

export function parseNws(points: NwsPoints, lon: number, lat: number, zone?: NwsNamed | null, office?: NwsNamed | null): { nodes: ConstructNode[]; edges: ConstructEdge[] } {
  const p = points.properties ?? {};
  const nodes: ConstructNode[] = [];
  const edges: ConstructEdge[] = [];
  const cwa = str(p.cwa);
  if (cwa) {
    const officeName = str(office?.name) ?? str(office?.properties?.name);
    const facts: ConstructNode["facts"] = {};
    if (str(p.radarStation)) facts.radar = p.radarStation!;
    if (p.gridId && p.gridX != null && p.gridY != null) facts["forecast grid"] = `${p.gridId} ${p.gridX},${p.gridY}`;
    nodes.push(
      node("nws-office", cwa, officeName ? `NWS ${officeName}` : `NWS office ${cwa}`, "nws-api", {
        facts,
        links: [
          { label: "Office", url: `https://www.weather.gov/${cwa.toLowerCase()}` },
          { label: "Forecast here", url: `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}` },
        ],
      }),
    );
  }
  const zoneId = str(p.forecastZone)?.split("/").pop();
  if (zoneId) {
    const zoneName = str(zone?.properties?.name);
    const facts: ConstructNode["facts"] = {};
    const fire = str(p.fireWeatherZone)?.split("/").pop();
    if (fire) facts["fire weather zone"] = fire;
    const county = str(p.county)?.split("/").pop();
    if (county) facts["county zone"] = county;
    const z = node("nws-zone", zoneId, zoneName ? `${zoneName} (${zoneId})` : `Forecast zone ${zoneId}`, "nws-api", { facts });
    nodes.push(z);
    if (cwa) edges.push({ from: z.id, to: `nws-office:${cwa}`, relation: "assigned-to", basis: "NWS points service" });
  }
  const tz = str(p.timeZone);
  if (tz) nodes.push(node("timezone", tz, tz.replace(/_/g, " "), "nws-api"));
  return { nodes, edges };
}

// ------------------------------------------------------------- USGS 3DEP

export function parseElevation(res: { value?: string | number | null } | null | undefined): number | undefined {
  const v = numOf(res?.value);
  // EPQS answers -1000000 where it has no data (open ocean, outside coverage).
  return v != null && v > -1000 ? Math.round(v * 10) / 10 : undefined;
}

// ------------------------------------------------------------- Federal regions

/** EPA region, FEMA region and Federal Reserve district for a state, from the bundled lists. */
export function federalNodes(stateFips: string): { nodes: ConstructNode[]; edges: ConstructEdge[] } {
  const st = stateByFips(stateFips);
  if (!st) return { nodes: [], edges: [] };
  const nodes: ConstructNode[] = [];
  const edges: ConstructEdge[] = [];
  const from = `state:${stateFips}`;
  const epa = epaRegion(st.usps);
  if (epa) {
    nodes.push(node("epa-region", String(epa.number), `EPA Region ${epa.number} (${epa.seat})`, "federal-regions"));
    edges.push({ from, to: `epa-region:${epa.number}`, relation: "assigned-to", basis: "EPA regional office list" });
  }
  const fema = femaRegion(st.usps);
  if (fema) {
    nodes.push(node("fema-region", String(fema.number), `FEMA Region ${roman(fema.number)} (${fema.seat})`, "federal-regions"));
    edges.push({ from, to: `fema-region:${fema.number}`, relation: "assigned-to", basis: "FEMA regional office list" });
  }
  const fed = fedDistrict(st.usps);
  if (fed) {
    const d = fed.districts;
    const code = d.map((x) => x.number).join("-");
    const name = fed.split
      ? `Fed district ${d[0].number} (${d[0].seat}) or ${d[1].number} (${d[1].seat})`
      : `Fed district ${d[0].number} (${d[0].seat})`;
    const facts: ConstructNode["facts"] = {};
    if (fed.split) facts.note = `${st.name} is split between two Reserve districts by county; this list does not say which side this county is on.`;
    nodes.push(node("fed-district", code, name, "federal-regions", { facts }));
    if (!fed.split) edges.push({ from, to: `fed-district:${code}`, relation: "assigned-to", basis: "Federal Reserve district list" });
  }
  return { nodes, edges };
}

// ------------------------------------------------------------- Countries

export interface CountryIn {
  properties: { name: string; nameLong?: string; iso3: string; lx?: number; ly?: number; pop?: number; popYear?: number; continent?: string };
  geometry: { type: string; coordinates: unknown };
}

export function countryNodes(country: CountryIn | null, rings: number[][][] | undefined): ConstructNode[] {
  if (!country) return [];
  const p = country.properties;
  const facts: ConstructNode["facts"] = {};
  if (p.pop != null) facts[`population${p.popYear ? ` (${p.popYear})` : ""}`] = p.pop;
  const out = [
    node("country", p.iso3, p.nameLong ?? p.name, "natural-earth", {
      anchor: p.lx != null && p.ly != null ? [p.lx, p.ly] : undefined,
      rings,
      facts,
    }),
  ];
  if (p.continent) out.push(node("continent", p.continent.toLowerCase().replace(/\s+/g, "-"), p.continent, "natural-earth"));
  return out;
}
