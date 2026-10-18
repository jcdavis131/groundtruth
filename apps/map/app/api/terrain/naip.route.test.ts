// /api/terrain?op=naip and op=naipmosaic with Planetary Computer's answers captured
// 2026-10-16 (lib/terrain/fixtures/pc-*, unmodified): the STAC search at Des Moines (8 years),
// the 2023 and 2011 mosaic registrations, the 2023 mosaic's info, Planetary Computer's 404
// for an id it does not hold, and the one-item year searches for 2011, 2023 and 2026 (none). The route's own in-memory cache is real here, so a held id is
// checked and registered again exactly once. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import stac from "@/lib/terrain/fixtures/pc-stac-desmoines.json";
import reg2023 from "@/lib/terrain/fixtures/pc-register-2023.json";
import reg2011 from "@/lib/terrain/fixtures/pc-register-2011.json";
import info2023 from "@/lib/terrain/fixtures/pc-info-2023.json";
import info404 from "@/lib/terrain/fixtures/pc-info-404.json";
import year2011 from "@/lib/terrain/fixtures/pc-stac-year-2011.json";
import year2023 from "@/lib/terrain/fixtures/pc-stac-year-2023.json";
import year2026 from "@/lib/terrain/fixtures/pc-stac-year-2026.json";
import { cacheDelete } from "@/lib/server/cache";
import { GET } from "./route";

const PC = "https://planetarycomputer.microsoft.com/api";
const calls: Array<{ url: string; method: string; body: unknown }> = [];
let answer: (url: string, body: unknown) => Response | null = () => null;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const YEARS: Record<string, unknown> = { "2011": year2011, "2023": year2023, "2026": year2026 };
/** The one-item STAC search for a year, as captured. */
const yearSearch = (u: string, body: unknown) => {
  const y = (body as { query?: { "naip:year"?: { eq?: string } } } | undefined)?.query?.["naip:year"]?.eq;
  return u === `${PC}/stac/v1/search` && y && YEARS[y] ? json(YEARS[y]) : null;
};

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url: String(url), method: init?.method ?? "GET", body });
      const r = answer(String(url), body);
      if (!r) throw new Error(`unexpected ${url}`);
      return r;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/terrain?${qs}`));
  return { status: res.status, body: (await res.json()) as { data: Record<string, unknown>; reregistered?: boolean; caveats: string[] } };
}

describe("op=naip", () => {
  it("asks one STAC search at the snapped point and answers the 8 Des Moines years, oldest first", async () => {
    answer = (u) => (u === `${PC}/stac/v1/search` ? json(stac) : null);
    const { status, body } = await get("op=naip&lon=-93.62004&lat=41.59003");
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ collections: ["naip"], intersects: { type: "Point", coordinates: [-93.62, 41.59] }, limit: 100 });
    const years = body.data.years as Array<{ year: number; items: Array<{ id: string; date: string; gsd: number; state: string }> }>;
    expect(years.map((y) => y.year)).toEqual([2011, 2013, 2014, 2015, 2017, 2019, 2021, 2023]);
    expect(years[7].items[0]).toEqual({ id: "ia_m_4109328_nw_15_030_20230902_20240104", date: "2023-09-02", gsd: 0.3, state: "IA" });
  });

  it("refuses a missing point without asking", async () => {
    expect((await get("op=naip&lon=-93.6")).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("op=naipmosaic", () => {
  it("registers the year's cql2 filter (naip:year as a string) and answers the tile template", async () => {
    answer = (u, b) => (u === `${PC}/data/v1/mosaic/register` ? json(reg2011) : yearSearch(u, b));
    const { status, body } = await get("op=naipmosaic&year=2011");
    expect(status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([`${PC}/stac/v1/search`, `${PC}/data/v1/mosaic/register`]);
    expect(calls[0].body).toEqual({ collections: ["naip"], query: { "naip:year": { eq: "2011" } }, limit: 1 });
    expect(calls[1].body).toEqual({ "filter-lang": "cql2-json", filter: { op: "and", args: [{ op: "=", args: [{ property: "collection" }, "naip"] }, { op: "=", args: [{ property: "naip:year" }, "2011"] }] } });
    expect(body.data.searchid).toBe("0bae9ecc67f679c8a96f9b046ca52a95");
    expect(body.data.tiles).toBe(`${PC}/data/v1/mosaic/0bae9ecc67f679c8a96f9b046ca52a95/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=naip&assets=image&asset_bidx=image%7C1%2C2%2C3&format=png`);
  });

  it("checks a held id and registers again exactly once when Planetary Computer no longer knows it", async () => {
    answer = (u, b) => (u === `${PC}/data/v1/mosaic/register` ? json(reg2023) : yearSearch(u, b));
    await get("op=naipmosaic&year=2023");
    // Held now: the next ask checks it. A known id is kept without registering.
    answer = (u) => (u.endsWith("/47390dd3950110f09a58e4678f4f6192/info") ? json(info2023) : null);
    calls.length = 0;
    const kept = await get("op=naipmosaic&year=2023");
    expect(calls.map((c) => c.url)).toEqual([`${PC}/data/v1/mosaic/47390dd3950110f09a58e4678f4f6192/info`]);
    expect(kept.body.reregistered).toBe(false);
    expect((kept.body as { infoChecked?: boolean }).infoChecked).toBe(true);
    // The check is held 10 minutes: asking again inside them calls nothing upstream.
    calls.length = 0;
    await get("op=naipmosaic&year=2023");
    expect(calls).toEqual([]);
    // Forgotten upstream once the held check lapses (dropped here rather than waiting the 10
    // minutes; moving the clock would also move the Planetary Computer gate's): one 404
    // "SearchId ... not found", one register, nothing more.
    cacheDelete("naip-mosaic-info:47390dd3950110f09a58e4678f4f6192");
    answer = (u) => (u.endsWith("/info") ? json(info404, 404) : u === `${PC}/data/v1/mosaic/register` ? json(reg2023) : null);
    calls.length = 0;
    const again = await get("op=naipmosaic&year=2023");
    expect(again.status).toBe(200);
    expect(again.body.reregistered).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/register"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/info"))).toHaveLength(1);
    // Still "not found" right after: one check, no second register inside 10 minutes; the held
    // id is served and the "not found" is held, so asking again calls nothing.
    calls.length = 0;
    const cooling = await get("op=naipmosaic&year=2023");
    expect(cooling.status).toBe(200);
    expect(cooling.body.reregistered).toBe(false);
    expect((cooling.body as { reregisterCooling?: boolean }).reregisterCooling).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([`${PC}/data/v1/mosaic/47390dd3950110f09a58e4678f4f6192/info`]);
    calls.length = 0;
    await get("op=naipmosaic&year=2023");
    expect(calls).toEqual([]);
  });

  it("refuses a year the STAC search lists no item for, before any register, and holds that", async () => {
    answer = (u, b) => yearSearch(u, b);
    calls.length = 0;
    const r = await get("op=naipmosaic&year=2026");
    expect(r.status).toBe(400);
    expect((r.body as unknown as { error: string }).error).toMatch(/lists no NAIP item for 2026/);
    expect(calls.map((c) => c.url)).toEqual([`${PC}/stac/v1/search`]);
    calls.length = 0;
    expect((await get("op=naipmosaic&year=2026")).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("serves the held id when the check fails other than 'not found', and does not ask again at once", async () => {
    // 2011 is held from the first test of this block.
    answer = (u) => (u.endsWith("/0bae9ecc67f679c8a96f9b046ca52a95/info") ? json({ detail: "Service Unavailable" }, 503) : null);
    calls.length = 0;
    const r = await get("op=naipmosaic&year=2011");
    expect(r.status).toBe(200);
    expect(r.body.data.searchid).toBe("0bae9ecc67f679c8a96f9b046ca52a95");
    expect((r.body as { infoChecked?: boolean }).infoChecked).toBe(false);
    expect(r.body.reregistered).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/register"))).toBe(false);
    calls.length = 0;
    const again = await get("op=naipmosaic&year=2011");
    expect(again.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("goes on unchecked when the year search itself fails: a 503 is not 'no item'", async () => {
    // 2023 with nothing held for it: its year answer and its id are dropped first.
    cacheDelete("naip-year-listed:2023");
    cacheDelete("naip-mosaic:2023");
    answer = (u) => (u === `${PC}/stac/v1/search` ? json({ detail: "Service Unavailable" }, 503) : u === `${PC}/data/v1/mosaic/register` ? json(reg2023) : null);
    calls.length = 0;
    const r = await get("op=naipmosaic&year=2023");
    expect(r.status).toBe(200);
    expect((r.body as { yearChecked?: boolean }).yearChecked).toBe(false);
    expect(r.body.data.searchid).toBe("47390dd3950110f09a58e4678f4f6192");
    expect(calls.filter((c) => c.url.endsWith("/register"))).toHaveLength(1);
  });

  it("has no way to force a register: fresh=1 is ignored", async () => {
    answer = () => null;
    calls.length = 0;
    const r = await get("op=naipmosaic&year=2011&fresh=1");
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.url.endsWith("/register"))).toBe(false);
  });

  it("refuses a year before NAIP's first, or after this one, without asking", async () => {
    expect((await get(`op=naipmosaic&year=${new Date().getUTCFullYear() + 1}`)).status).toBe(400);
    expect((await get("op=naipmosaic&year=2009")).status).toBe(400);
    expect((await get("op=naipmosaic&year=abcd")).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
