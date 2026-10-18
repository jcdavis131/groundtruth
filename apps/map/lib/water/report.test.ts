import { describe, expect, it } from "vitest";
import type { GaugeReading, WellReading } from "@/app/api/water/route";
import type { LayerFeature } from "@/lib/layers/types";
import { buildDrought, buildGauges, buildReservoirs, buildWells, mergeFlood, type NwpsRow, type TwdbRow } from "./features";
import { buildWaterReport, reportAsText, waterCitations, waterSectionProvenance } from "./report";

const NOW = Date.parse("2026-09-11T10:00:00Z");
const LON = -98.49;
const LAT = 29.42;

const gauge = (param: string, value: number, unit: string, time = "2026-09-11T09:30:00Z"): GaugeReading => ({ site: "USGS-08178000", name: "San Antonio Rv at San Antonio, TX", siteType: "Stream", lon: -98.49, lat: 29.41, param, value, unit, time, approval: "Provisional" });

function water(): LayerFeature[] {
  const gauges = buildGauges([gauge("00060", 120, "ft^3/s"), gauge("00300", 3.9, "mg/l"), gauge("00010", 27.5, "degC", "2026-09-11T09:45:00Z")], NOW);
  const nwps: NwpsRow[] = [{ lid: "SATT2", name: "San Antonio River at San Antonio", lat: 29.41, lon: -98.49, state: "TX", observed: { primary: 4.1, primaryUnit: "ft", secondary: 0.12, secondaryUnit: "kcfs", floodCategory: "no_flooding", validTime: "2026-09-11T09:15:00Z" } }];
  const twdb: TwdbRow[] = [{ id: "medina", name: "Medina Lake", lon: -98.93, lat: 29.54, percentFull: 40, capacityAcFt: 250000, storageAcFt: 100000, elevationFt: 1030, poolElevationFt: 1064.2, date: "2026-09-10T00:00:00", tags: ["water_supply"] }];
  return [...gauges, ...mergeFlood(gauges, nwps), ...buildReservoirs(twdb)];
}

function groundwater(): LayerFeature[] {
  const drought = buildDrought({ type: "FeatureCollection", features: [{ type: "Feature", properties: { DM: 2 }, geometry: { type: "Polygon", coordinates: [[[-99, 29], [-98, 29], [-98, 30], [-99, 30], [-99, 29]]] } }] });
  const well: WellReading = { site: "USGS-292859098282801", lon: -98.47, lat: 29.48, param: "72019", value: 312.4, unit: "ft", time: "2026-09-10T00:00:00Z", aquifer: "Edwards-Trinity aquifer system", aquiferCode: "S500EDRTRN" };
  return [...drought, ...buildWells([well], NOW)];
}

function full() {
  return buildWaterReport(LON, LAT, { water: water(), groundwater: groundwater(), turbidity: [], loaded: { water: true, groundwater: true, turbidity: false } }, NOW);
}

describe("buildWaterReport provenance", () => {
  it("names every source the sections used with what the call knew", () => {
    const r = full();
    expect(r.drought.data.dm).toBe(2);
    expect(r.reservoirs.n).toBe(1);
    expect(r.gauges.n).toBe(1);
    expect(r.wells.n).toBe(1);
    const ids = new Set(r.provenance.map((p) => p.source.id));
    expect(ids).toEqual(new Set(["usdm", "twdb", "usgs-water", "noaa-nwps"]));
    const g = r.gauges.provenance.find((p) => p.source.id === "usgs-water")!;
    expect(g.seriesId).toBe("latest-continuous 00010,00060,00300");
    expect(g.period).toBe("2026-09-11T09:45:00.000Z");
    expect(g.notes?.[0]).toBe("1 sites within 75 km");
    const n = r.gauges.provenance.find((p) => p.source.id === "noaa-nwps")!;
    expect(n.period).toBe("2026-09-11T09:15:00Z");
    const t = r.reservoirs.provenance.find((p) => p.source.id === "twdb" && p.kind === "published")!;
    expect(t.period).toBe("2026-09-10");
    const w = r.wells.provenance[0];
    expect(w.seriesId).toBe("latest-daily 72019");
    expect(w.period).toBe("2026-09-10T00:00:00.000Z");
    expect(r.drought.provenance[0].source.id).toBe("usdm");
    expect(r.provenance.every((p) => p.retrievedAt === "2026-09-11T10:00:00.000Z")).toBe(true);
  });
  it("labels the weighted percent full, quality screen and stress index as estimates with formulas", () => {
    const r = full();
    const est = r.provenance.filter((p) => p.kind === "estimate").map((p) => p.method ?? "");
    expect(est.some((m) => m.startsWith("weighted percent full = "))).toBe(true);
    expect(est.some((m) => m.startsWith("quality screen per site = 1 − points / (2 × n)"))).toBe(true);
    expect(est.some((m) => m.startsWith("supply stress = Σ wᵢ·termᵢ / Σ wᵢ"))).toBe(true);
    expect(r.stress.score).not.toBeNull();
    expect(r.stress.provenance).toHaveLength(1);
    expect(r.stress.provenance[0].source.id).toBe("usdm");
    expect(r.stress.provenance[0].method).toContain(r.stress.formula);
    const s = waterSectionProvenance(r);
    expect(s.reservoirs.map((p) => p.kind)).toEqual(["published", "estimate"]);
    expect(s.gauges.map((p) => p.source.id)).toEqual(["usgs-water", "noaa-nwps", "usgs-water"]);
    expect(s.turbidity).toEqual([]);
  });
  it("citations are unique, one per record, and printed by the text export", () => {
    const r = full();
    expect(r.citations).toHaveLength(r.provenance.length);
    expect(new Set(r.citations).size).toBe(r.citations.length);
    expect(waterCitations(r)).toEqual(r.citations);
    const text = reportAsText(r);
    expect(text).toContain("U.S. Geological Survey. USGS Water Data API. series latest-continuous 00010,00060,00300");
    expect(text).toContain("estimate computed by Embedding Atlas: supply stress");
  });
  it("with nothing loaded there is no provenance and no stress record", () => {
    const r = buildWaterReport(LON, LAT, { water: [], groundwater: [], turbidity: [], loaded: { water: false, groundwater: false, turbidity: false } }, NOW);
    expect(r.provenance).toEqual([]);
    expect(r.citations).toEqual([]);
    expect(r.stress.provenance).toEqual([]);
    expect(r.gauges.provenance).toEqual([]);
  });
  it("USGS reservoir gauges without capacity are cited under usgs-water, not twdb", () => {
    const res = buildGauges([{ ...gauge("00062", 1030.2, "ft"), site: "USGS-08179500", siteType: "Lake, Reservoir, Impoundment", lon: -98.9, lat: 29.55 }], NOW);
    const r = buildWaterReport(LON, LAT, { water: res, groundwater: [], turbidity: [], loaded: { water: true, groundwater: false, turbidity: false } }, NOW);
    expect(r.reservoirs.n).toBe(1);
    expect(r.reservoirs.data.weightedPercentFull).toBeNull();
    expect(r.reservoirs.provenance.map((p) => p.source.id)).toEqual(["usgs-water"]);
    expect(r.reservoirs.provenance[0].seriesId).toBe("latest-continuous 00062,00054");
  });
});
