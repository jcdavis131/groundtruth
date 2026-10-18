// Labelled estimates for the finance layers. Each one returns the arithmetic
// it ran so a reader can check it. Nothing here is advice.

import { fmtNum, fmtUsd } from "@/lib/economy/features";
import type { BankShare, Hhi, PerJob, SodRow } from "./types";

/**
 * Sum Summary of Deposits rows by institution and rank by deposits.
 * SOD publishes $ thousands; shares are returned in dollars. Rows whose
 * deposits the upstream withheld count as a branch but add nothing.
 */
export function marketShares(rows: SodRow[]): BankShare[] {
  const byCert = new Map<number, BankShare>();
  let total = 0;
  for (const r of rows) {
    const cur = byCert.get(r.cert) ?? { cert: r.cert, name: r.name, deposits: 0, branches: 0, sharePct: 0 };
    cur.branches += 1;
    if (r.deposits != null) {
      cur.deposits += r.deposits * 1000;
      total += r.deposits * 1000;
    }
    byCert.set(r.cert, cur);
  }
  const out = [...byCert.values()].sort((a, b) => b.deposits - a.deposits || a.name.localeCompare(b.name));
  for (const s of out) s.sharePct = total > 0 ? (s.deposits / total) * 100 : 0;
  return out;
}

export function hhiLabel(value: number): Hhi["label"] {
  if (value < 1000) return "unconcentrated";
  if (value <= 1800) return "moderately concentrated";
  return "highly concentrated";
}

/**
 * Herfindahl-Hirschman index: the sum of squared market shares in percent,
 * 0 to 10,000. Thresholds follow the DOJ 1995 bank merger screen (1000 /
 * 1800), which is what bank regulators still cite for deposit markets.
 */
export function hhi(shares: BankShare[]): Hhi | null {
  const withDeposits = shares.filter((s) => s.deposits > 0);
  if (!withDeposits.length) return null;
  const value = withDeposits.reduce((a, s) => a + s.sharePct * s.sharePct, 0);
  const shown = withDeposits.slice(0, 3).map((s) => `${s.sharePct.toFixed(1)}²`);
  const rest = withDeposits.length - shown.length;
  return {
    value,
    label: hhiLabel(value),
    banks: withDeposits.length,
    formula: `HHI = Σ (share %)² over ${withDeposits.length} banks with deposits in the county = ${shown.join(" + ")}${rest > 0 ? ` + … (${rest} more)` : ""} = ${Math.round(value).toLocaleString()}`,
  };
}

/**
 * Federal obligations per covered job. Obligations are what the government
 * committed in the period (not what it paid out); jobs are QCEW third-month
 * employment for all ownerships, so a county with a big federal employer
 * counts those jobs too.
 */
export function perJob(obligations: number | null | undefined, jobs: number | null | undefined, jobsPeriod: string | undefined, fy: number): PerJob | null {
  if (obligations == null || jobs == null || !Number.isFinite(obligations) || !Number.isFinite(jobs) || jobs <= 0) return null;
  const value = obligations / jobs;
  return {
    value,
    obligations,
    jobs,
    jobsPeriod: jobsPeriod ?? "",
    formula: `per job = FY${fy} obligations ${fmtUsd(obligations)} / ${fmtNum(jobs)} covered jobs (BLS QCEW ${jobsPeriod ?? "latest"}, all ownerships) = ${fmtUsd(value)}`,
  };
}

/** Share of a total, percent; null when the total is missing or zero. */
export function sharePct(part: number | null | undefined, total: number | null | undefined): number | null {
  if (part == null || total == null || !Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return (part / total) * 100;
}
