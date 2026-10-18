// The chart's chrome, laid out by measurement: background and grain, the
// headline and dek, the axes (gridlines at fixed or nice steps, tick labels,
// titles, reference lines), the legend line, the universe / source / method
// lines and the brand footer with the permalink. It returns the plot
// rectangle and the scales; the chart modules (M4b) draw their marks into it
// and the scene is assembled as under + marks + over.
//
// Two layouts:
//   stack (social, inline)  headline and dek from the top; brand, source lines,
//                           legend, x title and x ticks from the bottom up;
//                           the plot takes what is left. The first design
//                           placed these at fixed y positions and the x title
//                           overprinted the legend; bottom-up cannot.
//   split (og)              a text column on the left (headline from the top;
//                           brand and source lines from the bottom), the plot,
//                           its axes and the legend on the right.
//
// Gutters are measured, never fixed: the left gutter is the rotated y title
// plus the widest y tick label as formatted, so "+100%" or "$1,250,000" ticks
// cannot collide with the title; the right edge gives the last x tick label
// half its width. Where both axes start at the bottom-left corner, their two
// corner tick labels would crowd; the y one yields (cornerTicks).
//
// The headline steps down its ladder until the plot is at least minPlot tall
// (stack) or the column holds headline and notes (split); past the ladder it
// throws. Nothing is truncated. Text the font does not map throws too: a
// width cannot be measured for a glyph that is not there.
//
// The source line on the image is compact by design: one line per source
// (publisher, programme, periods, and the exact URL when the source cites one
// file, else the longest "/"-bounded prefix its files share), then each
// distinct estimate method once. lib/provenance citation() for every record,
// with every full URL, is in the data table (table.ts). Lines break at
// spaces, then inside URLs at "/" (metrics.ts wrapSource), so no run is ever
// wider than its column.

import { num } from "@/lib/brief/format";
import { stableHash } from "@/lib/feed/hash";
import { CANVASES, type CanvasId, type CanvasPreset } from "./canvas";
import { balancedWrap, capHeight, descent, fitsWidth, headlineAt, measureStyled, unmapped, wrapSource, type FittedHeadline, type TextStyle } from "./metrics";
import { boxesOverlap } from "./place";
import { numericAxis, scaleLinear, type NumericAxis } from "./scale";
import { textSpan, type CircleNode, type LineNode, type PatternDef, type RectNode, type Scene, type SceneNode, type TextNode, type TextRole } from "./scene";
import { byteCompare, canonicalJson, canonicalSpec, type ChartSpec } from "./spec";
import { toSvg } from "./svg";
import { describe, isPlotted } from "./table";
import { GRAIN, PALETTES, type Palette, type Theme } from "./tokens";

/** The brand mark, left of the footer. */
export const BRAND = "EMBEDDING ATLAS";
/** The site the permalink lives on. */
export const SITE = "eye.jcamd.com";

/** The chart's permanent page, as printed (no scheme). */
export function permalink(spec: Pick<ChartSpec, "slug">): string {
  return `${SITE}/insights/${spec.slug}`;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LegendItem {
  glyph: "signal" | "bubble" | "outline" | "dashed" | "none";
  text: string;
  muted?: boolean;
}

export interface FrameAxes {
  x?: NumericAxis;
  y?: NumericAxis;
}

/** A laid-out text run and the horizontal band it must stay inside (null for rotated runs). */
export interface TextRun {
  node: TextNode;
  limit: { x0: number; x1: number } | null;
}

export interface Frame {
  /** The spec in canonical order (spec.ts canonicalSpec). */
  spec: ChartSpec;
  canvas: CanvasPreset;
  theme: Theme;
  palette: Palette;
  idPrefix: string;
  headline: FittedHeadline | null;
  axes: FrameAxes;
  plot: Box;
  /** Data -> px; null on an axis the chart does not have. */
  sx: ((v: number) => number) | null;
  sy: ((v: number) => number) | null;
  /** Boxes inside the plot that labels must not cover (reference-line labels). */
  keepOut: Box[];
  /** Background, grain, gridlines and reference lines: drawn before the marks. */
  under: SceneNode[];
  /** Every text run and the legend: drawn after the marks. */
  over: SceneNode[];
  defs: PatternDef[];
  runs: TextRun[];
}

const lh = (s: TextStyle): number => s.size * s.lineHeight;
const cap = (s: TextStyle): number => capHeight(s.size, s.weight);
const desc = (s: TextStyle): number => descent(s.size, s.weight);

/** From the first line's cap top to the last line's descent. */
function blockHeight(lines: number, s: TextStyle): number {
  return lines === 0 ? 0 : cap(s) + (lines - 1) * lh(s) + desc(s);
}

function hex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** A measured text run; throws on any character the vendored font does not map. */
export function textNode(role: TextRole, text: string, x: number, y: number, anchor: TextNode["anchor"], style: TextStyle, fill: string, extra: Partial<TextNode> = {}): TextNode {
  const bad = unmapped(text, style.weight);
  if (bad.length) throw new Error(`${role} text uses characters the vendored font does not map (${bad.map(hex).join(", ")}): "${text}"`);
  const node: TextNode = { type: "text", role, text, x, y, anchor, size: style.size, weight: style.weight, fill, width: measureStyled(text, style), ...extra };
  if (style.letterSpacing) node.letterSpacing = style.letterSpacing;
  return node;
}

/**
 * The box a laid-out run occupies: cap top to descent, across its measured
 * width. A run rotated -90 (the y title) reads bottom to top, so an
 * end-anchored one runs down the page from its anchor: its box spans y to
 * y + width, and from cap height left of x to the descent right of it.
 */
export function textBox(t: TextNode): Box {
  const c = capHeight(t.size, t.weight);
  const d = descent(t.size, t.weight);
  if (t.rotate === -90) {
    const y0 = t.anchor === "end" ? t.y : t.anchor === "middle" ? t.y - t.width / 2 : t.y - t.width;
    return { x: t.x - c, y: y0, w: c + d, h: t.width };
  }
  const span = textSpan(t);
  return { x: span.x0, y: t.y - c, w: t.width, h: c + d };
}

/** "a", "a and b", "a, b and c". */
function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

const stripScheme = (u: string): string => u.replace(/^https?:\/\//, "");

/** One URL as is; several: their longest common prefix cut back to a "/", else their distinct hosts. */
function where(urls: string[]): string {
  const us = [...new Set(urls.map(stripScheme))].sort(byteCompare);
  if (us.length === 1) return us[0];
  let n = 0;
  while (us.every((u) => n < u.length && u[n] === us[0][n])) n++;
  const prefix = us[0].slice(0, us[0].lastIndexOf("/", n - 1) + 1);
  if (prefix.includes("/")) return prefix;
  return joinList([...new Set(us.map((u) => u.split("/")[0]))]);
}

/**
 * The notes under the chart, as paragraphs: the universe, the sources, then
 * each estimate method once. Built only from spec fields; the renderer adds
 * the fixed words "Source(s)" and "Computed by Embedding Atlas".
 */
export function sourceParagraphs(spec: ChartSpec): string[] {
  interface Group {
    publisher: string;
    name: string;
    fallbackUrl: string;
    periods: Set<string>;
    urls: string[];
  }
  const groups = new Map<string, Group>();
  const methods: string[] = [];
  for (const key of Object.keys(spec.provenance).sort(byteCompare)) {
    const p = spec.provenance[key];
    let g = groups.get(p.source.id);
    if (!g) {
      g = { publisher: p.source.publisher, name: p.source.name, fallbackUrl: p.source.url, periods: new Set(), urls: [] };
      groups.set(p.source.id, g);
    }
    if (p.kind === "estimate") {
      const m = (p.method ?? "").trim();
      if (m && !methods.includes(m)) methods.push(m);
      continue;
    }
    if (p.period) g.periods.add(p.period);
    if (p.upstreamUrl) g.urls.push(p.upstreamUrl);
  }
  const parts = [...groups.values()].map((g) => {
    const periods = [...g.periods].sort(byteCompare);
    return [`${g.publisher}, ${g.name}`, periods.length ? joinList(periods) : null, where(g.urls.length ? g.urls : [g.fallbackUrl])].filter(Boolean).join(", ");
  });
  return [sentence(spec.universe), `${parts.length === 1 ? "Source" : "Sources"}: ${sentence(parts.join("; "))}`, ...methods.map((m) => `Computed by Embedding Atlas: ${sentence(m)}`)];
}

/** Legend entries: the subject, the size key, the outline key when a negative size is drawn, and the count of rows not plotted. */
export function legendItems(spec: ChartSpec): LegendItem[] {
  const items: LegendItem[] = [];
  const plotted = spec.data.filter((d) => isPlotted(spec, d));
  const subject = plotted.find((d) => d.id === spec.subject);
  if (subject) items.push({ glyph: "signal", text: subject.label });
  if (spec.kind === "bubble") {
    const rows = plotted as Array<(typeof spec.data)[number]>;
    items.push({ glyph: "bubble", text: `Bubble size = ${spec.size.label}` });
    if (rows.some((d) => d.size != null && d.size < 0)) items.push({ glyph: "outline", text: "Outline = negative" });
    const noSize = rows.filter((d) => d.size == null).length;
    if (noSize) items.push({ glyph: "dashed", text: `${num(noSize)} with size not published` });
  }
  const missing = spec.data.length - plotted.length;
  if (missing) items.push({ glyph: "none", text: `${num(missing)} of ${num(spec.data.length)} not published`, muted: true });
  return items;
}

/** The numeric axes a chart kind has, from its plotted values. */
export function axesFor(spec: ChartSpec): FrameAxes {
  const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
  switch (spec.kind) {
    case "bubble": {
      const rows = spec.data.filter((d) => fin(d.x) && fin(d.y));
      return { x: numericAxis(spec.x, rows.map((d) => d.x)), y: numericAxis(spec.y, rows.map((d) => d.y)) };
    }
    case "slope":
      return { y: numericAxis(spec.y, spec.data.flatMap((d) => [d.from, d.to])) };
    case "bar":
      return { x: numericAxis(spec.value, spec.data.map((d) => d.value)) };
    case "line":
      return { y: numericAxis(spec.y, spec.data.flatMap((d) => d.series.map((p) => p.v))) };
  }
}

/** The grain tile: GRAIN.specks one-pixel specks from a fixed-seed LCG, so every render is the same texture. */
function grainPattern(palette: Palette): PatternDef {
  let s = GRAIN.seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const children: RectNode[] = [];
  for (let i = 0; i < GRAIN.specks; i++) {
    const x = Math.floor(next() * GRAIN.tile);
    const y = Math.floor(next() * GRAIN.tile);
    const o = GRAIN.minOpacity + next() * (GRAIN.maxOpacity - GRAIN.minOpacity);
    children.push({ type: "rect", x, y, w: 1, h: 1, fill: palette.grain, fillOpacity: o });
  }
  return { id: "grain", w: GRAIN.tile, h: GRAIN.tile, children };
}

interface Placed {
  nodes: SceneNode[];
  runs: TextRun[];
  top: number;
}

/** Lines whose last descent ends at `bottom`, left-aligned at x0. */
function linesUp(role: TextRole, lines: string[], x0: number, width: number, bottom: number, style: TextStyle, fill: string): Placed {
  const top = bottom - blockHeight(lines.length, style);
  const runs = lines.map((l, i) => ({ node: textNode(role, l, x0, top + cap(style) + i * lh(style), "start", style, fill), limit: { x0, x1: x0 + width } }));
  return { nodes: runs.map((r) => r.node), runs, top };
}

/** The brand row: "EMBEDDING ATLAS" left, the permalink right; when they do not fit one row, the permalink moves under the brand. */
function brandBlock(spec: ChartSpec, cv: CanvasPreset, pal: Palette, x0: number, width: number, bottom: number): Placed {
  const brand = cv.brand;
  const perm = cv.permalink;
  if (!brand || !perm) return { nodes: [], runs: [], top: bottom };
  const link = permalink(spec);
  const limit = { x0, x1: x0 + width };
  if (measureStyled(BRAND, brand) + 24 + measureStyled(link, perm) <= width) {
    const baseline = bottom - Math.max(desc(brand), desc(perm));
    const b = textNode("brand", BRAND, x0, baseline, "start", brand, pal.ink);
    const p = textNode("permalink", link, x0 + width, baseline, "end", perm, pal.muted);
    return { nodes: [b, p], runs: [{ node: b, limit }, { node: p, limit }], top: baseline - Math.max(cap(brand), cap(perm)) };
  }
  const links = linesUp("permalink", wrapSource(link, width, perm), x0, width, bottom, perm, pal.muted);
  const baseline = links.top - 8 - desc(brand);
  const b = textNode("brand", BRAND, x0, baseline, "start", brand, pal.ink);
  return { nodes: [b, ...links.nodes], runs: [{ node: b, limit }, ...links.runs], top: baseline - cap(brand) };
}

function sourceBlock(spec: ChartSpec, cv: CanvasPreset, pal: Palette, x0: number, width: number, bottom: number): Placed {
  const lines = sourceParagraphs(spec).flatMap((p) => wrapSource(p, width, cv.source));
  return linesUp("source", lines, x0, width, bottom, cv.source, pal.muted);
}

function glyphNode(glyph: LegendItem["glyph"], cx: number, cy: number, r: number, pal: Palette, cv: CanvasPreset): CircleNode | null {
  const w = Math.max(1, 1.5 * cv.scale);
  switch (glyph) {
    case "signal":
      return { type: "circle", cx, cy, r, fill: { color: pal.signal, opacity: 1 } };
    case "bubble":
      return { type: "circle", cx, cy, r, fill: pal.bubbleFill, stroke: pal.bubbleStroke, strokeWidth: 1 };
    case "outline":
      return { type: "circle", cx, cy, r, fill: null, stroke: pal.outline, strokeWidth: w };
    case "dashed":
      return { type: "circle", cx, cy, r, fill: null, stroke: pal.bubbleStroke, strokeWidth: w, dash: [3, 2] };
    case "none":
      return null;
  }
}

/**
 * Legend rows ending at `bottom`: items flow along a row and wrap to the
 * next. An item too wide for the band wraps inside itself (wrapSource) and
 * takes a row of its own, never running past the band.
 */
function legendBlock(items: LegendItem[], cv: CanvasPreset, pal: Palette, x0: number, width: number, bottom: number): Placed {
  if (!items.length) return { nodes: [], runs: [], top: bottom };
  const s = cv.legend;
  const r = (s.size * 0.8) / 2;
  const swatch = 2 * r + 8;
  const itemGap = 24 * Math.max(cv.scale, 0.5);
  type Laid = { item: LegendItem; lines: string[]; w: number };
  const laid: Laid[] = items.map((item) => {
    const textW = width - (item.glyph === "none" ? 0 : swatch);
    const lines = wrapSource(item.text, textW, s);
    return { item, lines, w: (item.glyph === "none" ? 0 : swatch) + Math.max(...lines.map((l) => measureStyled(l, s))) };
  });
  const rows: Laid[][] = [];
  let used = 0;
  for (const l of laid) {
    const row = rows[rows.length - 1];
    if (row && l.lines.length === 1 && row.every((x) => x.lines.length === 1) && used + itemGap + l.w <= width) {
      row.push(l);
      used += itemGap + l.w;
    } else {
      rows.push([l]);
      used = l.w;
    }
  }
  const totalLines = rows.reduce((n, row) => n + Math.max(...row.map((l) => l.lines.length)), 0);
  const top = bottom - blockHeight(totalLines, s);
  const nodes: SceneNode[] = [];
  const runs: TextRun[] = [];
  let line = 0;
  for (const row of rows) {
    let x = x0;
    const baseline0 = top + cap(s) + line * lh(s);
    for (const l of row) {
      const g = glyphNode(l.item.glyph, x + r, baseline0 - cap(s) / 2, r, pal, cv);
      if (g) nodes.push(g);
      const tx = x + (g ? swatch : 0);
      l.lines.forEach((text, i) => {
        const node = textNode("legend", text, tx, baseline0 + i * lh(s), "start", s, l.item.muted ? pal.muted : pal.text);
        nodes.push(node);
        runs.push({ node, limit: { x0, x1: x0 + width } });
      });
      x += l.w + itemGap;
    }
    line += Math.max(...row.map((l) => l.lines.length));
  }
  return { nodes, runs, top };
}

interface AxesLayout {
  plot: Box;
  sx: ((v: number) => number) | null;
  sy: ((v: number) => number) | null;
  under: SceneNode[];
  over: SceneNode[];
  runs: TextRun[];
  keepOut: Box[];
}

const ARROW = " →";

/**
 * The bottom-left corner, where the first x tick label and the lowest y tick
 * label meet. On a chart whose axes both start at the corner the two sit on
 * the same point and crowd: the flagship's two "-20%" runs overlapped by
 * 3 px at 20 px type. The x row never moves; the y label yields. When it
 * repeats the x label's text it is dropped, so the corner value reads once
 * for both axes (its gridline stays); otherwise it moves up until its box
 * clears the x label's by `sep` px. Labels that do not crowd are left alone.
 */
function cornerTicks(xTicks: TextNode[], yTicks: TextNode[], sep: number): TextNode[] {
  if (!xTicks.length || !yTicks.length) return yTicks;
  const x = xTicks.reduce((a, b) => (b.x < a.x ? b : a));
  const y = yTicks.reduce((a, b) => (b.y > a.y ? b : a));
  const xb = textBox(x);
  const yb = textBox(y);
  if (!boxesOverlap(xb, yb, sep)) return yTicks;
  if (x.text === y.text) return yTicks.filter((n) => n !== y);
  const lift = yb.y + yb.h + sep - xb.y;
  return yTicks.map((n) => (n === y ? { ...n, y: n.y - lift } : n));
}

/**
 * Axes inside a region: rotated y title and y ticks in a measured left gutter,
 * x ticks and the x title from the region's bottom up, gridlines at every
 * tick, reference lines over the grid. The y title's line count depends on
 * the plot height, which depends on the x title's line count, which depends
 * on the plot width; two passes settle it.
 */
function layoutAxes(axes: FrameAxes, region: { x0: number; x1: number; y0: number; y1: number }, cv: CanvasPreset, pal: Palette): AxesLayout {
  const t = cv.tick;
  const at = cv.axisTitle;
  const g = cv.gaps.tick;
  const yTickW = axes.y ? Math.max(...axes.y.ticks.map((k) => measureStyled(k.label, t))) : 0;
  const xFirst = axes.x?.ticks[0];
  const xLast = axes.x?.ticks[axes.x.ticks.length - 1];
  const plotTop = region.y0 + (axes.y ? cap(t) / 2 : 0);
  const plotRight = region.x1 - (xLast ? measureStyled(xLast.label, t) / 2 : 0);
  const yTitle = axes.y ? axes.y.title + ARROW : "";
  const xTitle = axes.x ? axes.x.title + ARROW : "";

  let yLines = axes.y ? [yTitle] : [];
  let xLines: string[] = [];
  let plotLeft = region.x0;
  let plotBottom = region.y1;
  for (let pass = 0; pass < 3; pass++) {
    plotLeft = axes.y ? region.x0 + cap(at) + (yLines.length - 1) * lh(at) + desc(at) + 12 + yTickW + g : region.x0 + (xFirst ? measureStyled(xFirst.label, t) / 2 : 0);
    xLines = axes.x ? wrapSource(xTitle, plotRight - plotLeft, at) : [];
    plotBottom = axes.x ? region.y1 - blockHeight(xLines.length, at) - g - (cap(t) + desc(t)) - g : region.y1 - (axes.y ? cap(t) / 2 : 0);
    const next = axes.y ? wrapSource(yTitle, plotBottom - plotTop, at) : [];
    if (next.length === yLines.length) {
      yLines = next;
      break;
    }
    yLines = next;
  }
  const plot: Box = { x: plotLeft, y: plotTop, w: plotRight - plotLeft, h: plotBottom - plotTop };
  const sx = axes.x ? scaleLinear(axes.x.domain, [plotLeft, plotRight]) : null;
  const sy = axes.y ? scaleLinear(axes.y.domain, [plotBottom, plotTop]) : null;

  const under: SceneNode[] = [];
  const over: SceneNode[] = [];
  const runs: TextRun[] = [];
  const keepOut: Box[] = [];
  const gridW = 1;
  const refW = Math.max(1, 1.5 * cv.scale);
  const push = (node: TextNode, limit: TextRun["limit"]) => {
    over.push(node);
    runs.push({ node, limit });
  };

  const xTicks = axes.x && sx ? axes.x.ticks.map((k) => textNode("tick", k.label, sx(k.value), plotBottom + g + cap(t), "middle", t, pal.muted)) : [];
  const yTicks = axes.y && sy ? cornerTicks(xTicks, axes.y.ticks.map((k) => textNode("tick", k.label, plotLeft - g, sy(k.value) + cap(t) / 2, "end", t, pal.muted)), g / 2) : [];
  if (axes.x && sx) {
    for (const k of axes.x.ticks) {
      const x = sx(k.value);
      under.push({ type: "line", x1: x, y1: plotTop, x2: x, y2: plotBottom, stroke: pal.grid, strokeWidth: gridW });
    }
    for (const node of xTicks) push(node, { x0: region.x0, x1: region.x1 });
    const titleTop = region.y1 - blockHeight(xLines.length, at);
    xLines.forEach((l, i) => push(textNode("axis-title", l, plotRight, titleTop + cap(at) + i * lh(at), "end", at, pal.text), { x0: plotLeft, x1: plotRight }));
  }
  if (axes.y && sy) {
    for (const k of axes.y.ticks) {
      const y = sy(k.value);
      under.push({ type: "line", x1: plotLeft, y1: y, x2: plotRight, y2: y, stroke: pal.grid, strokeWidth: gridW });
    }
    for (const node of yTicks) push(node, { x0: region.x0, x1: plotLeft });
    yLines.forEach((l, i) => push(textNode("axis-title", l, region.x0 + cap(at) + i * lh(at), plotTop, "end", at, pal.text, { rotate: -90 }), null));
  }

  const halo = { ...pal.halo, width: 4 * Math.max(cv.scale, 0.5) };
  const refLine = (x1: number, y1: number, x2: number, y2: number): LineNode => ({ type: "line", x1, y1, x2, y2, stroke: pal.reference, strokeWidth: refW });
  for (const r of axes.x?.reference ?? []) {
    if (!sx) break;
    const x = sx(r.value);
    under.push(refLine(x, plotTop, x, plotBottom));
    if (r.label) {
      const node = textNode("reference", r.label, x + 5, plotTop + cap(t) + 5, "start", t, pal.muted, { halo });
      push(node, { x0: plotLeft, x1: plotRight });
      keepOut.push({ x: node.x, y: plotTop + 5, w: node.width, h: cap(t) + desc(t) });
    }
  }
  for (const r of axes.y?.reference ?? []) {
    if (!sy) break;
    const y = sy(r.value);
    under.push(refLine(plotLeft, y, plotRight, y));
    if (r.label) {
      const node = textNode("reference", r.label, plotRight - 5, y - 5, "end", t, pal.muted, { halo });
      push(node, { x0: plotLeft, x1: plotRight });
      keepOut.push({ x: node.x - node.width, y: y - 5 - cap(t), w: node.width, h: cap(t) + desc(t) });
    }
  }
  return { plot, sx, sy, under, over, runs, keepOut };
}

/** Lines of the headline from `top`, left-aligned at x0. */
function headlineBlock(fit: FittedHeadline, cv: CanvasPreset, pal: Palette, x0: number, width: number, top: number): Placed {
  const hs = cv.headline as NonNullable<CanvasPreset["headline"]>;
  const style: TextStyle = { size: fit.size, weight: hs.weight, lineHeight: hs.lineHeight };
  const runs = fit.lines.map((l, i) => ({ node: textNode("headline", l, x0, top + cap(style) + i * lh(style), "start", style, pal.ink), limit: { x0, x1: x0 + width } }));
  return { nodes: runs.map((r) => r.node), runs, top: top + blockHeight(fit.lines.length, style) };
}

function dekBlock(dek: string, cv: CanvasPreset, pal: Palette, x0: number, width: number, top: number): Placed {
  const s = cv.dek as TextStyle;
  const balanced = balancedWrap(dek, width, s);
  const lines = fitsWidth(balanced, width, s) ? balanced : wrapSource(dek, width, s);
  const runs = lines.map((l, i) => ({ node: textNode("dek", l, x0, top + cap(s) + i * lh(s), "start", s, pal.muted), limit: { x0, x1: x0 + width } }));
  return { nodes: runs.map((r) => r.node), runs, top: top + blockHeight(lines.length, s) };
}

/**
 * Lay out the frame for one spec on one canvas in one theme. `axes` defaults
 * to axesFor(spec); a chart module may pass its own. Pure: no clock, no I/O,
 * and the input order of data and provenance does not matter.
 */
export function layoutFrame(input: ChartSpec, canvasId: CanvasId, theme: Theme, axes?: FrameAxes): Frame {
  const spec = canonicalSpec(input);
  const cv = CANVASES[canvasId];
  const pal = PALETTES[theme];
  const ax = axes ?? axesFor(spec);
  const idPrefix = `i${stableHash(`${canonicalJson(spec)}|${cv.id}|${theme}`)}`;
  const M = cv.margin;
  const W = cv.width;
  const H = cv.height;
  const legend = legendItems(spec);
  const grain = grainPattern(pal);
  const background: SceneNode[] = [
    { type: "rect", x: 0, y: 0, w: W, h: H, fill: pal.bg },
    { type: "rect", x: 0, y: 0, w: W, h: H, fill: `url(#${idPrefix}-${grain.id})` },
  ];

  // Notes, bottom-up. Brand and source lines sit in the text column; the
  // legend sits above them in the stack layout and under the plot in the
  // split one, where the column has no height to spare and the key belongs
  // with the marks anyway.
  const colX = M;
  const colW = cv.column;
  const split = cv.layout === "split";
  const plotX0 = split ? M + cv.column + cv.columnGap : M;
  const brand = brandBlock(spec, cv, pal, colX, colW, H - M);
  const source = sourceBlock(spec, cv, pal, colX, colW, brand.nodes.length ? brand.top - cv.gaps.block : H - M);
  const leg = split ? legendBlock(legend, cv, pal, plotX0, W - M - plotX0, H - M) : legendBlock(legend, cv, pal, colX, colW, source.top - cv.gaps.block);
  const notesTop = split ? source.top - cv.gaps.block : leg.top - cv.gaps.block;

  let headline: Placed | null = null;
  let fit: FittedHeadline | null = null;
  let ax2: AxesLayout | null = null;
  let dek: Placed | null = null;
  const ladder: Array<number | null> = cv.headline ? cv.headline.ladder : [null];
  const tried: string[] = [];
  for (const size of ladder) {
    fit = null;
    headline = null;
    dek = null;
    let top = M;
    if (size !== null && cv.headline) {
      fit = headlineAt(spec.headline, size, cv.headline.maxLines, colW, cv.headline.weight, cv.headline.lineHeight);
      if (!fit) {
        tried.push(`${size} px: more than ${cv.headline.maxLines} lines`);
        continue;
      }
      headline = headlineBlock(fit, cv, pal, colX, colW, top);
      top = headline.top;
    }
    if (split) {
      if (top + cv.gaps.headline > notesTop) {
        tried.push(`${size} px: column overflows by ${Math.ceil(top + cv.gaps.headline - notesTop)} px`);
        continue;
      }
      ax2 = layoutAxes(ax, { x0: plotX0, x1: W - M, y0: M, y1: leg.top - cv.gaps.block }, cv, pal);
    } else {
      if (cv.dek && spec.dek) {
        dek = dekBlock(spec.dek, cv, pal, colX, colW, headline ? top + cv.gaps.headline : top);
        top = dek.top;
      }
      if (headline || dek) top += cv.gaps.dek;
      ax2 = layoutAxes(ax, { x0: M, x1: W - M, y0: top, y1: notesTop }, cv, pal);
    }
    if (ax2.plot.h >= cv.minPlot) break;
    tried.push(`${size ?? "no headline"}: plot ${Math.floor(ax2.plot.h)} px tall, under ${cv.minPlot}`);
    ax2 = null;
  }
  if (!ax2) throw new Error(`chart "${spec.slug}" does not fit the ${cv.id} canvas (${tried.join("; ")})`);

  const runs: TextRun[] = [...(headline?.runs ?? []), ...(dek?.runs ?? []), ...ax2.runs, ...leg.runs, ...source.runs, ...brand.runs];
  return {
    spec,
    canvas: cv,
    theme,
    palette: pal,
    idPrefix,
    headline: fit,
    axes: ax,
    plot: ax2.plot,
    sx: ax2.sx,
    sy: ax2.sy,
    keepOut: ax2.keepOut,
    under: [...background, ...ax2.under],
    over: [...(headline?.nodes ?? []), ...(dek?.nodes ?? []), ...ax2.over, ...leg.nodes, ...source.nodes, ...brand.nodes],
    defs: [grain],
    runs,
  };
}

/** The scene: frame under the marks, frame text over them. */
export function frameScene(frame: Frame, marks: SceneNode[] = []): Scene {
  return {
    width: frame.canvas.width,
    height: frame.canvas.height,
    idPrefix: frame.idPrefix,
    title: frame.spec.headline,
    desc: describe(frame.spec),
    defs: frame.defs,
    nodes: [...frame.under, ...marks, ...frame.over],
  };
}

/** The frame (and any marks) as an SVG document for its canvas. */
export function frameSvg(frame: Frame, marks: SceneNode[] = []): string {
  return toSvg(frameScene(frame, marks), { inline: frame.canvas.inline, canvas: frame.canvas.id });
}
