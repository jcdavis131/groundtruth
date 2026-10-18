import { describe, expect, it } from "vitest";
import type { CrossingRow, HomeValue, JobsRow, PortStats, WpiPort } from "@/lib/economy/features";
import type { QcewTable, ZillowTable } from "@/lib/economy/sources";
import type { Series } from "@/lib/series/types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { parseUsgsLatest } from "./fetchers";
import { bareId, collectProvenance, getResolver, globeLink, latestAndPrevious, measureKey, registerResolver, resolveAll, resolveItem, type Fetchers, type ResolveContext } from "./resolve";

const home = (id: string, name: string, latest: number, yoy: number | null, metro?: string): HomeValue => ({ id, name, metro, sizeRank: 1, asOf: "2026-07-31", latest, yoyPct: yoy, y5Pct: 40, monthly: [], yearly: [] });
const jobs = (area: string, emp: number | null, suppressed = false): JobsRow => ({ area, period: "2026 Q1", estabs: suppressed ? null : 100, emp, wages: suppressed ? null : 1e9, avgWeeklyWage: suppressed ? null : 1500, yoy: { estabs: 1, emp: suppressed ? null : 2.5, wages: 3, avgWeeklyWage: 4 }, suppressed });

function zillowTable(kind: ZillowTable["kind"], rows: HomeValue[]): ZillowTable {
  return { kind, asOf: "2026-07-31", rows: new Map(rows.map((r) => [r.id, r])), byName: new Map(rows.map((r) => [r.name, r])), byShort: new Map() };
}

const wpi: WpiPort = { id: 12345, name: "Houston", country: "US", region: "Gulf", lat: 29.73, lon: -95.27, size: "large", channelM: 14, anchorageM: null, cargoPierM: null, oilM: null, lngM: null, maxLengthM: null, maxDraftM: null, tidalRangeM: null, facilities: [] };
const stats: PortStats = { portId: "HOU", name: "Port of Houston", position: "WPI 12345", year: 2025, container: { total: 4_100_000, imports: 2e6, exports: 2.1e6, domestic: null, foreign: null, empty: null, ranking: 5, pctChange: 3.2, series: [] }, vesselCalls: [], topCommodities: [], topFarm: [] };

const crossing: CrossingRow = {
  code: "2304",
  name: "Laredo",
  state: "TX",
  border: "US-Mexico Border",
  lon: -99.5,
  lat: 27.5,
  asOf: "2026-06-01",
  measures: { Trucks: { latest: 250_000, latestDate: "2026-06-01", yoyPct: 4.1, series: [] }, "Personal Vehicle Passengers": { latest: 900_000, latestDate: "2026-06-01", yoyPct: -1.2, series: [] } },
};

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-10T00:00:00Z");
const series: Series = {
  id: "snapshot:port-vessels:USLAX",
  title: "Vessels near Los Angeles",
  unit: "count",
  frequency: "daily",
  geo: { kind: "port", id: "USLAX", lon: -118.27, lat: 33.73 },
  provenance: provenance(source("gev-snapshot"), { kind: "snapshot", retrievedAt: "2026-09-09T00:00:00Z" }),
  points: [
    { t: NOW - 10 * DAY, v: 100 },
    { t: NOW - 8 * DAY, v: 110 },
    { t: NOW - 7 * DAY, v: null },
    { t: NOW - 3 * DAY, v: 120 },
    { t: NOW - 1 * DAY, v: 132 },
  ],
};

function fetchers(over: Partial<Fetchers> = {}): Fetchers {
  const qcew: QcewTable = { year: 2026, qtr: 1, period: "2026 Q1", counties: new Map([["48453", jobs("48453", 700_000)], ["48001", jobs("48001", null, true)]]), states: new Map([["48", jobs("48000", 13_000_000)]]), metros: new Map(), micros: new Map() };
  return {
    zillow: async (kind) => {
      if (kind === "zhviCounty") return zillowTable(kind, [home("48453", "Travis County", 520_000, 3.4, "Austin-Round Rock-San Marcos, TX")]);
      if (kind === "zoriCounty") return zillowTable(kind, [home("48453", "Travis County", 1900, -0.5)]);
      return zillowTable(kind, [home("Texas", "Texas", 300_000, 1.1)]);
    },
    qcewLatest: async () => qcew,
    stateLookup: async () => new Map([["48", { stusab: "TX", name: "Texas" }]]),
    btsPortStats: async () => ({ byWpi: new Map([[12345, stats]]), extraPorts: [], year: 2025 }),
    wpiPort: (id) => (id === 12345 ? wpi : id === 999 ? { ...wpi, id: 999, name: "Quiet Harbour" } : undefined),
    borderCrossings: async () => ({ asOf: "2026-06-01", rows: [crossing] }),
    usgsLatest: async (site) =>
      site === "USGS-08180800"
        ? [
            { param: "00065", value: 3.2, unit: "ft", time: "2026-09-09T23:45:00Z", lon: -98.6, lat: 29.4, upstreamUrl: "https://api.waterdata.usgs.gov/x" },
            { param: "00060", value: 41, unit: "ft3/s", time: "2026-09-09T23:30:00Z", lon: -98.6, lat: 29.4 },
          ]
        : [],
    seriesGet: async (id) => (id === series.id ? series : id === "indicator:la-congestion" ? { ...series, id, title: "LA congestion" } : null),
    ...over,
  };
}

const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({ origin: "https://gev.test", now: NOW, fetchers: fetchers(), ...over });

describe("county / state", () => {
  it("joins Zillow, ZORI and QCEW with provenance and an estimate", async () => {
    const r = await resolveItem({ kind: "county", id: "48453" }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("Travis County, TX");
    expect(r.metrics["home.latest"]).toBe(520_000);
    expect(r.metrics["home.yoyPct"]).toBe(3.4);
    expect(r.metrics["rent.latest"]).toBe(1900);
    expect(r.metrics["jobs.emp"]).toBe(700_000);
    expect(r.metrics["jobs.yoy.emp"]).toBe(2.5);
    expect(r.metrics.priceToRent).toBeCloseTo(520_000 / (1900 * 12), 6);
    expect(r.asOf).toBe("2026-07-31");
    expect(r.provenance.map((p) => p.source.id)).toEqual(["zillow-zhvi", "zillow-zori", "bls-qcew", "zillow-zhvi"]);
    expect(r.provenance[3].kind).toBe("estimate");
    expect(r.link).toBe("https://gev.test/?layers=realestate%2Ccommerce&sel=realestate%3Acounty%3A48453");
  });

  it("keeps suppressed QCEW cells null and says so", async () => {
    const r = await resolveItem({ kind: "county", id: "48001" }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metrics["jobs.emp"]).toBeNull();
    expect(r.notes?.[0]).toMatch(/withheld/);
    expect("home.latest" in r.metrics).toBe(false);
  });

  it("resolves a state through the FIPS -> name lookup", async () => {
    const r = await resolveItem({ kind: "state", id: "48" }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("Texas");
    expect(r.metrics["home.latest"]).toBe(300_000);
    expect(r.metrics["jobs.emp"]).toBe(13_000_000);
    expect("rent.latest" in r.metrics).toBe(false);
  });

  it("fails cleanly on a bad id and on an unknown area", async () => {
    const bad = await resolveItem({ kind: "county", id: "abc" }, ctx());
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toMatch(/5-digit/);
    const none = await resolveItem({ kind: "county", id: "99999" }, ctx());
    expect(none.ok).toBe(false);
  });

  it("reports both upstreams failing", async () => {
    const r = await resolveItem({ kind: "county", id: "48453" }, ctx({ fetchers: fetchers({ zillow: async () => { throw new Error("down"); }, qcewLatest: async () => { throw new Error("down"); } }) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/both upstreams failed/);
  });
});

describe("port", () => {
  it("publishes BTS volumes with WPI position", async () => {
    const r = await resolveItem({ kind: "port", id: "port:12345" }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe("12345");
    expect(r.name).toBe("Houston");
    expect(r.metrics["container.total"]).toBe(4_100_000);
    expect(r.metrics["container.ranking"]).toBe(5);
    expect(r.geo).toEqual([-95.27, 29.73]);
    expect(r.asOf).toBe("2025");
    expect(r.link).toContain("sel=trade%3Aport%3A12345");
    expect(r.link).toContain("lat=29.7300");
  });
  it("has no volume metrics without BTS statistics, and says why", async () => {
    const r = await resolveItem({ kind: "port", id: "999" }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.metrics)).toEqual([]);
    expect(r.notes?.[0]).toMatch(/no Port Performance/);
  });
  it("rejects a non-numeric id and an unknown port", async () => {
    expect((await resolveItem({ kind: "port", id: "houston" }, ctx())).ok).toBe(false);
    expect((await resolveItem({ kind: "port", id: "42" }, ctx())).ok).toBe(false);
  });
});

describe("crossing", () => {
  it("publishes one metric pair per measure in camelCase", async () => {
    const r = await resolveItem({ kind: "crossing", id: "2304" }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("Laredo, TX");
    expect(r.metrics["trucks.latest"]).toBe(250_000);
    expect(r.metrics["trucks.yoyPct"]).toBe(4.1);
    expect(r.metrics["personalVehiclePassengers.yoyPct"]).toBe(-1.2);
    expect(r.asOf).toBe("2026-06-01");
    expect(r.geo).toEqual([-99.5, 27.5]);
  });
  it("fails on unknown code", async () => {
    const r = await resolveItem({ kind: "crossing", id: "0001" }, ctx());
    expect(r.ok).toBe(false);
  });
  it("measureKey", () => {
    expect(measureKey("Trucks")).toBe("trucks");
    expect(measureKey("Personal Vehicle Passengers")).toBe("personalVehiclePassengers");
    expect(measureKey("Bus Passengers")).toBe("busPassengers");
  });
});

describe("gauge", () => {
  it("maps parameter codes to short metrics and keeps the raw codes", async () => {
    const r = await resolveItem({ kind: "gauge", id: "usgs:USGS-08180800" }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metrics.stage).toBe(3.2);
    expect(r.metrics.flow).toBe(41);
    expect(r.metrics.p00065).toBe(3.2);
    expect(r.asOf).toBe("2026-09-09T23:45:00Z");
    expect(r.geo).toEqual([-98.6, 29.4]);
    expect(r.provenance[0].upstreamUrl).toBe("https://api.waterdata.usgs.gov/x");
    expect(r.link).toContain("sel=water%3Ausgs%3AUSGS-08180800");
  });
  it("fails on a malformed site id and on an empty answer", async () => {
    expect((await resolveItem({ kind: "gauge", id: "08180800" }, ctx())).ok).toBe(false);
    const r = await resolveItem({ kind: "gauge", id: "USGS-00000000" }, ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no latest continuous/);
  });
  it("parseUsgsLatest drops null and non-numeric values", () => {
    const rows = parseUsgsLatest(
      [
        { properties: { monitoring_location_id: "USGS-1", parameter_code: "00065", time: "t1", value: "1.5", unit_of_measure: "ft" }, geometry: { type: "Point", coordinates: [-1, 2] } },
        { properties: { monitoring_location_id: "USGS-1", parameter_code: "00060", time: "t1", value: null, unit_of_measure: "ft3/s" }, geometry: null },
        { properties: { monitoring_location_id: "USGS-1", parameter_code: "00010", time: "t1", value: "Ice", unit_of_measure: "C" }, geometry: null },
      ],
      "https://u",
    );
    expect(rows).toEqual([{ param: "00065", value: 1.5, unit: "ft", time: "t1", lon: -1, lat: 2, upstreamUrl: "https://u" }]);
  });
});

describe("series / indicator", () => {
  it("publishes latest, previous (window ago) and change", async () => {
    const r = await resolveItem({ kind: "series", id: series.id }, ctx({ window: "7d" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metrics.value).toBe(132);
    expect(r.metrics.previous).toBe(110); // latest at NOW-1d; 7d earlier = NOW-8d
    expect(r.metrics.change).toBe(22);
    expect(r.metrics.changePct).toBeCloseTo(20, 6);
    expect(r.previous).toEqual({ value: 110 });
    expect(r.geo).toEqual([-118.27, 33.73]);
    expect(r.asOf).toBe(new Date(NOW - DAY).toISOString());
    expect(r.provenance[0].source.id).toBe("gev-snapshot");
  });
  it("null change when nothing is old enough", async () => {
    const r = await resolveItem({ kind: "series", id: series.id }, ctx({ window: "30d" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metrics.previous).toBeNull();
    expect(r.notes?.[0]).toMatch(/30d/);
  });
  it("indicator adds the prefix and explains absence", async () => {
    const ok = await resolveItem({ kind: "indicator", id: "la-congestion" }, ctx());
    expect(ok.ok).toBe(true);
    const missing = await resolveItem({ kind: "indicator", id: "nope" }, ctx());
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error).toMatch(/not been computed yet/);
  });
  it("latestAndPrevious ignores future points and nulls", () => {
    const { latest, previous } = latestAndPrevious([{ t: 10, v: 1 }, { t: 20, v: null }, { t: 30, v: 3 }, { t: 40, v: 4 }], 35, 15);
    expect(latest).toEqual({ t: 30, v: 3 });
    expect(previous).toEqual({ t: 10, v: 1 });
    expect(latestAndPrevious([{ t: 1, v: null }], 5, 1)).toEqual({});
  });
});

describe("company and registry", () => {
  it("is 'not resolved yet' until a resolver is registered", async () => {
    const r = await resolveItem({ kind: "company", id: "0000320193", name: "Apple" }, ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/not resolved yet/);
    expect(r.link).toContain("sel=companies%3A0000320193");
  });
  it("registerResolver replaces the stub", async () => {
    const prev = getResolver("company")!;
    registerResolver("company", async (item, c) => ({ ok: true, kind: "company", id: item.id, name: "ACME", metrics: { filings: 3 }, asOf: "2026-09-01", provenance: [], link: c.origin }));
    try {
      const r = await resolveItem({ kind: "company", id: "acme" }, ctx());
      expect(r.ok && r.metrics.filings).toBe(3);
    } finally {
      registerResolver("company", prev);
    }
  });
});

describe("resolveAll / collectProvenance / links", () => {
  it("keeps order, tolerates failures and dedupes provenance", async () => {
    const items = [
      { kind: "county" as const, id: "48453" },
      { kind: "port" as const, id: "12345" },
      { kind: "gauge" as const, id: "USGS-00000000" },
      { kind: "county" as const, id: "48453" },
    ];
    const out = await resolveAll(items, ctx(), 2);
    expect(out.map((r) => r.ok)).toEqual([true, true, false, true]);
    const prov = collectProvenance(out);
    expect(prov.filter((p) => p.source.id === "zillow-zhvi")).toHaveLength(2); // published + estimate
    expect(prov.some((p) => p.source.id === "bts-ports")).toBe(true);
  });
  it("globeLink and bareId", () => {
    expect(globeLink("https://x/", { geo: [-97.1234567, 30.5], h: 1000, layers: ["water"], sel: "water:usgs:U" })).toBe("https://x/?lat=30.5000&lon=-97.1235&h=1000&layers=water&sel=water%3Ausgs%3AU");
    expect(globeLink("https://x", {})).toBe("https://x/");
    expect(bareId("gauge", "usgs:USGS-1")).toBe("USGS-1");
    expect(bareId("series", "usgs:USGS-1")).toBe("usgs:USGS-1");
  });
});
