// The assembler is the only water code that talks to the network, so the test
// replaces lib/server/upstream with fixture payloads and exercises the two
// things the extraction has to preserve: the arithmetic (snapped bbox, merge
// order, radii, caveats) and the failure shape (every upstream dead still
// resolves with a report that says which source is missing).
//
// Each case re-imports the module so it gets a fresh lib/server/cache Map —
// cached() serves a stale value on producer failure, which would otherwise let
// one case's fixtures leak into the next case's outage.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetchJson: vi.fn(), fail: false }));

vi.mock("@/lib/server/upstream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/upstream")>()),
  polite: <T>(_name: string, _interval: number, _backoff: number, fn: () => Promise<T>) => fn(),
  upstreamJson: h.fetchJson,
}));

const NOW = Date.parse("2026-09-11T10:00:00Z");
const LON = -98.49;
const LAT = 29.42;
/** bboxAround(29.42, -98.49, 160 km) clamped to 4 degrees and snapped outward to the half-degree grid. */
const SNAPPED: [number, number, number, number] = [-100.5, 27.5, -96.5, 31];

const site = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  properties: { id, monitoring_location_name: name, site_type: "Stream", ...extra },
  geometry: null,
});

const reading = (id: string, param: string, value: number, unit: string, lon: number, lat: number, time = "2026-09-11T09:30:00Z") => ({
  properties: { monitoring_location_id: id, parameter_code: param, time, value: String(value), unit_of_measure: unit, approval_status: "Provisional" },
  geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] },
});

// Two USGS stream gauges inside the 75 km disc and one outside it; flow only,
// so no quality screen fires and the report sorts purely by distance.
const NEAR_GAUGE: [number, number] = [-98.5, 29.45];
const MID_GAUGE: [number, number] = [-98.8, 29.6];
const FAR_GAUGE: [number, number] = [-99.3, 30.0];

function payloadFor(url: string): unknown {
  if (url.includes("/monitoring-locations/items")) {
    return {
      features: [
        site("USGS-08178000", "San Antonio Rv at San Antonio, TX"),
        site("USGS-08181500", "Medina Rv at Macdona, TX"),
        site("USGS-08190000", "Nueces Rv at Laguna, TX"),
        site("USGS-292859098282801", "AY-68-28-101", { site_type: "Well", national_aquifer_code: "S500EDRTRN", well_depth: 640 }),
      ],
    };
  }
  if (url.includes("/latest-continuous/items")) {
    return {
      numberReturned: 3,
      features: [
        reading("USGS-08178000", "00060", 120, "ft^3/s", ...NEAR_GAUGE),
        reading("USGS-08181500", "00060", 64, "ft^3/s", ...MID_GAUGE),
        reading("USGS-08190000", "00060", 31, "ft^3/s", ...FAR_GAUGE),
      ],
    };
  }
  if (url.includes("/latest-daily/items")) {
    return { numberReturned: 1, features: [reading("USGS-292859098282801", "72019", 312.4, "ft", -98.47, 29.48, "2026-09-10T00:00:00Z")] };
  }
  if (url.includes("/national-aquifer-codes/items")) {
    return { features: [{ properties: { id: "S500EDRTRN", national_aquifer_name: "Edwards-Trinity aquifer system" } }] };
  }
  if (url.includes("api.water.noaa.gov")) {
    return {
      gauges: [
        // 0.0001 degrees of longitude from the near USGS gauge: about 10 m, so mergeFlood attaches.
        { lid: "SATT2", name: "San Antonio River at San Antonio", latitude: 29.45, longitude: -98.5001, state: { abbreviation: "TX" }, status: { observed: { primary: 4.1, primaryUnit: "ft", secondary: 0.12, secondaryUnit: "kcfs", floodCategory: "no_flooding", validTime: "2026-09-11T09:15:00Z" } } },
        { lid: "ELMT2", name: "Elm Creek near Elmendorf", latitude: 29.3, longitude: -98.3, state: { abbreviation: "TX" }, status: { observed: { primary: 2.4, primaryUnit: "ft", secondary: 0.03, secondaryUnit: "kcfs", floodCategory: "no_flooding", validTime: "2026-09-11T09:00:00Z" } } },
      ],
    };
  }
  if (url.includes("waterdatafortexas.org")) {
    return [
      { short_name: "medina", full_name: "Medina Lake", percent_full: 40, conservation_capacity: 250_000, conservation_storage: 100_000, elevation: 1030, conservation_pool_elevation: 1064.2, gauge_location: { coordinates: [-98.93, 29.54] }, timestamp: "2026-09-10T00:00:00", tags: ["water_supply"] },
    ];
  }
  if (url.includes("USDM_current")) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { DM: 2 }, geometry: { type: "Polygon", coordinates: [[[-99, 29], [-98, 29], [-98, 30], [-99, 30], [-99, 29]]] } }],
    };
  }
  throw new Error("unexpected upstream url: " + url);
}

async function load() {
  vi.resetModules();
  return import("./assemble");
}

beforeEach(() => {
  h.fetchJson.mockReset();
  h.fetchJson.mockImplementation(async (_name: string, url: string) => {
    if (h.fail) throw new Error("no egress");
    return payloadFor(url);
  });
  h.fail = false;
});

describe("waterReportAt", () => {
  it("searches the snapped half-degree box and sorts gauges by distance", async () => {
    const { waterReportAt } = await load();
    const a = await waterReportAt(LON, LAT, { now: NOW });

    expect(a.bbox).toEqual(SNAPPED);
    const asked = h.fetchJson.mock.calls.map((c) => String(c[1]));
    expect(asked.some((u) => u.includes("bbox=-100.5%2C27.5%2C-96.5%2C31"))).toBe(true);
    expect(asked.some((u) => u.includes("bbox.xmin=-100.5&bbox.ymin=27.5&bbox.xmax=-96.5&bbox.ymax=31"))).toBe(true);

    // The third USGS gauge is 100 km out, past the 75 km gauge radius.
    expect(a.report.gauges.items.map((i) => i.id)).toEqual(["usgs:USGS-08178000", "nwps:ELMT2", "usgs:USGS-08181500"]);
    const d = a.report.gauges.items.map((i) => i.distanceKm);
    expect(d[0]).toBeLessThan(d[1]);
    expect(d[1]).toBeLessThan(d[2]);
    expect(d[2]).toBeLessThan(75);

    expect(a.report.reservoirs.data.weightedPercentFull).toBe(40);
    expect(a.report.wells.data.aquifers).toEqual(["Edwards-Trinity aquifer system"]);
    expect(a.report.drought.data.dm).toBe(2);
    expect(a.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(a.provenance.map((p) => p.source.id)).toContain("noaa-nwps");
  });

  it("attaches an NWPS gauge within 200 m and keeps a distant one as its own feature", async () => {
    const { waterReportAt } = await load();
    const a = await waterReportAt(LON, LAT, { now: NOW });

    const ids = a.report.gauges.items.map((i) => i.id);
    expect(ids).toContain("usgs:USGS-08178000");
    expect(ids).not.toContain("nwps:SATT2");
    expect(ids).toContain("nwps:ELMT2");
    // The flood category rode onto the USGS feature rather than duplicating it.
    expect(a.report.gauges.items.find((i) => i.id === "usgs:USGS-08178000")!.value).toContain("no flooding");
  });

  it("always says satellite turbidity is browser-only, and names how many stress terms it kept", async () => {
    const { waterReportAt } = await load();
    const a = await waterReportAt(LON, LAT, { now: NOW });

    expect(a.report.turbidity.loaded).toBe(false);
    expect(a.report.turbidity.n).toBe(0);
    expect(a.report.turbidity.data.medianFnu).toBeNull();
    expect(a.caveats).toContain("Server report: satellite turbidity is only computed in a browser, so that term is absent here.");
    expect(a.caveats.some((c) => /^Stress uses \d of 4 terms \(/.test(c))).toBe(true);
  });

  it("resolves with unloaded sections when every upstream fails", async () => {
    const { waterReportAt } = await load();
    h.fail = true;
    const a = await waterReportAt(LON, LAT, { now: NOW });

    expect(a.bbox).toEqual(SNAPPED);
    expect(a.report.drought.loaded).toBe(false);
    expect(a.report.gauges.loaded).toBe(false);
    expect(a.report.reservoirs.loaded).toBe(false);
    expect(a.report.wells.loaded).toBe(false);
    expect(a.report.turbidity.loaded).toBe(false);
    expect(a.report.stress.score).toBeNull();
    expect(a.caveats).toContain("USGS gauges did not answer.");
    expect(a.caveats).toContain("USGS wells did not answer.");
    expect(a.caveats).toContain("US Drought Monitor did not answer.");
    expect(a.caveats).toContain("Server report: satellite turbidity is only computed in a browser, so that term is absent here.");
    expect(a.retrievedAt).toBe(new Date(NOW).toISOString());
  });

  it("fetches each upstream once for two reports at the same point", async () => {
    const { waterReportAt } = await load();
    await waterReportAt(LON, LAT, { now: NOW });
    const first = h.fetchJson.mock.calls.length;
    expect(first).toBe(7);

    await waterReportAt(LON, LAT, { now: NOW });
    expect(h.fetchJson.mock.calls.length).toBe(first);
  });
});

describe("snapBbox", () => {
  it("clamps to four degrees around the centre before snapping outward", async () => {
    const { snapBbox } = await load();
    expect(snapBbox([-100.14194, 27.98108, -96.83805, 30.85891])).toEqual(SNAPPED);
    expect(snapBbox([-110, 20, -90, 40])).toEqual([-102, 28, -98, 32]);
  });
});
