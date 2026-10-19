// Pure builders for the banks and spending layers. Upstream rows in,
// GeoJSON features out; shared by the route, the browser layers and the
// finance section of the market report. Nothing here touches the network,
// the store or Cesium.
//
// Values are never invented: an office the Summary of Deposits does not
// list has no `deposits`, a county USAspending has no row for is skipped, a
// county whose QCEW cell is withheld has no per-job figure.

import type { MultiPolygon, Point, Polygon } from "geojson";
import type { BaseProps, LayerFeature } from "@/lib/layers/types";
import { fmtNum, fmtUsd, type AreaLevel, type AreaPoly, type JobsRow } from "@/lib/economy/features";
import { perJob } from "./estimates";
import { AWARD_GROUP_IDS, AWARD_GROUPS, type AreaObligations, type Branch, type PerJob, type SodRow, type SpendingDetail, type ToDateObligations } from "./types";

// ---- banks

export interface BranchExtra {
  cert: number;
  officeNum: number | null;
  uninum: number | null;
  /** Institution name as FDIC spells it. */
  bank: string;
  shortName: string;
  office: string;
  fips: string;
  address: string | null;
  city: string;
  state: string;
  zip: string;
  serviceType: string | null;
  established: string | null;
  /** Deposits at this office, dollars, from the Summary of Deposits join; null when not listed. */
  deposits: number | null;
  sodYear: number | null;
  /** Among the largest offices in the response by deposits; the style keeps its label. */
  labelled?: boolean;
}

const KEEP_CASE: Record<string, string> = {
  JPMORGAN: "JPMorgan",
  KEYBANK: "KeyBank",
  USAA: "USAA",
  HSBC: "HSBC",
  MUFG: "MUFG",
  BOKF: "BOKF",
  BBVA: "BBVA",
  BANCORPSOUTH: "BancorpSouth",
  FIRSTBANK: "FirstBank",
  "U.S.": "U.S.",
  LLC: "LLC",
};
const SMALL = new Set(["of", "and", "the", "&"]);

/**
 * "JPMORGAN CHASE BANK, NATIONAL ASSOCIATION" -> "JPMorgan Chase Bank".
 * Drops the charter suffixes FDIC appends and title-cases the rest; short
 * all-caps tokens (PNC, TD) stay as they are. For labels only; the full
 * name is kept in the feature.
 */
export function shortBankName(name: string): string {
  let s = name.trim().replace(/\s+/g, " ");
  // Each suffix must follow a comma or whitespace so "MONTANA" keeps its "NA".
  s = s
    .replace(/(,\s*|\s+)national association$/i, "")
    .replace(/(,\s*|\s+)n\.?a\.?$/i, "")
    .replace(/(,\s*|\s+)federal savings bank$/i, " FSB")
    .replace(/(,\s*|\s+)(a )?federal savings (and loan )?association$/i, " FSA")
    .replace(/(,\s*|\s+)(s\.?s\.?b\.?|f\.?s\.?b\.?)$/i, (m) => " " + m.replace(/[,.\s]/g, "").toUpperCase())
    .replace(/^the\s+/i, "")
    .trim();
  return s
    .split(" ")
    .map((tok, i) => {
      const up = tok.toUpperCase();
      if (KEEP_CASE[up]) return KEEP_CASE[up];
      const lower = tok.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      if (/^[A-Z]{2,3}$/.test(tok)) return tok;
      return lower.replace(/(^|[-'/])(\p{L})/gu, (m, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join(" ");
}

const SERVICE_TYPES: Record<string, string> = {
  "11": "full service, brick and mortar",
  "12": "full service, retail",
  "13": "full service, cyber",
  "14": "full service, mobile",
  "15": "full service, home",
  "16": "full service, seasonal",
  "21": "limited service, administrative",
  "22": "limited service, military",
  "23": "limited service, facility",
  "24": "limited service, loan production",
  "25": "limited service, consumer credit",
  "26": "limited service, contractual",
  "27": "limited service, messenger",
  "28": "limited service, retail",
  "29": "limited service, mobile",
  "30": "limited service, trust",
};

export function serviceTypeLabel(code: string | null): string | undefined {
  if (!code) return undefined;
  return SERVICE_TYPES[code] ?? `service type ${code}`;
}

/** Join key shared by /locations (CERT+OFFNUM) and /sod (CERT+BRNUM); the main office is 0 in both. */
export function sodKey(cert: number, officeNum: number | null): string {
  return `${cert}:${officeNum ?? 0}`;
}

/** Index SOD rows by office (CERT+BRNUM) and by FDIC office id, so either join works. */
export function indexSod(rows: SodRow[]): { byOffice: Map<string, SodRow>; byUninum: Map<number, SodRow> } {
  const byOffice = new Map<string, SodRow>();
  const byUninum = new Map<number, SodRow>();
  for (const r of rows) {
    byOffice.set(sodKey(r.cert, r.brnum), r);
    if (r.uninum != null) byUninum.set(r.uninum, r);
  }
  return { byOffice, byUninum };
}

/**
 * FDIC offices with Summary of Deposits joined where an office matches.
 * Offices FDIC publishes without coordinates are dropped (nothing to place).
 */
export function buildBranches(branches: Branch[], sod: SodRow[], sodYear: number | null, labelTop = 30): LayerFeature<Point>[] {
  const idx = indexSod(sod);
  const out: LayerFeature<Point>[] = [];
  const seen = new Set<string>();
  for (const b of branches) {
    if (b.lat == null || b.lon == null || Math.abs(b.lat) > 90 || Math.abs(b.lon) > 180) continue;
    const id = `branch:${b.cert}:${b.uninum ?? `o${b.officeNum ?? 0}`}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const row = idx.byOffice.get(sodKey(b.cert, b.officeNum)) ?? (b.uninum != null ? idx.byUninum.get(b.uninum) : undefined);
    const deposits = row?.deposits != null ? row.deposits * 1000 : null;
    const shortName = shortBankName(b.name);
    const details: BaseProps["details"] = {
      bank: b.name,
      office: b.office !== b.name ? b.office : undefined,
      address: b.address ? `${b.address}, ${b.city}, ${b.state} ${b.zip}` : `${b.city}, ${b.state} ${b.zip}`,
      deposits: deposits != null ? `${fmtUsd(deposits)} (SOD ${row!.year})` : "not in the Summary of Deposits",
      service: serviceTypeLabel(b.serviceType),
      established: b.established ?? undefined,
      "FDIC cert": b.cert,
      county: b.fips,
    };
    const extra: BranchExtra = {
      cert: b.cert,
      officeNum: b.officeNum,
      uninum: b.uninum,
      bank: b.name,
      shortName,
      office: b.office,
      fips: b.fips,
      address: b.address,
      city: b.city,
      state: b.state,
      zip: b.zip,
      serviceType: b.serviceType,
      established: b.established,
      deposits,
      sodYear: row?.year ?? sodYear,
    };
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [b.lon, b.lat, 0] },
      properties: { id, layer: "banks", name: b.office !== b.name ? `${shortName} · ${b.office}` : shortName, kind: "branch", source: deposits != null ? "FDIC BankFind · Summary of Deposits" : "FDIC BankFind", details, extra },
    });
  }
  [...out]
    .filter((f) => (f.properties.extra as BranchExtra).deposits != null)
    .sort((a, b) => (b.properties.extra as BranchExtra).deposits! - (a.properties.extra as BranchExtra).deposits!)
    .slice(0, labelTop)
    .forEach((f) => ((f.properties.extra as BranchExtra).labelled = true));
  return out;
}

// ---- spending

export interface SpendingExtra {
  geoid: string;
  level: AreaLevel;
  name: string;
  stusab?: string;
  stateName?: string;
  obligations: AreaObligations;
  toDate: ToDateObligations | null;
  jobs?: { emp: number | null; period: string; suppressed: boolean };
  perJob: PerJob | null;
  /** Among the largest areas in the response; the style keeps its label. */
  labelled?: boolean;
  /** Loaded on selection by the aside (recipients, agencies, NAICS, trace). */
  detail?: SpendingDetail;
}

export interface SpendingJoins {
  /** GEOID -> obligations for the latest complete fiscal year. */
  obligations: Map<string, AreaObligations>;
  /** GEOID -> fiscal-year-to-date total. */
  toDate?: Map<string, ToDateObligations>;
  /** GEOID -> QCEW row (counties by 5-digit FIPS, states by 2-digit). */
  jobs: Map<string, JobsRow>;
  stateNames?: Map<string, string>;
}

/** TIGERweb polygons joined with USAspending obligations and QCEW employment; areas with no obligations row are skipped. */
export function buildSpendingAreas(polys: AreaPoly[], level: AreaLevel, joins: SpendingJoins): LayerFeature<Polygon | MultiPolygon>[] {
  const out: LayerFeature<Polygon | MultiPolygon>[] = [];
  for (const p of polys) {
    const ob = joins.obligations.get(p.geoid);
    if (!ob) continue;
    const jobsRow = joins.jobs.get(p.geoid);
    const toDate = joins.toDate?.get(p.geoid) ?? null;
    const pj = jobsRow && !jobsRow.suppressed ? perJob(ob.total, jobsRow.emp, jobsRow.period, ob.fy) : null;
    const stateName = joins.stateNames?.get(p.geoid) ?? (level === "state" ? p.name : undefined);
    const details: BaseProps["details"] = { [`FY${ob.fy} obligations`]: fmtUsd(ob.total) };
    for (const g of AWARD_GROUP_IDS) {
      const v = ob.byGroup[g];
      details[AWARD_GROUPS[g].label] = v == null ? "did not answer" : fmtUsd(v);
    }
    if (toDate) details[`FY${toDate.fy} to date`] = toDate.total == null ? "no row" : `${fmtUsd(toDate.total)} (through ${toDate.through})`;
    if (pj) details["per job"] = `${fmtUsd(pj.value)} (estimate)`;
    if (jobsRow) details["covered jobs"] = jobsRow.suppressed ? "withheld by BLS" : `${fmtNum(jobsRow.emp)} (QCEW ${jobsRow.period})`;
    const extra: SpendingExtra = {
      geoid: p.geoid,
      level,
      name: p.name,
      stusab: p.stusab,
      stateName,
      obligations: ob,
      toDate,
      jobs: jobsRow ? { emp: jobsRow.emp, period: jobsRow.period, suppressed: jobsRow.suppressed } : undefined,
      perJob: pj,
    };
    const name = level === "state" ? p.name : p.stusab ? `${p.name}, ${p.stusab}` : p.name;
    out.push({
      type: "Feature",
      geometry: p.geometry,
      properties: {
        id: `${level}:${p.geoid}`,
        layer: "spending",
        name,
        kind: level,
        source: pj ? "USAspending · BLS QCEW · Census TIGERweb" : "USAspending · Census TIGERweb",
        anchor: [p.lon, p.lat],
        details,
        extra,
      },
    });
  }
  const n = level === "state" ? 60 : 12;
  const x = (f: LayerFeature) => f.properties.extra as SpendingExtra;
  [...out]
    .sort((a, b) => (x(b).obligations.total ?? 0) - (x(a).obligations.total ?? 0))
    .slice(0, n)
    .forEach((f) => (x(f).labelled = true));
  return out;
}

/** Colour ramp input: per-job obligations, or null when no jobs figure. Exported so the style and the legend agree. */
export const PER_JOB_STOPS: Array<[max: number, color: string, alpha: number]> = [
  [1_000, "#3B4A5A", 0.14],
  [3_000, "#4B6C8F", 0.2],
  [7_500, "#3F8FA8", 0.26],
  [15_000, "#43B79A", 0.3],
  [40_000, "#8DE7A8", 0.34],
  [Number.POSITIVE_INFINITY, "#FFD166", 0.4],
];

export function perJobFill(v: number | null | undefined): [string, number] {
  if (v == null || !Number.isFinite(v)) return ["#6E7F8C", 0.1];
  for (const [max, color, alpha] of PER_JOB_STOPS) if (v < max) return [color, alpha];
  return ["#FFD166", 0.4];
}
