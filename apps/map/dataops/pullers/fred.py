"""FRED graph CSV puller: fred_gasregw (GASREGW), fred_wti (DCOILWTICO)."""
import csv
import io
import os

from .. import common as C

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"


def pull(dataset: str, series_id: str, since: str | None = None) -> dict:
    raw = C.http_get(FRED_CSV, params={"id": series_id})
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))))
    date_col = "observation_date" if "observation_date" in rows[0] else "DATE"
    out = []
    for r in rows:
        d = r[date_col].strip()
        if since and d < since:
            continue
        v = r[series_id].strip()
        if v in ("", "."):
            continue
        out.append({"date": d, "value": v})
    out.sort(key=lambda r: r["date"])
    pdir = C.write_raw(dataset, raw, filename=f"fred_{series_id}.csv",
                       extra_meta={"url": FRED_CSV + f"?id={series_id}",
                                   "series_id": series_id})
    staged = _merge_staged(dataset, out)
    pull = {"pulled_at": C.utcnow(), "status": "ok", "rows": len(out),
            "staged_rows": staged, "pull_dir": pdir,
            "date_range": [out[0]["date"], out[-1]["date"]] if out else None}
    C.record_manifest(dataset, pull)
    return pull


def _merge_staged(dataset: str, rows: list[dict]) -> int:
    """Incremental merge on natural key (date); new values win."""
    path = C.stage_path(dataset)
    have: dict[str, dict] = {}
    if os.path.exists(path):
        for r in C.read_csv_rows(path):
            have[r["date"]] = r
    for r in rows:
        have[r["date"]] = r
    merged = [have[k] for k in sorted(have)]
    C.write_csv_rows(path, merged, ["date", "value"])
    return len(merged)


def backfill(dataset: str, series_id: str, since: str) -> dict:
    # FRED csv is the full series; backfill == full pull bounded below.
    return pull(dataset, series_id, since=since)
