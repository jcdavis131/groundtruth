#!/usr/bin/env python3
"""Lane 3: data center locations from OpenStreetMap via Overpass (stdlib only, no key).
Blocked sources (logged, not retried): DataCenterMap (429), Baxtel (login),
datacenters.com (429), Austin ABC permits (Incapsula).
"""
import json, os, urllib.parse, urllib.request
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("ENERGY_RAW", os.path.join(BASE, "data"))

def overpass(query, timeout=220):
    url = "https://overpass-api.de/api/interpreter?" + urllib.parse.urlencode({"data": query})
    req = urllib.request.Request(url, headers={"User-Agent": "energy-texas/1.0"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())

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

def run(label, query, path):
    d = overpass(query)
    els = d.get("elements", [])
    s = slim(els)
    full = os.path.join(DATA, path)
    with open(full, "w") as f:
        json.dump(s, f)
    named = sum(1 for x in s if x["name"])
    return {"label": label, "status": "ok", "elements": len(els),
            "with_coords": len(s), "named": named, "file": full}

Q_DC = '(node["telecom"="data_center"]{b};way["telecom"="data_center"]{b};node["building"="data_center"]{b};way["building"="data_center"]{b};)'
Q_UC = '(node["construction"="data_center"]{b};way["construction"="data_center"]{b};)'

def main():
    results = []
    results.append(run("global", f"[out:json][timeout:180];{Q_DC.format(b='')};out center tags;",
                       "osm_datacenters_global.json"))
    results.append(run("us", f"[out:json][timeout:180];{Q_DC.format(b='(24.5,-125.0,49.4,-66.9)')};out center tags;",
                       "osm_datacenters_us.json"))
    results.append(run("texas", f"[out:json][timeout:180];{Q_DC.format(b='(25.8,-106.5,36.5,-93.5)')};out center tags;",
                       "osm_datacenters_texas.json"))
    results.append(run("us_construction", f"[out:json][timeout:180];{Q_UC.format(b='(24.5,-125.0,49.4,-66.9)')};out center tags;",
                       "osm_datacenters_us_construction.json"))
    meta = {"collected_utc": datetime.now(timezone.utc).isoformat(),
            "source": "OpenStreetMap via Overpass API (ODbL); community-mapped, no single complete registry exists",
            "results": results}
    with open(os.path.join(BASE, "sources", "osm_collection.json"), "w") as f:
        json.dump(meta, f, indent=1)
    for r in results:
        print(r)

if __name__ == "__main__":
    main()
