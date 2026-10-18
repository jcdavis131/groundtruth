# RSU pipeline (scripts)

Real Form 4 filings only. Nothing synthetic, ever.

## 1. Extract — `rsu-extract.py`
Parse Form 4 XML into RSU transactions (JSON).

```bash
python3 scripts/rsu-extract.py path/to/filing.xml --json > /tmp/txns.json
```

## 2. Vesting inference — `rsu-vesting.py`
Infer vesting schedules from footnote/proxy text patterns.
Blackout periods: always `not_publicly_disclosed`, never inferred.

## 3. Event calendar — `rsu-events.py`
Build the point-in-time calendar (`lib/rsu/data/events.jsonl`).
Each event has `event_date` AND `knowable_date` (filing date).
Serve via `GET /api/rsu?op=events`.

```bash
python3 scripts/rsu-events.py --txns /tmp/txns.json \
  --filing-date 2026-03-15 --out lib/rsu/data/events.jsonl
```

## 4. Backtest — `rsu-backtest.py` (PAPER ONLY)
Tests the rule: long the issuer at the first open on/after `knowable_date`
of each vest event, hold N days, exit at close. Enforces disclosure lag,
point-in-time discipline, costs, one position per ticker.

```bash
python3 scripts/rsu-backtest.py --events lib/rsu/data/events.jsonl \
  --prices /path/to/real/prices.csv --hold-days 20
```

Prices CSV columns: `date,ticker,open,high,low,close[,volume]`.
No prices file = honest failure, not fake data.

Every report is stamped PAPER ONLY with its caveats. A single run proves
nothing — research only unless a strategy wins held-out evaluation.
