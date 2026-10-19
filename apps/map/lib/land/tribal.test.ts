// BIA AIAN-LAR on the national answer re-fetched 2026-10-17 with the route's exact query
// (outFields=LARID,LARNAME,CLASSIFICATION,GISACRES,REGION, outSR=4326, maxAllowableOffset=0.01,
// geometryPrecision=4, f=geojson), unmodified: 335 land areas, 4,279 polygon parts, 3,009 of
// them under 0.7 km2, 82 land areas with every part under 0.7 km2.
import { describe, expect, it } from "vitest";
import lar from "./fixtures/bia-lar-national.json";
import { receivedRecordText } from "@/lib/catalog/recordText";
import {
  buildTribal,
  filterTribalParts,
  smallPartsCaveat,
  TRIBAL_CAVEAT,
  TRIBAL_FIELDS,
  TRIBAL_KEEP_LARGEST_PART,
  TRIBAL_MIN_PART_KM2,
  type TribalExtra,
} from "./tribal";
import { ringsArea } from "@/lib/fabric/geo";

type Fc = { features: Array<{ geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; properties: Record<string, unknown> }> };
const fc = lar as unknown as Fc;
const parts = (g: GeoJSON.Polygon | GeoJSON.MultiPolygon) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

describe("the fixture is the route's query", () => {
  it("has 335 land areas and no field outside the five asked", () => {
    expect(fc.features).toHaveLength(335);
    for (const f of fc.features) for (const k of Object.keys(f.properties)) expect(TRIBAL_FIELDS as readonly string[]).toContain(k);
    expect(JSON.stringify(lar)).not.toMatch(/@|phone|\(\d{3}\)/i);
  });

  it("keeps CLASSIFICATION as BIA codes it: '1' 333, '3' 2", () => {
    const by = new Map<string, number>();
    for (const f of fc.features) by.set(String(f.properties.CLASSIFICATION), (by.get(String(f.properties.CLASSIFICATION)) ?? 0) + 1);
    expect(Object.fromEntries(by)).toEqual({ "1": 333, "3": 2 });
  });
});

describe("the small-part rule", () => {
  const kept = filterTribalParts(fc.features);

  it("is 0.7 km2 and keeps each land area's largest part", () => {
    expect(TRIBAL_MIN_PART_KM2).toBe(0.7);
    expect(TRIBAL_KEEP_LARGEST_PART).toBe(true);
  });

  it("drops the parts under the floor except each land area's largest, and keeps all 335 land areas", () => {
    expect(kept.features).toHaveLength(335);
    expect(kept.hiddenAreas).toEqual([]);
    const total = fc.features.reduce((n, f) => n + parts(f.geometry).length, 0);
    const small = fc.features.reduce((n, f) => n + parts(f.geometry).filter((p) => ringsArea([p[0]]) < 0.7).length, 0);
    expect(total).toBe(4279);
    expect(small).toBe(3009);
    expect(kept.keptSmallLargest).toBe(82);
    expect(kept.droppedParts).toBe(small - 82);
    for (const f of kept.features) {
      const ps = parts(f.geometry);
      // Only the first (largest) part may be under the floor.
      for (const p of ps.slice(1)) expect(ringsArea([p[0]])).toBeGreaterThanOrEqual(0.7);
      for (let i = 1; i < ps.length; i++) expect(ringsArea([ps[i - 1][0]])).toBeGreaterThanOrEqual(ringsArea([ps[i][0]]));
    }
  });

  it("keeps the holes of a kept part (dropping one would paint fee land as trust land)", () => {
    const holesBefore = fc.features.reduce((n, f) => n + parts(f.geometry).filter((p) => ringsArea([p[0]]) >= 0.7).reduce((m, p) => m + p.length - 1, 0), 0);
    const holesAfter = kept.features.reduce((n, f) => n + parts(f.geometry).filter((p) => ringsArea([p[0]]) >= 0.7).reduce((m, p) => m + p.length - 1, 0), 0);
    expect(holesAfter).toBe(holesBefore);
  });

  it("under the literal rule (no largest part kept), removes 82 land areas and lists every one by name", () => {
    const literal = filterTribalParts(fc.features, 0.7, false);
    expect(literal.features).toHaveLength(335 - 82);
    expect(literal.hiddenAreas).toHaveLength(82);
    expect(literal.droppedParts).toBe(3009);
    const names = literal.hiddenAreas.map((h) => h.LARNAME);
    for (const n of ["Narragansett", "Mashpee Wampanoag", "Poarch Creek", "Chitimacha", "Ysleta Del Sur"]) expect(names).toContain(n);
    expect(literal.keptSmallLargest).toBe(0);
    expect(smallPartsCaveat(literal.droppedParts, literal.keptSmallLargest, 82, false)).toMatch(/82 land areas entirely under that size are not drawn and are listed by name/);
  });

  it("says the count in the caveat, from the answer", () => {
    const c = smallPartsCaveat(kept.droppedParts, kept.keptSmallLargest, 0);
    expect(c).toContain("2,927 polygon parts under 0.7 km2 (about the size of a 160-acre allotment) are dropped and not drawn");
    expect(c).toContain("82 parts under 0.7 km2 are drawn, because each is its land area's only or largest part, so no land area disappears");
    // The line never claims that no small part is drawn while 82 are.
    expect(c).not.toMatch(/no part the size of one allotment is drawn|no part under 0\.7 km2 is drawn/);
    expect(c).toMatch(/Nothing here is joined to parcels, names or addresses/);
  });
});

describe("features", () => {
  const built = buildTribal(filterTribalParts(fc.features).features);

  it("names each land area by BIA's name, once, and shows the code as BIA codes it", () => {
    expect(built).toHaveLength(335);
    expect(new Set(built.map((f) => f.properties.id)).size).toBe(335);
    const crow = built.find((f) => f.properties.name === "Crow Creek")!;
    expect(crow.properties.layer).toBe("tribal");
    expect(crow.properties.details?.classification).toBe("1 (as BIA codes it; the service publishes no meaning for the code)");
    expect(crow.properties.details?.["GIS acres"]).toMatch(/GIS acres, not surveyed acreage/);
    expect(crow.properties.anchor).toHaveLength(2);
    const x = crow.properties.extra as TribalExtra;
    expect(x.region).toBe("Great Plains");
  });

  it("embeds the land area's name and says it is BIA trust land in its BIA region, never REGION under NPS's", () => {
    for (const f of built) {
      const t = receivedRecordText(f.properties);
      const region = (f.properties.extra as TribalExtra).region;
      // B0 (2026-10-18): the card's head comes first.
      expect(t).toBe(
        `collection: Trust land, Land Area Representation; agency: Bureau of Indian Affairs (BIA); BIA land area: ${f.properties.name}${region ? `; BIA trust land area, BIA region: ${region}` : ""}`,
      );
      expect(t).not.toMatch(/NPS region/);
    }
  });

  it("carries no contact and no parcel, owner or address field", () => {
    const s = JSON.stringify(built);
    expect(s).not.toMatch(/@|phone|owner|address|parcel id/i);
  });

  it("says Oklahoma is missing, so a blank is not 'no tribal land'", () => {
    expect(TRIBAL_CAVEAT).toMatch(/no Eastern Oklahoma region rows and no land in Oklahoma/);
    expect(TRIBAL_CAVEAT).toMatch(/a blank area does not mean there is no tribal land there/);
  });
});
