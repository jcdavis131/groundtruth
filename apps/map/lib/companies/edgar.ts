// SEC EDGAR readers: the ticker lists, a filer's submissions (profile,
// business address, recent filings), its XBRL company facts and the frames
// API (one concept, one period, every filer). Keyless. The Commission's
// fair-access policy asks for a descriptive User-Agent with a contact and at
// most ten requests a second; the polite gate below keeps us at ~8/s and the
// in-memory cache means a company is asked for once every twelve hours. The
// one uncached read, submissionsUncached, vets a CIK that is not on the listed
// universe; app/api/companies caches only its yes/no verdict.
//
// The contact address travels in the request header only; nothing here puts
// it in a response body. Pure parsers are separated from the fetchers so
// tests run on fixtures.
//
// shape per https://www.sec.gov/search-filings/edgar-application-programming-interfaces; unverified in sandbox

import { cached } from "@/lib/server/cache";
import { polite, upstreamJson } from "@/lib/server/upstream";
import type { CompanyFactsFile, CompanyListing, CompanyProfile, FactPoint, Filing, FrameFile, SubmissionsFile, TickersExchangeFile, TickersFile } from "./types";

export const EDGAR_BASE = "https://data.sec.gov";
export const SEC_FILES = "https://www.sec.gov/files";
export const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";

/** Min interval between SEC requests, ms: 120 ms is ~8/s, under the 10/s policy. */
export const SEC_MIN_INTERVAL_MS = 120;
export const SEC_BACKOFF_MS = 60_000;

const H = 3600_000;

/**
 * The User-Agent SEC calls send. It is deliberately not USER_AGENT plus a
 * contact: SEC answers 403 ("Undeclared Automated Tool" on data.sec.gov,
 * "Request Rate Threshold Exceeded" on www.sec.gov) to any UA carrying the
 * "(+https://github.com/...)" token, measured 2026-09-30, and 200 to this
 * one. Keep a contact and no URL here.
 */
export const SEC_USER_AGENT = "embedding-atlas/0.1 contact: jcdavis131@gmail.com";

const SEC_HEADERS = {
  // Fair-access policy: identify the app and give a way to reach its operator.
  "user-agent": SEC_USER_AGENT,
  "accept-encoding": "gzip, deflate",
  accept: "application/json",
};

function secJson<T>(url: string): Promise<T> {
  return polite("sec", SEC_MIN_INTERVAL_MS, SEC_BACKOFF_MS, () => upstreamJson<T>("sec-edgar", url, { headers: SEC_HEADERS, timeoutMs: 30_000 }));
}

/** Ten-digit zero-padded CIK as EDGAR file names use it. */
export function padCik(cik: number | string): string {
  const digits = String(cik).replace(/\D/g, "");
  return digits.padStart(10, "0");
}

/** "CIK0000320193" as the provenance seriesId prefix. */
export function cikId(cik: number | string): string {
  return `CIK${padCik(cik)}`;
}

/** EDGAR's company page. */
export function edgarCompanyUrl(cik: number | string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padCik(cik)}&type=&dateb=&owner=exclude&count=40`;
}

/** Primary document of a filing: /Archives/edgar/data/<cik>/<accession without dashes>/<document>. */
export function filingUrl(cik: number | string, accession: string, primaryDocument: string): string {
  const n = Number(padCik(cik));
  return `${ARCHIVES}/${n}/${accession.replace(/-/g, "")}/${primaryDocument}`;
}

export function submissionsUrl(cik: number | string): string {
  return `${EDGAR_BASE}/submissions/CIK${padCik(cik)}.json`;
}

export function companyFactsUrl(cik: number | string): string {
  return `${EDGAR_BASE}/api/xbrl/companyfacts/CIK${padCik(cik)}.json`;
}

export function frameUrl(taxonomy: string, concept: string, unit: string, period: string): string {
  return `${EDGAR_BASE}/api/xbrl/frames/${taxonomy}/${concept}/${unit}/${period}.json`;
}

// ---------------------------------------------------------------- parsers

/** company_tickers.json -> listings (exchange unknown in this file). */
export function parseTickers(json: TickersFile): CompanyListing[] {
  const out: CompanyListing[] = [];
  for (const row of Object.values(json ?? {})) {
    if (!row || typeof row !== "object") continue;
    const cik = Number(row.cik_str);
    const ticker = String(row.ticker ?? "").trim().toUpperCase();
    if (!Number.isFinite(cik) || cik <= 0 || !ticker) continue;
    out.push({ cik, name: String(row.title ?? "").trim(), ticker, exchange: null });
  }
  return out;
}

/** company_tickers_exchange.json -> listings; column order is read from `fields`, not assumed. */
export function parseTickersExchange(json: TickersExchangeFile): CompanyListing[] {
  const fields = json?.fields ?? [];
  const idx = (name: string) => fields.indexOf(name);
  const iCik = idx("cik");
  const iName = idx("name");
  const iTicker = idx("ticker");
  const iExch = idx("exchange");
  if (iCik < 0 || iTicker < 0) throw new Error("company_tickers_exchange.json: fields cik/ticker missing");
  const out: CompanyListing[] = [];
  for (const row of json.data ?? []) {
    const cik = Number(row[iCik]);
    const ticker = String(row[iTicker] ?? "").trim().toUpperCase();
    if (!Number.isFinite(cik) || cik <= 0 || !ticker) continue;
    const exch = iExch >= 0 ? String(row[iExch] ?? "").trim() : "";
    out.push({ cik, name: iName >= 0 ? String(row[iName] ?? "").trim() : "", ticker, exchange: exch || null });
  }
  return out;
}

function str(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

/** Profile from a submissions file. Only the business address is read; the mailing address is not. */
export function parseProfile(j: SubmissionsFile): CompanyProfile {
  const cik = Number(j.cik);
  const b = j.addresses?.business ?? null;
  const recent = j.filings?.recent?.accessionNumber?.length ?? 0;
  return {
    cik,
    name: String(j.name ?? "").trim(),
    tickers: (j.tickers ?? []).map((t) => String(t).toUpperCase()),
    exchanges: (j.exchanges ?? []).map((e) => String(e)),
    sic: str(j.sic),
    sicDescription: str(j.sicDescription),
    stateOfIncorporation: str(j.stateOfIncorporation),
    fiscalYearEnd: str(j.fiscalYearEnd),
    entityType: str(j.entityType),
    business: b ? { street1: str(b.street1), city: str(b.city), state: str(b.stateOrCountry), zip: str(b.zipCode) } : null,
    recentFilings: recent,
    edgarUrl: edgarCompanyUrl(cik),
  };
}

/**
 * Whether a submissions file belongs to an operating company with an SIC
 * code. EDGAR gives individuals (insiders who file Forms 3/4/5) a CIK too;
 * their files say entityType "other" and carry no SIC. The dossier serves
 * institutions only, so a CIK that is not on the listed universe must pass
 * this before anything about it is cached or returned.
 */
export function isOperatingIssuer(j: SubmissionsFile): boolean {
  return str(j.entityType) === "operating" && str(j.sic) != null;
}

/** Forms the dossier shows: periodic reports and current reports, amendments included. Ownership forms (3/4/5) are excluded on purpose. */
export const DOSSIER_FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "8-K12B", "20-F", "20-F/A", "40-F", "6-K"]);

/** Recent filings from a submissions file, newest first, filtered to `forms`, at most `limit`. */
export function parseFilings(j: SubmissionsFile, limit = 20, forms: Set<string> = DOSSIER_FORMS): Filing[] {
  const r = j.filings?.recent;
  if (!r?.accessionNumber) return [];
  const n = r.accessionNumber.length;
  const cik = Number(j.cik);
  const out: Filing[] = [];
  for (let i = 0; i < n && out.length < limit; i++) {
    const form = String(r.form?.[i] ?? "").trim();
    if (!forms.has(form)) continue;
    const accession = String(r.accessionNumber[i] ?? "");
    const doc = String(r.primaryDocument?.[i] ?? "");
    if (!accession) continue;
    out.push({
      accession,
      form,
      filed: String(r.filingDate?.[i] ?? ""),
      reportDate: str(r.reportDate?.[i]) ?? undefined,
      primaryDocument: doc,
      description: String(r.primaryDocDescription?.[i] ?? "").trim(),
      url: doc ? filingUrl(cik, accession, doc) : `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/`,
    });
  }
  return out.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
}

/** Every point for one concept in one unit from a companyfacts file, or [] when the filer never tagged it. */
export function factPoints(j: CompanyFactsFile, taxonomy: string, concept: string, unit: string): FactPoint[] {
  const units = j?.facts?.[taxonomy]?.[concept]?.units;
  const pts = units?.[unit];
  if (!Array.isArray(pts)) return [];
  return pts.filter((p) => p && typeof p.val === "number" && Number.isFinite(p.val) && typeof p.end === "string");
}

/** Frame rows keyed by CIK. A filer appears once per frame by construction. */
export function parseFrame(j: FrameFile): Map<number, { val: number; end: string; accn: string; entityName: string; start?: string }> {
  const out = new Map<number, { val: number; end: string; accn: string; entityName: string; start?: string }>();
  for (const d of j?.data ?? []) {
    const cik = Number(d.cik);
    if (!Number.isFinite(cik) || typeof d.val !== "number" || !Number.isFinite(d.val)) continue;
    out.set(cik, { val: d.val, end: String(d.end), accn: String(d.accn ?? ""), entityName: String(d.entityName ?? ""), start: d.start });
  }
  return out;
}

// ---------------------------------------------------------------- fetchers (server only)

/** All listed tickers with their exchange. Cached a day; the file changes daily at most. */
export function tickersExchange(): Promise<CompanyListing[]> {
  return cached("sec:tickers-exchange", 24 * H, async () => parseTickersExchange(await secJson<TickersExchangeFile>(`${SEC_FILES}/company_tickers_exchange.json`))).then((c) => c.value);
}

/** The plain ticker list (no exchange); used as a fallback lookup. */
export function tickers(): Promise<CompanyListing[]> {
  return cached("sec:tickers", 24 * H, async () => parseTickers(await secJson<TickersFile>(`${SEC_FILES}/company_tickers.json`))).then((c) => c.value);
}

/** A filer's submissions file: profile, addresses and the recent filings window. Cached 12 h. */
export function submissions(cik: number | string): Promise<SubmissionsFile> {
  return cached(`sec:submissions:${padCik(cik)}`, 12 * H, () => secJson<SubmissionsFile>(submissionsUrl(cik))).then((c) => c.value);
}

/**
 * The same file, never cached. Used to vet a CIK that is not on the listed
 * universe: if it turns out to be an individual, nothing about them may sit
 * in the cache.
 */
export function submissionsUncached(cik: number | string): Promise<SubmissionsFile> {
  return secJson<SubmissionsFile>(submissionsUrl(cik));
}

/** A filer's XBRL facts (every concept, every period). Large (MBs for big filers); cached 12 h. */
export function companyFacts(cik: number | string): Promise<CompanyFactsFile> {
  return cached(`sec:facts:${padCik(cik)}`, 12 * H, () => secJson<CompanyFactsFile>(companyFactsUrl(cik))).then((c) => c.value);
}

/** One concept for one calendar period across every filer. Cached a day. */
export function frame(taxonomy: string, concept: string, unit: string, period: string): Promise<FrameFile> {
  return cached(`sec:frame:${taxonomy}:${concept}:${unit}:${period}`, 24 * H, () => secJson<FrameFile>(frameUrl(taxonomy, concept, unit, period))).then((c) => c.value);
}
