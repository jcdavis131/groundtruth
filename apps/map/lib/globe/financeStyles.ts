"use client";
// Styles for the banks and spending layers. Same approach as economyStyles:
// polygons filled from a small ramp, thin outlines, standing labels for the
// few largest features.

import type { MultiPolygon, Polygon } from "geojson";
import type { LayerStyle, StyledLine, StyledPolygon } from "./renderer";
import { fmtUsd } from "@/lib/economy/features";
import { perJobFill, type BranchExtra, type SpendingExtra } from "@/lib/finance/features";
import type { LayerFeature } from "@/lib/layers/types";
import { polyOutlines } from "./hazardStyles";

const BANKS = "#5EEAD4";
const SPENDING = "#FFD166";

function ringsOf(g: Polygon | MultiPolygon): number[][][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

function outlines(f: LayerFeature, color: string, alpha: number): StyledLine[] {
  if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") return [];
  return ringsOf(f.geometry)
    .map((poly) => poly[0])
    .filter((ring) => Array.isArray(ring) && ring.length > 2)
    .map((ring) => ({ positions: ring.map((c) => [c[0], c[1], 0] as [number, number, number]), color, alpha, width: 1 }));
}

function fills(f: LayerFeature, color: string, alpha: number): StyledPolygon[] {
  if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") return [];
  return ringsOf(f.geometry).map((rings) => ({ rings, color, alpha }));
}

/** Deposits booked at the office, dollars -> colour and point size. Offices the SOD does not list stay grey and small. */
export function depositTier(d: number | null | undefined): { color: string; size: number } {
  if (d == null) return { color: "#7A8A94", size: 4 };
  if (d < 25e6) return { color: "#9ADBD1", size: 5 };
  if (d < 100e6) return { color: BANKS, size: 6.5 };
  if (d < 500e6) return { color: "#2DD4BF", size: 8 };
  return { color: "#FFFFFF", size: 10 };
}

// The dashed box the bank offices were loaded for (lib/layers/banks.ts) is not an office.
const isBankBox = (f: LayerFeature) => f.properties.kind === "loaded-box";
const BANK_BOX = "#E5E7EB";

export const bankStyle: LayerStyle = {
  color: BANKS,
  icon: () => null,
  pointSize: (f) => (isBankBox(f) ? 0 : depositTier((f.properties.extra as BranchExtra).deposits).size),
  colorFor: (f) => (isBankBox(f) ? BANK_BOX : depositTier((f.properties.extra as BranchExtra).deposits).color),
  label: (f) => {
    if (isBankBox(f)) return f.properties.name;
    const x = f.properties.extra as BranchExtra;
    return x.deposits != null ? `${x.shortName} · ${fmtUsd(x.deposits)}` : x.shortName;
  },
  labelMax: 60,
  labelWhen: (f) => !isBankBox(f),
  labelAlways: (f) => !isBankBox(f) && !!(f.properties.extra as BranchExtra).labelled,
  lines: (f) => (isBankBox(f) ? polyOutlines(f, BANK_BOX, 0.7, 1.5, true) : null),
  // Full size when hovering a town, a speck from 300 km so a city reads as a cluster.
  scaleByDistance: [2e4, 1.0, 3e5, 0.45],
  translucencyByDistance: [1.5e5, 1.0, 3.2e5, 0.55],
};

export const spendingStyle: LayerStyle = {
  color: SPENDING,
  icon: () => null,
  label: (f) => {
    const x = f.properties.extra as SpendingExtra;
    const total = fmtUsd(x.obligations.total);
    return x.perJob ? `${f.properties.name} · ${total} · ${fmtUsd(x.perJob.value)}/job` : `${f.properties.name} · ${total}`;
  },
  labelMax: 40,
  labelAlways: (f) => !!(f.properties.extra as SpendingExtra).labelled,
  // Below the jobs label of the same county (home values sit above, jobs below the anchor).
  labelOffset: [14, 36],
  colorFor: (f) => perJobFill((f.properties.extra as SpendingExtra).perJob?.value)[0],
  polygons: (f) => {
    const [color, alpha] = perJobFill((f.properties.extra as SpendingExtra).perJob?.value);
    return fills(f, color, alpha);
  },
  lines: (f) => outlines(f, SPENDING, 0.18),
};
