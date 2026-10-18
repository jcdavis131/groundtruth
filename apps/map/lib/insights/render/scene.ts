// The display list between layout and SVG text. frame.ts (and, from M4b, the
// chart modules) build a Scene out of these plain records; svg.ts is the only
// code that turns one into markup. Keeping geometry as data means tests can
// assert on positions and measured widths directly instead of parsing SVG,
// and the serialiser is the single place that decides attribute order,
// number precision and where font-family goes.
//
// Coordinates are px in the canvas's own space. Text carries its measured
// width so overflow checks never re-measure.

import type { Weight } from "./metrics";
import type { Paint } from "./tokens";

export interface RectNode {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  fillOpacity?: number;
}

export interface CircleNode {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
  /** null = no fill (an outlined circle). */
  fill: Paint | null;
  stroke?: Paint;
  strokeWidth?: number;
  dash?: number[];
}

export interface LineNode {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: Paint;
  strokeWidth: number;
  dash?: number[];
}

/** What a text run is, for tests and for the chart modules' keep-out logic. */
export type TextRole = "headline" | "dek" | "tick" | "axis-title" | "reference" | "legend" | "source" | "brand" | "permalink" | "label";

export interface TextNode {
  type: "text";
  role: TextRole;
  text: string;
  /** Anchor point: the baseline, at the start, middle or end of the run per `anchor`. */
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  size: number;
  weight: Weight;
  fill: string;
  letterSpacing?: number;
  /** Degrees, about (x, y); -90 reads bottom to top. */
  rotate?: number;
  /** Drawn first as a stroke in this paint so the text reads across marks. */
  halo?: Paint & { width: number };
  /** Measured advance width, px (metrics.ts). */
  width: number;
}

export interface GroupNode {
  type: "group";
  children: SceneNode[];
}

export type SceneNode = RectNode | CircleNode | LineNode | TextNode | GroupNode;

/** A <pattern> in <defs>, referenced by fill="url(#<prefix>-<id>)". */
export interface PatternDef {
  id: string;
  w: number;
  h: number;
  children: RectNode[];
}

export interface Scene {
  width: number;
  height: number;
  /** Prefix for every id in the document, from the spec hash, so two charts on one page never collide. */
  idPrefix: string;
  /** <title>: the headline. */
  title: string;
  /** <desc>: a fixed template over the data (table.ts describe()). */
  desc: string;
  defs: PatternDef[];
  nodes: SceneNode[];
}

/** Every text node in draw order, groups flattened. */
export function textNodes(nodes: SceneNode[]): TextNode[] {
  const out: TextNode[] = [];
  const walk = (list: SceneNode[]) => {
    for (const n of list) {
      if (n.type === "text") out.push(n);
      else if (n.type === "group") walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Horizontal extent of a text run as laid out (unrotated runs only). */
export function textSpan(t: TextNode): { x0: number; x1: number } {
  const x0 = t.anchor === "start" ? t.x : t.anchor === "middle" ? t.x - t.width / 2 : t.x - t.width;
  return { x0, x1: x0 + t.width };
}
