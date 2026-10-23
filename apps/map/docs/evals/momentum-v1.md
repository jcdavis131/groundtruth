# Eval report — momentum-v1 (county 12-month home-value change forecaster)

**Model:** ridge regression, 5 point-in-time momentum features, λ=1 (picked on a
train-validation split). **Vintage:** 2026-09 (newest Zillow month).
**Horizon:** 12 months. **Target:** forward 12-month ZHVI change.
**CPU-only.** Code: `apps/map/lib/ml/momentum_forecast.ts`. Reproduce:
`node scripts/ml-train-momentum.mjs` (from `apps/map`).

## Data
Zillow county ZHVI file (`County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`),
3,071 counties, 2000-01..2026-09 → 594,791 panel rows. Features at origin month
t use only data on or before t; the target uses t+12. Caveats: Zillow revises
recent months (backtest months are cleaner than live months); early coverage
over-represents large metros; a county is not a tradable asset — descriptive,
not advice.

## Paired comparison (MAE on the 12-month change, percentage points)

| Split | n | ridge MAE | naive MAE | seasonal MAE | ridge RMSE | paired mean diff (ridge−naive) | t |
|---|---|---|---|---|---|---|---|
| Spatial holdout (10 states held: CA FL IL MA MO NE NY RI UT WV) | 115,021 | **4.684%** | 6.875% | 7.018% | 6.537% | −2.19pp | −176.0 |
| Regime shift (train ≤2019-12, test 2020-01..2023-12) | 144,004 | **6.131%** | 9.121% | 10.257% | 8.034% | −2.99pp | −210.5 |

Baselines: naive = predict 0 (no change); seasonal = repeat the 12-month change
from a year ago. The model beats both on the spatial holdout and beats naive on
the regime slice, so the SPEC-1.1 kill rule does **not** trigger.

## Forecast band
Empirical residual quantiles on the spatial holdout: p10 = −7.25pp,
p90 = +7.68pp. Served bands are point ± these quantiles — an empirical band,
not a calibrated interval (ECE gate applies when probabilistic outputs ship).

## Learned weights (standardised)
chg12 +0.0072, chg6 +0.0073, chg3 +0.0088, seasonal +0.0033, accel +0.0038.
All five terms pull the same direction: recent momentum persists, and the
seasonal term adds a small repeat-last-year effect.

## What would invalidate it
A regime where momentum no longer persists (e.g., a policy shock that breaks
the autocorrelation structure); Zillow methodology changes that rewrite history;
serving on counties with < 25 months of history (the route refuses these with
422 instead of guessing).
