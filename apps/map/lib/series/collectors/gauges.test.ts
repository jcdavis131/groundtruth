import { describe, expect, it } from "vitest";
import { GAUGES, gaugeOutput, gaugesCollector, gaugeUnit, parseGaugeRows, usgsLatestUrl } from "./gauges";
import type { CollectorContext } from "./types";

const NOW = Date.UTC(2026, 8, 11, 6, 0, 0);

/** USGS OGC API latest-continuous fixture for one site, two parameters, one duplicate older row and one null. */
const USGS_FIXTURE = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", id: "1", geometry: { type: "Point", coordinates: [-90.0776, 35.1232] }, properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00065", statistic_id: "00011", time: "2026-09-11T05:45:00Z", value: "12.34", unit_of_measure: "ft", approval_status: "Provisional" } },
    { type: "Feature", id: "2", geometry: { type: "Point", coordinates: [-90.0776, 35.1232] }, properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00060", statistic_id: "00011", time: "2026-09-11T05:45:00Z", value: "412000", unit_of_measure: "ft^3/s", approval_status: "Provisional" } },
    { type: "Feature", id: "3", geometry: { type: "Point", coordinates: [-90.0776, 35.1232] }, properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00060", statistic_id: "00011", time: "2026-09-11T05:30:00Z", value: "411500", unit_of_measure: "ft^3/s" } },
    { type: "Feature", id: "4", geometry: null, properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00010", time: "2026-09-11T05:45:00Z", value: null, unit_of_measure: "degC" } },
    { type: "Feature", id: "5", geometry: null, properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00095", time: "not a date", value: "1", unit_of_measure: "uS/cm" } },
  ],
  numberReturned: 5,
};

describe("parseGaugeRows", () => {
  it("keeps the newest numeric reading per site and parameter", () => {
    const rows = parseGaugeRows(USGS_FIXTURE).sort((a, b) => a.param.localeCompare(b.param));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ site: "07032000", param: "00060", v: 412000, unit: "ft^3/s", approval: "Provisional" });
    expect(rows[0].t).toBe(Date.parse("2026-09-11T05:45:00Z"));
    expect(rows[1]).toMatchObject({ param: "00065", v: 12.34 });
  });
  it("tolerates an empty collection", () => {
    expect(parseGaugeRows({})).toEqual([]);
  });
});

describe("gaugeUnit / urls", () => {
  it("prefers the typographic unit for known codes and the upstream one otherwise", () => {
    expect(gaugeUnit("00060", "ft^3/s")).toBe("ft³/s");
    expect(gaugeUnit("00065")).toBe("ft");
    expect(gaugeUnit("00010", "degC")).toBe("degC");
  });
  it("builds a per-site latest-continuous query", () => {
    const u = new URL(usgsLatestUrl("07032000"));
    expect(u.pathname).toMatch(/latest-continuous\/items$/);
    expect(u.searchParams.get("monitoring_location_id")).toBe("USGS-07032000");
    expect(u.searchParams.get("parameter_code")).toBe("00065,00060");
  });
});

describe("gaugeOutput", () => {
  it("stamps the point with the observation time and relays as published", () => {
    const g = GAUGES[0];
    const [r] = parseGaugeRows(USGS_FIXTURE).filter((x) => x.param === "00065");
    const o = gaugeOutput(g, r, NOW);
    expect(o.meta.id).toBe("snapshot:gauge:07032000:00065");
    expect(o.meta.unit).toBe("ft");
    expect(o.meta.geo).toMatchObject({ kind: "gauge", id: "USGS-07032000" });
    expect(o.meta.provenance.kind).toBe("published");
    expect(o.meta.provenance.revision).toBe("Provisional");
    expect(o.points).toEqual([{ t: Date.parse("2026-09-11T05:45:00Z"), v: 12.34 }]);
  });
});

describe("gaugesCollector", () => {
  it("emits one series per site and parameter, ignoring rows for other sites", async () => {
    const out = await gaugesCollector.collect({
      now: NOW,
      keys: {},
      politeDelayMs: 0,
      fetchJson: async <T>(url: string) => {
        const site = new URL(url).searchParams.get("monitoring_location_id")!;
        const features = USGS_FIXTURE.features.map((f) => ({ ...f, properties: { ...f.properties, monitoring_location_id: site } }));
        return { features } as unknown as T;
      },
    } satisfies CollectorContext);
    expect(out).toHaveLength(GAUGES.length * 2);
    expect(new Set(out.map((o) => o.meta.id)).size).toBe(out.length);
  });
  it("fails only when every site fails", async () => {
    let n = 0;
    const out = await gaugesCollector.collect({
      now: NOW,
      keys: {},
      politeDelayMs: 0,
      fetchJson: async <T>() => {
        if (n++ === 0) throw new Error("usgs 503");
        return { features: [] } as unknown as T;
      },
    });
    expect(out).toEqual([]);
    await expect(
      gaugesCollector.collect({
        now: NOW,
        keys: {},
        politeDelayMs: 0,
        fetchJson: async () => {
          throw new Error("usgs 503");
        },
      }),
    ).rejects.toThrow(/503/);
  });
});
