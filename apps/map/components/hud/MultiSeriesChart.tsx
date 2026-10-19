"use client";
// Multi-series SVG line chart for desk mode: dual y-axes when units differ,
// a legend that toggles series, a hover crosshair with every value at that
// date, a calendar x-axis, normalise-to-100, and PNG / CSV downloads. The
// scale maths is in lib/desk/chart.ts; this file draws.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, Image as ImageIcon, X } from "lucide-react";
import { downloadText } from "@/lib/explore/export";
import { useGlobe } from "@/lib/store/globe";
import { dateTicks, fmtAxis, fmtDate, nearestIndex, niceTicks, normalise, planAxes, scaleLinear, seriesCsv, sideExtent, timeExtent, type ChartSeries } from "@/lib/desk/chart";

interface Props {
  series: ChartSeries[];
  title?: string;
  height?: number;
  onRemove?: (id: string) => void;
  /** Text and grid colours as hex so the serialised PNG matches the screen (CSS variables do not survive serialisation). */
  ink?: string;
  paper?: string;
  /** File stem for downloads. */
  filename?: string;
}

const M = { top: 12, right: 12, bottom: 28, left: 52, rightAxis: 52 };

/** Path with gaps where the value is null. */
function linePath(points: Array<{ x: number; y: number | null }>): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.y == null || !Number.isFinite(p.y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  useGlobe.getState().pushLog({ level: "info", text: `Saved ${filename}` });
}

export default function MultiSeriesChart({ series, title = "Series", height = 320, onRemove, ink = "#16202a", paper = "#ffffff", filename = "chart" }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [normalised, setNormalised] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(240, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const shown = useMemo(() => series.filter((s) => !hidden.has(s.id) && s.points.length > 0), [series, hidden]);
  const plan = useMemo(() => planAxes(shown, normalised), [shown, normalised]);
  const hasRight = !!plan.units.right;
  const W = width;
  const H = height;
  const x0 = M.left;
  const x1 = W - (hasRight ? M.rightAxis : M.right);
  const y0 = M.top;
  const y1 = H - M.bottom;

  const tx = useMemo(() => timeExtent(shown), [shown]);
  const xScale = useMemo(() => scaleLinear(tx ?? { min: 0, max: 1 }, [x0, x1]), [tx, x0, x1]);
  const leftExt = useMemo(() => sideExtent(shown, plan, "left", normalised), [shown, plan, normalised]);
  const rightExt = useMemo(() => sideExtent(shown, plan, "right", normalised), [shown, plan, normalised]);
  const left = useMemo(() => (leftExt ? niceTicks(leftExt.min, leftExt.max, 5) : null), [leftExt]);
  const right = useMemo(() => (rightExt ? niceTicks(rightExt.min, rightExt.max, 5) : null), [rightExt]);
  const yLeft = useMemo(() => scaleLinear(left?.domain ?? { min: 0, max: 1 }, [y1, y0]), [left, y0, y1]);
  const yRight = useMemo(() => scaleLinear(right?.domain ?? { min: 0, max: 1 }, [y1, y0]), [right, y0, y1]);
  const xTicks = useMemo(() => (tx ? dateTicks(tx.min, tx.max, Math.max(3, Math.floor((x1 - x0) / 90))) : []), [tx, x0, x1]);

  const drawn = useMemo(
    () =>
      shown.map((s) => {
        const pts = normalised ? normalise(s.points) : s.points;
        const y = plan.side[s.id] === "right" ? yRight : yLeft;
        return { s, pts, path: linePath(pts.map((p) => ({ x: xScale(p.t), y: p.v == null ? null : y(p.v) }))) };
      }),
    [shown, normalised, plan, xScale, yLeft, yRight],
  );

  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!tx) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const t = tx.min + ((px - x0) / (x1 - x0)) * (tx.max - tx.min);
      setHover(Math.max(tx.min, Math.min(tx.max, t)));
    },
    [tx, W, x0, x1],
  );

  const hoverRows = useMemo(() => {
    if (hover == null) return [];
    return drawn.map(({ s, pts }) => {
      const i = nearestIndex(pts, hover);
      const p = i >= 0 ? pts[i] : null;
      return { s, t: p?.t ?? null, v: p?.v ?? null };
    });
  }, [drawn, hover]);
  const hoverT = hoverRows.find((r) => r.t != null)?.t ?? hover;

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const exportCsv = () => downloadText(`${filename}-${stamp()}.csv`, seriesCsv(shown.map((s) => (normalised ? { ...s, unit: "index", points: normalise(s.points) } : s))), "text/csv");
  const exportPng = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(W));
    clone.setAttribute("height", String(H));
    const xml = new XMLSerializer().serializeToString(clone);
    const src = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(src);
      canvas.toBlob((blob) => blob && downloadBlob(`${filename}-${stamp()}.png`, blob), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      useGlobe.getState().pushLog({ level: "warn", text: "Could not rasterise the chart; download the CSV instead." });
    };
    img.src = src;
  };

  const grid = ink + "26"; // ~15 % alpha
  const faint = ink + "99";

  return (
    <div className="desk-chart flex min-h-0 flex-col" ref={wrap}>
      <div className="desk-noprint flex flex-wrap items-center gap-2 border-b border-border px-2 py-1">
        <span className="text-[11px] font-semibold text-foreground">{title}</span>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <input type="checkbox" checked={normalised} onChange={(e) => setNormalised(e.target.checked)} />
          normalise (first = 100)
        </label>
        <span className="flex-1" />
        <button type="button" onClick={exportPng} disabled={shown.length === 0} className="desk-btn" title="Download the chart as a PNG">
          <ImageIcon className="size-3" /> PNG
        </button>
        <button type="button" onClick={exportCsv} disabled={shown.length === 0} className="desk-btn" title="Download every drawn series as one CSV">
          <FileDown className="size-3" /> CSV
        </button>
      </div>

      {series.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 px-2 py-1 text-[10px]" aria-label="Series">
          {series.map((s) => {
            const off = hidden.has(s.id);
            return (
              <li key={s.id} className="flex items-center gap-1">
                <button type="button" onClick={() => toggle(s.id)} aria-pressed={!off} className={`flex items-center gap-1 rounded px-1 hover:bg-accent ${off ? "text-muted-foreground line-through" : "text-foreground"}`} title={off ? "Show" : "Hide"}>
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color, opacity: off ? 0.35 : 1 }} aria-hidden />
                  {s.label}
                  <span className="text-muted-foreground">{s.unit ? ` · ${s.unit}` : ""}</span>
                  <span className="text-muted-foreground">{s.points.length === 0 ? " · no points" : ""}</span>
                </button>
                {onRemove && (
                  <button type="button" onClick={() => onRemove(s.id)} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Remove ${s.label}`}>
                    <X className="size-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {plan.overflow.length > 0 && <p className="px-2 text-[10px] text-warn">More than two units on the chart: {plan.overflow.join(", ")} share the left axis. Turn on normalise to compare shapes.</p>}

      {shown.length === 0 || !tx || !left ? (
        <p className="p-3 text-[11px] text-muted-foreground">{series.length === 0 ? "Add a series to draw." : "Nothing to draw: every series is hidden or empty."}</p>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            role="img"
            aria-label={`${title}: ${shown.map((s) => s.label).join(", ")}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, background: paper }}
          >
            {/* horizontal grid + left axis */}
            {left.ticks.map((v) => (
              <g key={`l${v}`}>
                <line x1={x0} x2={x1} y1={yLeft(v)} y2={yLeft(v)} stroke={grid} />
                <text x={x0 - 6} y={yLeft(v) + 3} textAnchor="end" fill={faint}>
                  {fmtAxis(v)}
                </text>
              </g>
            ))}
            {plan.units.left && (
              <text x={4} y={y0 - 2} fill={faint} fontSize={9}>
                {plan.units.left}
              </text>
            )}
            {/* right axis */}
            {right &&
              right.ticks.map((v) => (
                <text key={`r${v}`} x={x1 + 6} y={yRight(v) + 3} textAnchor="start" fill={faint}>
                  {fmtAxis(v)}
                </text>
              ))}
            {plan.units.right && (
              <text x={x1 + 6} y={y0 - 2} fill={faint} fontSize={9}>
                {plan.units.right}
              </text>
            )}
            {/* x axis */}
            <line x1={x0} x2={x1} y1={y1} y2={y1} stroke={faint} />
            {xTicks.map((t) => (
              <g key={t.t}>
                <line x1={xScale(t.t)} x2={xScale(t.t)} y1={y1} y2={y1 + 4} stroke={faint} />
                <text x={xScale(t.t)} y={y1 + 15} textAnchor="middle" fill={faint}>
                  {t.label}
                </text>
              </g>
            ))}
            {/* series */}
            {drawn.map(({ s, path }) => (
              <path key={s.id} d={path} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {/* crosshair */}
            {hoverT != null && (
              <g>
                <line x1={xScale(hoverT)} x2={xScale(hoverT)} y1={y0} y2={y1} stroke={ink} strokeDasharray="3 3" strokeOpacity={0.5} />
                {hoverRows.map((r) =>
                  r.v == null || r.t == null ? null : <circle key={r.s.id} cx={xScale(r.t)} cy={(plan.side[r.s.id] === "right" ? yRight : yLeft)(r.v)} r={3} fill={r.s.color} stroke={paper} strokeWidth={1} />,
                )}
              </g>
            )}
          </svg>
          {hoverT != null && (
            <div
              className="pointer-events-none absolute top-2 rounded border border-border bg-card px-2 py-1 text-[10px] shadow-sm"
              style={xScale(hoverT) > (x0 + x1) / 2 ? { right: W - xScale(hoverT) + 8 } : { left: xScale(hoverT) + 8 }}
              role="status"
            >
              <div className="font-semibold text-foreground">{fmtDate(hoverT)}</div>
              {hoverRows.map((r) => (
                <div key={r.s.id} className="flex items-center gap-1 tabular-nums">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: r.s.color }} aria-hidden />
                  <span className="text-muted-foreground">{r.s.label}</span>
                  <span className="text-foreground">{r.v == null ? "—" : r.v.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                  {r.t != null && r.t !== hoverT && <span className="text-muted-foreground">({fmtDate(r.t)})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
