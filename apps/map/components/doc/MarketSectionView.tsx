// A MarketSection from lib/economy/report.ts, laid out as a document section.
//
// MarketSection predates the place pages and carries `loaded: boolean` rather
// than a SectionState, so the default mapping here is loaded -> "current" and
// not-loaded -> "unavailable". A caller that has the real SectionState from
// lib/places/facts.ts — which can tell a stale cache hit from a cold failure,
// something a boolean cannot — passes it explicitly and it wins.
//
// The items are a table rather than the HUD's clickable rows: there is no
// globe to select anything on, and the page ships no event handlers.

import type { MarketSection } from "@/lib/economy/report";
import type { PeerStat } from "@/lib/places/percentiles";
import type { ReactNode } from "react";
import type { SectionState } from "@/lib/places/facts";
import { num } from "@/lib/brief/format";
import FactTable, { type FactRow } from "./FactTable";
import Section from "./Section";
import { PeerLine, type ValueFormatter } from "./Stat";

/** An anchor a reader can paste, derived from the title the report already wrote. */
function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const COLUMNS = [
  { key: "name", label: "Item" },
  { key: "value", label: "Value", align: "right" as const },
  { key: "distance", label: "Distance", align: "right" as const },
];

export interface MarketSectionViewProps<T> {
  section: MarketSection<T>;
  /** Cohort position for the section's headline metric, when the page has one. */
  peers?: PeerStat[];
  peerFormat?: ValueFormatter;
  /** Anchor id; defaults to a slug of the section title supplied by the caller. */
  id?: string;
  /** Authoritative section state from the loader. Overrides the `loaded` boolean. */
  state?: SectionState;
  retrievedAt?: string;
  asOf?: string | null;
  children?: ReactNode;
}

export default function MarketSectionView<T>({
  section,
  peers,
  peerFormat,
  id,
  state,
  retrievedAt = "",
  asOf = null,
  children,
}: MarketSectionViewProps<T>) {
  const resolved: SectionState = state ?? {
    status: section.loaded ? "fresh" : "unavailable",
    asOf,
    retrievedAt,
    ...(section.loaded ? {} : { reason: "this source was not loaded for this page" }),
  };
  const rows: FactRow[] = section.items.map((it) => ({
    key: it.id,
    cells: [it.name, it.value, it.distanceKm != null ? `${num(it.distanceKm)} km` : ""],
  }));
  return (
    <Section id={id ?? slug(section.title)} title={section.title} state={resolved} summary={section.summary} basis={section.basis}>
      {peers && peers.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {peers.map((p) => (
            <PeerLine key={p.cohortKey} peer={p} format={peerFormat} />
          ))}
        </ul>
      ) : null}
      {rows.length > 0 ? <FactTable columns={COLUMNS} rows={rows} caption={section.basis} /> : null}
      {children}
    </Section>
  );
}
