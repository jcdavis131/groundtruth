// Finance API: where insured deposits sit and where federal dollars land,
// over two public, keyless sources. CORS open and edge-cached like
// /api/economy, so scripts and notebooks can use it.
//
//   /api/finance?op=banks&bbox=w,s,e,n         FDIC offices in the box (at most 25 counties) with
//                                              Summary of Deposits joined per office
//   /api/finance?op=deposits&fips=48453        a county's deposit market: total, top banks with
//                                              shares, HHI (latest SOD year published)
//   /api/finance?op=bank&cert=3511             one institution: profile plus quarterly financials
//                                              as Series (ROA, ROE, noncurrent loans, ...)
//   /api/finance?op=failures&year=2023         bank failures in a calendar year
//   /api/finance?op=spending&bbox=w,s,e,n      county polygons joined with USAspending obligations
//                                              for the latest complete fiscal year and QCEW jobs;
//                                              > 400 counties in the box falls back to states
//   /api/finance?op=spending&level=state       every state, same joins
//   /api/finance?op=spending-detail&fips=48453 top recipients, awarding agencies, NAICS and a
//                                              six-year trace for a county
//   /api/finance?op=section&fips=48453         the finance section of the market report
//
// `fy=` overrides the fiscal year on the spending ops (federal FY N runs
// 1 Oct N-1 to 30 Sep N). Tabular ops answer `format=csv` with provenance
// as `#` footer lines. Every response carries `provenance` and
// `generatedAt`; estimates (HHI, per-job) print their formula. See
// docs/FINANCE.md.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError } from "@/lib/server/upstream";
import { badRequest, csv as csvResponse, notFound, ok, options, parseFormat, withCors, type CsvRow, type ResponseFormat } from "@/lib/server/respond";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { qcewProvenance, tigerProvenance } from "@/lib/economy/provenance";
import type { AreaLevel, AreaPoly, JobsRow } from "@/lib/economy/features";
import { qcewLatest, stateLookup, tigerCounties, tigerStates } from "@/lib/economy/sources";
import { detailFor, parseBbox, parseCert, parseCountyFips, parseYear, type Bbox } from "@/lib/finance/api";
import { financeFor } from "@/lib/finance/assemble";
import { bankFailures, bankProfile, branchesForCounties, countyDeposits, fdicProvenance, latestSod, sodForCounties, sodYears } from "@/lib/finance/fdic";
import { buildBranches, buildSpendingAreas, type SpendingJoins } from "@/lib/finance/features";
import {
  BANK_SHARE_COLUMNS,
  BRANCH_COLUMNS,
  CATEGORY_COLUMNS,
  FAILURE_COLUMNS,
  FINANCIALS_COLUMNS,
  flattenBranches,
  flattenDeposits,
  flattenDetail,
  flattenFailures,
  flattenFinancials,
  flattenSpendingAreas,
  SPENDING_AREA_COLUMNS,
} from "@/lib/finance/flatten";
import type { AreaObligations, SodRow, ToDateObligations } from "@/lib/finance/types";
import { countySpendingDetail, daysSinceFyClose, fiscalYearOf, latestCompleteFy, obligationsByArea, obligationsToDate, REPORTING_LAG_DAYS, toDateFor } from "@/lib/finance/usaspending";

export const maxDuration = 60;

const H = 3600_000;
/** Offices per call stay well under FDIC's 10,000-row page at this many counties. */
export const MAX_BANK_COUNTIES = 25;
/** Above this many counties the polygons alone are tens of megabytes; states carry the same joins. */
export const MAX_SPENDING_COUNTIES = 400;
/** USAspending starts in FY2008. */
const MIN_FY = 2008;
const MIN_FAILURE_YEAR = 1934;

interface OpResult {
  data: unknown;
  meta: Record<string, unknown>;
  ttlS: number;
  provenance: Provenance[];
  caveats?: string[];
  /** Tabular ops: how to flatten `data` for `format=csv`. Absent means CSV is not offered for this op. */
  csv?: () => { rows: CsvRow[]; columns: readonly string[]; filename: string };
}

/** County polygons carry only a state FIPS prefix; give them the USPS code for labels. */
async function withStusab(polys: AreaPoly[]): Promise<AreaPoly[]> {
  const states = await stateLookup().catch(() => null);
  if (!states) return polys;
  return polys.map((p) => (p.stusab ? p : { ...p, stusab: states.get(p.geoid.slice(0, 2))?.stusab }));
}

// ---- banks

async function opBanks(bbox: Bbox): Promise<OpResult | { tooMany: number }> {
  // Only the GEOIDs are needed; the coarsest polygons are the cheapest way to get them.
  const polys = await tigerCounties(bbox, "20M");
  const fips = polys.map((p) => p.geoid);
  if (fips.length > MAX_BANK_COUNTIES) return { tooMany: fips.length };
  const r = await cached(`finance:banks:${bbox.join(",")}`, 6 * H, async () => {
    const now = new Date();
    const at = now.toISOString();
    if (!fips.length) return { features: [], sodYear: null as number | null, counties: 0, truncated: 0, caveats: ["No US county in the box."], provenance: [tigerProvenance(at, "20M")] };
    const branches = await branchesForCounties(fips);
    let sod: SodRow[] = [];
    let sodYear: number | null = null;
    for (const y of sodYears(now)) {
      const rows = await sodForCounties(fips, y).catch(() => [] as SodRow[]);
      if (rows.length) {
        sod = rows;
        sodYear = y;
        break;
      }
    }
    const features = buildBranches(branches.rows, sod, sodYear);
    const caveats: string[] = [];
    if (branches.truncated.length) caveats.push(`FDIC's 10,000-row page was full for ${branches.truncated.length} county group(s); some offices are missing. Zoom in.`);
    if (sodYear == null) caveats.push("No Summary of Deposits rows for these counties in the last three survey years; deposits are blank.");
    else caveats.push(`Deposits are the FDIC Summary of Deposits as of 30 June ${sodYear}; offices opened since, and offices FDIC could not match, show none.`);
    caveats.push("Office addresses are business addresses published by FDIC; no data about individuals.");
    const prov: Provenance[] = [
      fdicProvenance({ kind: "published", seriesId: "locations", upstreamUrl: branches.urls[0], retrievedAt: at, notes: [`${branches.urls.length} request(s) of up to ${MAX_BANK_COUNTIES} counties each`] }),
      tigerProvenance(at, "20M"),
    ];
    if (sodYear != null) prov.push(fdicProvenance({ kind: "published", seriesId: `sod:${sodYear}`, period: `${sodYear}-06-30`, retrievedAt: at, notes: ["DEPSUMBR in $ thousands upstream; dollars here"] }));
    return { features, sodYear, counties: fips.length, truncated: branches.truncated.length, caveats, provenance: prov };
  });
  const v = r.value;
  return {
    data: { type: "FeatureCollection", features: v.features },
    meta: { source: "FDIC BankFind Suite + Census TIGERweb", bbox, counties: v.counties, offices: v.features.length, sodYear: v.sodYear, cacheAge: r.age },
    ttlS: 6 * 3600,
    provenance: v.provenance,
    caveats: v.caveats,
    csv: () => ({ rows: flattenBranches(v.features), columns: BRANCH_COLUMNS, filename: `finance-banks-${bbox.join("_")}.csv` }),
  };
}

async function opDeposits(fips: string): Promise<OpResult | null> {
  const now = new Date();
  const latest = await latestSod(fips, now);
  if (!latest) return null;
  const d = countyDeposits(fips, latest.year, latest.rows, latest.url, now.toISOString());
  return {
    data: d,
    meta: { source: "FDIC Summary of Deposits", fips, year: d.year, triedYears: sodYears(now) },
    ttlS: 24 * 3600,
    provenance: d.provenance,
    caveats: ["Summary of Deposits is annual as of June 30; deposits are assigned to the office that books them, which for some banks is a headquarters."],
    csv: () => ({ rows: flattenDeposits(d), columns: BANK_SHARE_COLUMNS, filename: `finance-deposits-${fips}-${d.year}.csv` }),
  };
}

async function opBank(cert: number): Promise<OpResult | null> {
  const p = await bankProfile(cert);
  if (!p.institution && !p.rows.length) return null;
  return {
    data: p,
    meta: { source: "FDIC BankFind Suite", cert, quarters: p.rows.length, latest: p.rows[0]?.reportDate ?? null },
    ttlS: 6 * 3600,
    provenance: p.provenance,
    caveats: ["Call Report figures in $ thousands; ROA, ROE and the noncurrent ratio are percent as FDIC computes them; year-to-date items reset each January."],
    csv: () => ({ rows: flattenFinancials(cert, p.rows), columns: FINANCIALS_COLUMNS, filename: `finance-bank-${cert}.csv` }),
  };
}

async function opFailures(year: number): Promise<OpResult> {
  const f = await bankFailures(year);
  return {
    data: f.rows,
    meta: { source: "FDIC BankFind Suite (failures)", year, count: f.rows.length },
    ttlS: 24 * 3600,
    provenance: [fdicProvenance({ kind: "published", seriesId: `failures:${year}`, upstreamUrl: f.url, period: String(year) })],
    caveats: ["Assets and deposits are from the last quarterly report before failure; cost is FDIC's estimated loss to the insurance fund and is revised."],
    csv: () => ({ rows: flattenFailures(f.rows), columns: FAILURE_COLUMNS, filename: `finance-failures-${year}.csv` }),
  };
}

// ---- spending

async function opSpending(levelIn: AreaLevel, bbox: Bbox | null, fyIn: number | null): Promise<OpResult> {
  const now = new Date();
  const fy = fyIn ?? latestCompleteFy(now);
  const caveats: string[] = [];
  let level = levelIn;
  let polys: AreaPoly[] = [];
  if (level === "county") {
    polys = await tigerCounties(bbox!, detailFor(bbox!));
    if (polys.length > MAX_SPENDING_COUNTIES) {
      caveats.push(`${polys.length} counties in the box (limit ${MAX_SPENDING_COUNTIES}); showing states instead. Zoom in for counties.`);
      level = "state";
    }
  }
  if (level === "state") polys = await tigerStates();
  const key = `finance:spending:${level}:${fy}:${level === "county" ? bbox!.join(",") : "all"}`;
  const r = await cached(key, 12 * H, async () => {
    const at = new Date().toISOString();
    const [table, ytd, q, states] = await Promise.all([
      obligationsByArea(level, fy),
      obligationsToDate(level, now).catch(() => null),
      qcewLatest().catch(() => null),
      stateLookup().catch(() => null),
    ]);
    const obligations = new Map<string, AreaObligations>();
    const toDate = new Map<string, ToDateObligations>();
    if (level === "county") {
      // County shape codes are five-digit FIPS; guard against a dropped leading zero.
      for (const [code, v] of table.byArea) obligations.set(code.padStart(5, "0"), v);
      if (ytd) for (const code of ytd.byArea.keys()) toDate.set(code.padStart(5, "0"), toDateFor(ytd, code));
    } else {
      // State shape codes are USPS letters; TIGERweb keys states by FIPS.
      const byUsps = new Map<string, string>();
      if (states) for (const [geoid, s] of states) byUsps.set(s.stusab, geoid);
      for (const [code, v] of table.byArea) {
        const g = byUsps.get(code.toUpperCase());
        if (g) obligations.set(g, v);
      }
      if (ytd) {
        for (const code of ytd.byArea.keys()) {
          const g = byUsps.get(code.toUpperCase());
          if (g) toDate.set(g, toDateFor(ytd, code));
        }
      }
    }
    const jobs: Map<string, JobsRow> = q ? (level === "county" ? q.counties : q.states) : new Map();
    const stateNames = new Map<string, string>();
    if (states && level === "county") for (const [fips, s] of states) stateNames.set(fips, s.name);
    const joins: SpendingJoins = { obligations, toDate, jobs, stateNames: level === "county" ? new Map([...polys].map((p) => [p.geoid, stateNames.get(p.geoid.slice(0, 2)) ?? ""])) : undefined };
    const features = buildSpendingAreas(await withStusab(polys), level, joins);
    const prov: Provenance[] = [table.provenance];
    if (ytd) prov.push(ytd.provenance);
    if (q) prov.push(qcewProvenance(q.period, at, { notes: ["employment denominator for the per-job estimate"] }));
    prov.push(tigerProvenance(at, level === "state" ? "20M" : detailFor(bbox ?? [0, 0, 0, 0])));
    if (q) prov.push(provenance(source("usaspending"), { kind: "estimate", method: `per job = FY${fy} obligations / BLS QCEW ${q.period} covered employment (all ownerships)`, retrievedAt: at }));
    const notes: string[] = [];
    if (table.failed.length) notes.push(`USAspending did not answer for ${table.failed.join(", ")}; those cells are null and totals omit them.`);
    if (!ytd) notes.push("Fiscal-year-to-date request did not answer.");
    if (!q) notes.push("BLS QCEW did not answer; no per-job figures.");
    return { features, fy, level, qcewPeriod: q?.period ?? null, ytdFy: ytd?.fy ?? null, ytdThrough: ytd?.through ?? null, failed: table.failed, provenance: prov, notes };
  });
  const v = r.value;
  caveats.push(...v.notes);
  caveats.push("Obligations are what agencies committed in the period, not outlays; amounts are by place of performance, not recipient location.");
  if (fy === fiscalYearOf(now)) caveats.push(`FY${fy} is still open; figures are partial.`);
  else if (fy === latestCompleteFy(now) && daysSinceFyClose(now) < REPORTING_LAG_DAYS) caveats.push(`FY${fy} closed ${daysSinceFyClose(now)} days ago; agencies report with up to a ${REPORTING_LAG_DAYS}-day lag, so totals are still filling in.`);
  return {
    data: { type: "FeatureCollection", features: v.features },
    meta: { source: "USAspending + BLS QCEW + Census TIGERweb", fy: v.fy, level: v.level, bbox, areas: v.features.length, qcewPeriod: v.qcewPeriod, ytdFy: v.ytdFy, ytdThrough: v.ytdThrough, failed: v.failed, cacheAge: r.age },
    ttlS: 12 * 3600,
    provenance: v.provenance,
    caveats,
    csv: () => ({ rows: flattenSpendingAreas(v.features), columns: SPENDING_AREA_COLUMNS, filename: `finance-spending-${v.level}-FY${v.fy}.csv` }),
  };
}

async function opSpendingDetail(fips: string, fyIn: number | null): Promise<OpResult | null> {
  const now = new Date();
  const fy = fyIn ?? latestCompleteFy(now);
  const states = await stateLookup();
  const stusab = states.get(fips.slice(0, 2))?.stusab;
  if (!stusab) return null;
  const d = await countySpendingDetail(fips, stusab, fy);
  return {
    data: d,
    meta: { source: "USAspending", fips, state: stusab, fy },
    ttlS: 12 * 3600,
    provenance: d.provenance,
    caveats: ["Recipients are legal entities as registered in SAM.gov; NAICS covers contracts only; obligations, not outlays."],
    csv: () => ({ rows: flattenDetail(d), columns: CATEGORY_COLUMNS, filename: `finance-spending-detail-${fips}-FY${fy}.csv` }),
  };
}

/** The finance section of the market report for one county, from the same caches the layers use. */
async function opSection(fips: string, fyIn: number | null): Promise<OpResult> {
  const now = new Date();
  const fy = fyIn ?? latestCompleteFy(now);
  const r = await financeFor(fips, { fy, now });
  return {
    data: r.section,
    meta: { source: "FDIC Summary of Deposits + USAspending + BLS QCEW", fips, fy, sodYear: r.section.data.deposits?.year ?? null, failed: r.failed },
    ttlS: 12 * 3600,
    provenance: r.provenance,
    caveats: r.caveats,
  };
}

// ---- dispatch

function respond(r: OpResult, format: ResponseFormat, op: string) {
  if (format === "csv") {
    if (!r.csv) return badRequest(`format=csv is not offered for op=${op}; tabular ops are banks, deposits, bank, failures, spending, spending-detail`);
    const t = r.csv();
    return csvResponse(t.rows, { columns: [...t.columns], filename: t.filename, provenance: r.provenance, caveats: r.caveats, ttlS: r.ttlS });
  }
  return ok(r.data, { meta: r.meta, provenance: r.provenance, caveats: r.caveats, ttlS: r.ttlS });
}

export const OPTIONS = options;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  const format = parseFormat(req);
  const now = new Date();
  try {
    switch (op) {
      case "banks": {
        const b = parseBbox(q.get("bbox"));
        if (!b) return badRequest("bbox=w,s,e,n required (degrees, west < east, south < north)");
        const r = await opBanks(b);
        if ("tooMany" in r) return badRequest(`zoom in: ${r.tooMany} counties in the box, at most ${MAX_BANK_COUNTIES} per call`, { counties: r.tooMany, max: MAX_BANK_COUNTIES });
        return respond(r, format, op);
      }
      case "deposits": {
        const fips = parseCountyFips(q.get("fips"));
        if (!fips) return badRequest("fips=SSCCC (five-digit county FIPS) required");
        const r = await opDeposits(fips);
        if (!r) return notFound(`no Summary of Deposits rows for county ${fips} in ${sodYears(now).join(", ")}`, { fips });
        return respond(r, format, op);
      }
      case "bank": {
        const cert = parseCert(q.get("cert"));
        if (!cert) return badRequest("cert=<FDIC certificate number> required (1 to 999999)");
        const r = await opBank(cert);
        if (!r) return notFound(`no FDIC institution with certificate ${cert}`, { cert });
        return respond(r, format, op);
      }
      case "failures": {
        const year = parseYear(q.get("year"), MIN_FAILURE_YEAR, now.getUTCFullYear(), now.getUTCFullYear());
        if (year == null) return badRequest(`year=YYYY between ${MIN_FAILURE_YEAR} and ${now.getUTCFullYear()}`);
        return respond(await opFailures(year), format, op);
      }
      case "spending": {
        const level: AreaLevel = q.get("level") === "state" ? "state" : "county";
        const b = level === "county" ? parseBbox(q.get("bbox")) : null;
        if (level === "county" && !b) return badRequest("bbox=w,s,e,n required for level=county (or pass level=state)");
        const fy = parseYear(q.get("fy"), MIN_FY, fiscalYearOf(now), latestCompleteFy(now));
        if (fy == null) return badRequest(`fy=YYYY between ${MIN_FY} and ${fiscalYearOf(now)} (federal fiscal year; default ${latestCompleteFy(now)})`);
        return respond(await opSpending(level, b, q.get("fy") ? fy : null), format, op);
      }
      case "spending-detail": {
        const fips = parseCountyFips(q.get("fips"));
        if (!fips) return badRequest("fips=SSCCC (five-digit county FIPS) required");
        const fy = parseYear(q.get("fy"), MIN_FY, fiscalYearOf(now), latestCompleteFy(now));
        if (fy == null) return badRequest(`fy=YYYY between ${MIN_FY} and ${fiscalYearOf(now)}`);
        const r = await opSpendingDetail(fips, q.get("fy") ? fy : null);
        if (!r) return notFound(`unknown state FIPS ${fips.slice(0, 2)}`, { fips });
        return respond(r, format, op);
      }
      case "section": {
        const fips = parseCountyFips(q.get("fips"));
        if (!fips) return badRequest("fips=SSCCC (five-digit county FIPS) required");
        const fy = parseYear(q.get("fy"), MIN_FY, fiscalYearOf(now), latestCompleteFy(now));
        if (fy == null) return badRequest(`fy=YYYY between ${MIN_FY} and ${fiscalYearOf(now)}`);
        return respond(await opSection(fips, q.get("fy") ? fy : null), format, op);
      }
      default:
        return badRequest("unknown op: banks | deposits | bank | failures | spending | spending-detail | section");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
