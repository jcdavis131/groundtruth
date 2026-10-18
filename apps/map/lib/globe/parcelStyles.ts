"use client";
// Parcels: thin lot lines in one colour (a tax map, so no fills and no
// colour scale that would read as a rating), and the dashed outline of the
// box they were loaded for. The identified parcel is drawn by
// lib/parcels/pick.ts's overlay, not here.

import type { LayerStyle } from "./renderer";
import type { LayerFeature } from "@/lib/layers/types";
import { polyOutlines } from "./hazardStyles";

const LOT_LINE = "#FBBF24";
const LOADED_BOX = "#E5E7EB";

const isLoadedBox = (f: LayerFeature) => f.properties.kind === "loaded-box";

export const parcelsStyle: LayerStyle = {
  color: LOT_LINE,
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : LOT_LINE),
  label: (f) => f.properties.name,
  // Hundreds of lots in a view: labels only on hover and selection.
  labelMax: 0,
  labelWhen: (f) => !isLoadedBox(f),
  lines: (f) => (isLoadedBox(f) ? polyOutlines(f, LOADED_BOX, 0.7, 1.5, true) : polyOutlines(f, LOT_LINE, 0.6, 1)),
};
