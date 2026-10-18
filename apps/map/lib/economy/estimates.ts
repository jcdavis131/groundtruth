// Labelled estimates derived from published values. Each one prints the
// arithmetic it ran so a reader can check it; none of them is advice.

import type { HomeValue, JobsRow, RentValue } from "./features";
import { fmtPct, fmtUsd } from "./features";

export interface RateObs {
  value: number;
  date: string;
}

export interface Affordability {
  price: number;
  ratePct: number;
  rateDate: string;
  downPct: number;
  termYears: number;
  /** Monthly principal and interest. */
  payment: number;
  /** QCEW average weekly wage × 52 / 12 (per job, not per household). */
  wageMonthly: number | null;
  /** payment / wageMonthly, percent. */
  wageSharePct: number | null;
  /** typical home / (typical rent × 12). */
  priceToRent: number | null;
  /** Ratio of typical home to average annual wage. */
  yearsOfWages: number | null;
  formula: string[];
}

/** Standard amortised payment, principal and interest only. */
export function mortgagePayment(principal: number, ratePct: number, years: number): number {
  const r = ratePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export function affordability(home: HomeValue | undefined, rent: RentValue | undefined, jobs: JobsRow | undefined, rate: RateObs | undefined): Affordability | null {
  if (!home || !rate) return null;
  const downPct = 20;
  const termYears = 30;
  const principal = home.latest * (1 - downPct / 100);
  const payment = mortgagePayment(principal, rate.value, termYears);
  const wageMonthly = jobs?.avgWeeklyWage != null ? (jobs.avgWeeklyWage * 52) / 12 : null;
  const wageSharePct = wageMonthly ? (payment / wageMonthly) * 100 : null;
  const priceToRent = rent ? home.latest / (rent.latest * 12) : null;
  const yearsOfWages = jobs?.avgWeeklyWage != null ? home.latest / (jobs.avgWeeklyWage * 52) : null;
  const formula = [
    `payment = P·r / (1 − (1+r)^−n), P = ${fmtUsd(home.latest)} × ${100 - downPct}% = ${fmtUsd(principal)}, r = ${rate.value.toFixed(2)}%/12 (Freddie Mac PMMS via FRED, ${rate.date}), n = ${termYears * 12} → ${fmtUsd(payment)}/mo principal and interest`,
  ];
  if (wageMonthly != null) {
    formula.push(`wage share = payment / (avg weekly wage ${fmtUsd(jobs!.avgWeeklyWage!)} × 52 / 12 = ${fmtUsd(wageMonthly)}) = ${fmtPct(wageSharePct, 0).replace("+", "")} of one average job's pay (BLS QCEW ${jobs!.period}, all covered jobs)`);
    formula.push(`years of wages = ${fmtUsd(home.latest)} / (${fmtUsd(jobs!.avgWeeklyWage!)} × 52) = ${yearsOfWages!.toFixed(1)}`);
  }
  if (priceToRent != null) formula.push(`price-to-rent = ${fmtUsd(home.latest)} / (${fmtUsd(rent!.latest)} × 12) = ${priceToRent.toFixed(1)}`);
  return { price: home.latest, ratePct: rate.value, rateDate: rate.date, downPct, termYears, payment, wageMonthly, wageSharePct, priceToRent, yearsOfWages, formula };
}

export interface MomentumTerm {
  name: string;
  weight: number;
  /** Raw published change, percent. */
  raw: number;
  /** Scale that maps the raw change onto ±1. */
  scale: number;
  /** Clipped raw / scale. */
  value: number;
}

export interface Momentum {
  score: number | null;
  label: string;
  terms: MomentumTerm[];
  missing: string[];
  formula: string;
}

const MOMENTUM_SPEC: Array<{ name: string; weight: number; scale: number; pick: (h?: HomeValue, r?: RentValue, j?: JobsRow) => number | null | undefined }> = [
  { name: "home value 1-yr change", weight: 0.3, scale: 10, pick: (h) => h?.yoyPct },
  { name: "rent 1-yr change", weight: 0.15, scale: 10, pick: (_h, r) => r?.yoyPct },
  { name: "jobs over-the-year change", weight: 0.3, scale: 3, pick: (_h, _r, j) => j?.yoy.emp },
  { name: "avg weekly wage over-the-year change", weight: 0.25, scale: 6, pick: (_h, _r, j) => j?.yoy.avgWeeklyWage },
];

export function momentumLabel(score: number): string {
  if (score < -0.25) return "cooling";
  if (score <= 0.25) return "steady";
  if (score <= 0.6) return "warming";
  return "hot";
}

/** Weighted mean of clipped, scaled published changes. An index, not a forecast. */
export function momentum(home?: HomeValue, rent?: RentValue, jobs?: JobsRow): Momentum {
  const terms: MomentumTerm[] = [];
  const missing: string[] = [];
  for (const s of MOMENTUM_SPEC) {
    const raw = s.pick(home, rent, jobs);
    if (raw == null || !Number.isFinite(raw)) {
      missing.push(s.name);
      continue;
    }
    terms.push({ name: s.name, weight: s.weight, raw, scale: s.scale, value: Math.max(-1, Math.min(1, raw / s.scale)) });
  }
  const wsum = terms.reduce((a, t) => a + t.weight, 0);
  const score = wsum > 0 ? terms.reduce((a, t) => a + t.weight * t.value, 0) / wsum : null;
  return {
    score,
    label: score == null ? "no data" : momentumLabel(score),
    terms,
    missing,
    formula:
      "momentum = Σ wᵢ · clip(changeᵢ / scaleᵢ, −1, 1) / Σ wᵢ over the terms present; weights and scales: " +
      MOMENTUM_SPEC.map((s) => `${s.name} ${s.weight} (±${s.scale}%)`).join(", "),
  };
}

// Exported so lib/economy/history can backfill the same index over history
// with the same weights and scales; the pick functions are only used here.
export { MOMENTUM_SPEC };
export type MomentumSpecTerm = (typeof MOMENTUM_SPEC)[number];
