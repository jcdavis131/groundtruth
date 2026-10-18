// Colour tokens per theme, and the contrast arithmetic that keeps them honest.
//
// Dark is the social card (app/globals.css :root: background #05070a,
// foreground #c9d1d9, muted #7d8894, signal #ffa458, bright #eef3f7). Light is
// the document pages and the desk light theme (#f4f6f8 / #16202a / #4a5563,
// signal #a64b00, bright #0d1620). Same roles, so a chart reads the same in
// both.
//
// Every colour that carries information is a solid hex plus an opacity, never
// an rgba() string, so contrast can be computed from the token itself: the
// colour is composited over the theme background and compared with WCAG 2.x
// relative luminance (tokens.test.ts). Text tokens clear 4.5:1; marks that a
// reader has to see (bubble outlines, leaders, reference lines, the subject)
// clear 3:1 (WCAG 1.4.11, non-text contrast). The verifier measured the
// render lane's first light palette at 2.28:1 (bubble stroke #4a5563 at 0.5)
// and 2.77:1 (leader #16202a at 0.45); both are raised here. Bubble fill and
// gridlines are decoration and are exempt: a bubble's edge is its stroke.
//
// The background grain is 70 one-pixel specks per 64 px tile at opacity
// 0.03-0.08, placed by a fixed-seed LCG (frame.ts). It moves the background by
// well under one luminance step, so contrast is measured against the plain
// background colour.

export type Theme = "dark" | "light";
export const THEMES: Theme[] = ["dark", "light"];

/** A colour as drawn: hex plus opacity. */
export interface Paint {
  color: string;
  opacity: number;
}

export interface Palette {
  /** Canvas background. */
  bg: string;
  /** Headline and the brand. */
  ink: string;
  /** Axis titles, legend and label text. */
  text: string;
  /** Dek, ticks, source line, permalink. */
  muted: string;
  /** Gridlines (decoration). */
  grid: Paint;
  /** Reference lines (0 on a growth axis). */
  reference: Paint;
  /** Bubble fill (decoration) and edge. */
  bubbleFill: Paint;
  bubbleStroke: Paint;
  /** A negative size: no fill, this stroke. */
  outline: Paint;
  /** The subject: fill, label and leader. */
  signal: string;
  /** Label leaders for everything but the subject. */
  leader: Paint;
  /** Text halo, drawn under a label so it reads across marks. */
  halo: Paint;
  /** Grain speck colour; the per-speck opacity comes from the LCG. */
  grain: string;
}

export const PALETTES: Record<Theme, Palette> = {
  dark: {
    bg: "#05070a",
    ink: "#eef3f7",
    text: "#c9d1d9",
    muted: "#7d8894",
    grid: { color: "#b4d2eb", opacity: 0.1 },
    reference: { color: "#d6e6f2", opacity: 0.45 },
    bubbleFill: { color: "#8b96a3", opacity: 0.42 },
    bubbleStroke: { color: "#c9d1d9", opacity: 0.5 },
    outline: { color: "#c9d1d9", opacity: 1 },
    signal: "#ffa458",
    leader: { color: "#c9d1d9", opacity: 0.55 },
    halo: { color: "#05070a", opacity: 0.85 },
    grain: "#ffffff",
  },
  light: {
    bg: "#f4f6f8",
    ink: "#0d1620",
    text: "#16202a",
    muted: "#4a5563",
    grid: { color: "#16202a", opacity: 0.1 },
    reference: { color: "#16202a", opacity: 0.6 },
    bubbleFill: { color: "#8a96a3", opacity: 0.42 },
    bubbleStroke: { color: "#4a5563", opacity: 1 },
    outline: { color: "#16202a", opacity: 1 },
    signal: "#a64b00",
    leader: { color: "#16202a", opacity: 0.6 },
    halo: { color: "#f4f6f8", opacity: 0.85 },
    grain: "#16202a",
  },
};

/** Grain tile: size in px, speck count, opacity range and the LCG seed. */
export const GRAIN = { tile: 64, specks: 70, minOpacity: 0.03, maxOpacity: 0.08, seed: 0x2f6b };

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** `paint` laid over an opaque background, per channel, as the eye sees it. */
export function composite(paint: Paint, bg: string): Rgb {
  const f = hexToRgb(paint.color);
  const b = hexToRgb(bg);
  return [0, 1, 2].map((i) => Math.round(f[i] * paint.opacity + b[i] * (1 - paint.opacity))) as Rgb;
}

/** WCAG 2.x relative luminance of an sRGB colour. */
export function luminance(rgb: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** WCAG contrast ratio of a paint (composited over bg) against bg itself. */
export function contrastOnBg(paint: Paint | string, bg: string): number {
  const p = typeof paint === "string" ? { color: paint, opacity: 1 } : paint;
  const a = luminance(composite(p, bg));
  const b = luminance(hexToRgb(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
