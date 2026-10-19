// CDC/ATSDR SVI 2022 on answers captured 2026-10-16, unmodified: Connecticut's nine planning
// regions with Travis and Bexar (svi-county-ct-tx), an Austin tract box, two tracts CDC does
// not rank (svi-tract-notranked: every RPL_ and F_TOTAL is -999), Travis County's place row,
// and FEMA's NRI row for Travis (lib/hazards/fixtures/nri-fips-48453). The county outlines are
// /api/economy?op=areas for the Connecticut box, as eye.jcamd.com answered it the same day.
import { describe, expect, it } from "vitest";
import counties from "./fixtures/svi-county-ct-tx.json";
import tracts from "./fixtures/svi-tract-austin.json";
import notRanked from "./fixtures/svi-tract-notranked.json";
import travisPlace from "./fixtures/svi-place-48453.json";
import nriTravis from "@/lib/hazards/fixtures/nri-fips-48453.json";
import areasCt from "@/lib/economy/fixtures/areas-ct.json";
import { countyOutlines } from "@/lib/layers/areas";
import { NRI_SOVI_NOTE, nriRow } from "@/lib/hazards/nri";
import {
  buildSviTracts,
  joinSviCounties,
  parseSviTheme,
  rethemeSvi,
  SVI_BREAKS,
  SVI_COUNTY_FIELDS,
  sviBin,
  sviDetails,
  sviMeasureLines,
  sviPairBlocks,
  sviPlace,
  sviRow,
  type SviExtra,
  type SviRow,
} from "./svi";

type Fc = { features: Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }> };
const rows = (j: unknown) => (j as Fc).features.map((f) => sviRow(f.properties)).filter((r): r is SviRow => r != null);
const outlines = countyOutlines((areasCt as unknown as { data: Parameters<typeof countyOutlines>[0] }).data);

describe("SVI rows", () => {
  it("asks named fields only", () => {
    expect(SVI_COUNTY_FIELDS).not.toContain("*");
    expect(SVI_COUNTY_FIELDS).toContain("RPL_THEMES");
  });

  it("reads Travis as CDC publishes it, themes in CDC's names, 0.5702 shown as 0.57", () => {
    const t = rows(counties).find((r) => r.fips === "48453")!;
    expect(t).toMatchObject({ county: "Travis County", stAbbr: "TX", rpl: [0.5702, 0.5527, 0.0935, 0.882, 0.7805], flags: 2 });
    const d = sviDetails(t, "county");
    expect(d["overall SVI (CDC/ATSDR)"]).toBe("0.57");
    expect(d["Socioeconomic Status"]).toBe("0.55");
    expect(d["Household Characteristics"]).toBe("0.09");
    expect(d["Racial and Ethnic Minority Status"]).toBe("0.88");
    expect(d["Housing Type and Transportation"]).toBe("0.78");
    expect(d.flags).toBe("2 of 16 measures in the top 10 %");
  });

  it("reads -999 as not ranked, never as least vulnerable", () => {
    const r = rows(notRanked);
    expect(r).toHaveLength(2);
    for (const x of r) {
      expect(x.rpl).toEqual([null, null, null, null, null]);
      expect(x.flags).toBeNull();
    }
    const f = buildSviTracts((notRanked as unknown as Fc).features, 0);
    expect(f).toHaveLength(2);
    for (const x of f) {
      expect((x.properties.extra as SviExtra).bin).toBeNull();
      expect((x.properties.extra as SviExtra).noRank).toBe("not ranked by CDC");
      expect(x.properties.kind).toBe("not-ranked");
      expect(x.properties.details!["overall SVI (CDC/ATSDR)"]).toBe("not ranked by CDC");
    }
  });

  it("bins on fixed breaks: the same value is the same bin in any view", () => {
    expect([...SVI_BREAKS]).toEqual([0.25, 0.5, 0.75]);
    expect(sviBin(0)).toBe(0);
    expect(sviBin(0.2499)).toBe(0);
    expect(sviBin(0.25)).toBe(1);
    expect(sviBin(0.5702)).toBe(2);
    expect(sviBin(0.9192)).toBe(3);
    expect(sviBin(null)).toBeNull();
    // Travis joined in two different view boxes (all rows, then Texas alone) lands in the same bin.
    const all = rows(counties);
    const fake = (fips: string) => [{ geoid: fips, name: "x", feature: outlines[0].feature }];
    const a = joinSviCounties(fake("48453"), all, 0).features[0];
    const b = joinSviCounties(fake("48453"), all.filter((r) => r.stAbbr === "TX"), 0).features[0];
    expect((a.properties.extra as SviExtra).bin).toBe(2);
    expect((b.properties.extra as SviExtra).bin).toBe(2);
  });

  it("parses the theme pick, anything else is overall", () => {
    expect(parseSviTheme("3")).toBe(3);
    expect(parseSviTheme(4)).toBe(4);
    expect(parseSviTheme("9")).toBe(0);
    expect(parseSviTheme(undefined)).toBe(0);
  });
});

describe("the county join onto the shared outlines", () => {
  it("joins Connecticut's nine planning regions by FIPS, none unmatched", () => {
    const ct = rows(counties).filter((r) => r.stAbbr === "CT");
    expect(ct.map((r) => r.fips)).toEqual(["09110", "09120", "09130", "09140", "09150", "09160", "09170", "09180", "09190"]);
    const ctOutlines = outlines.filter((o) => o.geoid.startsWith("09"));
    expect(ctOutlines).toHaveLength(9);
    const j = joinSviCounties(ctOutlines, ct, 0);
    expect(j.ranked).toBe(9);
    expect(j.notInRelease).toBe(0);
    expect(j.unmatched).toEqual([]);
  });

  it("an outline with no SVI row is 'not in this release' (dashed grey), not 0", () => {
    const j = joinSviCounties(outlines.slice(0, 3), [], 1);
    expect(j.notInRelease).toBe(3);
    for (const f of j.features) {
      expect((f.properties.extra as SviExtra).noRank).toBe("not in this release");
      expect(f.properties.kind).toBe("not-in-release");
    }
  });

  it("re-colours for another theme without the network", () => {
    const j = joinSviCounties(outlines.filter((o) => o.geoid === "09110"), rows(counties), 0);
    const re = rethemeSvi(j.features, 2);
    expect((re[0].properties.extra as SviExtra).value).toBe(0.427);
    expect((re[0].properties.extra as SviExtra).bin).toBe(1);
  });
});

describe("tracts", () => {
  it("draws SVI's own tract polygons named by FIPS", () => {
    const f = buildSviTracts((tracts as unknown as Fc).features, 0);
    expect(f).toHaveLength(27);
    expect(f[0].properties.name).toBe("Tract 48453000401 · Travis County, TX");
    expect(f[0].properties.layer).toBe("vulnerability");
  });
});

describe("the click answer: CDC's SVI beside FEMA's NRI social vulnerability", () => {
  const place = sviPlace((travisPlace as unknown as Fc).features[0].properties)!;
  const nri = nriRow((nriTravis as { features: Array<{ attributes: Record<string, unknown> }> }).features[0].attributes);

  it("reads the 16 estimates with their margins", () => {
    expect(place.population).toBe(1289054);
    const lines = sviMeasureLines(place);
    expect(lines).toHaveLength(16);
    expect(lines[0]).toEqual(["persons below 150% of the poverty line", "17.3% ± 0.6"]);
  });

  it("gives two blocks with distinct titles, both values verbatim, FEMA's lineage note, nothing derived from both", () => {
    const [cdc, fema] = sviPairBlocks(place, nri, "county");
    expect(cdc.title).toBe("CDC/ATSDR Social Vulnerability Index 2022");
    expect(fema.title).toBe("FEMA National Risk Index: social vulnerability (Census Community Resilience Estimate)");
    expect(cdc.title).not.toBe(fema.title);
    expect(Object.fromEntries(cdc.lines)["overall percentile"]).toBe("0.57");
    expect(Object.fromEntries(fema.lines)).toEqual({ rating: "Very Low", score: "14.76 of 100" });
    expect(fema.note).toBe(NRI_SOVI_NOTE);
    // No line mixes the two: CDC's block never names FEMA's numbers, FEMA's never CDC's.
    const cdcText = JSON.stringify(cdc.lines);
    const femaText = JSON.stringify(fema.lines);
    expect(cdcText).not.toContain("14.76");
    expect(cdcText).not.toContain("Very Low");
    expect(femaText).not.toContain("0.57");
    expect(cdc.lines.length + fema.lines.length).toBe(9);
  });

  it("says 'not in the NRI tract layer' when FEMA has no row, and keeps CDC's block", () => {
    const [cdc, fema] = sviPairBlocks(place, null, "tract");
    expect(Object.fromEntries(fema.lines).rating).toBe("not in the NRI tract layer");
    expect(Object.fromEntries(cdc.lines)["overall percentile"]).toBe("0.57");
  });
});
