"use client";
// Dossier asides for the trade, commerce and real-estate layers: traces,
// sector mix, port volumes, crossing counts, trading partners.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRenderer } from "@/lib/globe/registry";
import type { LayerFeature } from "@/lib/layers/types";
import { affordability } from "@/lib/economy/estimates";
import { fmtNum, fmtPct, fmtUsd, monthLabel, type AreaExtra, type CountryExtra, type CrossingExtra, type MsaExtra, type MsaJobs, type MsaOccupation, type Partners, type PortExtra, type SectorRow } from "@/lib/economy/features";
import type { PulseItem } from "@/lib/economy/sources";
import SeriesChart from "./SeriesChart";

const usd0 = (v: number) => fmtUsd(v);
const num0 = (v: number) => fmtNum(v);

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${url}`);
  return j;
}

export function usePulse(enabled = true) {
  return useQuery({
    queryKey: ["economy-pulse"],
    queryFn: () => getJson<{ data: PulseItem[] }>("/api/economy?op=pulse").then((j) => j.data),
    staleTime: 30 * 60_000,
    enabled,
  });
}

export interface AreaContext {
  period?: string;
  sectors: SectorRow[];
  metroHome?: { name: string; latest: number; yoyPct: number | null; yearly: Array<[string, number]> } | null;
  usHome?: { latest: number; yoyPct: number | null; yearly: Array<[string, number]> } | null;
  stateHome?: { name: string; latest: number; yoyPct: number | null } | null;
}

export function useAreaContext(fips: string | null) {
  return useQuery({
    queryKey: ["economy-context", fips],
    queryFn: () => getJson<{ data: AreaContext }>(`/api/economy?op=context&fips=${fips}`).then((j) => j.data),
    staleTime: 6 * 3600_000,
    enabled: !!fips,
  });
}

export interface MsaJobsEnvelope {
  asOf: string;
  source: string;
  data: MsaJobs;
}

export function useMsaJobs(msa: string | null) {
  return useQuery({
    queryKey: ["economy-msa-jobs", msa],
    queryFn: () => getJson<{ data: MsaJobsEnvelope }>(`/api/economy?op=msa-jobs&msa=${msa}`).then((j) => j.data),
    staleTime: 24 * 3600_000,
    enabled: !!msa,
  });
}

/** City dossier for the occupations layer: what people do for a living here. */
function OccupationsAside({ x }: { x: MsaExtra }) {
  const q = useMsaJobs(x.msa);
  const jobs = q.data?.data;
  const asOf = q.data?.asOf;
  const byEmp = jobs?.top.slice(0, 10) ?? [];
  const concentrated = [...(jobs?.top ?? [])]
    .filter((o) => o.lq != null && o.e >= 1000)
    .sort((a, b) => (b.lq ?? 0) - (a.lq ?? 0))
    .slice(0, 5);
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="hud-label">Occupation mix · {x.name}</span>
        <span className="text-[9px] text-muted-foreground">{asOf ? `OEWS ${asOf}` : "OEWS"}</span>
      </div>
      {x.domLq != null && (
        <div className="mt-0.5 text-[10px] leading-snug text-foreground/85">
          Most distinctive here: <span className="font-medium">{x.domT}</span> at {x.domLq.toFixed(2)}× the national share.
        </div>
      )}
      {q.isLoading && <div className="mt-1 text-[9px] text-muted-foreground">loading occupation mix…</div>}
      {q.error && <div className="mt-1 text-[9px] text-muted-foreground">occupation mix unavailable: {(q.error as Error).message.slice(0, 60)}</div>}
      {byEmp.length > 0 && (
        <table className="mt-1 w-full text-[9px] leading-tight">
          <tbody>
            {byEmp.map((o: MsaOccupation) => (
              <tr key={o.c} className="align-baseline">
                <td className="truncate pr-1 text-foreground/85" title={`${o.t} (${o.c})`}>
                  {o.t}
                </td>
                <td className="whitespace-nowrap text-right tabular-nums">{fmtNum(o.e)}</td>
                <td className="whitespace-nowrap pl-2 text-right tabular-nums text-muted-foreground">{o.w != null ? `${fmtUsd(o.w)}/yr` : ""}</td>
                <td className="whitespace-nowrap pl-2 text-right tabular-nums text-muted-foreground">{o.lq != null ? `${o.lq.toFixed(2)}×` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {concentrated.length > 0 && (
        <div className="mt-1 text-[9px] leading-snug text-muted-foreground">
          Concentrated here (location quotient vs the nation): {concentrated.map((o) => `${o.t} ${o.lq!.toFixed(1)}×`).join(", ")}
        </div>
      )}
      <div className="mt-1 text-[9px] leading-snug text-muted-foreground/80">
        BLS Occupational Employment and Wage Statistics, May 2025; SOC codes are the shared O*NET taxonomy, so a role means the same thing in every city.
      </div>
    </div>
  );
}

export default function EconomyAside({ feature }: { feature: LayerFeature }) {
  const p = feature.properties;
  if (p.layer === "realestate") return <HomeAside x={p.extra as AreaExtra} />;
  if (p.layer === "commerce") return <JobsAside x={p.extra as AreaExtra} />;
  if (p.layer === "occupations") return <OccupationsAside x={p.extra as MsaExtra} />;
  if (p.layer === "trade") {
    if (p.kind === "port") return <PortAside x={p.extra as PortExtra} />;
    if (p.kind === "crossing") return <CrossingAside x={p.extra as CrossingExtra} />;
    if (p.kind === "country") return <CountryAside feature={feature} />;
  }
  return null;
}

function contextFips(x: AreaExtra): string | null {
  return x.level === "county" ? x.geoid : `${x.geoid}000`;
}

function HomeAside({ x }: { x: AreaExtra }) {
  const pulse = usePulse();
  const ctx = useAreaContext(contextFips(x));
  const home = x.home;
  if (!home) return null;
  const rate = pulse.data?.find((i) => i.id === "MORTGAGE30US");
  const est = affordability(home, x.rent, x.jobs, rate ? { value: rate.value, date: rate.date } : undefined);
  const ref = ctx.data?.usHome ? { value: ctx.data.usHome.latest, label: "US" } : undefined;
  return (
    <>
      <SeriesChart title={`typical home · ${home.yearly[0]?.[0].slice(0, 4)}–${home.asOf.slice(0, 4)}`} rows={home.yearly} color="#F472B6" fmt={usd0} reference={ref} note="Zillow ZHVI, same month each year. A model estimate of the typical home, not sale prices." />
      {x.rent && <SeriesChart title="typical rent · 25 months" rows={x.rent.monthly} color="#F9A8D4" fmt={usd0} note="Zillow ZORI, smoothed, all homes plus multifamily." />}
      {ctx.data && (ctx.data.metroHome || ctx.data.stateHome) && (
        <div className="border-t border-border/60 px-3 py-2 text-[10px] leading-snug text-foreground/85">
          {ctx.data.metroHome && (
            <div>
              metro {ctx.data.metroHome.name}: {fmtUsd(ctx.data.metroHome.latest)} ({fmtPct(ctx.data.metroHome.yoyPct)} 1-yr)
            </div>
          )}
          {ctx.data.stateHome && x.level === "county" && (
            <div>
              {ctx.data.stateHome.name}: {fmtUsd(ctx.data.stateHome.latest)} ({fmtPct(ctx.data.stateHome.yoyPct)} 1-yr)
            </div>
          )}
          {ctx.data.usHome && (
            <div>
              United States: {fmtUsd(ctx.data.usHome.latest)} ({fmtPct(ctx.data.usHome.yoyPct)} 1-yr)
            </div>
          )}
        </div>
      )}
      <div className="border-t border-border/60 px-3 py-2">
        <div className="hud-label">
          Mortgage vs wages <span className="text-warn">ESTIMATE</span>
        </div>
        {est ? (
          <>
            <div className="mt-0.5 text-[11px] text-foreground/90">
              {fmtUsd(est.payment)}/mo principal &amp; interest at {est.ratePct.toFixed(2)}%
              {est.wageSharePct != null ? ` · ${est.wageSharePct.toFixed(0)}% of one average job's pay` : ""}
              {est.yearsOfWages != null ? ` · ${est.yearsOfWages.toFixed(1)} years of wages` : ""}
              {est.priceToRent != null ? ` · price-to-rent ${est.priceToRent.toFixed(1)}` : ""}
            </div>
            <ul className="mt-1 space-y-0.5 text-[9px] leading-snug text-muted-foreground">
              {est.formula.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        ) : (
          <div className="text-[9px] text-muted-foreground">{pulse.isLoading ? "loading this week's mortgage rate…" : "mortgage rate unavailable (FRED), no payment estimate"}</div>
        )}
      </div>
    </>
  );
}

function JobsAside({ x }: { x: AreaExtra }) {
  const ctx = useAreaContext(contextFips(x));
  const j = x.jobs;
  if (!j) return null;
  const sectors = ctx.data?.sectors ?? [];
  const byLq = [...sectors].filter((s) => s.lq != null && (s.emp ?? 0) >= 100).sort((a, b) => (b.lq ?? 0) - (a.lq ?? 0)).slice(0, 5);
  const byEmp = sectors.slice(0, 6);
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="hud-label">Sector mix · private jobs</span>
        <span className="text-[9px] text-muted-foreground">{ctx.data?.period ?? j.period}</span>
      </div>
      {ctx.isLoading && <div className="text-[9px] text-muted-foreground">loading NAICS sectors…</div>}
      {ctx.error && <div className="text-[9px] text-muted-foreground">sector mix unavailable: {(ctx.error as Error).message.slice(0, 60)}</div>}
      {byEmp.length > 0 && (
        <table className="mt-1 w-full text-[9px] leading-tight">
          <tbody>
            {byEmp.map((s) => (
              <tr key={s.code} className="align-baseline">
                <td className="truncate pr-1 text-foreground/85" title={s.title}>
                  {s.title}
                </td>
                <td className="whitespace-nowrap text-right tabular-nums">{s.suppressed ? "withheld" : fmtNum(s.emp)}</td>
                <td className="whitespace-nowrap pl-2 text-right tabular-nums text-muted-foreground">{s.avgWeeklyWage != null ? `${fmtUsd(s.avgWeeklyWage)}/wk` : ""}</td>
                <td className="whitespace-nowrap pl-2 text-right tabular-nums text-muted-foreground">{s.yoyEmp != null ? fmtPct(s.yoyEmp) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {byLq.length > 0 && (
        <div className="mt-1 text-[9px] leading-snug text-muted-foreground">
          Concentrated here (location quotient vs the nation): {byLq.map((s) => `${s.title} ${s.lq!.toFixed(1)}×`).join(", ")}
        </div>
      )}
      <div className="mt-1 text-[9px] leading-snug text-muted-foreground/80">BLS QCEW, private ownership, NAICS sectors; jobs are the quarter&apos;s third-month employment; withheld cells stay blank.</div>
    </div>
  );
}

function PortAside({ x }: { x: PortExtra }) {
  const s = x.stats;
  if (!s) return null;
  return (
    <>
      {s.container && s.container.series.length > 1 && (
        <SeriesChart title={`container TEU by year · rank #${s.container.ranking ?? "?"} US`} rows={s.container.series.map(([y, v]) => [String(y), v])} color="#FFD08A" fmt={num0} bars note={`${fmtNum(s.container.imports)} import, ${fmtNum(s.container.exports)} export, ${fmtNum(s.container.empty)} empty TEU in ${s.year}`} />
      )}
      {s.tonnage && s.tonnage.series.length > 1 && (
        <SeriesChart title={`total tonnage by year · rank #${s.tonnage.ranking ?? "?"} US`} rows={s.tonnage.series.map(([y, v]) => [String(y), v])} color="#FFB454" fmt={num0} bars note={`${fmtNum(s.tonnage.foreign)} foreign, ${fmtNum(s.tonnage.domestic)} domestic short tons in ${s.year}`} />
      )}
      {(s.topCommodities.length > 0 || s.topFarm.length > 0 || s.vesselCalls.length > 0) && (
        <div className="border-t border-border/60 px-3 py-2 text-[9px] leading-snug text-muted-foreground">
          {s.topCommodities.length > 0 && <div>top cargo {s.year}: {s.topCommodities.map(([n, v]) => `${n} ${fmtNum(v)} t`).join(", ")}</div>}
          {s.topFarm.length > 0 && <div>farm & food: {s.topFarm.map(([n, v]) => `${n} ${fmtNum(v)} t`).join(", ")}</div>}
          {s.vesselCalls.length > 0 && <div>vessel calls: {s.vesselCalls.map(([n, v]) => `${n} ${fmtNum(v)}`).join(", ")}</div>}
          <div className="mt-1 text-muted-foreground/80">BTS Port Performance Freight Statistics, {s.name}; position: {s.position}.</div>
        </div>
      )}
    </>
  );
}

function CrossingAside({ x }: { x: CrossingExtra }) {
  const t = x.measures.Trucks;
  const pv = x.measures["Personal Vehicles"];
  const ped = x.measures.Pedestrians;
  return (
    <>
      {t && t.series.length > 1 && <SeriesChart title="trucks per month · 25 months" rows={t.series.map(([m, v]) => [monthLabel(m + "-01"), v])} color="#FFB454" fmt={num0} note={`${fmtNum(t.latest)} in ${monthLabel(t.latestDate + "-01")}, ${fmtPct(t.yoyPct)} vs a year earlier`} />}
      {pv && pv.series.length > 1 && <SeriesChart title="personal vehicles per month" rows={pv.series.map(([m, v]) => [monthLabel(m + "-01"), v])} color="#E0A050" fmt={num0} />}
      {ped && ped.series.length > 1 && <SeriesChart title="pedestrians per month" rows={ped.series.map(([m, v]) => [monthLabel(m + "-01"), v])} color="#B08A50" fmt={num0} />}
      <div className="px-3 pb-2 text-[9px] leading-snug text-muted-foreground/80">BTS Border Crossing Entry Data (US Customs and Border Protection inbound counts), {x.border}.</div>
    </>
  );
}

/** Hand the partners to the renderer's copy of the feature so the style can draw the arcs. */
function attachPartners(id: string, partners: Partners) {
  const r = getRenderer("trade");
  const f = r?.getFeature(id);
  if (!f) return;
  (f.properties.extra as CountryExtra).partners = partners;
  r!.refreshSelectedLines();
}

function CountryAside({ feature }: { feature: LayerFeature }) {
  const x = feature.properties.extra as CountryExtra;
  const q = useQuery({
    queryKey: ["partners", x.iso3],
    queryFn: () => getJson<{ data: Partners | null }>(`/api/economy?op=partners&iso3=${x.iso3}`).then((j) => j.data),
    staleTime: 24 * 3600_000,
  });
  const featureId = feature.properties.id;
  useEffect(() => {
    if (q.data) attachPartners(featureId, q.data);
  }, [q.data, featureId]);
  const p = q.data;
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="hud-label">Trading partners</span>
        <span className="text-[9px] text-muted-foreground">{p ? `WITS ${p.year}` : ""}</span>
      </div>
      {q.isLoading && <div className="text-[9px] text-muted-foreground">loading partners…</div>}
      {q.error && <div className="text-[9px] text-muted-foreground">partners unavailable: {(q.error as Error).message.slice(0, 60)}</div>}
      {p === null && !q.isLoading && <div className="text-[9px] text-muted-foreground">WITS publishes no partner table for this country.</div>}
      {p && (
        <div className="mt-1 grid grid-cols-2 gap-x-3 text-[9px] leading-snug">
          <div>
            <div className="text-[#FFB454]">exports {p.exportsTotal != null ? fmtUsd(p.exportsTotal * 1000) : ""}</div>
            {p.exports.slice(0, 8).map((t) => (
              <div key={t.iso3} className="flex justify-between gap-1 tabular-nums">
                <span className="truncate">{t.name}</span>
                <span className="text-muted-foreground">{t.sharePct != null ? `${t.sharePct.toFixed(0)}%` : fmtUsd(t.value * 1000)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="text-[#4DD8FF]">imports {p.importsTotal != null ? fmtUsd(p.importsTotal * 1000) : ""}</div>
            {p.imports.slice(0, 8).map((t) => (
              <div key={t.iso3} className="flex justify-between gap-1 tabular-nums">
                <span className="truncate">{t.name}</span>
                <span className="text-muted-foreground">{t.sharePct != null ? `${t.sharePct.toFixed(0)}%` : fmtUsd(t.value * 1000)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-1 text-[9px] leading-snug text-muted-foreground/80">Arcs on the globe: amber out to export markets, cyan in from import sources, width by share. World Bank WITS TradeStats, goods, latest year published.</div>
    </div>
  );
}
