#!/usr/bin/env python3
"""Emit next-step forecasts from the trained multi-tower model.

Builds the latest multitower frame row (point-in-time correct), standardizes
with the saved scalers, runs the final weights, and writes
models/multitower_v0/forecasts.json with provenance.

  --site-bundle   also write lib/ml/data/multitower_forecasts.json for the
                  eye.jcamd.com site to consume (same bundle pattern as the
                  gas layers).
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from dataops import common as C  # noqa: E402
from ml.multitower.model import MultiTower, sigmoid  # noqa: E402

MODEL_ID = "multitower_v0"
HORIZON = 7


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-bundle", action="store_true")
    args = ap.parse_args()

    d = os.path.join(C.ROOT, "models", MODEL_ID)
    with open(os.path.join(d, "scalers_final.json")) as f:
        sc = json.load(f)
    with open(os.path.join(d, "config.json")) as f:
        cfg = json.load(f)

    frame = pd.read_csv(C.root_path("frames", "multitower_daily.csv"),
                        parse_dates=["date"])
    row = frame.iloc[-1]
    asof = str(row["date"].date())

    model = MultiTower({n: len(cols) for n, cols in sc["tower_cols"].items()},
                       tasks=sc["tasks"])
    model.load(os.path.join(d, "weights_final.npz"))

    xs = {}
    for n, cols in sc["tower_cols"].items():
        mu = np.array(sc["towers"][n]["mean"])
        sd = np.array(sc["towers"][n]["std"])
        xs[n] = ((row[cols].to_numpy(dtype=np.float64) - mu) / sd)[None, :]
    preds = model.forward(xs)

    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "tasks.json")) as f:
        task_cfg = json.load(f)

    out_tasks = {}
    for t in sc["tasks"]:
        mu = sc["targets"][t]["mean"]
        sd = sc["targets"][t]["std"]
        kind = sc["targets"][t]["kind"]
        p = float(preds[t][0])
        if kind == "clf":
            out_tasks[t] = {"p_up": round(float(sigmoid(p)), 4)}
        else:
            v = p * sd + mu
            if kind == "count":
                v = float(np.expm1(max(v, 0)))
            out_tasks[t] = {"value": round(float(v), 4),
                            "unit": task_cfg["tasks"][t]["unit"]}
    fc = {"model": MODEL_ID, "asof": asof,
          "horizon_days": HORIZON,
          "forecast_for": str((row["date"] + pd.Timedelta(days=HORIZON)).date()),
          "tasks": out_tasks,
          "provenance": {"frame": "multitower_daily.csv",
                         "weights": "weights_final.npz",
                         "built_at": C.utcnow()},
          "disclaimer": "Research forecasts from a v0 model. Not advice."}
    with open(os.path.join(d, "forecasts.json"), "w") as f:
        json.dump(fc, f, indent=2)
    print(json.dumps(fc, indent=2))

    if args.site_bundle:
        dest = os.path.join(os.path.dirname(__file__), "..", "..",
                            "lib", "ml", "data", "multitower_forecasts.json")
        dest = os.path.normpath(dest)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w") as f:
            json.dump(fc, f, indent=2)
        print(f"site bundle: {dest}")


if __name__ == "__main__":
    main()
