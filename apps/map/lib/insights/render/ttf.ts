// A small TrueType reader: enough of head, hhea, OS/2, hmtx and a format-4
// cmap to know how wide a string is, with no dependency.
//
// It exists for two callers only: scripts/gen-font-metrics.mjs, which turns
// the vendored Geist files into metrics.json, and metrics.test.ts, which
// re-reads the shipped files and fails when metrics.json no longer matches
// them. The renderer itself never parses a font at render time; it measures
// from metrics.json, so a render costs no file I/O and runs the same in Node,
// a Vercel function or a browser.
//
// This file must stay import-free and use only type syntax that erases:
// the generator transpiles it on its own with TypeScript's transpileModule
// and imports the result, for the same reason scripts/mcp-stdio.mjs compiles
// lib/mcp with tsc instead of using `node --experimental-strip-types` (the
// app's tsconfig rejects the ".ts" import specifiers strip-types needs).

export interface TtfFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineGap: number;
  /** OS/2 sCapHeight, font units; null when the OS/2 table is older than version 2. */
  capHeight: number | null;
  /** OS/2 sxHeight, font units; null when the OS/2 table is older than version 2. */
  xHeight: number | null;
  /** hhea numberOfHMetrics: how many glyphs carry their own advance in hmtx. */
  numberOfHMetrics: number;
  /** Glyph id for a Unicode code point in the Basic Multilingual Plane; 0 (.notdef) when unmapped. */
  glyph(codePoint: number): number;
  /** Advance width of a glyph id, in font units. */
  advance(glyphId: number): number;
}

interface TableRecord {
  offset: number;
  length: number;
}

/** Parse the tables the metrics need. Throws on anything that is not a TrueType/OpenType file with a format-4 Unicode cmap. */
export function parseTtf(bytes: Uint8Array): TtfFont {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sfnt = dv.getUint32(0);
  // 0x00010000 = TrueType outlines, "OTTO" = CFF outlines; both carry the same metric tables.
  if (sfnt !== 0x00010000 && sfnt !== 0x4f54544f) throw new Error(`not a TrueType/OpenType font (sfnt version 0x${sfnt.toString(16)})`);
  const numTables = dv.getUint16(4);
  const tables: Record<string, TableRecord> = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    tables[tag] = { offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) };
  }
  const need = (tag: string): number => {
    const t = tables[tag];
    if (!t) throw new Error(`font has no ${tag} table`);
    return t.offset;
  };

  const head = need("head");
  const unitsPerEm = dv.getUint16(head + 18);

  const hhea = need("hhea");
  const ascender = dv.getInt16(hhea + 4);
  const descender = dv.getInt16(hhea + 6);
  const lineGap = dv.getInt16(hhea + 8);
  const numberOfHMetrics = dv.getUint16(hhea + 34);

  let capHeight: number | null = null;
  let xHeight: number | null = null;
  const os2 = tables["OS/2"];
  if (os2 && dv.getUint16(os2.offset) >= 2) {
    xHeight = dv.getInt16(os2.offset + 86);
    capHeight = dv.getInt16(os2.offset + 88);
  }

  const hmtx = need("hmtx");
  // Glyphs past numberOfHMetrics share the last advance (monospaced tail).
  const advance = (glyphId: number): number => dv.getUint16(hmtx + 4 * Math.min(glyphId, numberOfHMetrics - 1));

  const cmap = need("cmap");
  const subtables = dv.getUint16(cmap + 2);
  let sub = -1;
  for (let i = 0; i < subtables; i++) {
    const platform = dv.getUint16(cmap + 4 + i * 8);
    const encoding = dv.getUint16(cmap + 6 + i * 8);
    const offset = dv.getUint32(cmap + 8 + i * 8);
    // Windows Unicode BMP (3, 1) or any Unicode-platform (0, *) format-4 subtable.
    if (dv.getUint16(cmap + offset) === 4 && ((platform === 3 && encoding === 1) || platform === 0)) {
      sub = cmap + offset;
      break;
    }
  }
  if (sub < 0) throw new Error("font has no format-4 Unicode cmap subtable");
  const segX2 = dv.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2; // + reservedPad
  const deltas = starts + segX2;
  const ranges = deltas + segX2;

  const glyph = (codePoint: number): number => {
    if (codePoint > 0xffff) return 0;
    for (let s = 0; s < segX2; s += 2) {
      const end = dv.getUint16(ends + s);
      if (codePoint > end) continue;
      const start = dv.getUint16(starts + s);
      if (codePoint < start) return 0;
      const delta = dv.getInt16(deltas + s);
      const rangeOffset = dv.getUint16(ranges + s);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const g = dv.getUint16(ranges + s + rangeOffset + 2 * (codePoint - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };

  return { unitsPerEm, ascender, descender, lineGap, capHeight, xHeight, numberOfHMetrics, glyph, advance };
}

/**
 * The code points metrics.json records: printable ASCII, Latin-1, and the
 * typographic punctuation and arrows the charts print (dashes, curly quotes,
 * bullet, ellipsis, minus, arrows). Anything outside this set measures as
 * .notdef, and metrics.ts reports it as unmapped so a caller can refuse it.
 */
export function metricCodePoints(): number[] {
  const cps: number[] = [];
  for (let c = 0x20; c <= 0x7e; c++) cps.push(c);
  for (let c = 0xa0; c <= 0xff; c++) cps.push(c);
  cps.push(0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212);
  return cps;
}

/** What metrics.json stores for one font file, minus the file identity the generator adds. */
export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineGap: number;
  capHeight: number | null;
  xHeight: number | null;
  numberOfHMetrics: number;
  /** Advance of .notdef, used for any code point the font does not map. */
  missing: number;
  /** Advance width in font units, keyed by decimal code point; unmapped code points are absent. */
  adv: Record<string, number>;
}

export function fontMetrics(font: TtfFont, codePoints: number[]): FontMetrics {
  const adv: Record<string, number> = {};
  for (const cp of [...codePoints].sort((a, b) => a - b)) {
    const g = font.glyph(cp);
    if (g !== 0) adv[String(cp)] = font.advance(g);
  }
  return {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    lineGap: font.lineGap,
    capHeight: font.capHeight,
    xHeight: font.xHeight,
    numberOfHMetrics: font.numberOfHMetrics,
    missing: font.advance(0),
    adv,
  };
}
