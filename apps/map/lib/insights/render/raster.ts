// SVG -> PNG for the insight charts: resvg compiled to WebAssembly
// (@resvg/resvg-wasm, pinned at 2.6.2), with the three vendored Geist files
// as the only fonts. The SVG is the source of truth; the PNG is that SVG
// rasterised, at three sizes:
//
//   social    the 1080 x 1350 card at 1080 wide (native size)
//   download  the same card at 2160 wide (2160 x 2700), not a separate layout
//   og        the 1200 x 630 card at 1200 wide
//
// Fonts. resvg gets the vendored TTFs through `fontBuffers` and nothing else:
// the WebAssembly build cannot see system fonts, so the PNG is drawn with
// exactly the faces metrics.json was generated from, and every measured box
// in the layout matches the ink. (The framework's own OG image helper was
// rejected: it goes through sharp/librsvg wherever sharp resolves, and resvg
// given no fonts drops every glyph.)
//
// Files. The wasm and the fonts are read from disk at run time, relative to
// the project root (the working directory in dev, in tests and in a deployed
// function), at the paths below. Nothing imports them statically, so
// next.config.ts lists the same paths in outputFileTracingIncludes for the
// /insights/** routes; keep the two in step. Both are read once per process
// and cached.
//
// Initialisation. initWasm may run once per process. A dev server's hot
// reload re-evaluates this module but not the package, so a fresh module
// finds the package already initialised and initWasm throws "Already
// initialized": that is treated as ready. Any other failure clears the cached
// promise, so the next call tries again instead of failing forever.
//
// Node only (node:fs). render.ts never imports this module, so the SVG path
// stays free of I/O and runs anywhere.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

/** resvg's WebAssembly binary, relative to the project root. */
export const WASM_FILE = "node_modules/@resvg/resvg-wasm/index_bg.wasm";
/** The vendored Geist faces (Regular 400, Bold 700, Black 900), relative to the project root. */
export const FONT_FILES = ["lib/insights/render/fonts/Geist-Regular.ttf", "lib/insights/render/fonts/Geist-Bold.ttf", "lib/insights/render/fonts/Geist-Black.ttf"] as const;

/** Output widths, px: the social card, its 2x download and the OG card. */
export const PNG_WIDTH = { social: 1080, download: 2160, og: 1200 } as const;

const fromRoot = (rel: string): string => path.join(process.cwd(), rel);

let ready: Promise<void> | null = null;
let fonts: Promise<Uint8Array[]> | null = null;

function alreadyInitialized(e: unknown): boolean {
  return e instanceof Error && /Already initialized/.test(e.message);
}

/** A cached promise that clears itself on rejection, so a failed load is retried rather than remembered. */
function retrying<T>(get: () => Promise<T> | null, set: (p: Promise<T> | null) => void, make: () => Promise<T>): Promise<T> {
  const cached = get();
  if (cached) return cached;
  const p = make();
  set(p);
  p.catch(() => {
    if (get() === p) set(null);
  });
  return p;
}

/**
 * Initialise resvg once. `load` supplies the wasm bytes (the file at
 * WASM_FILE unless a test passes its own). Resolves when resvg is usable,
 * including when the package was already initialised by an earlier
 * evaluation of this module.
 */
export function ensureResvg(load: () => Promise<BufferSource> = () => readFile(fromRoot(WASM_FILE))): Promise<void> {
  return retrying(
    () => ready,
    (p) => (ready = p),
    async () => {
      const bytes = await load();
      try {
        await initWasm(bytes);
      } catch (e) {
        if (!alreadyInitialized(e)) throw e;
      }
    },
  );
}

/** The three Geist faces as resvg font buffers, read once. */
export function geistFonts(): Promise<Uint8Array[]> {
  return retrying(
    () => fonts,
    (p) => (fonts = p),
    () => Promise.all(FONT_FILES.map(async (f) => new Uint8Array(await readFile(fromRoot(f))))),
  );
}

/**
 * Forget the initialisation promise, as a hot reload does when it
 * re-evaluates this module. The package stays initialised; the next call
 * meets "Already initialized" and carries on. For tests.
 */
export function forgetResvgInit(): void {
  ready = null;
}

/**
 * The SVG as a PNG `width` px wide, its height following the SVG's aspect
 * ratio. Returns a Uint8Array over a plain ArrayBuffer, so it can be a
 * Response body as it is.
 */
export async function toPng(svg: string, width: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isInteger(width) || width < 1 || width > 4096) throw new Error(`PNG width must be a whole number of px from 1 to 4096, not ${width}`);
  const [, fontBuffers] = await Promise.all([ensureResvg(), geistFonts()]);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontBuffers, defaultFontFamily: "Geist", sansSerifFamily: "Geist" },
  });
  try {
    const image = resvg.render();
    try {
      return new Uint8Array(image.asPng());
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}
