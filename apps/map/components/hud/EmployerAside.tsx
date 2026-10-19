"use client";
// Dossier aside for a selected employer feature: rank, headcount, HQ location,
// metro, source provenance, and RSU/vesting section. Mounted by InfoPanel when
// feature.properties.layer is "employers". Reads /api/employers.

import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import type { LayerFeature } from "@/lib/layers/types";
import type { Provenance } from "@/lib/provenance/types";
import type { CitedStatement, EquityDossier } from "@/lib/companies/equity";

interface EmployerDossier {
  rank: number;
  name: string;
  employees: number;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  metro?: string | null;
  ticker?: string | null;
  source: string;
}

interface DossierEnvelope {
  data: EmployerDossier[];
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

/** Employer dossier by name search; shared by the aside. */
export function useEmployerDossier(name: string | null) {
  return useQuery({
    queryKey: ["employer", name],
    queryFn: () =>
      getJson<DossierEnvelope>(
        `/api/employers?op=search&q=${encodeURIComponent(name ?? "")}&limit=1`
      ),
    staleTime: 6 * 3600_000,
    enabled: !!name,
  });
}

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => useGlobe.getState().pushLog({ level: "info", text: `${what} copied.` }),
    () => useGlobe.getState().pushLog({ level: "warn", text: "Clipboard blocked." }),
  );
}

function fmtEmployees(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

interface EquityEnvelope {
  data: EquityDossier;
  provenance: Provenance[];
  caveats?: string[];
  error?: string;
}

/** RSU/vesting dossier for one ticker, from /api/employers?op=equity. Pilot batch only. */
function useEquityDossier(ticker: string | null) {
  return useQuery({
    queryKey: ["equity", ticker],
    queryFn: () =>
      getJson<EquityEnvelope>(
        `/api/employers?op=equity&ticker=${encodeURIComponent(ticker ?? "")}`
      ),
    staleTime: 24 * 3600_000,
    enabled: !!ticker,
    // A 404 means "ticker not in the pilot batch" — not worth retrying.
    retry: false,
  });
}

function Cited({ c }: { c: CitedStatement }) {
  const isSec = c.url.includes("sec.gov");
  return (
    <div className="mt-1.5">
      <p className="text-[12px] leading-snug">&ldquo;{c.statement}&rdquo;</p>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        {c.form} · filed {c.filingDate} ·{" "}
        <a
          href={c.url}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
        >
          {isSec ? "EDGAR filing" : "Annual report"}
        </a>
      </div>
    </div>
  );
}

function EquityCompensation({ ticker }: { ticker: string | null }) {
  const q = useEquityDossier(ticker);

  if (!ticker) return null;
  if (q.isPending) {
    return <p className="text-[12px] text-muted-foreground">Loading equity dossier…</p>;
  }
  if (q.isError || !q.data?.data) {
    return (
      <p className="text-[12px] leading-snug text-muted-foreground">
        No equity dossier for this employer yet — the pilot covers 70 companies.
      </p>
    );
  }
  const d = q.data.data;
  return (
    <div>
      {d.vesting.length > 0 && (
        <div className="mt-1">
          <div className="text-[11px] font-semibold">Vesting schedule</div>
          {d.vesting.map((v, i) => (
            <Cited key={i} c={v} />
          ))}
        </div>
      )}
      {d.equityPlan && (
        <div className="mt-2">
          <div className="text-[11px] font-semibold">Equity plan</div>
          <Cited c={d.equityPlan} />
        </div>
      )}
      {d.tradingPolicy && (
        <div className="mt-2">
          <div className="text-[11px] font-semibold">Insider trading policy</div>
          <Cited c={d.tradingPolicy} />
        </div>
      )}
      {d.blackoutWindowEstimate && (
        <div className="mt-2">
          {/* The estimate label is rendered verbatim, per the dossier contract. */}
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {d.blackoutWindowEstimate.label}
          </span>
          <p className="mt-1 text-[12px] leading-snug">{d.blackoutWindowEstimate.statement}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            How this was estimated: {d.blackoutWindowEstimate.method}
          </p>
        </div>
      )}
      {d.etfMembership && d.etfMembership.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-semibold">Held by ETFs</div>
          <ul className="mt-0.5 space-y-0.5">
            {d.etfMembership.map((m, i) => (
              <li key={i} className="text-[12px] leading-snug">
                {m.etf} — {m.weightPct.toFixed(2)}%
                <span className="text-muted-foreground"> as of {m.asOf}</span>
              </li>
            ))}
          </ul>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Official issuer holdings files.
          </p>
        </div>
      )}
    </div>
  );
}

export default function EmployerAside({ feature }: { feature: LayerFeature }) {
  const props = feature.properties as unknown as Record<string, unknown>;
  const name = (props.name as string) ?? "";
  const q = useEmployerDossier(name || null);
  const d = q.data?.data?.[0];

  // Fall back to feature properties if the query hasn't loaded
  const rank = d?.rank ?? (props.rank as number) ?? null;
  const employees = d?.employees ?? (props.employees as number) ?? null;
  const city = d?.city ?? (props.city as string) ?? null;
  const state = d?.state ?? (props.state as string) ?? null;
  const zip = d?.zip ?? (props.zip as string) ?? null;
  const metro = d?.metro ?? (props.metro as string) ?? null;
  const source = d?.source ?? (props.source as string) ?? "unknown";
  const ticker = d?.ticker ?? (props.ticker as string) ?? null;

  const hqLine = [city, state].filter(Boolean).join(", ") + (zip ? ` ${zip}` : "");

  return (
    <>
      <div className="border-t border-border/60 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold leading-tight">{name || "Employer"}</h3>
          {rank != null && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              #{rank} employer
            </span>
          )}
        </div>
        {ticker && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Ticker: <span className="font-mono">{ticker}</span>
          </div>
        )}
      </div>

      <div className="px-3 py-2">
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div>
            <div className="text-muted-foreground">Employees</div>
            <div className="text-base font-semibold">
              {employees != null ? fmtEmployees(employees) : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">org-wide, per source</div>
          </div>
          <div>
            <div className="text-muted-foreground">Headquarters</div>
            <div className="font-medium leading-tight">{hqLine || "—"}</div>
            {metro && <div className="text-[10px] text-muted-foreground">{metro}</div>}
          </div>
        </div>

        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Equity compensation
          </div>
          <EquityCompensation ticker={ticker} />
          <div className="mt-1.5 flex gap-2">
            <button
              className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
              onClick={() => copy(name, "Employer name")}
            >
              <Copy className="mr-1 inline h-3 w-3" /> Copy name
            </button>
            {ticker && (
              <a
                className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=&type=4&dateb=&owner=include&count=10&SearchStr=${encodeURIComponent(ticker)}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="mr-1 inline h-3 w-3" /> Form 4 on EDGAR
              </a>
            )}
          </div>
        </div>

        <div className="mt-3 border-t border-border/60 pt-2 text-[10px] leading-snug text-muted-foreground">
          <div>Source: {source}</div>
          <div>Headcount is organization-wide as reported; not US-only.</div>
          {q.data?.caveats?.[0] && <div className="mt-1">{q.data.caveats[0]}</div>}
        </div>
      </div>
    </>
  );
}
