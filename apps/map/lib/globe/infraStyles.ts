"use client";
// Styles for the infrastructure and geohazard layers: lines coloured by what
// the registry publishes (voltage, commodity, track class, fault age), points
// for airports, dams, plants and landslides, PLSS outlines, the Macrostrat
// picture, and the dashed outline of each layer's loaded box.
//
// A class the source does not rate (a dam with no hazard potential, a fault of
// unspecified age) is drawn in the "not rated" violet (hazardStyles UNRATED),
// never in the colour of the mildest class.

import type { LayerStyle, StyledLine } from "./renderer";
import type { LayerFeature } from "@/lib/layers/types";
import { polyOutlines, UNRATED } from "./hazardStyles";
import type { FaultExtra, RailExtra, TransmissionExtra } from "@/lib/infra/features";
import type { FuelFamily, PlantExtra } from "@/lib/infra/plants";
import type { HospitalExtra } from "@/lib/infra/hospitals";
import { isLoadedBox } from "@/lib/layers/infra";
import { MACROSTRAT_TILES } from "@/lib/terrain/products";
import type { AirExtra } from "@/lib/air/airnow";
import type { EventsExtra } from "@/lib/events/gdelt";

const LOADED_BOX = "#E5E7EB";

/** A feature's line parts as positions at 0 m. */
function lineParts(f: LayerFeature): number[][][] {
  const g = f.geometry;
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

function lines(f: LayerFeature, color: string, width: number, alpha: number, dashed = false): StyledLine[] {
  return lineParts(f)
    .filter((part) => part.length > 1)
    .map((part) => ({ positions: part.map((c) => [c[0], c[1], 0] as [number, number, number]), color, width, alpha, dashed }));
}

const boxOutline = (f: LayerFeature) => polyOutlines(f, LOADED_BOX, 0.6, 1.5, true);
const notBox = (f: LayerFeature) => !isLoadedBox(f);

// ---------------------------------------------------------------- transmission

export const VOLT_COLOR: Record<TransmissionExtra["band"], [string, number]> = {
  "765": ["#FF4D6D", 2.6],
  "500": ["#FF8A3D", 2.3],
  "345": ["#FACC15", 2],
  "220-287": ["#A3E635", 1.7],
  "100-161": ["#38BDF8", 1.4],
  "under-100": ["#94A3B8", 1.1],
  dc: ["#E879F9", 2.2],
  unknown: ["#9CA3AF", 1.1],
};

function volt(f: LayerFeature): [string, number] {
  return VOLT_COLOR[(f.properties.extra as TransmissionExtra | undefined)?.band ?? "unknown"] ?? VOLT_COLOR.unknown;
}

export const transmissionStyle: LayerStyle = {
  color: "#FACC15",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : volt(f)[0]),
  label: (f) => f.properties.name,
  labelMax: 12,
  labelWhen: notBox,
  lines: (f) => (isLoadedBox(f) ? boxOutline(f) : lines(f, volt(f)[0], volt(f)[1], 0.85)),
};

// ---------------------------------------------------------------- pipelines

export const PIPE_COLOR: Record<string, string> = {
  natgas: "#FB923C",
  crude: "#F43F5E",
  products: "#22D3EE",
  hgl: "#A3E635",
};

export const pipelinesStyle: LayerStyle = {
  color: "#FB923C",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : PIPE_COLOR[f.properties.kind ?? ""] ?? "#FB923C"),
  label: (f) => f.properties.name,
  labelMax: 12,
  labelWhen: notBox,
  lines: (f) => (isLoadedBox(f) ? boxOutline(f) : lines(f, PIPE_COLOR[f.properties.kind ?? ""] ?? "#FB923C", 1.6, 0.8)),
};

// ---------------------------------------------------------------- rail

const RAIL_STYLE: Record<RailExtra["cls"], { color: string; width: number; alpha: number; dashed?: boolean }> = {
  main: { color: "#C4B5FD", width: 1.8, alpha: 0.9 },
  passenger: { color: "#F0ABFC", width: 2, alpha: 0.95 },
  branch: { color: "#A78BFA", width: 1.2, alpha: 0.75 },
  yard: { color: "#8B5CF6", width: 1, alpha: 0.6 },
  inactive: { color: "#6B7280", width: 1, alpha: 0.7, dashed: true },
};

function railOf(f: LayerFeature) {
  return RAIL_STYLE[(f.properties.extra as RailExtra | undefined)?.cls ?? "branch"] ?? RAIL_STYLE.branch;
}

export const railStyle: LayerStyle = {
  color: "#A78BFA",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : railOf(f).color),
  label: (f) => f.properties.name,
  labelMax: 10,
  labelWhen: notBox,
  lines: (f) => {
    if (isLoadedBox(f)) return boxOutline(f);
    const s = railOf(f);
    return lines(f, s.color, s.width, s.alpha, s.dashed);
  },
};

// ---------------------------------------------------------------- airports

export const airportsStyle: LayerStyle = {
  color: "#38BDF8",
  icon: (f) => (isLoadedBox(f) ? null : f.properties.kind === "heliport" ? "heli" : "plane"),
  iconSize: 20,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : f.properties.details?.military && f.properties.details.military !== "CIVIL" ? "#A5B4FC" : "#38BDF8"),
  label: (f) => f.properties.name,
  labelMax: 25,
  labelWhen: notBox,
  scaleByDistance: [5e4, 1, 3e6, 0.5],
  lines: (f) => (isLoadedBox(f) ? boxOutline(f) : null),
};

// ---------------------------------------------------------------- dams

export const DAM_COLOR: Record<string, string> = {
  high: "#F87171",
  significant: "#FBBF24",
  low: "#60A5FA",
};

function damColor(f: LayerFeature): string {
  if (isLoadedBox(f)) return LOADED_BOX;
  // Undetermined and not rated: the violet of "not rated by source", never the colour of Low.
  return DAM_COLOR[f.properties.kind ?? ""] ?? UNRATED;
}

export const damsStyle: LayerStyle = {
  color: "#60A5FA",
  icon: (f) => (isLoadedBox(f) ? null : "dam"),
  iconSize: 18,
  colorFor: damColor,
  label: (f) => f.properties.name,
  labelMax: 25,
  labelWhen: notBox,
  scaleByDistance: [2e4, 1, 4e5, 0.55],
  lines: (f) => (isLoadedBox(f) ? boxOutline(f) : null),
};

// ---------------------------------------------------------------- hospitals (HIFLD)

export const HOSPITAL_COLOR: Record<string, string> = {
  general: "#EF4444",
  "critical-access": "#F97316",
  children: "#EC4899",
  psychiatric: "#A855F7",
  "long-term": "#14B8A6",
  rehabilitation: "#22C55E",
  military: "#64748B",
  women: "#F472B6",
  special: "#EAB308",
  chronic: "#0EA5E9",
  other: "#94A3B8",
  // NOT AVAILABLE: grey, "type not published", never a type.
  unknown: "#9CA3AF",
};

function hospitalColor(f: LayerFeature): string {
  if (isLoadedBox(f)) return LOADED_BOX;
  const x = f.properties.extra as HospitalExtra | undefined;
  // A closed hospital (shown only with status=all) is drawn in grey whatever its type.
  if (x?.status && x.status !== "OPEN") return "#6B7280";
  return HOSPITAL_COLOR[f.properties.kind ?? "unknown"] ?? HOSPITAL_COLOR.other;
}

/** Sized by published beds; -999 ("not published") takes the base size, no size claim. */
export function hospitalSize(f: LayerFeature): number {
  const beds = (f.properties.extra as HospitalExtra | undefined)?.beds;
  return beds == null ? 6 : Math.min(14, 6 + Math.sqrt(beds) / 4);
}

export const hospitalsStyle: LayerStyle = {
  color: "#EF4444",
  icon: () => null,
  pointSize: hospitalSize,
  colorFor: hospitalColor,
  label: (f) => f.properties.name,
  labelMax: 25,
  labelWhen: notBox,
  scaleByDistance: [5e4, 1, 4e6, 0.5],
  lines: (f) => (isLoadedBox(f) ? boxOutline(f) : null),
};

// ---------------------------------------------------------------- power plants

export const FUEL_COLOR: Record<FuelFamily | "planned", string> = {
  nuclear: "#FACC15",
  coal: "#A8A29E",
  gas: "#FB923C",
  oil: "#EF4444",
  hydro: "#3B82F6",
  wind: "#6EE7B7",
  solar: "#FDE68A",
  storage: "#C084FC",
  geothermal: "#F472B6",
  biomass: "#84CC16",
  other: "#9CA3AF",
  planned: "#E5E7EB",
};

function plantColor(f: LayerFeature): string {
  if (isLoadedBox(f)) return LOADED_BOX;
  if (f.properties.kind === "planned") return FUEL_COLOR.planned;
  return FUEL_COLOR[(f.properties.extra as PlantExtra | undefined)?.family ?? "other"] ?? FUEL_COLOR.other;
}

/** Point size from nameplate MW: 4 px at 1 MW to about 14 px at 4,000 MW. */
export function plantSize(mw: number | undefined): number {
  if (mw == null || !(mw > 0)) return 5;
  return Math.min(14, 4 + 2.8 * Math.log10(Math.max(1, mw)));
}

export const plantsStyle: LayerStyle = {
  color: "#F472B6",
  icon: () => null,
  colorFor: plantColor,
  pointSize: (f) => {
    const x = f.properties.extra as PlantExtra | undefined;
    return plantSize(x?.mw ?? x?.plannedMw);
  },
  label: (f) => f.properties.name,
  labelMax: 20,
  labelWhen: notBox,
  labelAlways: (f) => ((f.properties.extra as PlantExtra | undefined)?.mw ?? 0) >= 2000,
  labelPriority: (f) => Math.min(20, Math.round(((f.properties.extra as PlantExtra | undefined)?.mw ?? 0) / 250)),
  scaleByDistance: [5e4, 1, 6e6, 0.6],
  lines: (f) => (isLoadedBox(f) ? boxOutline(f) : null),
};

// ---------------------------------------------------------------- faults

export const FAULT_COLOR: Record<FaultExtra["ageClass"], string> = {
  historic: "#FF3B30",
  latest: "#FF8A3D",
  late: "#FACC15",
  "middle-late": "#A3E635",
  undifferentiated: "#60A5FA",
  unspecified: UNRATED,
};

function faultOf(f: LayerFeature): FaultExtra | undefined {
  return f.properties.extra as FaultExtra | undefined;
}

export const faultsStyle: LayerStyle = {
  color: "#F87171",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : FAULT_COLOR[faultOf(f)?.ageClass ?? "unspecified"]),
  label: (f) => f.properties.name,
  labelMax: 10,
  labelWhen: notBox,
  lines: (f) => {
    if (isLoadedBox(f)) return boxOutline(f);
    const x = faultOf(f);
    return lines(f, FAULT_COLOR[x?.ageClass ?? "unspecified"], 1.7, 0.9, x?.lineType === "Inferred");
  },
};

// ---------------------------------------------------------------- landslides

export const landslidesStyle: LayerStyle = {
  color: "#D97706",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : "#D97706"),
  pointSize: (f) => ((f.properties.extra as { fatalities?: number } | undefined)?.fatalities ? 8 : 5),
  label: (f) => f.properties.name,
  labelMax: 15,
  labelWhen: notBox,
  lines: (f) => (isLoadedBox(f) ? boxOutline(f) : null),
};

// ---------------------------------------------------------------- PLSS

export const plssStyle: LayerStyle = {
  color: "#E5E7EB",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : "#E5E7EB"),
  label: (f) => f.properties.name,
  labelMax: 60,
  labelWhen: notBox,
  lines: (f) => {
    if (isLoadedBox(f)) return boxOutline(f);
    return f.properties.kind === "township" ? polyOutlines(f, "#E5E7EB", 0.55, 1.3) : polyOutlines(f, "#CBD5E1", 0.4, 0.8);
  },
};

// ---------------------------------------------------------------- geology (Macrostrat picture)

export const geologyStyle: LayerStyle = {
  color: "#C084FC",
  tiles: () => [
    {
      key: "geology",
      kind: "xyz",
      url: MACROSTRAT_TILES,
      tileSize: 512,
      maximumLevel: 16,
      alpha: 0.55,
      // Under the terrain pictures that are lines (contours), over relief.
      z: 15,
      credit: "Geology: Macrostrat (CC BY 4.0) and the maps it compiles",
    },
  ],
};

// ---------------------------------------------------------------- air quality (AirNow, preliminary)

export const airqualityStyle: LayerStyle = {
  color: "#00E400",
  icon: () => null,
  // EPA's AQI colour for the site's highest published AQI; the violet of "not rated" when it sent none.
  colorFor: (f) => (f.properties.extra as AirExtra | undefined)?.color ?? UNRATED,
  pointSize: (f) => ((f.properties.extra as AirExtra | undefined)?.aqi != null ? 7 : 5),
  label: (f) => f.properties.name,
  labelMax: 30,
  labelPriority: (f) => Math.min(20, Math.round(((f.properties.extra as AirExtra | undefined)?.aqi ?? 0) / 15)),
  scaleByDistance: [1e5, 1, 8e6, 0.55],
};

// ---------------------------------------------------------------- news events (GDELT)

export const eventsStyle: LayerStyle = {
  color: "#F97316",
  icon: () => null,
  colorFor: (f) => (f.properties.kind === "material" ? "#F97316" : "#FCD34D"),
  pointSize: (f) => Math.min(16, 5 + 2 * Math.log2(Math.max(1, (f.properties.extra as EventsExtra | undefined)?.events ?? 1))),
  label: (f) => f.properties.name,
  labelMax: 20,
  labelPriority: (f) => Math.min(20, (f.properties.extra as EventsExtra | undefined)?.events ?? 0),
  scaleByDistance: [1e5, 1, 1e7, 0.6],
};
