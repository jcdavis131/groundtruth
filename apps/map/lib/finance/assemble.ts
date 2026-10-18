// The finance section of a place, assembled from the same caches the map
// layers use. This is the body /api/finance?op=section used to carry
// privately; it lives here so a place page can render banks and federal
// dollars without going back out through HTTP.
//
// Two properties are load-bearing and easy to lose in a refactor. First, the
// deposits input is TRI-state: a CountyDeposits means FDIC published rows, an
// explicit null means FDIC publishes nothing for this county (the section says
// so in words), and undefined means we never got an answer (the section is not
// loaded). financeSection() reads all three differently, so the distinction is
// preserved here rather than collapsed to a falsy check. Second, every upstream
// is raced against a per-call budget, because an ISR render that waits out four
// 60-second upstreams has already lost; a slow source degrades its own row and
// says so in a caveat.
//
// The caller may supply `stusab` from the offline places manifest. Without it
// we pay a stateLookup() round-trip to TIGERweb purely to learn two letters.

import { qcewLatest, stateLookup } from "@/lib/economy/sources";
import { qcewProvenance } from "@/lib/economy/provenance";
import { dedupeProvenance } from "@/lib/provenance/collect";
import type { Provenance } from "@/lib/provenance/types";
import { perJob } from "./estimates";
import { countyDeposits, latestSod } from "./fdic";
import { financeSection, type FinanceInputs, type FinanceSection } from "./report";
import type { SpendingDetail } from "./types";
import { countySpendingDetail, daysSinceFyClose, fiscalYearOf, latestCompleteFy, obligationsByArea, REPORTING_LAG_DAYS } from "./usaspending";

/** How long any one upstream may hold up the section before it becomes a caveat. */
export const FINANCE_BUDGET_MS = 8000;

export interface AssembledFinance {
  section: FinanceSection;
  /** Top recipients, agencies and NAICS, so a page renders them without a second call. */
  detail: SpendingDetail | null;
  provenance: Provenance[];
  caveats: string[];
  /** Source ids that did not answer within the budget. */
  failed: string[];
}

export interface FinanceOpts {
  fy?: number;
  now?: Date;
  retrievedAt?: string;
  /** Two-letter USPS code from the places manifest; skips the TIGERweb state lookup. */
  stusab?: string;
}

/** Race a request against the budget. The loser's rejection is absorbed by the race. */
function budgeted<T>(p: Promise<T>, label: string, ms = FINANCE_BUDGET_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms} ms`)), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  return Promise.race([p, clock]).finally(() => clearTimeout(timer));
}

/**
 * Deposits, federal obligations and the per-job estimate for one county.
 * Never throws: every upstream that fails becomes a caveat and a `failed` entry.
 */
export async function financeFor(fips: string, opts: FinanceOpts = {}): Promise<AssembledFinance> {
  const now = opts.now ?? new Date();
  const at = opts.retrievedAt ?? now.toISOString();
  const fy = opts.fy ?? latestCompleteFy(now);
  const caveats: string[] = [];
  const failed: string[] = [];

  let stusab = opts.stusab;
  if (!stusab) {
    const states = await budgeted(stateLookup(), "Census TIGERweb").catch(() => null);
    if (!states) failed.push("census-tigerweb");
    stusab = states?.get(fips.slice(0, 2))?.stusab;
  }

  const [sod, table, q, detail] = await Promise.allSettled([
    budgeted(latestSod(fips, now), "FDIC"),
    budgeted(obligationsByArea("county", fy), "USAspending"),
    budgeted(qcewLatest(), "BLS QCEW"),
    stusab ? budgeted(countySpendingDetail(fips, stusab, fy), "USAspending detail") : Promise.reject(new Error("unknown state FIPS")),
  ]);

  // Fulfilled-but-null is "FDIC publishes no rows here"; rejected is "we never asked successfully".
  const deposits = sod.status === "fulfilled" ? (sod.value ? countyDeposits(fips, sod.value.year, sod.value.rows, sod.value.url, at) : null) : undefined;
  if (sod.status === "rejected") {
    caveats.push("FDIC did not answer; no deposit figures.");
    failed.push("fdic-bankfind");
  }

  let spending: FinanceInputs["spending"];
  if (table.status === "fulfilled") {
    const ob = table.value.byArea.get(fips) ?? null;
    if (ob) {
      const jobs = q.status === "fulfilled" ? q.value.counties.get(fips) : undefined;
      const pj = jobs && !jobs.suppressed ? perJob(ob.total, jobs.emp, jobs.period, fy) : null;
      const prov = [table.value.provenance];
      if (jobs) prov.push(qcewProvenance(jobs.period, at, { area: fips }));
      spending = { obligations: ob, perJob: pj, provenance: prov };
      if (jobs?.suppressed) caveats.push(`BLS withheld the covered-employment cell for county ${fips} in ${jobs.period}, so there is no per-job figure; the cell is blank, not zero.`);
    } else spending = null;
  } else {
    caveats.push("USAspending did not answer; no obligation figures.");
    failed.push("usaspending");
  }
  if (q.status === "rejected") {
    caveats.push("BLS QCEW did not answer; no per-job figure.");
    failed.push("bls-qcew");
  }
  if (detail.status === "rejected") {
    caveats.push("USAspending did not answer for recipients, awarding agencies and NAICS.");
    if (!failed.includes("usaspending")) failed.push("usaspending");
  }

  const topRecipient = detail.status === "fulfilled" ? (detail.value.recipients[0] ?? null) : null;
  const areaName = deposits?.county ? `${deposits.county}${deposits.state ? ", " + deposits.state : ""}` : stusab ? `county ${fips}, ${stusab}` : undefined;
  const section = financeSection(fips, { deposits, spending, topRecipient, areaName, retrievedAt: at });

  caveats.push(`Obligations are what agencies committed in FY${fy} by place of performance: not outlays, and not the recipient's own location.`);
  if (fy === fiscalYearOf(now)) caveats.push(`FY${fy} is still open; figures are partial.`);
  else if (fy === latestCompleteFy(now) && daysSinceFyClose(now) < REPORTING_LAG_DAYS) {
    caveats.push(`FY${fy} closed ${daysSinceFyClose(now)} days ago; agencies report with up to a ${REPORTING_LAG_DAYS}-day lag, so totals are still filling in.`);
  }

  return {
    section,
    detail: detail.status === "fulfilled" ? detail.value : null,
    provenance: dedupeProvenance([section.provenance, detail.status === "fulfilled" ? detail.value.provenance : undefined]),
    caveats,
    failed,
  };
}
