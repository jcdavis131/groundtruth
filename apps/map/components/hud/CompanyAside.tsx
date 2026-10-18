"use client";
// Dossier aside for a selected company feature: profile and registered
// business address, the sector / ETF bridge, latest annual facts with their
// periods, one small chart per concept, recent filings with links, and a
// copyable citation. Mounted by InfoPanel when feature.properties.layer is
// "companies". Fetches /api/companies?op=company (cached 12 h server-side).

import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import type { LayerFeature } from "@/lib/layers/types";
import type { Series } from "@/lib/series/types";
import type { Provenance } from "@/lib/provenance/types";
import type { CompanyExtra, CompanyProfile, ConceptKey, DerivedRatio, FactValue, Filing, SectorMapping } from "@/lib/companies/types";
import { CONCEPTS, fmtMoney } from "@/lib/companies/facts";
import { SECTOR_COLOR } from "@/lib/companies/sectors";
import { fmtNum } from "@/lib/economy/features";
import SeriesChart from "./SeriesChart";

export interface CompanyDossier {
  profile: CompanyProfile;
  sector: SectorMapping;
  hq: { countyFips: string | null; lon: number | null; lat: number | null; geo: string | null } | null;
  filings: Filing[];
  facts: Partial<Record<ConceptKey, FactValue | null>>;
  ratios: DerivedRatio[];
  series: Series[];
  citation: string;
}

interface DossierEnvelope {
  data: CompanyDossier;
  provenance: Provenance[];
  caveats?: string[];
  error?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${url}`);
  return j;
}

/** The live dossier for a CIK; shared by the aside and anything else that wants it. */
export function useCompanyDossier(cik: number | null) {
  return useQuery({
    queryKey: ["company", cik],
    queryFn: () => getJson<DossierEnvelope>(`/api/companies?op=company&cik=${cik}`),
    staleTime: 12 * 3600_000,
    enabled: cik != null,
  });
}

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => useGlobe.getState().pushLog({ level: "info", text: `${what} copied.` }),
    () => useGlobe.getState().pushLog({ level: "warn", text: "Clipboard blocked." }),
  );
}

/** Series points -> [year label, value] rows for SeriesChart. */
export function seriesRows(s: Series): Array<[string, number]> {
  return s.points.filter((p): p is { t: number; v: number } => p.v != null).map((p) => [new Date(p.t).toISOString().slice(0, 4), p.v]);
}

const CHART_KEYS: ConceptKey[] = ["Revenues", "NetIncomeLoss", "OperatingIncomeLoss", "Assets", "StockholdersEquity", "CashAndCashEquivalentsAtCarryingValue", "LongTermDebt"];

export default function CompanyAside({ feature }: { feature: LayerFeature }) {
  const x = feature.properties.extra as CompanyExtra;
  const q = useCompanyDossier(x?.cik ?? null);
  if (!x) return null;
  const color = SECTOR_COLOR[x.sector.gics];
  const d = q.data?.data;
  const facts = d?.facts ?? x.facts;
  const usedLive = !!d;
  return (
    <>
      <div className="border-t border-border/60 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="hud-label">Sector bridge</span>
          <span className="text-[9px] text-muted-foreground">convention, not advice</span>
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color }}>
          {x.sector.gicsTitle}
          {x.sector.etfs.length > 0 && <span className="ml-2 text-foreground/80">{x.sector.etfs.join(" · ")}</span>}
        </div>
        <div className="text-[9px] leading-snug text-muted-foreground">
          SIC {x.sic ?? "n/a"} {x.sicDescription ?? ""} · division {x.sector.division.code} {x.sector.division.title}
        </div>
      </div>

      {d && (
        <div className="border-t border-border/60 px-3 py-2 text-[10px] leading-snug">
          <div className="hud-label">Registered business address</div>
          <div className="text-foreground/90">
            {[d.profile.business?.street1, d.profile.business?.city, d.profile.business?.state, d.profile.business?.zip].filter(Boolean).join(", ") || "not published"}
          </div>
          <div className="text-[9px] text-muted-foreground">
            {d.profile.entityType ? `${d.profile.entityType} · ` : ""}
            incorporated {d.profile.stateOfIncorporation ?? "n/a"} · FYE {d.profile.fiscalYearEnd ? `${d.profile.fiscalYearEnd.slice(0, 2)}/${d.profile.fiscalYearEnd.slice(2)}` : "n/a"}
            {d.profile.tickers.length > 1 ? ` · also ${d.profile.tickers.filter((t) => t !== x.ticker).join(", ")}` : ""}
          </div>
        </div>
      )}

      <div className="border-t border-border/60 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="hud-label">Latest annual facts · XBRL</span>
          <span className="text-[9px] text-muted-foreground">{q.isLoading ? "loading EDGAR…" : usedLive ? "companyfacts" : x.pulled ? `snapshot ${x.pulled}` : "fixture (no facts yet)"}</span>
        </div>
        {q.error && <div className="text-[9px] text-muted-foreground">dossier unavailable: {(q.error as Error).message.slice(0, 80)}</div>}
        <table className="mt-1 w-full text-[9px] leading-tight">
          <tbody>
            {CONCEPTS.map((c) => {
              const v = facts[c.key];
              if (!v && c.optional) return null;
              return (
                <tr key={c.key} className="align-baseline">
                  <td className="pr-1 text-foreground/85">{c.label}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{v ? (c.unit === "USD" ? fmtMoney(v.value) : fmtNum(v.value)) : "not reported"}</td>
                  <td className="whitespace-nowrap pl-2 text-right tabular-nums text-muted-foreground">{v?.period ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {d && d.ratios.length > 0 && (
          <div className="mt-1 text-[9px] leading-snug text-muted-foreground">
            <span className="text-warn">ESTIMATE</span> {d.ratios.map((r) => `${r.label} ${r.value}${r.unit === "%" ? "%" : "×"} (${r.period})`).join(" · ")}
            <ul className="mt-0.5 space-y-0.5 text-muted-foreground/80">
              {d.ratios.map((r) => (
                <li key={r.key}>{r.formula}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {d?.series
        .filter((s) => CHART_KEYS.some((k) => s.id.endsWith(`:${k}`)))
        .map((s) => {
          const rows = seriesRows(s);
          const key = s.id.split(":").pop() as ConceptKey;
          const spec = CONCEPTS.find((c) => c.key === key);
          return <SeriesChart key={s.id} title={`${spec?.label ?? key} by fiscal year`} rows={rows} color={color} fmt={fmtMoney} bars note={`${s.provenance.seriesId}; 10-K family forms, restatements resolved by latest filing.`} />;
        })}

      {d && (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="hud-label">Recent filings</span>
            <span className="text-[9px] text-muted-foreground">10-K · 10-Q · 8-K</span>
          </div>
          {d.filings.length === 0 && <div className="text-[9px] text-muted-foreground">no periodic or current reports in the recent window</div>}
          <ul className="mt-1 space-y-0.5 text-[9px] leading-tight">
            {d.filings.map((f) => (
              <li key={f.accession} className="flex items-baseline gap-2">
                <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{f.filed}</span>
                <span className="w-10 shrink-0 text-foreground/90">{f.form}</span>
                <a href={f.url} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate text-primary hover:underline" title={f.description || f.primaryDocument}>
                  {f.description || f.primaryDocument || f.accession}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t border-border/60 px-3 py-2 text-[9px]">
        <a href={x.edgarUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 border border-border px-2 py-1 uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary">
          <ExternalLink className="size-3" /> EDGAR
        </a>
        <button type="button" onClick={() => copy(d?.citation ?? `U.S. Securities and Exchange Commission. EDGAR company filings, CIK ${x.cik}. ${x.edgarUrl}.`, "Citation")} className="flex items-center gap-1 border border-border px-2 py-1 uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary">
          <Copy className="size-3" /> Cite
        </button>
        <button type="button" onClick={() => d && copy(JSON.stringify(d, null, 2), "Dossier JSON")} disabled={!d} className="flex items-center gap-1 border border-border px-2 py-1 uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary disabled:opacity-40">
          <Copy className="size-3" /> JSON
        </button>
      </div>
      {q.data?.caveats?.length ? <div className="px-3 pb-2 text-[9px] leading-snug text-muted-foreground/80">{q.data.caveats.join(" ")}</div> : null}
      <div className="px-3 pb-2 text-[9px] leading-snug text-muted-foreground/80">SEC EDGAR, public domain. Company-level filings only; no officer, insider or shareholder data is read.</div>
    </>
  );
}
