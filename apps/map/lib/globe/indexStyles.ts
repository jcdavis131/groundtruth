// County and tract index choropleths (rounds 4 to 7): FEMA's National Risk Index
// in its five rating classes, CDC PLACES in quintile bins, and CDC/ATSDR SVI on
// fixed percentile breaks. A feature with no class ("Not Applicable",
// "Insufficient Data", "No Rating", "Data Unavailable", not in the index)
// gets no fill and a dashed grey edge, so it never reads as low.

import type { LayerStyle } from "./renderer";
import type { LayerFeature } from "@/lib/layers/types";
import { polyFills, polyOutlines } from "./hazardStyles";
import { NRI_COLORS, NRI_NO_RATING_EDGE, type NriExtra } from "@/lib/hazards/nri";
import { PLACES_BIN_COLORS } from "@/lib/civic/places";
import type { HealthExtra } from "@/lib/layers/health";
import { SVI_BIN_COLORS, SVI_NO_RANK_EDGE, type SviExtra } from "@/lib/civic/svi";
import { BROADBAND_BIN_COLORS, BROADBAND_NO_DATA_EDGE, type BroadbandExtra } from "@/lib/civic/broadband";
import { WRC_BIN_COLORS, WRC_NO_RANK_EDGE, type WrcExtra } from "@/lib/hazards/wrc";
import { HOUSING_BIN_COLORS, HOUSING_NO_DATA_EDGE, HOUSING_SUPPRESSED_FILL, QCT_EDGE, type HousingExtra } from "@/lib/civic/housing";
import { DDA_EDGE, LIHTC_COLOR, LIHTC_POINT_SIZES, type DdaExtra, type LihtcExtra } from "@/lib/civic/taxcredit";

export function riskColor(f: LayerFeature): string {
  const x = f.properties.extra as NriExtra | undefined;
  return x?.rating ? NRI_COLORS[x.rating] : NRI_NO_RATING_EDGE;
}

export const riskindexStyle: LayerStyle = {
  color: "#EA580C",
  icon: () => null,
  colorFor: riskColor,
  label: (f) => f.properties.name,
  labelMax: 12,
  polygons: (f) => ((f.properties.extra as NriExtra | undefined)?.rating ? polyFills(f, riskColor(f), 0.5) : null),
  lines: (f) => {
    const rated = !!(f.properties.extra as NriExtra | undefined)?.rating;
    return polyOutlines(f, rated ? "#1F2937" : NRI_NO_RATING_EDGE, rated ? 0.5 : 0.85, 1, !rated);
  },
};

// ---------------------------------------------------------------- community health (CDC PLACES)

export function healthColor(f: LayerFeature): string {
  const bin = (f.properties.extra as HealthExtra | undefined)?.bin;
  return bin == null ? NRI_NO_RATING_EDGE : PLACES_BIN_COLORS[bin];
}

export const healthStyle: LayerStyle = {
  color: "#2563EB",
  icon: () => null,
  colorFor: healthColor,
  label: (f) => f.properties.name,
  labelMax: 12,
  polygons: (f) => ((f.properties.extra as HealthExtra | undefined)?.bin != null ? polyFills(f, healthColor(f), 0.55) : null),
  lines: (f) => {
    const published = (f.properties.extra as HealthExtra | undefined)?.bin != null;
    return polyOutlines(f, published ? "#1F2937" : NRI_NO_RATING_EDGE, published ? 0.45 : 0.85, 1, !published);
  },
};

// ---------------------------------------------------------------- social vulnerability (CDC/ATSDR SVI)

export function vulnerabilityColor(f: LayerFeature): string {
  const bin = (f.properties.extra as SviExtra | undefined)?.bin;
  return bin == null ? SVI_NO_RANK_EDGE : SVI_BIN_COLORS[bin];
}

export const vulnerabilityStyle: LayerStyle = {
  color: "#C2410C",
  icon: () => null,
  colorFor: vulnerabilityColor,
  label: (f) => f.properties.name,
  labelMax: 12,
  polygons: (f) => ((f.properties.extra as SviExtra | undefined)?.bin != null ? polyFills(f, vulnerabilityColor(f), 0.55) : null),
  lines: (f) => {
    const ranked = (f.properties.extra as SviExtra | undefined)?.bin != null;
    return polyOutlines(f, ranked ? "#1F2937" : SVI_NO_RANK_EDGE, ranked ? 0.45 : 0.85, 1, !ranked);
  },
};

// ---------------------------------------------------------------- broadband (FCC BDC via Esri)

export function broadbandColor(f: LayerFeature): string {
  const bin = (f.properties.extra as BroadbandExtra | undefined)?.bin;
  return bin == null ? BROADBAND_NO_DATA_EDGE : BROADBAND_BIN_COLORS[bin];
}

const isLoadedBox = (f: LayerFeature) => f.properties.kind === "loaded-box";

export const broadbandStyle: LayerStyle = {
  color: "#2563EB",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? "#E5E7EB" : broadbandColor(f)),
  label: (f) => f.properties.name,
  labelMax: 12,
  // Counties are labelled; hexagons (named by H3 id) and the loaded box are not.
  labelWhen: (f) => (f.properties.extra as BroadbandExtra | undefined)?.level === "county",
  polygons: (f) => ((f.properties.extra as BroadbandExtra | undefined)?.bin != null ? polyFills(f, broadbandColor(f), 0.55) : null),
  lines: (f) => {
    if (isLoadedBox(f)) return polyOutlines(f, "#E5E7EB", 0.7, 1.5, true);
    const x = f.properties.extra as BroadbandExtra | undefined;
    const drawn = x?.bin != null;
    return polyOutlines(f, drawn ? "#1F2937" : BROADBAND_NO_DATA_EDGE, drawn ? (x?.level === "hex" ? 0.25 : 0.45) : 0.85, 1, !drawn);
  },
};

// ---------------------------------------------------------------- wildfire risk ranks (USFS WRC)

export function wildfireriskColor(f: LayerFeature): string {
  const bin = (f.properties.extra as WrcExtra | undefined)?.bin;
  return bin == null ? WRC_NO_RANK_EDGE : WRC_BIN_COLORS[bin];
}

export const wildfireriskStyle: LayerStyle = {
  color: "#D95F0E",
  icon: () => null,
  colorFor: wildfireriskColor,
  label: (f) => f.properties.name,
  labelMax: 12,
  polygons: (f) => ((f.properties.extra as WrcExtra | undefined)?.bin != null ? polyFills(f, wildfireriskColor(f), 0.55) : null),
  lines: (f) => {
    const ranked = (f.properties.extra as WrcExtra | undefined)?.bin != null;
    return polyOutlines(f, ranked ? "#1F2937" : WRC_NO_RANK_EDGE, ranked ? 0.45 : 0.85, 1, !ranked);
  },
};

// ---------------------------------------------------------------- housing assistance (HUD vouchers by tract, QCT titled 2026)

/** A published tract's bin colour; a suppressed tract's grey (never a scale colour); Connecticut's no-data edge. */
export function housingColor(f: LayerFeature): string {
  const x = f.properties.extra as HousingExtra | DdaExtra | LihtcExtra | undefined;
  if (!x) return HOUSING_NO_DATA_EDGE;
  if (x.kind === "qct") return QCT_EDGE;
  if (x.kind === "dda") return DDA_EDGE;
  if (x.kind === "lihtc") return LIHTC_COLOR;
  if (x.bin != null) return HOUSING_BIN_COLORS[x.bin];
  return x.status === "suppressed" ? HOUSING_SUPPRESSED_FILL : HOUSING_NO_DATA_EDGE;
}

export const housingStyle: LayerStyle = {
  color: "#0F766E",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? "#E5E7EB" : housingColor(f)),
  label: (f) => f.properties.name,
  labelMax: 0,
  // Tracts are named by GEOID only and DDAs by ZIP or county; nothing is labelled on the globe but a hovered or picked LIHTC property.
  labelWhen: () => false,
  pointSize: (f) => {
    const x = f.properties.extra as LihtcExtra | undefined;
    return x?.kind === "lihtc" ? LIHTC_POINT_SIZES[x.bin] : 6;
  },
  polygons: (f) => {
    const x = f.properties.extra as HousingExtra | DdaExtra | LihtcExtra | undefined;
    if (!x || x.kind === "qct" || x.kind === "dda" || x.kind === "lihtc") return null;
    if (x.bin != null) return polyFills(f, housingColor(f), 0.55);
    // Suppressed: a grey that is on no scale, lighter than any bin, so it reads as "few or none", not as low.
    if (x.status === "suppressed") return polyFills(f, HOUSING_SUPPRESSED_FILL, 0.3);
    return null;
  },
  lines: (f) => {
    if (isLoadedBox(f)) return polyOutlines(f, "#E5E7EB", 0.7, 1.5, true);
    const x = f.properties.extra as HousingExtra | DdaExtra | LihtcExtra | undefined;
    if (x?.kind === "qct") return polyOutlines(f, QCT_EDGE, 0.95, 2, true);
    if (x?.kind === "dda") return polyOutlines(f, DDA_EDGE, 0.95, 2, true);
    if (x?.kind === "lihtc") return null;
    const drawn = x?.bin != null;
    return polyOutlines(f, drawn ? "#1F2937" : HOUSING_NO_DATA_EDGE, drawn ? 0.3 : 0.85, 1, !drawn);
  },
};
