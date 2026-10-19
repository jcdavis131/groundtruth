// Fetch, evaluate and (optionally) record indicators. Each indicator is
// isolated: one upstream failing produces an item with status "no data" and
// an error string, never a failed response. Fetches go through cached()
// with a TTL chosen per cadence, so a panel polling every 15 minutes and a
// script hitting the API do not multiply upstream calls.

import { cached } from "@/lib/server/cache";
import { applyQuery, mergePoints } from "@/lib/series/store";
import type { Provenance } from "@/lib/provenance/types";
import type { Point, Series, SeriesMeta, SeriesQuery, SeriesStore } from "@/lib/series/types";
import { evaluate, statusRank, type Evaluation } from "./evaluate";
import { INDICATORS, indicatorById } from "./registry";
import { ttlForCadence } from "./readers";
import { indicatorMeta, indicatorSeriesId, type Indicator, type IndicatorCategory, type IndicatorMeta } from "./types";

export interface IndicatorResult {
  meta: IndicatorMeta;
  evaluation: Evaluation;
  /** Provenance of the series the evaluation used; absent when the fetch failed. */
  provenance?: Provenance;
  /** Set when the fetch failed; the evaluation is then "no data". */
  error?: string;
  /** Age of the cached series in ms (0 when just fetched). */
  cacheAge?: number;
}

export interface GetIndicatorsOptions {
  /** Restrict to these ids (unknown ids are skipped; validate them at the route). */
  ids?: string[];
  category?: IndicatorCategory;
  /** Append the latest point to `indicator:<id>` so history accrues without the cron. */
  store?: SeriesStore;
  /** Alternative registry, for tests and for embedding. */
  registry?: readonly Indicator[];
  now?: number;
  /** Bypass the process cache (tests). */
  noCache?: boolean;
}

/** Fetch one indicator's series through the cache. */
export async function fetchIndicatorSeries(ind: Indicator, now: number, noCache = false): Promise<{ series: Series; age: number }> {
  const produce = () => ind.fetch({ now, indicator: ind });
  if (noCache) return { series: await produce(), age: 0 };
  const c = await cached(`indicator:series:${ind.id}`, ttlForCadence(ind.cadence), produce);
  return { series: c.value, age: c.age };
}

/** Choose the indicators an options object asks for, in registry order. */
export function selectIndicators(opts: Pick<GetIndicatorsOptions, "ids" | "category" | "registry">): Indicator[] {
  const registry = opts.registry ?? INDICATORS;
  let list = [...registry];
  if (opts.ids) {
    const want = new Set(opts.ids);
    list = list.filter((i) => want.has(i.id));
  }
  if (opts.category) list = list.filter((i) => i.category === opts.category);
  return list;
}

/**
 * Evaluate a set of indicators. Failures are per indicator; the returned
 * list always has one entry per requested indicator, worst status first
 * within registry order preserved by a stable sort.
 */
export async function getIndicators(opts: GetIndicatorsOptions = {}): Promise<{ items: IndicatorResult[]; generatedAt: string }> {
  const now = opts.now ?? Date.now();
  const list = selectIndicators(opts);
  const settled = await Promise.allSettled(
    list.map(async (ind): Promise<IndicatorResult> => {
      const { series, age } = await fetchIndicatorSeries(ind, now, opts.noCache);
      const evaluation = evaluate(ind, series);
      if (opts.store && evaluation.latestAt) {
        // Recording only the latest point keeps the store small; the cron and
        // the merge in getIndicatorHistory() fill the rest.
        const t = Date.parse(evaluation.latestAt);
        const meta: SeriesMeta & { points?: Point[] } = { ...series };
        delete meta.points;
        await opts.store.append(meta, [{ t, v: evaluation.latest }]).catch(() => undefined);
      }
      return { meta: indicatorMeta(ind), evaluation, provenance: series.provenance, cacheAge: age };
    }),
  );
  const items = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const ind = list[i];
    return {
      meta: indicatorMeta(ind),
      evaluation: evaluate(ind, { points: [] }),
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
  return { items, generatedAt: new Date(now).toISOString() };
}

/** Stable worst-first ordering used by the panel and the CSV export. */
export function sortByStatus(items: IndicatorResult[]): IndicatorResult[] {
  return items.map((it, i) => ({ it, i })).sort((a, b) => statusRank(b.it.evaluation.status) - statusRank(a.it.evaluation.status) || a.i - b.i).map((x) => x.it);
}

export interface HistoryOptions extends SeriesQuery {
  store?: SeriesStore;
  registry?: readonly Indicator[];
  now?: number;
  noCache?: boolean;
}

/**
 * History for one indicator: the live upstream series merged with whatever
 * the store has recorded (the store may hold snapshots older than the
 * upstream window), then filtered by the query. Null for an unknown id.
 */
export async function getIndicatorHistory(id: string, opts: HistoryOptions = {}): Promise<Series | null> {
  const ind = indicatorById(id, opts.registry);
  if (!ind) return null;
  const now = opts.now ?? Date.now();
  const [live, stored] = await Promise.all([
    fetchIndicatorSeries(ind, now, opts.noCache).then((r) => r.series).catch(() => null),
    opts.store ? opts.store.get(indicatorSeriesId(id)).catch(() => null) : Promise.resolve(null),
  ]);
  if (!live && !stored) return null;
  const base = live ?? (stored as Series);
  const points = mergePoints(stored?.points ?? [], live?.points ?? []);
  return { ...base, points: applyQuery(points, { from: opts.from, to: opts.to, limit: opts.limit }) };
}
