// Condition: what the physical twin is doing compared with what it usually does.
//
// A count of gauges in a watershed says where the instruments are. What a
// watershed is doing says whether its rivers are running high or low for the
// day of the year. USGS publishes, for every streamgage with enough approved
// record, the percentiles of daily-mean discharge for each calendar day (the
// Water Data Statistics API, observationNormals by day of year). The latest
// instantaneous flow placed against them gives the same classes USGS
// WaterWatch used: much below normal, below, normal, above, much above.
//
// Rules kept: a percentile is only computed from a published percentile
// table; a gauge without one has no condition (it is not assumed normal); an
// instantaneous reading compared with daily-mean statistics is an estimate,
// and the panel says so.

export type Pct = 5 | 10 | 25 | 50 | 75 | 90 | 95;
export const PCTS: Pct[] = [5, 10, 25, 50, 75, 90, 95];

/** One site's daily-mean discharge percentiles for one calendar day (cfs). */
export interface FlowNormals {
  site: string;
  month: number;
  day: number;
  p: Partial<Record<Pct, number>>;
  /** Years of approved record behind the statistics. */
  years: number | null;
}

export type FlowClass = "much-below" | "below" | "normal" | "above" | "much-above";

export const FLOW_CLASSES: Record<FlowClass, { label: string; color: string; range: string }> = {
  "much-below": { label: "much below normal", color: "#DC2626", range: "< 10th" },
  below: { label: "below normal", color: "#F59E0B", range: "10th–24th" },
  normal: { label: "normal", color: "#22C55E", range: "25th–75th" },
  above: { label: "above normal", color: "#22D3EE", range: "76th–90th" },
  "much-above": { label: "much above normal", color: "#3B82F6", range: "> 90th" },
};

export const FLOW_CLASS_ORDER: FlowClass[] = ["much-below", "below", "normal", "above", "much-above"];

/** The slice of an observationNormals answer this module reads. */
export interface NormalsResponse {
  features?: Array<{
    properties?: {
      monitoring_location_id?: string;
      data?: Array<{
        parameter_code?: string;
        unit_of_measure?: string;
        parent_statistic_id?: string;
        values?: Array<{ time_of_year?: string; values?: string[]; percentiles?: string[]; sample_count?: number }>;
      }>;
    };
  }>;
  next?: string | null;
}

/**
 * The daily-mean discharge percentiles for one calendar day, per site, from
 * an observationNormals answer. Only the series computed from daily means
 * (parent statistic 00003) is read; the ones built on daily maxima and minima
 * are different quantities. "nan" is no value, not zero.
 */
export function parseNormals(res: NormalsResponse, month: number, day: number): Record<string, FlowNormals> {
  const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const out: Record<string, FlowNormals> = {};
  for (const f of res.features ?? []) {
    const id = f.properties?.monitoring_location_id ?? "";
    const m = /^USGS-(\d{8,15})$/.exec(id);
    if (!m) continue;
    for (const series of f.properties?.data ?? []) {
      if (series.parameter_code !== "00060" || series.parent_statistic_id !== "00003") continue;
      for (const v of series.values ?? []) {
        if (v.time_of_year !== key) continue;
        const p: Partial<Record<Pct, number>> = {};
        (v.percentiles ?? []).forEach((k, i) => {
          const pk = Number(k) as Pct;
          const x = Number(v.values?.[i]);
          if (PCTS.includes(pk) && Number.isFinite(x)) p[pk] = x;
        });
        if (!Object.keys(p).length) continue;
        out[m[1]] = { site: m[1], month, day, p, years: Number.isFinite(v.sample_count) ? v.sample_count! : null };
      }
    }
  }
  return out;
}

/**
 * Where a flow sits among the day's percentiles, 0..100. Linear between the
 * published percentiles; below the lowest it is reported as half of it (2.5
 * below the 5th) and above the highest as halfway to 100 (97.5 above the
 * 95th): the tails are not published, so no finer claim is made. When
 * several percentiles share the value (a dry creek: p10 = p25 = p50 = 0), the
 * flow sits in the middle of the tie. Null when there is nothing to compare.
 */
export function flowPercentile(flow: number, n: Pick<FlowNormals, "p">): number | null {
  if (!Number.isFinite(flow)) return null;
  const pts = PCTS.filter((k) => n.p[k] != null).map((k) => [k, n.p[k]!] as const);
  if (pts.length < 2) return null;
  const [lowK, lowV] = pts[0];
  const [highK, highV] = pts[pts.length - 1];
  if (flow < lowV) return lowK <= 10 ? lowK / 2 : null;
  if (flow > highV) return highK >= 90 ? (100 + highK) / 2 : null;
  // Tie: every percentile whose value equals the flow.
  const equal = pts.filter(([, v]) => v === flow);
  if (equal.length) return (equal[0][0] + equal[equal.length - 1][0]) / 2;
  for (let i = 1; i < pts.length; i++) {
    const [k0, v0] = pts[i - 1];
    const [k1, v1] = pts[i];
    if (flow >= v0 && flow <= v1) return k0 + ((flow - v0) / (v1 - v0)) * (k1 - k0);
  }
  return null;
}

export function flowClass(pct: number): FlowClass {
  if (pct < 10) return "much-below";
  if (pct < 25) return "below";
  if (pct <= 75) return "normal";
  if (pct <= 90) return "above";
  return "much-above";
}

/** How far from normal, 0 (the median) to 1 (beyond the 5th or 95th), either way. */
export function departure(pct: number): number {
  return Math.min(1, Math.abs(pct - 50) / 45);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function ordinal(n: number): string {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][r % 10] ?? "th";
  return `${r}${s}`;
}

/** NWS flood categories that mean water is out of its banks at a forecast point. */
export const FLOOD_CATEGORIES = new Set(["minor", "moderate", "major"]);

/** Month and day in UTC, the calendar key the daily statistics are published by. */
export function monthDay(iso?: string, now = Date.now()): { month: number; day: number } {
  const t = iso ? Date.parse(iso) : NaN;
  const d = new Date(Number.isFinite(t) ? t : now);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
