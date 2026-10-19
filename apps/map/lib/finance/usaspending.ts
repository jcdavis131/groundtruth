// USAspending: federal obligations by place of performance, and who
// received them. Public domain, no key; the API asks for a User-Agent and
// reasonable rates, which upstream() and polite() provide. Obligations are
// what agencies committed in the period, not what they paid out (outlays).
//
// shape per https://api.usaspending.gov/docs/endpoints; unverified in sandbox

import { cached } from "@/lib/server/cache";
import { polite, upstreamJson } from "@/lib/server/upstream";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { AWARD_GROUP_IDS, AWARD_GROUPS, type AreaObligations, type AwardGroup, type CategoryRow, type GeoObligation, type OverTimeRow, type SpendingDetail, type ToDateObligations } from "./types";

export const USASPENDING_BASE = "https://api.usaspending.gov/api/v2";
const H = 3600_000;
/** Federal reporting closes about 45 days after a quarter ends; a fiscal year that just closed is still filling in. */
export const REPORTING_LAG_DAYS = 45;

// ---- fiscal calendar (pure)

/** Federal fiscal year containing a date: FY N runs 1 Oct N-1 through 30 Sep N. */
export function fiscalYearOf(d: Date): number {
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

export function fiscalYearRange(fy: number): { start_date: string; end_date: string } {
  return { start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` };
}

/** The most recent fiscal year that has ended. */
export function latestCompleteFy(now: Date): number {
  return fiscalYearOf(now) - 1;
}

/** The current fiscal year from its first day through `now`. */
export function fyToDateRange(now: Date): { fy: number; start_date: string; end_date: string } {
  const fy = fiscalYearOf(now);
  return { fy, start_date: `${fy - 1}-10-01`, end_date: now.toISOString().slice(0, 10) };
}

/** Days since the latest complete fiscal year ended; under REPORTING_LAG_DAYS its totals are still arriving. */
export function daysSinceFyClose(now: Date): number {
  const fy = latestCompleteFy(now);
  const close = Date.UTC(fy, 8, 30);
  return Math.floor((now.getTime() - close) / 86_400_000);
}

// ---- request bodies (pure)

export interface TimePeriod {
  start_date: string;
  end_date: string;
}

export type GeoLayer = "county" | "state";

export function geographyBody(period: TimePeriod, codes: string[], geoLayer: GeoLayer, shapeCodes?: string[]) {
  return {
    scope: "place_of_performance",
    geo_layer: geoLayer,
    ...(shapeCodes && shapeCodes.length ? { geo_layer_filters: shapeCodes } : {}),
    filters: { time_period: [period], award_type_codes: codes },
  };
}

/** USAspending wants the county as its three-digit code inside the state. */
export function placeFilter(fips: string, stusab: string) {
  return [{ country: "USA", state: stusab.toUpperCase(), county: fips.slice(2) }];
}

export function categoryBody(period: TimePeriod, codes: string[], fips: string, stusab: string, limit: number) {
  return {
    filters: { time_period: [period], award_type_codes: codes, place_of_performance_locations: placeFilter(fips, stusab) },
    limit,
    page: 1,
  };
}

export function overTimeBody(periods: TimePeriod[], codes: string[], fips: string, stusab: string) {
  return {
    group: "fiscal_year",
    filters: { time_period: periods, award_type_codes: codes, place_of_performance_locations: placeFilter(fips, stusab) },
  };
}

export function allAwardCodes(): string[] {
  return AWARD_GROUP_IDS.flatMap((g) => AWARD_GROUPS[g].codes);
}

// ---- parsers (pure)

type Cell = string | number | null | undefined;
function num(v: Cell): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface GeoResult {
  shape_code?: Cell;
  display_name?: Cell;
  aggregated_amount?: Cell;
  population?: Cell;
  per_capita?: Cell;
}

export function parseGeography(json: unknown): GeoObligation[] {
  const results = ((json ?? {}) as { results?: GeoResult[] }).results;
  if (!Array.isArray(results)) return [];
  const out: GeoObligation[] = [];
  for (const r of results) {
    const shapeCode = r.shape_code == null ? "" : String(r.shape_code).trim();
    const amount = num(r.aggregated_amount);
    if (!shapeCode || amount == null) continue;
    out.push({ shapeCode, name: r.display_name == null ? shapeCode : String(r.display_name), amount, population: num(r.population), perCapita: num(r.per_capita) });
  }
  return out;
}

interface CategoryResult {
  name?: Cell;
  amount?: Cell;
  code?: Cell;
  id?: Cell;
  recipient_id?: Cell;
}

export function parseCategory(json: unknown): CategoryRow[] {
  const results = ((json ?? {}) as { results?: CategoryResult[] }).results;
  if (!Array.isArray(results)) return [];
  const out: CategoryRow[] = [];
  for (const r of results) {
    const amount = num(r.amount);
    if (amount == null) continue;
    const id = r.recipient_id ?? r.id;
    out.push({ name: r.name == null ? "(unnamed)" : String(r.name), amount, code: r.code == null ? null : String(r.code), id: id == null ? null : String(id) });
  }
  return out;
}

interface OverTimeResult {
  time_period?: { fiscal_year?: Cell };
  aggregated_amount?: Cell;
}

export function parseOverTime(json: unknown): OverTimeRow[] {
  const results = ((json ?? {}) as { results?: OverTimeResult[] }).results;
  if (!Array.isArray(results)) return [];
  const out: OverTimeRow[] = [];
  for (const r of results) {
    const fy = num(r.time_period?.fiscal_year);
    const amount = num(r.aggregated_amount);
    if (fy == null || amount == null) continue;
    out.push({ fy, amount });
  }
  return out.sort((a, b) => a.fy - b.fy);
}

/** Fold per-family geography results into one AreaObligations per shape code. Families that did not answer stay null. Pure. */
export function foldObligations(fy: number, byGroup: Partial<Record<AwardGroup, GeoObligation[] | null>>): Map<string, AreaObligations> {
  const out = new Map<string, AreaObligations>();
  const empty = (): AreaObligations => ({ fy, byGroup: { contracts: null, grants: null, loans: null, direct: null }, total: null });
  for (const g of AWARD_GROUP_IDS) {
    const rows = byGroup[g];
    if (!rows) continue;
    for (const r of rows) {
      const cur = out.get(r.shapeCode) ?? empty();
      cur.byGroup[g] = (cur.byGroup[g] ?? 0) + r.amount;
      out.set(r.shapeCode, cur);
    }
  }
  // A family that answered contributes 0, not null, to areas it had no row for.
  for (const a of out.values()) {
    for (const g of AWARD_GROUP_IDS) if (byGroup[g] && a.byGroup[g] == null) a.byGroup[g] = 0;
    const present = AWARD_GROUP_IDS.map((g) => a.byGroup[g]).filter((v): v is number => v != null);
    a.total = present.length ? present.reduce((x, y) => x + y, 0) : null;
  }
  return out;
}

// ---- fetchers

function post<T>(path: string, body: unknown): Promise<T> {
  return polite("usaspending", 250, 60_000, () =>
    upstreamJson<T>("usaspending", `${USASPENDING_BASE}/${path}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 45_000,
    }),
  );
}

function usaProvenance(fields: Omit<Provenance, "source" | "retrievedAt"> & { retrievedAt?: string }): Provenance {
  return provenance(source("usaspending"), fields);
}

export interface ObligationsTable {
  fy: number;
  level: GeoLayer;
  byArea: Map<string, AreaObligations>;
  /** Award families whose request failed; their cells are null everywhere. */
  failed: AwardGroup[];
  provenance: Provenance;
}

/** Obligations in a complete fiscal year for every county (or state), one request per award family. */
export function obligationsByArea(level: GeoLayer, fy: number): Promise<ObligationsTable> {
  return cached(`usaspending:geo:${level}:${fy}`, 12 * H, async () => {
    const period = fiscalYearRange(fy);
    const settled = await Promise.allSettled(AWARD_GROUP_IDS.map((g) => post<unknown>("search/spending_by_geography", geographyBody(period, AWARD_GROUPS[g].codes, level))));
    const byGroup: Partial<Record<AwardGroup, GeoObligation[] | null>> = {};
    const failed: AwardGroup[] = [];
    settled.forEach((s, i) => {
      const g = AWARD_GROUP_IDS[i];
      if (s.status === "fulfilled") byGroup[g] = parseGeography(s.value);
      else failed.push(g);
    });
    if (failed.length === AWARD_GROUP_IDS.length) {
      const first = settled[0];
      throw first.status === "rejected" ? first.reason : new Error("USAspending: every award family failed");
    }
    return {
      fy,
      level,
      byArea: foldObligations(fy, byGroup),
      failed,
      provenance: usaProvenance({
        kind: "published",
        seriesId: `spending_by_geography:${level}:FY${fy}`,
        upstreamUrl: `${USASPENDING_BASE}/search/spending_by_geography/`,
        period: `FY${fy}`,
        notes: ["Obligations by place of performance, all award families summed", "Obligations, not outlays"],
      }),
    };
  }).then((c) => c.value);
}

export interface ToDateTable {
  fy: number;
  through: string;
  level: GeoLayer;
  byArea: Map<string, number>;
  provenance: Provenance;
}

/** Fiscal-year-to-date obligations, all families in one request; keyed by the day so the cache rolls daily. */
export function obligationsToDate(level: GeoLayer, now = new Date()): Promise<ToDateTable> {
  const { fy, start_date, end_date } = fyToDateRange(now);
  return cached(`usaspending:geo-ytd:${level}:${end_date}`, 12 * H, async () => {
    const json = await post<unknown>("search/spending_by_geography", geographyBody({ start_date, end_date }, allAwardCodes(), level));
    const byArea = new Map<string, number>();
    for (const r of parseGeography(json)) byArea.set(r.shapeCode, r.amount);
    return {
      fy,
      through: end_date,
      level,
      byArea,
      provenance: usaProvenance({ kind: "published", seriesId: `spending_by_geography:${level}:FY${fy}-to-date`, upstreamUrl: `${USASPENDING_BASE}/search/spending_by_geography/`, period: `${start_date}/${end_date}`, notes: ["Fiscal year to date; agencies report with up to a 45-day lag"] }),
    };
  }).then((c) => c.value);
}

export function toDateFor(table: ToDateTable, shapeCode: string): ToDateObligations {
  return { fy: table.fy, through: table.through, total: table.byArea.get(shapeCode) ?? null };
}

/** Top recipients, awarding agencies, NAICS codes and a six-year trace for one county. */
export function countySpendingDetail(fips: string, stusab: string, fy: number, limit = 15): Promise<SpendingDetail> {
  return cached(`usaspending:detail:${fips}:${fy}:${limit}`, 12 * H, async () => {
    const period = fiscalYearRange(fy);
    const codes = allAwardCodes();
    const years = Array.from({ length: 6 }, (_, i) => fy - 5 + i);
    const [rec, ag, na, ot] = await Promise.allSettled([
      post<unknown>("search/spending_by_category/recipient", categoryBody(period, codes, fips, stusab, limit)),
      post<unknown>("search/spending_by_category/awarding_agency", categoryBody(period, codes, fips, stusab, limit)),
      post<unknown>("search/spending_by_category/naics", categoryBody(period, AWARD_GROUPS.contracts.codes, fips, stusab, limit)),
      post<unknown>("search/spending_over_time", overTimeBody(years.map(fiscalYearRange), codes, fips, stusab)),
    ]);
    if ([rec, ag, na, ot].every((s) => s.status === "rejected")) throw (rec as PromiseRejectedResult).reason;
    const ok = (s: PromiseSettledResult<unknown>) => (s.status === "fulfilled" ? s.value : null);
    const notes: string[] = [];
    if (rec.status === "rejected") notes.push("recipients did not answer");
    if (ag.status === "rejected") notes.push("agencies did not answer");
    if (na.status === "rejected") notes.push("NAICS did not answer");
    if (ot.status === "rejected") notes.push("over-time did not answer");
    return {
      fips,
      fy,
      recipients: parseCategory(ok(rec)),
      agencies: parseCategory(ok(ag)),
      naics: parseCategory(ok(na)),
      overTime: parseOverTime(ok(ot)),
      provenance: [
        usaProvenance({
          kind: "published",
          seriesId: `spending_by_category:${fips}:FY${fy}`,
          upstreamUrl: `${USASPENDING_BASE}/search/spending_by_category/`,
          period: `FY${fy}`,
          notes: ["Recipients are legal entities as registered in SAM; place of performance, not recipient location", "NAICS covers contracts only", ...notes],
        }),
      ],
    };
  }).then((c) => c.value);
}
