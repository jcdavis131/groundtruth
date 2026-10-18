# eye.jcamd.com data architecture — warehouse + multi-tower ML

One warehouse feeds the site, the forecasts, and the models. Everything is
free-source, no keys, no signups (house policy). NumPy/pandas only — no torch
install, no pip approvals needed.

## Layout

`$DATAOPS_ROOT` (default `~/workspace/dataops-warehouse/`):

```
raw/<dataset>/<pull_id>/      immutable source bytes + meta.json (append-only)
staged/<dataset>.csv          validated canonical history, natural-key deduped
frames/<domain>_daily.csv     per-domain modeling frames (point-in-time correct)
frames/multitower_daily.csv   aligned multi-domain frame for the model
manifests/<dataset>.json      pull history, row counts, freshness, coverage notes
models/multitower_v0/         weights_final.npz, scalers, metrics.json,
                              windows.csv, REPORT.md, forecasts.json
```

Rules: `raw/` is never edited — fix forward with a new pull. `staged/` must be
reproducible from `raw/`. Frames fail closed on any lookahead violation.

## Datasets (registry.json is the source of truth)

| dataset | source | cadence | tower |
|---|---|---|---|
| fred_gasregw | FRED GASREGW, weekly retail gasoline | weekly | commodities |
| fred_wti | FRED DCOILWTICO, WTI spot | daily | commodities |
| usgs_quakes | USGS FDSN, daily M≥2.5 aggregates | daily | seismic |
| usgs_gauges | USGS waterservices, 8 gauges discharge+stage | daily | hydro |
| ercot_dam_spp | ERCOT MIS 12331, DAM prices | daily | grid |
| ercot_load_wz | ERCOT MIS 13101, load by weather zone | daily | grid |

## CLI

```bash
python3 dataops/dataops.py pull <dataset> | pull --all
python3 dataops/dataops.py backfill <dataset> --since YYYY-MM-DD
python3 dataops/dataops.py validate <dataset>     # schema + key + range check
python3 dataops/dataops.py frame <name>           # commodities|seismic|hydro|grid
python3 dataops/dataops.py frame multitower_daily # the aligned join
python3 dataops/dataops.py status                 # freshness of everything
```

npm shortcuts: `npm run data:ops -- <args>`, `npm run ml:train`,
`npm run ml:forecast -- --site-bundle`.

## Frame rules (binding)

- Weekly targets forward-filled to daily (most recent print visible each day).
- Trading-day series forward-filled over weekends. Never backward-filled.
- Every feature is a strictly positive lag; the builder fails closed if a
  feature column doesn't match the `_lagN/_chgN/_rollN`/calendar naming rule.
- Targets are +7d forward shifts; rows with NaN targets are dropped.

## Multi-tower multitask model (ml/multitower/)

Pure-NumPy: per-domain tower encoders → shared trunk → one head per task
(`tasks.json`). Tasks v0: `gas_fwd7` (reg), `gas_up7` (clf), `wti_fwd7` (reg),
`quake_fwd7` (count). Hydro and grid towers are auxiliary representation —
they get gradients through the shared trunk even with no head of their own.

Training: expanding-window walk-forward, first test year 2012, 14-day purge,
early stopping on the last 365 train days. Baselines: persistence, seasonal
naive (t-364), majority class. Metrics in original units; `evaluate.py`
writes `REPORT.md`.

`forecast.py` emits next-7d forecasts; `--site-bundle` drops
`lib/ml/data/multitower_forecasts.json` for the site layers (same pattern as
the gas bundles).

## Ops notes

- ERCOT MIS exposes recent docs only — `backfill` reports exactly how far the
  server let it reach; deep history accumulates via daily `pull`.
- Quake backfill walks month-by-month from 2000 (one polite request each).
- Gauges backfill walks 5-year chunks per site.
- Re-run `pull --all` weekly (same cron slot as the gas refresh); frames and
  forecasts rebuild from staged data deterministically.
