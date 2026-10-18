// QCEW "-" rows are withheld, not zero jobs. Every fixture line below is
// copied verbatim from https://data.bls.gov/cew/data/api/2025/4/area/C1242.csv
// (Austin-Round Rock-San Marcos MSA, 2025 Q4, read 2026-10-01): the published
// total-covered row, the private-sector total, and two private NAICS sector
// rows, the last three carrying disclosure code "-" with literal zeros.

import { describe, expect, it } from "vitest";
import { parseQcewAreaTotal } from "./history/qcewCsv";
import { isWithheld } from "./qcewDisclosure";
import { parseQcewSectors, qcewRow } from "./sources";
import { parseCsv } from "./csv";

const HEADER =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage","lq_disclosure_code","lq_qtrly_estabs","lq_month1_emplvl","lq_month2_emplvl","lq_month3_emplvl","lq_total_qtrly_wages","lq_taxable_qtrly_wages","lq_qtrly_contributions","lq_avg_wkly_wage","oty_disclosure_code","oty_qtrly_estabs_chg","oty_qtrly_estabs_pct_chg","oty_month1_emplvl_chg","oty_month1_emplvl_pct_chg","oty_month2_emplvl_chg","oty_month2_emplvl_pct_chg","oty_month3_emplvl_chg","oty_month3_emplvl_pct_chg","oty_total_qtrly_wages_chg","oty_total_qtrly_wages_pct_chg","oty_taxable_qtrly_wages_chg","oty_taxable_qtrly_wages_pct_chg","oty_qtrly_contributions_chg","oty_qtrly_contributions_pct_chg","oty_avg_wkly_wage_chg","oty_avg_wkly_wage_pct_chg"';
const TOTAL = '"C1242","0","10","40","0","2025","4","",76990,1314433,1320208,1321014,32155866762,1135454160,17862269,1876,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",696,0.9,35581,2.8,34881,2.7,36649,2.9,2458637609,8.3,32268653,2.9,2303266,14.8,95,5.3';
const PRIVATE = '"C1242","5","10","41","0","2025","4","-",0,0,0,0,0,0,0,0,"N",0.00,0,0,0,0,0,0,0,"N",-75510,-100.0,0,0,0,0,0,0,0,0,0,0,0,0,0,0';
const AGRICULTURE = '"C1242","5","11","44","0","2025","4","-",0,0,0,0,0,0,0,0,"N",0.00,0,0,0,0,0,0,0,"N",-280,-100.0,0,0,0,0,0,0,0,0,0,0,0,0,0,0';
const CONSTRUCTION = '"C1242","5","23","44","0","2025","4","-",0,0,0,0,0,0,0,0,"N",0.00,0,0,0,0,0,0,0,"N",-6181,-100.0,0,0,0,0,0,0,0,0,0,0,0,0,0,0';
const CSV = [HEADER, TOTAL, PRIVATE, AGRICULTURE, CONSTRUCTION].join("\n");

/** One CSV line as the header-keyed record qcewRow reads. */
function record(line: string): Record<string, string> {
  const [h, r] = parseCsv([HEADER, line].join("\n"));
  return Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]));
}

describe("isWithheld", () => {
  it("treats any non-blank disclosure code as withheld", () => {
    expect(isWithheld("N")).toBe(true);
    expect(isWithheld("-")).toBe(true);
    expect(isWithheld(" - ")).toBe(true);
  });
  it("blank, whitespace or absent codes are published", () => {
    expect(isWithheld("")).toBe(false);
    expect(isWithheld("  ")).toBe(false);
    expect(isWithheld(undefined)).toBe(false);
    expect(isWithheld(null)).toBe(false);
  });
});

describe("a real 2025 Q4 '-' row from the Austin MSA slice", () => {
  it("the fixture really carries '-' with zero jobs", () => {
    const r = record(PRIVATE);
    expect(r.disclosure_code).toBe("-");
    expect(r.month3_emplvl).toBe("0");
    expect(r.qtrly_estabs).toBe("0");
  });

  it("qcewRow: null values, suppressed, never zero jobs", () => {
    const row = qcewRow(record(PRIVATE), "2025 Q4");
    expect(row.suppressed).toBe(true);
    expect(row.emp).toBeNull();
    expect(row.estabs).toBeNull();
    expect(row.wages).toBeNull();
    expect(row.avgWeeklyWage).toBeNull();
    expect(row.yoy).toEqual({ estabs: null, emp: null, wages: null, avgWeeklyWage: null });
  });

  it("qcewRow keeps the published total row of the same file", () => {
    expect(qcewRow(record(TOTAL), "2025 Q4")).toMatchObject({ area: "C1242", emp: 1321014, estabs: 76990, avgWeeklyWage: 1876, suppressed: false });
  });

  it("parseQcewSectors: '-' sector rows are null, the metro total still reads", () => {
    const { total, sectors } = parseQcewSectors(CSV, "C1242", "2025 Q4");
    expect(total).toMatchObject({ area: "C1242", emp: 1321014, suppressed: false });
    expect(sectors.map((s) => s.code).sort()).toEqual(["11", "23"]);
    for (const s of sectors) {
      expect(s.suppressed).toBe(true);
      expect(s.emp).toBeNull();
      expect(s.estabs).toBeNull();
      expect(s.avgWeeklyWage).toBeNull();
      expect(s.lq).toBeNull();
      expect(s.yoyEmp).toBeNull();
    }
  });

  it("parseQcewAreaTotal: the private-sector total ('-') is null, the all-ownership total is not", () => {
    const priv = parseQcewAreaTotal(CSV, "C1242", 2025, 4, { own: "5" });
    expect(priv).not.toBeNull();
    expect(priv).toMatchObject({ area: "C1242", year: 2025, qtr: 4, suppressed: true, emp: null, estabs: null, wages: null, avgWeeklyWage: null, otyEmpPct: null });
    expect(parseQcewAreaTotal(CSV, "C1242", 2025, 4)).toMatchObject({ emp: 1321014, suppressed: false });
  });
});
