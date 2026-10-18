// The two county bakes (scripts/bake-hazard-history.mjs): the pure functions on real captured
// slices (lib/hazards/fixtures/spc-head.csv is the first 2,001 bytes of SPC's all-tornadoes file
// from a range request, cut mid-line; spc-all.slice.csv is that file's header and 15 whole rows,
// chosen to exercise each row kind: the Mayfield tornado of 2021-12-10, two Nebraska tornadoes
// that began the same minute in 2007, the Evansville tornado of 2005-11-06 that left Kentucky
// and came back, and a 1953 continuation row with no parent in its state; lsus-county.slice.csv is
// USGS's CSV header, its first 40 rows, the 8 Connecticut rows, the 6 changed 2010 counties, Travis
// and the 3 counties whose boundary changed in 2013, a labelled slice), and the committed outputs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import counties from "@/lib/places/data/counties.json";
import spcCommitted from "./data/spc-tornado-county.json";
import lsCommitted from "./data/landslide-county.json";
import { bakeLandslide, bakeSpc, BOUNDARY_CHANGED_SINCE_2010, csvLine, LANDSLIDE_RENAMES, parseCsv, SPC_RENAMES } from "./bake";

const refs = (counties as { rows: Array<{ geoid: string; name: string; stusab: string }> }).rows.map((r) => ({ geoid: r.geoid, name: r.name, stusab: r.stusab }));
const fx = (n: string) => readFileSync(path.resolve(__dirname, "fixtures", n), "utf8");

describe("csv", () => {
  it("splits quoted fields and strips the BOM", () => {
    expect(csvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
    expect(csvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
    const { header, rows } = parseCsv("﻿COUNTY,ST\nTravis County,TX\n");
    expect(header).toEqual(["COUNTY", "ST"]);
    expect(rows).toEqual([["Travis County", "TX"]]);
  });
});

describe("SPC bake", () => {
  it("counts the head slice per county and year, and drops the line the range request cut", () => {
    const b = bakeSpc(fx("spc-head.csv"), refs, "Fri, 24 Apr 2026 19:12:10 GMT");
    expect(b.meta.malformedLines).toBe(1);
    expect(b.meta.rows).toBe(17);
    // 1950-10-01, OK (stf 40), f1 = 25: Ellis County, OK.
    expect(b.counties["40025"]).toEqual([[1950, 1]]);
    // 1950-01-03, om 1: a MO-IL tornado. Its whole-track row names no county and is skipped; its
    // two state segments name St. Louis County, MO (189) and Madison County, IL (119).
    expect(b.meta.wholeTrackRows).toBe(1);
    expect(b.meta.stateSegmentRows).toBe(2);
    expect(b.meta.noCounty).toBe(0);
    expect(b.counties["29189"]).toEqual([[1950, 1]]);
    expect(b.counties["17119"]).toEqual([[1950, 3]]);
    expect(b.meta.lastModified).toBe("Fri, 24 Apr 2026 19:12:10 GMT");
    expect(b.meta.what).toMatch(/derivation, not an upstream file/);
  });

  it("counts a tornado once per county across its segments and continuation rows (the labelled slice)", () => {
    const b = bakeSpc(fx("spc-all.slice.csv"), refs, null);
    expect([b.meta.rows, b.meta.wholeTrackRows, b.meta.stateSegmentRows, b.meta.continuationRows, b.meta.unattachedContinuationRows, b.meta.noCounty]).toEqual([15, 2, 6, 4, 1, 0]);
    // Mayfield, 2021-12-10: the KY segment names Graves (083) and three more; its three
    // continuation rows name seven more, and 085 twice.
    const mayfieldKy = ["21075", "21105", "21083", "21157", "21143", "21033", "21107", "21177", "21183", "21027", "21085"];
    for (const k of mayfieldKy) expect(b.counties[k], k).toEqual([[2021, 1]]);
    expect(b.counties["47131"]).toEqual([[2021, 1]]);
    // Two tornadoes that began in Perkins County, NE in the same minute (0703281920-01 and -02) are two.
    expect(b.counties["31135"]).toEqual([[2007, 2]]);
    // Evansville, 2005: its two Kentucky segments both name Henderson County (101): one tornado.
    expect(b.counties["21101"]).toEqual([[2005, 1]]);
    expect(b.counties["18163"]).toEqual([[2005, 1]]);
    // 1953 om 265: the IA continuation row has no IA parent (om 265 is a KS tornado), so it counts as its own.
    for (const k of ["19157", "19095", "19103", "20115", "20041"]) expect(b.counties[k], k).toEqual([[1953, 1]]);
  });

  it("is a pure function of its input (byte-identical on rerun)", () => {
    const a = JSON.stringify(bakeSpc(fx("spc-head.csv"), refs, "x", "y"));
    expect(JSON.stringify(bakeSpc(fx("spc-head.csv"), refs, "x", "y"))).toBe(a);
  });

  it("the committed bake: SPC's all-tornadoes file, 74,956 rows, 82,211 county-tornadoes, Graves 2021 is 5, Travis 71, Dade on Miami-Dade, unmatched codes listed", () => {
    const m = spcCommitted.meta;
    expect(m.url).toBe("https://www.spc.noaa.gov/wcm/data/1950-2025_all_tornadoes.csv");
    expect([m.rows, m.wholeTrackRows, m.stateSegmentRows, m.continuationRows, m.unattachedContinuationRows, m.noCounty]).toEqual([74956, 670, 1358, 140, 2, 11]);
    expect(m.countyCodes).toBe(3062);
    expect(m.counties).toBe(3036);
    expect(m.lastModified).toBe("Fri, 24 Apr 2026 19:12:10 GMT");
    const c = spcCommitted.counties as unknown as Record<string, Array<[number, number]>>;
    expect(Object.values(c).reduce((s, ys) => s + ys.reduce((t, [, n]) => t + n, 0), 0)).toBe(82211);
    // Graves County, KY in 2021: five tornadoes, the Mayfield tornado's Kentucky segment among them.
    expect(c["21083"].find(([y]) => y === 2021)).toEqual([2021, 5]);
    expect(c["48453"].reduce((s, [, n]) => s + n, 0)).toBe(71);
    expect(c["12025"]).toBeUndefined();
    expect(c["12086"].some(([y]) => y < 1997)).toBe(true);
    expect(c["46113"]).toBeUndefined();
    expect(m.legacyCt).toEqual(["09001", "09003", "09005", "09007", "09009", "09011", "09013", "09015"]);
    expect(m.unmatched).toContain("21022");
    expect(m.unmatched).toHaveLength(16);
    for (const k of Object.keys(c)) expect(refs.some((r) => r.geoid === k), k).toBe(true);
  });

  it("pins the rename table at the two Census-documented changes, each cited", () => {
    expect(SPC_RENAMES.map((r) => [r.from, r.to])).toEqual([
      ["12025", "12086"],
      ["46113", "46102"],
    ]);
    for (const r of SPC_RENAMES) expect(r.citation).toMatch(/^https:\/\/www\.census\.gov\/programs-surveys\/geography\/technical-documentation\/county-changes\.(1990|2010)\.html$/);
  });
});

describe("landslide bake", () => {
  it("joins the slice by exact name, applies the three renames, excludes the changed boundaries, and lists the rest", () => {
    const b = bakeLandslide(fx("lsus-county.slice.csv"), refs, null);
    expect(b.meta.rows).toBe(58);
    // Exact 2010 names, but Census lists each boundary as changed in 2013: no row, listed.
    expect(b.meta.excluded.map((e) => e.geoid)).toEqual(["02105", "02198", "51019"]);
    for (const k of ["02105", "02198", "51019"]) expect(b.counties[k], k).toBeUndefined();
    expect(b.meta.renamed.map((r) => r.to).sort()).toEqual(["02158", "22059", "46102"]);
    expect(b.meta.unmatched.map((u) => `${u.st} ${u.county}`).sort()).toEqual([
      "AK Petersburg Census Area",
      "AK Valdez-Cordova Census Area",
      "CT Fairfield County",
      "CT Hartford County",
      "CT Litchfield County",
      "CT Middlesex County",
      "CT New Haven County",
      "CT New London County",
      "CT Tolland County",
      "CT Windham County",
      "VA Bedford city",
    ]);
    expect(b.counties["48453"]).toEqual([2590.915166, 936.4637326, 0.361441295, 1, 0.001067847]);
    expect(b.counties["01001"]?.[2]).toBe(0.609689515);
  });

  it("the committed bake: 3,204 exact, 3 renamed, 3 excluded, 11 unmatched, 3,207 rows, CC0", () => {
    const m = lsCommitted.meta;
    expect([m.rows, m.exact, m.renamed.length, m.excluded.length, m.unmatched.length]).toEqual([3221, 3204, 3, 3, 11]);
    expect(Object.keys(lsCommitted.counties)).toHaveLength(3207);
    expect(m.licence).toBe("CC0 1.0");
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const k of ["09110", "09190", ...Object.keys(BOUNDARY_CHANGED_SINCE_2010)]) expect((lsCommitted.counties as Record<string, unknown>)[k], k).toBeUndefined();
  });

  it("pins the changed-boundary list at the six counties Census lists", () => {
    expect(Object.keys(BOUNDARY_CHANGED_SINCE_2010).sort()).toEqual(["02063", "02066", "02105", "02195", "02198", "51019"]);
  });

  it("pins the rename table at three Census-documented name changes", () => {
    expect(LANDSLIDE_RENAMES).toHaveLength(3);
    for (const r of LANDSLIDE_RENAMES) expect(r.citation).toMatch(/county-changes\.2010\.html$/);
  });
});
