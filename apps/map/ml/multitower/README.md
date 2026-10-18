# multitower_v0 — multi-tower multitask forecaster

Pure-NumPy (no torch): per-domain tower encoders → shared trunk → task heads.

## Quickstart

```bash
npm run ml:train                 # walk-forward train, saves models/multitower_v0/
npm run ml:eval                  # baselines comparison -> REPORT.md
npm run ml:forecast -- --site-bundle   # next-7d forecasts + lib/ml/data bundle
```

## Protocol

- Expanding windows, first test year adapts to frame start (+4y), 14-day purge.
- Early stopping on last 365 train days. Metrics in original units.
- Baselines: persistence, seasonal naive (t-364), majority class.

## v0 results (2018–2025, strictly out-of-sample)

| task | model | persistence | seasonal | verdict |
|---|---|---|---|---|
| gas_fwd7 ($/gal) | 0.236 | 0.041 | 0.471 | beats seasonal |
| wti_fwd7 ($/bbl) | 5.505 | 2.650 | 17.475 | beats seasonal |
| quake_fwd7 (events/d) | 26.78 | 27.43 | 33.62 | beats both |
| gas_up7 (direction) | 0.611 acc | — | 0.561 maj | beats majority |

Reading: 7-day point forecasts of slow-moving prices are persistence-dominated
(expected — same lesson as the gas-forecaster); the model adds value on
direction and on the noisy count task, where the shared representation earns
its keep. Adding the seismic tower slightly hurt gas/wti (multitask
interference, reported honestly in windows.csv).

## Files

- `model.py` — MLP towers/trunk/heads, manual backprop (gradient-checked), Adam
- `train.py` — walk-forward trainer
- `evaluate.py` — REPORT.md writer
- `forecast.py` — next-step forecasts, optional site bundle
- `tasks.json` — task registry (kind, weight, unit)
