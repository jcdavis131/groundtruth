// Covers the two place-keyed additions to lib/economy/sources.ts and the OEWS
// split, because both are load-bearing for the place pages and neither can be
// exercised by the existing economy tests.
//
// tigerCountyByGeoid builds its own `where` clause, which is the only place in
// this module where a caller-supplied string reaches a query string, and it
// relies on tigerQuery spreading ...params after its own where:"1=1". So the
// assertions here are deliberately about the wire: the exact `where` value, the
// rejection of anything that is not five digits, and the GEOID equality check
// that turns a lost spread into a null instead of a wrong county.
//
// lib/server/upstream is replaced wholesale so no test touches the network;
// cache entries are dropped between cases because cached() would otherwise
// serve one case's fixture to the next.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchJson: vi.fn() }));

vi.mock("@/lib/server/upstream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/upstream")>()),
  polite: <T>(_name: string, _interval: number, _backoff: number, fn: () => Promise<T>) => fn(),
  upstreamJson: h.fetchJson,
}));

import { tigerCountyByGeoid, tigerStateByGeoid } from "@/lib/economy/sources";
import { cacheDelete } from "@/lib/server/cache";

type Ring = [number, number][];

function feature(geoid: string, name: string, lon: number, lat: number, extra: Record<string, unknown> = {}) {
  const ring: Ring = [
    [lon - 0.1, lat - 0.1],
    [lon + 0.1, lat - 0.1],
    [lon + 0.1, lat + 0.1],
    [lon - 0.1, lat + 0.1],
    [lon - 0.1, lat - 0.1],
  ];
  return {
    properties: { GEOID: geoid, NAME: name, STATE: geoid.slice(0, 2), CENTLAT: String(lat), CENTLON: String(lon), ...extra },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

/** Every URL handed to upstreamJson, in call order. */
function urls(): string[] {
  return h.fetchJson.mock.calls.map((c) => String(c[1]));
}

function whereOf(url: string): string | null {
  return new URL(url).searchParams.get("where");
}

function forget(...fips: string[]): void {
  for (const f of fips) cacheDelete(`tiger:geoid:${f}`);
  cacheDelete("tiger:states");
}

beforeEach(() => {
  h.fetchJson.mockReset();
});

describe("tigerCountyByGeoid", () => {
  it("asks TIGERweb for exactly one GEOID", async () => {
    forget("48453");
    h.fetchJson.mockResolvedValue({ features: [feature("48453", "Travis", -97.78, 30.33)] });

    await tigerCountyByGeoid("48453");

    expect(urls()).toHaveLength(1);
    expect(whereOf(urls()[0])).toBe("GEOID='48453'");
    // The county layer cannot be asked for STUSAB without a 400.
    expect(new URL(urls()[0]).searchParams.get("outFields")).toBe("GEOID,NAME,STATE,CENTLAT,CENTLON");
  });

  it("returns the polygon with an internal point and no stusab", async () => {
    forget("36061");
    h.fetchJson.mockResolvedValue({ features: [feature("36061", "New York", -73.96, 40.78)] });

    const poly = await tigerCountyByGeoid("36061");

    expect(poly).not.toBeNull();
    expect(poly!.geoid).toBe("36061");
    expect(poly!.name).toBe("New York");
    expect(poly!.lon).toBeCloseTo(-73.96, 5);
    expect(poly!.lat).toBeCloseTo(40.78, 5);
    expect(poly!.geometry.type).toBe("Polygon");
    // Identity comes from lib/places/registry, never from a second round-trip.
    expect(poly!.stusab).toBeUndefined();
  });

  it("rejects a FIPS that is not five digits", async () => {
    await expect(tigerCountyByGeoid("4845")).rejects.toThrow(/5-digit/);
    expect(h.fetchJson).not.toHaveBeenCalled();
  });

  it("rejects a FIPS carrying a quote before it can reach the query string", async () => {
    await expect(tigerCountyByGeoid("48453' OR 1=1")).rejects.toThrow(/5-digit/);
    await expect(tigerCountyByGeoid("48a53")).rejects.toThrow(/5-digit/);
    expect(h.fetchJson).not.toHaveBeenCalled();
  });

  it("returns null when the answer is a different county", async () => {
    forget("06037");
    // What a lost `where` override looks like: the whole layer, starting elsewhere.
    h.fetchJson.mockResolvedValue({ features: [feature("48029", "Bexar", -98.53, 29.45)] });

    expect(await tigerCountyByGeoid("06037")).toBeNull();
  });

  it("falls back to a bbox around the manifest centroid when the attribute query is empty", async () => {
    forget("12086");
    h.fetchJson.mockImplementation(async (_name: string, url: string) => {
      if (whereOf(String(url)) === "GEOID='12086'") return { features: [] };
      return { features: [feature("12011", "Broward", -80.48, 26.15), feature("12086", "Miami-Dade", -80.5, 25.61)] };
    });

    const poly = await tigerCountyByGeoid("12086", { lon: -80.5, lat: 25.61 });

    expect(poly?.geoid).toBe("12086");
    expect(urls()).toHaveLength(2);
    expect(new URL(urls()[1]).searchParams.get("geometryType")).toBe("esriGeometryEnvelope");
  });

  it("does not call the bbox fallback when no centroid was supplied", async () => {
    forget("13121");
    h.fetchJson.mockResolvedValue({ features: [] });

    expect(await tigerCountyByGeoid("13121")).toBeNull();
    expect(urls()).toHaveLength(1);
  });

  it("resolves null rather than propagating an upstream failure", async () => {
    forget("48453");
    h.fetchJson.mockRejectedValue(new Error("tigerweb 503"));

    await expect(tigerCountyByGeoid("48453")).resolves.toBeNull();
  });
});

describe("tigerStateByGeoid", () => {
  it("filters the shared states cache instead of issuing its own query", async () => {
    forget();
    h.fetchJson.mockResolvedValue({
      features: [feature("48", "Texas", -99.35, 31.5, { STUSAB: "TX" }), feature("06", "California", -119.6, 37.15, { STUSAB: "CA" })],
    });

    const tx = await tigerStateByGeoid("48");
    const ca = await tigerStateByGeoid("06");

    expect(tx?.name).toBe("Texas");
    expect(tx?.stusab).toBe("TX");
    expect(ca?.name).toBe("California");
    expect(urls()).toHaveLength(1);
    expect(await tigerStateByGeoid("99")).toBeNull();
  });

  it("resolves null when the states layer is unreachable", async () => {
    forget();
    h.fetchJson.mockRejectedValue(new Error("tigerweb 503"));

    await expect(tigerStateByGeoid("48")).resolves.toBeNull();
  });
});

describe("lib/economy/oews", () => {
  it("exports exactly the three OEWS names and nothing from sources.ts", async () => {
    const mod = await import("@/lib/economy/oews");
    // If this module ever re-exported from sources.ts it would drag WPI,
    // COUNTRIES and the BTS placements in with it — ~4.4 MB of static JSON
    // that a metro page has no use for.
    expect(Object.keys(mod).sort()).toEqual(["OEWS_AS_OF", "oewsMsaIndex", "oewsMsaJobs"]);
  });

  it("serves the bundled MSA index with no network", async () => {
    const { oewsMsaIndex } = await import("@/lib/economy/oews");
    const r = oewsMsaIndex();

    expect(r.msas).toHaveLength(393);
    expect(r.asOf).toBe("May 2025");
    expect(h.fetchJson).not.toHaveBeenCalled();
  });

  it("serves an occupation mix for a real CBSA and null for an unknown one", async () => {
    const { oewsMsaJobs } = await import("@/lib/economy/oews");

    const austin = oewsMsaJobs("41700");
    expect(austin).not.toBeNull();
    expect(austin!.data.msa).toBe("41700");
    expect(austin!.data.top.length).toBeGreaterThan(0);
    expect(austin!.data.major.length).toBeGreaterThan(0);

    expect(oewsMsaJobs("00000")).toBeNull();
  });

  it("is still reachable through lib/economy/sources for existing callers", async () => {
    const sources = await import("@/lib/economy/sources");
    const oews = await import("@/lib/economy/oews");

    expect(sources.OEWS_AS_OF).toBe(oews.OEWS_AS_OF);
    expect(sources.oewsMsaIndex().msas).toHaveLength(393);
    expect(sources.oewsMsaJobs("41700")).not.toBeNull();
  });
});
