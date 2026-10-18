// Scene -> SVG text. The only place markup is written, so the determinism
// rules live here:
//   - every number goes through f2(): rounded to 0.01, trailing zeros dropped,
//     never "-0", never NaN (a non-finite coordinate is a layout bug and throws);
//   - attributes are emitted in insertion order, one element per line;
//   - ids are a prefix taken from the spec hash (frame.ts), so two charts on
//     one page - the inline-wide and inline-narrow variants of the same spec
//     are both in the DOM - never share an id;
//   - text is XML-escaped with lib/feed/hash.ts escapeXml.
//
// font-family is set once, on the root <svg>, and never on a <text>. Inline
// variants use the page's stack (`var(--font-display)`: Next's font loader
// registers Geist under a hashed family name, and a per-element
// font-family="Geist" would override the inherited stack and drop to the
// browser default, so the measured label boxes would stop matching). The standalone SVG names Geist
// and embeds no font; layout fidelity is guaranteed only in the PNG, which is
// rasterised with the vendored TTFs as its only fonts.

import { escapeXml } from "@/lib/feed/hash";
import type { CircleNode, LineNode, PatternDef, RectNode, Scene, SceneNode, TextNode } from "./scene";

/** The font stack an inline chart inherits from a document page. */
export const INLINE_FONT_STACK = "var(--font-display),Geist,system-ui,sans-serif";
/** The font family of a standalone or rasterised chart. */
export const STANDALONE_FONT_STACK = "Geist,system-ui,sans-serif";

/** A coordinate or size: 0.01 px precision, shortest form. */
export function f2(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite number in SVG output: ${v}`);
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) || r === 0 ? "0" : String(r);
}

type Attr = string | number | null | undefined;

/** Attributes in the order given, numbers through f2, strings escaped, null/undefined skipped. */
function attrs(a: Record<string, Attr>): string {
  let s = "";
  for (const [k, v] of Object.entries(a)) {
    if (v == null) continue;
    s += ` ${k}="${typeof v === "number" ? f2(v) : escapeXml(v)}"`;
  }
  return s;
}

/** One element: self-closing without `inner`, else wrapping it (already escaped markup). */
export function el(tag: string, a: Record<string, Attr>, inner?: string): string {
  return inner === undefined ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${inner}</${tag}>`;
}

const dash = (d: number[] | undefined): string | undefined => (d && d.length ? d.map(f2).join(" ") : undefined);
/** Opacity 1 is the SVG default; leave it out. */
const op = (o: number | undefined): number | undefined => (o === undefined || o === 1 ? undefined : o);

function rect(n: RectNode): string {
  return el("rect", { x: n.x, y: n.y, width: n.w, height: n.h, fill: n.fill, "fill-opacity": op(n.fillOpacity) });
}

function circle(n: CircleNode): string {
  return el("circle", {
    cx: n.cx,
    cy: n.cy,
    r: n.r,
    fill: n.fill ? n.fill.color : "none",
    "fill-opacity": n.fill ? op(n.fill.opacity) : undefined,
    stroke: n.stroke?.color,
    "stroke-opacity": n.stroke ? op(n.stroke.opacity) : undefined,
    "stroke-width": n.stroke ? (n.strokeWidth ?? 1) : undefined,
    "stroke-dasharray": dash(n.dash),
  });
}

function line(n: LineNode): string {
  return el("line", {
    x1: n.x1,
    y1: n.y1,
    x2: n.x2,
    y2: n.y2,
    stroke: n.stroke.color,
    "stroke-opacity": op(n.stroke.opacity),
    "stroke-width": n.strokeWidth,
    "stroke-dasharray": dash(n.dash),
  });
}

function text(n: TextNode): string {
  const base = {
    x: n.x,
    y: n.y,
    "font-size": n.size,
    "font-weight": n.weight,
    "text-anchor": n.anchor === "start" ? undefined : n.anchor,
    "letter-spacing": n.letterSpacing,
    transform: n.rotate ? `rotate(${f2(n.rotate)} ${f2(n.x)} ${f2(n.y)})` : undefined,
  };
  const body = escapeXml(n.text);
  const fill = el("text", { ...base, fill: n.fill }, body);
  if (!n.halo) return fill;
  const halo = el("text", { ...base, fill: "none", stroke: n.halo.color, "stroke-opacity": op(n.halo.opacity), "stroke-width": n.halo.width, "stroke-linejoin": "round" }, body);
  return `${halo}\n${fill}`;
}

function node(n: SceneNode, out: string[]): void {
  switch (n.type) {
    case "rect":
      out.push(rect(n));
      return;
    case "circle":
      out.push(circle(n));
      return;
    case "line":
      out.push(line(n));
      return;
    case "text":
      out.push(text(n));
      return;
    case "group":
      out.push("<g>");
      for (const c of n.children) node(c, out);
      out.push("</g>");
      return;
  }
}

function pattern(p: PatternDef, prefix: string): string {
  return el("pattern", { id: `${prefix}-${p.id}`, width: p.w, height: p.h, patternUnits: "userSpaceOnUse" }, p.children.map(rect).join(""));
}

export interface SvgOptions {
  /** Inline on a document page: width 100 %, the page's font stack, a data-canvas hook for the CSS toggle. */
  inline: boolean;
  canvas: string;
}

/** The document. Same scene and options, same bytes. */
export function toSvg(scene: Scene, opts: SvgOptions): string {
  const p = scene.idPrefix;
  const viewBox = `0 0 ${f2(scene.width)} ${f2(scene.height)}`;
  const rootAttrs: Record<string, Attr> = opts.inline
    ? { xmlns: "http://www.w3.org/2000/svg", width: "100%", viewBox, role: "img", "aria-labelledby": `${p}-t ${p}-d`, "data-canvas": opts.canvas, style: `font-family:${INLINE_FONT_STACK}` }
    : { xmlns: "http://www.w3.org/2000/svg", width: scene.width, height: scene.height, viewBox, role: "img", "aria-labelledby": `${p}-t ${p}-d`, "font-family": STANDALONE_FONT_STACK };
  const out: string[] = [];
  out.push(`<svg${attrs(rootAttrs)}>`);
  out.push(el("title", { id: `${p}-t` }, escapeXml(scene.title)));
  out.push(el("desc", { id: `${p}-d` }, escapeXml(scene.desc)));
  if (scene.defs.length) out.push(`<defs>${scene.defs.map((d) => pattern(d, p)).join("")}</defs>`);
  for (const n of scene.nodes) node(n, out);
  out.push("</svg>");
  return out.join("\n") + "\n";
}
