// FDIC BankFind Suite: insured institutions, their offices, the annual
// Summary of Deposits, quarterly financials and failures. Public domain, no
// key. Every table is cached for hours because FDIC refreshes quarterly
// (financials) or annually (SOD, as of June 30 each year, published in the
// autumn).
//
// Docs: https://api.fdic.gov/banks/docs/. The old base,
// https://banks.data.fdic.gov/api, answers 301 to https://api.fdic.gov/banks/
// (checked 2026-10-01), so requests go to the new base directly. The SOD
// fields below, MSABR and MSANAMB included, were read live from /sod that day.

import { cached } from "@/lib/server/cache";
import { polite, upstreamJson } from "@/lib/server/upstream";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { Point, Series } from "@/lib/series/types";
import { chunk } from "./api";
import { hhi, marketShares } from "./estimates";
import type { BankFailure, BankProfile, Branch, CountyDeposits, FinancialsRow, Institution, SodRow } from "./types";

export const FDIC_BASE = "https://api.fdic.gov/banks";
const H = 3600_000;
/** FDIC caps a page at 10,000 rows; we never page, so a full page means "more exist". */
export const FDIC_PAGE = 10_000;
/** Counties per /locations call; keeps the filter short and the page under the cap. */
export const COUNTIES_PER_CALL = 25;

export const INSTITUTION_FIELDS = "CERT,NAME,CITY,STALP,ZIP,ASSET,DEP,NETINC,ROA,ROE,OFFICES,STMULT,BKCLASS,ACTIVE,REPDTE,LATITUDE,LONGITUDE,COUNTY";
// OFFNUM is the office number the Summary of Deposits calls BRNUM; UNINUM is the FDIC office id.
export const LOCATION_FIELDS = "CERT,NAME,OFFNAME,OFFNUM,UNINUM,ADDRESS,CITY,STALP,ZIP,STCNTYBR,LATITUDE,LONGITUDE,SERVTYPE,ESTYMD";
// MSABR is the CBSA code of the office's metropolitan statistical area (0 outside one); MSANAMB its title.
export const SOD_FIELDS = "CERT,NAMEFULL,BRNUM,UNINUMBR,DEPSUMBR,ASSET,STCNTYBR,CNTYNAMB,STALPBR,YEAR,SIMS_LATITUDE,SIMS_LONGITUDE,MSABR,MSANAMB";
export const FINANCIALS_FIELDS = "REPDTE,ASSET,DEP,NETINC,LNLSNET,NCLNLS,NPTLA,ROA,ROE,EQ";
export const FAILURE_FIELDS = "NAME,CITYST,FAILDATE,QBFASSET,QBFDEP,COST,RESTYPE";

// ---- envelope and cell readers (pure)

/** BankFind wraps rows as { meta: { total }, data: [{ data: row, score }] }. */
export interface FdicEnvelope<T> {
  meta?: { total?: number };
  data?: Array<{ data?: T; score?: number }>;
}

export function unwrapFdic<T>(json: unknown): { total: number; rows: T[] } {
  const env = (json ?? {}) as FdicEnvelope<T>;
  const rows = (Array.isArray(env.data) ? env.data : []).map((d) => d?.data).filter((r): r is T => r != null && typeof r === "object");
  const total = typeof env.meta?.total === "number" ? env.meta.total : rows.length;
  return { total, rows };
}

type Cell = string | number | boolean | null | undefined;
type Row = Record<string, Cell>;

/** Number or null; blanks and non-numeric strings are null, never zero. */
export function cell(v: Cell): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function str(v: Cell): string {
  return v == null ? "" : String(v).trim();
}

function strOrNull(v: Cell): string | null {
  const s = str(v);
  return s ? s : null;
}

function flag(v: Cell): boolean {
  if (typeof v === "boolean") return v;
  const s = str(v).toLowerCase();
  return s === "1" || s === "true" || s === "y" || s === "yes";
}

/** FDIC dates arrive as "2025-06-30", "20250630" or "06/30/2025" depending on the table; normalise to ISO. */
export function fdicDate(v: Cell): string | null {
  const s = str(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/** STCNTYBR is numeric upstream, so a leading zero (Alabama 01xxx) may be gone. */
function fips5(v: Cell): string {
  return str(v).replace(/\D/g, "").padStart(5, "0").slice(-5);
}

/** MSABR as a five-digit CBSA code; FDIC writes 0 for an office outside any metropolitan statistical area, which is null here. */
export function msaCode(v: Cell): string | null {
  const n = cell(v);
  if (n == null || !Number.isInteger(n) || n <= 0 || n > 99999) return null;
  return String(n).padStart(5, "0");
}

// ---- parsers (pure)

export function parseInstitution(r: Row): Institution | null {
  const cert = cell(r.CERT);
  if (cert == null) return null;
  return {
    cert,
    name: str(r.NAME),
    city: str(r.CITY),
    state: str(r.STALP),
    zip: str(r.ZIP).padStart(5, "0").slice(0, 5),
    assets: cell(r.ASSET),
    deposits: cell(r.DEP),
    netIncome: cell(r.NETINC),
    roa: cell(r.ROA),
    roe: cell(r.ROE),
    offices: cell(r.OFFICES),
    multiState: flag(r.STMULT),
    bkClass: str(r.BKCLASS),
    active: flag(r.ACTIVE),
    reportDate: fdicDate(r.REPDTE),
    county: strOrNull(r.COUNTY),
    lat: cell(r.LATITUDE),
    lon: cell(r.LONGITUDE),
  };
}

export function parseBranch(r: Row): Branch | null {
  const cert = cell(r.CERT);
  if (cert == null) return null;
  const fips = fips5(r.STCNTYBR);
  if (!/^\d{5}$/.test(fips) || fips === "00000") return null;
  return {
    cert,
    officeNum: cell(r.OFFNUM),
    uninum: cell(r.UNINUM),
    name: str(r.NAME),
    office: str(r.OFFNAME) || str(r.NAME),
    address: strOrNull(r.ADDRESS),
    city: str(r.CITY),
    state: str(r.STALP),
    zip: str(r.ZIP).padStart(5, "0").slice(0, 5),
    fips,
    serviceType: strOrNull(r.SERVTYPE),
    established: fdicDate(r.ESTYMD),
    lat: cell(r.LATITUDE),
    lon: cell(r.LONGITUDE),
  };
}

export function parseSodRow(r: Row): SodRow | null {
  const cert = cell(r.CERT);
  const year = cell(r.YEAR);
  if (cert == null || year == null) return null;
  return {
    cert,
    name: str(r.NAMEFULL),
    brnum: cell(r.BRNUM) ?? 0,
    uninum: cell(r.UNINUMBR),
    deposits: cell(r.DEPSUMBR),
    assets: cell(r.ASSET),
    fips: fips5(r.STCNTYBR),
    county: strOrNull(r.CNTYNAMB),
    state: strOrNull(r.STALPBR),
    year,
    lat: cell(r.SIMS_LATITUDE),
    lon: cell(r.SIMS_LONGITUDE),
    cbsa: msaCode(r.MSABR),
    cbsaName: msaCode(r.MSABR) ? strOrNull(r.MSANAMB) : null,
  };
}

export function parseFinancialsRow(r: Row): FinancialsRow | null {
  const reportDate = fdicDate(r.REPDTE);
  if (!reportDate) return null;
  return {
    reportDate,
    assets: cell(r.ASSET),
    deposits: cell(r.DEP),
    netIncome: cell(r.NETINC),
    netLoans: cell(r.LNLSNET),
    noncurrentLoans: cell(r.NCLNLS),
    noncurrentPct: cell(r.NPTLA),
    roa: cell(r.ROA),
    roe: cell(r.ROE),
    equity: cell(r.EQ),
  };
}

export function parseFailure(r: Row): BankFailure | null {
  const failDate = fdicDate(r.FAILDATE);
  const name = str(r.NAME);
  if (!failDate || !name) return null;
  return {
    name,
    cityState: str(r.CITYST),
    failDate,
    assets: cell(r.QBFASSET),
    deposits: cell(r.QBFDEP),
    cost: cell(r.COST),
    resolution: strOrNull(r.RESTYPE),
  };
}

// ---- query helpers (pure)

/** query_string filter for a set of county FIPS: "STCNTYBR:48453" or "STCNTYBR:(48453 OR 48491)". */
export function countyFilter(fipsList: string[]): string {
  const ids = [...new Set(fipsList.map((f) => f.replace(/\D/g, "")).filter((f) => f.length === 5))].sort();
  if (ids.length === 0) throw new Error("countyFilter: no county FIPS");
  return ids.length === 1 ? `STCNTYBR:${ids[0]}` : `STCNTYBR:(${ids.join(" OR ")})`;
}

/** Sorted, de-duplicated runs of at most COUNTIES_PER_CALL county FIPS. */
export function chunkCounties(fipsList: string[], size = COUNTIES_PER_CALL): string[][] {
  const ids = [...new Set(fipsList.filter((f) => /^\d{5}$/.test(f)))].sort();
  return chunk(ids, size);
}

export function fdicUrl(endpoint: "institutions" | "locations" | "sod" | "financials" | "failures", params: Record<string, string | number>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  if (!qs.has("format")) qs.set("format", "json");
  if (!qs.has("limit")) qs.set("limit", String(FDIC_PAGE));
  return `${FDIC_BASE}/${endpoint}?${qs}`;
}

/** A BankFind provenance record; `retrievedAt` may be given for cached values. */
export function fdicProvenance(fields: Omit<Provenance, "source" | "retrievedAt"> & { retrievedAt?: string }): Provenance {
  return provenance(source("fdic-bankfind"), fields);
}

// ---- fetchers

async function fdicRows<T extends Row>(endpoint: Parameters<typeof fdicUrl>[0], params: Record<string, string | number>): Promise<{ total: number; rows: T[]; url: string }> {
  const url = fdicUrl(endpoint, params);
  const json = await polite("fdic", 200, 60_000, () => upstreamJson<unknown>("fdic-bankfind", url, { timeoutMs: 30_000 }));
  const { total, rows } = unwrapFdic<T>(json);
  return { total, rows, url };
}

/** Active insured institutions headquartered in a state. */
export function institutionsForState(state: string): Promise<{ rows: Institution[]; total: number; url: string }> {
  const st = state.toUpperCase();
  return cached(`fdic:institutions:${st}`, 24 * H, async () => {
    const r = await fdicRows("institutions", { filters: `STALP:${st} AND ACTIVE:1`, fields: INSTITUTION_FIELDS, sort_by: "ASSET", sort_order: "DESC" });
    return { rows: r.rows.map(parseInstitution).filter((x): x is Institution => !!x), total: r.total, url: r.url };
  }).then((c) => c.value);
}

/** One institution by certificate number, active or not. */
export function institution(cert: number): Promise<{ row: Institution | null; url: string }> {
  return cached(`fdic:institution:${cert}`, 6 * H, async () => {
    const r = await fdicRows("institutions", { filters: `CERT:${cert}`, fields: INSTITUTION_FIELDS, limit: 1 });
    return { row: r.rows.map(parseInstitution).find((x): x is Institution => !!x) ?? null, url: r.url };
  }).then((c) => c.value);
}

/**
 * Every office in a set of counties. Counties are chunked so nearby views
 * share cache entries; `truncated` lists chunks that hit the page cap.
 */
export async function branchesForCounties(fipsList: string[]): Promise<{ rows: Branch[]; truncated: string[][]; urls: string[] }> {
  const rows: Branch[] = [];
  const truncated: string[][] = [];
  const urls: string[] = [];
  for (const group of chunkCounties(fipsList)) {
    const r = await cached(`fdic:branches:${group.join(",")}`, 24 * H, async () => {
      const res = await fdicRows("locations", { filters: countyFilter(group), fields: LOCATION_FIELDS });
      return { rows: res.rows.map(parseBranch).filter((x): x is Branch => !!x), total: res.total, url: res.url };
    });
    rows.push(...r.value.rows);
    urls.push(r.value.url);
    if (r.value.total > FDIC_PAGE || r.value.rows.length >= FDIC_PAGE) truncated.push(group);
  }
  return { rows, truncated, urls };
}

/** Summary of Deposits rows for one county and year; empty when FDIC has not published that year. */
export function sodForCounty(fips: string, year: number): Promise<{ rows: SodRow[]; url: string }> {
  return cached(`fdic:sod:${fips}:${year}`, 24 * H, async () => {
    const r = await fdicRows("sod", { filters: `STCNTYBR:${fips} AND YEAR:${year}`, fields: SOD_FIELDS });
    return { rows: r.rows.map(parseSodRow).filter((x): x is SodRow => !!x), url: r.url };
  }).then((c) => c.value);
}

/** Summary of Deposits for a set of counties in one year; lib/finance/features.ts joins them onto offices by CERT+BRNUM. */
export async function sodForCounties(fipsList: string[], year: number): Promise<SodRow[]> {
  const out: SodRow[] = [];
  for (const group of chunkCounties(fipsList)) {
    const r = await cached(`fdic:sod:${group.join(",")}:${year}`, 24 * H, async () => {
      const res = await fdicRows("sod", { filters: `${countyFilter(group)} AND YEAR:${year}`, fields: SOD_FIELDS });
      return res.rows.map(parseSodRow).filter((x): x is SodRow => !!x);
    });
    out.push(...r.value);
  }
  return out;
}

/** Candidate SOD years, newest first: the survey is as of June 30 and appears in the autumn, so the current year may not exist yet. */
export function sodYears(now: Date, back = 2): number[] {
  const y = now.getUTCFullYear();
  return Array.from({ length: back + 1 }, (_, i) => y - i);
}

/** The newest SOD year FDIC has published for a county: try this year, then the previous ones. */
export async function latestSod(fips: string, now = new Date()): Promise<{ year: number; rows: SodRow[]; url: string } | null> {
  for (const year of sodYears(now)) {
    const r = await sodForCounty(fips, year);
    if (r.rows.length) return { year, rows: r.rows, url: r.url };
  }
  return null;
}

/** Aggregate one county-year of SOD rows: totals, top banks with shares, HHI. Pure. */
export function countyDeposits(fips: string, year: number, rows: SodRow[], url: string | undefined, retrievedAt: string, top = 10): CountyDeposits {
  const shares = marketShares(rows);
  const total = shares.reduce((a, s) => a + s.deposits, 0);
  const index = hhi(shares);
  const period = `${year}-06-30`;
  const prov: Provenance[] = [
    fdicProvenance({ kind: "published", seriesId: `sod:${fips}:${year}`, upstreamUrl: url, period, retrievedAt, notes: ["Summary of Deposits, deposits by office as of June 30; $ thousands upstream, dollars here"] }),
  ];
  if (index) prov.push(fdicProvenance({ kind: "estimate", seriesId: `sod-hhi:${fips}:${year}`, period, retrievedAt, method: index.formula, notes: ["DOJ 1995 bank merger screen thresholds: 1000 / 1800"] }));
  return {
    fips,
    county: rows.find((r) => r.county)?.county ?? null,
    state: rows.find((r) => r.state)?.state ?? null,
    year,
    total,
    branches: rows.length,
    banks: shares.length,
    top: shares.slice(0, top),
    hhi: index,
    provenance: prov,
  };
}

const SERIES_FIELDS: Array<{ key: keyof Omit<FinancialsRow, "reportDate">; title: string; unit: string }> = [
  { key: "roa", title: "Return on assets", unit: "%" },
  { key: "roe", title: "Return on equity", unit: "%" },
  { key: "noncurrentPct", title: "Noncurrent loans to total loans", unit: "%" },
  { key: "assets", title: "Total assets", unit: "USD thousands" },
  { key: "deposits", title: "Total deposits", unit: "USD thousands" },
  { key: "netIncome", title: "Net income (year to date)", unit: "USD thousands" },
  { key: "netLoans", title: "Net loans and leases", unit: "USD thousands" },
  { key: "equity", title: "Total equity capital", unit: "USD thousands" },
];

/** Quarterly rows -> one Series per field, oldest first, null where FDIC withheld. Pure. */
export function financialsSeries(cert: number, name: string, rows: FinancialsRow[], url: string | undefined, retrievedAt: string): Series[] {
  const sorted = [...rows].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  return SERIES_FIELDS.map((f) => {
    const points: Point[] = sorted.map((r) => ({ t: Date.parse(r.reportDate + "T00:00:00Z"), v: r[f.key] }));
    return {
      id: `fdic:financials:${cert}:${f.key}`,
      title: `${name} · ${f.title}`,
      unit: f.unit,
      frequency: "quarterly",
      geo: { kind: "point", id: String(cert), name },
      provenance: fdicProvenance({ kind: "published", seriesId: `financials:${cert}:${f.key}`, upstreamUrl: url, period: sorted.at(-1)?.reportDate, retrievedAt }),
      tags: ["banks", "finance"],
      points,
    };
  });
}

/** Institution profile plus up to ten years of quarterly financials as Series. */
export function bankProfile(cert: number, quarters = 40): Promise<BankProfile> {
  return cached(`fdic:profile:${cert}:${quarters}`, 6 * H, async () => {
    const retrievedAt = new Date().toISOString();
    const [inst, fin] = await Promise.all([
      institution(cert),
      fdicRows("financials", { filters: `CERT:${cert}`, fields: FINANCIALS_FIELDS, sort_by: "REPDTE", sort_order: "DESC", limit: Math.max(1, Math.min(quarters, 200)) }),
    ]);
    const rows = fin.rows.map(parseFinancialsRow).filter((x): x is FinancialsRow => !!x);
    const name = inst.row?.name ?? `CERT ${cert}`;
    const prov: Provenance[] = [
      fdicProvenance({ kind: "published", seriesId: `institutions:${cert}`, upstreamUrl: inst.url, period: inst.row?.reportDate ?? undefined, retrievedAt }),
      fdicProvenance({ kind: "published", seriesId: `financials:${cert}`, upstreamUrl: fin.url, period: rows[0]?.reportDate, retrievedAt, notes: ["Call Report / TFR figures, $ thousands; ratios in percent as FDIC computes them"] }),
    ];
    return { institution: inst.row, rows, series: financialsSeries(cert, name, rows, fin.url, retrievedAt), provenance: prov };
  }).then((c) => c.value);
}

/** Bank failures in a calendar year (public events; FDIC's own list). */
export function bankFailures(year: number): Promise<{ rows: BankFailure[]; url: string }> {
  return cached(`fdic:failures:${year}`, 24 * H, async () => {
    const r = await fdicRows("failures", { filters: `FAILYR:${year}`, fields: FAILURE_FIELDS, sort_by: "FAILDATE", sort_order: "DESC", limit: 1000 });
    return { rows: r.rows.map(parseFailure).filter((x): x is BankFailure => !!x), url: r.url };
  }).then((c) => c.value);
}
