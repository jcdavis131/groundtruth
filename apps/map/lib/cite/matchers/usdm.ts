// U.S. Drought Monitor county statistics (statisticsType=2: the share of county area in each class, summing to 100).
// The reply is a CSV: MapDate,FIPS,County,State,None,D0..D4,ValidStart,ValidEnd,StatisticFormatID. The item prints
// "D0 0%, D1 21.1%, ..." as published; the declared tolerance is 0.1 percentage point per class.

import type { CiteItem, Matcher, Reading, Scalar } from "../types";
import { absent, also, toNum, unreadable } from "./util";

const CLASSES = ["D0", "D1", "D2", "D3", "D4"] as const;

function parseCsv(body: string): Array<Record<string, string>> | null {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 1) return null;
  const head = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  if (!head.includes("MapDate") || !head.includes("D0")) return null;
  return lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((c, i) => [head[i], c.replace(/^"|"$/g, "").trim()])));
}

export const usdm: Matcher = {
  id: "usdm",
  sourceId: "usdm",
  tolerance: { D0: 0.1, D1: 0.1, D2: 0.1, D3: 0.1, D4: 0.1, None: 0.1, MapDate: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = parseCsv(body);
    if (!rows) return unreadable("not a USDM county-statistics CSV");
    if (!rows.length) return absent("USDM has no row for this county and map date");
    if (!/^U\.S\. Drought Monitor this week/.test(item.fact)) return unreadable(`no rule for the USDM fact "${item.fact}"`);
    const r = rows[0];
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(r.MapDate ?? "");
    if (!m) return unreadable("the row has no MapDate");
    const mapDate = `${m[1]}-${m[2]}-${m[3]}`;
    const stated: Record<string, number> = {};
    for (const part of String(item.value ?? "").split(",")) {
      const mm = /^\s*(D[0-4])\s+(-?[\d.]+)%\s*$/.exec(part);
      if (mm) stated[mm[1]] = Number(mm[2]);
    }
    const noneStated = /none (-?[\d.]+)%/.exec(item.note ?? "");
    const pairs: Array<{ field: string; item: Scalar; publisher: Scalar }> = [];
    for (const c of CLASSES) pairs.push(also(c, c in stated ? stated[c] : null, toNum(r[c])));
    if (noneStated) pairs.push(also("None", Number(noneStated[1]), toNum(r.None)));
    pairs.push(also("MapDate", item.period ?? null, mapDate));
    const [first, ...others] = pairs;
    return { kind: "value", field: first.field, publisherValue: first.publisher, itemValue: first.item, period: mapDate, later: false, also: others };
  },
};
