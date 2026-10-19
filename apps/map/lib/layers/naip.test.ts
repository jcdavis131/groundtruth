// The NAIP layer in the browser: the years at the view centre (0.1 degree grid), then the
// year's mosaic, passed to the style in meta; nothing asked above 150 km or where no year was
// flown. Route answers are wrapped captures (lib/terrain/fixtures/pc-stac-desmoines.json).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stac from "@/lib/terrain/fixtures/pc-stac-desmoines.json";
import { naipTiles, naipUnlistedMessage, naipYears } from "@/lib/terrain/naip";
import { naipLayer, naipViewKey, useNaipHere } from "./naip";
import type { FetchContext } from "./types";

const ctx = (height: number, options: Record<string, unknown> = {}, lon = -93.62, lat = 41.59): FetchContext => ({ keys: {}, view: { lon, lat, height, heading: 0, pitch: -90 }, now: 0, options });
const calls: string[] = [];
let years = naipYears(stac);
/** Years the route refuses as listing no NAIP item (2026 had none on 2026-10-16). */
const unlisted = new Set([2026]);

beforeEach(() => {
  calls.length = 0;
  years = naipYears(stac);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const q = new URL(url, "http://x").searchParams;
      const body = q.get("op") === "naip" ? { data: { lon: -93.6, lat: 41.6, years } } : q.get("op") === "naipmosaic" ? { data: { year: Number(q.get("year")), tiles: naipTiles("47390dd3950110f09a58e4678f4f6192") } } : null;
      if (!body) throw new Error(`unexpected ${url}`);
      if (q.get("op") === "naipmosaic" && unlisted.has(Number(q.get("year")))) return new Response(JSON.stringify({ error: naipUnlistedMessage(Number(q.get("year"))) }), { status: 400 });
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("naip", () => {
  it("asks the years on a 0.1 degree grid, then the picked year's mosaic", async () => {
    const r = await naipLayer.fetch(ctx(10_000, { naipYear: 2014 }));
    expect(calls).toEqual(["/api/terrain?op=naip&lon=-93.6&lat=41.6", "/api/terrain?op=naipmosaic&year=2014"]);
    expect(r.meta).toMatchObject({ naipYear: 2014, naipPresent: true, naipYears: 8 });
    expect(String(r.meta?.naipTiles)).toContain("/mosaic/47390dd3950110f09a58e4678f4f6192/tiles/");
    expect(useNaipHere.getState().here?.years).toHaveLength(8);
    expect(naipViewKey(ctx(10_000, {}, -93.62, 41.59).view)).toBe(naipViewKey(ctx(10_000, {}, -93.64, 41.61).view));
  });

  it("asks nothing above 150 km, and no mosaic where no year was flown", async () => {
    const above = await naipLayer.fetch(ctx(200_000));
    expect(calls).toEqual([]);
    expect(above.note).toMatch(/^descend below 150 km/);
    years = [];
    const none = await naipLayer.fetch(ctx(10_000));
    expect(calls).toHaveLength(1);
    expect(none.meta).toMatchObject({ naipYear: null });
  });

  it("says so, rather than failing, when a linked year has no NAIP item anywhere", async () => {
    const r = await naipLayer.fetch(ctx(10_000, { naipYear: 2026 }));
    expect(calls).toEqual(["/api/terrain?op=naip&lon=-93.6&lat=41.6", "/api/terrain?op=naipmosaic&year=2026"]);
    expect(r.meta).toMatchObject({ naipYear: null, naipTiles: null });
    expect(r.note).toMatch(/^no 2026 NAIP mosaic/);
  });
});
