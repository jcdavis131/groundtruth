import { describe, expect, it } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import { buildCrossings, buildPorts, type CrossingRow, type PortStats, type WpiPort } from "./features";
import { areaFixtures } from "./testFixtures";
import { buildMarketReport, marketCitations, marketReportText, marketSectionProvenance, qcewArea } from "./report";
import type { PulseItem } from "./sources";

const NOW = Date.parse("2026-09-11T10:00:00Z");

const PORT: WpiPort = { id: 1234, name: "Fixture harbour", country: "United States", region: "Gulf of Mexico", lat: 29.0, lon: -97.4, size: "medium", channelM: 14.3, anchorageM: null, cargoPierM: null, oilM: null, lngM: null, maxLengthM: null, maxDraftM: null, tidalRangeM: null, facilities: [] };
const STATS: PortStats = { portId: "2422", name: "Corpus Christi, TX Port of", position: "World Port Index entry", year: 2024, tonnage: { total: 2e8, imports: null, exports: null, domestic: null, foreign: null, empty: null, ranking: 3, pctChange: 2.3, series: [] }, vesselCalls: [], topCommodities: [], topFarm: [] };
// Laredo is ~330 km from Austin, outside the crossing radius; Eagle Pass ~300 km too. Put a fixture crossing 200 km south.
const CROSSING: CrossingRow = { code: "2301", name: "Fixture crossing", state: "TX", border: "US-Mexico Border", lon: -97.8, lat: 28.5, asOf: "2026-06", measures: { Trucks: { latest: 280000, latestDate: "2026-06", yoyPct: 3.4, series: [] } } };
const PULSE: PulseItem[] = [
  { id: "MORTGAGE30US", label: "30-year fixed mortgage rate", value: 6.21, unit: "%", date: "2026-09-04", prev: 6.25, prevDate: "2026-08-28", changePct: -0.64, source: "FRED MORTGAGE30US", series: [] },
  { id: "bts-diesel", label: "diesel, $ per gallon", value: 3.71, unit: "$/gal", date: "2026-09-07", prev: null, prevDate: null, changePct: null, source: "BTS Supply Chain Indicators", series: [] },
];

function trade(): LayerFeature[] {
  return [...buildPorts([PORT], new Map([[1234, STATS]])), ...buildCrossings([CROSSING])];
}

function full() {
  return buildMarketReport(-97.75, 30.3, { areas: areaFixtures(), trade: trade(), loaded: { areas: true, trade: true, pulse: true }, pulse: PULSE, sectors: [{ code: "54", title: "Professional", estabs: 1, emp: 95000, avgWeeklyWage: 2400, lq: 1.9, yoyEmp: 2, suppressed: false }] }, NOW);
}

describe("buildMarketReport provenance", () => {
  it("names every source the sections used, once, with periods from the data", () => {
    const r = full();
    expect(r.area?.geoid).toBe("48453");
    const ids = r.provenance.map((p) => p.source.id);
    expect(new Set(ids)).toEqual(new Set(["zillow-zhvi", "zillow-zori", "bls-qcew", "fred", "bts-supply-chain", "nga-wpi", "bts-ports", "bts-border"]));
    const zhvi = r.provenance.find((p) => p.source.id === "zillow-zhvi" && p.kind === "published")!;
    expect(zhvi.period).toBe("2026-07");
    expect(zhvi.seriesId).toContain("County_zhvi");
    const qcew = r.provenance.find((p) => p.source.id === "bls-qcew" && !p.seriesId?.includes("NAICS"))!;
    expect(qcew.period).toBe("2026-Q1");
    expect(qcew.seriesId).toBe("area 48453, all ownerships, all industries");
    expect(r.provenance.find((p) => p.source.id === "fred")?.seriesId).toBe("MORTGAGE30US");
    expect(r.provenance.find((p) => p.source.id === "bts-ports")?.period).toBe("2024");
    expect(r.provenance.find((p) => p.source.id === "bts-border")?.period).toBe("2026-06");
    expect(r.provenance.every((p) => p.retrievedAt === "2026-09-11T10:00:00.000Z")).toBe(true);
    // de-duplicated: the same ZHVI county release is used by home and affordability but listed once
    expect(r.provenance.filter((p) => p.source.id === "zillow-zhvi" && p.kind === "published")).toHaveLength(1);
  });
  it("labels every computed number as an estimate with its arithmetic", () => {
    const r = full();
    const estimates = r.provenance.filter((p) => p.kind === "estimate");
    const methods = estimates.map((p) => p.method ?? "");
    expect(methods.some((m) => m.startsWith("price-to-rent = "))).toBe(true);
    expect(methods.some((m) => m.includes("payment = P·r"))).toBe(true);
    expect(methods.some((m) => m.startsWith("momentum = "))).toBe(true);
    expect(r.affordability.estimate).not.toBeNull();
    expect(r.affordability.provenance.map((p) => p.source.id)).toEqual(["zillow-zhvi", "fred", "bls-qcew", "zillow-zhvi"]);
    expect(r.affordability.provenance[3].kind).toBe("estimate");
  });
  it("attaches provenance per section next to basis", () => {
    const r = full();
    const s = marketSectionProvenance(r);
    expect(s.home.map((p) => p.source.id)).toEqual(["zillow-zhvi"]);
    expect(s.rent.map((p) => p.kind)).toEqual(["published", "estimate"]);
    expect(s.jobs.map((p) => p.seriesId)).toEqual(["area 48453, all ownerships, all industries", "area 48453, NAICS sectors, private ownership"]);
    expect(s.trade.map((p) => p.source.id)).toEqual(["nga-wpi", "bts-ports", "bts-border"]);
    expect(s.pulse.map((p) => p.source.id)).toEqual(["fred", "bts-supply-chain"]);
    expect(r.rent.data.asOf).toBe("2026-07-31");
    expect(typeof r.home.basis).toBe("string");
  });
  it("citations are one unique line per record and appear in the text export", () => {
    const r = full();
    expect(r.citations).toHaveLength(r.provenance.length);
    expect(new Set(r.citations).size).toBe(r.citations.length);
    expect(r.citations[0]).toMatch(/accessed 2026-09-11\.$/);
    expect(marketCitations(r)).toEqual(r.citations);
    const text = marketReportText(r);
    expect(text).toContain("SOURCES");
    expect(text).toContain("Zillow Research. Zillow Home Value Index (ZHVI). series County_zhvi");
  });
  it("with nothing loaded, only the caveats remain and provenance is empty", () => {
    const r = buildMarketReport(-97.75, 30.3, { areas: [], trade: [], loaded: { areas: false, trade: false, pulse: false } }, NOW);
    expect(r.provenance).toEqual([]);
    expect(r.citations).toEqual([]);
    expect(r.home.provenance).toEqual([]);
    expect(r.affordability.provenance).toEqual([]);
    expect(r.momentum.score).toBeNull();
    expect(marketReportText(r)).not.toContain("SOURCES");
  });
  it("a suppressed QCEW cell is still cited, with the withholding noted", () => {
    const r = buildMarketReport(-103.6, 31.8, { areas: areaFixtures(), trade: [], loaded: { areas: true, trade: false, pulse: false } }, NOW);
    expect(r.area?.geoid).toBe("48301");
    const q = r.jobs.provenance[0];
    expect(q.source.id).toBe("bls-qcew");
    expect(q.notes?.[0]).toContain("withheld");
    expect(r.home.provenance).toEqual([]);
  });
  it("qcewArea pads states to SS000", () => {
    expect(qcewArea({ level: "county", geoid: "48453" })).toBe("48453");
    expect(qcewArea({ level: "state", geoid: "48" })).toBe("48000");
  });
});
