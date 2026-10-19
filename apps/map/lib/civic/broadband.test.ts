// FCC BDC (December 2025, via Esri) on answers captured 2026-10-17, unmodified: Travis County's
// full row (bdc-county-48453), Connecticut's eight legacy county rows (bdc-county-ct), and an
// Austin H3 box asked with the route's own fields (bdc-hex-austin). bdc-hex-zero.sentinel.json is
// a hand-edited copy of one Austin hexagon with every count set to 0, labelled as a mutation in
// the file: BDC had no zero-location hexagon on 2026-10-17, so it exercises the guard only. The
// county outlines are /api/economy?op=areas for the Connecticut box (lib/economy/fixtures).
import { describe, expect, it } from "vitest";
import travis from "./fixtures/bdc-county-48453.json";
import ct from "./fixtures/bdc-county-ct.json";
import hexAustin from "./fixtures/bdc-hex-austin.json";
import hexZero from "./fixtures/bdc-hex-zero.sentinel.json";
import areasCt from "@/lib/economy/fixtures/areas-ct.json";
import { countyOutlines } from "@/lib/layers/areas";
import {
  BDC_FIELDS,
  BDC_PLACE_FIELDS,
  BROADBAND_CAVEAT,
  bdcPlace,
  bdcRow,
  broadbandBin,
  broadbandDetails,
  buildBroadbandHexes,
  fmtShare,
  joinBroadbandCounties,
  measureValue,
  packBdcRow,
  parseBroadbandMeasure,
  remeasureBroadband,
  unpackBdcRow,
  type BroadbandExtra,
  type BdcRow,
} from "./broadband";

type EsriRows = { features: Array<{ attributes: Record<string, unknown> }> };
const attrs = (j: unknown) => (j as EsriRows).features.map((f) => f.attributes);
const outlines = countyOutlines((areasCt as unknown as { data: Parameters<typeof countyOutlines>[0] }).data);

describe("BDC rows", () => {
  it("asks named fields only", () => {
    expect(BDC_FIELDS).not.toContain("*");
    expect(BDC_PLACE_FIELDS).not.toContain("*");
    expect(BDC_PLACE_FIELDS).toContain("ServedBSLsFiber");
  });

  it("reads Travis as published and shows 2,869 of 371,965 unserved as 0.8 %", () => {
    const t = bdcRow(attrs(travis)[0])!;
    expect(t).toMatchObject({ geoid: "48453", total: 371965, unserved: 2869, underserved: 1826, served: 367270, fiber: 268206, providers: 41, unserved12: 4740 });
    expect(fmtShare(t.unserved, t.total)).toBe("0.8 %");
    expect(measureValue(t, 0)).toBeCloseTo((2869 / 371965) * 100, 10);
    expect(measureValue(t, 2)).toBeCloseTo((268206 / 371965) * 100, 10);
    expect(measureValue(t, 3)).toBe(41);
    const d = broadbandDetails(t, "county");
    expect(d.unserved).toBe("2,869 (0.8 %)");
    expect(d["unserved means"]).toMatch(/Geostationary Satellite/);
    expect(d.licence).toMatch(/Esri Master License Agreement/);
  });

  it("round-trips the compact wire row", () => {
    const t = bdcRow(attrs(travis)[0])!;
    expect(unpackBdcRow(packBdcRow(t))).toEqual(t);
  });

  it("bins on fixed breaks, the same in every view", () => {
    expect(broadbandBin(0.77, 0)).toBe(0);
    expect(broadbandBin(1, 0)).toBe(1);
    expect(broadbandBin(30, 0)).toBe(5);
    expect(broadbandBin(41, 3)).toBe(5);
    expect(broadbandBin(null, 0)).toBeNull();
    expect(parseBroadbandMeasure("3")).toBe(3);
    expect(parseBroadbandMeasure("9")).toBe(0);
  });
});

describe("Connecticut", () => {
  it("joins none of the eight legacy rows; the nine planning regions are 'not published in this geography'", () => {
    const rows = attrs(ct).map((a) => bdcRow(a)).filter((r): r is BdcRow => r != null);
    expect(rows.map((r) => r.geoid)).toEqual(["09001", "09003", "09005", "09007", "09009", "09011", "09013", "09015"]);
    const j = joinBroadbandCounties(outlines, rows, 0);
    expect(j.unmatched).toHaveLength(8);
    expect(j.ctRegions).toBe(9);
    const regions = j.features.filter((f) => /^091[1-9]0$/.test((f.properties.extra as BroadbandExtra).geoid));
    expect(regions).toHaveLength(9);
    for (const f of regions) {
      const x = f.properties.extra as BroadbandExtra;
      expect(x.bin).toBeNull();
      expect(x.noData).toMatch(/^not published in this geography/);
      expect(f.properties.kind).toBe("no-data");
    }
    expect(BROADBAND_CAVEAT).toMatch(/Connecticut is published here in its old counties/);
  });
});

describe("H3 hexagons", () => {
  it("builds the Austin box's hexagons, named by H3 id", () => {
    const hexes = buildBroadbandHexes((hexAustin as unknown as { features: never[] }).features, 0);
    expect(hexes).toHaveLength(33);
    for (const h of hexes) {
      expect(h.properties.name).toMatch(/^H3 [0-9a-f]{15}$/);
      expect(h.properties.layer).toBe("broadband");
    }
  });

  it("gives a hexagon with no locations no share, never 0 % (labelled mutation)", () => {
    expect((hexZero as { _sentinel?: string })._sentinel).toMatch(/HAND-EDITED MUTATION/);
    const [h] = buildBroadbandHexes((hexZero as unknown as { features: never[] }).features, 0);
    const x = h.properties.extra as BroadbandExtra;
    expect(x.row!.total).toBe(0);
    expect(x.value).toBeNull();
    expect(x.bin).toBeNull();
    expect(x.noData).toBe("no locations");
    expect(fmtShare(0, 0)).toBe("no locations");
    for (let m = 0; m < 4; m++) expect(measureValue(x.row!, m as 0 | 1 | 2 | 3)).toBeNull();
  });

  it("re-colours for another measure without refetching", () => {
    const hexes = buildBroadbandHexes((hexAustin as unknown as { features: never[] }).features, 0);
    const again = remeasureBroadband(hexes, 3);
    expect((again[0].properties.extra as BroadbandExtra).measure).toBe(3);
    expect((again[0].properties.extra as BroadbandExtra).value).toBe((hexes[0].properties.extra as BroadbandExtra).row!.providers);
  });
});

describe("the place answer", () => {
  it("gives every technology and each share as a named ratio of two published counts", () => {
    const p = bdcPlace(attrs(travis)[0])!;
    expect(p.totalLocations).toBe(371965);
    expect(p.byTechnology.fiber).toEqual({ served: 268206, underserved: 1, unserved: 103758, providers: 18 });
    expect(p.previous.twelveMonths.unserved).toBe(4740);
    const unserved = p.shares.find((s) => s.name === "unserved share")!;
    expect(unserved.formula).toBe("UnservedBSLs / TotalBSLs");
    expect(unserved.value).toBeCloseTo(2869 / 371965, 12);
  });
});
