"""Tiny dependency-free client for the Embedding Atlas JSON API.

    from gev import report, areas, series, screen, to_dataframe
    r = report(-97.75, 30.3)                       # market report for a point
    tx = to_dataframe(areas("-106.7,25.8,-93.5,36.5")["data"]["features"])

Only urllib is used, so it runs anywhere Python 3.8+ does; pandas is imported
lazily by to_dataframe() and is optional. Set GEV_BASE_URL to point at a
different host (default http://localhost:3000; the public instance is
https://eye.jcamd.com).

Every function returns the route's JSON untouched: ``{...meta, "data": ...}``
with ``source`` and ``cacheAge`` in the meta, and ``provenance`` where the
route provides it. Nothing is invented client-side.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional

BASE_URL = os.environ.get("GEV_BASE_URL", "http://localhost:3000").rstrip("/")
USER_AGENT = "gev.py (https://github.com/jcdavis131/gods-eye-view)"
TIMEOUT_S = 60


class GevError(RuntimeError):
    """A route answered with an error status; ``status`` and ``body`` carry what it said."""

    def __init__(self, status: int, body: Any, url: str):
        super().__init__(f"HTTP {status} from {url}: {body}")
        self.status = status
        self.body = body
        self.url = url


def get(path: str, **params: Any) -> Dict[str, Any]:
    """GET ``path`` with query params (None values skipped) and return the parsed JSON.

    Commas are kept readable in the URL (bbox=w,s,e,n) so the URL you see in an
    error is the one you can paste into a browser or a citation.
    """
    clean = {k: v for k, v in params.items() if v is not None and v != ""}
    query = urllib.parse.urlencode(clean, safe=",:")
    url = f"{BASE_URL}{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:  # the routes answer JSON on 4xx/5xx too
        raw = e.read().decode("utf-8", errors="replace")
        try:
            body: Any = json.loads(raw)
        except ValueError:
            body = raw[:500]
        raise GevError(e.code, body, url) from None


def report(lon: float, lat: float, kind: str = "market") -> Dict[str, Any]:
    """Market (``kind="market"``) or water (``kind="water"``) report for a point.

    Market: home values, rents, affordability estimate, jobs, sectors, ports,
    pulse, momentum. Water: drought, gauges, flood status, reservoirs, wells,
    stress estimate. Both print the formula behind every estimate.
    """
    route = "/api/economy" if kind == "market" else "/api/water"
    return get(route, op="report", lon=lon, lat=lat)


def areas(bbox: Optional[str] = None, level: str = "county") -> Dict[str, Any]:
    """Counties in ``bbox`` ("w,s,e,n") or every state (``level="state"``) with QCEW jobs/wages and Zillow values/rents."""
    if level == "state":
        return get("/api/economy", op="areas", level="state")
    if not bbox:
        raise ValueError("bbox='w,s,e,n' is required for level='county'")
    return get("/api/economy", op="areas", bbox=bbox)


def series(series_id: str, from_: Optional[str] = None, to: Optional[str] = None, rollup: Optional[str] = None) -> Dict[str, Any]:
    """One stored time series: points ``[{"t": epoch_ms, "v": value|None}]`` with unit, frequency and provenance.

    ``rollup`` is one of ``daily-mean | daily-max | daily-last`` (one point per UTC day).
    """
    return get("/api/series", op="get", id=series_id, **{"from": from_, "to": to, "rollup": rollup})


def series_list(prefix: Optional[str] = None) -> Dict[str, Any]:
    """Metadata for every stored series, optionally filtered by id prefix (``"indicator:"``)."""
    return get("/api/series", op="list", prefix=prefix)


def screen(kind: str, q: str) -> Dict[str, Any]:
    """Run the screener on an entity set (``county | state | port | crossing | country``).

    ``q`` is ``<where> [SORT field [ASC|DESC]] [LIMIT n]``, e.g.
    ``"home.yoyPct > 5 AND jobs.yoy.emp < 0 SORT momentum DESC LIMIT 50"``.
    ``get("/api/screen", kind=kind, fields=1)`` lists the fields for a kind.
    """
    return get("/api/screen", kind=kind, q=q)


def indicators(ids: Optional[Iterable[str]] = None, category: Optional[str] = None) -> Dict[str, Any]:
    """Latest value, yoy change and threshold status for the named indicators."""
    return get("/api/indicators", op="latest", ids=",".join(ids) if ids else None, category=category)


def indicator_history(indicator_id: str) -> Dict[str, Any]:
    """The stored series behind one indicator id, with thresholds and provenance."""
    return get("/api/indicators", op="history", id=indicator_id)


def county_history(fips: str, years: Optional[int] = None) -> Dict[str, Any]:
    """Multi-year jobs, wages, home values, rents and momentum for one county FIPS."""
    return get("/api/economy/history", op="county", fips=fips, years=years)


def sectors(fips: str) -> Dict[str, Any]:
    """Private-sector NAICS mix with location quotients for a county (SSCCC) or state (SS000)."""
    return get("/api/economy", op="sectors", fips=fips)


def gauge_history(site: str, param: str) -> Dict[str, Any]:
    """365 days of USGS daily means for one site (``USGS-07032000``) and parameter code (``00065``)."""
    return get("/api/water", op="history", site=site, param=param)


def citations(payload: Dict[str, Any]) -> List[str]:
    """Citation lines from a response's ``provenance`` list (mirrors ``citation()`` in lib/provenance/types.ts).

    Falls back to a single line built from ``source`` when a route has no provenance field yet.
    """
    lines: List[str] = []
    for p in payload.get("provenance") or []:
        src = p.get("source", {})
        parts = [src.get("publisher", ""), src.get("name", "")]
        if p.get("seriesId"):
            parts.append(f"series {p['seriesId']}")
        if p.get("period"):
            parts.append(f"period {p['period']}")
        if p.get("releasedAt"):
            parts.append(f"released {str(p['releasedAt'])[:10]}")
        parts.append(p.get("upstreamUrl") or src.get("url", ""))
        parts.append(f"accessed {str(p.get('retrievedAt', ''))[:10]}")
        if p.get("kind") == "estimate":
            parts.append("estimate computed by Embedding Atlas" + (f": {p['method']}" if p.get("method") else ""))
        elif p.get("kind") == "snapshot":
            parts.append("Embedding Atlas snapshot of a live feed")
        lines.append(". ".join(x for x in parts if x) + ".")
    if not lines and payload.get("source"):
        lines.append(f"{payload['source']} via Embedding Atlas API (no provenance field on this route; cacheAge {payload.get('cacheAge')} ms).")
    return lines


def _flat(prefix: str, value: Any, out: Dict[str, Any], depth: int = 0) -> None:
    """Dotted keys for nested dicts (``extra.home.yoyPct``); lists stay as JSON strings; depth capped at 4."""
    if isinstance(value, dict) and depth < 4:
        for k, v in value.items():
            _flat(f"{prefix}.{k}" if prefix else str(k), v, out, depth + 1)
    elif isinstance(value, (dict, list)):
        out[prefix] = json.dumps(value)
    else:
        out[prefix] = value


def flatten_features(features: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """GeoJSON features -> flat dicts: ``properties`` keys at the top, nested keys dotted (``extra.home.yoyPct``), lon/lat for points."""
    rows: List[Dict[str, Any]] = []
    for f in features:
        row: Dict[str, Any] = {}
        _flat("", dict(f.get("properties") or {}), row)
        geom = f.get("geometry") or {}
        if geom.get("type") == "Point":
            row["lon"], row["lat"] = geom["coordinates"][:2]
        rows.append(row)
    return rows


def to_dataframe(rows: Any):
    """A pandas DataFrame from a list of GeoJSON features, a list of dicts, or a series' points.

    pandas is imported here so the rest of the module stays dependency-free.
    Series points get a ``time`` column (UTC) alongside ``t``/``v``.
    """
    import pandas as pd  # optional dependency

    if isinstance(rows, dict) and "points" in rows:
        rows = rows["points"]
    rows = list(rows)
    if rows and isinstance(rows[0], dict) and rows[0].get("type") == "Feature":
        return pd.DataFrame(flatten_features(rows))
    df = pd.DataFrame(rows)
    if {"t", "v"} <= set(df.columns):
        df["time"] = pd.to_datetime(df["t"], unit="ms", utc=True)
    return df


__all__ = [
    "BASE_URL",
    "GevError",
    "areas",
    "citations",
    "county_history",
    "flatten_features",
    "gauge_history",
    "get",
    "indicator_history",
    "indicators",
    "report",
    "screen",
    "sectors",
    "series",
    "series_list",
    "to_dataframe",
]
