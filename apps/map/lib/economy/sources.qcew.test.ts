// The QCEW readers on metro C-codes. Every fixture line is copied verbatim
// from the BLS open-data slices named above it (read 2026-10-01); no value is
// typed in by hand.

import { describe, expect, it } from "vitest";
import { parseQcewLatest, parseQcewSectors } from "./sources";

const HEADER =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage","lq_disclosure_code","lq_qtrly_estabs","lq_month1_emplvl","lq_month2_emplvl","lq_month3_emplvl","lq_total_qtrly_wages","lq_taxable_qtrly_wages","lq_qtrly_contributions","lq_avg_wkly_wage","oty_disclosure_code","oty_qtrly_estabs_chg","oty_qtrly_estabs_pct_chg","oty_month1_emplvl_chg","oty_month1_emplvl_pct_chg","oty_month2_emplvl_chg","oty_month2_emplvl_pct_chg","oty_month3_emplvl_chg","oty_month3_emplvl_pct_chg","oty_total_qtrly_wages_chg","oty_total_qtrly_wages_pct_chg","oty_taxable_qtrly_wages_chg","oty_taxable_qtrly_wages_pct_chg","oty_qtrly_contributions_chg","oty_qtrly_contributions_pct_chg","oty_avg_wkly_wage_chg","oty_avg_wkly_wage_pct_chg"';

// https://data.bls.gov/cew/data/api/2025/4/industry/10.csv: one row per aggregation level the table reads,
// plus a private-ownership MSA row and a county ownership row that both carry "-".
const INDUSTRY_10 = [
  '"US000","0","10","10","0","2025","4","",12289703,156979833,157114057,156855311,3202364987825,241497153206,3876714388,1569,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",91997,0.8,742548,0.5,346198,0.2,454268,0.3,138074018014,4.5,5697401441,2.4,91676888,2.4,63,4.2',
  '"48000","0","10","50","0","2025","4","",864454,14225617,14277655,14276406,286956893496,12755777868,197665550,1548,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",15420,1.8,145952,1.0,122573,0.9,128983,0.9,13840500797,5.1,168458415,1.3,9563358,5.1,61,4.1',
  '"48453","0","10","70","0","2025","4","",51731,939064,942182,942697,25186292886,809158130,13879326,2058,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",140,0.3,25429,2.8,25034,2.7,27940,3.1,2082354883,9.0,26771271,3.4,2036575,17.2,116,6.0',
  '"C1242","0","10","40","0","2025","4","",76990,1314433,1320208,1321014,32155866762,1135454160,17862269,1876,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",696,0.9,35581,2.8,34881,2.7,36649,2.9,2458637609,8.3,32268653,2.9,2303266,14.8,95,5.3',
  '"C1242","5","10","41","0","2025","4","-",0,0,0,0,0,0,0,0,"N",0.00,0,0,0,0,0,0,0,"N",-75510,-100.0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
  '"C1010","0","10","80","0","2025","4","",1728,20938,20866,20786,317679416,22627196,86819,1171,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",6,0.3,-116,-0.6,-266,-1.3,-148,-0.7,13101219,4.3,-676977,-2.9,-5774,-6.2,57,5.1',
  '"CS101","0","10","30","0","2025","4","",4955,82083,82300,82275,1245073486,77389461,1149878,1165,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",-12,-0.2,1159,1.4,975,1.2,1191,1.5,76960083,6.6,5765920,8.1,297445,34.9,57,5.1',
  '"31005","1","10","71","0","2025","4","-",0,0,0,0,0,0,0,0,"N",0.00,0,0,0,0,0,0,0,"N",-1,-100.0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
];

describe("parseQcewLatest", () => {
  const t = parseQcewLatest([HEADER, ...INDUSTRY_10].join("\n"), 2025, 4);

  it("keeps metropolitan (agglvl 40) rows, keyed by C-code", () => {
    expect(t.metros.size).toBe(1);
    expect(t.metros.get("C1242")).toMatchObject({ area: "C1242", period: "2025 Q4", emp: 1321014, estabs: 76990, avgWeeklyWage: 1876, yoy: { emp: 2.9, avgWeeklyWage: 5.3 }, suppressed: false });
  });
  it("keeps micropolitan (agglvl 80) rows apart from the metros", () => {
    expect(t.micros.get("C1010")).toMatchObject({ emp: 20786, suppressed: false });
    expect(t.metros.has("C1010")).toBe(false);
  });
  it("still reads counties, states and the nation, and skips ownership rows", () => {
    expect(t.counties.get("48453")?.emp).toBe(942697);
    expect(t.states.get("48")?.emp).toBe(14276406);
    expect(t.national?.emp).toBe(156855311);
    expect(t.counties.has("31005")).toBe(false);
    expect([...t.counties.keys(), ...t.metros.keys(), ...t.micros.keys()]).not.toContain("CS101");
  });
  it("labels the period", () => {
    expect(t).toMatchObject({ year: 2025, qtr: 4, period: "2025 Q4" });
  });
});

// https://data.bls.gov/cew/data/api/2019/4/area/C1242.csv: the total, the private total,
// three private NAICS sector rows (agglvl 44; Information carries "N") and one supersector row (43) that must not count.
const C1242_2019Q4 = [
  '"C1242","0","10","40","0","2019","4","",63612,1078011,1087340,1088482,18817724002,988958194,16214538,1335,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",2726,4.5,41765,4.0,44446,4.3,45284,4.3,1881451593,11.1,40545858,4.3,-686070,-4.1,83,6.6',
  '"C1242","5","10","41","0","2019","4","",62846,902503,910961,912209,16159422716,984880354,16210499,1368,"",1.02,0.98,0.98,0.98,1.01,1.03,1.01,1.02,"",2705,4.5,37398,4.3,39077,4.5,40081,4.6,1738606627,12.1,40570218,4.3,-616305,-3.7,93,7.3',
  '"C1242","5","23","44","0","2019","4","",5091,64876,65225,65322,1171329375,81177719,1663773,1383,"",0.99,1.17,1.19,1.21,1.07,1.11,0.80,0.90,"",219,4.5,4613,7.7,5019,8.3,5155,8.6,130790936,12.6,8019104,11.0,110688,7.1,54,4.1',
  '"C1242","5","31-33","44","0","2019","4","",1848,62127,62485,62633,1928442257,36771482,749494,2377,"",0.84,0.68,0.68,0.68,1.03,0.51,0.62,1.51,"",51,2.8,1121,1.8,1377,2.3,1339,2.2,383339036,24.8,-1637398,-4.3,-162243,-17.8,433,22.3',
  '"C1242","5","51","44","0","2019","4","N",1578,0,0,0,0,0,0,0,"N",1.35,0,0,0,0,0,0,0,"N",249,18.7,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
  '"C1242","5","1011","43","0","2019","4","",460,5252,5100,4895,189902712,4418810,76836,2874,"",0.53,0.36,0.37,0.37,0.77,0.22,0.16,2.10,"",-2,-0.4,212,4.2,50,1.0,-98,-2.0,53719907,39.4,-432085,-8.9,-49636,-39.2,790,37.9',
];

describe("parseQcewSectors on a metro C-code", () => {
  it("reads the MSA NAICS sector rows (agglvl 44) and the MSA total (agglvl 40)", () => {
    const { total, sectors } = parseQcewSectors([HEADER, ...C1242_2019Q4].join("\n"), "C1242", "2019 Q4");
    expect(total).toMatchObject({ area: "C1242", emp: 1088482, suppressed: false });
    expect(sectors.map((s) => s.code)).toEqual(["23", "31-33", "51"]);
    expect(sectors[0]).toEqual({ code: "23", title: "Construction", estabs: 5091, emp: 65322, avgWeeklyWage: 1383, lq: 1.21, yoyEmp: 8.6, suppressed: false });
    expect(sectors[1]).toMatchObject({ code: "31-33", title: "Manufacturing", emp: 62633, lq: 0.68 });
    expect(sectors[2]).toMatchObject({ code: "51", suppressed: true, emp: null, estabs: null, lq: null });
  });
  it("a county code on the same file finds neither its total nor its sectors", () => {
    expect(parseQcewSectors([HEADER, ...C1242_2019Q4].join("\n"), "48453", "2019 Q4")).toEqual({ total: undefined, sectors: [] });
  });
});
