"use client";
// Dossier asides for the banks and spending layers: an institution's
// quarterly ratios and its county's deposit market; a county's obligations
// by award family, the per-job estimate with its formula, who received the
// money and from which agencies, and a six-year trace. Every panel has a
// copy-citations button that puts one line per source on the clipboard.

import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import type { LayerFeature } from "@/lib/layers/types";
import { fmtNum, fmtUsd } from "@/lib/economy/features";
import type { Provenance } from "@/lib/provenance/types";
import { citationsOf } from "@/lib/provenance/collect";
import type { Series } from "@/lib/series/types";
import { AWARD_GROUP_IDS, AWARD_GROUPS, type BankProfile, type CountyDeposits, type SpendingDetail } from "@/lib/finance/types";
import type { BranchExtra, SpendingExtra } from "@/lib/finance/features";
import SeriesChart from "./SeriesChart";

interface Envelope<T> {
  data: T;
  provenance: Provenance[];
  generatedAt: string;
  caveats?: string[];
}

async function getJson<T>(url: string): Promise<Envelope<T>> {
  const r = await fetch(url);
  const j = (await r.json()) as Envelope<T> & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${url}`);
  return j;
}

export function useBankProfile(cert: number | null) {
  return useQuery({
    queryKey: ["finance-bank", cert],
    queryFn: () => getJson<BankProfile>(`/api/finance?op=bank&cert=${cert}`),
    staleTime: 6 * 3600_000,
    enabled: cert != null,
  });
}

export function useCountyDeposits(fips: string | null) {
  return useQuery({
    queryKey: ["finance-deposits", fips],
    queryFn: () => getJson<CountyDeposits>(`/api/finance?op=deposits&fips=${fips}`),
    staleTime: 24 * 3600_000,
    enabled: !!fips,
  });
}

export function useSpendingDetail(fips: string | null, fy?: number) {
  return useQuery({
    queryKey: ["finance-spending-detail", fips, fy ?? null],
    queryFn: () => getJson<SpendingDetail>(`/api/finance?op=spending-detail&fips=${fips}${fy ? `&fy=${fy}` : ""}`),
    staleTime: 12 * 3600_000,
    enabled: !!fips,
  });
}

/** Dispatcher for InfoPanel: one aside per finance layer, null for anything else. */
export default function FinanceAside({ feature }: { feature: LayerFeature }) {
  const p = feature.properties;
  if (p.layer === "banks" && p.kind === "branch") return <BankAside x={p.extra as BranchExtra} />;
  if (p.layer === "spending" && (p.kind === "county" || p.kind === "state")) return <SpendingAside x={p.extra as SpendingExtra} />;
  return null;
}

function CopyCitations({ provenance, what }: { provenance: Provenance[]; what: string }) {
  const lines = citationsOf(provenance);
  if (!lines.length) return null;
  const copy = () => {
    navigator.clipboard
      .writeText(lines.join("\n"))
      .then(() => useGlobe.getState().pushLog({ level: "info", text: `Copied ${lines.length} citation line${lines.length === 1 ? "" : "s"} for ${what}` }))
      .catch(() => useGlobe.getState().pushLog({ level: "warn", text: "Clipboard unavailable; citations are in the API response" }));
  };
  return (
    <div className="flex justify-end border-t border-border/60 px-3 py-1.5">
      <button type="button" onClick={copy} className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-muted-foreground hover:text-primary" title={lines.join("\n")}>
        <Copy className="size-3" /> copy {lines.length} citation{lines.length === 1 ? "" : "s"}
      </button>
    </div>
  );
}

/** [YYYY-MM, value] rows for a chart, dropping withheld quarters. */
function seriesRows(s: Series | undefined): Array<[string, number]> {
  if (!s) return [];
  return s.points.filter((p): p is { t: number; v: number } => p.v != null).map((p) => [new Date(p.t).toISOString().slice(0, 7), p.v]);
}

const BKCLASS: Record<string, string> = {
  N: "national bank (OCC)",
  SM: "state bank, Fed member",
  NM: "state bank, non-member (FDIC)",
  SB: "savings bank",
  SA: "savings association (OCC)",
  OI: "insured US branch of a foreign bank",
};

const pct2 = (v: number) => `${v.toFixed(2)}%`;
const usdK = (v: number) => fmtUsd(v * 1000);

function BankAside({ x }: { x: BranchExtra }) {
  const prof = useBankProfile(x.cert);
  const dep = useCountyDeposits(x.fips);
  const inst = prof.data?.data.institution ?? null;
  const series = prof.data?.data.series ?? [];
  const find = (key: string) => series.find((s) => s.id.endsWith(`:${key}`));
  const roa = seriesRows(find("roa"));
  const npl = seriesRows(find("noncurrentPct"));
  const deposits = seriesRows(find("deposits"));
  const d = dep.data?.data ?? null;
  const share = d?.top.find((b) => b.cert === x.cert);
  const provenance = [...(prof.data?.provenance ?? []), ...(dep.data?.provenance ?? [])];
  return (
    <>
      <div className="border-t border-border/60 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="hud-label">Institution</span>
          <span className="text-[9px] text-muted-foreground">{inst?.reportDate ? `FDIC as of ${inst.reportDate}` : ""}</span>
        </div>
        {prof.isLoading && <div className="text-[9px] text-muted-foreground">loading FDIC profile…</div>}
        {prof.error && <div className="text-[9px] text-muted-foreground">profile unavailable: {(prof.error as Error).message.slice(0, 60)}</div>}
        {inst && (
          <div className="mt-0.5 text-[10px] leading-snug text-foreground/90">
            <div>
              {inst.name}, {inst.city}, {inst.state} · cert {inst.cert}
              {!inst.active && <span className="ml-1 text-warn">INACTIVE</span>}
            </div>
            <div className="text-muted-foreground">
              assets {usdK(inst.assets ?? NaN)} · deposits {usdK(inst.deposits ?? NaN)} · {inst.offices != null ? `${fmtNum(inst.offices)} offices` : "offices n/a"}
              {inst.multiState ? " in several states" : ""}
            </div>
            <div className="text-muted-foreground">
              ROA {inst.roa != null ? pct2(inst.roa) : "n/a"} · ROE {inst.roe != null ? pct2(inst.roe) : "n/a"} · net income YTD {usdK(inst.netIncome ?? NaN)} · {BKCLASS[inst.bkClass] ?? inst.bkClass}
            </div>
          </div>
        )}
      </div>
      {roa.length > 1 && <SeriesChart title="return on assets · quarterly" rows={roa} color="#5EEAD4" fmt={pct2} note="FDIC financials, annualised year-to-date ROA as reported each quarter." />}
      {npl.length > 1 && <SeriesChart title="noncurrent loans / total loans" rows={npl} color="#FFB454" fmt={pct2} note="Loans 90+ days past due or in nonaccrual, percent of total loans and leases." />}
      {deposits.length > 1 && <SeriesChart title="total deposits · quarterly" rows={deposits} color="#9ADBD1" fmt={usdK} />}
      <div className="border-t border-border/60 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="hud-label">
            County deposit market <span className="text-warn">ESTIMATE</span>
          </span>
          <span className="text-[9px] text-muted-foreground">{d ? `SOD June ${d.year}` : ""}</span>
        </div>
        {dep.isLoading && <div className="text-[9px] text-muted-foreground">loading Summary of Deposits…</div>}
        {dep.error && <div className="text-[9px] text-muted-foreground">deposit market unavailable: {(dep.error as Error).message.slice(0, 60)}</div>}
        {d && (
          <>
            <div className="mt-0.5 text-[10px] leading-snug text-foreground/90">
              {d.county ?? x.fips}
              {d.state ? `, ${d.state}` : ""}: {fmtUsd(d.total)} at {fmtNum(d.branches)} offices of {fmtNum(d.banks)} banks
              {share ? ` · this bank ${share.sharePct.toFixed(1)}% (${fmtUsd(share.deposits)}, ${share.branches} office${share.branches === 1 ? "" : "s"})` : ""}
            </div>
            {d.hhi && (
              <div className="mt-0.5 text-[10px] text-foreground/90">
                HHI {Math.round(d.hhi.value).toLocaleString()} · {d.hhi.label}
              </div>
            )}
            <table className="mt-1 w-full text-[9px] leading-tight">
              <tbody>
                {d.top.slice(0, 6).map((b) => (
                  <tr key={b.cert} className={b.cert === x.cert ? "text-primary" : ""}>
                    <td className="truncate pr-1" title={b.name}>
                      {b.name}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">{fmtUsd(b.deposits)}</td>
                    <td className="whitespace-nowrap pl-2 text-right tabular-nums text-muted-foreground">{b.sharePct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.hhi && <div className="mt-1 text-[9px] leading-snug text-muted-foreground">{d.hhi.formula}</div>}
            <div className="mt-1 text-[9px] leading-snug text-muted-foreground/80">FDIC Summary of Deposits, deposits by office as of June 30; HHI thresholds from the DOJ 1995 bank merger screen (1000 / 1800). Not lending or investment advice.</div>
          </>
        )}
      </div>
      <CopyCitations provenance={provenance} what={x.shortName} />
    </>
  );
}

function CategoryList({ title, rows, total }: { title: string; rows: Array<{ name: string; amount: number; code: string | null }>; total: number | null }) {
  if (!rows.length) return null;
  return (
    <div className="mt-1">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{title}</div>
      <table className="w-full text-[9px] leading-tight">
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.code ?? ""}:${r.name}:${i}`} className="align-baseline">
              <td className="truncate pr-1 text-foreground/85" title={r.code ? `${r.code} ${r.name}` : r.name}>
                {r.code && title === "NAICS" ? `${r.code} ` : ""}
                {r.name}
              </td>
              <td className="whitespace-nowrap text-right tabular-nums">{fmtUsd(r.amount)}</td>
              <td className="whitespace-nowrap pl-2 text-right tabular-nums text-muted-foreground">{total && total > 0 ? `${((r.amount / total) * 100).toFixed(0)}%` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpendingAside({ x }: { x: SpendingExtra }) {
  const fips = x.level === "county" ? x.geoid : null;
  const detail = useSpendingDetail(fips, x.obligations.fy);
  const o = x.obligations;
  const d = detail.data?.data ?? null;
  const provenance = detail.data?.provenance ?? [];
  return (
    <>
      <div className="border-t border-border/60 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="hud-label">Obligations by award family</span>
          <span className="text-[9px] text-muted-foreground">FY{o.fy}</span>
        </div>
        <table className="mt-1 w-full text-[9px] leading-tight">
          <tbody>
            {AWARD_GROUP_IDS.map((g) => {
              const v = o.byGroup[g];
              return (
                <tr key={g}>
                  <td className="pr-1 text-foreground/85">{AWARD_GROUPS[g].label}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{v == null ? "did not answer" : fmtUsd(v)}</td>
                  <td className="whitespace-nowrap pl-2 text-right tabular-nums text-muted-foreground">{v != null && o.total ? `${((v / o.total) * 100).toFixed(0)}%` : ""}</td>
                </tr>
              );
            })}
            <tr className="text-foreground">
              <td className="pr-1">total</td>
              <td className="whitespace-nowrap text-right tabular-nums">{fmtUsd(o.total)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        {x.toDate && (
          <div className="mt-1 text-[9px] text-muted-foreground">
            FY{x.toDate.fy} to date: {x.toDate.total == null ? "no row yet" : fmtUsd(x.toDate.total)} through {x.toDate.through}
          </div>
        )}
      </div>
      <div className="border-t border-border/60 px-3 py-2">
        <div className="hud-label">
          Dollars per job <span className="text-warn">ESTIMATE</span>
        </div>
        {x.perJob ? (
          <>
            <div className="mt-0.5 text-[11px] text-foreground/90">{fmtUsd(x.perJob.value)} per covered job</div>
            <div className="mt-0.5 text-[9px] leading-snug text-muted-foreground">{x.perJob.formula}</div>
          </>
        ) : (
          <div className="text-[9px] text-muted-foreground">{x.jobs?.suppressed ? "BLS withholds this area's employment, so no per-job figure" : "no QCEW employment for this area"}</div>
        )}
        <div className="mt-1 text-[9px] leading-snug text-muted-foreground/80">Obligations are what agencies committed in the year, not outlays, by place of performance. Jobs are BLS QCEW third-month employment, all ownerships, so federal employees count too.</div>
      </div>
      {fips && (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="hud-label">Who received it</span>
            <span className="text-[9px] text-muted-foreground">{d ? `USAspending FY${d.fy}` : ""}</span>
          </div>
          {detail.isLoading && <div className="text-[9px] text-muted-foreground">loading recipients and agencies…</div>}
          {detail.error && <div className="text-[9px] text-muted-foreground">detail unavailable: {(detail.error as Error).message.slice(0, 60)}</div>}
          {d && (
            <>
              <CategoryList title="Top recipients" rows={d.recipients.slice(0, 8)} total={o.total} />
              <CategoryList title="Awarding agencies" rows={d.agencies.slice(0, 5)} total={o.total} />
              <CategoryList title="NAICS" rows={d.naics.slice(0, 5)} total={o.byGroup.contracts} />
              <div className="mt-1 text-[9px] leading-snug text-muted-foreground/80">Recipients are legal entities as registered in SAM.gov. NAICS covers contracts only.</div>
            </>
          )}
        </div>
      )}
      {d && d.overTime.length > 1 && <SeriesChart title="obligations by fiscal year" rows={d.overTime.map((r) => [`FY${r.fy}`, r.amount])} color="#FFD166" fmt={(v) => fmtUsd(v)} bars note="All award families, place of performance in this county." />}
      <CopyCitations provenance={provenance} what={x.name} />
    </>
  );
}
