# Model card — momentum-v1

**What it is:** a 12-month county home-value change forecaster. Ridge regression
on five point-in-time momentum features, served on arxiviq.com (desk charts,
`?forecast` report line, MCP `momentum_forecast`).

**Method.** Features at origin month t (all from data on or before t):
12-month / 6-month / 3-month ZHVI change, the 12-month change ending a year
earlier (seasonal), and acceleration (12m minus seasonal). Target: forward
12-month ZHVI change. Ridge penalty λ=1 on standardised features, picked on a
train-validation split. Closed-form normal equations; CPU-only; no learned
black box. Formula:
`12m change = yMean + w·((features − mean)/sd)`.
Forecast band = point ± empirical p10/p90 residuals on the spatial holdout
(−7.25pp / +7.68pp) — an empirical band, not a calibrated interval.

**Data vintage.** Zillow county ZHVI, 3,071 counties, 2000-01..2026-09
(594,791 panel rows). Retrain: `node scripts/ml-train-momentum.mjs` (from
`apps/map`). Bundle: `apps/map/lib/ml/data/momentum_v1.json`. Served by
`apps/map/app/api/ml/route.ts`.

**Baselines beaten.** Spatial holdout (10 states held out, n=115,021):
ridge MAE 4.684% vs naive 6.875% vs seasonal 7.018% (paired t = −176.0).
Regime shift (train ≤2019-12, test 2020-01..2023-12, n=144,004):
ridge MAE 6.131% vs naive 9.121% vs seasonal 10.257% (paired t = −210.5).
Full paired-comparison table: `../evals/momentum-v1.md`.

**What would invalidate it.** A regime where momentum stops persisting
(policy shocks that break autocorrelation); Zillow methodology rewrites;
serving on counties with < 25 months of history (the route refuses with 422
instead of guessing). Zillow revises recent months, so live months are noisier
than backtest months.

**Limits.** Descriptive, not advice — a county is not a tradable asset. No
transaction costs, taxes, or carrying costs in the eval.
