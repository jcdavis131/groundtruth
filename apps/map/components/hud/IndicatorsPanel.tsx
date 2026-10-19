"use client";
// Indicators panel: named signals with thresholds, grouped by category.
// Each row shows status, the latest value with its date, the change since
// the previous point and a year earlier, a sparkline, why the series
// matters and which rule fired. Data comes from /api/indicators?op=latest
// through lib/indicators/store; refreshed every 15 minutes while open.

import { useEffect, useMemo } from "react";
import { Activity, Crosshair, FileDown, Quote, RefreshCw, X } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import { flyTo } from "@/lib/globe/camera";
import { downloadText } from "@/lib/explore/export";
import { citation } from "@/lib/provenance/types";
import { latestCsv } from "@/lib/indicators/csv";
import { moveQuality, type IndicatorStatus } from "@/lib/indicators/evaluate";
import type { IndicatorResult } from "@/lib/indicators/service";
import { useIndicators, visibleItems, type CategoryFilter } from "@/lib/indicators/store";
import { INDICATOR_CATEGORIES, type IndicatorCategory } from "@/lib/indicators/types";
import type { Point } from "@/lib/series/types";

const REFRESH_MS = 15 * 60_000;

// --alert exists in globals.css; the literal is the fallback if a theme drops it.
const STATUS_COLOR: Record<IndicatorStatus, string> = {
  ok: "var(--primary)",
  watch: "var(--warn)",
  alert: "var(--alert, #ff4d4d)",
  "no data": "var(--muted-foreground)",
};

const CATEGORY_LABEL: Record<IndicatorCategory, string> = {
  freight: "Freight",
  housing: "Housing",
  water: "Water",
  energy: "Energy",
  labour: "Labour",
  trade: "Trade",
  macro: "Macro",
};

function fmtValue(v: number | null, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1e6 ? (v / 1e6).toFixed(2) + " m" : a >= 10_000 ? Math.round(v).toLocaleString() : a >= 100 ? v.toFixed(1) : v.toFixed(2);
  return unit === "%" ? `${s} %` : unit.startsWith("$") ? `$${s}${unit.slice(1)}` : `${s} ${unit}`;
}

function fmtDelta(abs: number | null, pct: number | null): string {
  if (abs == null) return "—";
  const sign = abs > 0 ? "+" : "";
  const a = Math.abs(abs);
  const s = a >= 10_000 ? Math.round(abs).toLocaleString() : a >= 100 ? abs.toFixed(1) : abs.toFixed(2);
  return pct == null ? `${sign}${s}` : `${sign}${s} (${sign}${pct.toFixed(1)} %)`;
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/** Tiny inline sparkline: 60 points into 84 x 22 px, last point marked. */
function Sparkline({ points, color }: { points: Point[]; color: string }) {
  const W = 84;
  const H = 22;
  const vals = points.map((p) => p.v).filter((v): v is number => v != null);
  if (vals.length < 2) return <svg width={W} height={H} className="shrink-0 opacity-40" aria-hidden="true" />;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => (i / (vals.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
  const d = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" role="img" aria-label={`last ${vals.length} points`}>
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.2" strokeOpacity="0.85" />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r="1.8" fill={color} />
    </svg>
  );
}

function log(level: "info" | "warn", text: string) {
  useGlobe.getState().pushLog({ level, text });
}

function copyCitation(it: IndicatorResult) {
  if (!it.provenance) return log("warn", "No provenance yet for this indicator.");
  const text = citation(it.provenance);
  navigator.clipboard.writeText(text).then(
    () => log("info", `Citation copied: ${it.meta.title}`),
    () => log("warn", "Clipboard blocked."),
  );
}

function Row({ it }: { it: IndicatorResult }) {
  const e = it.evaluation;
  const color = STATUS_COLOR[e.status];
  const quality = moveQuality(e.changeAbs, it.meta.invert);
  const deltaColor = quality === "worse" ? "var(--warn)" : quality === "better" ? "var(--primary)" : "var(--muted-foreground)";
  const fly = it.meta.flyTo;
  return (
    <li className="border-t border-border/40 px-3 py-1.5">
      <div className="flex items-start gap-2">
        <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: e.status === "alert" ? `0 0 6px ${color}` : undefined }} title={e.status} aria-label={`status ${e.status}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] text-foreground/90" title={it.meta.title}>
              {it.meta.title}
            </span>
            <span className="hud-display shrink-0 text-[13px] font-semibold tabular-nums" style={{ color }}>
              {fmtValue(e.latest, it.meta.unit)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[9px] tabular-nums text-muted-foreground">
            <span className="truncate">
              {e.latestAt ? fmtDate(e.latestAt) : it.error ? "no data" : "—"}
              {e.changeAbs != null && (
                <>
                  {" · "}
                  <span style={{ color: deltaColor }}>{fmtDelta(e.changeAbs, e.changePct)}</span> vs prev
                </>
              )}
              {e.yoyPct != null && <> · {fmtDelta(e.yoyAbs, e.yoyPct)} y/y</>}
            </span>
            <Sparkline points={e.sparkline} color={color} />
          </div>
          {e.triggered.length > 0 && (
            <div className="text-[9px] leading-snug" style={{ color }}>
              {e.triggered.map((t) => `${t.level}: ${t.label}`).join(" · ")}
            </div>
          )}
          {it.error && <div className="text-[9px] leading-snug text-muted-foreground">upstream: {it.error.slice(0, 90)}</div>}
          <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground/80">{it.meta.whyItMatters}</p>
          <div className="mt-0.5 flex gap-2 text-[9px]">
            {fly && (
              <button type="button" onClick={() => flyTo(fly.lon, fly.lat, { height: fly.height })} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" title="Fly the camera to this gauge or gateway">
                <Crosshair className="size-3" /> fly to
              </button>
            )}
            <button type="button" onClick={() => copyCitation(it)} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" title="Copy a citation line for the latest value">
              <Quote className="size-3" /> cite
            </button>
            <a href={`/api/indicators?op=history&id=${it.meta.id}&format=csv`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Full history as CSV">
              history
            </a>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function IndicatorsPanel() {
  const open = useIndicators((s) => s.open);
  const setOpen = useIndicators((s) => s.setOpen);
  const category = useIndicators((s) => s.category);
  const setCategory = useIndicators((s) => s.setCategory);
  const data = useIndicators((s) => s.data);
  const generatedAt = useIndicators((s) => s.generatedAt);
  const loading = useIndicators((s) => s.loading);
  const error = useIndicators((s) => s.error);
  const refresh = useIndicators((s) => s.refresh);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [open, refresh]);

  const visible = useMemo(() => visibleItems(data, category), [data, category]);
  const groups = useMemo(() => {
    const m = new Map<IndicatorCategory, IndicatorResult[]>();
    for (const it of visible) {
      const arr = m.get(it.meta.category) ?? [];
      arr.push(it);
      m.set(it.meta.category, arr);
    }
    return INDICATOR_CATEGORIES.filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const);
  }, [visible]);
  const counts = useMemo(() => {
    const c = { alert: 0, watch: 0 };
    for (const it of data ?? []) {
      if (it.evaluation.status === "alert") c.alert++;
      else if (it.evaluation.status === "watch") c.watch++;
    }
    return c;
  }, [data]);

  if (!open) return null;
  const filters: CategoryFilter[] = ["all", ...INDICATOR_CATEGORIES];

  return (
    <div className="hud-panel pointer-events-auto flex max-h-[min(62vh,720px)] flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label">
            <Activity className="mr-1 inline size-3" />
            Indicators
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">
            {data ? `${data.length} signals` : loading ? "reading…" : "—"}
            {data && (counts.alert || counts.watch) ? (
              <span className="ml-2 text-[11px] font-normal">
                {counts.alert > 0 && <span style={{ color: STATUS_COLOR.alert }}>{counts.alert} alert</span>}
                {counts.alert > 0 && counts.watch > 0 && <span className="text-muted-foreground"> · </span>}
                {counts.watch > 0 && <span style={{ color: STATUS_COLOR.watch }}>{counts.watch} watch</span>}
              </span>
            ) : null}
          </div>
          <div className="text-[9px] text-muted-foreground">{generatedAt ? `evaluated ${generatedAt.slice(0, 16).replace("T", " ")} UTC` : "thresholds print their source; (convention) means ours"}</div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            onClick={() => {
              if (!visible.length) return log("warn", "No indicators loaded to export.");
              downloadText(`indicators-${new Date().toISOString().slice(0, 10)}.csv`, latestCsv(visible), "text/csv");
            }}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Download the visible indicators as CSV"
            title="Download CSV"
          >
            <FileDown className="size-3.5" />
          </button>
          <button type="button" onClick={() => void refresh()} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Refresh" title="Refresh now">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 px-3 py-1.5" role="tablist" aria-label="Category">
        {filters.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${category === c ? "border-primary/70 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
          >
            {c === "all" ? "All" : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      {error && <div className="px-3 pb-1 text-[10px] text-warn">{error}</div>}
      <div className="min-h-0 overflow-y-auto">
        {groups.map(([c, items]) => (
          <section key={c}>
            <div className="flex items-baseline justify-between px-3 pt-1.5">
              <span className="hud-label">{CATEGORY_LABEL[c]}</span>
              <span className="text-[9px] text-muted-foreground">{items.length}</span>
            </div>
            <ul>
              {items.map((it) => (
                <Row key={it.meta.id} it={it} />
              ))}
            </ul>
          </section>
        ))}
        {data && !visible.length && <div className="px-3 py-2 text-[10px] text-muted-foreground">Nothing in this category.</div>}
      </div>
    </div>
  );
}
