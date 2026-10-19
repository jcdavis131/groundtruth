// Cohort percentile tables: what puts "12th of 254 Texas counties" next to a
// number without re-sorting the nation on every request, and without walking
// into the filtered-set trap.
//
// The trap is real: screen(features, { where: [{ field: "geoid", op: "==",
// value: "48453" }] }, { percentiles: true }) computes its statistics over the
// MATCHED set, and a set of one scores 100 on every numeric field. The correct
// call — screen with an empty where, then find your row — recomputes ~3,143
// rows x 23 getters plus a sort per metric on every render, because nothing
// below the raw feature array is memoised.
//
// So the core here is a pure table built ONCE per cohort and cached: three
// Float64Array columns per metric (value, percentile, rank) plus one
// id -> index Map, with the per-entity Record materialised lazily on lookup.
// Float64 and not Float32 because jobs.wages is total quarterly wages in the
// billions and a 24-bit mantissa starts rounding above ~16.7M — which would
// corrupt exactly the largest counties, the ones most likely to be read.
//
// The input is Map<entityId, Record<metric, number | null>> on purpose: NOT
// LayerFeature[] and NOT EntityKind. lib/screener/fields.ts has no metro kind,
// and adding one would force a new field registry plus a docs/SCREENER.md
// regeneration that lib/screener/docs.test.ts byte-diffs. Counties and states
// feed this from the screener's own rows; metros feed it from a small
// extractor over the Zillow metro files and the bundled OEWS index.

import { cached, cacheDelete } from "@/lib/server/cache";
import type { SourceId } from "@/lib/provenance/sources";
import { percentileRanks, summarize, toRows, type FieldStats } from "@/lib/screener/engine";
import { fieldsFor, type EntityKind } from "@/lib/screener/fields";
import { entitySet } from "@/lib/screener/sets";
import { oewsMsaIndex, zillow } from "@/lib/economy/sources";
import { allCbsa, countiesInMetro, metroByCbsa, stateByFips, stateByUsps } from "./registry";

/** Which population a value is ranked against. */
export type Cohort =
  | { kind: "national"; of: "county" | "state" | "metro" }
  | { kind: "state"; usps: string }
  | { kind: "metro"; cbsa: string };

export interface PeerStat {
  value: number | null;
  pct: number | null;
  rank: number | null;
  /** Entities that PUBLISHED this metric this period — never a hard-coded universe size. */
  n: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  cohortKey: string;
  cohortLabel: string;
  /** Why pct and rank are null, in words, whenever they are. */
  reason?: string;
}

export type MetricVectors = Map<string, Record<string, number | null>>;

export interface CohortTable {
  ok: boolean;
  cohortKey: string;
  cohortLabel: string;
  assembledAt: string;
  metrics: string[];
  byId: Map<string, Record<string, PeerStat>>;
  reason?: string;
}

/** Below this many published values a rank is noise, so none is printed. */
export const PEER_MIN_N = 5;

const HOUR = 3600_000;

/** A cohort whose entity table came back this short is a degraded upstream, not an answer. */
const MIN_ENTITIES: Record<"county" | "state" | "metro", number> = { county: 50, state: 20, metro: 20 };

const NOT_PUBLISHED = "not published this period";

// ---------------------------------------------------------------- pure core

interface Column {
  value: Float64Array;
  pct: Float64Array;
  rank: Float64Array;
  stats: FieldStats | null;
}

const nul = (v: number) => (Number.isFinite(v) ? v : null);

/** One metric's three vectors. Rank counts strictly-greater values, so ties share the smallest rank. */
function column(raw: Array<number | null>): Column {
  const n = raw.length;
  const value = new Float64Array(n);
  const pct = new Float64Array(n);
  const rank = new Float64Array(n);
  const ranks = percentileRanks(raw);
  for (let i = 0; i < n; i++) {
    value[i] = raw[i] ?? NaN;
    pct[i] = ranks[i] ?? NaN;
    rank[i] = NaN;
  }
  const present: number[] = [];
  for (let i = 0; i < n; i++) if (raw[i] != null) present.push(i);
  present.sort((a, b) => (raw[b] as number) - (raw[a] as number));
  let i = 0;
  while (i < present.length) {
    let j = i;
    while (j + 1 < present.length && raw[present[j + 1]] === raw[present[i]]) j++;
    // rank is 1 + the count of strictly greater values: every member of a tie
    // takes the smallest rank the tie spans. Deriving it from pct instead
    // would be inexact under ties and would call a lone value first of one.
    for (let k = i; k <= j; k++) rank[present[k]] = i + 1;
    i = j + 1;
  }
  return { value, pct, rank, stats: summarize(raw) };
}

function statAt(col: Column | undefined, i: number, key: string, label: string): PeerStat {
  const stats = col?.stats ?? null;
  const n = stats?.n ?? 0;
  const enough = n >= PEER_MIN_N;
  const value = col && i >= 0 ? nul(col.value[i]) : null;
  const dist = enough && stats
    ? { min: stats.min, p25: stats.p25, median: stats.median, p75: stats.p75, max: stats.max }
    : { min: null, p25: null, median: null, p75: null, max: null };
  let reason: string | undefined;
  if (value == null) reason = NOT_PUBLISHED;
  else if (!enough) reason = `only ${n} of ${label} published this metric; fewer than ${PEER_MIN_N} is too few to rank`;
  const rankable = value != null && enough;
  return {
    value,
    pct: rankable ? nul(col!.pct[i]) : null,
    rank: rankable ? nul(col!.rank[i]) : null,
    n,
    ...dist,
    cohortKey: key,
    cohortLabel: label,
    ...(reason ? { reason } : {}),
  };
}

/**
 * A Map whose rows are computed on lookup. The table keeps three typed arrays
 * per metric; materialising 3,143 x 16 PeerStat objects up front to satisfy
 * the Map type would throw away the reason the arrays exist.
 */
class LazyPeerIndex extends Map<string, Record<string, PeerStat>> {
  constructor(
    private readonly index: Map<string, number>,
    private readonly cols: Map<string, Column>,
    private readonly key: string,
    private readonly label: string,
  ) {
    super();
  }

  override get(id: string): Record<string, PeerStat> | undefined {
    const done = super.get(id);
    if (done) return done;
    const i = this.index.get(id);
    if (i == null) return undefined;
    const row: Record<string, PeerStat> = {};
    for (const [metric, col] of this.cols) row[metric] = statAt(col, i, this.key, this.label);
    super.set(id, row);
    return row;
  }

  override has(id: string): boolean {
    return this.index.has(id);
  }

  override get size(): number {
    return this.index.size;
  }

  override keys(): MapIterator<string> {
    return this.index.keys();
  }

  override *values(): MapIterator<Record<string, PeerStat>> {
    for (const id of this.index.keys()) yield this.get(id)!;
  }

  override *entries(): MapIterator<[string, Record<string, PeerStat>]> {
    for (const id of this.index.keys()) yield [id, this.get(id)!];
  }

  override [Symbol.iterator](): MapIterator<[string, Record<string, PeerStat>]> {
    return this.entries();
  }

  override forEach(fn: (v: Record<string, PeerStat>, k: string, map: Map<string, Record<string, PeerStat>>) => void, thisArg?: unknown): void {
    for (const id of this.index.keys()) fn.call(thisArg, this.get(id)!, id, this);
  }
}

/**
 * Build one cohort's table. Pure: no clock, no network — `assembledAt` is the
 * caller's, so the same vectors always produce the same table.
 */
export function cohortTable(
  rows: MetricVectors,
  metrics: string[],
  cohortKey: string,
  cohortLabel: string,
  assembledAt: string,
): CohortTable {
  const ids = [...rows.keys()];
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const cols = new Map<string, Column>();
  for (const metric of metrics) {
    const raw: Array<number | null> = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const v = rows.get(ids[i])![metric];
      raw[i] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    cols.set(metric, column(raw));
  }
  return {
    ok: true,
    cohortKey,
    cohortLabel,
    assembledAt,
    metrics: [...metrics],
    byId: new LazyPeerIndex(index, cols, cohortKey, cohortLabel),
  };
}

function unavailable(cohortKey: string, cohortLabel: string, assembledAt: string, reason: string): CohortTable {
  return { ok: false, cohortKey, cohortLabel, assembledAt, metrics: [], byId: new Map(), reason };
}

/** The standing footnote every printed percentile carries. */
export function percentileBasisNote(): string {
  return (
    "A percentile here is a min-max scaling of average rank: the smallest published value in the cohort is 0 " +
    "and the largest is 100, and tied values share the average of the ranks they span. It is not the share of " +
    "entities below the value, so 0 means smallest, not none below. Entities that did not publish the metric " +
    "are outside the cohort entirely and are counted in neither the rank nor its denominator."
  );
}

// ---------------------------------------------------------------- cohort sources

/** The 16 numeric fields of a screener kind; the 7 string fields cannot be ranked. */
function numericMetrics(kind: EntityKind): string[] {
  return fieldsFor(kind).filter((f) => f.kind !== "string").map((f) => f.key);
}

/** Zillow metro files plus the bundled OEWS employment total: what a metro can be ranked on. */
export const METRO_METRICS = ["home.latest", "home.yoyPct", "home.y5Pct", "rent.latest", "rent.yoyPct", "priceToRent", "emp"];

function metricsFor(scope: "county" | "state" | "metro"): string[] {
  return scope === "metro" ? [...METRO_METRICS] : numericMetrics(scope);
}

interface Universe {
  vectors: MetricVectors;
  assembledAt: string;
  failed: SourceId[];
  /** Entities the upstream produced at all, before any cohort filter. */
  produced: number;
}

/**
 * Counties or states straight off the screener's own entity set, which is
 * already cached under screen:entities:<kind> — so rank context costs no
 * additional network. Keys are the bare geoid ("48453") and the two-letter
 * USPS code, because cohort filters slice a state prefix off the former.
 */
async function areaUniverse(kind: "county" | "state"): Promise<Universe> {
  const set = await entitySet(kind);
  const vectors: MetricVectors = new Map();
  const metrics = numericMetrics(kind);
  for (const row of toRows(set.features, kind, fieldsFor(kind))) {
    const bare = row.id.slice(row.id.indexOf(":") + 1);
    const id = kind === "county" ? bare : (stateByFips(bare)?.usps ?? (typeof row.values.state === "string" ? row.values.state : bare));
    const rec: Record<string, number | null> = {};
    for (const m of metrics) {
      const v = row.values[m];
      rec[m] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    vectors.set(id, rec);
  }
  return { vectors, assembledAt: set.assembledAt, failed: set.failed, produced: set.features.length };
}

/**
 * Metros, joined by the manifest's Zillow RegionID rather than by name: the
 * metro ZHVI file titles metros short ("Austin, TX") and the county file long,
 * and the manifest already records which match produced the id. Employment is
 * the bundled OEWS index, so it ranks even with no egress.
 */
async function metroUniverse(): Promise<Universe> {
  const [zhvi, zori] = await Promise.all([
    zillow("zhviMetro").catch(() => null),
    zillow("zoriMetro").catch(() => null),
  ]);
  const failed: SourceId[] = [];
  if (!zhvi) failed.push("zillow-zhvi");
  if (!zori) failed.push("zillow-zori");
  const emp = new Map<string, number | null>(oewsMsaIndex().msas.map((m) => [m.id, m.emp]));
  const vectors: MetricVectors = new Map();
  for (const cbsa of allCbsa()) {
    const ref = metroByCbsa(cbsa);
    if (!ref) continue;
    const rid = ref.zillowRegionId;
    const h = rid ? zhvi?.rows.get(rid) : undefined;
    const r = rid ? zori?.rows.get(rid) : undefined;
    vectors.set(cbsa, {
      "home.latest": h?.latest ?? null,
      "home.yoyPct": h?.yoyPct ?? null,
      "home.y5Pct": h?.y5Pct ?? null,
      "rent.latest": r?.latest ?? null,
      "rent.yoyPct": r?.yoyPct ?? null,
      priceToRent: h && r && r.latest > 0 ? h.latest / (r.latest * 12) : null,
      emp: emp.get(cbsa) ?? null,
    });
  }
  return { vectors, assembledAt: new Date().toISOString(), failed, produced: vectors.size };
}

// ---------------------------------------------------------------- cohort resolution

interface Spec {
  key: string;
  label: string;
  /** Set when the cohort cannot be offered at all; nothing is fetched or cached. */
  refusal?: string;
  keep?: (id: string) => boolean;
}

const metroShort = (name: string) => name.split(",")[0];

/** Cohort key, human label, and the filter over the universe — or why there is no cohort. */
function specFor(scope: "county" | "state" | "metro", c: Cohort): Spec {
  const plural = scope === "county" ? "counties" : scope === "state" ? "states" : "metro areas";
  if (c.kind === "national") {
    if (c.of !== scope) return { key: `${scope}:us`, label: `US ${plural}`, refusal: `a ${scope} cannot be ranked against US ${c.of === "county" ? "counties" : c.of === "state" ? "states" : "metro areas"}` };
    return { key: `${scope}:us`, label: `US ${plural}` };
  }
  if (c.kind === "state") {
    const st = stateByUsps(c.usps);
    const key = `${scope}:state:${c.usps.toUpperCase()}`;
    if (!st) return { key, label: `${c.usps.toUpperCase()} ${plural}`, refusal: `${c.usps} is not a known state` };
    const label = `${st.name} ${plural}`;
    if (scope === "county") return { key, label, keep: (id) => id.slice(0, 2) === st.fips };
    if (scope === "metro") return { key, label, keep: (id) => metroByCbsa(id)?.states.includes(st.usps) ?? false };
    return { key, label, refusal: "a state is only ranked nationally" };
  }
  const key = `${scope}:metro:${c.cbsa}`;
  const ref = metroByCbsa(c.cbsa);
  const label = ref ? `counties in the ${metroShort(ref.name)} metro` : `counties in CBSA ${c.cbsa}`;
  if (scope !== "county") return { key, label, refusal: `a ${scope} is not ranked inside a metro` };
  if (!ref) return { key, label, refusal: `CBSA ${c.cbsa} is not in the place manifest` };
  const members = new Set(countiesInMetro(c.cbsa).map((x) => x.geoid));
  if (members.size < PEER_MIN_N) {
    return { key, label, refusal: `the manifest lists ${members.size} counties in the ${metroShort(ref.name)} metro; fewer than ${PEER_MIN_N} is too few to rank` };
  }
  return { key, label, keep: (id) => members.has(id) };
}

async function buildTable(scope: "county" | "state" | "metro", spec: Spec): Promise<CohortTable> {
  const u = scope === "metro" ? await metroUniverse() : await areaUniverse(scope);
  // entitySet does NOT throw when an upstream fails — it resolves with
  // features:[] and a populated `failed`. Guarding on truthiness would cache
  // an outage for an hour, so the count is what decides.
  if (u.produced < MIN_ENTITIES[scope]) {
    const why = u.failed.length ? `${u.failed.join(", ")} did not answer` : "the upstream table came back empty";
    return unavailable(spec.key, spec.label, u.assembledAt, `Rank context is unavailable: ${why}, so only ${u.produced} ${scope === "county" ? "counties" : scope === "state" ? "states" : "metro areas"} carried a value.`);
  }
  let rows = u.vectors;
  if (spec.keep) {
    const filtered: MetricVectors = new Map();
    for (const [id, rec] of u.vectors) if (spec.keep(id)) filtered.set(id, rec);
    rows = filtered;
  }
  if (rows.size < PEER_MIN_N) {
    return unavailable(spec.key, spec.label, u.assembledAt, `Rank context is unavailable: ${rows.size} of ${spec.label} are in the table, fewer than the ${PEER_MIN_N} a rank needs.`);
  }
  return cohortTable(rows, metricsFor(scope), spec.key, spec.label, u.assembledAt);
}

/**
 * One cohort's table, memoised for an hour under places:pct:<cohortKey>. An
 * unavailable table is dropped from the cache immediately so the next request
 * retries the upstream rather than inheriting the outage.
 */
async function tableFor(scope: "county" | "state" | "metro", c: Cohort): Promise<CohortTable> {
  const spec = specFor(scope, c);
  const assembledAt = new Date().toISOString();
  if (spec.refusal) return unavailable(spec.key, spec.label, assembledAt, `Rank context is unavailable: ${spec.refusal}.`);
  const key = `places:pct:${spec.key}`;
  // buildTable reaches TIGERweb and the screener cohorts, so it can reject
  // outright — a blocked host, a 403, a socket that never opens — not just
  // return a table it could not fill. A rejection here used to escape every
  // caller and 500 the page, which is the one outcome the contract above
  // forbids. Catching it turns "the cohort did not answer" into the same
  // unranked-with-a-reason table that a half-built cohort produces, and drops
  // the cache entry so the next request retries instead of serving the outage
  // for an hour.
  let table: CohortTable;
  try {
    const c2 = await cached(key, HOUR, () => buildTable(scope, spec));
    table = c2.value;
  } catch (e) {
    cacheDelete(key);
    // The reason is printed beside every ranked figure on the page — twenty
    // times on a county — so it says what it means for the reader and stops.
    // The upstream's own words go to the log, once: they are often a URL, a
    // status line, or an instruction addressed to whoever runs the host, none
    // of which belong in a sentence a reader is asked to make sense of.
    console.warn(`[percentiles] cohort ${spec.key} unavailable:`, e instanceof Error ? e.message : e);
    return unavailable(spec.key, spec.label, assembledAt, "the table this is ranked against could not be built for this request");
  }
  if (!table.ok) cacheDelete(key);
  return table;
}

/**
 * Every metric of one entity against every cohort asked for, in cohort order.
 * A cohort that cannot be built still yields a PeerStat per metric carrying
 * its reason, so a page prints the value and says why there is no rank beside
 * it — never a blank, never a missing row.
 */
export async function peerStats(
  scope: "county" | "state" | "metro",
  id: string,
  cohorts: Cohort[],
): Promise<Record<string, PeerStat[]>> {
  const metrics = metricsFor(scope);
  const tables = await Promise.all(cohorts.map((c) => tableFor(scope, c)));
  const out: Record<string, PeerStat[]> = {};
  for (const m of metrics) out[m] = [];
  for (const t of tables) {
    const row = t.ok ? t.byId.get(id) : undefined;
    for (const m of metrics) {
      out[m].push(
        row?.[m] ?? {
          value: null,
          pct: null,
          rank: null,
          n: 0,
          min: null,
          p25: null,
          median: null,
          p75: null,
          max: null,
          cohortKey: t.cohortKey,
          cohortLabel: t.cohortLabel,
          reason: t.reason ?? NOT_PUBLISHED,
        },
      );
    }
  }
  return out;
}
