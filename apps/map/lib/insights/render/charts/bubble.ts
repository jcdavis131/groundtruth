// The bubble chart: one circle per plotted row at (x, y), its AREA
// proportional to |size|, so the radius goes with the square root and the
// largest |size| on the chart gets MAX_RADIUS. A negative size is an outline
// with no fill, never a filled circle; a plotted row whose size was not
// published is a small dashed ring that claims no size at all.
//
// Draw order is by area, largest first (ties by id), the subject included, so
// a smaller bubble is never painted under a larger one. The subject stands
// out by its signal colour, not by being on top: drawn last, its opaque fill
// would hide every smaller bubble under it.
//
// Labels. Which rows get one is the spec's label policy, ranked: the subject,
// then the ids the spec names (larger |size| first, then id), then the
// extremes (highest x, lowest x, highest y, lowest y), then the largest
// |size|. Every rank is derived from values and ids, never from array
// position, so a reordered spec labels the same rows in the same order. The
// canvas caps how many are drawn (LABEL_CAP); place.ts places them, and the
// layout reports what was requested, placed and dropped, with the reason for
// each drop.
//
// A short label that two rows share ("Springfield", "Portland") is not drawn
// as is: displayLabels qualifies every row in the collision with the state
// part of its full name ("Springfield, MA"), then the full name, then the id,
// until no two rows read the same.

import { CANVASES, type CanvasId, type CanvasPreset } from "../canvas";
import { layoutFrame, textBox, textNode, type Box, type Frame } from "../frame";
import { capHeight, descent, measureStyled, type TextStyle } from "../metrics";
import { placeLabels, type Circle, type DropReason, type PlacedLabel, type Segment } from "../place";
import type { CircleNode, LineNode, SceneNode, TextNode } from "../scene";
import { byteCompare, defaults, type BubbleSpec } from "../spec";
import { isPlotted } from "../table";
import type { Paint, Palette, Theme } from "../tokens";

type Datum = BubbleSpec["data"][number];

/** Radius of the largest |size| on the chart at scale 1, px. */
export const MAX_RADIUS = 40;
/** Radius of the dashed ring for a plotted row whose size is not published, at scale 1, px. */
export const UNSIZED_RADIUS = 5;
/** The most labels a canvas draws, the subject included. */
export const LABEL_CAP: Record<CanvasId, number> = { social: 24, og: 12, "inline-wide": 16, "inline-narrow": 7 };
/** Leader lengths the placer tries at scale 1, px. */
export const RINGS = [16, 22, 28, 36, 46, 58, 72, 88, 108, 132, 162];

export type MarkStyle = "fill" | "outline" | "dashed";

export interface BubbleMark {
  id: string;
  cx: number;
  cy: number;
  r: number;
  style: MarkStyle;
  subject: boolean;
}

export interface LabelLine {
  text: string;
  style: TextStyle;
}

export type LabelDrop = DropReason | "not plotted";

export interface BubbleLayout {
  frame: Frame;
  /** In draw order: largest area first, ties by id; the subject takes its place by size. */
  marks: BubbleMark[];
  /** Every label the spec asks for, highest priority first. */
  requested: string[];
  placed: PlacedLabel[];
  dropped: Array<{ id: string; reason: LabelDrop }>;
  /** The text each labelled row is drawn with, after disambiguation. */
  text: Record<string, string>;
  /** What the placer kept clear: reference-line labels and every frame text run. */
  keepOut: Box[];
  /** Bubbles, then leaders, then label text: the marks between the frame's under and over layers. */
  nodes: SceneNode[];
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** The state (first of several) after the last ", " of a full name: "Washington-Arlington-Alexandria, DC-VA-MD-WV" gives "DC". */
function qualifier(fullLabel: string): string | null {
  const i = fullLabel.lastIndexOf(", ");
  if (i < 0) return null;
  const q = fullLabel.slice(i + 2).split("-")[0].trim();
  return q || null;
}

/**
 * The label each row is drawn with: its short label, unless another row of
 * the spec shares it, plotted or not. Then each row in the collision steps
 * up: "label, ST", the full name, the full name and id, until none collide.
 */
export function displayLabels(data: Datum[]): Record<string, string> {
  const tiers: Array<(d: Datum) => string> = [
    (d) => d.label,
    (d) => {
      const q = qualifier(d.fullLabel);
      return q && !d.label.endsWith(`, ${q}`) ? `${d.label}, ${q}` : d.fullLabel;
    },
    (d) => d.fullLabel,
    (d) => `${d.fullLabel} (${d.id})`,
  ];
  const tier = new Map<string, number>(data.map((d) => [d.id, 0]));
  const text = (d: Datum): string => tiers[tier.get(d.id) as number](d);
  for (;;) {
    const groups = new Map<string, Datum[]>();
    for (const d of data) {
      const t = text(d);
      groups.set(t, [...(groups.get(t) ?? []), d]);
    }
    let moved = false;
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      for (const d of g) {
        const t = tier.get(d.id) as number;
        if (t < tiers.length - 1) {
          tier.set(d.id, t + 1);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return Object.fromEntries(data.map((d) => [d.id, text(d)]));
}

const bySize = (a: Datum, b: Datum): number => (finite(b.size) ? Math.abs(b.size) : -1) - (finite(a.size) ? Math.abs(a.size) : -1) || byteCompare(a.id, b.id);

/** The labels the spec asks for, in priority order, each once. Rows that are not plotted are included and later dropped as "not plotted". */
export function requestedLabels(spec: BubbleSpec): string[] {
  const plotted = spec.data.filter((d) => isPlotted(spec, d));
  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  if (spec.subject !== undefined) add(spec.subject);
  const named = new Set(spec.labels?.ids ?? []);
  spec.data
    .filter((d) => named.has(d.id))
    .sort(bySize)
    .forEach((d) => add(d.id));
  if ((spec.labels?.extremes ?? defaults.extremes) && plotted.length) {
    const pick = (better: (a: Datum, b: Datum) => boolean): string => plotted.reduce((m, d) => (better(d, m) || (!better(m, d) && byteCompare(d.id, m.id) < 0) ? d : m)).id;
    add(pick((a, b) => (a.x as number) > (b.x as number)));
    add(pick((a, b) => (a.x as number) < (b.x as number)));
    add(pick((a, b) => (a.y as number) > (b.y as number)));
    add(pick((a, b) => (a.y as number) < (b.y as number)));
  }
  plotted
    .filter((d) => finite(d.size))
    .sort(bySize)
    .slice(0, spec.labels?.topBySize ?? defaults.topBySize)
    .forEach((d) => add(d.id));
  return out;
}

/** Radius for a size: area-true against the largest |size| plotted. */
export function radius(size: number | null, maxAbs: number, cv: CanvasPreset): number {
  if (!finite(size)) return UNSIZED_RADIUS * cv.scale;
  if (maxAbs <= 0) return 0;
  return MAX_RADIUS * cv.scale * Math.sqrt(Math.abs(size) / maxAbs);
}

function marksFor(spec: BubbleSpec, frame: Frame): BubbleMark[] {
  const sx = frame.sx as (v: number) => number;
  const sy = frame.sy as (v: number) => number;
  const plotted = spec.data.filter((d) => isPlotted(spec, d));
  const maxAbs = plotted.reduce((m, d) => (finite(d.size) ? Math.max(m, Math.abs(d.size)) : m), 0);
  const marks = plotted.map(
    (d): BubbleMark => ({
      id: d.id,
      cx: sx(d.x as number),
      cy: sy(d.y as number),
      r: radius(d.size, maxAbs, frame.canvas),
      style: !finite(d.size) ? "dashed" : d.size < 0 ? "outline" : "fill",
      subject: d.id === spec.subject,
    }),
  );
  return marks.sort((a, b) => b.r - a.r || byteCompare(a.id, b.id));
}

function circleNode(m: BubbleMark, pal: Palette, cv: CanvasPreset): CircleNode {
  const w = Math.max(1, 1.5 * cv.scale);
  const signal: Paint = { color: pal.signal, opacity: 1 };
  switch (m.style) {
    case "fill":
      return m.subject ? { type: "circle", cx: m.cx, cy: m.cy, r: m.r, fill: signal } : { type: "circle", cx: m.cx, cy: m.cy, r: m.r, fill: pal.bubbleFill, stroke: pal.bubbleStroke, strokeWidth: 1 };
    case "outline":
      return { type: "circle", cx: m.cx, cy: m.cy, r: m.r, fill: null, stroke: m.subject ? signal : pal.outline, strokeWidth: w };
    case "dashed":
      return { type: "circle", cx: m.cx, cy: m.cy, r: m.r, fill: null, stroke: m.subject ? signal : pal.bubbleStroke, strokeWidth: w, dash: [3, 2] };
  }
}

const lineAdvance = (s: TextStyle): number => s.size * s.lineHeight;

/** The lines of one label: the row's label, and for the subject its note lines under it. */
function labelLines(spec: BubbleSpec, id: string, text: string, cv: CanvasPreset): LabelLine[] {
  if (id !== spec.subject) return [{ text, style: cv.label }];
  return [{ text, style: cv.subjectLabel }, ...(spec.subjectNotes ?? []).map((n) => ({ text: n, style: cv.subjectNote }))];
}

/** Box height from the first line's cap top to the last line's descent, padding excluded. */
function linesHeight(lines: LabelLine[]): number {
  const first = lines[0].style;
  const last = lines[lines.length - 1].style;
  return capHeight(first.size, first.weight) + lines.slice(1).reduce((h, l) => h + lineAdvance(l.style), 0) + descent(last.size, last.weight);
}

function labelNodes(lines: LabelLine[], p: PlacedLabel, pad: number, fill: string, halo: TextNode["halo"]): TextNode[] {
  const anchor: TextNode["anchor"] = p.side === 1 ? "start" : p.side === -1 ? "end" : "middle";
  const x = p.side === 1 ? p.box.x + pad : p.side === -1 ? p.box.x + p.box.w - pad : p.box.x + p.box.w / 2;
  let y = p.box.y + pad + capHeight(lines[0].style.size, lines[0].style.weight);
  return lines.map((l, i) => {
    if (i > 0) y += lineAdvance(l.style);
    return textNode("label", l.text, x, y, anchor, l.style, fill, { halo });
  });
}

/** Lay out the bubble chart for one canvas and theme. Pure; the input order of rows, keys and label ids does not matter. */
export function layoutBubble(input: BubbleSpec, canvasId: CanvasId, theme: Theme): BubbleLayout {
  const frame = layoutFrame(input, canvasId, theme);
  const spec = frame.spec as BubbleSpec;
  const cv = CANVASES[canvasId];
  const pal = frame.palette;
  const s = Math.max(cv.scale, 0.5);
  const halo = { ...pal.halo, width: 4 * s };
  const pad = halo.width / 2;

  const marks = marksFor(spec, frame);
  const byId = new Map(marks.map((m) => [m.id, m]));
  const names = displayLabels(spec.data);
  const requested = requestedLabels(spec);
  const lines = new Map(requested.filter((id) => byId.has(id)).map((id) => [id, labelLines(spec, id, names[id], cv)]));
  const requests = [...lines].map(([id, ls]) => ({
    id,
    w: Math.max(...ls.map((l) => measureStyled(l.text, l.style))) + 2 * pad,
    h: linesHeight(ls) + 2 * pad,
  }));
  const keepOut = [...frame.keepOut, ...frame.runs.map((r) => textBox(r.node))];
  const bubbles: Circle[] = marks.map((m) => ({ id: m.id, cx: m.cx, cy: m.cy, r: m.r }));
  const placement = placeLabels(requests, bubbles, {
    bounds: frame.plot,
    keepOut,
    max: LABEL_CAP[canvasId],
    required: spec.subject !== undefined && byId.has(spec.subject) ? [spec.subject] : [],
    gap: 3 * s,
    margin: 4 * s,
    separation: 1,
    clear: 2 * s,
    rings: RINGS.map((r) => r * Math.max(cv.scale, 0.6)),
  });
  const dropped: BubbleLayout["dropped"] = [...requested.filter((id) => !byId.has(id)).map((id) => ({ id, reason: "not plotted" as const })), ...placement.dropped];

  const leaderW = Math.max(1, 1.5 * cv.scale);
  const leaders: LineNode[] = placement.placed
    .filter((p): p is PlacedLabel & { leader: Segment } => p.leader !== null)
    .map((p) => ({ type: "line", ...p.leader, stroke: p.id === spec.subject ? { color: pal.signal, opacity: 1 } : pal.leader, strokeWidth: leaderW }));
  const text = placement.placed.flatMap((p) => labelNodes(lines.get(p.id) as LabelLine[], p, pad, p.id === spec.subject ? pal.signal : pal.text, halo));

  return {
    frame,
    marks,
    requested,
    placed: placement.placed,
    dropped,
    text: Object.fromEntries([...lines.keys()].map((id) => [id, names[id]])),
    keepOut,
    nodes: [...marks.map((m) => circleNode(m, pal, cv)), ...leaders, ...text],
  };
}
