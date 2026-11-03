#!/usr/bin/env python3
"""Lane 3: data center locations from OpenStreetMap via Overpass (stdlib only, no key).
Blocked sources (logged, not retried): DataCenterMap (429), Baxtel (login),
datacenters.com (429), Austin ABC permits (Incapsula).

Requests: two Overpass requests per run. Request 1 gets the global operating
data centers. Request 2 gets the US under-construction projects. The US and
Texas operating files are cut from the global result on this machine, so they
cost no request. (build_bundles.py reads the global, Texas and
US-construction files; every Texas element is also in the global result.)

Retry policy: an HTTP 502, 503 or 504, a network error, a body that is not
a complete JSON object, or a 200 response with an Overpass runtime-error
remark gets up to two more attempts. The wait is 60 s before attempt 2 and
120 s before attempt 3. A numeric Retry-After header (0 to 300 s) replaces
the wait. Any other HTTP error, 429 (rate limit) included, stops the run at
once, and so does a malformed OVERPASS_URL (a setup error, not a server
error).

Time budget: 20 minutes per run, because a long process on the refresh
machine loses outbound connections after about 30 minutes. No attempt, the
first one included, starts unless its 220 s timeout fits in what is left.
The timeout limits each wait for data, not a whole reply, so a reply that
arrives slowly can run a little past the budget: 20 minutes is the plan, not
a hard cap.

Rate limits: an HTTP 429 or 403 writes overpass_paused.json in the raw
folder. While that file exists, the collector sends no request and exits
non-zero. Only the owner resumes it: delete the file.

Writes: the collector writes nothing until both requests succeed, so a
failed request leaves every previous file as it was. Then it replaces the
four files one after another, each in one step (a temp file, then a rename).
The four renames are not one step together.

Folder: ENERGY_RAW, which scripts/energy-data.mjs always sets to
lib/energy/data/raw/ (gitignored). A direct run without it uses that same
folder, so raw files and the pause file never land among the committed
bundles.
"""
import http.client
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("ENERGY_RAW", os.path.join(BASE, "data", "raw"))
DEFAULT_OVERPASS = "https://overpass-api.de/api/interpreter"

RETRY_CODES = {502, 503, 504}
PAUSE_CODES = {403, 429}
PAUSE_FILE = "overpass_paused.json"
WAITS = (60, 120)  # seconds before attempt 2 and attempt 3
MAX_RETRY_AFTER = 300
BUDGET_S = 20 * 60
QUERY_TIMEOUT = 220

US_BOX = (24.5, -125.0, 49.4, -66.9)  # (south, west, north, east)
TEXAS_BOX = (25.8, -106.5, 36.5, -93.5)


class OverpassError(RuntimeError):
    pass


def _retry_after(err):
    value = err.headers.get("Retry-After") if err.headers else None
    try:
        return max(0, min(int(value), MAX_RETRY_AFTER)) if value is not None else None
    except ValueError:
        return None


def overpass(query, deadline, url=None, waits=WAITS, timeout=QUERY_TIMEOUT,
             sleep=time.sleep, clock=time.monotonic):
    base = url or os.environ.get("OVERPASS_URL") or DEFAULT_OVERPASS
    full = base + "?" + urllib.parse.urlencode({"data": query})
    # Built once, before any attempt: a malformed URL raises ValueError here,
    # outside the retry loop, so it stops the run at once.
    req = urllib.request.Request(full, headers={"User-Agent": "energy-texas/1.0"})
    attempts = len(waits) + 1
    reason = None
    for attempt in range(1, attempts + 1):
        # Every attempt, the first one included, must fit in the budget.
        if clock() + timeout > deadline:
            last = f"; last: {reason}" if reason else ""
            raise OverpassError(f"time budget too small for attempt {attempt} of {attempts}{last}")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
            if not isinstance(data, dict):
                raise OverpassError("reply is not a JSON object")
            remark = data.get("remark") or ""
            if "error" in remark.lower():
                raise OverpassError("remark: " + remark[:200])
            return data
        except urllib.error.HTTPError as err:
            if err.code not in RETRY_CODES:
                raise  # 429, 403 and every other HTTP error: stop now, no retry
            reason, wait = f"HTTP {err.code}", _retry_after(err)
        # HTTPError is caught above. OSError covers the other network errors:
        # URLError, timeouts, connection resets and TLS errors.
        except (OverpassError, OSError, http.client.HTTPException,
                json.JSONDecodeError, UnicodeDecodeError) as err:
            reason, wait = f"{type(err).__name__}: {str(err)[:160]}", None
        if attempt == attempts:
            raise OverpassError(f"gave up after {attempts} attempts; last: {reason}")
        wait = waits[attempt - 1] if wait is None else wait
        if clock() + wait + timeout > deadline:
            raise OverpassError(f"time budget too small for another attempt; last: {reason}")
        print(f"overpass: attempt {attempt} failed ({reason}); next attempt in {wait} s",
              file=sys.stderr, flush=True)
        sleep(wait)


def slim(elements):
    out = []
    for e in elements:
        t = e.get("tags", {})
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat and lon:
            out.append({"name": t.get("name"), "operator": t.get("operator"),
                        "lat": round(lat, 5), "lon": round(lon, 5)})
    return out


def in_box(point, box):
    south, west, north, east = box
    return south <= point["lat"] <= north and west <= point["lon"] <= east


def write_json(path, obj, **kw):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, **kw)
    os.replace(tmp, path)


Q_DC = '(node["telecom"="data_center"]{b};way["telecom"="data_center"]{b};node["building"="data_center"]{b};way["building"="data_center"]{b};)'
Q_UC = '(node["construction"="data_center"]{b};way["construction"="data_center"]{b};)'


def main(sleep=time.sleep):
    pause = os.path.join(DATA, PAUSE_FILE)
    if os.path.exists(pause):
        sys.exit(f"overpass: paused after an earlier HTTP 429/403 ({pause}); "
                 "no request sent; delete that file to resume")
    deadline = time.monotonic() + BUDGET_S
    # Both requests first; no file is written until both succeed.
    try:
        glob = overpass(f"[out:json][timeout:180];{Q_DC.format(b='')};out center tags;",
                        deadline, sleep=sleep)
        cons = overpass(f"[out:json][timeout:180];{Q_UC.format(b='(24.5,-125.0,49.4,-66.9)')};out center tags;",
                        deadline, sleep=sleep)
    except urllib.error.HTTPError as err:
        if err.code in PAUSE_CODES:
            write_json(pause, {"paused_utc": datetime.now(timezone.utc).isoformat(),
                               "http_status": err.code,
                               "resume": "owner's call: delete this file"}, indent=1)
            print(f"overpass: HTTP {err.code}; requests paused until {pause} is deleted",
                  file=sys.stderr, flush=True)
        raise
    g_els, c_els = glob.get("elements", []), cons.get("elements", [])
    g, c = slim(g_els), slim(c_els)
    outputs = [
        ("global", "osm_datacenters_global.json", g, {"elements": len(g_els)}),
        ("us", "osm_datacenters_us.json", [p for p in g if in_box(p, US_BOX)],
         {"derived_from": "global"}),
        ("texas", "osm_datacenters_texas.json", [p for p in g if in_box(p, TEXAS_BOX)],
         {"derived_from": "global"}),
        ("us_construction", "osm_datacenters_us_construction.json", c,
         {"elements": len(c_els)}),
    ]
    results = []
    for label, fname, rows, extra in outputs:
        full = os.path.join(DATA, fname)
        write_json(full, rows)
        results.append({"label": label, "status": "ok", **extra, "with_coords": len(rows),
                        "named": sum(1 for x in rows if x["name"]), "file": full})
    meta = {"collected_utc": datetime.now(timezone.utc).isoformat(),
            "source": "OpenStreetMap via Overpass API (ODbL); community-mapped, no single complete registry exists",
            "requests": 2,
            "results": results}
    write_json(os.path.join(BASE, "sources", "osm_collection.json"), meta, indent=1)
    for r in results:
        print(r)


if __name__ == "__main__":
    main()
