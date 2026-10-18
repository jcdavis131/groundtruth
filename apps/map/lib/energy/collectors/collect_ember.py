#!/usr/bin/env python3
"""Global electricity lane: Ember open electricity datasets (stdlib only, no key).
https://ember-energy.org/data/yearly-electricity-data/ -> files.ember-energy.org
Also logs ENTSO-E as registration-blocked (401 without token; no signup per policy).
"""
import csv, json, os, urllib.request
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("ENERGY_RAW", os.path.join(BASE, "data"))
UA = {"User-Agent": "Mozilla/5.0 (research; energy-texas data collection)"}

FILES = {
    "ember_generation_yearly_global.csv":
        "https://files.ember-energy.org/public-downloads/generation/outputs/release_generation_yearly_global.csv",
    "ember_generation_yearly_lower.csv":
        "https://files.ember-energy.org/public-downloads/generation/outputs/release_generation_yearly_lower.csv",
}

def main():
    results = []
    for name, url in FILES.items():
        raw = urllib.request.urlopen(
            urllib.request.Request(url, headers=UA), timeout=180).read()
        path = os.path.join(DATA, name)
        open(path, "wb").write(raw)
        rows = list(csv.reader(__import__("io").StringIO(raw.decode("utf-8", errors="replace"))))
        h = rows[0]
        ai, yi = h.index("Area"), h.index("Year")
        areas = set(r[ai] for r in rows[1:])
        yrs = sorted(set(r[yi] for r in rows[1:]))
        results.append({"label": name, "status": "ok", "rows": len(rows) - 1,
                        "areas": len(areas), "year_range": f"{yrs[0]}-{yrs[-1]}",
                        "file": path, "url": url})
    results.append({"label": "entsoe_transparency", "status": "blocked",
                    "note": "API returns 401 without security token; registration required. "
                            "No signup per policy. Ember covers Europe annually instead."})
    meta = {"collected_utc": datetime.now(timezone.utc).isoformat(), "results": results}
    with open(os.path.join(BASE, "sources", "ember_collection.json"), "w") as f:
        json.dump(meta, f, indent=1)
    for r in results:
        print({k: v for k, v in r.items() if k != "url"})

if __name__ == "__main__":
    main()
