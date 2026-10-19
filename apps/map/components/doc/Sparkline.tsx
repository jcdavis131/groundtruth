// An inline SVG polyline over the twenty-five months a Zillow row already
// carries. No library, no client island, no interaction.
//
// It is deliberately the ONLY chart on a place page. zillow(kind) and
// zillowHistory(kind) fetch the same multi-tens-of-MB CSV under two cache
// keys, so a page that showed both current values and a long history would
// download it twice and hold two parsed copies in memory. HomeValue.monthly
// is already in the table the page loaded, so this chart is free.
//
// Missing months are skipped rather than plotted as zero — a gap in a series
// and a value of zero are different facts — so the line bridges them, and the
// aria-label says how many points were drawn.

import { SERIES_COLORS } from "@/lib/desk/chart";

export interface SparklineProps {
  /** Oldest first. Nulls are months the publisher did not publish. */
  points: Array<number | null>;
  width?: number;
  height?: number;
  /** Read out to a screen reader, and shown when there is nothing to draw. */
  label: string;
  color?: string;
}

export default function Sparkline({ points, width = 260, height = 48, label, color = SERIES_COLORS[0] }: SparklineProps) {
  const pad = 2;
  const drawn: Array<{ i: number; v: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const v = points[i];
    if (typeof v === "number" && Number.isFinite(v)) drawn.push({ i, v });
  }
  if (drawn.length < 2) {
    return <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{label}: fewer than two published months, so no line is drawn.</p>;
  }
  let min = drawn[0].v;
  let max = drawn[0].v;
  for (const d of drawn) {
    if (d.v < min) min = d.v;
    if (d.v > max) max = d.v;
  }
  const span = max - min || 1;
  const lastIndex = points.length - 1 || 1;
  const coords = drawn
    .map((d) => {
      const x = pad + (d.i / lastIndex) * (width - pad * 2);
      const y = height - pad - ((d.v - min) / span) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={`${label}: ${drawn.length} published months`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="mt-2 block max-w-full"
    >
      <polyline points={coords} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
