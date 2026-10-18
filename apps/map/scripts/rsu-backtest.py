#!/usr/bin/env python3
"""
Paper-only backtest harness for RSU vesting events.

PAPER ONLY. NOT A TRADING SIGNAL. NO REAL MONEY. NO BROKER CONNECTION.

Strategy under test: for each reported RSU *vest* event, go long the issuer
at the first open on/after the event's knowable_date (the filing date - i.e.
when the information was actually public), hold N trading days, exit at close.

Honesty mechanics (enforced, not optional):
  - Disclosure lag: no position opens before knowable_date. Form 4 is due
    within 2 business days; events with estimated knowable dates are flagged.
  - Look-ahead bias: every decision uses only data with timestamps <= the
    trade date. Events are point-in-time by construction.
  - Survivorship: only tickers present in the prices file can trade; missing
    tickers are skipped and counted, not silently dropped.
  - Costs: per-trade commission + slippage in basis points, applied both ways.
  - One open position per ticker at a time (overlapping vest events for the
    same issuer do not double-count).
  - Benchmark: buy-and-hold of each traded ticker over the same window.

Inputs (user-provided; nothing is synthesized):
  --events   events.jsonl from scripts/rsu-events.py
  --prices   CSV with columns: date,ticker,open,high,low,close[,volume]
             date format YYYY-MM-DD. No prices = honest failure, not fake data.

Output: JSON report + markdown summary to stdout (or --out).

Caveats this harness does NOT fix (stated in every report):
  taxes, corporate actions in prices, intraday timing, liquidity constraints,
  multiple-testing (trying many N until one looks good), regime change.
"""

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

CAVEATS = [
    "PAPER ONLY - not a trading signal, no real money, no broker connection.",
    "Backtested on a small, survivorship-prone sample of insider filings; results do not generalize.",
    "Ignores taxes, corporate actions, intraday timing, and liquidity constraints.",
    "Trying many hold periods / universes until one looks good is multiple-testing; a single run proves nothing.",
    "Past vesting-event returns do not predict future returns. Regime change kills most event studies.",
    "Blackout periods are not publicly disclosed and are not modeled here.",
]


def parse_date(s: str) -> date:
    y, m, d = (int(x) for x in s.strip()[:10].split("-"))
    return date(y, m, d)


def load_events(path: Path) -> list[dict]:
    events = []
    with path.open() as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                print(f"warn: skipping malformed line {i} in {path}", file=sys.stderr)
                continue
            if e.get("event_type") == "vest" and e.get("issuer_ticker") and e.get("knowable_date"):
                events.append(e)
    return events


def load_prices(path: Path) -> dict[str, dict[date, dict]]:
    """ticker -> {date: {open, close}} sorted by date."""
    px: dict[str, dict[date, dict]] = defaultdict(dict)
    with path.open(newline="") as f:
        rdr = csv.DictReader(f)
        cols = {c.lower() for c in (rdr.fieldnames or [])}
        need = {"date", "ticker", "open", "close"}
        if not need.issubset(cols):
            print(f"error: prices CSV needs columns {sorted(need)}; got {sorted(cols)}",
                  file=sys.stderr)
            sys.exit(1)
        for row in rdr:
            try:
                d = parse_date(row["date"] or row["Date"])
                t = (row["ticker"] or row["Ticker"] or "").strip().upper()
                o = float((row["open"] or row["Open"] or "").replace(",", ""))
                c = float((row["close"] or row["Close"] or "").replace(",", ""))
            except (ValueError, KeyError, AttributeError):
                continue
            if t and o > 0 and c > 0:
                px[t][d] = {"open": o, "close": c}
    return px


def run_backtest(events: list[dict], prices: dict[str, dict[date, dict]],
                 hold_days: int, commission: float, slippage_bps: float) -> dict:
    slip = slippage_bps / 10_000.0
    # Per ticker: sorted trading dates
    tdates: dict[str, list[date]] = {t: sorted(d.keys()) for t, d in prices.items()}

    trades = []
    skipped_no_price = 0
    skipped_overlap = 0
    open_until: dict[str, date] = {}  # ticker -> date position closes

    # Process events in knowable-date order (point-in-time)
    for e in sorted(events, key=lambda x: (x["knowable_date"], x["event_id"])):
        ticker = e["issuer_ticker"].upper()
        kd = parse_date(e["knowable_date"])
        if ticker not in tdates:
            skipped_no_price += 1
            continue
        dates = tdates[ticker]
        # First tradable date on/after knowable_date
        entry_idx = next((i for i, d in enumerate(dates) if d >= kd), None)
        if entry_idx is None:
            skipped_no_price += 1
            continue
        entry_date = dates[entry_idx]
        if entry_idx + hold_days >= len(dates):
            skipped_no_price += 1  # not enough forward data
            continue
        exit_date = dates[entry_idx + hold_days]

        # One position per ticker at a time
        if open_until.get(ticker, date.min) > entry_date:
            skipped_overlap += 1
            continue

        entry_px = prices[ticker][entry_date]["open"] * (1 + slip) + commission
        exit_px = prices[ticker][exit_date]["close"] * (1 - slip) - commission
        ret = exit_px / entry_px - 1.0
        trades.append({
            "ticker": ticker,
            "event_id": e["event_id"],
            "event_date": e["event_date"],
            "knowable_date": e["knowable_date"],
            "knowable_estimated": e.get("knowable_estimated", False),
            "entry_date": entry_date.isoformat(),
            "exit_date": exit_date.isoformat(),
            "entry_px": round(entry_px, 4),
            "exit_px": round(exit_px, 4),
            "return": round(ret, 6),
        })
        open_until[ticker] = exit_date

    return {
        "trades": trades,
        "skipped_no_price": skipped_no_price,
        "skipped_overlap": skipped_overlap,
    }


def summarize(trades: list[dict], hold_days: int) -> dict:
    n = len(trades)
    if n == 0:
        return {"n_trades": 0}
    rets = [t["return"] for t in trades]
    wins = sum(1 for r in rets if r > 0)
    mean = sum(rets) / n
    var = sum((r - mean) ** 2 for r in rets) / n
    sd = math.sqrt(var)
    # Sharpe annualized from per-trade (holding-period) returns: crude but labeled
    sharpe = (mean / sd * math.sqrt(252 / hold_days)) if sd > 0 else 0.0
    # Max drawdown on cumulative trade-return equity curve
    eq, peak, mdd = 1.0, 1.0, 0.0
    for r in rets:
        eq *= (1 + r)
        peak = max(peak, eq)
        mdd = max(mdd, (peak - eq) / peak)
    total = eq - 1.0
    return {
        "n_trades": n,
        "win_rate": round(wins / n, 4),
        "avg_return_per_trade": round(mean, 6),
        "total_return": round(total, 6),
        "sharpe_annualized_crude": round(sharpe, 4),
        "max_drawdown": round(mdd, 6),
        "best": round(max(rets), 6),
        "worst": round(min(rets), 6),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Paper-only backtest of RSU vest events")
    ap.add_argument("--events", required=True, help="events.jsonl from rsu-events.py")
    ap.add_argument("--prices", required=True,
                    help="CSV: date,ticker,open,high,low,close[,volume]")
    ap.add_argument("--hold-days", type=int, default=20,
                    help="trading days to hold after entry (default 20)")
    ap.add_argument("--commission", type=float, default=0.0,
                    help="flat commission per trade leg in price units (default 0)")
    ap.add_argument("--slippage-bps", type=float, default=5.0,
                    help="slippage per trade leg in bps (default 5)")
    ap.add_argument("--out", default=None, help="write JSON report to file")
    args = ap.parse_args()

    ev_path, px_path = Path(args.events), Path(args.prices)
    if not ev_path.exists():
        print(f"error: events file not found: {ev_path}", file=sys.stderr)
        return 1
    if not px_path.exists():
        print(f"error: prices file not found: {px_path} - provide real price data; "
              "nothing is synthesized", file=sys.stderr)
        return 1

    events = load_events(ev_path)
    prices = load_prices(px_path)
    if not events:
        print("error: no vest events with ticker + knowable_date in events file",
              file=sys.stderr)
        return 1

    result = run_backtest(events, prices, args.hold_days, args.commission,
                          args.slippage_bps)
    stats = summarize(result["trades"], args.hold_days)

    report = {
        "paper_only": True,
        "not_a_trading_signal": True,
        "strategy": (f"long issuer at first open on/after knowable_date of each "
                     f"RSU vest event, hold {args.hold_days} trading days, exit at close"),
        "params": {"hold_days": args.hold_days, "commission": args.commission,
                   "slippage_bps": args.slippage_bps},
        "universe": {"n_vest_events": len(events),
                     "n_tickers_with_prices": len(prices)},
        "execution": {"skipped_no_price_data": result["skipped_no_price"],
                      "skipped_overlapping_position": result["skipped_overlap"]},
        "stats": stats,
        "trades": result["trades"],
        "caveats": CAVEATS,
    }

    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=1))
        print(f"wrote {args.out}")

    s = stats
    print("=" * 64)
    print("PAPER ONLY - NOT A TRADING SIGNAL - NO REAL MONEY")
    print("=" * 64)
    print(f"strategy : {report['strategy']}")
    print(f"events   : {len(events)} vest events, {len(prices)} tickers with prices")
    if s.get("n_trades"):
        print(f"trades   : {s['n_trades']} (win rate {s['win_rate']:.1%})")
        print(f"avg/trade: {s['avg_return_per_trade']:+.2%}   total: {s['total_return']:+.2%}")
        print(f"sharpe*  : {s['sharpe_annualized_crude']:+.2f}   max DD: {s['max_drawdown']:.2%}")
        print(f"best/worst: {s['best']:+.2%} / {s['worst']:+.2%}")
        print("(*crude: from holding-period returns, labeled as such)")
    else:
        print("trades   : 0 - no tradable events (check price coverage)")
    print(f"skipped  : {result['skipped_no_price']} no-price, "
          f"{result['skipped_overlap']} overlapping")
    print("-" * 64)
    for c in CAVEATS:
        print(f"  ! {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
