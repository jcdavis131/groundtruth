// NLDI and EPA NHDPlus V2.1 parsing on answers captured 2026-10-16 at the Boise River
// (-116.2023, 43.6150), unmodified: position, main stem downstream (distance 50 km), USGS
// gauges upstream (500 km), the basin NLDI sends by default (simplified) and with
// simplified=false, EPA's attributes by comid, and two real EPA rows that carry the
// -9999 / null sentinels (comid 800008213 and 800003624). The Missouri basin above Pierre, SD
// (comid 19250187, simplified, 210 rings of which 209 holes, 19,524 vertices) was captured
// 2026-10-16 unmodified: before rings could be left out it answered 502 ("could not be cut").
import { describe, expect, it } from "vitest";
import position from "./fixtures/nldi-position-boise.json";
import ocean from "./fixtures/nldi-position-ocean.json";
import dm from "./fixtures/nldi-dm-boise.json";
import ut from "./fixtures/nldi-ut-gauges-boise.json";
import basin from "./fixtures/nldi-basin-boise.json";
import basinFull from "./fixtures/nldi-basin-boise-full.json";
import basinMissouri from "./fixtures/nldi-basin-missouri-19250187.json";
import epa from "./fixtures/epa-v21-boise.json";
import sentinel from "./fixtures/epa-v21-sentinel.json";
import noflow from "./fixtures/epa-v21-noflow.json";
import {
  approxAreaKm2,
  basinPolygon,
  flowlines,
  ftypeWord,
  newGauges,
  parseComid,
  parseV21,
  positionUrl,
  reachDetails,
  traceDistance,
  traceUrl,
  upstreamGauges,
  v21Params,
  vertexCount,
} from "./nldi";

describe("NLDI position", () => {
  it("reads the comid of the catchment containing the point, and none in the ocean", () => {
    expect(parseComid(position)).toBe(23398863);
    expect(parseComid(ocean)).toBeNull();
    expect(parseComid({ features: [] })).toBeNull();
    expect(positionUrl(-116.2023, 43.615)).toBe("https://api.water.usgs.gov/nldi/linked-data/comid/position?coords=POINT(-116.2023%2043.615)&f=json");
  });
});

describe("EPA NHDPlus V2.1 by comid", () => {
  it("asks lowercase named fields and reads the Boise River reach", () => {
    const p = v21Params(23398863);
    expect(p.where).toBe("comid=23398863");
    expect(p.outFields).toBe("comid,gnis_name,reachcode,ftype,fcode,streamorder,totdasqkm,qa_ma,qe_ma,fdate,lengthkm");
    expect(p.outFields).toBe(p.outFields.toLowerCase());
    const r = parseV21(epa, 23398863)!;
    expect(r).toMatchObject({ comid: 23398863, name: "Boise River", reachcode: "17050114000332", ftype: 558, ftypeWord: "artificial path", streamOrder: 6, fdate: "2001-03-08" });
    expect(r.drainageKm2).toBeCloseTo(7097.2164, 3);
    expect(r.flowCfs).toBeCloseTo(1476.521, 3);
    expect(r.runoffCfs).toBeCloseTo(2954.685, 3);
    expect(parseV21(epa, 1)).toBeNull();
  });

  it("shows both flows, gauge-adjusted first, and says they are modelled", () => {
    const d = reachDetails(parseV21(epa, 23398863), 23398863);
    expect(d["drains to"]).toBe("Boise River (NHDPlus V2 reach)");
    expect(d["modelled mean annual flow (EROM, gauge-adjusted)"]).toBe("1,477 cfs");
    expect(d["runoff-only estimate"]).toBe("2,955 cfs");
    expect(d["drainage area"]).toBe("7,097.2 km²");
    expect(d["stream order"]).toBe("6");
  });

  it("turns -9999, an order of 0 and missing flows into 'not published', never 0", () => {
    const s = parseV21(sentinel, 800008213)!;
    expect(s.drainageKm2).toBeNull();
    expect(s.streamOrder).toBeNull();
    expect(s.flowCfs).toBeNull();
    expect(s.ftypeWord).toBe("coastline");
    const d = reachDetails(s, 800008213);
    expect(d["drains to"]).toBe("an unnamed reach (NHDPlus V2 reach)");
    expect(d["drainage area"]).toBe("not published");
    expect(d["stream order"]).toBe("not published");
    expect(d["modelled mean annual flow (EROM, gauge-adjusted)"]).toBe("not published");
    const n = parseV21(noflow, 800003624)!;
    expect(n.streamOrder).toBe(1);
    expect(n.flowCfs).toBeNull();
    expect(n.runoffCfs).toBeNull();
  });

  it("says 'no reach here' with no comid, and unknown attributes when EPA did not answer", () => {
    expect(reachDetails(null, null)["drains to"]).toMatch(/^no NHDPlus V2 reach here/);
    expect(reachDetails(null, 23398863)["drains to"]).toMatch(/did not answer/);
    expect(ftypeWord(460)).toBe("stream/river");
    expect(ftypeWord(999)).toBe("NHD FType 999");
  });
});

describe("NLDI traces", () => {
  it("always sends a distance, defaulting by mode and capped at 500 km", () => {
    expect(traceDistance("down", null)).toBe(100);
    expect(traceDistance("gauges", "")).toBe(150);
    expect(traceDistance("gauges", "900")).toBe(500);
    expect(traceDistance("down", "0")).toBe(1);
    expect(traceUrl(23398863, "down", 100)).toBe("https://api.water.usgs.gov/nldi/linked-data/comid/23398863/navigation/DM/flowlines?distance=100&f=json");
    expect(traceUrl(23398863, "gauges", 150)).toBe("https://api.water.usgs.gov/nldi/linked-data/comid/23398863/navigation/UT/nwissite?distance=150&f=json");
    expect(traceUrl(23398863, "basin", 0)).toBe("https://api.water.usgs.gov/nldi/linked-data/comid/23398863/basin?simplified=true&splitCatchment=false");
  });

  it("makes the 79 downstream flowlines one line set", () => {
    const f = flowlines(dm);
    expect(f.count).toBe(79);
    expect(f.geometry.type).toBe("MultiLineString");
    expect(f.geometry.coordinates).toHaveLength(79);
    expect(f.geometry.coordinates[0][0]).toEqual([-116.195583001, 43.604679294]);
  });

  it("reads the 128 upstream gauges and strips USGS- for the site number", () => {
    const g = upstreamGauges(ut);
    expect(g).toHaveLength(128);
    expect(g[0]).toMatchObject({ identifier: "USGS-13186000", siteNo: "13186000", name: "SF BOISE RIVER NR FEATHERVILLE ID", comid: 23386623, uri: "https://waterdata.usgs.gov/monitoring-location/USGS-13186000" });
  });

  it("draws a gauge the Surface water layer already draws once, matched by site number", () => {
    const g = upstreamGauges(ut);
    const drawn = ["usgs:USGS-13186000", "usgs:USGS-13200000", "ne-river:12", "twdb:13185000", "nwps:BOII1"];
    const left = newGauges(g, drawn);
    expect(left).toHaveLength(126);
    expect(left.some((x) => x.siteNo === "13186000" || x.siteNo === "13200000")).toBe(false);
    expect(newGauges(g, ["13186000"])).toHaveLength(127);
  });

  it("keeps NLDI's simplified basin as sent, and cuts the full one to 2,000 vertices within 1 % of its area", () => {
    const b = basinPolygon(basin)!;
    expect(b.sent).toBe(793);
    expect(b.vertices).toBe(793);
    expect(b.tolerance).toBeNull();
    expect(vertexCount((basinFull as { features: Array<{ geometry: GeoJSON.Polygon }> }).features[0].geometry)).toBe(3234);
    const cut = basinPolygon(basinFull, 2000)!;
    expect(cut.sent).toBe(3234);
    expect(cut.vertices).toBeLessThanOrEqual(2000);
    const full = (basinFull as { features: Array<{ geometry: GeoJSON.Polygon }> }).features[0].geometry;
    expect(Math.abs(approxAreaKm2(cut.geometry) - approxAreaKm2(full)) / approxAreaKm2(full)).toBeLessThan(0.01);
    // NLDI's basin for this reach is about the reach's published drainage area (7,097 km²).
    expect(approxAreaKm2(full)).toBeGreaterThan(6500);
    expect(approxAreaKm2(full)).toBeLessThan(7700);
    expect(basinPolygon({ features: [] })).toBeNull();
    expect(cut.droppedRings).toBe(0);
  });

  it("cuts a basin with hundreds of holes to the cap by leaving out the small ones, keeping the outline", () => {
    const sentGeom = (basinMissouri as { features: Array<{ geometry: GeoJSON.MultiPolygon }> }).features[0].geometry;
    expect(sentGeom.type).toBe("MultiPolygon");
    expect(sentGeom.coordinates.reduce((n, p) => n + p.length, 0)).toBe(210);
    const cut = basinPolygon(basinMissouri)!;
    expect(cut).not.toBeNull();
    expect(cut.sent).toBe(19524);
    expect(cut.vertices).toBeLessThanOrEqual(2000);
    expect(cut.droppedRings).toBeGreaterThan(100);
    expect(cut.droppedUnderKm2).toBeGreaterThan(0);
    // Leaving holes out adds their area back: within 1 % of the basin as sent.
    expect(Math.abs(approxAreaKm2(cut.geometry) - approxAreaKm2(sentGeom)) / approxAreaKm2(sentGeom)).toBeLessThan(0.01);
    // The largest outer ring is always kept: the cut covers the same extent.
    const xs = (g: GeoJSON.Polygon | GeoJSON.MultiPolygon) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).flatMap((p) => p[0].map((c) => c[0]));
    expect(Math.min(...xs(cut.geometry))).toBeCloseTo(Math.min(...xs(sentGeom)), 1);
    expect(Math.max(...xs(cut.geometry))).toBeCloseTo(Math.max(...xs(sentGeom)), 1);
    // A tighter cap still answers (a coarser outline), never null.
    const tight = basinPolygon(basinMissouri, 300)!;
    expect(tight.vertices).toBeLessThanOrEqual(300);
  });
});
