// A ReportSection from lib/water/report.ts, laid out as a document section.
//
// The difference from MarketSectionView is the one that matters ethically and
// factually: a ReportSection carries radiusKm and n, and this component
// ALWAYS prints "within N km" and the count. lib/water searches discs —
// REPORT_RADII_KM is 150 km for reservoirs and 75 km for gauges and wells,
// and the fetch window is snapped outward to a half-degree grid — and there
// is no clip-to-polygon path anywhere in lib/water. Labelling a disc as a
// county result would be a false claim about every row in it, so the radius
// is part of the heading's subtitle and every row prints its own distance.

import type { ReportSection } from "@/lib/water/report";
import type { ReactNode } from "react";
import type { SectionState } from "@/lib/places/facts";
import { num } from "@/lib/brief/format";
import FactTable, { type FactRow } from "./FactTable";
import Section from "./Section";

/** An anchor a reader can paste, derived from the title the report already wrote. */
function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const COLUMNS = [
  { key: "name", label: "Site" },
  { key: "value", label: "Reading", align: "right" as const },
  { key: "distance", label: "Distance", align: "right" as const },
];

export interface WaterSectionViewProps<T> {
  section: ReportSection<T>;
  id?: string;
  state?: SectionState;
  retrievedAt?: string;
  asOf?: string | null;
  children?: ReactNode;
}

export default function WaterSectionView<T>({
  section,
  id,
  state,
  retrievedAt = "",
  asOf = null,
  children,
}: WaterSectionViewProps<T>) {
  const resolved: SectionState = state ?? {
    status: section.loaded ? "fresh" : "unavailable",
    asOf,
    retrievedAt,
    ...(section.loaded ? {} : { reason: "this source was not loaded for this page" }),
  };
  const rows: FactRow[] = section.items.map((it) => ({
    key: it.id,
    cells: [it.name, it.value, `${num(it.distanceKm)} km`],
  }));
  return (
    <Section id={id ?? slug(section.title)} title={section.title} state={resolved} summary={section.summary} basis={section.basis}>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        Sites found: {section.n}, searched within {section.radiusKm} km of this place&rsquo;s internal point. That is a disc
        around a point, not the area itself: sites outside the boundary are included, and sites inside it further than{" "}
        {section.radiusKm} km away are not.
      </p>
      {rows.length > 0 ? <FactTable columns={COLUMNS} rows={rows} caption={section.basis} /> : null}
      {children}
    </Section>
  );
}
