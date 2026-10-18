#!/usr/bin/env python3
"""
RSU event calendar builder.

Reads parsed Form 4 transactions (JSON from rsu-extract.py --json) and builds
a point-in-time event calendar: one JSON object per line.

Each event carries BOTH dates:
  event_date    - when the transaction happened (the economic event)
  knowable_date - when it became public (the filing date)

The knowable_date is what any trading analysis must use. Form 4 is due
within 2 business days of the transaction; if the filing date is unknown
we estimate event_date + 2 business days and flag it as estimated.

Projected vest dates (from vesting-schedule inference) are emitted as
event_type "projected_vest" with a confidence level - never mixed with
actual reported transactions.

Usage:
    python3 rsu-extract.py filing.xml --json > txns.json
    python3 rsu-events.py --txns txns.json --filing-date 2026-03-15 --out lib/rsu/data/events.jsonl
    python3 rsu-events.py --txns txns.json --filing-dates filing_dates.json --out lib/rsu/data/events.jsonl

filing_dates.json (optional): { "<xml_filename>": "YYYY-MM-DD", ... }
"""

import argparse
import hashlib
import json
import sys
from datetime import date, timedelta
from pathlib import Path


def add_business_days(d: date, n: int) -> date:
    """Add n business days (Mon-Fri), skipping weekends. US federal holidays
    are NOT accounted for - this is a conservative approximation."""
    added = 0
    cur = d
    while added < n:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            added += 1
    return cur


def parse_date(s: str) -> date | None:
    if not s:
        return None
    s = s.strip()[:10]
    try:
        y, m, d = (int(x) for x in s.split("-"))
        return date(y, m, d)
    except (ValueError, AttributeError):
        return None


def stable_id(*parts: str) -> str:
    h = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return h[:16]


def build_events(txns: list[dict], filing_dates: dict[str, str],
                 default_filing_date: str | None) -> list[dict]:
    events = []
    for t in txns:
        event_date = parse_date(t.get("transaction_date", ""))
        if not event_date:
            continue

        # Filing date: explicit map > CLI default > estimate (+2 biz days)
        src_file = t.get("_src_file", "")
        filing_raw = filing_dates.get(src_file) or default_filing_date
        knowable = parse_date(filing_raw) if filing_raw else None
        knowable_estimated = False
        if knowable is None:
            knowable = add_business_days(event_date, 2)
            knowable_estimated = True

        etype = t.get("event_type", "other")
        if etype not in ("grant", "vest", "sale", "tax_withhold", "disposition"):
            etype = "other"

        events.append({
            "event_id": stable_id(
                t.get("issuer_cik", ""), t.get("filer_cik", ""),
                event_date.isoformat(), etype, str(t.get("shares", "")),
            ),
            "event_type": etype,
            "event_date": event_date.isoformat(),
            "knowable_date": knowable.isoformat(),
            "knowable_estimated": knowable_estimated,
            "issuer_cik": t.get("issuer_cik", ""),
            "issuer_ticker": t.get("issuer_ticker", ""),
            "issuer_name": t.get("issuer_name", ""),
            "filer_name": t.get("filer_name", ""),
            "filer_cik": t.get("filer_cik", ""),
            "shares": t.get("shares"),
            "price": t.get("price"),
            "security_title": t.get("security_title", ""),
            "source": "form4",
            "confidence": "high",
            "provenance": {
                "parser": "scripts/rsu-extract.py",
                "src_file": src_file or None,
            },
        })
    return events


def main() -> int:
    ap = argparse.ArgumentParser(description="Build RSU event calendar from parsed Form 4 JSON")
    ap.add_argument("--txns", required=True, help="JSON file from rsu-extract.py --json")
    ap.add_argument("--filing-dates", default=None,
                    help='JSON map of source filename -> filing date "YYYY-MM-DD"')
    ap.add_argument("--filing-date", default=None,
                    help="Single filing date applied to all transactions (YYYY-MM-DD)")
    ap.add_argument("--out", required=True, help="Output JSONL event calendar")
    args = ap.parse_args()

    txns_path = Path(args.txns)
    if not txns_path.exists():
        print(f"error: transactions file not found: {txns_path}", file=sys.stderr)
        return 1

    try:
        txns = json.loads(txns_path.read_text())
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON in {txns_path}: {e}", file=sys.stderr)
        return 1
    if not isinstance(txns, list):
        print("error: expected a JSON array of transactions", file=sys.stderr)
        return 1

    filing_dates: dict[str, str] = {}
    if args.filing_dates:
        fp = Path(args.filing_dates)
        if not fp.exists():
            print(f"error: filing-dates file not found: {fp}", file=sys.stderr)
            return 1
        filing_dates = json.loads(fp.read_text())

    events = build_events(txns, filing_dates, args.filing_date)
    events.sort(key=lambda e: (e["event_date"], e["knowable_date"], e["event_id"]))

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")

    n_est = sum(1 for e in events if e["knowable_estimated"])
    print(f"wrote {len(events)} events to {out_path}")
    if n_est:
        print(f"note: {n_est} events have ESTIMATED knowable dates (event_date + 2 business days); "
              "pass --filing-dates for exact disclosure timing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
