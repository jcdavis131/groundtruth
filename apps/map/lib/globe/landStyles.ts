"use client";
// Styles for the three land layers: FEMA flood zones, NWI wetlands and PAD-US
// public & protected lands. All ground polygons with thin outlines, plus the
// dashed outline of the box the flood and wetland layers loaded. Flood zones
// also draw FEMA's own map of the zones under them, across the whole view;
// wetlands draw NWI's national raster above 10 km, where no polygons load.

import type { LayerStyle } from "./renderer";
import type { LayerFeature } from "@/lib/layers/types";
import type { Access, FloodZoneExtra, HistoricExtra, PublicLandExtra, WetlandExtra } from "@/lib/land/features";
import type { ImpairedExtra } from "@/lib/water/impaired";
import type { HeritageExtra } from "@/lib/land/heritage";
import { TRIBAL_COLOR } from "@/lib/land/tribal";
import { pfasBin, type PfasExtra } from "@/lib/water/pfas";
import { polyFills, polyOutlines, UNRATED } from "./hazardStyles";
import { FLOOD_PICTURE, WETLANDS_PICTURE } from "./terrainStyles";

// ---------------------------------------------------------------- loaded box

/** The box a near-only land layer loaded: a dashed outline, never a fill, never a standing label. */
const LOADED_BOX = "#E5E7EB";

function isLoadedBox(f: LayerFeature): boolean {
  return f.properties.kind === "loaded-box";
}

// ---------------------------------------------------------------- flood zones

const FLOOD: Record<FloodZoneExtra["hazard"], [string, number]> = {
  coastal: ["#1D4ED8", 0.42],
  sfha: ["#2563EB", 0.34],
  moderate: ["#60A5FA", 0.2],
  minimal: ["#93C5FD", 0.05],
  // Zone D: FEMA did not analyse the hazard. Unrated, not safe.
  undetermined: [UNRATED, 0.22],
  water: ["#0EA5E9", 0.08],
  other: ["#94A3B8", 0.18],
};

function floodOf(f: LayerFeature): [string, number] {
  return FLOOD[(f.properties.extra as FloodZoneExtra | undefined)?.hazard ?? "other"] ?? FLOOD.other;
}

export const floodStyle: LayerStyle = {
  color: "#3B82F6",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : floodOf(f)[0]),
  label: (f) => f.properties.name,
  labelMax: 25,
  labelWhen: (f) => !isLoadedBox(f),
  polygons: (f) => {
    if (isLoadedBox(f)) return null;
    const [color, alpha] = floodOf(f);
    return polyFills(f, color, alpha);
  },
  lines: (f) => {
    if (isLoadedBox(f)) return polyOutlines(f, LOADED_BOX, 0.7, 1.5, true);
    const [color, alpha] = floodOf(f);
    return polyOutlines(f, color, Math.min(0.7, alpha + 0.25), 1);
  },
  // FEMA's rendering of the same layer 28 (through /api/terrain): it covers the whole view below
  // 5 km, while the clickable zones above it stay inside the dashed box they were loaded for.
  tiles: () => [FLOOD_PICTURE],
};

// ---------------------------------------------------------------- wetlands

/** The NWI Wetlands Mapper legend colours, by plain-language wetland type. */
const WETLAND_COLOR: Record<string, string> = {
  "Freshwater Emergent Wetland": "#7FC31C",
  "Freshwater Forested/Shrub Wetland": "#008837",
  "Freshwater Pond": "#688CC0",
  Lake: "#13007C",
  Riverine: "#0190BF",
  "Estuarine and Marine Deepwater": "#007C88",
  "Estuarine and Marine Wetland": "#66C2A5",
  Other: "#B28653",
};

function wetlandColor(f: LayerFeature): string {
  return WETLAND_COLOR[(f.properties.extra as WetlandExtra | undefined)?.type ?? ""] ?? "#B28653";
}

export const wetlandsStyle: LayerStyle = {
  color: "#34D399",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : wetlandColor(f)),
  label: (f) => f.properties.name,
  labelMax: 20,
  labelWhen: (f) => !isLoadedBox(f),
  polygons: (f) => (isLoadedBox(f) ? null : polyFills(f, wetlandColor(f), 0.38)),
  lines: (f) => (isLoadedBox(f) ? polyOutlines(f, LOADED_BOX, 0.7, 1.5, true) : polyOutlines(f, wetlandColor(f), 0.7, 1)),
  // NWI's national raster above 10 km, where no polygons are loaded (lib/globe/terrainStyles.ts).
  tiles: () => [WETLANDS_PICTURE],
};

// ---------------------------------------------------------------- public & protected lands

const ACCESS_COLOR: Record<Access, string> = {
  open: "#4ADE80",
  restricted: "#F5B849",
  closed: "#FF6B6B",
  unknown: UNRATED,
};
const DESIGNATION = "#A3E635";
const PROCLAMATION = "#E5E7EB";
/** Easements: the owner keeps the land, so an outline in a colour no access class uses. */
const EASEMENT = "#38BDF8";

function publicColor(f: LayerFeature): string {
  const x = f.properties.extra as PublicLandExtra;
  if (x.category === "Fee") return ACCESS_COLOR[x.access];
  if (x.category === "Designation") return DESIGNATION;
  if (x.category === "Easement") return EASEMENT;
  return PROCLAMATION;
}

export const publiclandsStyle: LayerStyle = {
  color: "#4ADE80",
  icon: () => null,
  colorFor: publicColor,
  label: (f) => f.properties.name,
  labelMax: 30,
  labelAlways: (f) => {
    const x = f.properties.extra as PublicLandExtra;
    return x.category === "Fee" && (x.acres ?? 0) >= 20_000;
  },
  polygons: (f) => {
    const x = f.properties.extra as PublicLandExtra;
    if (x.category === "Fee") return polyFills(f, publicColor(f), 0.2);
    if (x.category === "Designation") return polyFills(f, DESIGNATION, 0.05);
    // Easements stay with their owner and proclamation boundaries contain private land: outline only.
    return null;
  },
  lines: (f) => {
    const x = f.properties.extra as PublicLandExtra;
    if (x.category === "Fee") return polyOutlines(f, publicColor(f), 0.75, 1.5);
    if (x.category === "Designation") return polyOutlines(f, DESIGNATION, 0.8, 1.2);
    if (x.category === "Easement") return polyOutlines(f, EASEMENT, 0.8, 1.3);
    return polyOutlines(f, PROCLAMATION, 0.55, 1.2, true);
  },
};

// ---------------------------------------------------------------- historic places (NRHP)

/** National Register listings by NPS's resource type; a National Historic Landmark is drawn larger. */
export const HISTORIC_TYPE_COLOR: Record<string, string> = {
  building: "#F59E0B",
  structure: "#FB923C",
  district: "#C084FC",
  site: "#F472B6",
  object: "#FDE68A",
};
const HISTORIC_OTHER = "#E5E7EB";

function historicColor(f: LayerFeature): string {
  return HISTORIC_TYPE_COLOR[(f.properties.extra as HistoricExtra | undefined)?.resType ?? ""] ?? HISTORIC_OTHER;
}

/** The globe's label is the property's name as NPS lists it (the feature name, which is searched, is its NRIS number). */
function historicLabel(f: LayerFeature): string {
  const n = f.properties.details?.["property name (as NPS lists it)"];
  return typeof n === "string" && n ? n : f.properties.name;
}

export const historicStyle: LayerStyle = {
  color: "#F59E0B",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : historicColor(f)),
  pointSize: (f) => ((f.properties.extra as HistoricExtra | undefined)?.nhl ? 10 : 7),
  label: historicLabel,
  labelMax: 25,
  labelWhen: (f) => !isLoadedBox(f),
  labelAlways: (f) => !!(f.properties.extra as HistoricExtra | undefined)?.nhl && f.geometry.type === "Point",
  polygons: (f) => (isLoadedBox(f) || f.geometry.type === "Point" ? null : polyFills(f, historicColor(f), 0.12)),
  lines: (f) => {
    if (isLoadedBox(f)) return polyOutlines(f, LOADED_BOX, 0.7, 1.5, true);
    if (f.geometry.type === "Point") return null;
    return polyOutlines(f, historicColor(f), 0.8, 1.5);
  },
  scaleByDistance: [2e3, 1.0, 2.5e4, 0.6],
};

// ---------------------------------------------------------------- impaired waters (EPA ATTAINS)

/** 5 (on the 303(d) list) solid red; 4A/4B/4C (a TMDL or other plan) orange; a category not reported grey. */
const IMPAIRED: Record<ImpairedExtra["tier"], string> = { listed: "#EF4444", planned: "#F97316", other: "#94A3B8" };

function impairedColor(f: LayerFeature): string {
  return IMPAIRED[(f.properties.extra as ImpairedExtra | undefined)?.tier ?? "other"] ?? IMPAIRED.other;
}

function lineParts(f: LayerFeature): number[][][] {
  const g = f.geometry;
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

export const impairedStyle: LayerStyle = {
  color: "#EF4444",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : impairedColor(f)),
  label: (f) => (f.properties.details?.["assessment unit"] as string | undefined) ?? f.properties.name,
  labelMax: 20,
  labelWhen: (f) => !isLoadedBox(f),
  polygons: (f) => (isLoadedBox(f) ? null : polyFills(f, impairedColor(f), 0.16)),
  lines: (f) => {
    if (isLoadedBox(f)) return polyOutlines(f, LOADED_BOX, 0.7, 1.5, true);
    if (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") return polyOutlines(f, impairedColor(f), 0.85, 1.5);
    return lineParts(f)
      .filter((p) => p.length > 1)
      .map((p) => ({ positions: p.map((c) => [c[0], c[1], 0] as [number, number, number]), color: impairedColor(f), width: 2.4, alpha: 0.9 }));
  },
};

// ---------------------------------------------------------------- PFAS in drinking water (EPA UCMR 5)

/**
 * A system's highest single result, ng/L, in the legend's four bins (lib/layers/pfas.ts PFAS_BINS):
 * a measured value, not a risk scale. Sampled with none at or above the reporting level: outlined
 * blue. Not in UCMR 5: thin grey dashes. Unknown: amber dashes, never drawn as not-detected.
 */
const PFAS_FILL = ["#E9D5FF", "#C084FC", "#9333EA", "#6B21A8"];
const PFAS_NOT_DETECTED = "#38BDF8";
const PFAS_NOT_IN = "#94A3B8";
const PFAS_UNKNOWN = "#F59E0B";

function pfasColor(f: LayerFeature): string {
  const x = f.properties.extra as PfasExtra | undefined;
  if (!x) return PFAS_NOT_IN;
  if (x.state === "detected") return PFAS_FILL[pfasBin(x.maxNgL) ?? 0];
  if (x.state === "not-detected") return PFAS_NOT_DETECTED;
  if (x.state === "unknown") return PFAS_UNKNOWN;
  return PFAS_NOT_IN;
}

/** The label is the system's name as EPA lists it (the feature name, which is searched, is its PWSID). */
function pfasLabel(f: LayerFeature): string {
  const n = f.properties.details?.["water system (as EPA lists it)"];
  return typeof n === "string" && n ? n : f.properties.name;
}

export const pfasStyle: LayerStyle = {
  color: "#A855F7",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : pfasColor(f)),
  label: pfasLabel,
  labelMax: 20,
  labelWhen: (f) => !isLoadedBox(f),
  polygons: (f) => {
    if (isLoadedBox(f)) return null;
    const x = f.properties.extra as PfasExtra | undefined;
    // A faint fill keeps every system clickable; only a detection is filled for real.
    return polyFills(f, pfasColor(f), x?.state === "detected" ? 0.35 : 0.04);
  },
  lines: (f) => {
    if (isLoadedBox(f)) return polyOutlines(f, LOADED_BOX, 0.7, 1.5, true);
    const x = f.properties.extra as PfasExtra | undefined;
    const dashed = x?.state === "not-in-ucmr5" || x?.state === "unknown" || x?.modelled === true;
    return polyOutlines(f, pfasColor(f), 0.9, x?.state === "not-in-ucmr5" ? 1 : 2, dashed);
  },
};

// ---------------------------------------------------------------- national heritage (NPS)

/** Park units green, heritage areas violet (dashed: a partnership region), World Heritage gold; battlefields by war, core areas filled. */
const HERITAGE_WAR: Record<string, string> = { "Civil War": "#64748B", "Revolutionary War": "#B45309", "War of 1812": "#1D4ED8" };

function heritageColor(f: LayerFeature): string {
  const x = f.properties.extra as HeritageExtra | undefined;
  if (x?.kind === "battlefield") return HERITAGE_WAR[x.group ?? ""] ?? "#64748B";
  if (x?.kind === "nha") return "#A855F7";
  if (x?.kind === "whs") return "#EAB308";
  return "#65A30D";
}

export const heritageStyle: LayerStyle = {
  color: "#65A30D",
  icon: () => null,
  colorFor: heritageColor,
  pointSize: () => 7,
  label: (f) => f.properties.name,
  labelMax: 25,
  polygons: (f) => {
    const x = f.properties.extra as HeritageExtra | undefined;
    if (f.geometry.type === "Point" || !x) return null;
    if (x.kind === "battlefield") return x.boundary === "core" ? polyFills(f, heritageColor(f), 0.35) : null;
    return polyFills(f, heritageColor(f), x.kind === "unit" ? 0.12 : 0.06);
  },
  lines: (f) => {
    const x = f.properties.extra as HeritageExtra | undefined;
    if (f.geometry.type === "Point" || !x) return null;
    return polyOutlines(f, heritageColor(f), 0.85, x.kind === "whs" ? 2 : 1.4, x.kind === "nha" || (x.kind === "battlefield" && x.boundary === "study"));
  },
  scaleByDistance: [2e4, 1.0, 3e6, 0.6],
};

// ---------------------------------------------------------------- trust land (BIA LAR)

export const tribalStyle: LayerStyle = {
  color: TRIBAL_COLOR,
  icon: () => null,
  colorFor: () => TRIBAL_COLOR,
  label: (f) => f.properties.name,
  labelMax: 30,
  polygons: (f) => (f.geometry.type === "Point" ? null : polyFills(f, TRIBAL_COLOR, 0.18)),
  lines: (f) => (f.geometry.type === "Point" ? null : polyOutlines(f, TRIBAL_COLOR, 0.9, 1.6)),
  scaleByDistance: [2e4, 1.0, 3e6, 0.6],
};
