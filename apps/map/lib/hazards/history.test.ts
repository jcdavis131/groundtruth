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
import sweep from "./fixtures/fema-codes-sweep.json";
import counties from "../places/data/counties.json";
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
  CT_LEGACY,
  femaCodes,
  FEMA_FIELDS,
  FEMA_LEGACY,
  FEMA_SPLIT_AREAS,
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
  USDM_THIS_WEEK,
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

  it("Alaska: an REAA row filed under 050 is kept with its designated area verbatim; Valdez-Cordova 261's rows go to the 2019 successor their designated area lies in, marked", () => {
    // fema-ak.json was asked with $filter=fipsStateCode eq '02' and $select=disasterNumber, fipsCountyCode, designatedArea:
    // the state code is the query's, added here; nothing else is touched.
    const rows = parseFema(femaAk).rows.map((r) => ({ ...r, fipsStateCode: "02" }));
    const k = attachFema(rows, "02050");
    expect(k.rows.map((r) => r.designatedArea)).toContain("Lower Kuskokwim Regional Educational Attendance Area");
    // fema-ak-261.json: OpenFEMA's every row under 02261 (11, 1986-2020), captured 2026-10-17. The verifier's
    // 2026-10-19 pull (writeups/.../verify3/publisher/openfema-02261.json) has the same DR-4533 and EM-3446 rows.
    const v = parseFema(femaAk261);
    expect(v.rows).toHaveLength(11);
    expect(decodeURIComponent(femaUrl("02063"))).toContain("fipsStateCode eq '02' and (fipsCountyCode eq '063' or fipsCountyCode eq '261')");
    expect(decodeURIComponent(femaUrl("02066"))).toContain("fipsStateCode eq '02' and (fipsCountyCode eq '066' or fipsCountyCode eq '261')");
    // Each row goes where its designated area lies (FEMA_SPLIT_AREAS): the whole former area to both,
    // the Chugach REAA and Valdez City School District (both inside Chugach) to Chugach only.
    const areas = (rows: Array<{ designatedArea?: unknown }>) => [...new Set(rows.map((r) => String(r.designatedArea)))].sort();
    const chugach = attachFema(v.rows, "02063");
    expect(chugach.rows).toHaveLength(11);
    expect(areas(chugach.rows)).toEqual(["Chugach Regional Educational Attendance Area", "Valdez City School District", "Valdez-Cordova (Census Area)"]);
    const copper = attachFema(v.rows, "02066");
    expect(areas(copper.rows)).toEqual(["Valdez-Cordova (Census Area)"]);
    expect(copper.unplaced).toEqual([]);
    for (const [fips, name, other] of [
      ["02063", "Chugach Census Area", "02066"],
      ["02066", "Copper River Census Area", "02063"],
    ]) {
      const h = assembleHistory(travis({ fips, name, stusab: "AK", fema: ok(parseFema(femaAk261)) }));
      expect(h.meta.unmatched).toEqual([]);
      const nums = h.data.declarations.map((d) => `${d.declarationType}-${d.disasterNumber}`);
      expect(nums).toContain("DR-4533");
      expect(h.data.declarations.every((d) => d.filedUnder === "02261")).toBe(true);
      const cav = h.caveats.join(" ");
      expect(cav).toContain("FEMA files this under the former Valdez-Cordova Census Area, AK (02261), which covered more than this county");
      expect(cav).toContain(`a row for the whole former area is attached here and to ${other}, never divided`);
      expect(cav).toMatch(/Regional Educational Attendance Areas/);
    }
    // EM-3446 and DR-4094 name only the Chugach REAA: Chugach has them, Copper River does not.
    const cr = assembleHistory(travis({ fips: "02066", name: "Copper River Census Area", stusab: "AK", fema: ok(parseFema(femaAk261)) }));
    expect(cr.data.declarations.map((d) => d.disasterNumber!).sort((x, y) => x - y)).toEqual([782, 826, 1316, 1440, 4533]);
    const ch = assembleHistory(travis({ fips: "02063", name: "Chugach Census Area", stusab: "AK", fema: ok(parseFema(femaAk261)) }));
    expect(ch.data.declarations.map((d) => d.disasterNumber)).toEqual(expect.arrayContaining([3446, 4094, 1663, 1669, 4533]));
  });

  it("a split code's row for an area no cited source places is attached to none and listed in missing; an area lying in another county is left to it", () => {
    const row = (area: string, n: number) => ({ fipsStateCode: "02", fipsCountyCode: "280", disasterNumber: n, declarationType: "DR", declarationDate: "2021-02-17T00:00:00.000Z", designatedArea: area });
    const rows = [row("Chatham Regional Educational Attendance Area", 4585), row("Wrangell City School District", 4533), row("Somewhere New", 9999)];
    const w = attachFema(rows, "02275");
    expect(w.rows.map((r) => r.disasterNumber)).toEqual([4533]);
    // Chatham lies in Hoonah-Angoon (02105): Wrangell loses nothing, so it lists only the unknown area.
    expect(w.unplaced.map((u) => [u.area, u.disasterNumber])).toEqual([["Somewhere New", 9999]]);
    expect(w.unplaced[0].reason).toMatch(/not in FEMA_SPLIT_AREAS/);
    expect(w.filedElsewhere).toEqual([]);
    const p = attachFema(rows, "02195");
    expect(p.rows).toEqual([]);
    const h = assembleHistory(travis({ fips: "02195", name: "Petersburg Borough", stusab: "AK", fema: ok({ rows, count: 3 }) }));
    expect(h.data.declarations).toEqual([]);
    expect(h.data.missing.filter((m) => m.source === "FEMA legacy-code rows").map((m) => [m.reason, m.detail])).toEqual([["join:area_not_placed", expect.stringMatching(/^Somewhere New \(disaster 9999\), filed under 02280: /)]]);
    expect(h.data.missing.map((m) => m.detail ?? "").join(" ")).not.toMatch(/Chatham/);
  });

  it("Hoonah-Angoon (02105): the Chatham REAA rows FEMA files under 02280 are listed as missing there, never attached, so its count says it may be short", () => {
    // The 2026-10-19 sweep: Chatham REAA under 02280 carries DR-4585, DR-4533 and EM-3446; 02105 has DR-4533 under its own code.
    expect((sweep.splitCodeAreas as Record<string, Array<{ area: string; disasters: number[] }>>)["02280"].find((x) => x.area.startsWith("Chatham"))!.disasters.sort()).toEqual([3446, 4533, 4585]);
    expect(decodeURIComponent(femaUrl("02105"))).toContain("fipsStateCode eq '02' and (fipsCountyCode eq '105' or fipsCountyCode eq '280')");
    // 02105 is no successor of 02280: no rename/split caveat claims it was.
    expect(femaCodes("02105")).toEqual(["02105"]);
    const r = (county: string, area: string, n: number, type = "DR", date = "2021-02-17") => ({ fipsStateCode: "02", fipsCountyCode: county, disasterNumber: n, declarationType: type, declarationDate: `${date}T00:00:00.000Z`, designatedArea: area });
    const rows = [
      r("105", "Hoonah-Angoon (Census Area)", 4533, "DR", "2020-04-09"),
      r("280", "Chatham Regional Educational Attendance Area", 4585),
      r("280", "Chatham Regional Educational Attendance Area", 4533, "DR", "2020-04-09"),
      r("280", "Chatham Regional Educational Attendance Area", 3446, "EM", "2018-12-01"),
      r("280", "Wrangell-Petersburg (Census Area)", 4533, "DR", "2020-04-09"),
      r("280", "Wrangell City School District", 4533, "DR", "2020-04-09"),
    ];
    const a = attachFema(rows, "02105");
    // Only its own row is attached; the other 02280 rows are neither attached nor "unmatched".
    expect(a.rows.map((x) => `${x.fipsCountyCode}:${x.disasterNumber}`)).toEqual(["105:4533"]);
    expect(a.unmatched).toEqual([]);
    expect(a.unplaced).toEqual([]);
    expect(a.filedElsewhere).toEqual([expect.objectContaining({ oldFips: "02280", area: "Chatham Regional Educational Attendance Area", disasters: ["EM-3446", "DR-4585"] })]);
    const h = assembleHistory(travis({ fips: "02105", name: "Hoonah-Angoon Census Area", stusab: "AK", fema: ok({ rows, count: rows.length }) }));
    expect(h.data.declarationRows).toBe(1);
    expect(h.data.declarations.map((d) => d.disasterNumber)).toEqual([4533]);
    const m = h.data.missing.filter((x) => x.reason === "join:filed_under_other_code");
    expect(m).toHaveLength(1);
    expect(m[0].source).toBe("FEMA legacy-code rows");
    expect(m[0].detail).toMatch(/^Chatham Regional Educational Attendance Area \(EM-3446, DR-4585\), filed under 02280: FEMA files this area under 02280, Wrangell-Petersburg, though it lies in Hoonah-Angoon\. Not attached here, so this county's declarations may be short by 2\./);
    expect(m[0].detail).toMatch(/tiger-check\.json/);
    expect(h.caveats.join(" ")).toMatch(/This county's FEMA declarations may be short: EM-3446, DR-4585 designate Chatham Regional Educational Attendance Area/);
    expect(h.caveats.join(" ")).not.toMatch(/former Wrangell-Petersburg/);
    // FEMA answered: the missing entry is not "FEMA" itself, so the declarations still count.
    expect(h.data.missing.some((x) => x.source === "FEMA")).toBe(false);
  });

  it("says 'designates' when one disaster is filed under another county's code", () => {
    const rows = [
      { fipsStateCode: "02", fipsCountyCode: "105", disasterNumber: 4533, declarationType: "DR", declarationDate: "2020-04-09T00:00:00.000Z", designatedArea: "Hoonah-Angoon (Census Area)" },
      { fipsStateCode: "02", fipsCountyCode: "280", disasterNumber: 4585, declarationType: "DR", declarationDate: "2021-02-17T00:00:00.000Z", designatedArea: "Chatham Regional Educational Attendance Area" },
    ];
    const h = assembleHistory(travis({ fips: "02105", name: "Hoonah-Angoon Census Area", stusab: "AK", fema: ok({ rows, count: rows.length }) }));
    expect(h.caveats.join(" ")).toMatch(/may be short: DR-4585 designates Chatham Regional Educational Attendance Area/);
  });

  it("Prince of Wales-Hyder (02198) reads 02280 too: whole-area rows attach with the caveat, each disaster once across its own code, 02201 and 02280", () => {
    expect(femaCodes("02198")).toEqual(["02198", "02201", "02280"]);
    expect(decodeURIComponent(femaUrl("02198"))).toContain("(fipsCountyCode eq '198' or fipsCountyCode eq '201' or fipsCountyCode eq '280')");
    const r = (county: string, area: string, n: number, date = "2020-04-09") => ({ fipsStateCode: "02", fipsCountyCode: county, disasterNumber: n, declarationType: "DR", declarationDate: `${date}T00:00:00.000Z`, designatedArea: area });
    const rows = [
      r("280", "Wrangell-Petersburg (Census Area)", 4533),
      r("201", "Prince of Wales-Outer Ketchikan (Census Area)", 4533),
      r("198", "Prince of Wales-Hyder (Census Area)", 4122, "2013-06-01"),
      r("280", "Wrangell-Petersburg (Census Area)", 4122, "2013-06-01"),
      r("280", "Wrangell-Petersburg (Census Area)", 1234, "2005-01-01"),
      r("201", "Southeast Islands Regional Educational Attendance Ar", 1234, "2005-01-01"),
      r("201", "Prince of Wales-Outer Ketchikan (Census Area)", 1234, "2005-01-01"),
      r("280", "Wrangell City School District", 4700),
      r("280", "Chatham Regional Educational Attendance Area", 4585),
    ];
    const a = attachFema(rows, "02198");
    // 4122: own code only. 4533 and 1234: from 02201 (first in femaCodes) only, both of its area rows kept. 4700, Chatham: not 02198's.
    expect(a.rows.map((x) => `${x.fipsCountyCode}:${x.disasterNumber}`)).toEqual(["198:4122", "201:4533", "201:1234", "201:1234"]);
    expect(a.unplaced).toEqual([]);
    expect(a.filedElsewhere).toEqual([]);
    // A disaster filed only under 02280 attaches to 02198 as a whole-area row.
    const only280 = attachFema([r("280", "Wrangell-Petersburg (Census Area)", 4533)], "02198");
    expect(only280.rows.map((x) => x.disasterNumber)).toEqual([4533]);
    const h = assembleHistory(travis({ fips: "02198", name: "Prince of Wales-Hyder Census Area", stusab: "AK", fema: ok({ rows, count: rows.length }) }));
    const dr = h.data.series.find((s) => s.id === "fema:dr:02198")!;
    expect(sum(dr.points)).toBe(3);
    expect(h.data.declarations.find((d) => d.disasterNumber === 4533)!.filedUnder).toBe("02201");
    const note = h.caveats.join(" ");
    expect(note).toMatch(/former Wrangell-Petersburg Census Area, AK \(02280\)/);
    expect(note).toMatch(/Prince of Wales-Hyder Census Area added part of the former Petersburg Census Area/);
    expect(FEMA_LEGACY.find((l) => l.oldFips === "02280")!.citation).toMatch(/county-changes\.2010\.html/);
  });

  it("meta.notCounty and meta.unmatched are counted only when FEMA answered: null when it failed or was skipped, never 0", () => {
    const failed = assembleHistory(travis({ fema: { error: "fema-openfema 503", url: "https://x" } }));
    expect(failed.meta.notCounty).toBeNull();
    expect(failed.meta.unmatched).toBeNull();
    const skipped = assembleHistory(travis({ fips: "09110", name: "Capitol Planning Region", stusab: "CT", fema: { skip: "join:legacy_ct_counties" } }));
    expect(skipped.meta.notCounty).toBeNull();
    expect(skipped.meta.unmatched).toBeNull();
    const answered = assembleHistory(travis());
    expect(typeof answered.meta.notCounty).toBe("number");
    expect(Array.isArray(answered.meta.unmatched)).toBe(true);
  });

  it("every designatedArea FEMA uses under a split code is placed by FEMA_SPLIT_AREAS or deliberately unplaced", () => {
    // splitCodeAreas in fixtures/fema-codes-sweep.json: every area string under 02201, 02261 and 02280 (2026-10-19 sweep).
    const splits = FEMA_LEGACY.filter((l) => l.change === "split").map((l) => l.oldFips).sort();
    expect(Object.keys(sweep.splitCodeAreas).sort()).toEqual(splits);
    expect(Object.keys(FEMA_SPLIT_AREAS).sort()).toEqual(splits);
    for (const code of splits) {
      const legacy = FEMA_LEGACY.find((l) => l.oldFips === code)!;
      const rules = FEMA_SPLIT_AREAS[code];
      const used = (sweep.splitCodeAreas as Record<string, Array<{ area: string }>>)[code].map((x) => x.area).sort();
      expect(rules.map((r) => r.area).sort(), code).toEqual(used);
      for (const r of rules) {
        for (const s of r.to) expect(legacy.successors, `${code} ${r.area}`).toContain(s);
        // An area lying outside the successors names the county it lies in, a current one, never a successor, with the why.
        if (r.liesIn) {
          expect(r.to, `${code} ${r.area}`).toEqual([]);
          expect(r.why, `${code} ${r.area}`).toBeTruthy();
          for (const c of r.liesIn) {
            expect(counties.rows.some((x) => x.geoid === c), c).toBe(true);
            expect(legacy.successors).not.toContain(c);
          }
        }
        expect(r.basis, `${code} ${r.area}`).toMatch(/census\.gov|TIGERweb/);
      }
      // the whole former area goes to every successor
      const whole = rules.find((r) => /\(Census Area\)$/.test(r.area))!;
      expect(whole.to.slice().sort()).toEqual(legacy.successors.slice().sort());
    }
  });

  it("FEMA_LEGACY covers every county code FEMA files under outside the county table (the 2026-10-19 sweep)", () => {
    // fixtures/fema-codes-sweep.json: derived from all 70,571 OpenFEMA DisasterDeclarationsSummaries v2 rows, paged
    // keyless on 2026-10-19 (writeups/unify-2026-10-18/fema-fips-audit/sweep.py), against lib/places/data/counties.json.
    const table = new Set(counties.rows.map((r) => r.geoid));
    expect(sweep.sweptAt).toBe("2026-10-19");
    expect(sweep.tableCounties).toBe(table.size);
    const TERRITORIES = new Set(["60", "64", "66", "68", "69", "78"]); // AS, FM, GU, MH, MP, VI: not in the table
    for (const x of sweep.notInTable) {
      const l = FEMA_LEGACY.find((e) => e.oldFips === x.fips);
      if (l) for (const s of l.successors) expect(table.has(s), `${x.fips} -> ${s}`).toBe(true);
      else if (CT_LEGACY.test(x.fips)) expect(skips("09110", "CT").fema).toBe("join:legacy_ct_counties");
      else expect(TERRITORIES.has(x.fips.slice(0, 2)), `${x.fips} (${x.area}, latest ${x.latest}) has no crosswalk`).toBe(true);
    }
    // No stale entry: every legacy code is one FEMA still files under.
    for (const l of FEMA_LEGACY) expect(sweep.notInTable.map((x) => x.fips), l.oldFips).toContain(l.oldFips);
    for (const l of FEMA_LEGACY) for (const s of l.successors) expect(decodeURIComponent(femaUrl(s))).toContain(`fipsCountyCode eq '${l.oldFips.slice(2)}'`);
    // The four undercounts and the two zeros the sweep found.
    expect(Object.fromEntries(FEMA_LEGACY.map((l) => [l.oldFips, l.successors]))).toEqual({
      "46113": ["46102"],
      "02270": ["02158"],
      "02261": ["02063", "02066"],
      "02201": ["02198", "02130", "02275"],
      "02280": ["02275", "02195", "02198"],
      "51515": ["51019"],
    });
  });

  it("a table county FEMA never files under has a crosswalk or a missing reason, never a bare 0", () => {
    expect(sweep.neverFiled).toHaveLength(12);
    for (const f of sweep.neverFiled) {
      const crosswalked = femaCodes(f).length > 1;
      const reason = skips(f, f.startsWith("09") ? "CT" : "AK").fema;
      expect(crosswalked || reason === "join:legacy_ct_counties", f).toBe(true);
    }
  });

  it("a split, merged or renamed legacy code reads both codes; its rows are marked filedUnder", () => {
    const row = (county: string, n: number) => ({ fipsStateCode: "51", fipsCountyCode: county, disasterNumber: n, declarationType: "DR", declarationDate: "2025-01-0" + (n % 9) + "T00:00:00.000Z" });
    const rows = [row("019", 4001), row("515", 4001), row("515", 4002)];
    const a = attachFema(rows, "51019");
    expect(a.rows.map((r) => `${r.fipsCountyCode}:${r.disasterNumber}`)).toEqual(["019:4001", "515:4002"]);
    const h = assembleHistory(travis({ fips: "51019", name: "Bedford County", stusab: "VA", fema: ok({ rows, count: 3 }) }));
    expect(h.data.declarations.find((d) => d.disasterNumber === 4002)!.filedUnder).toBe("51515");
    expect(h.data.declarations.find((d) => d.disasterNumber === 4001)!.filedUnder).toBeUndefined();
    expect(h.caveats.join(" ")).toContain("FEMA still files declarations under the former Bedford city, VA (51515), now part of this county");
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
  it("the per-year counts are estimates that name the publisher entry they were computed from; the values relayed as published stay published", () => {
    const a = assembleHistory(travis());
    const by = (id: string) => a.provenance.filter((p) => p.source.id === id);
    // FEMA: distinct disaster numbers per year of declaration, computed from OpenFEMA's rows
    expect(by("fema-openfema")).toHaveLength(1);
    expect(by("fema-openfema")[0].kind).toBe("estimate");
    expect(by("fema-openfema")[0].inputs).toEqual([{ sourceId: "fema-openfema", upstreamRecordUrl: "https://x", retrievedAt: "2026-10-17T21:00:00.000Z" }]);
    expect(by("fema-openfema")[0].method).toMatch(/per year/);
    for (const s of a.data.series.filter((x) => x.id.startsWith("fema:"))) expect(s.provenance.kind, s.id).toBe("estimate");
    // SPC: distinct tornadoes per county per year, counted from SPC's all-tornadoes file at the bake
    expect(by("noaa-spc")).toHaveLength(1);
    expect(by("noaa-spc")[0].kind).toBe("estimate");
    expect(by("noaa-spc")[0].inputs).toEqual([
      { sourceId: "noaa-spc", upstreamRecordUrl: spc.meta.url, retrievedAt: by("noaa-spc")[0].retrievedAt, ...(spc.meta.lastModified ? { releasedAt: new Date(spc.meta.lastModified).toISOString() } : {}) },
    ]);
    expect(a.data.series.find((s) => s.id === "spc:tornadoes:48453")!.provenance.kind).toBe("estimate");
    // USDM, Climate at a Glance and the landslide line are the publisher's own values, relayed
    for (const id of ["usdm", "noaa-cag", "usgs-landslide-susc"]) {
      expect(by(id).length, id).toBeGreaterThan(0);
      for (const p of by(id)) {
        expect(p.kind, id).toBe("published");
        expect(p.inputs, id).toBeUndefined();
      }
    }
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
  it("USDM's categorical call failing while the weekly index answers is a missing entry and a caveat, not 'no week published'", () => {
    const a = assembleHistory(travis({ droughtNow: { error: "usdm 503", url: "https://x" } }));
    expect(a.data.droughtNow).toBeNull();
    expect(a.data.series.some((s) => s.id === "usdm:dsci:48453")).toBe(true);
    expect(a.data.missing).toEqual([{ source: USDM_THIS_WEEK, reason: "source:failed", detail: "usdm 503" }]);
    expect(a.caveats.join(" ")).toMatch(/USDM this week did not answer this time \(usdm 503\)/);
    // USDM answering with no week is "no week published": nothing missing.
    expect(assembleHistory(travis({ droughtNow: ok(null) })).data.missing).toEqual([]);
    // A 404 is a skip with its reason.
    expect(assembleHistory(travis({ droughtNow: { skip: "source:not_in_release" } })).data.missing).toEqual([{ source: USDM_THIS_WEEK, reason: "source:not_in_release" }]);
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
