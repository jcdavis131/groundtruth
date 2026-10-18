// Full-history parser for Zillow research CSVs. lib/economy/sources.ts
// parseZillow() keeps 25 months and 11 yearly points per row; this one keeps
// every month column so the history route and the IC panel can read 2000+.
//
// Header shape (county file):
//   RegionID,SizeRank,RegionName,RegionType,StateName,State,Metro,StateCodeFIPS,MunicipalCodeFIPS,2000-01-31,2000-02-29,...
// State and metro files drop the State/Metro/FIPS columns; the metro file
// carries the national row as RegionType "country".
// shape per https://www.zillow.com/research/data/; unverified in sandbox

import { cellNum, parseCsv } from "@/lib/economy/csv";

export type ZillowHistoryKind = "zhviCounty" | "zhviState" | "zhviMetro" | "zoriCounty" | "zoriMetro";

export interface ZillowHistoryRow {
  /** County GEOID, state name, metro RegionID, or "US". Same convention as sources.ts HomeValue.id. */
  id: string;
  name: string;
  regionType: string;
  state?: string;
  metro?: string;
  sizeRank: number;
  /** One entry per `dates` column; null where the cell is blank. */
  values: Array<number | null>;
}

export interface ZillowHistoryTable {
  kind: ZillowHistoryKind;
  /** Month-end column headers, oldest first, ISO "YYYY-MM-DD". */
  dates: string[];
  /** Epoch ms (UTC) for each of `dates`. */
  times: number[];
  rows: Map<string, ZillowHistoryRow>;
}

function isoToUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Parse a whole Zillow file. Rows with no numeric cell at all are dropped. */
export function parseZillowHistory(kind: ZillowHistoryKind, csv: string): ZillowHistoryTable {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  const col = (n: string) => header.indexOf(n);
  const firstDate = header.findIndex((h) => /^\d{4}-\d{2}-\d{2}$/.test(h));
  if (firstDate < 0) throw new Error(`Zillow ${kind}: no month columns in header`);
  const iName = col("RegionName");
  const iType = col("RegionType");
  const iState = col("State");
  const iStateName = col("StateName");
  const iMetro = col("Metro");
  const iRank = col("SizeRank");
  const iId = col("RegionID");
  const iSt = col("StateCodeFIPS");
  const iCo = col("MunicipalCodeFIPS");
  const dates = header.slice(firstDate);
  const times = dates.map(isoToUtc);
  const out = new Map<string, ZillowHistoryRow>();
  for (const r of rows.slice(1)) {
    if (r.length <= firstDate) continue;
    const values: Array<number | null> = new Array(dates.length);
    let any = false;
    for (let k = 0; k < dates.length; k++) {
      const v = cellNum(r[firstDate + k]);
      values[k] = v;
      if (v != null) any = true;
    }
    if (!any) continue;
    const type = iType >= 0 ? r[iType] : "";
    const id =
      type === "county" && iSt >= 0 && iCo >= 0
        ? r[iSt].padStart(2, "0") + r[iCo].padStart(3, "0")
        : type === "country"
          ? "US"
          : type === "state"
            ? r[iName]
            : r[iId];
    out.set(id, {
      id,
      name: iName >= 0 ? r[iName] : id,
      regionType: type,
      state: iState >= 0 ? r[iState] || undefined : iStateName >= 0 ? r[iStateName] || undefined : undefined,
      metro: iMetro >= 0 ? r[iMetro] || undefined : undefined,
      sizeRank: iRank >= 0 ? (cellNum(r[iRank]) ?? 9999) : 9999,
      values,
    });
  }
  return { kind, dates, times, rows: out };
}
