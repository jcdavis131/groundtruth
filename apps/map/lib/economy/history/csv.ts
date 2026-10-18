// Long-format CSV for notebooks: one row per observation, series_id,t_iso,value.
// Null values are written as empty cells so pandas reads them as NaN.

import type { Series } from "@/lib/series/types";
import { isoDate } from "./align";

function quote(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function seriesToLongCsv(series: Series[]): string {
  const lines = ["series_id,t_iso,value"];
  for (const s of series) {
    for (const p of s.points) lines.push(`${quote(s.id)},${isoDate(p.t)},${p.v == null ? "" : String(p.v)}`);
  }
  return lines.join("\n") + "\n";
}
