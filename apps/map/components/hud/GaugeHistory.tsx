"use client";
// 365-day daily-mean trace for a USGS gauge or well, drawn as an SVG
// sparkline with the latest value placed against the year's range.

import { useQuery } from "@tanstack/react-query";
import { PARAM_INFO } from "@/lib/water/quality";

interface Props {
  site: string;
  param: string;
  /** Latest instantaneous value to mark on the trace (same units). */
  latest?: number;
  /** Depth-to-water reads inverted: larger = lower water table. */
  invert?: boolean;
}

interface Envelope {
  data: Array<[string, number]>;
  range?: string;
}

export default function GaugeHistory({ site, param, latest, invert }: Props) {
  const q = useQuery({
    queryKey: ["gauge-history", site, param],
    queryFn: async () => {
      const r = await fetch(`/api/water?op=history&site=${encodeURIComponent(site)}&param=${param}`);
      const j = (await r.json()) as Envelope & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `history ${r.status}`);
      return j;
    },
    staleTime: 60 * 60_000,
  });
  const label = PARAM_INFO[param]?.label ?? param;
  if (q.isLoading) return <div className="px-3 py-1 text-[9px] text-muted-foreground">loading 365-day trace…</div>;
  if (q.error) return <div className="px-3 py-1 text-[9px] text-muted-foreground">no daily history: {(q.error as Error).message.slice(0, 50)}</div>;
  const rows = q.data?.data ?? [];
  if (rows.length < 2) return <div className="px-3 py-1 text-[9px] text-muted-foreground">no daily values published for {label} in the last year</div>;

  const vals = rows.map((r) => r[1]);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (latest != null) {
    min = Math.min(min, latest);
    max = Math.max(max, latest);
  }
  const span = max - min || 1;
  const W = 296;
  const H = 54;
  const t0 = Date.parse(rows[0][0]);
  const t1 = Date.parse(rows[rows.length - 1][0]);
  const tspan = t1 - t0 || 1;
  const y = (v: number) => (invert ? 4 + ((v - min) / span) * (H - 8) : H - 4 - ((v - min) / span) * (H - 8));
  const pts = rows.map((r) => `${(((Date.parse(r[0]) - t0) / tspan) * W).toFixed(1)},${y(r[1]).toFixed(1)}`).join(" ");
  const sorted = [...vals].sort((a, b) => a - b);
  const pct = latest != null ? Math.round((sorted.filter((v) => v <= latest).length / sorted.length) * 100) : null;
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="hud-label">{label} · 365 d daily mean</span>
        <span className="text-[9px] tabular-nums text-muted-foreground">
          {fmt(min)} – {fmt(max)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block h-[54px] w-full" role="img" aria-label={`${label} over the last year`}>
        <line x1="0" y1={H - 4} x2={W} y2={H - 4} stroke="currentColor" strokeOpacity="0.15" />
        <polyline points={pts} fill="none" stroke="#3B9DFF" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        {latest != null && (
          <g>
            <line x1="0" y1={y(latest)} x2={W} y2={y(latest)} stroke="var(--warn)" strokeOpacity="0.7" strokeDasharray="3 3" />
            <circle cx={W - 2} cy={y(latest)} r="2.5" fill="var(--warn)" />
          </g>
        )}
      </svg>
      {pct != null && (
        <div className="text-[9px] text-muted-foreground">
          latest {fmt(latest!)} sits at the {pct}th percentile of the year{invert ? " (deeper is drier)" : ""} · {rows.length} daily values
        </div>
      )}
    </div>
  );
}
