// County momentum forecaster, model "momentum-v1".
//
// The simplest model that can win: ridge regression on five point-in-time
// momentum features, predicting the 12-month forward change in Zillow ZHVI.
// CPU-only, zero dependencies, pure functions (no DOM, no network) so the
// backtest is reproducible and the tests run on fixtures.
//
// Features at origin month t (all from data on or before t — never the future):
//   chg12    12-month ZHVI change ending at t
//   chg6      6-month ZHVI change ending at t
//   chg3      3-month ZHVI change ending at t
//   seasonal 12-month change ending 12 months before t (what happened a year ago)
//   accel    chg12 minus seasonal (is momentum speeding up or slowing down)
// Target: 12-month forward change from t to t+12.
//
// Baselines: naive (predict 0 = no change) and seasonal (repeat the 12-month
// change from a year ago). The model must beat both on held-out counties and
// beat naive on a regime-shift slice (train <= 2019-12, test 2020-01..2023-12)
// or it is killed per the SPEC.

export const MODEL_VERSION = "momentum-v1";
export const HORIZON_MONTHS = 12;
export const FEATURE_NAMES = ["chg12", "chg6", "chg3", "seasonal", "accel"] as const;

/** One county's monthly ZHVI history, oldest first. Values null where Zillow has no row. */
export interface CountyMonthly {
  fips: string;
  state: string;
  /** "YYYY-MM", oldest first, aligned with values. */
  months: string[];
  values: (number | null)[];
}

/** One training row: features at origin month, target = forward 12m change. */
export interface ForecastRow {
  fips: string;
  state: string;
  /** Origin month "YYYY-MM". */
  month: string;
  features: number[];
  target: number;
}

function change(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  const c = a / b - 1;
  return Number.isFinite(c) ? c : null;
}

/**
 * Build the panel. A row needs 24 months of history behind the origin (for the
 * seasonal feature) and 12 months ahead (for the target). Rows with any null or
 * absurd (|change| > 300%) value are dropped, never imputed.
 */
export function buildPanel(counties: CountyMonthly[]): ForecastRow[] {
  const rows: ForecastRow[] = [];
  for (const c of counties) {
    const { months, values } = c;
    for (let i = 24; i + HORIZON_MONTHS < months.length; i++) {
      const chg12 = change(values[i], values[i - 12]);
      const chg6 = change(values[i], values[i - 6]);
      const chg3 = change(values[i], values[i - 3]);
      const seasonal = change(values[i - 12], values[i - 24]);
      const target = change(values[i + HORIZON_MONTHS], values[i]);
      if (chg12 == null || chg6 == null || chg3 == null || seasonal == null || target == null) continue;
      const feats = [chg12, chg6, chg3, seasonal, chg12 - seasonal];
      if (feats.some((f) => Math.abs(f) > 3) || Math.abs(target) > 3) continue;
      rows.push({ fips: c.fips, state: c.state, month: months[i], features: feats, target });
    }
  }
  return rows;
}

/** Trained ridge model: standardised features, closed-form normal equations. */
export interface RidgeModel {
  version: typeof MODEL_VERSION;
  lambda: number;
  /** Standardisation from the training frame. */
  mean: number[];
  sd: number[];
  yMean: number;
  /** weights[0..p-1] on standardised features, weights[p] = intercept. */
  weights: number[];
  /** Empirical residual quantiles on the eval frame (for forecast bands). */
  residualP10: number;
  residualP90: number;
  /** "YYYY-MM" of the newest training month. */
  vintage: string;
  nTrain: number;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

export function trainRidge(rows: ForecastRow[], lambda: number, vintage: string): RidgeModel {
  const p = FEATURE_NAMES.length;
  if (rows.length === 0) throw new Error("trainRidge: no rows");
  const mean = new Array(p).fill(0);
  const sd = new Array(p).fill(0);
  for (const r of rows) for (let j = 0; j < p; j++) mean[j] += r.features[j];
  for (let j = 0; j < p; j++) mean[j] /= rows.length;
  for (const r of rows) for (let j = 0; j < p; j++) sd[j] += (r.features[j] - mean[j]) ** 2;
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j] / rows.length) || 1;
  const yMean = rows.reduce((a, r) => a + r.target, 0) / rows.length;
  // Normal equations on [standardised features, intercept]; intercept unpenalised.
  const n = p + 1;
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (const r of rows) {
    const x = r.features.map((v, j) => (v - mean[j]) / sd[j]);
    const yc = r.target - yMean;
    for (let j = 0; j < p; j++) {
      b[j] += x[j] * yc;
      for (let k = 0; k < p; k++) A[j][k] += x[j] * x[k];
    }
    b[p] += yc;
  }
  for (let j = 0; j < p; j++) A[j][j] += lambda * rows.length;
  A[p][p] = rows.length;
  const weights = solve(A, b);
  return { version: MODEL_VERSION, lambda, mean, sd, yMean, weights, residualP10: 0, residualP90: 0, vintage, nTrain: rows.length };
}

export function predictRidge(m: RidgeModel, features: number[]): number {
  let s = m.yMean + m.weights[FEATURE_NAMES.length];
  for (let j = 0; j < FEATURE_NAMES.length; j++) s += m.weights[j] * ((features[j] - m.mean[j]) / m.sd[j]);
  return s;
}

/** 12-month forecast with an empirical band from the eval residual quantiles. */
export function forecast12m(m: RidgeModel, features: number[]): { point: number; lo: number; hi: number } {
  const point = predictRidge(m, features);
  return { point, lo: point + m.residualP10, hi: point + m.residualP90 };
}

/** Latest origin features for one county's monthly values (null when < 25 months of history). */
export function latestFeatures(values: (number | null)[]): number[] | null {
  const v = values.filter((x) => x != null) as number[];
  if (v.length < 25) return null;
  const n = v.length;
  const chg = (a: number, b: number) => v[n - 1 - a] / v[n - 1 - b] - 1;
  const chg12 = chg(0, 12);
  const seasonal = chg(12, 24);
  const feats = [chg12, chg(0, 6), chg(0, 3), seasonal, chg12 - seasonal];
  if (feats.some((f) => !Number.isFinite(f) || Math.abs(f) > 3)) return null;
  return feats;
}

/** Spatial holdout: every 5th state alphabetically goes to test (reduces neighbour leakage). */
export function splitSpatial(rows: ForecastRow[]): { train: ForecastRow[]; test: ForecastRow[] } {
  const states = [...new Set(rows.map((r) => r.state))].sort();
  const held = new Set(states.filter((_, i) => i % 5 === 4));
  return { train: rows.filter((r) => !held.has(r.state)), test: rows.filter((r) => held.has(r.state)) };
}

/** Regime-shift slice: train on months <= trainThrough, test on testFrom..testThrough. */
export function splitRegime(rows: ForecastRow[], trainThrough: string, testFrom: string, testThrough: string): { train: ForecastRow[]; test: ForecastRow[] } {
  return {
    train: rows.filter((r) => r.month <= trainThrough),
    test: rows.filter((r) => r.month >= testFrom && r.month <= testThrough),
  };
}

export interface SplitEval {
  n: number;
  ridge: { mae: number; rmse: number };
  naive: { mae: number; rmse: number };
  seasonal: { mae: number; rmse: number };
  /** Paired t on |error| (ridge vs naive): negative meanDiff favours ridge. */
  pairedVsNaive: { meanDiff: number; t: number };
}

function rmse(errs: number[]): number {
  return Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
}

/** Pick lambda on the last 20% of rows as validation (rows are month-ordered within the panel build). */
export function pickLambda(rows: ForecastRow[], lambdas: number[], vintage: string): number {
  const cut = Math.floor(rows.length * 0.8);
  const tr = rows.slice(0, cut);
  const va = rows.slice(cut);
  let best = lambdas[0];
  let bestMae = Infinity;
  for (const lam of lambdas) {
    const m = trainRidge(tr, lam, vintage);
    const e = va.reduce((a, r) => a + Math.abs(r.target - predictRidge(m, r.features)), 0) / va.length;
    if (e < bestMae) {
      bestMae = e;
      best = lam;
    }
  }
  return best;
}

export function evaluateSplit(model: RidgeModel, test: ForecastRow[]): SplitEval {
  const eR: number[] = [];
  const eN: number[] = [];
  const eS: number[] = [];
  const diff: number[] = [];
  for (const r of test) {
    const pr = predictRidge(model, r.features);
    const er = Math.abs(r.target - pr);
    const en = Math.abs(r.target);
    const es = Math.abs(r.target - r.features[3]);
    eR.push(er);
    eN.push(en);
    eS.push(es);
    diff.push(er - en);
  }
  const meanDiff = diff.reduce((a, d) => a + d, 0) / diff.length;
  const sdDiff = Math.sqrt(diff.reduce((a, d) => a + (d - meanDiff) ** 2, 0) / diff.length) || 1e-12;
  return {
    n: test.length,
    ridge: { mae: eR.reduce((a, e) => a + e, 0) / eR.length, rmse: rmse(eR) },
    naive: { mae: eN.reduce((a, e) => a + e, 0) / eN.length, rmse: rmse(eN) },
    seasonal: { mae: eS.reduce((a, e) => a + e, 0) / eS.length, rmse: rmse(eS) },
    pairedVsNaive: { meanDiff, t: (meanDiff / (sdDiff / Math.sqrt(diff.length))) },
  };
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}

/** Residual quantiles on an eval frame, for the forecast band. */
export function residualQuantiles(model: RidgeModel, rows: ForecastRow[]): { p10: number; p90: number } {
  const res = rows.map((r) => r.target - predictRidge(model, r.features)).sort((a, b) => a - b);
  return { p10: quantile(res, 0.1), p90: quantile(res, 0.9) };
}

/** Serialised model bundle (what scripts/ml-train-momentum.mjs writes). */
export interface MomentumBundle extends RidgeModel {
  featureNames: string[];
  horizonMonths: number;
  evalSpatial: SplitEval;
  evalRegime: SplitEval;
  formula: string;
}

export const FORMULA =
  "12m ZHVI change = yMean + w·((features − mean)/sd); features = [12m change, 6m change, 3m change, 12m change a year ago, acceleration]; ridge penalty λ on standardised weights; band = point ± empirical p10/p90 residuals on the spatial holdout.";
