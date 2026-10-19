"""USGS earthquake puller: daily aggregates of M>=2.5 events.

Source: https://earthquake.usgs.gov/fdsnws/event/1/query
Backfill walks month-by-month from `since` to today (one request per month,
polite pacing), aggregating per-day counts by magnitude bucket plus max
magnitude and a total-moment proxy (sum of 10^(1.5*M)).

Raw: one GeoJSON file per month-chunk under raw/<pull_id>/ (append-only).
Staged: merged incrementally per chunk, so an interrupted backfill keeps
its progress; reruns resume after the last staged date (3d overlap).
"""
import json
import os
import urllib.parse
from datetime import date, timedelta

from .. import common as C

QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query"
CHUNK_DAYS = 31


def _month_windows(since: str, until: str):
    s = date.fromisoformat(since)
    e = date.fromisoformat(until)
    while s <= e:
        chunk_end = min(s + timedelta(days=CHUNK_DAYS - 1), e)
        yield s.isoformat(), chunk_end.isoformat()
        s = chunk_end + timedelta(days=1)


def _fetch_window(start: str, end: str) -> tuple[list, bytes]:
    url = QUERY + "?" + urllib.parse.urlencode(
        {"format": "geojson", "starttime": start, "endtime": end,
         "minmagnitude": 2.5, "orderby": "time"})
    raw = C.http_get(url, timeout=120)
    data = json.loads(raw.decode("utf-8", "replace"))
    out = []
    for f in data.get("features") or []:
        p = f.get("properties") or {}
        m = p.get("mag")
        t = p.get("time")
        if m is None or t is None:
            continue
        out.append((date.fromtimestamp(t / 1000).isoformat(), float(m)))
    return out, raw


def _aggregate(events: list[tuple[str, float]]) -> dict[str, dict]:
    days: dict[str, dict] = {}
    for day, m in events:
        d = days.setdefault(day, {"world_m25": 0, "world_m45": 0,
                                  "world_m60": 0, "max_mag": 0.0,
                                  "sum_moment": 0.0})
        d["world_m25"] += 1
        if m >= 4.5:
            d["world_m45"] += 1
        if m >= 6.0:
            d["world_m60"] += 1
        d["max_mag"] = max(d["max_mag"], m)
        d["sum_moment"] += 10 ** (1.5 * m)
    return days


COLS = ["date", "world_m25", "world_m45", "world_m60", "max_mag", "sum_moment"]


def _merge_staged(dataset: str, rows: list[dict]) -> int:
    path = C.stage_path(dataset)
    have: dict[str, dict] = {}
    if os.path.exists(path):
        for r in C.read_csv_rows(path):
            have[r["date"]] = r
    for r in rows:
        have[r["date"]] = {c: r[c] for c in COLS}
    merged = [have[k] for k in sorted(have)]
    C.write_csv_rows(path, merged, COLS)
    return len(merged)


def _rows_for(days: dict[str, dict]) -> list[dict]:
    return [{"date": d, **{k: round(v, 4) if isinstance(v, float) else v
                           for k, v in days[d].items()}}
            for d in sorted(days)]


def pull(dataset: str, since: str | None = None) -> dict:
    with open(os.path.join(os.path.dirname(__file__), "..", "registry.json")) as f:
        reg = json.load(f)["datasets"]["usgs_quakes"]
    since = since or reg.get("backfill_from", "2000-01-01")
    today = date.today().isoformat()
    # Incremental resume: start after the last staged date (3d overlap).
    staged = C.stage_path(dataset)
    if os.path.exists(staged):
        rows = C.read_csv_rows(staged)
        if rows:
            since = max(since, (date.fromisoformat(rows[-1]["date"])
                                - timedelta(days=3)).isoformat())
    pull_dir = os.path.join(C.ROOT, "raw", dataset,
                            C.utcnow().replace(":", "").replace("-", ""))
    os.makedirs(pull_dir, exist_ok=True)
    n_req, n_events, n_rows, staged_rows, failed = 0, 0, 0, 0, []
    for s, e in _month_windows(since, today):
        label = f"{s}_{e}"
        try:
            ev, raw = _fetch_window(s, e)
            with open(os.path.join(pull_dir, f"quakes_{label}.geojson"),
                      "wb") as fh:
                fh.write(raw)
            n_req += 1
            n_events += len(ev)
            rows = _rows_for(_aggregate(ev))
            n_rows += len(rows)
            staged_rows = _merge_staged(dataset, rows)  # incremental
        except Exception as ex:  # noqa: BLE001 - log and continue
            failed.append({"chunk": label, "error": str(ex)[:160]})
            print(f"  FAIL {label}: {str(ex)[:120]}", flush=True)
    pull = {"pulled_at": C.utcnow(),
            "status": "ok" if not failed else f"partial: {len(failed)} failed",
            "rows": n_rows, "events": n_events, "requests": n_req,
            "staged_rows": staged_rows, "pull_dir": pull_dir,
            "failed_chunks": failed,
            "date_range": [since, today]}
    C.record_manifest(dataset, pull)
    return pull


def backfill(dataset: str, since: str) -> dict:
    return pull(dataset, since=since)
