#!/usr/bin/env python3
"""Walk-forward trainer for the multi-tower multitask model.

Protocol (honest, matches the gas-forecaster discipline):
- Expanding windows: for each test year Y in [FIRST_TEST_YEAR, last full year],
  train on all rows with date < Y-01-01 minus a 14-day purge, validate on the
  last 365 train days (early stopping), test on [Y-01-01, Y+1-01-01).
- No lookahead: features are strictly positive lags (enforced at frame build);
  the purge keeps train labels from touching the test year's feature window.
- Baselines per task: persistence (value at t) and seasonal naive (t-364);
  classification vs 0.5 and vs majority class.
- Metrics are reported in ORIGINAL units.

Saves models/multitower_v0/: config.json, metrics.json, windows.csv,
weights_final.npz (last window), scalers_final.json.
"""
import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from dataops import common as C  # noqa: E402
from ml.multitower.model import Adam, MultiTower, sigmoid  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_ID = "multitower_v0"
FIRST_TEST_YEAR = 2012
PURGE_DAYS = 14
VAL_DAYS = 365
EPOCHS, PATIENCE, BATCH = 400, 30, 1024
LR, WD = 3e-3, 1e-4

REF_FOR = {"gas_fwd7": "ref_gas", "wti_fwd7": "ref_wti",
           "quake_fwd7": "ref_q25"}


def load_tasks():
    with open(os.path.join(HERE, "tasks.json")) as f:
        return json.load(f)


def prepare(df: pd.DataFrame, task_cfg: dict, tower_prefix: dict):
    tasks = {t: c for t, c in task_cfg["tasks"].items()
             if t in df.columns and df[t].notna().sum() > 100}
    towers = {name: [c for c in df.columns if c.startswith(pre)]
              for name, pre in tower_prefix.items()}
    towers = {n: cols for n, cols in towers.items() if cols}
    return tasks, towers


def standardize_fit(X):
    mu, sd = X.mean(axis=0), X.std(axis=0)
    sd = np.where(sd < 1e-12, 1.0, sd)
    return mu, sd


def main():
    task_cfg = load_tasks()
    frame = pd.read_csv(C.root_path("frames", "multitower_daily.csv"),
                        parse_dates=["date"])
    tasks, towers = prepare(frame, task_cfg, task_cfg["tower_prefix"])
    print(f"tasks: {list(tasks)} | towers: "
          f"{ {k: len(v) for k, v in towers.items()} } | rows: {len(frame)}")
    if not tasks:
        C.fail("no usable task targets in multitower_daily.csv")

    last_year = frame["date"].dt.year.max()
    first_possible = max(FIRST_TEST_YEAR, frame["date"].dt.year.min() + 4)
    test_years = list(range(first_possible, last_year))  # last full year
    if not test_years:
        C.fail("frame too short for walk-forward eval")
    print(f"walk-forward test years: {test_years[0]}..{test_years[-1]}")

    X_all = {n: frame[cols].to_numpy(dtype=np.float64)
             for n, cols in towers.items()}
    y_all = {t: frame[t].to_numpy(dtype=np.float64) for t in tasks}
    dates = frame["date"]

    window_rows, metrics = [], {}
    final_artifacts = None

    for Y in test_years:
        t0 = pd.Timestamp(f"{Y}-01-01")
        tr_mask = dates < (t0 - pd.Timedelta(days=PURGE_DAYS))
        te_mask = (dates >= t0) & (dates < t0 + pd.DateOffset(years=1))
        tr_idx = np.where(tr_mask)[0]
        te_idx = np.where(te_mask)[0]
        if len(te_idx) < 30 or len(tr_idx) < 1000:
            print(f"  {Y}: skip (train {len(tr_idx)}, test {len(te_idx)})")
            continue
        va_idx = tr_idx[-VAL_DAYS:]
        tr_idx = tr_idx[:-VAL_DAYS]

        # scalers fit on train(+val) only — all strictly before the test year
        fit_idx = np.concatenate([tr_idx, va_idx])
        tmu = {n: standardize_fit(X_all[n][fit_idx]) for n in towers}
        Xs = {n: (X_all[n] - tmu[n][0]) / tmu[n][1] for n in towers}

        ycfg, ymu = {}, {}
        for t, c in tasks.items():
            kind = c["kind"]
            y = y_all[t]
            if kind == "count":
                y = np.log1p(np.clip(y, 0, None))
            if kind in ("reg", "count"):
                mu, sd = y[fit_idx].mean(), y[fit_idx].std()
                sd = sd if sd > 1e-12 else 1.0
                ymu[t] = (mu, sd, kind)
                ycfg[t] = (y - mu) / sd
            else:
                ymu[t] = (0.0, 1.0, kind)
                ycfg[t] = y

        model = MultiTower({n: len(cols) for n, cols in towers.items()},
                           tasks=list(tasks), seed=1000 + Y)
        opt = Adam(model._all_params(), lr=LR, wd=WD)
        w = np.array([tasks[t]["weight"] for t in tasks])

        def batch_loss(idxs):
            xb = {n: Xs[n][idxs] for n in towers}
            preds = model.forward(xb)
            douts, loss, parts = {}, 0.0, {}
            for j, t in enumerate(tasks):
                kind = tasks[t]["kind"]
                p, y = preds[t], ycfg[t][idxs]
                n = len(idxs)
                if kind == "clf":
                    s = sigmoid(p)
                    eps = 1e-9
                    l = -(y * np.log(s + eps) + (1 - y) * np.log(1 - s + eps)).mean()
                    douts[t] = (s - y) / n
                else:
                    l = ((p - y) ** 2).mean()
                    douts[t] = 2 * (p - y) / n
                loss += w[j] * l
                parts[t] = float(l)
            return loss, parts, douts

        best, best_state, bad = np.inf, None, 0
        rng = np.random.default_rng(Y)
        for ep in range(EPOCHS):
            perm = rng.permutation(tr_idx)
            for s in range(0, len(perm), BATCH):
                idxs = perm[s:s + BATCH]
                loss, _, douts = batch_loss(idxs)
                grads = model.backward(douts)
                opt.step(grads)
            vloss, _, _ = batch_loss(va_idx)
            if vloss < best - 1e-6:
                best, bad = vloss, 0
                best_state = {n: p.copy() for n, p in model._all_params()}
            else:
                bad += 1
                if bad >= PATIENCE:
                    break
        for n, p in model._all_params():
            p[...] = best_state[n]

        # ---- score the test year in original units ----
        xb = {n: Xs[n][te_idx] for n in towers}
        preds = model.forward(xb)
        row = {"year": Y, "n_test": len(te_idx), "epochs": ep + 1,
               "val_loss": round(float(best), 4)}
        for t, c in tasks.items():
            kind = c["kind"]
            mu, sd, _ = ymu[t]
            y_true = y_all[t][te_idx]
            if kind == "clf":
                phat = (sigmoid(preds[t]) > 0.5).astype(float)
                acc = float((phat == y_true).mean())
                row[f"{t}_acc"] = round(acc, 4)
                row[f"{t}_acc_base05"] = 0.5
                maj = float(max(y_true.mean(), 1 - y_true.mean()))
                row[f"{t}_acc_basetmaj"] = round(maj, 4)
            else:
                phat = preds[t] * sd + mu
                if kind == "count":
                    phat = np.expm1(np.clip(phat, 0, 10))
                mae = float(np.abs(phat - y_true).mean())
                row[f"{t}_mae"] = round(mae, 4)
                ref = REF_FOR.get(t)
                if ref and ref in frame.columns:
                    base = frame[ref].to_numpy(dtype=np.float64)[te_idx]
                    row[f"{t}_mae_persist"] = round(
                        float(np.abs(base - y_true).mean()), 4)
                    # seasonal naive: same weekday last year via lag-364
                    seas = frame[ref].to_numpy(dtype=np.float64)
                    s_idx = te_idx - 364
                    ok = s_idx >= 0
                    if ok.sum() > 30:
                        row[f"{t}_mae_seas364"] = round(
                            float(np.abs(seas[s_idx[ok]] - y_true[ok]).mean()), 4)
        window_rows.append(row)
        print(f"  {Y}: " + " ".join(
            f"{t}={row.get(f'{t}_mae', row.get(f'{t}_acc'))}" for t in tasks))
        final_artifacts = (model, tmu, ymu, towers, tasks)

    outdir = os.path.join(C.ROOT, "models", MODEL_ID)
    os.makedirs(outdir, exist_ok=True)
    model, tmu, ymu, towers, tasks = final_artifacts
    model.save(os.path.join(outdir, "weights_final.npz"))
    with open(os.path.join(outdir, "scalers_final.json"), "w") as f:
        json.dump({"towers": {n: {"mean": mu.tolist(), "std": sd.tolist()}
                              for n, (mu, sd) in tmu.items()},
                   "targets": {t: {"mean": float(mu), "std": float(sd),
                                   "kind": kind}
                               for t, (mu, sd, kind) in ymu.items()},
                   "tower_cols": towers,
                   "tasks": list(tasks),
                   "trained_on": f"{first_possible}..{test_years[-1]}"}, f)
    with open(os.path.join(outdir, "config.json"), "w") as f:
        json.dump({"model": MODEL_ID, "tower_h": 32, "trunk_h": 64,
                   "epochs": EPOCHS, "patience": PATIENCE, "batch": BATCH,
                   "lr": LR, "wd": WD, "purge_days": PURGE_DAYS,
                   "val_days": VAL_DAYS, "first_test_year": FIRST_TEST_YEAR,
                   "horizon_days": task_cfg["horizon_days"],
                   "trained_at": C.utcnow(),
                   "frame": "multitower_daily.csv"}, f, indent=2)
    wdf = pd.DataFrame(window_rows)
    wdf.to_csv(os.path.join(outdir, "windows.csv"), index=False)
    metrics = {"model": MODEL_ID, "windows": window_rows,
               "mean": {c: round(float(wdf[c].mean()), 4)
                        for c in wdf.columns if c != "year"}}
    with open(os.path.join(outdir, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"\nsaved {outdir}/ (weights_final.npz, metrics.json, windows.csv)")


if __name__ == "__main__":
    main()
