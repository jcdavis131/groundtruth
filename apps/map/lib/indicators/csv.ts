// CSV renderers for indicators. Browser-safe (no registry, no server
// helpers) so the HUD panel's download button and the API share one format.

import type { Series } from "@/lib/series/types";
import type { IndicatorResult } from "./service";

export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One indicator's history as CSV: time (ISO), value, plus the unit and source in a comment-free header row. */
export function historyCsv(series: Pick<Series, "id" | "unit" | "points" | "provenance">): string {
  const rows = ["time,value,unit,source,series_id"];
  for (const p of series.points) rows.push([new Date(p.t).toISOString(), p.v ?? "", series.unit, series.provenance.source.id, series.provenance.seriesId ?? ""].map(csvCell).join(","));
  return rows.join("\n");
}

const fix = (v: number | null, d = 3) => (v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(d));

/** Evaluated indicators as CSV, one row each; what the panel's download button saves. */
export function latestCsv(items: IndicatorResult[]): string {
  const rows = ["id,title,category,unit,latest,latest_at,prev,prev_at,change_abs,change_pct,yoy_pct,yoy_abs,status,triggered,source,series_id,retrieved_at,error"];
  for (const it of items) {
    const e = it.evaluation;
    rows.push(
      [
        it.meta.id,
        it.meta.title,
        it.meta.category,
        it.meta.unit,
        fix(e.latest),
        e.latestAt ?? "",
        fix(e.prev),
        e.prevAt ?? "",
        fix(e.changeAbs),
        fix(e.changePct, 2),
        fix(e.yoyPct, 2),
        fix(e.yoyAbs),
        e.status,
        e.triggered.map((t) => t.label).join(" | "),
        it.meta.source,
        it.meta.seriesId,
        it.provenance?.retrievedAt ?? "",
        it.error ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return rows.join("\n");
}
