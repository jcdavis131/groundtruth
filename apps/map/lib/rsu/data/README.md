# RSU event calendar store

`events.jsonl` lives here (one JSON object per line), written by
`scripts/rsu-events.py` from parsed Form 4 transactions.

## Current state

**Empty.** No real Form 4 filings have been parsed into the calendar yet.
This directory intentionally contains no fixture or synthetic events —
an empty calendar is honest; a fabricated one is not.

## To populate (real data only)

```bash
# 1. Parse real Form 4 XML obtained lawfully (e.g. issuer IR mirror)
python3 scripts/rsu-extract.py path/to/filing.xml --json > /tmp/txns.json

# 2. Build point-in-time events (filing date = disclosure date)
python3 scripts/rsu-events.py --txns /tmp/txns.json \
  --filing-date 2026-03-15 \
  --out lib/rsu/data/events.jsonl
```

Each event carries `event_date` (the transaction) and `knowable_date`
(when it became public). Analysis must use `knowable_date` — see
`scripts/rsu-backtest.py` for the paper-only harness that enforces this.
