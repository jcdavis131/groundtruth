// Text measurement and line breaking from the generated Geist metrics
// (metrics.json, written by scripts/gen-font-metrics.mjs from the vendored
// TTFs). Every layout decision in the renderer - gutters, wrapping, the
// headline size, where a label box ends - is made from these numbers, so the
// SVG and the PNG agree without a browser in the loop.
//
// Width = sum of advance widths / unitsPerEm * size, padded 3 %. Kerning
// (GPOS) is not modelled; the pad keeps the measured box at or above the inked
// one (the render lane measured "Dallas" at Bold 19: ink 56.24 px, measured
// 60.67 px). Figures are proportional and measured as drawn; nothing sets
// `tnum`, so measurement and drawing cannot disagree.
//
// A code point outside metrics.json (U+00AD soft hyphen is the one Latin-1
// gap; anything past the recorded set) measures as .notdef and is reported by
// unmapped(); frame.ts refuses to draw such text rather than guess its width.

import METRICS from "./metrics.json";

export type Weight = 400 | 700 | 900;

/** Padding over the summed advances, standing in for kerning. */
export const KERN_PAD = 1.03;

interface Face {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number | null;
  missing: number;
  adv: Record<string, number>;
}

const WEIGHTS: Record<string, Face> = METRICS.weights;

function face(weight: Weight): Face {
  return WEIGHTS[String(weight)];
}

export interface TextStyle {
  size: number;
  weight: Weight;
  /** Line advance as a multiple of size. */
  lineHeight: number;
  /** Extra space after every character, px (SVG letter-spacing). */
  letterSpacing?: number;
}

/** Rendered width of one line of text, px. Letter-spacing is counted after every character, the last included. */
export function measure(text: string, size: number, weight: Weight, letterSpacing = 0): number {
  const f = face(weight);
  let units = 0;
  let chars = 0;
  for (const ch of text) {
    units += f.adv[String(ch.codePointAt(0))] ?? f.missing;
    chars++;
  }
  return (units / f.unitsPerEm) * size * KERN_PAD + letterSpacing * chars;
}

export function measureStyled(text: string, style: TextStyle): number {
  return measure(text, style.size, style.weight, style.letterSpacing ?? 0);
}

/** Cap height in px: the distance from the baseline to the top of a capital. */
export function capHeight(size: number, weight: Weight): number {
  const f = face(weight);
  return ((f.capHeight ?? f.ascender) / f.unitsPerEm) * size;
}

/** Descent in px below the baseline (hhea descender, as a positive number). */
export function descent(size: number, weight: Weight): number {
  const f = face(weight);
  return (Math.abs(f.descender) / f.unitsPerEm) * size;
}

/** Code points in `text` that the font does not map, in order of appearance, without repeats. */
export function unmapped(text: string, weight: Weight): number[] {
  const f = face(weight);
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (f.adv[String(cp)] === undefined && !out.includes(cp)) out.push(cp);
  }
  return out;
}

/**
 * Greedy word wrap at spaces. A single word wider than `width` gets a line of
 * its own and overflows; callers that must not overflow check with
 * `fitsWidth` (headline, dek) or use wrapSource (which breaks inside words).
 */
export function wrap(text: string, width: number, style: TextStyle): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measureStyled(next, style) > width) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function fitsWidth(lines: string[], width: number, style: TextStyle): boolean {
  return lines.every((l) => measureStyled(l, style) <= width);
}

/**
 * The same number of lines as a greedy wrap at `width`, at the narrowest
 * width that still gives that count, so lines come out even instead of one
 * long line and a short tail. A fixed 24-step bisection: deterministic and
 * well under a pixel.
 */
export function balancedWrap(text: string, width: number, style: TextStyle): string[] {
  const greedy = wrap(text, width, style);
  if (greedy.length <= 1 || !fitsWidth(greedy, width, style)) return greedy;
  let lo = 0;
  let hi = width;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const trial = wrap(text, mid, style);
    if (trial.length <= greedy.length && fitsWidth(trial, mid, style)) hi = mid;
    else lo = mid;
  }
  return wrap(text, hi, style);
}

export interface FittedHeadline {
  size: number;
  lines: string[];
}

/** The headline at one ladder size: balanced lines, or null when it needs more than maxLines or a word overflows. */
export function headlineAt(text: string, size: number, maxLines: number, width: number, weight: Weight = 900, lineHeight = 1.06): FittedHeadline | null {
  const style: TextStyle = { size, weight, lineHeight };
  const lines = balancedWrap(text, width, style);
  return lines.length <= maxLines && fitsWidth(lines, width, style) ? { size, lines } : null;
}

/**
 * The largest size on the ladder at which the headline fits in maxLines.
 * Never truncates: when nothing on the ladder fits, it throws, because a
 * headline that cannot be set is a template defect to fix upstream, not a
 * string to cut.
 */
export function fitHeadline(text: string, ladder: number[], maxLines: number, width: number, weight: Weight = 900, lineHeight = 1.06): FittedHeadline {
  for (const size of ladder) {
    const fit = headlineAt(text, size, maxLines, width, weight, lineHeight);
    if (fit) return fit;
  }
  throw new Error(`headline does not fit ${maxLines} lines of ${width} px at ${ladder.join("/")} px: "${text}"`);
}

/** Characters after which a URL or a formula may break, after "/". */
const SOFT_BREAKS = new Set([".", "-", "_", "?", "&", "=", "#", ":", ",", ";", "+", ")"]);

/** Split after every character in `breaks`; the break character stays at the end of its piece. */
function splitAfter(token: string, isBreak: (ch: string) => boolean): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of token) {
    cur += ch;
    if (isBreak(ch)) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Pieces of an over-long token, each no wider than `width`: at "/", else at URL punctuation, else between characters. */
function breakToken(token: string, width: number, style: TextStyle): string[] {
  const out: string[] = [];
  for (const slashPiece of splitAfter(token, (c) => c === "/")) {
    if (measureStyled(slashPiece, style) <= width) {
      out.push(slashPiece);
      continue;
    }
    for (const softPiece of splitAfter(slashPiece, (c) => SOFT_BREAKS.has(c))) {
      if (measureStyled(softPiece, style) <= width) {
        out.push(softPiece);
        continue;
      }
      for (const ch of softPiece) {
        if (measureStyled(ch, style) > width) throw new Error(`a single character is wider than ${width} px`);
        out.push(ch);
      }
    }
  }
  return out;
}

/**
 * Wrap a source or method line so that no line is ever wider than `width`.
 * Breaks at spaces first; a token that does not fit on a line of its own
 * (a URL, a long formula) is broken after "/" first, then after URL
 * punctuation, and only as a last resort between characters. Pieces of one
 * token are packed greedily and rejoined without a space, so the URL reads
 * back exactly when the lines are concatenated.
 */
export function wrapSource(text: string, width: number, style: TextStyle): string[] {
  const atoms: Array<{ text: string; space: boolean }> = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (measureStyled(word, style) <= width) atoms.push({ text: word, space: true });
    else breakToken(word, width, style).forEach((piece, i) => atoms.push({ text: piece, space: i === 0 }));
  }
  const lines: string[] = [];
  let line = "";
  for (const a of atoms) {
    const next = line ? line + (a.space ? " " : "") + a.text : a.text;
    if (line && measureStyled(next, style) > width) {
      lines.push(line);
      line = a.text;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
