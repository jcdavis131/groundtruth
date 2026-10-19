// The one loader every place route calls.
//
// generateMetadata and the page body are rendered concurrently by Next, and
// both need the same numbers. Each fetched section therefore goes through
// cached(), whose inflight map collapses the two callers onto one producer:
// a place page costs one pull, not two. That same map is what makes the
// per-section TTL honest — a hit older than the TTL can only have come from
// cached()'s stale-on-error path, which is exactly the "stale" SectionState.
//
// placeFacts NEVER throws for an upstream failure. The only 404 decision on a
// place URL is made offline, by lib/places/scope.ts, against the bundled
// manifest and before any network call; everything after that degrades to a
// section that says "unavailable" and why. A blank section, a missing section
// or a 500 would all be failures of the contract, so every branch is raced
// against a budget and every rejection becomes a reason in words.
//
// placeFactsShell is the Tier A subset: synchronous, zero network, built from
// the manifest plus the bundled OEWS tables. It is what an egress-free build
// and a total outage render, and it is a real page — identity, member
// counties, occupation mix — not a spinner.
//
// Ethics: places and institutions only. Nothing here reads a parcel, an
// address, an owner, an officer or an insider.

import { cached } from "@/lib/server/cache";
import { citationsOf, dedupeProvenance, iso } from "@/lib/provenance/collect";
import type { Provenance } from "@/lib/provenance/types";
import { estimateProvenance, oewsProvenance, qcewProvenance, zillowProvenance, type ZillowFile } from "@/lib/economy/provenance";
import { marketReportForCounty, marketReportForState } from "@/lib/economy/assemble";
import type { MarketReport } from "@/lib/economy/report";
import type { AreaExtra, HomeValue, MsaJobs } from "@/lib/economy/features";
import { OEWS_AS_OF, oewsMsaIndex, oewsMsaJobs } from "@/lib/economy/oews";
import { qcewLatest, zillow } from "@/lib/economy/sources";
import { waterReportAt } from "@/lib/water/assemble";
import type { WaterReport } from "@/lib/water/report";
import { REPORT_RADII_KM } from "@/lib/water/report";
import { financeFor } from "@/lib/finance/assemble";
import type { FinanceSection } from "@/lib/finance/report";
import type { SpendingDetail } from "@/lib/finance/types";
import { BUNDLE_CAVEATS, companiesSection, type CompaniesSection } from "@/lib/companies/section";
import { getIndicators, type IndicatorResult } from "@/lib/indicators/service";
import type { IndicatorCategory } from "@/lib/indicators/types";
import { upcomingReleases } from "@/lib/releases/calendar";
import { describeVintages } from "@/lib/releases/vintage";
import { prevMonth } from "@/lib/releases/movers";
import { entitySet, featureFor } from "@/lib/screener/sets";
import { fieldsFor, type EntityKind, type FieldDef } from "@/lib/screener/fields";
import type { LayerFeature } from "@/lib/layers/types";
import { peerStats, type Cohort, type PeerStat } from "./percentiles";
import { MANIFEST, countiesInMetro, metroByCbsa, metroForCounty, metrosInState, type MetroRef } from "./registry";
import { scopeCentroid, scopeName, scopeShortName, type PlaceScope } from "./scope";

/** How long any one upstream may hold up a section before it becomes a reason. */
export const PLACE_BUDGET_MS = 8000;

/** Section memo window. A hit older than this can only be cached()'s stale-on-error path. */
export const PLACE_SECTION_TTL_MS = 3600_000;

/** Why the release calendar is consulted at all: what a reader can expect next. */
const RELEASE_HORIZON_MS = 30 * 24 * 3600_000;

/** How many member counties a state page names. */
const STATE_MEMBER_LIMIT = 12;

export type SectionStatus = "fresh" | "stale" | "unavailable" | "not-applicable";

export interface SectionState {
  status: SectionStatus;
  /** The release the section describes, when it names one. */
  asOf: string | null;
  retrievedAt: string;
  /** Always present unless the section is fresh: why it is not. */
  reason?: string;
}

/** The 12 largest counties of a state, and the metros inside it — identity only. */
export interface PlaceMembers {
  counties: Array<{ id: string; name: string; jobs: number | null }>;
  metros: Array<{ id: string; name: string }>;
}

/** Zillow's own metro rows, joined by the manifest's RegionID rather than by name. */
export interface MetroHousing {
  home: HomeValue | null;
  rent: HomeValue | null;
  /** How the manifest resolved this metro's Zillow RegionID; 'short' means matched by name, 'counties' by identical member counties. */
  matchedBy: MetroRef["zillowMatchedBy"];
  state: SectionState;
}

export interface PlaceFacts {
  scope: PlaceScope;
  name: string;
  shortName: string;
  generatedAt: string;
  retrievedAt: string;
  lon: number | null;
  lat: number | null;
  market: { report: MarketReport | null; state: SectionState };
  water: { report: WaterReport | null; state: SectionState };
  finance: { section: FinanceSection | null; state: SectionState };
  spending: { detail: SpendingDetail | null; state: SectionState };
  companies: { section: CompaniesSection | null; state: SectionState };
  occupations: { jobs: MsaJobs | null; asOf: string; state: SectionState };
  /** Metro only: the county-rollup employment estimate with its arithmetic printed. */
  rollup: { jobs: number | null; counties: number; suppressed: string[]; formula: string[] } | null;
  /** Metro only: Zillow's metro ZHVI and ZORI rows. */
  housing: MetroHousing | null;
  /** State only: the largest member counties and the metros inside it. */
  members: PlaceMembers | null;
  values: Record<string, number | null>;
  previous: Record<string, number | null>;
  periods: { current: Record<string, string>; previous: Record<string, string> };
  suppressed: string[];
  skipped: string[];
  peers: Record<string, PeerStat[]>;
  indicators: { items: IndicatorResult[]; state: SectionState };
  releases: Array<{ title: string; earliest: string; latest: string; precision: "official" | "approximate" }>;
  metricProvenance: Record<string, Provenance[]>;
  provenance: Provenance[];
  citations: string[];
  caveats: string[];
}

export interface PlaceFactsOptions {
  now: number;
  retrievedAt?: string;
  /** Narrows the national indicator context to one lens category; the set is national either way. */
  indicatorCategory?: IndicatorCategory;
}

// ---------------------------------------------------------------- wording

const NOT_FETCHED = "not fetched";

const WATER_DISC = `Water rows are everything within ${REPORT_RADII_KM.gauges} km of this place's internal point (${REPORT_RADII_KM.reservoirs} km for reservoirs), not everything inside its boundary: lib/water searches discs, and every row prints its own distance.`;

const NATIONAL_INDICATORS =
  "The indicator block is the NATIONAL set, filtered only by lens. None of these series is keyed to this place: they are United States, gauge, single-state or port series and they are shown as context, not as this place's own readings.";

const NO_METRO_MARKET =
  "There is no metro market report: MarketReport describes a county or a state, and BLS QCEW's own metro rows follow each year's delineation, so they are not used here. The metro page shows Zillow's own metro rows and a county-rollup employment estimate with its arithmetic instead.";

const NO_STATE_WATER =
  "A 75 km disc around a state's centroid is not a state water report, so the water section is omitted at state scale rather than presented as one.";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function na(reason: string, retrievedAt: string): SectionState {
  return { status: "not-applicable", asOf: null, retrievedAt, reason };
}

function unavailable(reason: string, retrievedAt: string): SectionState {
  return { status: "unavailable", asOf: null, retrievedAt, reason };
}

// ---------------------------------------------------------------- fetch plumbing

/** Race a producer against the budget. The loser's rejection is absorbed by the race. */
function budgeted<T>(p: Promise<T>, label: string, ms = PLACE_BUDGET_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms} ms`)), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  return Promise.race([p, clock]).finally(() => clearTimeout(timer));
}

interface Branch<T> {
  value: T | null;
  state: SectionState;
}

/**
 * One memoised, budgeted section. A cache hit older than the TTL is cached()'s
 * stale-on-error path and is reported as "stale" with the age in words; a
 * rejection with nothing cached is "unavailable" with the error in words.
 */
async function branch<T>(key: string, label: string, now: number, run: () => Promise<T>): Promise<Branch<T>> {
  try {
    const c = await cached(key, PLACE_SECTION_TTL_MS, () => budgeted(run(), label));
    const stale = c.hit && c.age > PLACE_SECTION_TTL_MS;
    return {
      value: c.value,
      state: {
        status: stale ? "stale" : "fresh",
        asOf: null,
        retrievedAt: iso(now - c.age),
        ...(stale ? { reason: `${label} did not answer, so this is the copy cached ${Math.max(1, Math.round(c.age / 60_000))} minutes ago.` } : {}),
      },
    };
  } catch (err) {
    return { value: null, state: unavailable(`${label} is unavailable: ${message(err)}`, iso(now)) };
  }
}

// ---------------------------------------------------------------- values

/** A month key ("2026-07") from a Zillow month-end column ("2026-07-31"). */
function ym(s: string): string {
  return s.slice(0, 7);
}

function extraOf(f: LayerFeature): AreaExtra {
  return f.properties.extra as AreaExtra;
}

/** The newest month column in the file, taken as the newest any row in the set reports. */
function fileMonth(features: LayerFeature[], pick: (e: AreaExtra) => HomeValue | undefined): string | null {
  let best: string | null = null;
  for (const f of features) {
    const row = pick(extraOf(f));
    if (!row?.asOf) continue;
    const key = ym(row.asOf);
    if (!best || key > best) best = key;
  }
  return best;
}

interface Mom {
  /** Month-over-month percent change, null when the row is not comparable. */
  pct: number | null;
  before: number | null;
  previousPeriod: string | null;
  /** True when the row exists but its newest two columns are not the file's newest two. */
  skipped: boolean;
}

/**
 * Month-over-month from a Zillow row's own 25-month array, guarded exactly the
 * way zillowMovers guards it: both months must be the file's newest two
 * columns. A region that stopped reporting early is NOT compared against an
 * older month — it is surfaced as skipped.
 */
function momOf(row: HomeValue | undefined, file: string | null): Mom {
  if (!row || !file) return { pct: null, before: null, previousPeriod: null, skipped: false };
  const m = row.monthly ?? [];
  const last = m[m.length - 1];
  const prev = m[m.length - 2];
  const want = prevMonth(file);
  if (!last || !prev || ym(last[0]) !== file || ym(prev[0]) !== want) return { pct: null, before: null, previousPeriod: null, skipped: true };
  if (!Number.isFinite(prev[1]) || prev[1] === 0) return { pct: null, before: null, previousPeriod: null, skipped: true };
  return { pct: ((last[1] - prev[1]) / Math.abs(prev[1])) * 100, before: prev[1], previousPeriod: want, skipped: false };
}

/** Which Zillow file a metric of this scope came out of, for provenance. */
function zillowFileFor(kind: "county" | "state" | "metro", rent: boolean): ZillowFile | null {
  if (kind === "metro") return rent ? "zoriMetro" : "zhviMetro";
  if (kind === "county") return rent ? "zoriCounty" : "zhviCounty";
  return rent ? null : "zhviState";
}

/** Provenance for one screener field of one entity, from the field registry's own source id. */
function fieldProvenance(kind: "county" | "state", field: FieldDef, extra: AreaExtra, id: string, at: string): Provenance[] {
  if (field.kind === "estimate") return [estimateProvenance(field.source, field.method ?? field.label, at)];
  if (field.source === "zillow-zhvi") {
    const file = zillowFileFor(kind, false);
    return file ? [zillowProvenance(file, extra.home?.asOf, at)] : [];
  }
  if (field.source === "zillow-zori") {
    const file = zillowFileFor(kind, true);
    return file ? [zillowProvenance(file, extra.rent?.asOf, at)] : [];
  }
  if (field.source === "bls-qcew") return [qcewProvenance(extra.jobs?.period, at, { area: id })];
  return [];
}

const MOM_METHOD = "month-over-month percent change = (newest month − previous month) / |previous month| × 100, from Zillow's own published month columns";

interface ValueBundle {
  values: Record<string, number | null>;
  previous: Record<string, number | null>;
  periods: { current: Record<string, string>; previous: Record<string, string> };
  suppressed: string[];
  skipped: string[];
  metricProvenance: Record<string, Provenance[]>;
}

function emptyValues(): ValueBundle {
  return { values: {}, previous: {}, periods: { current: {}, previous: {} }, suppressed: [], skipped: [], metricProvenance: {} };
}

/**
 * The screener's own numeric fields for one county or state, read off the
 * cached entity set. The 7 string fields of the registry are filtered out:
 * FieldDef.get returns number | string | null and values is number | null, so
 * a name or a GEOID must never be assigned into it.
 */
function areaValues(kind: "county" | "state", id: string, feature: LayerFeature | undefined, features: LayerFeature[], at: string): ValueBundle {
  const out = emptyValues();
  if (!feature) return out;
  const extra = extraOf(feature);
  const homeMonth = extra.home?.asOf ? ym(extra.home.asOf) : null;
  const rentMonth = extra.rent?.asOf ? ym(extra.rent.asOf) : null;

  for (const field of fieldsFor(kind as EntityKind)) {
    if (field.kind === "string") continue;
    let raw: number | string | null = null;
    try {
      raw = field.get(feature);
    } catch {
      raw = null;
    }
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    out.values[field.key] = v;
    const period = field.key.startsWith("jobs.") ? (extra.jobs?.period ?? null) : field.key.startsWith("rent.") ? rentMonth : homeMonth;
    if (period) out.periods.current[field.key] = period;
    if (v != null) out.metricProvenance[field.key] = fieldProvenance(kind, field, extra, id, at);
  }

  // The two month-over-month keys the brief is built on. They are derived, so
  // they carry an estimate provenance naming the arithmetic, not a file.
  const homeFile = fileMonth(features, (e) => e.home);
  const rentFile = fileMonth(features, (e) => e.rent);
  const pairs: Array<{ key: string; base: string; row: HomeValue | undefined; file: string | null; src: "zillow-zhvi" | "zillow-zori" }> = [
    { key: "home.momPct", base: "home.latest", row: extra.home, file: homeFile, src: "zillow-zhvi" },
    { key: "rent.momPct", base: "rent.latest", row: extra.rent, file: rentFile, src: "zillow-zori" },
  ];
  for (const p of pairs) {
    const mom = momOf(p.row, p.file);
    out.values[p.key] = mom.pct;
    if (mom.skipped) {
      out.skipped.push(p.base, p.key);
      continue;
    }
    if (mom.pct == null) continue;
    if (p.file) out.periods.current[p.key] = p.file;
    if (mom.previousPeriod) {
      out.periods.previous[p.key] = mom.previousPeriod;
      out.periods.previous[p.base] = mom.previousPeriod;
    }
    out.previous[p.base] = mom.before;
    out.metricProvenance[p.key] = [estimateProvenance(p.src, MOM_METHOD, at)];
  }

  if (extra.jobs?.suppressed) {
    for (const key of Object.keys(out.values)) if (key.startsWith("jobs.")) out.suppressed.push(key);
  }
  return out;
}

/**
 * A metro's rankable numbers: Zillow's metro rows joined by the manifest's
 * RegionID, plus the bundled OEWS employment total. Same metric keys the metro
 * cohort ranks on, so a value and its rank always line up.
 */
function metroValues(cbsa: string, home: HomeValue | null, rent: HomeValue | null, homeFile: string | null, rentFile: string | null, emp: number | null, at: string): ValueBundle {
  const out = emptyValues();
  const homeMonth = home?.asOf ? ym(home.asOf) : null;
  const rentMonth = rent?.asOf ? ym(rent.asOf) : null;
  const put = (key: string, v: number | null, period: string | null, prov: Provenance[]) => {
    out.values[key] = v;
    if (period) out.periods.current[key] = period;
    if (v != null && prov.length) out.metricProvenance[key] = prov;
  };
  const zhvi = () => [zillowProvenance("zhviMetro", home?.asOf, at)];
  const zori = () => [zillowProvenance("zoriMetro", rent?.asOf, at)];
  put("home.latest", home?.latest ?? null, homeMonth, zhvi());
  put("home.yoyPct", home?.yoyPct ?? null, homeMonth, zhvi());
  put("home.y5Pct", home?.y5Pct ?? null, homeMonth, zhvi());
  put("rent.latest", rent?.latest ?? null, rentMonth, zori());
  put("rent.yoyPct", rent?.yoyPct ?? null, rentMonth, zori());
  const ptr = home && rent && rent.latest > 0 ? home.latest / (rent.latest * 12) : null;
  put("priceToRent", ptr, homeMonth, [estimateProvenance("zillow-zhvi", "typical home value / (typical rent × 12); Zillow ZHVI over ZORI, same month", at)]);
  put("emp", emp, OEWS_AS_OF, [oewsProvenance(OEWS_AS_OF, at, { msa: cbsa })]);

  for (const p of [
    { key: "home.momPct", base: "home.latest", row: home ?? undefined, file: homeFile, src: "zillow-zhvi" as const },
    { key: "rent.momPct", base: "rent.latest", row: rent ?? undefined, file: rentFile, src: "zillow-zori" as const },
  ]) {
    const mom = momOf(p.row, p.file);
    out.values[p.key] = mom.pct;
    if (mom.skipped) {
      out.skipped.push(p.base, p.key);
      continue;
    }
    if (mom.pct == null) continue;
    if (p.file) out.periods.current[p.key] = p.file;
    if (mom.previousPeriod) {
      out.periods.previous[p.key] = mom.previousPeriod;
      out.periods.previous[p.base] = mom.previousPeriod;
    }
    out.previous[p.base] = mom.before;
    out.metricProvenance[p.key] = [estimateProvenance(p.src, MOM_METHOD, at)];
  }
  return out;
}

// ---------------------------------------------------------------- the shell

/**
 * Tier A: identity, membership and the bundled occupation mix, with every
 * fetched section marked unavailable because it was not fetched. Synchronous,
 * zero network, and never wrong — it is what the egress-free build renders and
 * what a total outage falls back to.
 */
export function placeFactsShell(scope: PlaceScope, opts: PlaceFactsOptions): PlaceFacts {
  const generatedAt = iso(opts.now);
  const at = opts.retrievedAt ?? generatedAt;
  const centroid = scopeCentroid(scope);
  const notFetched = unavailable(NOT_FETCHED, at);
  const caveats: string[] = [];
  const metricProvenance: Record<string, Provenance[]> = {};
  const values: Record<string, number | null> = {};
  const periods: { current: Record<string, string>; previous: Record<string, string> } = { current: {}, previous: {} };

  let jobs: MsaJobs | null = null;
  let occupations: SectionState = na("BLS OEWS publishes its occupation tables for metro areas, so there is none at this scale.", at);
  let rollup: PlaceFacts["rollup"] = null;
  let members: PlaceMembers | null = null;

  const cbsa = scope.kind === "metro" ? scope.id : scope.kind === "county" ? (metroForCounty(scope.id)?.cbsa ?? null) : null;
  if (cbsa) {
    const table = oewsMsaJobs(cbsa);
    jobs = table?.data ?? null;
    if (jobs) {
      occupations = { status: "fresh", asOf: OEWS_AS_OF, retrievedAt: at };
      if (scope.kind === "county") caveats.push(`The occupation mix is the ${cbsa} metro area's, from the bundled BLS OEWS release: OEWS does not publish a county table.`);
    } else {
      occupations = unavailable(`BLS OEWS publishes no occupation table for CBSA ${cbsa}.`, at);
    }
  }

  if (scope.kind === "metro") {
    const member = countiesInMetro(scope.id);
    const emp = oewsMsaIndex().msas.find((m) => m.id === scope.id)?.emp ?? null;
    values.emp = emp;
    if (emp != null) {
      periods.current.emp = OEWS_AS_OF;
      metricProvenance.emp = [oewsProvenance(OEWS_AS_OF, at, { msa: scope.id })];
    }
    rollup = {
      jobs: null,
      counties: member.length,
      suppressed: [],
      formula: [
        member.length
          ? `jobs = sum of QCEW third-month employment across the ${member.length} member counties — ${NOT_FETCHED}`
          : "jobs = sum of QCEW third-month employment across the member counties; the offline manifest does not yet list this metro's counties, so there is nothing to sum",
      ],
    };
    caveats.push(NO_METRO_MARKET);
  }

  if (scope.kind === "state") {
    members = { counties: [], metros: metrosInState(scope.id).map((m) => ({ id: m.cbsa, name: m.name })) };
    caveats.push(NO_STATE_WATER);
  }

  if (scope.kind === "county" && scope.provisional) {
    caveats.push(`County ${scope.id} is not in the offline place manifest yet (${MANIFEST.countyCount} of the 3,222 counties and county equivalents are), so its name and centroid have to come from upstream at request time.`);
  }

  const provenance = jobs ? [oewsProvenance(OEWS_AS_OF, at, { msa: cbsa ?? undefined })] : [];
  return {
    scope,
    name: scopeName(scope),
    shortName: scopeShortName(scope),
    generatedAt,
    retrievedAt: at,
    lon: centroid?.lon ?? null,
    lat: centroid?.lat ?? null,
    market: { report: null, state: scope.kind === "metro" ? na(NO_METRO_MARKET, at) : notFetched },
    water: { report: null, state: scope.kind === "county" ? notFetched : na(scope.kind === "state" ? NO_STATE_WATER : "Water is reported for a point; a metro is not one.", at) },
    finance: { section: null, state: scope.kind === "county" ? notFetched : na("Deposits and federal obligations are assembled per county.", at) },
    spending: { detail: null, state: scope.kind === "county" ? notFetched : na("Federal obligations are assembled per county.", at) },
    companies: { section: null, state: scope.kind === "metro" ? na("The company snapshot is keyed by county.", at) : notFetched },
    occupations: { jobs, asOf: OEWS_AS_OF, state: occupations },
    rollup,
    housing: scope.kind === "metro" ? { home: null, rent: null, matchedBy: scope.ref.zillowMatchedBy, state: notFetched } : null,
    members,
    values,
    previous: {},
    periods,
    suppressed: [],
    skipped: [],
    peers: {},
    indicators: { items: [], state: notFetched },
    releases: releaseWindows(opts.now),
    metricProvenance,
    provenance,
    citations: citationsOf(provenance),
    caveats,
  };
}

function releaseWindows(now: number): PlaceFacts["releases"] {
  return upcomingReleases(now, now + RELEASE_HORIZON_MS).map((o) => ({
    title: o.entry.title,
    earliest: o.window.earliest,
    latest: o.window.latest,
    precision: o.precision,
  }));
}

// ---------------------------------------------------------------- the loader

/**
 * Every number a place page, its metadata and its brief need, in one call.
 * Resolves for any scope lib/places/scope.ts accepted, however badly the
 * upstreams are behaving.
 */
export async function placeFacts(scope: PlaceScope, opts: PlaceFactsOptions): Promise<PlaceFacts> {
  const facts = placeFactsShell(scope, opts);
  const now = opts.now;

  const indicators = branch(`places:facts:indicators:${opts.indicatorCategory ?? "all"}`, "The indicator set", now, () => getIndicators({ category: opts.indicatorCategory, now }));
  const peers = peerStatsFor(scope);

  if (scope.kind === "county") await county(facts, scope, opts);
  else if (scope.kind === "metro") await metro(facts, scope, opts);
  else await state(facts, scope, opts);

  const ind = await indicators;
  facts.indicators = { items: ind.value?.items ?? [], state: ind.state };
  if (ind.value?.items.length) facts.caveats.push(NATIONAL_INDICATORS);

  facts.peers = await peers;

  facts.provenance = dedupeProvenance([facts.provenance, ...Object.values(facts.metricProvenance)]);
  facts.citations = citationsOf(facts.provenance);
  return facts;
}

/** The cohorts a scope can be ranked in. A metro cohort is only offered when the manifest names enough member counties. */
async function peerStatsFor(scope: PlaceScope): Promise<Record<string, PeerStat[]>> {
  try {
    if (scope.kind === "county") {
      const cohorts: Cohort[] = [{ kind: "national", of: "county" }];
      const usps = scope.ref?.stusab;
      if (usps) cohorts.push({ kind: "state", usps });
      // Only a code with a metro page: a micropolitan county carries its CBSA
      // code but has no metro to be ranked in, and a cohort for it would print
      // "not in the place manifest" beside every ranked figure on the page.
      const own = scope.ref?.cbsa ?? null;
      const cbsa = (own && metroByCbsa(own) ? own : null) ?? metroForCounty(scope.id)?.cbsa ?? null;
      if (cbsa) cohorts.push({ kind: "metro", cbsa });
      return await budgeted(peerStats("county", scope.id, cohorts), "Rank context");
    }
    if (scope.kind === "metro") return await budgeted(peerStats("metro", scope.id, [{ kind: "national", of: "metro" }]), "Rank context");
    return await budgeted(peerStats("state", scope.id, [{ kind: "national", of: "state" }]), "Rank context");
  } catch {
    // peerStats already degrades per cohort; this only catches the budget, and
    // a missing rank must never cost the page a value.
    return {};
  }
}

/** The screener's cached entity table, or an empty one — never a rejection. */
async function areaFeatures(kind: "county" | "state", now: number): Promise<LayerFeature[]> {
  const b = await branch(`places:facts:set:${kind}`, "The nationwide entity table", now, () => entitySet(kind));
  return b.value?.features ?? [];
}

async function county(facts: PlaceFacts, scope: Extract<PlaceScope, { kind: "county" }>, opts: PlaceFactsOptions): Promise<void> {
  const now = opts.now;
  const at = facts.retrievedAt;
  const fips = scope.id;
  const ref = scope.ref;
  const identity = ref ? { name: ref.name, stusab: ref.stusab, stateName: ref.stateName, lon: ref.lon, lat: ref.lat } : null;

  const [market, water, finance, features] = await Promise.all([
    branch(`places:facts:market:county:${fips}`, "The market report", now, () => marketReportForCounty(fips, identity, { now })),
    ref
      ? branch(`places:facts:water:${ref.lon.toFixed(2)},${ref.lat.toFixed(2)}`, "The water report", now, () => waterReportAt(ref.lon, ref.lat, { now }))
      : Promise.resolve<Branch<Awaited<ReturnType<typeof waterReportAt>>>>({
          value: null,
          state: unavailable(`County ${fips} has no centroid in the offline manifest yet, and the water report is a search around a point.`, at),
        }),
    branch(`places:facts:finance:${fips}`, "Deposits and federal obligations", now, () => financeFor(fips, { now: new Date(now), retrievedAt: at, ...(ref ? { stusab: ref.stusab } : {}) })),
    areaFeatures("county", now),
  ]);

  facts.market = { report: market.value?.report ?? null, state: withAsOf(market.state, market.value?.report?.jobs.data.period ?? null) };
  if (market.value) {
    facts.caveats.push(...market.value.caveats);
    facts.provenance.push(...market.value.provenance);
    if (!ref) facts.lon = market.value.report.lon;
    if (!ref) facts.lat = market.value.report.lat;
  }

  facts.water = { report: water.value?.report ?? null, state: water.state };
  if (water.value) {
    facts.caveats.push(WATER_DISC, ...water.value.report.caveats);
    facts.provenance.push(...water.value.provenance);
  }

  facts.finance = { section: finance.value?.section ?? null, state: finance.state };
  facts.spending = {
    detail: finance.value?.detail ?? null,
    state: finance.value && !finance.value.detail ? unavailable("USAspending did not return a recipient, agency and NAICS breakdown for this county.", at) : finance.state,
  };
  if (finance.value) {
    facts.caveats.push(...finance.value.caveats);
    facts.provenance.push(...finance.value.provenance);
  }

  // Sectors come from the market report so the exposure mix and the jobs
  // section cannot disagree; a failed report simply means no exposure rows.
  try {
    const section = companiesSection(fips, { sectors: market.value?.report.jobs.data.sectors ?? [], retrievedAt: at });
    facts.companies = {
      section,
      state: section
        ? { status: "fresh", asOf: section.data.bundlePulled, retrievedAt: at, ...(section.data.bundlePulled ? {} : { reason: "The company snapshot is a committed fixture, not a pull." }) }
        : na("The committed company snapshot names no public filer in this county; an empty list would read as 'none are headquartered here', which is a different claim.", at),
    };
    if (section) {
      facts.provenance.push(...section.provenance);
      facts.caveats.push(...BUNDLE_CAVEATS);
    }
  } catch (err) {
    facts.companies = { section: null, state: unavailable(`The company snapshot is unavailable: ${message(err)}`, at) };
  }

  applyValues(facts, areaValues("county", fips, featureFor({ features, provenance: [], caveats: [], assembledAt: at, failed: [] }, `county:${fips}`), features, at));
  vintageCaveats(facts, "county", market.value?.asOf, at);
}

async function state(facts: PlaceFacts, scope: Extract<PlaceScope, { kind: "state" }>, opts: PlaceFactsOptions): Promise<void> {
  const now = opts.now;
  const at = facts.retrievedAt;
  const ref = scope.ref;

  const [market, features, countyFeatures] = await Promise.all([
    branch(`places:facts:market:state:${ref.fips}`, "The market report", now, () => marketReportForState(ref.fips, { usps: ref.usps, name: ref.name, lon: ref.lon, lat: ref.lat }, { now })),
    areaFeatures("state", now),
    areaFeatures("county", now),
  ]);

  facts.market = { report: market.value?.report ?? null, state: withAsOf(market.state, market.value?.report?.jobs.data.period ?? null) };
  if (market.value) {
    facts.caveats.push(...market.value.caveats);
    facts.provenance.push(...market.value.provenance);
  }

  try {
    const section = companiesSection(`${ref.fips}000`, { retrievedAt: at });
    facts.companies = {
      section,
      state: section
        ? { status: "fresh", asOf: section.data.bundlePulled, retrievedAt: at, ...(section.data.bundlePulled ? {} : { reason: "The company snapshot is a committed fixture, not a pull." }) }
        : na("The committed company snapshot names no public filer in this state.", at),
    };
    if (section) {
      facts.provenance.push(...section.provenance);
      facts.caveats.push(...BUNDLE_CAVEATS);
    }
  } catch (err) {
    facts.companies = { section: null, state: unavailable(`The company snapshot is unavailable: ${message(err)}`, at) };
  }

  const inState = countyFeatures
    .map((f) => extraOf(f))
    .filter((e) => e.geoid.slice(0, 2) === ref.fips)
    .sort((a, b) => (b.jobs?.emp ?? -1) - (a.jobs?.emp ?? -1))
    .slice(0, STATE_MEMBER_LIMIT);
  facts.members = {
    counties: inState.map((e) => ({ id: e.geoid, name: e.name, jobs: e.jobs?.emp ?? null })),
    metros: metrosInState(ref.usps).map((m) => ({ id: m.cbsa, name: m.name })),
  };

  applyValues(facts, areaValues("state", ref.fips, featureFor({ features, provenance: [], caveats: [], assembledAt: at, failed: [] }, `state:${ref.fips}`), features, at));
  vintageCaveats(facts, "state", market.value?.asOf, at);
}

async function metro(facts: PlaceFacts, scope: Extract<PlaceScope, { kind: "metro" }>, opts: PlaceFactsOptions): Promise<void> {
  const now = opts.now;
  const at = facts.retrievedAt;
  const ref = scope.ref;
  const regionId = ref.zillowRegionId;

  const [zhvi, zori, qcew] = await Promise.all([
    regionId ? branch("places:facts:zhviMetro", "Zillow's metro home value file", now, () => zillow("zhviMetro")) : Promise.resolve<Branch<null>>({ value: null, state: noRegion(ref.cbsa, at) }),
    regionId ? branch("places:facts:zoriMetro", "Zillow's metro rent file", now, () => zillow("zoriMetro")) : Promise.resolve<Branch<null>>({ value: null, state: noRegion(ref.cbsa, at) }),
    branch("places:facts:qcew", "BLS QCEW", now, () => qcewLatest()),
  ]);

  const home = (regionId && zhvi.value?.rows.get(regionId)) || null;
  const rent = (regionId && zori.value?.rows.get(regionId)) || null;
  const housingState: SectionState = !regionId
    ? noRegion(ref.cbsa, at)
    : zhvi.state.status === "unavailable" && zori.state.status === "unavailable"
      ? zhvi.state
      : !home && !rent
        ? unavailable(`Zillow's metro files have no row for RegionID ${regionId}.`, at)
        : withAsOf(zhvi.state.status === "unavailable" ? zori.state : zhvi.state, home?.asOf ? ym(home.asOf) : (rent?.asOf ? ym(rent.asOf) : null));
  facts.housing = { home, rent, matchedBy: ref.zillowMatchedBy, state: housingState };
  if (regionId && ref.zillowMatchedBy === "short") {
    facts.caveats.push(`Zillow's metro row was matched to this CBSA BY NAME (Zillow titles metros short, "Austin, TX", where the Census titles them long), not by a shared code. RegionID ${regionId}.`);
  }
  if (regionId && ref.zillowMatchedBy === "counties") {
    facts.caveats.push(`Zillow's metro row was matched to this CBSA BY ITS COUNTIES, not by name or code: Zillow still titles the area by an older delineation, and its county file puts exactly this metro's counties under that row. RegionID ${regionId}.`);
  }

  // The county rollup: withheld counties are NAMED, never counted as zero.
  const member = countiesInMetro(ref.cbsa);
  const counted: Array<{ name: string; emp: number }> = [];
  const withheld: string[] = [];
  const missing: string[] = [];
  for (const c of member) {
    const row = qcew.value?.counties.get(c.geoid);
    if (!row) missing.push(`${c.name} (${c.geoid})`);
    else if (row.suppressed || row.emp == null) withheld.push(`${c.name} (${c.geoid})`);
    else counted.push({ name: c.name, emp: row.emp });
  }
  const total = counted.length ? counted.reduce((a, c) => a + c.emp, 0) : null;
  const formula: string[] = [];
  if (!member.length) {
    formula.push("jobs = sum of QCEW third-month employment across the member counties; the offline manifest does not yet list this metro's counties, so there is nothing to sum.");
  } else if (!qcew.value) {
    formula.push(`jobs = sum of QCEW third-month employment across the ${member.length} member counties; ${qcew.state.reason ?? "BLS QCEW did not answer"}.`);
  } else {
    formula.push(`jobs = sum of QCEW third-month employment across the ${counted.length} of ${member.length} member counties BLS publishes.`);
    if (withheld.length) formula.push(`${withheld.length} ${withheld.length === 1 ? "county is" : "counties are"} withheld (BLS disclosure code N) and are excluded, not counted as zero: ${withheld.join(", ")}.`);
    if (missing.length) formula.push(`${missing.length} ${missing.length === 1 ? "county has" : "counties have"} no row in the ${qcew.value.period} file at all and are likewise excluded, not counted as zero: ${missing.join(", ")}.`);
    if (total != null) formula.push(`${total.toLocaleString("en-US")} = ${counted.map((c) => c.emp.toLocaleString("en-US")).join(" + ")}`);
  }
  facts.rollup = { jobs: total, counties: counted.length, suppressed: [...withheld, ...missing], formula };
  if (total != null) {
    facts.caveats.push("Metro employment is an ESTIMATE: the sum of the member counties BLS did publish, not BLS QCEW's own metro row, whose boundaries follow each year's delineation. Withheld counties are named and excluded, never zeroed.");
    facts.metricProvenance["jobs.emp"] = [estimateProvenance("bls-qcew", formula.join(" "), at, [`CBSA ${ref.cbsa}`])];
    facts.values["jobs.emp"] = total;
    if (qcew.value) facts.periods.current["jobs.emp"] = qcew.value.period;
  }

  const emp = oewsMsaIndex().msas.find((m) => m.id === ref.cbsa)?.emp ?? null;
  const bundle = metroValues(ref.cbsa, home, rent, zhvi.value?.asOf ? ym(zhvi.value.asOf) : null, zori.value?.asOf ? ym(zori.value.asOf) : null, emp, at);
  applyValues(facts, bundle);
  if (zhvi.value || zori.value) {
    vintageCaveats(facts, "metro", { ...(zhvi.value ? { zhvi: zhvi.value.asOf } : {}), ...(zori.value ? { zori: zori.value.asOf } : {}) }, at);
  }
}

function noRegion(cbsa: string, at: string): SectionState {
  return unavailable(
    `The place manifest has no Zillow RegionID for CBSA ${cbsa}, and Zillow's metro files are keyed by RegionID, so there is no row to show. Guessing one by name would be a different metro.`,
    at,
  );
}

function withAsOf(s: SectionState, asOf: string | null): SectionState {
  return asOf ? { ...s, asOf } : s;
}

/** Merge a value bundle into the facts, preserving anything the scope already put there. */
function applyValues(facts: PlaceFacts, b: ValueBundle): void {
  Object.assign(facts.values, b.values);
  Object.assign(facts.previous, b.previous);
  Object.assign(facts.periods.current, b.periods.current);
  Object.assign(facts.periods.previous, b.periods.previous);
  facts.suppressed.push(...b.suppressed);
  facts.skipped.push(...b.skipped);
  Object.assign(facts.metricProvenance, b.metricProvenance);
}

/**
 * Say so when a loaded table is older than its own publication cadence. The
 * calendar knows when ZHVI and QCEW land; a table that has outlived a whole
 * window is a fact the reader is entitled to, not a silently stale number.
 */
function vintageCaveats(facts: PlaceFacts, kind: "county" | "state" | "metro", asOf: Record<string, string> | undefined, at: string): void {
  if (!asOf) return;
  // joinsFor labels its releases "qcew" / "zhvi" / "zori"; describeVintages
  // wants the Zillow FILE, which depends on the scale we asked for.
  const files: Array<[string, ZillowFile]> = [
    ["zhvi", zillowFileFor(kind, false) ?? "zhviCounty"],
    ["zori", zillowFileFor(kind, true) ?? "zoriCounty"],
    ["zhviMetro", "zhviMetro"],
  ];
  const zillowTables = files.filter(([k]) => asOf[k]).map(([k, file]) => ({ kind: file, asOf: asOf[k], retrievedAt: at }));
  const qcew = asOf.qcew ? { period: asOf.qcew, year: Number(asOf.qcew.slice(0, 4)) || 0, qtr: Number(asOf.qcew.slice(-1)) || 0, retrievedAt: at } : undefined;
  if (!zillowTables.length && !qcew) return;
  for (const v of describeVintages({ zillow: zillowTables, ...(qcew ? { qcew } : {}), now: at })) {
    if (v.maybeStale) facts.caveats.push(`${v.title} is still showing ${v.period}; a newer release should exist by now.`);
  }
}
