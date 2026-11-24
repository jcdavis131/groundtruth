// LineageGraph — the explorer's client island (SPEC C2.5, C6).
// Inline SVG + a small O(n^2) force layout, no d3. Node budget 300:
// the island refuses to render more and shows the server's truncated count.
// Loaded through LineageGraphDeferred (next/dynamic, ssr:false) so the
// graph renders after first paint. Touch targets >= 44px; pinch-zoom via
// CSS touch-action:none on the SVG only.

"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

export interface GraphNode {
  id: string;
  label: string;
  year: number;
  kind: "method" | "paper";
  href: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

export interface LineageGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated?: boolean;
  truncatedCount?: number;
}

const W = 800;
const H = 600;
const MAX_NODES = 300;

interface Pos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** O(n^2) force layout: repulsion between every pair, springs on edges, weak gravity to centre. */
function simulate(nodes: GraphNode[], edges: GraphEdge[]): Array<{ x: number; y: number }> {
  const n = nodes.length;
  const pos: Pos[] = nodes.map((_, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, n);
    return { x: W / 2 + 220 * Math.cos(a), y: H / 2 + 180 * Math.sin(a), vx: 0, vy: 0 };
  });
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const springs = edges
    .map((e) => [idx.get(e.from), idx.get(e.to)] as const)
    .filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined);
  for (let tick = 0; tick < 240; tick++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = 1;
          dy = 0;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = Math.min(9000 / d2, 6);
        dx /= d;
        dy /= d;
        pos[i].vx += dx * f;
        pos[i].vy += dy * f;
        pos[j].vx -= dx * f;
        pos[j].vy -= dy * f;
      }
    }
    for (const [a, b] of springs) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = ((d - 110) / d) * 0.02;
      pos[a].vx += dx * f;
      pos[a].vy += dy * f;
      pos[b].vx -= dx * f;
      pos[b].vy -= dy * f;
    }
    for (let i = 0; i < n; i++) {
      pos[i].vx += (W / 2 - pos[i].x) * 0.002;
      pos[i].vy += (H / 2 - pos[i].y) * 0.002;
      pos[i].vx *= 0.9;
      pos[i].vy *= 0.9;
      pos[i].x = Math.min(W - 20, Math.max(20, pos[i].x + pos[i].vx));
      pos[i].y = Math.min(H - 20, Math.max(20, pos[i].y + pos[i].vy));
    }
  }
  return pos.map((p) => ({ x: p.x, y: p.y }));
}

export function LineageGraphInner({ nodes, edges, truncated, truncatedCount }: LineageGraphProps) {
  const [positions, setPositions] = useState<Array<{ x: number; y: number }> | null>(null);
  const [scale, setScale] = useState(1);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDist = useRef<number | null>(null);

  useEffect(() => {
    setPositions(simulate(nodes, edges));
  }, [nodes, edges]);

  if (nodes.length > MAX_NODES) {
    return (
      <p role="alert">
        This neighbourhood has {nodes.length} nodes, over the {MAX_NODES}-node budget. Narrow the depth and try
        again.
      </p>
    );
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pinch.current.has(e.pointerId)) return;
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size === 2 && pinchDist.current) {
      const [a, b] = [...pinch.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setScale((s) => Math.min(3, Math.max(0.5, s * (d / pinchDist.current!))));
      pinchDist.current = d;
    }
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pinch.current.delete(e.pointerId);
    if (pinch.current.size < 2) pinchDist.current = null;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setScale((s) => Math.min(3, s + 0.25))} className="min-h-[44px] min-w-[44px] rounded border border-border px-3 text-[15px] font-semibold" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} className="min-h-[44px] min-w-[44px] rounded border border-border px-3 text-[15px] font-semibold" aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setScale(1)} className="min-h-[44px] rounded border border-border px-3 text-[15px] font-semibold">
          Reset zoom
        </button>
        {truncated ? (
          <span className="inline-flex min-h-[44px] items-center rounded border border-border px-3 text-[13px] font-semibold" data-truncated="true">
            Truncated: {truncatedCount} more nodes not shown
          </span>
        ) : null}
      </div>
      <svg
        role="img"
        aria-label={`Method lineage graph with ${nodes.length} nodes and ${edges.length} edges`}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full border border-border bg-background"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => setScale((s) => Math.min(3, Math.max(0.5, s * (e.deltaY < 0 ? 1.1 : 0.9))))}
      >
        <g transform={`translate(${W / 2} ${H / 2}) scale(${scale}) translate(${-W / 2} ${-H / 2})`}>
          {positions &&
            edges.map((e, i) => {
              const a = positions[nodes.findIndex((nd) => nd.id === e.from)];
              const b = positions[nodes.findIndex((nd) => nd.id === e.to)];
              if (!a || !b) return null;
              return (
                <g key={`${e.from}-${e.to}-${i}`}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fontSize="10" fill="currentColor" opacity="0.6" textAnchor="middle">
                    {e.type}
                  </text>
                </g>
              );
            })}
          {positions &&
            nodes.map((nd, i) => (
              <a key={nd.id} href={nd.href}>
                <circle
                  cx={positions[i].x}
                  cy={positions[i].y}
                  r={nd.kind === "method" ? 10 : 7}
                  fill={nd.kind === "method" ? "#2563eb" : "#6b7280"}
                />
                <text x={positions[i].x + 13} y={positions[i].y + 4} fontSize="11" fill="currentColor">
                  {nd.label} ({nd.year})
                </text>
                <title>
                  {nd.label} ({nd.year})
                </title>
              </a>
            ))}
        </g>
      </svg>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {nodes.length} nodes · {edges.length} edges. Tap a node to open it. Pinch or scroll to zoom.
      </p>
    </div>
  );
}

// Deferred loader: the graph renders after first paint (ssr:false). The
// dynamic import lives in this client module because next/dynamic with
// ssr:false is not allowed in a Server Component.
const LazyGraph = dynamic(() => import("@/components/lineage/LineageGraph").then((m) => ({ default: m.LineageGraphInner })), {
  ssr: false,
  loading: () => <p>Loading graph…</p>,
});

export function LineageGraphDeferred(props: LineageGraphProps) {
  return <LazyGraph {...props} />;
}

export default LineageGraphInner;
