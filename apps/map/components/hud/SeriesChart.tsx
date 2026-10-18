"use client";
// Small SVG trace for any [label, value] series: home values by year,
// monthly truck counts, container TEU by year. Marks the last point and,
// optionally, a reference line. Accepts either [label, value] rows or the
// Point[] of a lib/series Series (null values are skipped).

import type { Point } from "@/lib/series/types";

interface Props {
  title: string;
  rows?: Array<[string, number]>;
  /** A Series' points; used when `rows` is absent. Labels are ISO dates. */
  points?: Point[];
  /** Accessible name for the SVG; defaults to the title. */
  ariaLabel?: string;
  color?: string;
  /** Format for the axis extremes and the latest value. */
  fmt?: (v: number) => string;
  /** Text under the chart. */
  note?: string;
  bars?: boolean;
  /** Draw a dashed reference line (e.g. a state or national value). */
  reference?: { value: number; label: string };
}

const defaultFmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

/** [ISO date, value] rows from a Series' points, nulls dropped. */
export function rowsFromPoints(points: Point[]): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const p of points) if (p.v != null && Number.isFinite(p.v)) out.push([new Date(p.t).toISOString().slice(0, 10), p.v]);
  return out;
}

export default function SeriesChart({ title, rows: rowsIn, points, color = "var(--primary)", fmt = defaultFmt, note, bars, reference, ariaLabel }: Props) {
  const rows = rowsIn ?? (points ? rowsFromPoints(points) : []);
  if (rows.length < 2) return <div className="px-3 py-1 text-[9px] text-muted-foreground">{title}: not enough published points to draw</div>;
  const vals = rows.map((r) => r[1]);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (reference) {
    min = Math.min(min, reference.value);
    max = Math.max(max, reference.value);
  }
  if (bars) min = Math.min(0, min);
  const span = max - min || 1;
  const W = 296;
  const H = 54;
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  const x = (i: number) => (rows.length === 1 ? W / 2 : (i / (rows.length - 1)) * (W - 6) + 3);
  const last = rows[rows.length - 1];
  const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r[1]).toFixed(1)}`).join(" ");
  const bw = Math.max(2, ((W - 6) / rows.length) * 0.7);
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="hud-label truncate">{title}</span>
        <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
          {fmt(min)} – {fmt(max)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block h-[54px] w-full" role="img" aria-label={ariaLabel ?? title}>
        <line x1="0" y1={H - 4} x2={W} y2={H - 4} stroke="currentColor" strokeOpacity="0.15" />
        {bars ? (
          rows.map((r, i) => (
            <rect key={r[0]} x={x(i) - bw / 2} y={y(Math.max(r[1], 0))} width={bw} height={Math.max(0.5, Math.abs(y(r[1]) - y(0)))} fill={color} fillOpacity={i === rows.length - 1 ? 1 : 0.55} />
          ))
        ) : (
          <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
        )}
        {reference && <line x1="0" y1={y(reference.value)} x2={W} y2={y(reference.value)} stroke="currentColor" strokeOpacity="0.45" strokeDasharray="3 3" />}
        <circle cx={x(rows.length - 1)} cy={y(last[1])} r="2.5" fill={color} />
      </svg>
      <div className="flex justify-between gap-2 text-[9px] text-muted-foreground">
        <span className="truncate">
          {rows[0][0]} → {last[0]}: {fmt(last[1])}
          {reference ? ` · dashed ${reference.label} ${fmt(reference.value)}` : ""}
        </span>
      </div>
      {note && <div className="text-[9px] leading-snug text-muted-foreground/80">{note}</div>}
    </div>
  );
}
