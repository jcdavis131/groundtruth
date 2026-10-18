// Backfilled versions of the two labelled estimates in lib/economy/estimates.ts.
// Same arithmetic, applied to every month of history instead of the latest
// values, so a reader can see how the index behaved before trusting it.
//
// Alignment: the month axis is the ZHVI series' months. Monthly inputs (ZORI)
// are matched on the calendar month. Quarterly inputs (QCEW) are carried
// forward from the quarter's period end (Q1 -> Mar 31) until the next quarter
// appears; `lagMonths` shifts them later to mimic publication lag (BLS
// releases a quarter about five months after it ends), and `maxStaleMonths`
// (default 12) stops a suppressed or missing quarter from being carried for
// years. Weekly inputs (PMMS) use the last observation on or before month end.
//
// Every output is provenance kind "estimate" with the formula in `method`
// and the input series ids in `notes`. None of it is advice or a forecast.

import { MOMENTUM_SPEC, mortgagePayment, type MomentumSpecTerm } from "@/lib/economy/estimates";
import { provenance } from "@/lib/provenance/types";
import type { Point, Series, SeriesMeta } from "@/lib/series/types";
import { asOfJoin, isoDate, pctChangeMonths } from "./align";

type Geo = SeriesMeta["geo"];

function specTerm(prefix: string): MomentumSpecTerm {
  const t = MOMENTUM_SPEC.find((s) => s.name.startsWith(prefix));
  if (!t) throw new Error(`MOMENTUM_SPEC has no term starting "${prefix}"`);
  return t;
}

/** The four momentum terms, looked up by name so a reorder in estimates.ts cannot swap weights silently. */
export const MOMENTUM_TERMS = {
  home: specTerm("home value"),
  rent: specTerm("rent"),
  jobs: specTerm("jobs"),
  wage: specTerm("avg weekly wage"),
} as const;

/** Mirrors the constants hard-coded in estimates.ts affordability(). */
export const AFFORDABILITY = { downPct: 20, termYears: 30 } as const;

export interface HistoryOptions {
  /** Months to shift quarterly inputs later (publication lag). Default 0 = period end. */
  lagMonths?: number;
  /** Oldest quarterly observation that may be carried, in months. Default 12. */
  maxStaleMonths?: number;
  geo?: Geo;
  /** Override the output id (defaults derive from the ZHVI id). */
  idSuffix?: string;
  retrievedAt?: string;
}

/** Weighted mean of clipped, scaled changes over the terms present; null when none is. Same rule as momentum(). */
export function momentumScore(terms: Array<{ weight: number; scale: number; raw: number | null }>): number | null {
  let wsum = 0;
  let acc = 0;
  for (const t of terms) {
    if (t.raw == null || !Number.isFinite(t.raw)) continue;
    wsum += t.weight;
    acc += t.weight * Math.max(-1, Math.min(1, t.raw / t.scale));
  }
  return wsum > 0 ? acc / wsum : null;
}

/** "zhvi:county:48453" -> "county:48453"; anything else is returned as-is. */
function scopeOf(zhviId: string): string {
  return zhviId.replace(/^zhvi:/, "");
}

function last(points: Point[]): Point | undefined {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].v != null) return points[i];
  return undefined;
}

function estimateMeta(id: string, title: string, unit: string, primary: Series, inputs: Series[], method: string, opts: HistoryOptions, tags: string[]): SeriesMeta {
  const lastPt = last(primary.points);
  return {
    id,
    title,
    unit,
    frequency: "monthly",
    geo: opts.geo ?? primary.geo,
    tags,
    provenance: provenance(primary.provenance.source, {
      kind: "estimate",
      method,
      period: lastPt ? isoDate(lastPt.t).slice(0, 7) : undefined,
      retrievedAt: opts.retrievedAt,
      notes: [
        `inputs: ${inputs.map((s) => s.id).join(", ")}`,
        `quarterly inputs carried forward from period end with lag ${opts.lagMonths ?? 0} months, dropped after ${opts.maxStaleMonths ?? 12} months`,
      ],
    }),
  };
}

const MOMENTUM_FORMULA =
  "momentum = Σ wᵢ · clip(changeᵢ / scaleᵢ, −1, 1) / Σ wᵢ over the terms present; weights and scales: " +
  MOMENTUM_SPEC.map((s) => `${s.name} ${s.weight} (±${s.scale}%)`).join(", ");

/**
 * Monthly momentum index over the ZHVI series' months, using the same
 * weights and scales as estimates.ts momentum(). Home and rent terms are
 * 12-month percent changes of ZHVI / ZORI; jobs and wage terms are the QCEW
 * over-the-year percent-change series carried forward by quarter.
 * The last point equals momentum() on the latest published values when the
 * same inputs are supplied.
 */
export function momentumHistory(zhvi: Series, zori?: Series | null, qcewEmpYoY?: Series | null, qcewWageYoY?: Series | null, opts: HistoryOptions = {}): Series {
  const months = zhvi.points.map((p) => p.t);
  const q = { lagMonths: opts.lagMonths ?? 0, maxStaleMonths: opts.maxStaleMonths ?? 12 };
  const home = pctChangeMonths(zhvi, 12).map((p) => p.v);
  const rent = zori ? asOfJoin(pctChangeMonths(zori, 12), months, { maxStaleMonths: 0 }) : null;
  const jobs = qcewEmpYoY ? asOfJoin(qcewEmpYoY.points, months, q) : null;
  const wage = qcewWageYoY ? asOfJoin(qcewWageYoY.points, months, q) : null;
  const T = MOMENTUM_TERMS;
  const points: Point[] = months.map((t, i) => ({
    t,
    v: momentumScore([
      { weight: T.home.weight, scale: T.home.scale, raw: home[i] },
      { weight: T.rent.weight, scale: T.rent.scale, raw: rent ? rent[i] : null },
      { weight: T.jobs.weight, scale: T.jobs.scale, raw: jobs ? jobs[i] : null },
      { weight: T.wage.weight, scale: T.wage.scale, raw: wage ? wage[i] : null },
    ]),
  }));
  const inputs = [zhvi, zori, qcewEmpYoY, qcewWageYoY].filter((s): s is Series => !!s);
  const meta = estimateMeta(
    `momentum:${scopeOf(zhvi.id)}${opts.idSuffix ?? ""}`,
    "Market momentum index",
    "index (−1 to 1)",
    zhvi,
    inputs,
    MOMENTUM_FORMULA + "; home and rent changes are 12-month ZHVI / ZORI changes, jobs and wage changes are QCEW over-the-year changes carried forward by quarter",
    opts,
    ["housing", "jobs", "index"],
  );
  return { ...meta, points };
}

/**
 * Reduced-form momentum from ZHVI alone: the home-value term of the full
 * index with the other three terms absent, i.e. clip(ZHVI 12-month change /
 * 10%, −1, 1). Exists so the cross-sectional IC test can run over every
 * county from one Zillow file instead of ~3,000 BLS fetches. It is a
 * different, narrower signal than the full index and is labelled as such.
 */
export function momentumHomeOnly(zhvi: Series, opts: HistoryOptions = {}): Series {
  const s = momentumHistory(zhvi, null, null, null, { ...opts, idSuffix: (opts.idSuffix ?? "") + ":home-only" });
  return {
    ...s,
    title: "Market momentum index, home-value term only",
    provenance: {
      ...s.provenance,
      method: `reduced form: momentum_home = clip(ZHVI 12-month % change / ${MOMENTUM_TERMS.home.scale}, −1, 1); the rent, jobs and wage terms of the full index are absent`,
      notes: [`inputs: ${zhvi.id}`, "not the full momentum index: rent, jobs and wage terms are missing"],
    },
  };
}

export interface AffordabilityHistory {
  /** Monthly principal and interest on a 20%-down 30-year loan at the month's PMMS rate. */
  payment: Series;
  /** payment / (avg weekly wage × 52 / 12), percent. Null series when no wage input. */
  wageShare: Series | null;
  /** ZHVI / (ZORI × 12). Null series when no rent input. */
  priceToRent: Series | null;
}

/**
 * Monthly affordability measures over the ZHVI series' months, the same
 * arithmetic as estimates.ts affordability(): payment on 80% of the typical
 * home at the month's 30-year rate over 30 years; payment as a share of one
 * average QCEW job's monthly pay; typical home over a year of typical rent.
 */
export function affordabilityHistory(zhvi: Series, mortgage: Series, qcewWage?: Series | null, zori?: Series | null, opts: HistoryOptions = {}): AffordabilityHistory {
  const months = zhvi.points.map((p) => p.t);
  const q = { lagMonths: opts.lagMonths ?? 0, maxStaleMonths: opts.maxStaleMonths ?? 12 };
  const rate = asOfJoin(mortgage.points, months, { maxStaleMonths: 3 });
  const wage = qcewWage ? asOfJoin(qcewWage.points, months, q) : null;
  const rent = zori ? asOfJoin(zori.points, months, { maxStaleMonths: 0 }) : null;
  const { downPct, termYears } = AFFORDABILITY;
  const payment: Point[] = months.map((t, i) => {
    const price = zhvi.points[i].v;
    const r = rate[i];
    return { t, v: price != null && r != null ? mortgagePayment(price * (1 - downPct / 100), r, termYears) : null };
  });
  const share: Point[] | null = wage
    ? months.map((t, i) => {
        const pay = payment[i].v;
        const w = wage[i];
        return { t, v: pay != null && w != null && w > 0 ? (pay / ((w * 52) / 12)) * 100 : null };
      })
    : null;
  const ptr: Point[] | null = rent
    ? months.map((t, i) => {
        const price = zhvi.points[i].v;
        const rr = rent[i];
        return { t, v: price != null && rr != null && rr > 0 ? price / (rr * 12) : null };
      })
    : null;
  const scope = scopeOf(zhvi.id) + (opts.idSuffix ?? "");
  const paymentSeries: Series = {
    ...estimateMeta(
      `affordability:${scope}:payment`,
      "Monthly principal and interest on the typical home",
      "$ per month",
      zhvi,
      [zhvi, mortgage],
      `payment = P·r / (1 − (1+r)^−n), P = ZHVI × ${100 - downPct}%, r = PMMS 30-year rate (last weekly observation on or before month end) / 12, n = ${termYears * 12}`,
      opts,
      ["housing", "affordability"],
    ),
    points: payment,
  };
  const wageShare: Series | null =
    share && qcewWage
      ? {
          ...estimateMeta(
            `affordability:${scope}:wage-share`,
            "Mortgage payment as a share of one average job's pay",
            "%",
            zhvi,
            [zhvi, mortgage, qcewWage],
            "wage share = payment / (QCEW avg weekly wage × 52 / 12) × 100, wage carried forward by quarter",
            opts,
            ["housing", "affordability", "jobs"],
          ),
          points: share,
        }
      : null;
  const priceToRent: Series | null =
    ptr && zori
      ? {
          ...estimateMeta(`affordability:${scope}:price-to-rent`, "Price-to-rent ratio", "ratio", zhvi, [zhvi, zori], "price-to-rent = ZHVI / (ZORI × 12), same month", opts, ["housing", "affordability"]),
          points: ptr,
        }
      : null;
  return { payment: paymentSeries, wageShare, priceToRent };
}
