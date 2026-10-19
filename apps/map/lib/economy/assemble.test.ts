// The assembly layer with every upstream replaced by a fixture: the bbox and
// detail rules the route used to own, the join table and what it reports as
// failed, and the three report entry points. No network.
//
// The load-bearing assertions are about what is NOT called and what is NOT
// invented: a county report built from a manifest identity must never reach
// stateLookup(), and a dead FRED must leave the payment estimate null rather
// than produce a number nobody published.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { bboxAround } from "@/lib/globe/geo";

const fx = vi.hoisted(() => {
  const calls = { stateLookup: 0, countyAt: 0, byGeoid: 0, stateByGeoid: 0, sectors: [] as string[], fred: [] as string[] };
  const fail = { qcew: false, fred: false, byGeoid: false, countyAt: false };

  const square = (w: number, s: number, e: number, n: number) => ({
    type: "Polygon" as const,
    coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]] as Array<[number, number]>],
  });

  const HOME = { id: "48453", name: "Travis County", metro: "Austin-Round Rock-San Marcos, TX", sizeRank: 30, asOf: "2026-07-31", latest: 452_000, yoyPct: -1.2, y5Pct: 31.9, monthly: [], yearly: [] };
  const RENT = { id: "48453", name: "Travis County", sizeRank: 30, asOf: "2026-07-31", latest: 1810, yoyPct: 0.8, y5Pct: null, monthly: [], yearly: [] };
  const METRO = { id: "394355", name: "Austin-Round Rock-San Marcos, TX", sizeRank: 30, asOf: "2026-07-31", latest: 460_000, yoyPct: -0.9, y5Pct: 30, monthly: [], yearly: [] };
  const US = { id: "US", name: "United States", sizeRank: 0, asOf: "2026-07-31", latest: 372_000, yoyPct: 1.4, y5Pct: 42, monthly: [], yearly: [] };
  const TX_HOME = { id: "Texas", name: "Texas", sizeRank: 2, asOf: "2026-07-31", latest: 305_000, yoyPct: -0.4, y5Pct: 38, monthly: [], yearly: [] };
  const JOBS = { area: "48453", period: "2026 Q1", estabs: 41_000, emp: 730_000, wages: 1.5e10, avgWeeklyWage: 1580, yoy: { estabs: 1.2, emp: 0.9, wages: 5.5, avgWeeklyWage: 4.5 }, suppressed: false };
  const TX_JOBS = { area: "48000", period: "2026 Q1", estabs: 700_000, emp: 13_500_000, wages: 2.6e11, avgWeeklyWage: 1420, yoy: { estabs: 1.0, emp: 1.4, wages: 4.9, avgWeeklyWage: 3.4 }, suppressed: false };

  const COUNTY = { geoid: "48453", name: "Travis", stusab: undefined as string | undefined, lon: -97.78, lat: 30.33, geometry: square(-98.2, 30.0, -97.4, 30.6) };
  const STATE = { geoid: "48", name: "Texas", stusab: "TX", lon: -99.9, lat: 31.5, geometry: square(-106.6, 25.8, -93.5, 36.5) };

  const port = (id: number, name: string, lon: number, lat: number) => ({
    id, name, country: "United States", region: "Gulf of Mexico", lon, lat, size: "large" as const,
    channelM: 12, anchorageM: 12, cargoPierM: 12, oilM: null, lngM: null, maxLengthM: null, maxDraftM: 12, tidalRangeM: null, facilities: [] as string[],
  });

  const measure = { latest: 12_000, latestDate: "2026-06", yoyPct: 2.5, series: [["2026-05", 11_000], ["2026-06", 12_000]] as Array<[string, number]> };
  const crossing = (code: string, name: string, lon: number, lat: number) => ({ code, name, state: "TX", border: "US-Mexico Border", lon, lat, asOf: "2026-06", measures: { Trucks: measure } });

  return { calls, fail, HOME, RENT, METRO, US, TX_HOME, JOBS, TX_JOBS, COUNTY, STATE, port, crossing };
});

vi.mock("@/lib/economy/sources", () => ({
  WPI: { source: "fixture", pulled: "2026-01-01", ports: [fx.port(1, "Port Lavaca", -96.0, 29.5), fx.port(2, "New Orleans", -90.0, 29.0)] },
  FRED_SERIES: [{ id: "MORTGAGE30US", label: "30-year fixed mortgage rate", unit: "%" }],
  fred: async (id: string) => {
    fx.calls.fred.push(id);
    if (fx.fail.fred) throw new Error("fred down");
    return { id, label: "30-year fixed mortgage rate", value: 6.4, unit: "%", date: "2026-09-10", prev: 6.35, prevDate: "2026-09-03", changePct: 0.8, source: "FRED", series: [] };
  },
  btsIndicators: async () => [],
  btsPortStats: async () => {
    throw new Error("bts ports down");
  },
  borderCrossings: async () => ({ asOf: "2026-06", rows: [fx.crossing("2301", "Near Crossing", -97.78, 31.23), fx.crossing("2302", "Far Crossing", -97.78, 33.93)] }),
  qcewLatest: async () => {
    if (fx.fail.qcew) throw new Error("bls down");
    return { year: 2026, qtr: 1, period: "2026 Q1", counties: new Map([["48453", fx.JOBS]]), states: new Map([["48", fx.TX_JOBS]]) };
  },
  qcewSectors: async (fips: string) => {
    fx.calls.sectors.push(fips);
    return { period: "2026 Q1", sectors: [{ code: "54", title: "Professional and technical services", estabs: 9000, emp: 120_000, avgWeeklyWage: 2400, lq: 1.9, yoyEmp: 1.1, suppressed: false }] };
  },
  zillow: async (kind: string) => {
    if (kind === "zhviCounty") return { kind, asOf: "2026-07-31", rows: new Map([["48453", fx.HOME]]), byName: new Map(), byShort: new Map() };
    if (kind === "zoriCounty") return { kind, asOf: "2026-07-31", rows: new Map([["48453", fx.RENT]]), byName: new Map(), byShort: new Map() };
    if (kind === "zhviState") return { kind, asOf: "2026-07-31", rows: new Map(), byName: new Map([["Texas", fx.TX_HOME]]), byShort: new Map() };
    return { kind, asOf: "2026-07-31", rows: new Map([["US", fx.US]]), byName: new Map([["Austin-Round Rock-San Marcos, TX", fx.METRO]]), byShort: new Map() };
  },
  metroRow: (table: { byName: Map<string, unknown> }, name: string | undefined) => (name ? table.byName.get(name) : undefined),
  stateLookup: async () => {
    fx.calls.stateLookup++;
    return new Map([["48", { stusab: "TX", name: "Texas" }]]);
  },
  tigerCountyAt: async () => {
    fx.calls.countyAt++;
    return fx.fail.countyAt ? null : fx.COUNTY;
  },
  tigerCountyByGeoid: async () => {
    fx.calls.byGeoid++;
    return fx.fail.byGeoid ? null : fx.COUNTY;
  },
  tigerStateByGeoid: async () => {
    fx.calls.stateByGeoid++;
    return fx.STATE;
  },
}));

import { areaContext, detailFor, joinsFor, marketReportForCounty, marketReportForState, snapBbox, tradeNear } from "./assemble";

const IDENTITY = { name: "Travis County", stusab: "TX", stateName: "Texas", lon: -97.78, lat: 30.33 };
const TX = { usps: "TX", name: "Texas", lon: -99.9, lat: 31.5 };
const NOW = Date.UTC(2026, 8, 15, 12);

beforeEach(() => {
  fx.calls.stateLookup = 0;
  fx.calls.countyAt = 0;
  fx.calls.byGeoid = 0;
  fx.calls.stateByGeoid = 0;
  fx.calls.sectors.length = 0;
  fx.calls.fred.length = 0;
  fx.fail.qcew = false;
  fx.fail.fred = false;
  fx.fail.byGeoid = false;
  fx.fail.countyAt = false;
});

describe("snapBbox and detailFor", () => {
  it("snaps outward to a one-degree grid", () => {
    expect(snapBbox([-97.9, 30.1, -97.5, 30.6])).toEqual([-98, 30, -97, 31]);
    expect(snapBbox([-98, 30, -97, 31])).toEqual([-98, 30, -97, 31]);
  });

  it("clamps to 18 degrees around the centre, then snaps", () => {
    expect(snapBbox([-130, 20, -60, 55])).toEqual([-104, 28, -86, 47]);
    expect(snapBbox([-200, -100, 200, 100])).toEqual([-9, -9, 9, 9]);
  });

  it("picks generalization by the larger span", () => {
    expect(detailFor([0, 0, 2, 2])).toBe("500K");
    expect(detailFor([0, 0, 2.1, 0])).toBe("5M");
    expect(detailFor([0, 0, 7, 7])).toBe("5M");
    expect(detailFor([0, 0, 8, 0])).toBe("20M");
  });
});

describe("joinsFor", () => {
  it("populates jobs, home and rent with nothing failed", async () => {
    const j = await joinsFor("county");
    expect(j.joins.jobs.get("48453")?.emp).toBe(730_000);
    expect(j.joins.home.get("48453")?.latest).toBe(452_000);
    expect(j.joins.rent.get("48453")?.latest).toBe(1810);
    // Verbatim from the route: the default map is keyed by state FIPS.
    expect(j.joins.stateNames?.get("48")).toBe("Texas");
    expect(j.failed).toEqual([]);
    expect(j.sources).toEqual(["BLS QCEW", "Zillow ZHVI", "Zillow ZORI"]);
  });

  it("reports the source that did not answer and leaves its map empty", async () => {
    fx.fail.qcew = true;
    const j = await joinsFor("county");
    expect(j.failed).toEqual(["bls-qcew"]);
    expect(j.joins.jobs.size).toBe(0);
    expect(j.joins.home.get("48453")?.latest).toBe(452_000);
  });

  it("takes the state name from the caller instead of paying stateLookup", async () => {
    const j = await joinsFor("county", { stateNames: new Map([["48453", "Texas"]]) });
    expect(fx.calls.stateLookup).toBe(0);
    expect(j.joins.stateNames?.get("48453")).toBe("Texas");
  });
});

describe("marketReportForCounty", () => {
  it("anchors on the manifest identity and never calls stateLookup", async () => {
    const m = await marketReportForCounty("48453", IDENTITY, { now: NOW });
    expect(fx.calls.stateLookup).toBe(0);
    expect(m.report.lon).toBe(IDENTITY.lon);
    expect(m.report.lat).toBe(IDENTITY.lat);
    expect(m.area?.geoid).toBe("48453");
    expect(m.report.area).toMatchObject({ level: "county", geoid: "48453", name: "Travis, TX", stateName: "Texas" });
    expect(m.retrievedAt).toBe(new Date(NOW).toISOString());
    expect(m.failed).toEqual([]);
    expect(fx.calls.sectors).toEqual(["48453"]);
  });

  it("prints the arithmetic behind the payment estimate", async () => {
    const m = await marketReportForCounty("48453", IDENTITY, { now: NOW });
    const e = m.report.affordability.estimate;
    expect(e).not.toBeNull();
    expect(e!.formula.length).toBeGreaterThan(0);
    expect(e!.formula[0]).toContain("Freddie Mac PMMS");
    expect(fx.calls.fred).toEqual(["MORTGAGE30US"]);
  });

  it("falls back to the point query exactly once when the GEOID query finds nothing", async () => {
    fx.fail.byGeoid = true;
    const m = await marketReportForCounty("48453", IDENTITY, { now: NOW });
    expect(fx.calls.byGeoid).toBe(1);
    expect(fx.calls.countyAt).toBe(1);
    expect(m.area?.geoid).toBe("48453");
  });

  it("resolves with no area and a caveat when TIGERweb answers nothing at all", async () => {
    fx.fail.byGeoid = true;
    fx.fail.countyAt = true;
    const m = await marketReportForCounty("48453", IDENTITY, { now: NOW });
    expect(m.area).toBeNull();
    expect(m.report.area).toBeNull();
    expect(m.failed).toContain("census-tigerweb");
    expect(m.caveats.join(" ")).toContain("did not return a polygon for county 48453");
  });

  it("leaves the estimate null and says why when FRED does not answer", async () => {
    fx.fail.fred = true;
    const m = await marketReportForCounty("48453", IDENTITY, { now: NOW });
    expect(m.report.affordability.estimate).toBeNull();
    expect(m.caveats.join(" ")).toContain("MORTGAGE30US");
  });
});

describe("marketReportForState", () => {
  it("builds a state-level report keyed on the SS000 QCEW area", async () => {
    const m = await marketReportForState("48", TX, { now: NOW });
    expect(m.report.area).toMatchObject({ level: "state", geoid: "48", name: "Texas" });
    expect(fx.calls.sectors).toEqual(["48000"]);
    expect(m.report.jobs.provenance.some((p) => (p.seriesId ?? "").includes("48000"))).toBe(true);
    expect(m.report.jobs.data.emp).toBe(13_500_000);
  });

  it("leaves rent empty and says Zillow does not publish it at state level", async () => {
    const m = await marketReportForState("48", TX, { now: NOW });
    expect(m.report.rent.data).toMatchObject({ latest: null, yoyPct: null, priceToRent: null, asOf: null });
    expect(m.caveats.join(" ")).toContain("ZORI");
  });
});

describe("tradeNear", () => {
  it("keeps crossings within 260 km and drops the rest", async () => {
    const trade = await tradeNear(-97.78, 30.33);
    const codes = trade.filter((f) => f.properties.kind === "crossing").map((f) => f.properties.id);
    expect(codes).toEqual(["crossing:2301"]);
  });

  it("asks for ports in the snapped 220 km box", async () => {
    expect(snapBbox(bboxAround(30.33, -97.78, 220_000))).toEqual([-101, 28, -95, 33]);
    const trade = await tradeNear(-97.78, 30.33);
    const ports = trade.filter((f) => f.properties.kind === "port").map((f) => f.properties.id);
    expect(ports).toEqual(["port:1"]);
  });
});

describe("areaContext", () => {
  it("returns the full Zillow rows and one provenance record per file used", async () => {
    const c = await areaContext("48453");
    expect(c.period).toBe("2026 Q1");
    expect(c.sectors).toHaveLength(1);
    expect(c.metroHome?.latest).toBe(460_000);
    expect(c.stateHome?.latest).toBe(305_000);
    expect(c.usHome?.latest).toBe(372_000);
    expect(c.provenance.map((p) => p.source.id).sort()).toEqual(["bls-qcew", "zillow-zhvi", "zillow-zhvi", "zillow-zhvi"]);
  });
});
