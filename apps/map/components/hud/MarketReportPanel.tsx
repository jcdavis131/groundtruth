"use client";
// Market report for the place under the camera: home values, rents, what a
// mortgage costs against local wages, jobs, trade gateways, national pulse.
// Reads the features the layers hold plus two small context requests; every
// estimate prints its arithmetic.

import { useEffect, useMemo, useState } from "react";
import { Braces, Copy, FileDown, Landmark, Link2, Quote, RefreshCw, X } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import { marketCitations, marketReportText, type MarketItem, type MarketReport, type MarketSection } from "@/lib/economy/report";
import ProvenanceList from "./ProvenanceList";
import CountyCompanies from "./CountyCompanies";
import { marketReportFromGlobe } from "@/lib/economy/reportClient";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/economy/features";
import { copyShareLink } from "@/lib/globe/share";
import { downloadText } from "@/lib/explore/export";
import { getRenderer } from "@/lib/globe/registry";
import { flyToSelection } from "@/lib/globe/camera";
import { formatLatLon } from "@/lib/globe/geo";
import { useAreaContext, usePulse } from "./EconomyAsides";

function useReport(open: boolean): { report: MarketReport | null; refresh: () => void } {
  const view = useGlobe((s) => s.view);
  const status = useGlobe((s) => s.status);
  const [nonce, setNonce] = useState(0);
  const [report, setReport] = useState<MarketReport | null>(null);
  const pulse = usePulse(open);
  const stamps = `${status.realestate?.fetchedAt ?? 0}|${status.commerce?.fetchedAt ?? 0}|${status.trade?.fetchedAt ?? 0}`;
  const target = `${view.lon.toFixed(2)},${view.lat.toFixed(2)}`;
  const fips = report?.area ? (report.area.level === "county" ? report.area.geoid : `${report.area.geoid}000`) : null;
  const ctx = useAreaContext(open ? fips : null);
  const pulseData = pulse.data;
  const ctxData = ctx.data;
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      const v = useGlobe.getState().view;
      setReport(marketReportFromGlobe(v.lon, v.lat, { pulse: pulseData, sectors: ctxData?.sectors, metroHome: ctxData?.metroHome ? { ...ctxData.metroHome, id: "", sizeRank: 0, asOf: "", y5Pct: null, monthly: [] } : null, usHome: ctxData?.usHome ? { ...ctxData.usHome, id: "US", name: "United States", sizeRank: 0, asOf: "", y5Pct: null, monthly: [] } : null }));
    }, 600);
    return () => clearTimeout(id);
  }, [open, stamps, target, nonce, pulseData, ctxData]);
  return { report, refresh: () => setNonce((n) => n + 1) };
}

const FLAG: Record<NonNullable<MarketItem["flag"]>, string> = {
  ok: "text-primary",
  watch: "text-warn",
  poor: "text-alert",
};

/** Clipboard write with the outcome on the log line, the same way the copy-as-text button reports. */
function copyToClipboard(text: string, done: string) {
  navigator.clipboard.writeText(text).then(
    () => useGlobe.getState().pushLog({ level: "info", text: done }),
    () => useGlobe.getState().pushLog({ level: "warn", text: "Clipboard blocked." }),
  );
}

function selectItem(item: MarketItem) {
  const r = getRenderer(item.layer);
  const f = r?.getFeature(item.id);
  if (!f) return;
  const sel = { layer: item.layer, id: item.id };
  useGlobe.getState().select(sel, f);
  flyToSelection(sel);
}

function Section({ s, children }: { s: MarketSection; children?: React.ReactNode }) {
  return (
    <section className="border-t border-border/60 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="hud-label">{s.title}</span>
        <span className="text-[9px] text-muted-foreground">{s.loaded ? "" : "off"}</span>
      </div>
      <p className={`mt-0.5 text-[11px] leading-snug ${s.loaded ? "text-foreground/90" : "text-muted-foreground"}`}>{s.summary}</p>
      {s.items.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {s.items.map((it) => (
            <li key={it.id}>
              <button type="button" onClick={() => selectItem(it)} className="grid w-full grid-cols-[1fr_auto] gap-2 text-left text-[10px] leading-tight hover:bg-accent" title="Select on the globe">
                <span className="truncate">
                  <span className={`${it.flag ? FLAG[it.flag] : "text-foreground/80"}`}>{it.name}</span>
                  <span className="text-muted-foreground"> · {it.value}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{it.distanceKm != null ? `${it.distanceKm.toFixed(0)} km` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {children}
      <p className="mt-1 text-[9px] leading-snug text-muted-foreground/80">{s.basis}</p>
    </section>
  );
}

export default function MarketReportPanel() {
  const open = useGlobe((s) => s.marketReportOpen);
  const setOpen = useGlobe((s) => s.setMarketReportOpen);
  const { report, refresh } = useReport(open);
  const momentumColor = useMemo(() => {
    const sc = report?.momentum.score;
    if (sc == null) return "var(--muted-foreground)";
    if (sc < -0.25) return "#60A5FA";
    if (sc <= 0.25) return "var(--primary)";
    if (sc <= 0.6) return "var(--warn)";
    return "var(--alert)";
  }, [report]);
  if (!open) return null;
  const est = report?.affordability.estimate;
  const sectors = report?.jobs.data.sectors ?? [];
  const byLq = [...sectors].filter((s) => s.lq != null && (s.emp ?? 0) >= 100).sort((a, b) => (b.lq ?? 0) - (a.lq ?? 0)).slice(0, 4);
  const pulseKeys = ["MORTGAGE30US", "UNRATE", "RSXFS", "BOPGSTB", "HOUST", "CSUSHPINSA", "bts-imports-teu", "bts-shanghai-la", "bts-berths", "bts-diesel"];
  const pulseItems = pulseKeys.map((k) => report?.pulse.data.items.find((i) => i.id === k)).filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <div className="hud-panel pointer-events-auto flex max-h-[min(62vh,720px)] flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: "#F472B6" }}>
            <Landmark className="mr-1 inline size-3" />
            Market report
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">{report ? (report.area?.name ?? formatLatLon(report.lat, report.lon)) : "reading layers…"}</div>
          <div className="text-[9px] text-muted-foreground">{report?.area?.metro ? `${report.area.metro} · ` : ""}under the camera target · estimates with the arithmetic shown</div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            onClick={() => {
              if (!report) return;
              navigator.clipboard.writeText(marketReportText(report)).then(
                () => useGlobe.getState().pushLog({ level: "info", text: "Market report copied as text." }),
                () => useGlobe.getState().pushLog({ level: "warn", text: "Clipboard blocked." }),
              );
            }}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Copy report as text"
            title="Copy as text"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => report && downloadText(`market-report-${report.lat.toFixed(3)}_${report.lon.toFixed(3)}.json`, JSON.stringify(report, null, 2), "application/json")}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Download report as JSON"
            title="Download JSON"
          >
            <FileDown className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => report && copyToClipboard(marketCitations(report).join("\n"), `${marketCitations(report).length} citation lines copied.`)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Copy citations"
            title="Copy citation (one line per source)"
          >
            <Quote className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => report && copyToClipboard(JSON.stringify({ generatedAt: new Date(report.generatedAt).toISOString(), provenance: report.provenance, citations: report.citations }, null, 2), "Provenance JSON copied.")}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Copy provenance as JSON"
            title="Copy provenance JSON"
          >
            <Braces className="size-3.5" />
          </button>
          <button type="button" onClick={() => void copyShareLink()} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Copy a link to this view" title="Copy link to this view">
            <Link2 className="size-3.5" />
          </button>
          <button type="button" onClick={refresh} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Recompute" title="Recompute for the current view">
            <RefreshCw className="size-3.5" />
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {report && (
        <div className="min-h-0 overflow-y-auto">
          <div className="grid grid-cols-[auto_1fr] items-center gap-3 px-3 py-2">
            <div className="hud-display text-[30px] font-semibold leading-none tabular-nums" style={{ color: momentumColor }}>
              {report.momentum.score == null ? "—" : `${report.momentum.score > 0 ? "+" : ""}${report.momentum.score.toFixed(2)}`}
            </div>
            <div className="min-w-0">
              <div className="hud-label">Momentum index (estimate)</div>
              <div className="text-[12px] capitalize" style={{ color: momentumColor }}>
                {report.momentum.label}
              </div>
              <div className="truncate text-[9px] text-muted-foreground" title={report.momentum.formula}>
                {report.momentum.formula}
              </div>
            </div>
          </div>
          {report.momentum.terms.length > 0 && (
            <ul className="grid grid-cols-2 gap-x-3 px-3 pb-2 text-[9px] text-muted-foreground">
              {report.momentum.terms.map((t) => (
                <li key={t.name} className="flex justify-between gap-2 tabular-nums">
                  <span>
                    {t.name} <span className="opacity-60">w {t.weight}</span>
                  </span>
                  <span title={`${fmtPct(t.raw)} / ±${t.scale}%`}>{t.value.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
          <Section s={report.home}>
            {(report.home.data.metro || report.home.data.us) && (
              <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {report.home.data.metro && <div>metro {report.home.data.metro.name}: {fmtUsd(report.home.data.metro.latest)} ({fmtPct(report.home.data.metro.yoyPct)} 1-yr)</div>}
                {report.home.data.us && <div>United States: {fmtUsd(report.home.data.us.latest)} ({fmtPct(report.home.data.us.yoyPct)} 1-yr)</div>}
              </div>
            )}
          </Section>
          <Section s={report.rent} />
          <section className="border-t border-border/60 px-3 py-2">
            <div className="hud-label">
              Affordability <span className="text-warn">ESTIMATE</span>
            </div>
            {est ? (
              <>
                <p className="mt-0.5 text-[11px] leading-snug text-foreground/90">
                  {fmtUsd(est.payment)}/mo principal and interest on the typical home at {est.ratePct.toFixed(2)}%
                  {est.wageSharePct != null ? `, ${est.wageSharePct.toFixed(0)}% of one average job's pay` : ""}
                  {est.yearsOfWages != null ? `, ${est.yearsOfWages.toFixed(1)} years of wages` : ""}
                </p>
                <ul className="mt-1 space-y-0.5 text-[9px] leading-snug text-muted-foreground">
                  {est.formula.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground">No estimate: needs a home value and this week&apos;s mortgage rate.</p>
            )}
            <p className="mt-1 text-[9px] leading-snug text-muted-foreground/80">{report.affordability.basis}</p>
          </section>
          <Section s={report.jobs}>
            {byLq.length > 0 && <div className="mt-1 text-[10px] leading-snug text-muted-foreground">Concentrated here: {byLq.map((s) => `${s.title} ${s.lq!.toFixed(1)}× (${fmtNum(s.emp)} jobs)`).join(", ")}</div>}
          </Section>
          <CountyCompanies fips={report.area ? (report.area.level === "county" ? report.area.geoid : `${report.area.geoid}000`) : null} />
          <Section s={report.trade} />
          <Section s={report.pulse}>
            {pulseItems.length > 0 && (
              <ul className="mt-1 grid grid-cols-1 gap-y-0.5 text-[9px] leading-snug">
                {pulseItems.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 tabular-nums">
                    <span className="truncate text-foreground/80" title={`${p.source} · ${p.date}`}>
                      {p.label}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {fmtNum(p.value, 2)} {p.unit.length <= 12 ? p.unit : ""}
                      {p.changePct != null ? ` (${fmtPct(p.changePct)})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <div className="border-t border-border/60 px-3 py-2 text-[9px] leading-snug text-warn/90">
            {report.caveats.map((c) => (
              <p key={c}>· {c}</p>
            ))}
            <p>· Aggregates: counties, metros and states.</p>
          </div>
          <details className="group border-t border-border/60 px-3 py-2">
            <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span className="hud-label">Sources</span>
              <span className="text-[9px] text-muted-foreground">
                {report.provenance.length} record{report.provenance.length === 1 ? "" : "s"} · <span className="group-open:hidden">show</span>
                <span className="hidden group-open:inline">hide</span>
              </span>
            </summary>
            <ProvenanceList items={report.provenance} className="mt-1" />
          </details>
        </div>
      )}
    </div>
  );
}
