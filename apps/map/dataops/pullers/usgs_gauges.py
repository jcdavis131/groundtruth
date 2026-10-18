"""USGS water puller: daily discharge (00060, cfs) + stage (00065, ft)
for the 8 watched gauges.

Source: https://waterservices.usgs.gov/nwis/dv/ (free, no key).
Pulls 5-year chunks per site; merges on (date, site, param).
"""
import json
import os
from datetime import date, timedelta

from .. import common as C

DV = "https://waterservices.usgs.gov/nwis/dv/"
PARAMS = ["00060", "00065"]
CHUNK_YEARS = 1  # 1-year chunks proved most reliable against truncated responses


def _sites() -> list[str]:
    with open(os.path.join(os.path.dirname(__file__), "..", "registry.json")) as f:
        return json.load(f)["datasets"]["usgs_gauges"]["sites"]


def _fetch(site: str, start: str, end: str) -> list[dict]:
    data = C.http_json(DV, params={"format": "json", "sites": site,
                                   "startDT": start, "endDT": end,
                                   "parameterCd": ",".join(PARAMS)})
    out = []
    for ts in (data.get("value") or {}).get("timeSeries", []):
        var = ((ts.get("variable") or {}).get("variableCode") or [{}])[0]
        code = var.get("value")
        if code not in PARAMS:
            continue
        for v in ts.get("values", [{}])[0].get("value", []):
            if v.get("value") in (None, ""):
                continue
            out.append({"date": v["dateTime"][:10], "site": site,
                        "param": code, "value": v["value"]})
    return out


def pull(dataset: str, since: str | None = None) -> dict:
    with open(os.path.join(os.path.dirname(__file__), "..", "registry.json")) as f:
        reg = json.load(f)["datasets"]["usgs_gauges"]
    since = since or reg["backfill_from"]
    # Incremental: start after the last staged date (30d overlap for revisions).
    staged = C.stage_path(dataset)
    if os.path.exists(staged):
        rows = C.read_csv_rows(staged)
        if rows:
            latest = max(r["date"] for r in rows)
            since = max(since, (date.fromisoformat(latest)
                                - timedelta(days=30)).isoformat()[:10])
    today = date.today().isoformat()
    s0 = int(since[:4])
    s1 = int(today[:4])
    n_rows, n_req, failed = 0, 0, []
    for site in _sites():
        y = s0
        while y <= s1:
            chunk_end = min(y + CHUNK_YEARS - 1, s1)
            label = f"{site} {y}-{chunk_end}"
            try:
                rows = _fetch(site, f"{y}-01-01", f"{chunk_end}-12-31")
                n_req += 1
                n_rows += len(rows)
                _merge_staged(dataset, rows)  # incremental: a later failure
                print(f"  ok {label}: {len(rows)} rows", flush=True)          # keeps earlier chunks
            except Exception as e:  # noqa: BLE001 - log and continue
                failed.append({"chunk": label, "error": str(e)[:160]})
                print(f"  FAIL {label}: {str(e)[:120]}", flush=True)
            y += CHUNK_YEARS
    C.write_raw(dataset,
                f"sites={','.join(_sites())} since={since}".encode(),
                filename="pull_note.txt",
                extra_meta={"url": DV, "requests": n_req, "since": since,
                            "failed_chunks": failed})
    staged_rows = sum(1 for _ in open(C.stage_path(dataset))) - 1 \
        if os.path.exists(C.stage_path(dataset)) else 0
    pull = {"pulled_at": C.utcnow(),
            "status": "ok" if not failed else f"partial: {len(failed)} chunks failed",
            "rows": n_rows, "requests": n_req, "staged_rows": staged_rows,
            "failed_chunks": failed}
    C.record_manifest(dataset, pull)
    return pull


def _merge_staged(dataset: str, rows: list[dict]) -> int:
    path = C.stage_path(dataset)
    have: dict[tuple, dict] = {}
    if os.path.exists(path):
        for r in C.read_csv_rows(path):
            have[(r["date"], r["site"], r["param"])] = r
    cols = ["date", "site", "param", "value"]
    for r in rows:
        have[(r["date"], r["site"], r["param"])] = {c: r[c] for c in cols}
    merged = [have[k] for k in sorted(have)]
    C.write_csv_rows(path, merged, cols)
    return len(merged)


def backfill(dataset: str, since: str) -> dict:
    return pull(dataset, since=since)
