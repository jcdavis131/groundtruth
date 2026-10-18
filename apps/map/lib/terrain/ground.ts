"use client";
// "Ground here": a click on the ground while a terrain, soil or land cover
// picture is on asks each of those publishers what is under the click and
// opens one dossier with their answers as they land. Pictures have no
// features to pick, so the store holds the point, the dossier is fed from it,
// and a marker shows where it was asked.
//
//   soils       /api/soil?op=point           map unit, farmland class, NCCPI
//   firehazard  /api/terrain?op=point        WHP 2023 class
//   landslidesusc /api/hazards?op=history&part=landslide  the county's share of
//                                            susceptible terrain (USGS 2024); the class
//                                            under the click is not reported (no identify)
//   landcover   /api/terrain?op=point        NLCD 2021 class
//   slope       /api/terrain?op=point        3DEP slope, degrees
//   relief,     /api/land?op=elevation       3DEP ground elevation and the
//   contours                                 source DEM's resolution
//   geology     /api/infra?op=geology        Macrostrat map unit, age, lithology
//                                            and the map it comes from
//   crithab     /api/land?op=crithab         USFWS critical habitat (final and
//                                            proposed) containing the point
//   wayback     /api/terrain?op=waybackdate  when the drawn Wayback release's pixels
//                                            were captured there (Esri's metadata)
//   hydro       /api/water?op=reach          the NHDPlus V2 reach the point drains to (USGS
//                                            NLDI + EPA V2.1); the dossier offers its traces
//   naip        /api/terrain?op=naip         NAIP flight dates at the point: the drawn
//                                            year's photograph first, then the other years
//   topo        /api/terrain?op=topo         USGS historical topographic sheets at the
//                                            point: the drawn edition first, with
//                                            citation, GeoPDF and GeoTIFF
//
// Only the layers that are on are asked, and only below GROUND_MAX_HEIGHT_M,
// so a click from orbit still just deselects.

import { create } from "zustand";
import type * as CesiumNS from "cesium";
import { useGlobe } from "@/lib/store/globe";
import { getCesium } from "@/lib/globe/cesium";
import type { LayerFeature, LayerId } from "@/lib/layers/types";
import { GROUND_LAYERS } from "@/lib/layers/terrain";
import type { ClassAnswer } from "./classes";
import { nccpiText, type SoilAnswer } from "./soil";
import { ageRange, type GeologyAnswer } from "@/lib/infra/geology";
import { critHabText, nmfsText, rangeGroup, rangeText, type CritHabSpecies, type NmfsSpecies, type RangeSpecies } from "@/lib/land/features";
import { useSettings } from "@/lib/store/settings";
import { resolveTopoYear, sheetText, type TopoSheet, type TopoYear } from "./topo";
import { captureText, parseReleaseId, zoomForHeight, type WaybackCapture } from "./wayback";
import { reachDetails, type Reach } from "@/lib/water/nldi";
import { naipItemText, resolveNaipYear, type NaipYear } from "./naip";
import type { LandslideLine, MissingReason } from "@/lib/hazards/history";

/** Above this camera height a ground click is not a question about the ground. */
export const GROUND_MAX_HEIGHT_M = 150_000;

export type GroundPart = "soils" | "firehazard" | "landslidesusc" | "landcover" | "slope" | "elevation" | "geology" | "crithab" | "topo" | "wayback" | "hydro" | "naip";

export interface PartState {
  loading: boolean;
  error?: string;
  data?: unknown;
}

export interface GroundPick {
  lon: number;
  lat: number;
  seq: number;
  layer: LayerId;
  parts: Partial<Record<GroundPart, PartState>>;
}

interface PickState {
  pick: GroundPick | null;
  set: (pick: GroundPick | null) => void;
}

export const useGroundPick = create<PickState>()((set) => ({
  pick: null,
  set: (pick) => set({ pick }),
}));

const PART_OF: Partial<Record<LayerId, GroundPart>> = {
  soils: "soils",
  firehazard: "firehazard",
  landslidesusc: "landslidesusc",
  landcover: "landcover",
  slope: "slope",
  contours: "elevation",
  relief: "elevation",
  geology: "geology",
  crithab: "crithab",
  topo: "topo",
  wayback: "wayback",
  hydro: "hydro",
  naip: "naip",
};

/** The parts to ask for, given which layers are on (each once, in a fixed order). */
export function partsFor(on: Partial<Record<LayerId, boolean>>): GroundPart[] {
  const out: GroundPart[] = [];
  for (const l of GROUND_LAYERS) {
    const p = PART_OF[l];
    if (on[l] && p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Whether a click on empty ground should ask the ground (a ground layer on, the camera low enough). */
export function groundClickWanted(on: Partial<Record<LayerId, boolean>>, height: number): boolean {
  return height <= GROUND_MAX_HEIGHT_M && partsFor(on).length > 0;
}

export function groundId(lon: number, lat: number): string {
  return `ground:${lat.toFixed(5)},${lon.toFixed(5)}`;
}

const SOURCE_OF: Record<GroundPart, string> = {
  soils: "NRCS SSURGO",
  firehazard: "USFS WHP 2023",
  landslidesusc: "USGS landslide susceptibility 2024",
  landcover: "MRLC NLCD 2021",
  slope: "USGS 3DEP",
  elevation: "USGS 3DEP EPQS",
  geology: "Macrostrat",
  crithab: "USFWS and NOAA Fisheries critical habitat",
  topo: "USGS historical topo maps",
  wayback: "Esri Wayback metadata",
  hydro: "USGS NLDI + EPA NHDPlus V2.1",
  naip: "USDA NAIP via Planetary Computer",
};

type Details = NonNullable<LayerFeature["properties"]["details"]>;

function waiting(d: Details, key: string, s: PartState | undefined, who: string): boolean {
  if (!s) return true;
  if (s.loading) {
    d[key] = `asking ${who}…`;
    return true;
  }
  if (s.error) {
    d[key] = `${who} did not answer: ${s.error.slice(0, 80)}`;
    return true;
  }
  return false;
}

/** The dossier details for a pick, in reading order; pure, tested. */
export function groundDetails(p: Pick<GroundPick, "lon" | "lat" | "parts">): Details {
  const d: Details = {};
  const soil = p.parts.soils;
  if (soil && !waiting(d, "soil map unit", soil, "NRCS Soil Data Access")) {
    const a = soil.data as SoilAnswer | null;
    if (!a) d["soil map unit"] = "none mapped here (water, or outside the survey)";
    else {
      const mu = a.mapUnit;
      d["soil map unit"] = `${mu.name ?? "unnamed"}${mu.symbol ? ` (${mu.symbol})` : ""}`;
      d["farmland class (NRCS)"] = mu.farmlandClass ?? "not published";
      if (a.dominant) {
        d["main soil"] = `${a.dominant.name ?? "unnamed"}${a.dominant.percent != null ? `, ${a.dominant.percent} % of the map unit` : ""}`;
      }
      d["NCCPI (main soil, 0 to 1)"] = nccpiText(a.dominant);
      if (mu.areaName || mu.areaSymbol) d["soil survey"] = `${mu.areaName ?? mu.areaSymbol}${mu.surveySaved ? `, saved ${mu.surveySaved}` : ""}`;
      d["map unit key"] = mu.mukey;
    }
  }
  const whp = p.parts.firehazard;
  if (whp && !waiting(d, "wildfire hazard potential", whp, "USFS")) {
    const c = whp.data as ClassAnswer | null;
    d["wildfire hazard potential"] = c ? `${c.label} (class ${c.code} of WHP 2023)` : "no class here (WHP covers the conterminous US)";
  }
  const ls = p.parts.landslidesusc;
  if (ls && !waiting(d, "landslide susceptibility", ls, "USGS (county table)")) Object.assign(d, landslideGroundLines(ls.data as LandslideGroundAnswer | null));
  const lc = p.parts.landcover;
  if (lc && !waiting(d, "land cover", lc, "MRLC")) {
    const c = lc.data as ClassAnswer | null;
    d["land cover"] = c ? `${c.label} (NLCD 2021 class ${c.code})` : "no class here (NLCD 2021 covers the conterminous US)";
  }
  const sl = p.parts.slope;
  if (sl && !waiting(d, "slope", sl, "USGS 3DEP")) {
    const deg = sl.data as number | null;
    d.slope = deg == null ? "no 3DEP value here" : `${deg}° (3DEP "Slope Degrees", whole degrees)`;
  }
  const el = p.parts.elevation;
  if (el && !waiting(d, "ground elevation", el, "USGS 3DEP EPQS")) {
    const e = el.data as { metres?: number; resolutionM?: number } | null;
    d["ground elevation"] =
      e?.metres != null
        ? `${e.metres.toFixed(1)} m · ${(e.metres / 0.3048).toFixed(0)} ft${e.resolutionM != null ? `, source DEM ${e.resolutionM} m` : ""}`
        : "no 3DEP value here (it covers the United States)";
  }
  const geo = p.parts.geology;
  if (geo && !waiting(d, "geology", geo, "Macrostrat")) {
    const g = geo.data as GeologyAnswer | null;
    const u = g?.units[0];
    if (!u) d.geology = "no mapped unit here in Macrostrat's compilation";
    else {
      d["geologic unit"] = u.name ?? "not named on this map";
      if (u.age) d["geologic age"] = `${u.age}${ageRange(u) ? ` (${ageRange(u)})` : ""}`;
      if (u.lith) d.lithology = u.lith;
      if (u.stratName) d["stratigraphic names"] = u.stratName;
      if (u.description) d["unit description"] = u.description.length > 220 ? `${u.description.slice(0, 219).trimEnd()}…` : u.description;
      if (u.source) d["geologic map"] = u.source;
      const coarser = g!.units.slice(1).map((x) => x.name).filter(Boolean);
      if (coarser.length) d["on coarser maps"] = coarser.join("; ");
    }
  }
  const ch = p.parts.crithab;
  if (ch && !waiting(d, "critical habitat", ch, "USFWS")) {
    const a = ch.data as { final: CritHabSpecies[] | null; proposed: CritHabSpecies[] | null; noaa?: NmfsSpecies[] | null; ranges?: RangeSpecies[] | null } | null;
    const all = [...(a?.final ?? []).map(critHabText), ...(a?.proposed ?? []).map(critHabText), ...(a?.noaa ?? []).map(nmfsText)];
    const noaaAsked = a != null && "noaa" in a;
    if (all.length) all.forEach((t, i) => (d[all.length > 1 ? `critical habitat ${i + 1}` : "critical habitat"] = t));
    else if (a?.final && a?.proposed && (!noaaAsked || a.noaa)) d["critical habitat"] = "no designated critical habitat at this point (most listed species have no designation; this says nothing about whether a species is here)";
    if (a && !a.final) d["critical habitat (final)"] = "FWS's final layer did not answer: unknown, not absent";
    if (a && !a.proposed) d["critical habitat (proposed)"] = "FWS's proposed layer did not answer: unknown, not absent";
    if (noaaAsked && !a?.noaa) d["critical habitat (NOAA Fisheries)"] = "NOAA Fisheries did not answer: marine and anadromous designations unknown, not absent";
    d["critical habitat note"] = "a regulatory designation, not range or occurrence; the GIS files are not the legal boundary (for FWS the Federal Register rule and 50 CFR 17 are, for NOAA the eCFR text)";
    if (a && "ranges" in a) {
      const r = a.ranges;
      if (!r) d["listed species ranges here"] = "EPA's species range layer did not answer: unknown, not none";
      else if (!r.length) d["listed species ranges here"] = "no listed or proposed species' range covers this point in EPA's range layer";
      else {
        d["listed species ranges here"] = `${r.length} listed or proposed species whose range covers this point (USFWS and NOAA ranges, via EPA): a range is where a species could occur, not where it is`;
        const order = ["endangered", "threatened", "proposed"];
        const groups = new Map<string, RangeSpecies[]>();
        for (const s of r) {
          const g = rangeGroup(s);
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g)!.push(s);
        }
        const keys = [...groups.keys()].sort((x, y) => (order.indexOf(x) < 0 ? 9 : order.indexOf(x)) - (order.indexOf(y) < 0 ? 9 : order.indexOf(y)) || x.localeCompare(y));
        for (const g of keys) d[`range: ${g} (${groups.get(g)!.length})`] = groups.get(g)!.map(rangeText).join("; ");
      }
    }
  }
  const tp = p.parts.topo;
  if (tp && !waiting(d, "topographic maps", tp, "USGS (HTMC)")) {
    const a = tp.data as TopoAnswer | null;
    if (!a?.sheets.length) d["topographic maps"] = "no USGS topographic sheet here in the collection (1879-2006)";
    else {
      const year = a.year ?? a.years[a.years.length - 1]?.year;
      const drawn = a.sheets.filter((s) => s.year === year);
      d["topographic maps"] = `${a.sheets.length} sheets in ${a.years.length} editions here, ${a.years[0].year} to ${a.years[a.years.length - 1].year}`;
      if (!drawn.length) d[`topo ${year}`] = `no ${year} sheet at this point`;
      drawn.forEach((s, i) => {
        const k = drawn.length > 1 ? `topo ${year} sheet ${i + 1}` : `topo ${year} sheet`;
        d[k] = sheetText(s);
        if (s.citation) d[`${k} citation (USGS)`] = s.citation;
        if (s.geopdf) d[`${k} GeoPDF`] = s.geopdf;
        if (s.geotiff) d[`${k} GeoTIFF`] = s.geotiff;
      });
      const others = a.years.filter((y) => y.year !== year).map((y) => y.year);
      if (others.length) d["other topo editions here"] = others.join(", ");
      d["topo note"] = "sheets found at the point rounded to 0.01° (about 1 km), so near a sheet edge a neighbour can be listed; the edition year is when USGS revised the map, not a survey date, and parts of a sheet can be decades older";
    }
  }
  const wb = p.parts.wayback;
  if (wb && !waiting(d, "imagery captured", wb, "Esri (Wayback metadata)")) {
    const a = wb.data as WaybackDateAnswer | null;
    if (!a) d["imagery captured"] = "Esri lists no capture date here";
    else {
      d["imagery captured"] = `Release ${a.release.date} · ${captureText(a.captures)}`;
      const named = [...new Set(a.captures.map((c) => c.name).filter((n): n is string => !!n))];
      if (named.length) d["imagery collection (Esri)"] = named.join("; ");
      d["imagery note"] = `Esri's metadata for this release at about zoom level ${a.z}; a capture date is when the pixels were taken, a release date when Esri published them${a.fallback ? "; the release in the link is not in Esri's index, so these are the newest release's dates, as drawn" : ""}`;
    }
  }
  const na = p.parts.naip;
  if (na && !waiting(d, "aerial photograph", na, "Planetary Computer")) {
    const a = na.data as NaipAnswer | null;
    if (!a?.years.length) d["aerial photograph (NAIP)"] = "no NAIP photograph here (NAIP covers the conterminous United States)";
    else {
      const drawn = a.years.find((y) => y.year === a.year);
      d["aerial photograph (NAIP)"] = drawn ? `${drawn.year}: ${naipItemText(drawn)}` : `no ${a.year} photograph at this point`;
      const others = a.years.filter((y) => y.year !== a.year).map((y) => y.year);
      if (others.length) d["other NAIP years here"] = others.join(", ");
      d["NAIP note"] = "the flight date of the quarter-quad under the click, as Planetary Computer's STAC lists it; a year's mosaic joins flights from different days";
    }
  }
  const hy = p.parts.hydro;
  if (hy && !waiting(d, "drains to", hy, "USGS NLDI")) {
    const a = hy.data as ReachAnswer | null;
    Object.assign(d, reachDetails(a?.reach ?? null, a?.comid ?? null));
  }
  d.point = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  return d;
}

/** What /api/hazards?op=history&part=landslide answers for the county under a click. */
export interface LandslideGroundAnswer {
  fips: string;
  name: string;
  state: string;
  landslide: LandslideLine | null;
  missing: Array<{ source: string; reason: MissingReason; detail?: string }>;
}

/** The county's landslide lines for the ground dossier; the class under the click is never reported. */
export function landslideGroundLines(a: LandslideGroundAnswer | null): Details {
  const d: Details = {};
  if (!a) {
    d["landslide susceptibility"] = "no county here";
    return d;
  }
  const where = `${a.name}, ${a.state}`;
  const l = a.landslide;
  if (!l) {
    const r = a.missing[0]?.reason;
    d["landslide susceptibility"] =
      r === "join:legacy_ct_counties"
        ? `not published for ${where}: USGS's county table uses Connecticut's old counties`
        : r === "join:boundary_changed_since_2010"
          ? `not published for ${where}: USGS's county table is on 2010 counties and this one's boundary changed since`
          : `not in USGS's county table for ${where}`;
  } else {
    d["landslide susceptibility"] =
      l.prop_susc == null
        ? `${where}: share not published`
        : `${(l.prop_susc * 100).toFixed(1)} % of ${where} is susceptible terrain (USGS 2024${l.susc_area != null && l.county_area != null ? `, ${Math.round(l.susc_area).toLocaleString("en-US")} of ${Math.round(l.county_area).toLocaleString("en-US")} km2 of land` : ""})`;
    if (l.v2_ls_count != null) d["mapped landslides (USGS inventory v2)"] = `${l.v2_ls_count.toLocaleString("en-US")} in the county's susceptible terrain (mapping effort varies by state; version 2 of USGS's inventory, not the Landslides layer's version 3)`;
  }
  d["landslide note"] = "a county share from USGS's table; the class drawn under the click is not reported (the tile service has no identify)";
  return d;
}

/** The dossier feature for a pick. */
export function groundFeature(p: GroundPick): LayerFeature {
  const asked = (Object.keys(p.parts) as GroundPart[]).map((k) => SOURCE_OF[k]);
  const soil = p.parts.soils?.data as SoilAnswer | null | undefined;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    properties: {
      id: groundId(p.lon, p.lat),
      layer: p.layer,
      name: soil?.mapUnit.name ? `Ground here · ${soil.mapUnit.name}` : "Ground here",
      kind: "ground",
      source: [...new Set(asked)].join(" · "),
      details: groundDetails(p),
      anchor: [p.lon, p.lat],
    },
  };
}

let seq = 0;

function show(p: GroundPick) {
  useGroundPick.getState().set(p);
  const f = groundFeature(p);
  useGlobe.getState().select({ layer: p.layer, id: f.properties.id }, f);
}

function current(n: number): GroundPick | null {
  const p = useGroundPick.getState().pick;
  if (!p || p.seq !== n) return null;
  const sel = useGlobe.getState().selected;
  return sel && sel.id === groundId(p.lon, p.lat) ? p : null;
}

async function getJson(url: string): Promise<{ data?: unknown; error?: string }> {
  const res = await fetch(url);
  const j = (await res.json().catch(() => ({}))) as { data?: unknown; error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

/** What the Wayback capture answer holds (the route's data). */
export interface WaybackDateAnswer {
  release: { release: number; date: string };
  z: number;
  captures: WaybackCapture[];
  /** The pref's release is not in Esri's index, so these are the newest release's dates (as the layer draws). */
  fallback?: boolean;
}

/** What /api/water?op=reach answers: the comid NLDI found at the point (null: none) and EPA's attributes (null: not published or not answered). */
export interface ReachAnswer {
  comid: number | null;
  reach: Reach | null;
}

/** What a NAIP answer holds in the pick: the years at the point and the year drawn. */
export interface NaipAnswer {
  years: NaipYear[];
  year: number | null;
}

/** What a topo answer holds in the pick: the sheets and years at the point, and the edition drawn. */
export interface TopoAnswer {
  sheets: TopoSheet[];
  years: TopoYear[];
  year: number | null;
}

const ASK: Record<GroundPart, (lon: string, lat: string) => Promise<unknown>> = {
  soils: async (lon, lat) => (await getJson(`/api/soil?op=point&lon=${lon}&lat=${lat}`)).data ?? null,
  firehazard: async (lon, lat) => ((await getJson(`/api/terrain?op=point&product=firehazard&lon=${lon}&lat=${lat}`)).data as { class?: unknown })?.class ?? null,
  landslidesusc: async (lon, lat) => (await getJson(`/api/hazards?op=history&lon=${lon}&lat=${lat}&part=landslide`)).data ?? null,
  landcover: async (lon, lat) => ((await getJson(`/api/terrain?op=point&product=landcover&lon=${lon}&lat=${lat}`)).data as { class?: unknown })?.class ?? null,
  slope: async (lon, lat) => ((await getJson(`/api/terrain?op=point&product=slope&lon=${lon}&lat=${lat}`)).data as { degrees?: unknown })?.degrees ?? null,
  elevation: async (lon, lat) => (await getJson(`/api/land?op=elevation&lon=${lon}&lat=${lat}`)).data ?? null,
  geology: async (lon, lat) => (await getJson(`/api/infra?op=geology&lon=${lon}&lat=${lat}`)).data ?? null,
  crithab: async (lon, lat) => (await getJson(`/api/land?op=crithab&lon=${lon}&lat=${lat}`)).data ?? null,
  wayback: async (lon, lat) => {
    const release = parseReleaseId(useSettings.getState().prefs.waybackRelease);
    const z = zoomForHeight(useGlobe.getState().view.height, Number(lat));
    const base = `/api/terrain?op=waybackdate&lon=${lon}&lat=${lat}&z=${z}`;
    if (release == null) return (await getJson(base)).data ?? null;
    try {
      return (await getJson(`${base}&release=${release}`)).data ?? null;
    } catch (err) {
      // The layer draws the newest release when the pref's is not in Esri's index; the dates follow it.
      if (!(err instanceof Error) || !/not in Esri's index/.test(err.message)) throw err;
      const d = (await getJson(base)).data as WaybackDateAnswer | undefined;
      return d ? { ...d, fallback: true } : null;
    }
  },
  naip: async (lon, lat) => {
    const d = (await getJson(`/api/terrain?op=naip&lon=${lon}&lat=${lat}`)).data as { years?: NaipYear[] } | undefined;
    const years = d?.years ?? [];
    return { years, year: resolveNaipYear(years, useSettings.getState().prefs.naipYear).year } satisfies NaipAnswer;
  },
  hydro: async (lon, lat) => {
    const d = (await getJson(`/api/water?op=reach&lon=${lon}&lat=${lat}`)).data as Partial<ReachAnswer> | undefined;
    return { comid: d?.comid ?? null, reach: d?.reach ?? null } satisfies ReachAnswer;
  },
  topo: async (lon, lat) => {
    const d = (await getJson(`/api/terrain?op=topo&lon=${lon}&lat=${lat}`)).data as { sheets?: TopoSheet[]; years?: TopoYear[] } | undefined;
    const years = d?.years ?? [];
    const answer: TopoAnswer = { sheets: d?.sheets ?? [], years, year: resolveTopoYear(years, useSettings.getState().prefs.topoYear).year };
    return answer;
  },
};

/** Ask every ground layer that is on what is under this point, and open the dossier. */
export async function identifyGround(lon: number, lat: number, on: Partial<Record<LayerId, boolean>> = useGlobe.getState().layers): Promise<void> {
  const parts = partsFor(on);
  const layer = GROUND_LAYERS.find((l) => on[l]);
  if (!parts.length || !layer) return;
  const n = ++seq;
  const x = lon.toFixed(5);
  const y = lat.toFixed(5);
  const start: GroundPick = { lon: Number(x), lat: Number(y), seq: n, layer, parts: Object.fromEntries(parts.map((k) => [k, { loading: true }])) };
  show(start);
  await Promise.all(
    parts.map(async (k) => {
      let state: PartState;
      try {
        state = { loading: false, data: await ASK[k](x, y) };
      } catch (err) {
        state = { loading: false, error: err instanceof Error ? err.message : String(err) };
      }
      const p = current(n);
      if (p) show({ ...p, parts: { ...p.parts, [k]: state } });
    }),
  );
}

/** Whether a selection is a ground answer (it travels in links as its point, not as sel=). */
export function isGroundSelection(sel: { id: string } | null | undefined): boolean {
  return !!sel && sel.id.startsWith("ground:");
}

/** Draws a marker where the open ground dossier was asked; returns a disposer. */
export function startGroundOverlay(viewer: CesiumNS.Viewer): () => void {
  const C = getCesium();
  const scene = viewer.scene;
  const points = scene.primitives.add(new C.PointPrimitiveCollection());
  const draw = () => {
    if (viewer.isDestroyed()) return;
    points.removeAll();
    const p = useGroundPick.getState().pick;
    const sel = useGlobe.getState().selected;
    if (!p || !sel || sel.id !== groundId(p.lon, p.lat)) return;
    points.add({
      position: C.Cartesian3.fromDegrees(p.lon, p.lat, 0),
      pixelSize: 10,
      color: C.Color.fromCssColorString("#F3E3A6"),
      outlineColor: C.Color.BLACK.withAlpha(0.85),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  };
  draw();
  const unsubPick = useGroundPick.subscribe(draw);
  const unsubSel = useGlobe.subscribe((s, prev) => {
    if (s.selected !== prev.selected) draw();
  });
  return () => {
    unsubPick();
    unsubSel();
    if (!viewer.isDestroyed() && scene.primitives.contains(points)) scene.primitives.remove(points);
  };
}
