"""Aligned multi-domain frame for the multi-tower model.

Inner-joins the per-domain daily frames on date, prefixes feature columns
per tower (c_ commodities, s_ seismic, h_ hydro, g_ grid), keeps the task
target columns unprefixed. Rows are point-in-time correct because every
input frame already is.
"""
import os

import pandas as pd

from dataops import common as C

PREFIX = {"commodities_daily": "c_", "seismic_daily": "s_",
          "hydro_daily": "h_", "grid_daily": "g_"}
TARGETS = ["gas_fwd7", "gas_up7", "wti_fwd7", "quake_fwd7"]
REFS = ["ref_gas", "ref_wti", "ref_q25"]
# A frame needs multi-year history to join the multitask frame; short
# histories (e.g. the ERCOT grid collector, ~1 month) are skipped honestly
# until they accumulate — never silently, always printed.
MIN_JOIN_DAYS = 1825


def build() -> dict:
    frames = []
    for name, pre in PREFIX.items():
        p = os.path.join(C.ROOT, "frames", f"{name}.csv")
        if not os.path.exists(p):
            print(f"  (skip {name}: frame not built yet)")
            continue
        df = pd.read_csv(p, parse_dates=["date"])
        span = (df["date"].max() - df["date"].min()).days
        if span < MIN_JOIN_DAYS:
            print(f"  (skip {name}: only {span}d of history, "
                  f"needs {MIN_JOIN_DAYS}d)")
            continue
        keep_targets = [t for t in TARGETS if t in df.columns]
        keep_refs = [r for r in REFS if r in df.columns]
        feats = [c for c in df.columns
                 if c not in ("date", *TARGETS, *REFS)]
        df = df.rename(columns={c: pre + c for c in feats})
        frames.append(df[["date", *[pre + c for c in feats],
                          *keep_targets, *keep_refs]])
    if not frames:
        C.fail("no domain frames built — run: dataops frame <name> first")
    out = frames[0]
    for df in frames[1:]:
        out = out.merge(df, on="date", how="inner",
                        suffixes=("", "_dup"))
        dup = [c for c in out.columns if c.endswith("_dup")]
        if dup:  # same target built by two frames: keep first, fail loud
            C.fail(f"target column collision on join: {dup}")
    out = out.sort_values("date").reset_index(drop=True)
    n_before = len(out)
    out = out.dropna().reset_index(drop=True)
    # daily grain contract: no gaps allowed (seasonal baselines use offsets)
    gaps = (out["date"].diff().dropna() != pd.Timedelta(days=1)).sum()
    if gaps:
        C.fail(f"multitower frame has {gaps} date gaps — investigate before training")
    path = C.root_path("frames", "multitower_daily.csv")
    out.to_csv(path, index=False)
    towers = {t: [c for c in out.columns if c.startswith(p)]
              for t, p in [("commodities", "c_"), ("seismic", "s_"),
                           ("hydro", "h_"), ("grid", "g_")]}
    return {"frame": "multitower_daily", "rows": len(out),
            "dropped_join_na": n_before - len(out),
            "date_range": [str(out["date"].min().date()),
                           str(out["date"].max().date())],
            "tower_dims": {k: len(v) for k, v in towers.items()},
            "targets": [t for t in TARGETS if t in out.columns]}
