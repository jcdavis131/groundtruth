// CDC PLACES on answers captured 2026-10-16. Unmodified except where named: the measure list
// (swc5-untb grouped by measureid), Travis County's every-measure answer (the critique's
// places_cty.body), Capitol Planning Region's (09110) DIABETES tracts, fabric's TIGER tracts for
// a Hartford box (eye.jcamd.com), and the whole-measure DIABETES pull trimmed to the seven
// Northeast states the county-outline fixture covers (135 of its 2,958 rows, 2,957 counties and the national row; the full
// count is in the measure list). Fixtures are minified; values are as CDC sent them.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import measures from "./fixtures/places-measures.json";
import travis from "./fixtures/places-county-48453-all.json";
import northeast from "./fixtures/places-county-diabetes-northeast-trimmed.json";
import tracts09110 from "./fixtures/places-tract-09110-diabetes.json";
import fabricTracts from "./fixtures/fabric-tract-hartford.json";
import areasCt from "@/lib/economy/fixtures/areas-ct.json";
import { countyOutlines } from "@/lib/layers/areas";
import { countiesInView, esriRingsToMulti, joinHealthCounties, joinHealthTracts, type HealthExtra } from "@/lib/layers/health";
import type { ConstructNode } from "@/lib/fabric/types";
import { binOf, countyMeasureUrl, parsePlaces, PLACES_MEASURES, placeDetails, quintiles, SOCIAL_NEEDS, tractUrl } from "./places";

const outlines = countyOutlines((areasCt as unknown as { data: Parameters<typeof countyOutlines>[0] }).data);

describe("the PLACES measure list", () => {
  it("is CDC's 40 measures with their data year and county counts, as published", () => {
    const rows = (measures as Array<Record<string, string>>).filter((r) => r.datavaluetypeid === "AgeAdjPrv");
    expect(rows).toHaveLength(40);
    for (const r of rows) {
      const m = PLACES_MEASURES[r.measureid as keyof typeof PLACES_MEASURES];
      expect(m, r.measureid).toBeDefined();
      expect(m).toMatchObject({ name: r.measure, short: r.short_question_text, category: r.category, year: Number(r.year), rows: Number(r.count) });
    }
    expect(PLACES_MEASURES.DIABETES.rows).toBe(2958);
    for (const s of SOCIAL_NEEDS) expect(PLACES_MEASURES[s].category).toBe("Health-Related Social Needs");
  });
});

describe("county values", () => {
  it("asks one whole-measure pull, age-adjusted, and never by location or box", () => {
    const u = new URL(countyMeasureUrl("DIABETES"));
    expect(u.searchParams.get("measureid")).toBe("DIABETES");
    expect(u.searchParams.get("datavaluetypeid")).toBe("AgeAdjPrv");
    expect(u.searchParams.get("$limit")).toBe("5000");
    expect(u.toString()).not.toMatch(/within_box|locationid=/);
  });

  it("joins Connecticut's planning regions by FIPS, masks the rest, and bins by national quintiles", () => {
    const rows = parsePlaces(northeast, "county");
    expect(rows).toHaveLength(135);
    expect(rows.find((r) => r.fips === "09110")).toMatchObject({ name: "Capitol", value: 9.2, low: 8.4, high: 10, year: 2023 });
    const breaks = [8, 9, 10, 11];
    const j = joinHealthCounties(outlines, rows, "DIABETES", breaks);
    expect(j.features).toHaveLength(52);
    expect(j.published + j.notPublished).toBe(52);
    const capitol = j.features.find((f) => f.properties.id === "places:county:09110")!;
    expect((capitol.properties.extra as HealthExtra).bin).toBe(binOf(9.2, breaks));
    expect(capitol.properties.details?.value).toBe("9.2% (95% CI 8.4-10), age-adjusted prevalence, 2023");
    // A county with no row is "not published", never 0.
    const none = joinHealthCounties(outlines, [], "DIABETES", breaks);
    expect(none.published).toBe(0);
    expect(none.features[0].properties.details?.value).toBe("not published for this measure");
    expect((none.features[0].properties.extra as HealthExtra).bin).toBeNull();
  });

  it("puts a value in its quintile, and has no breaks for fewer than five values", () => {
    expect(quintiles([1, 2, 3, 4, 5, null])).toEqual([2, 3, 4, 5]);
    expect(quintiles([1, 2])).toEqual([]);
    expect(binOf(1, [2, 3, 4, 5])).toBe(0);
    expect(binOf(5, [2, 3, 4, 5])).toBe(4);
    expect(binOf(null, [2, 3, 4, 5])).toBeNull();
    // Too few to rank: a published value is still drawn as published (the middle shade), never as not published.
    expect(binOf(3, [])).toBe(2);
    expect(binOf(null, [])).toBeNull();
  });
});

describe("tract values", () => {
  it("asks tracts by countyfips, crude, never within_box (and the route never does either)", () => {
    const u = new URL(tractUrl("09110", "DIABETES"));
    expect(u.searchParams.get("$where")).toBe("countyfips='09110' AND measureid='DIABETES' AND datavaluetypeid='CrdPrv'");
    const route = readFileSync(path.resolve(__dirname, "../../app/api/civic/route.ts"), "utf8");
    const lib = readFileSync(path.resolve(__dirname, "./places.ts"), "utf8");
    for (const src of [route, lib.replace(/\/\/.*$/gm, "")]) expect(src).not.toContain("within_box(");
  });

  it("joins Capitol Planning Region's tracts by FIPS onto TIGER outlines, quintiles of the tracts loaded", () => {
    const rows = parsePlaces(tracts09110, "tract");
    expect(rows).toHaveLength(246);
    const units = (fabricTracts as unknown as { data: { units: ConstructNode[] } }).data.units;
    expect(countiesInView(units)).toEqual(["09110"]);
    const j = joinHealthTracts(units, rows, "DIABETES", new Set(["09110"]));
    expect(j.features).toHaveLength(66);
    expect(j.breaks).toHaveLength(4);
    expect(j.features.every((f) => (f.properties.extra as HealthExtra).bin != null)).toBe(true);
    expect(j.features[0].geometry.type).toBe("MultiPolygon");
    // Tracts of counties not asked are counted, not drawn.
    expect(joinHealthTracts(units, rows, "DIABETES", new Set(["09120"])).notAsked).toBe(66);
  });

  it("draws published tracts as published when fewer than five are, and says they are not ranked", () => {
    const units = (fabricTracts as unknown as { data: { units: ConstructNode[] } }).data.units;
    const some = parsePlaces(tracts09110, "tract").filter((r) => units.some((u) => u.code === r.fips)).slice(0, 3);
    expect(some).toHaveLength(3);
    const j = joinHealthTracts(units, some, "DIABETES", new Set(["09110"]));
    expect(j.breaks).toEqual([]);
    const drawn = j.features.filter((f) => (f.properties.extra as HealthExtra).bin != null);
    expect(drawn).toHaveLength(3);
    expect(drawn.every((f) => f.properties.kind === "unranked")).toBe(true);
    expect(drawn[0].properties.details?.bin).toMatch(/^not ranked/);
    expect(j.features.filter((f) => f.properties.kind === "not-published")).toHaveLength(66 - 3);
  });

  it("turns Esri rings into polygons: a clockwise ring starts one, a counter-clockwise one is its hole", () => {
    const outer = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    const hole = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]];
    const island = [[2, 2], [2, 3], [3, 3], [3, 2], [2, 2]];
    expect(esriRingsToMulti([outer, hole, island]).coordinates).toEqual([[outer, hole], [island]]);
  });
});

describe("the click answer", () => {
  it("lists every measure for Travis County by CDC category, age-adjusted, and says what is not published", () => {
    const values = parsePlaces(travis, "county");
    expect(values.length).toBe(33);
    const d = placeDetails(values);
    expect(Object.keys(d)).toHaveLength(40);
    expect(d["Health Risk Behaviors: Physical Inactivity"]).toBe("20.3% (95% CI 17.3-23.5), age-adjusted prevalence, 2023");
    // Texas fielded no social-needs module in this release: none of the seven is published.
    for (const s of SOCIAL_NEEDS) expect(d[`Health-Related Social Needs: ${PLACES_MEASURES[s].short}`]).toBe("this state did not field the social-needs module");
  });
});
