// County hazard history, pure: every assertion runs on captures from 2026-10-17
// (lib/hazards/fixtures, unmodified) and the committed bakes. No network.
import { describe, expect, it } from "vitest";
import femaTravis from "./fixtures/fema-48453.json";
import femaCt from "./fixtures/fema-ct.json";
import femaAk from "./fixtures/fema-ak.json";
import femaAk261 from "./fixtures/fema-ak-261.json";
import femaLa from "./fixtures/fema-06037.json";
import femaOglala from "./fixtures/fema-46102-46113.json";
import femaKusilvak from "./fixtures/fema-02158-02270.json";
import dsciTravis from "./fixtures/usdm-dsci-48453.json";
import dsciCtRegion from "./fixtures/usdm-dsci-09110.json";
import dsciCtLegacy from "./fixtures/usdm-dsci-09001.json";
import catTravis from "./fixtures/usdm-cat-48453.json";
import cagTavg from "./fixtures/cag-tx453-tavg.json";
import cagPcp from "./fixtures/cag-tx453-pcp.json";
import cagHi from "./fixtures/cag-hi003-tavg.json";
import cagCt from "./fixtures/cag-ct001-tavg.json";
import spcJson from "./data/spc-tornado-county.json";
import lsJson from "./data/landslide-county.json";
import type { LandslideBake, SpcBake } from "./bake";
import {
  assembleHistory,
  attachFema,
  cagUrl,
  centuryMean,
  countyHistoryFips,
  dsciYearlyMax,
  femaPerYear,
  femaPrograms,
  femaUrl,
  FEMA_FIELDS,
  FEMA_RENAMES,
  HISTORY_ZERO_FILL,
  landslideLine,
  parseCag,
  parseDroughtNow,
  parseDsci,
  parseFema,
  skips,
  spcPerYear,
  usdmCategoryUrl,
  usdmDsciUrl,
  yearT,
  type HistoryInputs,
} from "./history";

const spc = spcJson as unknown as SpcBake;
const ls = lsJson as unknown as LandslideBake;
const NOW = Date.UTC(2026, 9, 17);
const ok = <T,>(value: T, url = "https://x") => ({ value, retrievedAt: "2026-10-17T21:00:00.000Z", url });
const sum = (pts: Array<{ v: number | null }>) => pts.reduce((s, p) => s + (p.v ?? 0), 0);
const at = (pts: Array<{ t: number; v: number | null }>, y: number) => pts.find((p) => p.t === yearT(y))?.v;

function travis(over: Partial<HistoryInputs> = {}): HistoryInputs {
  return {
    fips: "48453",
    name: "Travis County",
    stusab: "TX",
    now: NOW,
    years: null,
    declarationsCap: 1000,
    fema: ok(parseFema(femaTravis)),
    dsci: ok(parseDsci(dsciTravis)),
    droughtNow: ok(parseDroughtNow(catTravis)),
    tavg: ok(parseCag(cagTavg)),
    pcp: ok(parseCag(cagPcp)),
    spc,
    landslide: ls,
    ...over,
  };
}

describe("upstream URLs", () => {
  it("asks FEMA for one county's selected fields, newest first, with the count", () => {
    const u = new URL(femaUrl("48453"));
    expect(u.searchParams.get("$filter")).toBe("fipsStateCode eq '48' and fipsCountyCode eq '453'");
    expect(u.searchParams.get("$select")).toBe(FEMA_FIELDS.join(","));
    expect(u.searchParams.get("$top")).toBe("1000");
    expect(u.searchParams.get("$inlinecount")).toBe("allpages");
    expect(u.searchParams.get("$orderby")).toBe("declarationDate desc");
  });
  it("asks USDM for weekly DSCI since 2000 and three weeks of categorical shares, and CAG by USPS code", () => {
    expect(usdmDsciUrl("48453", NOW)).toBe("https://usdmdataservices.unl.edu/api/CountyStatistics/GetDSCI?aoi=48453&startdate=1/1/2000&enddate=10/17/2026&statisticsType=1");
    expect(usdmCategoryUrl("48453", NOW)).toBe("https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=48453&startdate=9/27/2026&enddate=10/17/2026&statisticsType=2");
    expect(cagUrl("TX", "48453", "tavg", 2026)).toBe("https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/county/time-series/TX-453/tavg/12/12/1895-2026/data.json");
  });
});

describe("FEMA", () => {
  it("Travis: 37 rows give DR 19 / EM 12 / FM 6; 2011 is 6 across types (FM 5, DR 1); DR-4879 is the latest", () => {
    const { rows, count } = parseFema(femaTravis);
    expect(rows).toHaveLength(37);
    expect(count).toBe(37);
    const dr = femaPerYear(rows, "DR", false, 2026);
    const em = femaPerYear(rows, "EM", false, 2026);
    const fm = femaPerYear(rows, "FM", false, 2026);
    expect([sum(dr), sum(em), sum(fm)]).toEqual([19, 12, 6]);
    expect([at(dr, 2011), at(fm, 2011), at(em, 2011)]).toEqual([1, 5, undefined]);
    const a = assembleHistory(travis());
    expect(a.data.declarations[0]).toMatchObject({ disasterNumber: 4879, declarationType: "DR", declarationDate: "2025-07-06", incidentType: "Flood", declarationTitle: "SEVERE STORMS, STRAIGHT-LINE WINDS, AND FLOODING" });
    expect(a.data.declarations[0].programs).toEqual(["IH", "PA"]);
    expect(a.data.declarationRows).toBe(37);
  });

  it("zero rule: off (the default until Cam rules) leaves empty years absent; on fills 0 from 1953", () => {
    expect(HISTORY_ZERO_FILL).toBe(false);
    const { rows } = parseFema(femaTravis);
    const off = femaPerYear(rows, "DR", false, 2026);
    expect(off.every((p) => (p.v ?? 0) > 0)).toBe(true);
    expect(at(off, 1992)).toBeUndefined();
    const on = femaPerYear(rows, "DR", true, 2026);
    expect(on[0].t).toBe(yearT(1953));
    expect(on).toHaveLength(2026 - 1953 + 1);
    expect(at(on, 1992)).toBe(0);
    expect(sum(on)).toBe(19);
    expect(assembleHistory(travis({ zeroFill: true })).caveats.join(" ")).toMatch(/HISTORY_ZERO_FILL is on/);
    expect(assembleHistory(travis()).caveats.join(" ")).toMatch(/absent from those series, not 0/);
  });

  it("Connecticut: every row is a legacy county (unmatched) or 000 (not a county, 22); no planning region gets one", () => {
    // fema-ct.json was asked with $filter=fipsStateCode eq '09' and a $select without fipsStateCode: the state code is the query's, added here.
    const rows = parseFema(femaCt).rows.map((r) => ({ ...r, fipsStateCode: "09" }));
    expect(rows).toHaveLength(266);
    for (const region of ["09110", "09120", "09130", "09140", "09150", "09160", "09170", "09180", "09190"]) {
      const a = attachFema(rows, region);
      expect(a.rows, region).toHaveLength(0);
      expect(a.notCounty).toBe(22);
      expect(a.unmatched).toEqual(["09001", "09003", "09005", "09007", "09009", "09011", "09013", "09015"]);
    }
    expect(skips("09110", "CT")).toEqual({ fema: "join:legacy_ct_counties", cag: "join:legacy_ct_counties" });
  });

  it("Alaska: an REAA row filed under 050 is kept with its designated area verbatim; Valdez-Cordova 261 attaches to no current county", () => {
    // fema-ak.json was asked with $filter=fipsStateCode eq '02' and $select=disasterNumber, fipsCountyCode, designatedArea:
    // the state code is the query's, added here; nothing else is touched.
    const rows = parseFema(femaAk).rows.map((r) => ({ ...r, fipsStateCode: "02" }));
    const k = attachFema(rows, "02050");
    expect(k.rows.map((r) => r.designatedArea)).toContain("Lower Kuskokwim Regional Educational Attendance Area");
    const v = parseFema(femaAk261);
    expect(v.rows).toHaveLength(11);
    for (const fips of ["02063", "02066"]) {
      const a = attachFema(v.rows, fips);
      expect(a.rows).toHaveLength(0);
      expect(a.unmatched).toEqual(["02261"]);
    }
    const a = assembleHistory(travis({ fips: "02063", name: "Chugach Census Area", stusab: "AK", fema: ok(parseFema(femaAk261)) }));
    expect(a.meta.unmatched).toEqual(["02261"]);
    expect(a.caveats.join(" ")).toMatch(/under its old code 261/);
    expect(a.caveats.join(" ")).toMatch(/Regional Educational Attendance Areas/);
  });

  it("Oglala Lakota and Kusilvak: FEMA's rows under the old codes are read, each disaster once, never a literal 0", () => {
    expect(FEMA_RENAMES.map((r) => [r.fips, r.oldFips])).toEqual([
      ["46102", "46113"],
      ["02158", "02270"],
    ]);
    for (const r of FEMA_RENAMES) expect(r.citation).toMatch(/county-changes\.2010\.html$/);
    expect(decodeURIComponent(femaUrl("46102"))).toContain("fipsStateCode eq '46' and (fipsCountyCode eq '102' or fipsCountyCode eq '113')");
    expect(decodeURIComponent(femaUrl("02158"))).toContain("fipsStateCode eq '02' and (fipsCountyCode eq '158' or fipsCountyCode eq '270')");
    expect(decodeURIComponent(femaUrl("48453"))).toContain("fipsStateCode eq '48' and fipsCountyCode eq '453'&");
    // fema-46102-46113.json is that query's answer (2026-10-17): 16 rows, all under 113.
    const o = assembleHistory(travis({ fips: "46102", name: "Oglala Lakota County", stusab: "SD", fema: ok(parseFema(femaOglala)) }));
    expect(o.data.declarationRows).toBe(16);
    expect(o.meta.unmatched).toEqual([]);
    const total = (id: string) => sum(o.data.series.find((s) => s.id === id)!.points);
    expect([total("fema:dr:46102"), total("fema:em:46102"), total("fema:fm:46102")]).toEqual([12, 3, 1]);
    expect(o.data.declarations.map((d) => d.disasterNumber)).toContain(4689);
    expect(o.caveats.join(" ")).toMatch(/old code 113/);
    expect(o.provenance.find((p) => p.source.id === "fema-openfema")!.seriesId).toContain("(fipsCountyCode eq '102' or fipsCountyCode eq '113')");
    // fema-02158-02270.json: 12 rows under 270 and 2 under 158; DR-4533 is under both, so its two 270 rows drop.
    const k = attachFema(parseFema(femaKusilvak).rows, "02158");
    expect(k.rows).toHaveLength(12);
    expect(k.rows.filter((r) => r.disasterNumber === 4533)).toHaveLength(1);
    expect(k.rows.map((r) => r.disasterNumber)).toContain(4893);
    expect(k.unmatched).toEqual([]);
    // The old code alone never attaches to any other county.
    expect(attachFema(parseFema(femaOglala).rows, "46113").rows).toHaveLength(16);
    expect(attachFema(parseFema(femaOglala).rows, "46007").unmatched).toEqual(["46113"]);
  });

  it("programs are FEMA's own flags as two-letter codes", () => {
    expect(femaPrograms({ ihProgramDeclared: true, iaProgramDeclared: false, paProgramDeclared: true, hmProgramDeclared: true })).toEqual(["IH", "PA", "HM"]);
  });
});

describe("USDM", () => {
  it("Travis: 1,398 weekly points as published, the newest this week; categorical shares for the newest week", () => {
    const pts = parseDsci(dsciTravis);
    expect(pts).toHaveLength(1398);
    expect(pts[0].t).toBe(Date.UTC(2000, 0, 4));
    const raw = dsciTravis as Array<{ dsci: number; mapDate: string }>;
    expect(pts[pts.length - 1]).toEqual({ t: Date.parse(`${raw[raw.length - 1].mapDate}Z`), v: raw[raw.length - 1].dsci });
    const now = parseDroughtNow(catTravis)!;
    expect(now).toMatchObject({ mapDate: "2026-10-13", d1: 21.1, d2: 78.9, d3: 0, d4: 0 });
  });
  it("Connecticut: a planning region has weeks; a legacy county has none (not in this release)", () => {
    expect(parseDsci(dsciCtRegion)).toHaveLength(1398);
    expect(parseDsci(dsciCtLegacy)).toEqual([]);
    const a = assembleHistory(travis({ fips: "09110", name: "Capitol Planning Region", stusab: "CT", fema: { skip: "join:legacy_ct_counties" }, tavg: { skip: "join:legacy_ct_counties" }, pcp: { skip: "join:legacy_ct_counties" }, dsci: ok(parseDsci(dsciCtRegion)) }));
    expect(a.data.series.map((s) => s.id)).toEqual(["usdm:dsci:09110"]);
    expect(a.data.missing.map((m) => [m.source, m.reason])).toEqual([
      ["FEMA", "join:legacy_ct_counties"],
      ["NOAA Climate at a Glance (tavg)", "join:legacy_ct_counties"],
      ["NOAA Climate at a Glance (pcp)", "join:legacy_ct_counties"],
      ["SPC", "join:legacy_ct_counties"],
      ["USGS landslide susceptibility", "join:legacy_ct_counties"],
    ]);
    expect(a.meta.ctRegime).toMatchObject({ usdm: "planning regions", fema: "legacy counties" });
    expect(a.caveats.join(" ")).toMatch(/only drought is shown for planning regions/);
    const legacy = assembleHistory(travis({ dsci: ok(parseDsci(dsciCtLegacy)) }));
    expect(legacy.data.missing).toContainEqual({ source: "USDM", reason: "source:not_in_release", detail: "USDM returned no weeks for 48453" });
  });
  it("the highest weekly DSCI per year is computed from the weeks, labelled where drawn", () => {
    const rows = dsciYearlyMax(parseDsci(dsciTravis));
    expect(rows[0][0]).toBe("2000");
    expect(rows[rows.length - 1][0]).toBe("2026");
    const y2011 = (dsciTravis as Array<{ dsci: number; mapDate: string }>).filter((r) => r.mapDate.startsWith("2011")).map((r) => r.dsci);
    expect(rows.find(([y]) => y === "2011")![1]).toBe(Math.max(...y2011));
  });
});

describe("NOAA Climate at a Glance", () => {
  it("Travis: 131 annual values 1895-2025; 2025 is 70.2 F and 28.14 in", () => {
    const t = parseCag(cagTavg);
    expect(t.points).toHaveLength(131);
    expect(t.units).toBe("Degrees Fahrenheit");
    expect(at(t.points, 2025)).toBe(70.2);
    expect(at(parseCag(cagPcp).points, 2025)).toBe(28.14);
    expect(centuryMean(t.points)).not.toBeNull();
  });
  it("Hawaii starts in 1991, so it has no 1901-2000 mean; Connecticut's legacy series exists but no region asks for it", () => {
    const h = parseCag(cagHi);
    expect(new Date(h.points[0].t).getUTCFullYear()).toBe(1991);
    expect(centuryMean(h.points)).toBeNull();
    expect(parseCag(cagCt).points).toHaveLength(131);
    expect(skips("72127", "PR")).toEqual({ fema: null, cag: "source:not_published_for_puerto_rico" });
  });
});

describe("SPC and landslide bakes in the answer", () => {
  it("Travis: 71 tornadoes since 1950; zero rule on fills 1950-2025", () => {
    expect(sum(spcPerYear(spc, "48453", false)!)).toBe(71);
    const on = spcPerYear(spc, "48453", true)!;
    expect(on).toHaveLength(76);
    expect(sum(on)).toBe(71);
    expect(spcPerYear(spc, "09110", true)).toBeNull();
  });
  it("Travis 0.361 susceptible; Connecticut regions and the six changed boundaries are null with the reason", () => {
    expect(landslideLine(ls, "48453").line).toMatchObject({ prop_susc: 0.361441295, v2_ls_count: 1 });
    expect(landslideLine(ls, "09110")).toEqual({ line: null, reason: "join:legacy_ct_counties" });
    for (const f of ["02063", "02066", "02105", "02195", "02198", "51019"]) expect(landslideLine(ls, f), f).toEqual({ line: null, reason: "join:boundary_changed_since_2010" });
    // Fail closed even if a bake carried a 2010 row for a changed county (USGS's own Bedford County, VA row).
    const withRow = { columns: ls.columns, counties: { ...ls.counties, "51019": [1965.974072, 1707.26073, 0.8684045, 2, 0.001171467] } };
    expect(landslideLine(withRow, "51019")).toEqual({ line: null, reason: "join:boundary_changed_since_2010" });
    expect(landslideLine(ls, "02158").line).not.toBeNull();
    expect(landslideLine(ls, "46102").line).not.toBeNull();
  });
});

describe("the answer", () => {
  it("Travis: seven series, each with provenance, and the shared caveat", () => {
    const a = assembleHistory(travis());
    expect(a.data.series.map((s) => s.id)).toEqual(["fema:dr:48453", "fema:em:48453", "fema:fm:48453", "usdm:dsci:48453", "cag:tavg:48453", "cag:pcp:48453", "spc:tornadoes:48453"]);
    for (const s of a.data.series) expect(s.provenance.source.id, s.id).toMatch(/^(fema-openfema|usdm|noaa-cag|noaa-spc)$/);
    expect(a.provenance.map((p) => p.source.id)).toContain("usgs-landslide-susc");
    expect(a.caveats[0]).toMatch(/A declaration is a federal decision, not a measure of damage/);
    expect(a.data.missing).toEqual([]);
  });
  it("years bounds every series to the last N calendar years; declarations caps the list, never the counts", () => {
    const a = assembleHistory(travis({ years: 5, declarationsCap: 3 }));
    for (const s of a.data.series) for (const p of s.points) expect(p.t, s.id).toBeGreaterThanOrEqual(yearT(2022));
    expect(a.data.declarations).toHaveLength(3);
    expect(a.data.declarationRows).toBe(37);
  });
  it("one upstream failing is a caveat and a missing entry, not an empty series", () => {
    const a = assembleHistory(travis({ fema: { error: "fema-openfema 503", url: "https://x" } }));
    expect(a.data.series.some((s) => s.id.startsWith("fema:"))).toBe(false);
    expect(a.data.missing[0]).toMatchObject({ source: "FEMA", reason: "source:failed" });
    expect(a.caveats.join(" ")).toMatch(/FEMA did not answer this time/);
  });
  it("Los Angeles' answer stays far under 4.5 MB", () => {
    const a = assembleHistory(travis({ fips: "06037", name: "Los Angeles County", stusab: "CA", fema: ok(parseFema(femaLa)) }));
    expect(a.data.declarationRows).toBe(88);
    expect(JSON.stringify(a).length).toBeLessThan(600_000);
  });
});

describe("which click opens the aside", () => {
  it("a county of NRI, SVI or WRC; never a tract or another layer", () => {
    expect(countyHistoryFips("riskindex", { level: "county", row: { stcofips: "48453" } })).toBe("48453");
    expect(countyHistoryFips("riskindex", { level: "tract", row: { stcofips: "48453" } })).toBeNull();
    expect(countyHistoryFips("vulnerability", { level: "county", fips: "48453" })).toBe("48453");
    expect(countyHistoryFips("vulnerability", { level: "tract", fips: "48453001308" })).toBeNull();
    expect(countyHistoryFips("wildfirerisk", { level: "county", geoid: "08013" })).toBe("08013");
    expect(countyHistoryFips("wildfirerisk", { level: "place", geoid: "0807850" })).toBeNull();
    expect(countyHistoryFips("health", { level: "county", fips: "48453" })).toBeNull();
  });
});
