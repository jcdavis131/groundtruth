"use client";
// Style for the companies layer: a point coloured by sector (no building
// glyph exists in lib/globe/icons.ts yet; add one there and return it from
// `icon` to upgrade), labelled by ticker, larger for bigger filers.

import type { LayerStyle } from "./renderer";
import type { CompanyExtra } from "@/lib/companies/types";
import { SECTOR_COLOR } from "@/lib/companies/sectors";
import type { GicsSector } from "@/lib/companies/types";

const COMPANIES = "#7CC4FF";

function extra(f: Parameters<NonNullable<LayerStyle["label"]>>[0]): CompanyExtra | null {
  const x = f.properties.extra as CompanyExtra | undefined;
  return x && typeof x === "object" && "ticker" in x ? x : null;
}

/** Point radius from revenue: 5 px for small filers up to 11 px for the largest; unknown revenue stays small. */
export function companyPointSize(revenue: number | null | undefined): number {
  if (revenue == null || !Number.isFinite(revenue) || revenue <= 0) return 5;
  // log10 scale: $1B -> 6, $10B -> 7.5, $100B -> 9, $500B -> 10
  return Math.max(5, Math.min(11, 6 + 1.5 * (Math.log10(revenue) - 9)));
}

export const companiesStyle: LayerStyle = {
  color: COMPANIES,
  icon: () => null,
  colorFor: (f) => SECTOR_COLOR[(f.properties.kind as GicsSector | undefined) ?? "unclassified"] ?? COMPANIES,
  pointSize: (f) => companyPointSize(extra(f)?.facts.Revenues?.value),
  label: (f) => extra(f)?.ticker ?? f.properties.name,
  labelMax: 80,
  labelOffset: [10, -10],
  scaleByDistance: [5e4, 1.0, 3e6, 0.5],
  translucencyByDistance: [5e4, 1.0, 3e6, 0.7],
};
