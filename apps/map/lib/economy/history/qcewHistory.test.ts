import { describe, expect, it } from "vitest";
import { isoDate } from "./align";
import type { QcewTotalRow } from "./qcewCsv";
import { qcewQuartersToSeries, qcewScope, quarterList, type QcewQuarter } from "./qcewHistory";

const row = (year: number, qtr: number, emp: number | null, wage: number | null, estabs = 100): QcewTotalRow => ({
  area: "48453",
  year,
  qtr,
  estabs,
  emp,
  wages: null,
  avgWeeklyWage: wage,
  avgAnnualPay: null,
  otyEmpPct: null,
  otyAvgWeeklyWagePct: null,
  otyEstabsPct: null,
  suppressed: emp == null,
});

describe("quarterList", () => {
  it("covers N years plus four quarters for the oldest over-the-year base, ascending", () => {
    const q = quarterList({ year: 2024, qtr: 1 }, 1);
    expect(q).toHaveLength(8);
    expect(q[0]).toEqual({ year: 2022, qtr: 2 });
    expect(q[7]).toEqual({ year: 2024, qtr: 1 });
  });
});

describe("qcewScope", () => {
  it("maps area codes to id scopes", () => {
    expect(qcewScope("48453")).toBe("county:48453");
    expect(qcewScope("48000")).toBe("state:48");
    expect(qcewScope("US000")).toBe("us");
  });
});

describe("qcewQuartersToSeries", () => {
  const quarters: QcewQuarter[] = [];
  let y = 2022;
  let q = 2;
  for (let k = 0; k < 8; k++) {
    // 2023 Q2 is suppressed; 2023 Q4 failed to fetch.
    const r = y === 2023 && q === 2 ? row(y, q, null, null) : row(y, q, 1000 + k * 10, 900 + k * 5);
    quarters.push({ year: y, qtr: q, row: y === 2023 && q === 4 ? null : r });
    q++;
    if (q === 5) {
      q = 1;
      y++;
    }
  }
  const h = qcewQuartersToSeries("48453", [...quarters].reverse(), { name: "Travis County, TX", retrievedAt: "2024-06-01T00:00:00.000Z" });
  it("levels are quarterly, stamped on quarter end, sorted, with published provenance", () => {
    expect(h.emp.id).toBe("qcew:county:48453:emp");
    expect(h.avgWeeklyWage.id).toBe("qcew:county:48453:avg-weekly-wage");
    expect(h.estabs.id).toBe("qcew:county:48453:estabs");
    expect(h.emp.frequency).toBe("quarterly");
    expect(h.emp.points.map((p) => isoDate(p.t))).toEqual(["2022-06-30", "2022-09-30", "2022-12-31", "2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31"]);
    expect(h.emp.points.map((p) => p.v)).toEqual([1000, 1010, 1020, 1030, null, 1050, null, 1070]);
    expect(h.emp.provenance.kind).toBe("published");
    expect(h.emp.provenance.period).toBe("2024-Q1");
    expect(h.emp.provenance.upstreamUrl).toBe("https://data.bls.gov/cew/data/api/2024/1/area/48453.csv");
    expect(h.emp.geo).toEqual({ kind: "county", id: "48453", name: "Travis County, TX" });
    expect(h.missing).toEqual(["2023-Q4"]);
  });
  it("over-the-year changes are estimates from the levels, null across gaps", () => {
    expect(h.empYoY.id).toBe("qcew:county:48453:emp:yoy");
    expect(h.wageYoY.id).toBe("qcew:county:48453:avg-weekly-wage:yoy");
    expect(h.empYoY.provenance.kind).toBe("estimate");
    expect(h.empYoY.provenance.method).toContain("q − 4 quarters");
    expect(h.empYoY.provenance.notes?.[0]).toBe("inputs: qcew:county:48453:emp");
    const yoy = h.empYoY.points.map((p) => (p.v == null ? null : Number(p.v.toFixed(9))));
    // 2023 Q2: 1040 -> suppressed; 2023 Q3: 1050 / 1010; 2023 Q4 missing; 2024 Q1: 1070 / 1030
    expect(yoy).toEqual([null, null, null, null, null, Number(((1050 / 1010 - 1) * 100).toFixed(9)), null, Number(((1070 / 1030 - 1) * 100).toFixed(9))]);
    expect(h.wageYoY.points[7].v).toBeCloseTo((935 / 915 - 1) * 100, 9);
  });
  it("handles an empty fetch", () => {
    const empty = qcewQuartersToSeries("US000", [{ year: 2024, qtr: 1, row: null }]);
    expect(empty.emp.id).toBe("qcew:us:emp");
    expect(empty.emp.points).toEqual([{ t: Date.UTC(2024, 2, 31), v: null }]);
    expect(empty.missing).toEqual(["2024-Q1"]);
    expect(empty.emp.provenance.period).toBeUndefined();
  });
});
