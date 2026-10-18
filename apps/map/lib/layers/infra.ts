// Layers: infrastructure and geohazards. Each is a box around the camera
// target asked of /api/infra (lib/infra/features.ts builds the features),
// drawn below a camera height where the box still covers the view, with the
// box itself drawn as a dashed outline: outside it nothing was loaded, which
// is not the same as nothing being there.
//
//   transmission  HIFLD transmission lines (the archived 2024-09-30 snapshot)
//   pipelines     EIA natural gas, crude oil, petroleum product and HGL pipelines
//   rail          FRA/BTS North American Rail Network
//   airports      FAA public-use airports, heliports and seaplane bases
//   dams          USACE National Inventory of Dams
//   hospitals     HIFLD hospitals (FEMA RAPT's copy): every one nationally from
//                 orbit with a short record, the full record below 300 km
//   plants        EIA-860M power plants (bundled monthly snapshot) and Wikidata
//                 nuclear plants outside the US
//   faults        USGS Quaternary faults
//   landslides    USGS landslide inventory points
//   plss          BLM PLSS townships, and sections up close
//
// The geology picture (Macrostrat) is a terrain picture: lib/layers/terrain.ts.
//
// Owners and operators are shown as each registry publishes them, in the
// dossier only; the ⌘K palette never searches them (lib/search/allowlist.ts).

import type { FeatureCollection } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, LayerId, LoadedBoxExtra, ViewState } from "./types";
import { proxy } from "./aircraft";
import { FeatureMemo } from "./featureMemo";
import { buildHospitals, unpackNational, type PackedRow } from "@/lib/infra/hospitals";

export interface BoxTier {
  /** Used at or below this camera height (metres). */
  maxHeight: number;
  /** Radius of the box asked for (metres); the route clamps and snaps it. */
  radiusM: number;
  /** Extra query parameters for this tier (a size floor, a level). */
  params?: string;
  /** A world box instead of one around the target. */
  world?: boolean;
}

interface BoxLayerOptions {
  id: LayerId;
  label: string;
  description: string;
  color: string;
  attribution: string;
  source: string;
  op: string;
  /** Ascending by maxHeight. */
  tiers: BoxTier[];
  updateIntervalMs: number;
  /** One line about what was drawn (counts by class), shown as the layer note. */
  summarize: (features: LayerFeature[], env: Record<string, unknown>, tier: BoxTier) => string;
  /** What to say above the last tier. */
  above?: string;
  estimate?: string;
  /** Draw the loaded box (not for world-box tiers). */
  loadedBox?: boolean;
  /** Query parameters from the layer's options (a status toggle); refetched when they change (LayerHost OPTION_KEYS). */
  optionParams?: (options: Record<string, unknown>) => string | null;
  /** The answer's features, when the route sends something other than a FeatureCollection for a tier (packed rows). */
  decode?: (data: unknown) => LayerFeature[];
}

function km(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString("en-US")} km` : `${m} m`;
}

export function tierFor(tiers: BoxTier[], height: number): BoxTier | null {
  return tiers.find((t) => height <= t.maxHeight) ?? null;
}

/** Grid (degrees) a tier's box centre snaps to: a quarter of the box, so the target stays well inside it. */
export function tierGrid(t: BoxTier): number {
  const deg = t.radiusM / 111_000;
  return Math.max(0.01, Number((deg / 2).toPrecision(2)));
}

export function boxViewKey(tiers: BoxTier[]) {
  return (v: ViewState) => {
    const t = tierFor(tiers, v.height);
    if (!t) return "above";
    const i = tiers.indexOf(t);
    if (t.world) return `t${i}`;
    const g = tierGrid(t);
    return `t${i}:${Math.round(v.lon / g)},${Math.round(v.lat / g)}`;
  };
}

/**
 * The box a layer loaded, as a dashed outline feature (kind "loaded-box"; never counted or
 * searched). Its extra says what the answer left out (a record limit, coarsened outlines, a
 * size floor), so the area report can say a length or a count is partial.
 */
export function loadedBox(layer: LayerId, b: [number, number, number, number], what: string, extra: LoadedBoxExtra = {}): LayerFeature {
  const [w, s, e, n] = b;
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
    properties: {
      id: `${layer}:loaded-box`,
      layer,
      name: "Loaded area",
      kind: "loaded-box",
      source: "this app",
      details: {
        "what this is": `the box ${what} were loaded for. Outside it nothing is loaded, which is not the same as none being there`,
        box: `${w}, ${s} to ${e}, ${n}`,
      },
      extra,
    },
  };
}

export function isLoadedBox(f: LayerFeature): boolean {
  return f.properties.kind === "loaded-box";
}

function boxLayer(o: BoxLayerOptions): LayerDefinition {
  const memo = new FeatureMemo();
  const top = o.tiers[o.tiers.length - 1];
  return {
    id: o.id,
    label: o.label,
    description: o.description,
    color: o.color,
    updateIntervalMs: o.updateIntervalMs,
    defaultEnabled: false,
    viewDependent: true,
    viewKey: boxViewKey(o.tiers),
    estimate: o.estimate,
    attribution: o.attribution,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const t = tierFor(o.tiers, ctx.view.height);
      if (!t) {
        return {
          collection: { type: "FeatureCollection", features: [] },
          source: o.source,
          fetchedAt: ctx.now,
          note: o.above ?? `descend below ${km(top.maxHeight)} for ${o.label.toLowerCase()}`,
          meta: { count: 0 },
        };
      }
      let bbox: [number, number, number, number];
      if (t.world) bbox = [-180, -90, 180, 90];
      else {
        // Centred on the view key's cell, so every viewer in that cell asks the same box.
        const g = tierGrid(t);
        bbox = bboxAround(Math.round(ctx.view.lat / g) * g, Math.round(ctx.view.lon / g) * g, t.radiusM);
      }
      const extra = o.optionParams?.(ctx.options);
      const env = await proxy<FeatureCollection>(`/api/infra?op=${o.op}&bbox=${bbox.map((x) => x.toFixed(3)).join(",")}${t.params ? `&${t.params}` : ""}${extra ? `&${extra}` : ""}`, ctx);
      const meta = env as unknown as Record<string, unknown>;
      const features = memo.stable(o.decode ? o.decode(env.data) : (env.data.features as unknown as LayerFeature[]));
      const loaded = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? (meta.bbox as [number, number, number, number]) : bbox;
      const floorMw = t.params?.startsWith("min=") ? Number(t.params.slice(4)) : undefined;
      // A part whose service did not answer (pipelines' counts: null) is missing, not absent.
      const counts = meta.counts && typeof meta.counts === "object" ? (meta.counts as Record<string, number | null>) : {};
      const missing = Object.entries(counts)
        .filter(([, v]) => v == null)
        .map(([k]) => k);
      const left: LoadedBoxExtra = { truncated: meta.truncated === true, coarsenedForSize: meta.coarsenedForSize === true, floorMw: floorMw || undefined, ...(missing.length ? { missing } : {}) };
      const drawn = o.loadedBox && !t.world ? [...features, loadedBox(o.id, loaded, o.label.toLowerCase(), left)] : features;
      const trunc = meta.truncated ? " · record limit hit, zoom in for the rest" : "";
      const coarse = meta.coarsenedForSize ? " · outlines coarsened to fit" : "";
      return {
        collection: { type: "FeatureCollection", features: drawn },
        source: o.source,
        fetchedAt: ctx.now,
        note: o.summarize(features, meta, t) + trunc + coarse,
        meta: { count: features.length },
      };
    },
  };
}

function countBy(features: LayerFeature[], key: (f: LayerFeature) => string | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of features) {
    const k = key(f);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// ---------------------------------------------------------------- the layers

export const TRANSMISSION_TIERS: BoxTier[] = [
  { maxHeight: 80_000, radiusM: 35_000 },
  { maxHeight: 500_000, radiusM: 110_000 },
];

export const transmissionLayer = boxLayer({
  id: "transmission",
  label: "Transmission lines",
  description:
    "Electric transmission lines of 69 kV and above from HIFLD, coloured by voltage, with the owner and end substations HIFLD published, below 500 km. HIFLD archived this map with its last update on 2024-09-30.",
  color: "#FACC15",
  attribution: "HIFLD U.S. Electric Power Transmission Lines (archive, last updated 2024-09-30), hosted by Esri",
  source: "HIFLD transmission lines (archive)",
  op: "transmission",
  tiers: TRANSMISSION_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  summarize: (fs) => {
    const hi = fs.filter((f) => ["765", "500", "345"].includes(f.properties.kind ?? "")).length;
    return `${fs.length} line segments inside the dashed box · ${hi} at 345 kV or more · HIFLD archive, last updated 2024-09-30`;
  },
});

export const PIPELINE_TIERS: BoxTier[] = [
  { maxHeight: 200_000, radiusM: 80_000 },
  { maxHeight: 1_200_000, radiusM: 220_000 },
];

export const pipelinesLayer = boxLayer({
  id: "pipelines",
  label: "Pipelines (EIA)",
  description:
    "EIA's national maps of natural gas (interstate, intrastate), crude oil trunk, petroleum product and hydrocarbon gas liquids pipelines, below 1,200 km, with the operator EIA published. Generalized routes: no diameter, pressure or depth.",
  color: "#FB923C",
  attribution: "U.S. EIA pipeline maps, hosted by Esri (generalized; not for locating a line)",
  source: "EIA pipelines",
  op: "pipelines",
  tiers: PIPELINE_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  summarize: (fs, env) => {
    const c = countBy(fs, (f) => f.properties.kind);
    const missing = Object.entries((env.counts as Record<string, number | null>) ?? {})
      .filter(([, v]) => v == null)
      .map(([k]) => k);
    return `${fs.length} segments · gas ${c.get("natgas") ?? 0}, crude ${c.get("crude") ?? 0}, products ${c.get("products") ?? 0}, HGL ${c.get("hgl") ?? 0} · generalized, not for digging${missing.length ? ` · did not answer: ${missing.join(", ")}` : ""}`;
  },
});

export const RAIL_TIERS: BoxTier[] = [
  { maxHeight: 40_000, radiusM: 25_000 },
  { maxHeight: 120_000, radiusM: 50_000 },
];

export const railLayer = boxLayer({
  id: "rail",
  label: "Rail network",
  description:
    "The FRA/BTS North American Rail Network below 120 km: main lines, branches, yards and sidings, passenger service (Amtrak, commuter), STRACNET, track counts and the owning railroads' reporting marks. Removed track and rail-trails are left out.",
  color: "#A78BFA",
  attribution: "FRA / BTS NTAD North American Rail Network (public domain)",
  source: "BTS NTAD rail network",
  op: "rail",
  tiers: RAIL_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  summarize: (fs) => {
    const c = countBy(fs, (f) => f.properties.kind);
    return `${fs.length} segments inside the dashed box · main ${c.get("main") ?? 0}, passenger ${c.get("passenger") ?? 0}, branch ${c.get("branch") ?? 0}, yard ${c.get("yard") ?? 0}, inactive ${c.get("inactive") ?? 0}`;
  },
});

export const AIRPORT_TIERS: BoxTier[] = [
  { maxHeight: 300_000, radiusM: 150_000 },
  { maxHeight: 2_500_000, radiusM: 440_000 },
];

export const airportsLayer = boxLayer({
  id: "airports",
  label: "Airports (public use)",
  description:
    "FAA public-use airports, heliports and seaplane bases below 2,500 km, with the FAA location id, ICAO code, type, military use and field elevation. Private-use strips are left out on purpose.",
  color: "#38BDF8",
  attribution: "FAA Aeronautical Information Services, ADDS Airports (public use)",
  source: "FAA ADDS airports",
  op: "airports",
  tiers: AIRPORT_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  summarize: (fs) => {
    const c = countBy(fs, (f) => f.properties.kind);
    return `${fs.length} public-use facilities · ${c.get("airport") ?? 0} airports, ${c.get("heliport") ?? 0} heliports, ${c.get("seaplane base") ?? 0} seaplane bases · private use left out`;
  },
});

export const DAM_TIERS: BoxTier[] = [{ maxHeight: 300_000, radiusM: 80_000 }];

export const damsLayer = boxLayer({
  id: "dams",
  label: "Dams (NID)",
  description:
    "The USACE National Inventory of Dams below 300 km: hazard potential (the damage a failure would cause, not the dam's condition), condition assessment where published, height, storage, purpose and year completed. No owner names.",
  color: "#60A5FA",
  attribution: "U.S. Army Corps of Engineers, National Inventory of Dams",
  source: "USACE NID",
  op: "dams",
  tiers: DAM_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  summarize: (fs) => {
    const c = countBy(fs, (f) => f.properties.kind);
    return `${fs.length} dams · hazard potential: ${c.get("high") ?? 0} high, ${c.get("significant") ?? 0} significant, ${c.get("low") ?? 0} low, ${(c.get("undetermined") ?? 0) + (c.get("not rated") ?? 0)} undetermined or not rated · hazard is consequence, not condition`;
  },
});

export const PLANT_TIERS: BoxTier[] = [
  { maxHeight: 250_000, radiusM: 150_000 },
  { maxHeight: 1_500_000, radiusM: 600_000, params: "min=50" },
  { maxHeight: Number.POSITIVE_INFINITY, radiusM: 0, params: "min=500", world: true },
];

export const plantsLayer = boxLayer({
  id: "plants",
  label: "Power plants",
  description:
    "Every US power plant with generators of 1 MW or more from EIA-860M (the monthly preliminary inventory), coloured by its largest technology, with nameplate capacity by technology, planned additions and the reporting entity; nuclear plants elsewhere from Wikidata. From orbit, US plants of 500 MW or more; 50 MW below 1,500 km; all below 250 km.",
  color: "#F472B6",
  attribution: "U.S. EIA Form EIA-860M (monthly snapshot) · Wikidata (CC0) for nuclear plants outside the US",
  source: "EIA-860M + Wikidata",
  op: "plants",
  tiers: PLANT_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  summarize: (fs, env, t) => {
    const counts = (env.counts as { eia?: number; wikidata?: number }) ?? {};
    const floor = t.params?.startsWith("min=") ? Number(t.params.slice(4)) : 0;
    return `${counts.eia ?? 0} US plants${floor ? ` of ${floor} MW or more (descend for smaller)` : ""} · ${counts.wikidata ?? 0} nuclear plants outside the US (Wikidata) · EIA-860M ${String(env.inventoryAsOf ?? "")}`;
  },
});

export const HOSPITAL_TIERS: BoxTier[] = [
  { maxHeight: 300_000, radiusM: 150_000 },
  { maxHeight: Number.POSITIVE_INFINITY, radiusM: 0, world: true },
];

export const hospitalsLayer = boxLayer({
  id: "hospitals",
  label: "Hospitals (HIFLD)",
  description:
    "Hospitals from HIFLD as FEMA last copied it (the last public copy; data edited April 2026): every open hospital in the United States from orbit, coloured by HIFLD's type and sized by published beds (a hospital with no published beds at the base size), its trauma level in the record; below 300 km the full record: address, beds, trauma level, helipad, owner type, NAICS industry, and the licensing source with its date. Closed hospitals on a toggle, drawn grey. Each record is as its state licensing source published it, which can be years old; not a list of emergency departments.",
  color: "#EF4444",
  attribution: "Homeland Infrastructure Foundation-Level Data (DHS GMO, ORNL), via FEMA RAPT",
  source: "HIFLD hospitals (FEMA RAPT)",
  op: "hospitals",
  tiers: HOSPITAL_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  optionParams: (opts) => (opts.hospitalStatus === "all" ? "status=all" : null),
  // From orbit the route sends packed rows (8,140 built features would near the 4.5 MB response limit).
  decode: (data) => {
    const d = data as { rows?: PackedRow[]; features?: LayerFeature[] };
    return Array.isArray(d.rows) ? buildHospitals(unpackNational(d.rows), true) : (d.features ?? []);
  },
  summarize: (fs, env) => {
    const c = countBy(fs, (f) => f.properties.kind);
    const trauma = fs.filter((f) => (f.properties.extra as { trauma?: string | null } | undefined)?.trauma).length;
    const scope = env.national ? "nationally (short record; descend below 300 km for the full one)" : "inside the dashed box";
    return `${fs.length.toLocaleString("en-US")} ${env.status === "all" ? "open and closed" : "open"} hospitals ${scope} · ${c.get("general") ?? 0} general acute care, ${c.get("critical-access") ?? 0} critical access, ${trauma} with a published trauma level · HIFLD via FEMA, data edited ${String(env.dataLastEdited ?? "")}`;
  },
});

export const FAULT_TIERS: BoxTier[] = [
  { maxHeight: 150_000, radiusM: 40_000 },
  { maxHeight: 400_000, radiusM: 80_000 },
];

export const faultsLayer = boxLayer({
  id: "faults",
  label: "Quaternary faults",
  description:
    "USGS Quaternary faults below 400 km: faults with evidence of movement in about the last 1.6 million years, coloured by the age of the most recent deformation in USGS's own classes, dashed where the trace is inferred, with slip rate and sense. Not a forecast.",
  color: "#F87171",
  attribution: "USGS Quaternary Fault and Fold Database of the United States",
  source: "USGS Quaternary faults",
  op: "faults",
  tiers: FAULT_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  summarize: (fs) => {
    const c = countBy(fs, (f) => f.properties.kind);
    return `${fs.length} fault traces · historic ${c.get("historic") ?? 0}, latest Quaternary ${c.get("latest") ?? 0}, late ${c.get("late") ?? 0}, older ${(c.get("middle-late") ?? 0) + (c.get("undifferentiated") ?? 0)}, unspecified ${c.get("unspecified") ?? 0} · not a forecast`;
  },
});

export const LANDSLIDE_TIERS: BoxTier[] = [
  { maxHeight: 25_000, radiusM: 12_000 },
  { maxHeight: 60_000, radiusM: 25_000 },
];

export const landslidesLayer = boxLayer({
  id: "landslides",
  label: "Landslides (USGS)",
  description:
    "Mapped landslides from the USGS US Landslide Inventory (version 3) below 60 km: type, date or date range, fatalities, confidence and the source inventory. Coverage is where someone mapped: none shown is not none there.",
  color: "#D97706",
  attribution: "USGS, Landslide Inventories across the United States v3 (doi:10.5066/P14AJF8I)",
  source: "USGS landslide inventory",
  op: "landslides",
  tiers: LANDSLIDE_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  summarize: (fs) => `${fs.length} mapped landslides inside the dashed box · coverage is where someone mapped, so none shown is not none there`,
});

export const PLSS_TIERS: BoxTier[] = [
  { maxHeight: 25_000, radiusM: 20_000, params: "level=section" },
  { maxHeight: 400_000, radiusM: 110_000, params: "level=township" },
];

export const plssLayer = boxLayer({
  id: "plss",
  label: "PLSS grid",
  description:
    "BLM's Public Land Survey System grid: townships below 400 km, sections below 25 km, labelled T-R-S as BLM labels them. Search a description like \"T12N R3W S33\" in ⌘K. Covers the 30 PLSS states (not Texas or the original colonies).",
  color: "#E5E7EB",
  attribution: "BLM National PLSS CadNSDI",
  source: "BLM PLSS",
  op: "plss",
  tiers: PLSS_TIERS,
  updateIntervalMs: 24 * 60 * 60_000,
  loadedBox: true,
  summarize: (fs, env) => {
    const level = env.level === "township" ? "townships" : "sections";
    return fs.length ? `${fs.length} ${level} inside the dashed box${level === "townships" ? " · descend below 25 km for sections" : ""}` : `no PLSS ${level} here (Texas and the original colonies are not PLSS states)`;
  },
});

export const INFRA_LAYERS: LayerDefinition[] = [
  transmissionLayer,
  pipelinesLayer,
  plantsLayer,
  railLayer,
  airportsLayer,
  damsLayer,
  hospitalsLayer,
  faultsLayer,
  landslidesLayer,
  plssLayer,
];
