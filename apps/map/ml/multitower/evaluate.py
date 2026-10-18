#!/usr/bin/env python3
"""Honest eval report for the multi-tower model.

Reads models/multitower_v0/metrics.json, compares every task against its
baselines (persistence, seasonal naive, majority class), and writes REPORT.md
next to the model. Prints the headline table to stdout.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from dataops import common as C  # noqa: E402

MODEL_ID = "multitower_v0"


def main():
    d = os.path.join(C.ROOT, "models", MODEL_ID)
    with open(os.path.join(d, "metrics.json")) as f:
        m = json.load(f)
    mean = m["mean"]
    lines = [f"# {MODEL_ID} — walk-forward evaluation", "",
             "Expanding-window refits, 14-day purge, strictly out-of-sample. "
             "Baselines: persistence (value at t), seasonal naive (t-364), "
             "majority class.", "",
             "| task | model | persistence | seasonal-364 | verdict |",
             "|---|---|---|---|---|"]
    verdicts = []
    for t in ("gas_fwd7", "wti_fwd7", "quake_fwd7"):
        mae, per, seas = (mean.get(f"{t}_mae"), mean.get(f"{t}_mae_persist"),
                          mean.get(f"{t}_mae_seas364"))
        if mae is None:
            continue
        beats = [("persistence", per), ("seasonal", seas)]
        won = [name for name, b in beats if b and mae < b]
        v = "beats " + "+".join(won) if won else "BELOW baselines"
        verdicts.append((t, v))
        lines.append(f"| {t} | {mae} | {per} | {seas} | {v} |")
    acc, maj = mean.get("gas_up7_acc"), mean.get("gas_up7_acc_basetmaj")
    if acc is not None:
        v = "beats majority" if acc > maj else "below majority"
        verdicts.append(("gas_up7", v))
        lines += ["",
                  f"Direction (gas_up7): model acc {acc} vs 0.5 coin / "
                  f"{maj} majority — {v}."]
    lines += ["", "## Per-year detail", "",
              "See `windows.csv` for the year-by-year breakdown."]
    report = "\n".join(lines) + "\n"
    with open(os.path.join(d, "REPORT.md"), "w") as f:
        f.write(report)
    print(report)
    print("verdicts:", verdicts)


if __name__ == "__main__":
    main()
