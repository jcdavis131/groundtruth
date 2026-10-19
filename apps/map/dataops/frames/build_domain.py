"""Per-domain daily modeling frames.

Binding fill/lookahead rules (same spirit as gas-forecaster):
- Weekly targets are FORWARD-filled to daily: on any row the model sees only
  the most recent published print, exactly as a forecaster would in real time.
- Trading-day series (WTI) are forward-filled over weekends/holidays.
- NEVER backward-filled. Leading NaNs are dropped, never backfilled.
- Every feature is a strictly positive lag (>=1 day) of data known on or
  before the row date. Calendar dummies are the only exception.
- Targets are forward shifts (t+h); rows with NaN targets are dropped so
  training never sees a row it cannot score honestly.

Verification gate: every feature column name must end in _lagN / _chgN /
_rollN or be a calendar dummy (m_, dow_); the builder fails closed otherwise.
"""
import os

import numpy as np
import pandas as pd

from dataops import common as C

HORIZON = 7


def _cal(df: pd.DataFrame) -> pd.DataFrame:
    df["m"] = df["date"].dt.month
    df["dow"] = df["date"].dt.dayofweek
    cal = pd.get_dummies(df[["m", "dow"]], columns=["m", "dow"],
                         prefix=["m", "dow"], dtype=float)
    return pd.concat([df, cal], axis=1)


def _verify_no_lookahead(df: pd.DataFrame, targets: list[str]) -> None:
    feats = [c for c in df.columns
             if c not in ("date", *targets) and not c.startswith("ref_")]
    bad = [c for c in feats
           if not (c.startswith(("m_", "dow_")) or "_lag" in c or "_chg" in c
                   or "_roll" in c)]
    if bad:
        C.fail(f"lookahead gate: feature columns violate naming rule: {bad[:5]}")


def _staged(dataset: str) -> pd.DataFrame:
    p = C.stage_path(dataset)
    if not os.path.exists(p):
        C.fail(f"staged {dataset} missing — run: dataops pull {dataset}")
    df = pd.read_csv(p, parse_dates=["date"] if dataset != "usgs_gauges" else None)
    return df


def build_commodities() -> dict:
    gas = pd.read_csv(C.stage_path("fred_gasregw"), parse_dates=["date"])
    wti = pd.read_csv(C.stage_path("fred_wti"), parse_dates=["date"])
    start = max(gas["date"].min(), pd.Timestamp("1990-01-01"))
    end = max(gas["date"].max(), wti["date"].max())
    df = pd.DataFrame({"date": pd.date_range(start, end, freq="D")})
    df = df.merge(gas.rename(columns={"value": "gas"})[["date", "gas"]],
                  on="date", how="left")
    df = df.merge(wti.rename(columns={"value": "wti"})[["date", "wti"]],
                  on="date", how="left")
    df[["gas", "wti"]] = df[["gas", "wti"]].ffill()
    n_lead = int(df[["gas", "wti"]].isna().any(axis=1).sum())
    df = df.dropna(subset=["gas", "wti"]).reset_index(drop=True)

    for lag in (7, 14, 28):
        df[f"gas_lag{lag}"] = df["gas"].shift(lag)
    df["gas_chg7"] = df["gas"] / df["gas"].shift(7) - 1
    for lag in (1, 3, 7, 14, 21):
        df[f"wti_lag{lag}"] = df["wti"].shift(lag)
    df["wti_chg7"] = df["wti"] / df["wti"].shift(7) - 1
    df["wti_chg28"] = df["wti"] / df["wti"].shift(28) - 1

    # targets: 7-day forward
    df["gas_fwd7"] = df["gas"].shift(-HORIZON)
    df["gas_up7"] = (df["gas_fwd7"] > df["gas"]).astype(float)
    df["wti_fwd7"] = df["wti"].shift(-HORIZON)
    # reference values at t (for persistence baselines; never features)
    df["ref_gas"] = df["gas"]
    df["ref_wti"] = df["wti"]

    df = _cal(df).drop(columns=["gas", "wti", "m", "dow"])
    targets = ["gas_fwd7", "gas_up7", "wti_fwd7"]
    _verify_no_lookahead(df, targets)
    n_lag = int(df.isna().any(axis=1).sum())
    df = df.dropna().reset_index(drop=True)
    out = C.root_path("frames", "commodities_daily.csv")
    df.to_csv(out, index=False)
    return {"frame": "commodities_daily", "rows": len(df),
            "date_range": [str(df['date'].min().date()),
                           str(df['date'].max().date())],
            "dropped_leading": n_lead, "dropped_lag": n_lag,
            "targets": targets}


def build_seismic() -> dict:
    q = pd.read_csv(C.stage_path("usgs_quakes"), parse_dates=["date"])
    start, end = q["date"].min(), q["date"].max()
    df = pd.DataFrame({"date": pd.date_range(start, end, freq="D")})
    df = df.merge(q, on="date", how="left")
    # A day with no M>=2.5 events is a true zero (feed is global, complete
    # for M>=2.5 since 2000); missing feed days before first pull stay NaN.
    df[["world_m25", "world_m45", "world_m60"]] = \
        df[["world_m25", "world_m45", "world_m60"]].fillna(0)
    df["max_mag"] = df["max_mag"].ffill().fillna(0)
    df["sum_moment"] = df["sum_moment"].ffill().fillna(0)

    for lag in (1, 3, 7, 14, 28):
        df[f"q25_lag{lag}"] = df["world_m25"].shift(lag)
    df["q25_roll7_lag1"] = df["world_m25"].shift(1).rolling(7).sum()
    for lag in (1, 7):
        df[f"maxmag_lag{lag}"] = df["max_mag"].shift(lag)
        df[f"moment_log_lag{lag}"] = np.log1p(df["sum_moment"]).shift(lag)

    df["quake_fwd7"] = df["world_m25"].shift(-HORIZON)
    df["ref_q25"] = df["world_m25"]
    df = _cal(df).drop(columns=["world_m25", "world_m45", "world_m60",
                                "max_mag", "sum_moment", "m", "dow"])
    targets = ["quake_fwd7"]
    _verify_no_lookahead(df, targets)
    n_lag = int(df.isna().any(axis=1).sum())
    df = df.dropna().reset_index(drop=True)
    out = C.root_path("frames", "seismic_daily.csv")
    df.to_csv(out, index=False)
    return {"frame": "seismic_daily", "rows": len(df),
            "date_range": [str(df['date'].min().date()),
                           str(df['date'].max().date())],
            "dropped_lag": n_lag, "targets": targets}


def build_hydro() -> dict:
    g = pd.read_csv(C.stage_path("usgs_gauges"), parse_dates=["date"],
                    dtype={"site": str, "param": str})
    g["param"] = g["param"].str.zfill(5)
    dis = g[g["param"] == "00060"].pivot(index="date", columns="site",
                                         values="value").astype(float)
    dis = dis.sort_index().ffill()
    df = pd.DataFrame({"date": dis.index}).reset_index(drop=True)
    for site in dis.columns:
        s = dis[site].values
        ser = pd.Series(s, index=df.index)
        df[f"h_{site}_lag1"] = ser.shift(1)
        df[f"h_{site}_lag7"] = ser.shift(7)
        df[f"h_{site}_chg7"] = ser / ser.shift(7) - 1
    df = _cal(df).drop(columns=["m", "dow"])
    _verify_no_lookahead(df, [])
    n_lag = int(df.isna().any(axis=1).sum())
    df = df.dropna().reset_index(drop=True)
    out = C.root_path("frames", "hydro_daily.csv")
    df.to_csv(out, index=False)
    return {"frame": "hydro_daily", "rows": len(df),
            "date_range": [str(df['date'].min().date()),
                           str(df['date'].max().date())],
            "dropped_lag": n_lag, "targets": []}


def build_grid() -> dict:
    # Grid history is still accumulating (daily collector). Build features
    # only; tasks join once history is long enough for walk-forward eval.
    p_spp = C.stage_path("ercot_dam_spp")
    p_load = C.stage_path("ercot_load_wz")
    if not (os.path.exists(p_spp) and os.path.exists(p_load)):
        return {"frame": "grid_daily", "status": "skipped",
                "reason": "staged ercot files not present yet"}
    spp = pd.read_csv(p_spp)
    spp["date"] = pd.to_datetime(spp["delivery_date"], format="mixed")
    spp["price_usd_mwh"] = pd.to_numeric(spp["price_usd_mwh"], errors="coerce")
    daily_px = spp.groupby("date")["price_usd_mwh"].mean().rename("dam_px")
    load = pd.read_csv(p_load)
    load["date"] = pd.to_datetime(load["oper_day"], format="mixed")
    load["load_mw"] = pd.to_numeric(load["load_mw"], errors="coerce")
    tot = load[load["zone"] == "ERCOT_TOTAL"]
    daily_ld = tot.groupby("date")["load_mw"].agg(["mean", "max"])
    daily_ld.columns = ["load_mean", "load_max"]
    df = pd.DataFrame({"date": pd.to_datetime(
        sorted(set(daily_px.index) | set(daily_ld.index)))})
    df = df.merge(daily_px.rename("dam_px"), left_on="date",
                  right_index=True, how="left")
    df = df.merge(daily_ld, left_on="date", right_index=True, how="left")
    df[["dam_px", "load_mean", "load_max"]] = \
        df[["dam_px", "load_mean", "load_max"]].ffill()
    for lag in (1, 7):
        df[f"dam_px_lag{lag}"] = df["dam_px"].shift(lag)
        df[f"load_max_lag{lag}"] = df["load_max"].shift(lag)
    df["load_chg7"] = df["load_max"] / df["load_max"].shift(7) - 1
    df = _cal(df).drop(columns=["dam_px", "load_mean", "load_max", "m", "dow"])
    _verify_no_lookahead(df, [])
    df = df.dropna().reset_index(drop=True)
    out = C.root_path("frames", "grid_daily.csv")
    df.to_csv(out, index=False)
    return {"frame": "grid_daily", "rows": len(df),
            "date_range": [str(df['date'].min().date()),
                           str(df['date'].max().date())],
            "targets": [], "note": "features only — tasks join with history"}


BUILDERS = {"commodities_daily": build_commodities,
            "seismic_daily": build_seismic,
            "hydro_daily": build_hydro,
            "grid_daily": build_grid}


def build(name: str) -> dict:
    if name not in BUILDERS:
        C.fail(f"unknown frame {name}; one of {sorted(BUILDERS)}")
    return BUILDERS[name]()
