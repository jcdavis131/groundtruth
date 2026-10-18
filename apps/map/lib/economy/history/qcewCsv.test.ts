import { describe, expect, it } from "vitest";
import { parseQcewAreaTotal, QCEW_ANNUAL_COLUMNS, QCEW_QUARTERLY_COLUMNS, qcewColumns, qcewLevels } from "./qcewCsv";

// Column order of the BLS QCEW open-data area slice, values quoted as BLS writes them.
const HEADER =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage","lq_disclosure_code","lq_qtrly_estabs","lq_month1_emplvl","lq_month2_emplvl","lq_month3_emplvl","lq_total_qtrly_wages","lq_taxable_qtrly_wages","lq_qtrly_contributions","lq_avg_wkly_wage","oty_disclosure_code","oty_qtrly_estabs_chg","oty_qtrly_estabs_pct_chg","oty_month1_emplvl_chg","oty_month1_emplvl_pct_chg","oty_month2_emplvl_chg","oty_month2_emplvl_pct_chg","oty_month3_emplvl_chg","oty_month3_emplvl_pct_chg","oty_total_qtrly_wages_chg","oty_total_qtrly_wages_pct_chg","oty_taxable_qtrly_wages_chg","oty_taxable_qtrly_wages_pct_chg","oty_qtrly_contributions_chg","oty_qtrly_contributions_pct_chg","oty_avg_wkly_wage_chg","oty_avg_wkly_wage_pct_chg"';
const TOTAL = '"48453","0","10","70","0","2024","1","","45210","770100","772300","775900","15200000000","5100000000","61000000","1507","","1.00","1.00","1.00","1.00","1.00","1.00","1.00","1.00","","900","2.0","15000","2.0","15100","2.0","15200","2.0","700000000","4.8","100000000","2.0","1000000","1.7","44","3.0"';
const PRIVATE_TOTAL = '"48453","5","10","71","0","2024","1","","44000","700000","701000","702000","13000000000","4900000000","59000000","1480","","1.00","1.00","1.00","1.00","1.00","1.00","1.00","1.00","","880","2.0","14000","2.0","14100","2.0","14200","2.0","650000000","5.0","95000000","2.0","950000","1.6","40","2.8"';
const SECTOR = '"48453","5","1023","74","0","2024","1","","3200","40000","40100","40200","900000000","300000000","3600000","1730","","1.10","1.20","1.20","1.20","1.30","1.30","1.30","1.10","","50","1.6","800","2.0","810","2.1","820","2.1","40000000","4.6","6000000","2.0","60000","1.7","30","1.8"';
const SUPPRESSED = '"48301","0","10","70","0","2024","1","N","","","","","","","","","","","","","","","","","","N","","","","","","","","","","","","","","","",""';

describe("parseQcewAreaTotal", () => {
  it("picks the total covered row (industry 10, own 0, county agglvl 70) and reads levels and BLS's own changes", () => {
    const row = parseQcewAreaTotal([HEADER, SECTOR, PRIVATE_TOTAL, TOTAL].join("\n"), "48453", 2024, 1)!;
    expect(row).toMatchObject({ area: "48453", year: 2024, qtr: 1, estabs: 45210, emp: 775900, wages: 15200000000, avgWeeklyWage: 1507, otyEmpPct: 2.0, otyAvgWeeklyWagePct: 3.0, otyEstabsPct: 2.0, suppressed: false });
  });
  it("suppressed rows keep the shape but every value is null", () => {
    const row = parseQcewAreaTotal([HEADER, SUPPRESSED].join("\n"), "48301", 2024, 1)!;
    expect(row.suppressed).toBe(true);
    expect(row.emp).toBeNull();
    expect(row.avgWeeklyWage).toBeNull();
    expect(row.otyEmpPct).toBeNull();
  });
  it("null when the total row is absent, the header is foreign, or the file is empty", () => {
    expect(parseQcewAreaTotal([HEADER, SECTOR, PRIVATE_TOTAL].join("\n"), "48453", 2024, 1)).toBeNull();
    expect(parseQcewAreaTotal("<html>not found</html>", "48453", 2024, 1)).toBeNull();
    expect(parseQcewAreaTotal("", "48453", 2024, 1)).toBeNull();
  });
  it("state and national slices use their own aggregation level", () => {
    expect(qcewLevels("48453").total).toEqual(["70"]);
    expect(qcewLevels("48000").total).toEqual(["50"]);
    expect(qcewLevels("US000").total).toEqual(["10"]);
    const state = TOTAL.replace('"48453","0","10","70"', '"48000","0","10","50"');
    expect(parseQcewAreaTotal([HEADER, state].join("\n"), "48000", 2024, 1)?.area).toBe("48000");
    expect(parseQcewAreaTotal([HEADER, state].join("\n"), "48453", 2024, 1)).toBeNull();
  });
});

describe("qcewLevels", () => {
  // Codes per https://data.bls.gov/cew/doc/titles/agglevel/agglevel_titles.csv.
  it("a C-code is a metropolitan (40/41/44) or micropolitan (80) area", () => {
    expect(qcewLevels("C1242")).toEqual({ total: ["40", "80"], byOwnership: "41", sector: "44" });
  });
  it("a CS-code is a combined statistical area with a total row only (30)", () => {
    expect(qcewLevels("CS101")).toEqual({ total: ["30"], byOwnership: null, sector: null });
  });
  it("counties, states and the nation keep 70/71/74, 50/51/54 and 10/11/14", () => {
    expect(qcewLevels("48453")).toEqual({ total: ["70"], byOwnership: "71", sector: "74" });
    expect(qcewLevels("48000")).toEqual({ total: ["50"], byOwnership: "51", sector: "54" });
    expect(qcewLevels("US000")).toEqual({ total: ["10"], byOwnership: "11", sector: "14" });
  });
  it("an unrecognised code matches nothing instead of falling back to county", () => {
    expect(qcewLevels("USMSA").total).toEqual([]);
    expect(qcewLevels("").total).toEqual([]);
    expect(parseQcewAreaTotal([HEADER, TOTAL].join("\n"), "4845", 2024, 1)).toBeNull();
  });
});

// Real rows, copied verbatim from the BLS open-data area slices on 2026-10-01.
// https://data.bls.gov/cew/data/api/2019/4/area/C1242.csv
const C1242_2019Q4_TOTAL = '"C1242","0","10","40","0","2019","4","",63612,1078011,1087340,1088482,18817724002,988958194,16214538,1335,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",2726,4.5,41765,4.0,44446,4.3,45284,4.3,1881451593,11.1,40545858,4.3,-686070,-4.1,83,6.6';
const C1242_2019Q4_PRIVATE = '"C1242","5","10","41","0","2019","4","",62846,902503,910961,912209,16159422716,984880354,16210499,1368,"",1.02,0.98,0.98,0.98,1.01,1.03,1.01,1.02,"",2705,4.5,37398,4.3,39077,4.5,40081,4.6,1738606627,12.1,40570218,4.3,-616305,-3.7,93,7.3';
// https://data.bls.gov/cew/data/api/2025/2/area/CS101.csv
const CS101_2025Q2 = '"CS101","0","10","30","0","2025","2","",4933,81619,81715,80421,1141936527,110860039,1313309,1081,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",-64,-1.3,1260,1.6,890,1.1,-10,0.0,59960406,5.5,2445275,2.3,142826,12.2,48,4.6';
// Annual slices: https://data.bls.gov/cew/data/api/2019/a/area/C1242.csv and .../2019/a/area/C1010.csv
const ANNUAL_HEADER =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","annual_avg_estabs","annual_avg_emplvl","total_annual_wages","taxable_annual_wages","annual_contributions","annual_avg_wkly_wage","avg_annual_pay","lq_disclosure_code","lq_annual_avg_estabs","lq_annual_avg_emplvl","lq_total_annual_wages","lq_taxable_annual_wages","lq_annual_contributions","lq_annual_avg_wkly_wage","lq_avg_annual_pay","oty_disclosure_code","oty_annual_avg_estabs_chg","oty_annual_avg_estabs_pct_chg","oty_annual_avg_emplvl_chg","oty_annual_avg_emplvl_pct_chg","oty_total_annual_wages_chg","oty_total_annual_wages_pct_chg","oty_taxable_annual_wages_chg","oty_taxable_annual_wages_pct_chg","oty_annual_contributions_chg","oty_annual_contributions_pct_chg","oty_annual_avg_wkly_wage_chg","oty_annual_avg_wkly_wage_pct_chg","oty_avg_annual_pay_chg","oty_avg_annual_pay_pct_chg"';
const C1242_2019A_TOTAL = '"C1242","0","10","40","0","2019","A","",62712,1062306,69861215840,9806406229,169637411,1265,65764,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",2783,4.6,41523,4.1,6274740735,9.9,472410157,5.1,-5717515,-3.3,67,5.6,3472,5.6';
const C1242_2019A_PRIVATE = '"C1242","5","10","41","0","2019","A","",61960,888905,59720389999,9728848153,169560052,1292,67184,"",1.02,0.98,1.00,1.01,1.01,1.02,1.02,"",2778,4.7,37661,4.4,5793092945,10.7,468344768,5.1,-4472156,-2.6,74,6.1,3833,6.1';
const C1010_2019A_TOTAL = '"C1010","0","10","80","0","2019","A","",1640,21566,948898686,249037834,1326704,846,44000,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",-13,-0.8,-242,-1.1,18003683,1.9,-2868084,-1.1,13997,1.1,25,3.0,1313,3.1';

describe("parseQcewAreaTotal on metro, micro and CSA slices", () => {
  it("reads the Austin MSA total (agglvl 40) that the county-only level skipped", () => {
    const row = parseQcewAreaTotal([HEADER, C1242_2019Q4_PRIVATE, C1242_2019Q4_TOTAL].join("\n"), "C1242", 2019, 4)!;
    expect(row).toEqual({
      area: "C1242",
      year: 2019,
      qtr: 4,
      estabs: 63612,
      emp: 1088482,
      wages: 18817724002,
      avgWeeklyWage: 1335,
      avgAnnualPay: null,
      otyEmpPct: 4.3,
      otyAvgWeeklyWagePct: 6.6,
      otyEstabsPct: 4.5,
      suppressed: false,
    });
  });
  it("reads the private-sector total (own 5, agglvl 41) when asked", () => {
    expect(parseQcewAreaTotal([HEADER, C1242_2019Q4_TOTAL, C1242_2019Q4_PRIVATE].join("\n"), "C1242", 2019, 4, { own: "5" })).toMatchObject({ emp: 912209, estabs: 62846, suppressed: false });
  });
  it("reads a CSA total (agglvl 30) and finds no ownership rows there", () => {
    expect(parseQcewAreaTotal([HEADER, CS101_2025Q2].join("\n"), "CS101", 2025, 2)).toMatchObject({ area: "CS101", emp: 80421, avgWeeklyWage: 1081 });
    expect(parseQcewAreaTotal([HEADER, CS101_2025Q2].join("\n"), "CS101", 2025, 2, { own: "5" })).toBeNull();
  });
});

describe("parseQcewAreaTotal on annual slices", () => {
  it("returns the published annual_avg_emplvl for the Austin MSA, 2019", () => {
    const row = parseQcewAreaTotal([ANNUAL_HEADER, C1242_2019A_TOTAL, C1242_2019A_PRIVATE].join("\n"), "C1242", 2019, "a")!;
    expect(row).toEqual({
      area: "C1242",
      year: 2019,
      qtr: "a",
      estabs: 62712,
      emp: 1062306,
      wages: 69861215840,
      avgWeeklyWage: 1265,
      avgAnnualPay: 65764,
      otyEmpPct: 4.1,
      otyAvgWeeklyWagePct: 5.6,
      otyEstabsPct: 4.6,
      suppressed: false,
    });
  });
  it("reads the annual private total and a micropolitan total (agglvl 80)", () => {
    expect(parseQcewAreaTotal([ANNUAL_HEADER, C1242_2019A_TOTAL, C1242_2019A_PRIVATE].join("\n"), "C1242", 2019, "a", { own: "5" })).toMatchObject({ emp: 888905, avgAnnualPay: 67184 });
    expect(parseQcewAreaTotal([ANNUAL_HEADER, C1010_2019A_TOTAL].join("\n"), "C1010", 2019, "a")).toMatchObject({ area: "C1010", qtr: "a", emp: 21566, avgWeeklyWage: 846, avgAnnualPay: 44000 });
  });
  it("the shape comes from the header, not the caller's period", () => {
    expect(qcewColumns(ANNUAL_HEADER.replace(/"/g, "").split(","))).toBe(QCEW_ANNUAL_COLUMNS);
    expect(qcewColumns(HEADER.replace(/"/g, "").split(","))).toBe(QCEW_QUARTERLY_COLUMNS);
    expect(parseQcewAreaTotal([ANNUAL_HEADER, C1242_2019A_TOTAL].join("\n"), "C1242", 2019, 4)).toMatchObject({ qtr: "a", emp: 1062306 });
  });
});
