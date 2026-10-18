// The finance section of the market report: who holds the county's
// deposits and how concentrated that is, and how much federal money lands
// there per job. Pure: it takes the aggregates the route (or the browser)
// already fetched and returns a section shaped like the other market report
// sections, so lib/economy/report.ts can splice it in.

import type { MarketItem, MarketSection } from "@/lib/economy/report";
import { fmtNum, fmtUsd } from "@/lib/economy/features";
import { dedupeProvenance } from "@/lib/provenance/collect";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { AWARD_GROUP_IDS, AWARD_GROUPS, type AreaObligations, type BankShare, type CategoryRow, type CountyDeposits, type Hhi, type PerJob, type ToDateObligations } from "./types";

export interface FinanceSpendingInput {
  obligations: AreaObligations;
  toDate?: ToDateObligations | null;
  perJob: PerJob | null;
  /** Provenance of the obligations table (and the QCEW row when a per-job figure exists). */
  provenance: Provenance[];
}

export interface FinanceInputs {
  /** Summary of Deposits aggregate for the county; null when FDIC has no rows, undefined when not fetched. */
  deposits?: CountyDeposits | null;
  spending?: FinanceSpendingInput | null;
  topRecipient?: CategoryRow | null;
  /** "Travis County, TX" for the item names; falls back to the FIPS. */
  areaName?: string;
  retrievedAt?: string;
}

export interface FinanceData {
  fips: string;
  deposits: { year: number; total: number; branches: number; banks: number; top: BankShare[]; hhi: Hhi | null } | null;
  spending: { fy: number; total: number | null; byGroup: AreaObligations["byGroup"]; toDate: ToDateObligations | null; perJob: PerJob | null; topRecipient: CategoryRow | null } | null;
}

export type FinanceSection = MarketSection<FinanceData>;

/** Assemble the finance section. `loaded` is false when neither input was fetched. */
export function financeSection(fips: string, input: FinanceInputs = {}): FinanceSection {
  const name = input.areaName ?? `county ${fips}`;
  const at = input.retrievedAt ?? new Date().toISOString();
  const d = input.deposits ?? null;
  const s = input.spending ?? null;
  const items: MarketItem[] = [];
  const parts: string[] = [];
  const prov: Array<Provenance[] | undefined> = [];

  if (d) {
    parts.push(`${fmtUsd(d.total)} in deposits at ${fmtNum(d.branches)} offices of ${fmtNum(d.banks)} banks (SOD June ${d.year})${d.hhi ? `; HHI ${Math.round(d.hhi.value).toLocaleString()}, ${d.hhi.label}` : ""}`);
    for (const b of d.top.slice(0, 3)) {
      items.push({ id: `bank:${b.cert}`, layer: "banks", name: b.name, value: `${fmtUsd(b.deposits)} · ${b.sharePct.toFixed(1)}% share · ${b.branches} office${b.branches === 1 ? "" : "s"}` });
    }
    prov.push(d.provenance);
  } else if (input.deposits === null) parts.push("FDIC publishes no Summary of Deposits rows for this county");

  if (s) {
    const o = s.obligations;
    const groups = AWARD_GROUP_IDS.filter((g) => o.byGroup[g] != null && o.byGroup[g]! > 0)
      .sort((a, b) => o.byGroup[b]! - o.byGroup[a]!)
      .slice(0, 2)
      .map((g) => `${AWARD_GROUPS[g].label} ${fmtUsd(o.byGroup[g])}`);
    parts.push(`${fmtUsd(o.total)} federal obligations in FY${o.fy}${groups.length ? ` (${groups.join(", ")})` : ""}${s.perJob ? `, ${fmtUsd(s.perJob.value)} per covered job` : ""}${s.toDate?.total != null ? `; FY${s.toDate.fy} to date ${fmtUsd(s.toDate.total)}` : ""}`);
    items.push({
      id: `county:${fips}`,
      layer: "spending",
      name,
      value: `${fmtUsd(o.total)} FY${o.fy}${s.perJob ? ` · ${fmtUsd(s.perJob.value)}/job` : ""}`,
      flag: s.perJob ? (s.perJob.value >= 40_000 ? "watch" : "ok") : undefined,
    });
    if (input.topRecipient) items.push({ id: `recipient:${input.topRecipient.id ?? input.topRecipient.name}`, layer: "spending", name: input.topRecipient.name, value: `${fmtUsd(input.topRecipient.amount)} · top recipient FY${o.fy}` });
    prov.push(s.provenance);
    if (s.perJob) prov.push([provenance(source("usaspending"), { kind: "estimate", method: s.perJob.formula, retrievedAt: at, notes: ["jobs from BLS QCEW, all ownerships, third month of the quarter"] })]);
  } else if (input.spending === null) parts.push("USAspending has no place-of-performance row for this county");

  const loaded = input.deposits !== undefined || input.spending !== undefined;
  return {
    title: "Banks & federal dollars",
    loaded,
    summary: loaded ? (parts.length ? parts.join(". ") : "No deposit or spending figures for this area") : "Finance layers not loaded",
    basis:
      "FDIC Summary of Deposits: deposits at every insured office as of June 30, annual; HHI is the sum of squared county deposit shares (DOJ 1995 bank merger screen: 1000 / 1800). USAspending: obligations by place of performance for the latest complete federal fiscal year (Oct 1 to Sep 30), what agencies committed, not what they paid out; recipients are legal entities. Per-job divides obligations by BLS QCEW covered employment.",
    provenance: dedupeProvenance(prov),
    items,
    data: {
      fips,
      deposits: d ? { year: d.year, total: d.total, branches: d.branches, banks: d.banks, top: d.top, hhi: d.hhi } : null,
      spending: s ? { fy: s.obligations.fy, total: s.obligations.total, byGroup: s.obligations.byGroup, toDate: s.toDate ?? null, perJob: s.perJob, topRecipient: input.topRecipient ?? null } : null,
    },
  };
}

/** Plain-text lines for the report download, matching marketReportText's style. */
export function financeSectionText(sec: FinanceSection): string[] {
  const lines = [`${sec.title.toUpperCase()}: ${sec.summary}`];
  for (const i of sec.items) lines.push(`  - ${i.name}: ${i.value}`);
  const pj = sec.data.spending?.perJob;
  if (pj) lines.push(`  ${pj.formula}`);
  const h = sec.data.deposits?.hhi;
  if (h) lines.push(`  ${h.formula}`);
  lines.push(`  basis: ${sec.basis}`);
  return lines;
}
