// BLS QCEW area CSV (data.bls.gov/cew/data/api/{year}/{qtr}/area/{area}.csv). The row for the item is own_code 0 (all
// ownerships), industry_code 10 (all industries) and the area and quarter the URL names. disclosure_code "N" is BLS's own
// suppression flag: the figures are withheld for that cell, so the verdict is NOT_PUBLISHED. month3_emplvl is the third
// month's employment (a count: tolerance 0); avg_wkly_wage is whole USD (world.ts rounds to whole dollars: 0.5).

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, also, toNum, unreadable } from "./util";

function parseCsv(body: string): Array<Record<string, string>> | null {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return null;
  const head = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  if (!head.includes("area_fips") || !head.includes("own_code") || !head.includes("industry_code")) return null;
  return lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((c, i) => [head[i], c.replace(/^"|"$/g, "").trim()])));
}

const periodIndex = (y: number, q: number) => y * 4 + (q - 1);

export const blsQcew: Matcher = {
  id: "bls-qcew-area-csv",
  sourceId: "bls-qcew",
  tolerance: { month3_emplvl: 0, avg_wkly_wage: 0.5, period: 0 },
  read(item: CiteItem, body: string, url: string): Reading {
    const rows = parseCsv(body);
    if (!rows) return unreadable("not a QCEW area CSV (no area_fips, own_code, industry_code columns)");
    const u = /\/(\d{4})\/(\d)\/area\/(\w+)\.csv$/.exec(url);
    if (!u) return unreadable("the record URL does not name a year, quarter and area");
    const row = rows.find((r) => r.area_fips === u[3] && r.own_code === "0" && r.industry_code === "10");
    if (!row) return absent(`the CSV has no area ${u[3]} row for ownership 0, industry 10`);
    const year = toNum(row.year);
    const qtr = toNum(row.qtr);
    if (year === null || qtr === null) return unreadable("the row has no year or qtr");
    const period = `${year} Q${qtr}`;
    const m = /^(\d{4}) Q([1-4])$/.exec(item.period ?? "");
    const later = !!m && periodIndex(year, qtr) > periodIndex(Number(m[1]), Number(m[2]));
    if (row.disclosure_code === "N") return { kind: "suppressed", reason: `BLS withholds this cell (disclosure_code N) for ${period}`, period };
    const wage = item.fact === "average weekly wage (BLS QCEW)";
    const emp = item.fact === "covered employment (BLS QCEW, all industries)";
    if (!wage && !emp) return unreadable(`no rule for the QCEW fact "${item.fact}"`);
    const field = wage ? "avg_wkly_wage" : "month3_emplvl";
    return {
      kind: "value",
      field,
      publisherValue: toNum(row[field]),
      itemValue: typeof item.value === "number" ? item.value : null,
      period,
      later,
      also: [also("period", item.period ?? null, period)],
    };
  },
};
