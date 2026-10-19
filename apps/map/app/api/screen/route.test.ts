// Contract of /api/screen with every upstream reader replaced by fixtures:
// validation, envelope, CSV, JSON body. No network.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { countyJoins, COUNTY_POINTS } from "@/lib/screener/fixtures";

vi.mock("@/lib/economy/sources", () => {
  const joins = countyJoins();
  return {
    WPI: { source: "fixture", pulled: "2026-01-01", ports: [] },
    COUNTRIES: { source: "fixture", pulled: "2026-01-01", features: [] },
    tigerCountyPoints: async () => COUNTY_POINTS,
    tigerStates: async () => [],
    stateLookup: async () => new Map([["48", { stusab: "TX", name: "Texas" }], ["06", { stusab: "CA", name: "California" }], ["36", { stusab: "NY", name: "New York" }], ["38", { stusab: "ND", name: "North Dakota" }]]),
    qcewLatest: async () => ({ year: 2026, qtr: 1, period: "2026 Q1", counties: joins.jobs, states: new Map() }),
    zillow: async (kind: string) => ({ kind, asOf: "2026-07-31", rows: kind === "zoriCounty" ? joins.rent : joins.home, byName: new Map(), byShort: new Map() }),
    btsPortStats: async () => {
      throw new Error("bts down");
    },
    borderCrossings: async () => ({ asOf: "2026-06", rows: [] }),
    worldBank: async () => ({ stats: new Map(), failed: [] }),
  };
});

import { GET, OPTIONS, POST } from "./route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/screen?${qs}`));
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/screen", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("GET /api/screen", () => {
  it("rejects a missing or unknown kind", async () => {
    const r = await get("kind=parcel");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("kind must be one of");
    expect((await get("")).status).toBe(400);
  });

  it("returns structured query errors", async () => {
    const r = await get("kind=county&q=" + encodeURIComponent("nope > 1 AND state > 2"));
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.error).toBe("invalid query");
    expect(j.errors.map((e: { code: string }) => e.code)).toEqual(["unknown_field", "invalid_op"]);
    const syntax = await get("kind=county&q=" + encodeURIComponent('name CONTAINS "x'));
    expect((await syntax.json()).errors[0]).toMatchObject({ code: "syntax", position: 14 });
  });

  it("rejects an oversize query with 413", async () => {
    const r = await get("kind=county&q=" + encodeURIComponent("a > 1 AND ".repeat(300)));
    expect(r.status).toBe(413);
  });

  it("serves the field registry", async () => {
    const r = await get("kind=port&fields=1");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.kind).toBe("port");
    expect(j.fields.find((f: { key: string }) => f.key === "teu")).toMatchObject({ unit: "TEU", source: "bts-ports" });
    expect(j.fields.some((f: Record<string, unknown>) => "get" in f)).toBe(false);
  });

  it("screens counties into an envelope with fields, provenance and caveats", async () => {
    const r = await get("kind=county&q=" + encodeURIComponent("home.yoyPct > 0 AND jobs.yoy.emp < 0 SORT home.latest DESC LIMIT 10"));
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("cache-control")).toContain("s-maxage=3600");
    const j = await r.json();
    expect(j.data.kind).toBe("county");
    expect(j.data.total).toBe(1);
    expect(j.data.count).toBe(1);
    expect(j.data.rows[0]).toMatchObject({ id: "county:06037", layer: "realestate", kind: "county", name: "Los Angeles County, CA", geo: [-118.23, 34.31] });
    expect(j.data.rows[0].values["home.latest"]).toBe(900_000);
    expect(j.data.rows[0].values["priceToRent"]).toBeCloseTo(900_000 / (2_900 * 12), 6);
    expect(j.data.applied.limit).toBe(10);
    expect(j.data.fieldsUsed).toEqual(["home.yoyPct", "jobs.yoy.emp", "home.latest"]);
    expect(j.data.stats["home.latest"].n).toBe(1);
    expect(j.fields.map((f: { key: string }) => f.key)).toContain("momentum");
    expect(j.provenance.find((p: { source: { id: string } }) => p.source.id === "bls-qcew").period).toBe("2026 Q1");
    expect(j.provenance.filter((p: { kind: string }) => p.kind === "estimate")).toHaveLength(3);
    expect(typeof j.generatedAt).toBe("string");
    expect(j.caveats.at(-1)).toContain("never imputed");
  });

  it("honours cols and pct", async () => {
    const r = await get("kind=county&q=" + encodeURIComponent("SORT home.latest DESC") + "&cols=name,home.latest,bogus&pct=1");
    const j = await r.json();
    expect(Object.keys(j.data.rows[0].values)).toEqual(["name", "home.latest"]);
    expect(j.data.rows[0].pct["home.latest"]).toBe(100);
  });

  it("writes CSV with units in the header and provenance in the footer", async () => {
    const r = await get("kind=county&q=" + encodeURIComponent("state == TX SORT name") + "&format=csv&cols=name,state,home.latest");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toMatch(/gev-screen-county-.*\.csv/);
    const lines = (await r.text()).split("\n");
    expect(lines[0]).toBe("id,kind,name,lon,lat,name,state,home.latest (USD)");
    expect(lines[1]).toBe('county:48029,county,"Bexar County, TX",-98.52,29.45,Bexar County,TX,290000');
    expect(lines[2]).toBe('county:48453,county,"Travis County, TX",-97.78,30.33,Travis County,TX,520000');
    expect(lines[3]).toContain("# Embedding Atlas screener export, 2 rows");
    expect(lines[4]).toBe("# query: state == TX SORT name");
    expect(lines.some((l) => l.startsWith("# source: U.S. Bureau of Labor Statistics"))).toBe(true);
  });

  it("answers OPTIONS for CORS preflight", () => {
    const r = OPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("POST /api/screen", () => {
  it("accepts a JSON query and echoes it in string form", async () => {
    const r = await post({ kind: "county", query: { where: [{ field: "state", op: "in", value: ["TX", "NY"] }], sort: [{ field: "home.latest", dir: "desc" }], limit: 1 } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.query).toBe("state IN (TX, NY) SORT home.latest DESC LIMIT 1");
    expect(j.data.rows.map((x: { name: string }) => x.name)).toEqual(["New York County, NY"]);
    expect(j.data.total).toBe(3);
  });

  it("accepts the string form in the body and a columns list", async () => {
    const r = await post({ kind: "county", query: "SORT jobs.emp DESC LIMIT 2", columns: ["name", "jobs.emp"] });
    const j = await r.json();
    expect(j.data.rows.map((x: { values: Record<string, unknown> }) => x.values["jobs.emp"])).toEqual([4_400_000, 2_500_000]);
    expect(Object.keys(j.data.rows[0].values)).toEqual(["name", "jobs.emp"]);
  });

  it("rejects bad JSON, bad kinds, bad shapes and oversize bodies", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ kind: "x", query: {} })).status).toBe(400);
    const shape = await post({ kind: "county", query: { where: [{ field: "home.latest", op: "like", value: 1 }] } });
    expect(shape.status).toBe(400);
    expect((await shape.json()).errors[0].code).toBe("invalid_op");
    const big = await post({ kind: "county", query: "x".repeat(9000) });
    expect(big.status).toBe(413);
  });

  it("keeps serving when one upstream of a set fails, with a caveat", async () => {
    const r = await get("kind=port&q=");
    // btsPortStats is caught inside the set builder: ports still screen from the WPI snapshot (empty here).
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.total).toBe(0);
    expect(j.caveats[0]).toContain("bts-ports did not answer");
  });
});
