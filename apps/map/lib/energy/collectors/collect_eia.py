#!/usr/bin/env python3
"""Lane 2: EIA US electricity data (stdlib only, no key).
- SEDS complete file -> state annual retail electricity prices by sector (1960-2024)
- MER Table 7.2B -> US monthly net generation by fuel type (fuel mix proxy)
EIA API (needs key) NOT used; bulk downloads only.
"""
import csv, io, os, urllib.request, zipfile
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("ENERGY_RAW", os.path.join(BASE, "data"))
UA = {"User-Agent": "Mozilla/5.0 (research; energy-texas data collection)"}

def get(url, timeout=300):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()

def collect_seds():
    raw = get("https://www.eia.gov/state/seds/CDF/Complete_SEDS.zip")
    open(os.path.join(DATA, "Complete_SEDS.zip"), "wb").write(raw)
    z = zipfile.ZipFile(io.BytesIO(raw))
    rows = list(csv.reader(io.StringIO(z.read("complete_seds.csv").decode("utf-8", errors="replace"))))
    hdr = rows[0]
    mi, si, yi, di, ds = (hdr.index(c) for c in ("MSN", "StateCode", "Year", "Data", "Data_Status"))
    # SEDS complete-file convention: 5th char D = price in $/MMBtu.
    # Sectors: AC=transportation, CC=commercial, IC=industrial, RC=residential
    # (P = physical units, B = billion Btu, V = expenditures — NOT prices.)
    keep = {"ESACD": "transportation", "ESCCD": "commercial",
            "ESICD": "industrial", "ESRCD": "residential"}
    out = [["state", "year", "sector", "price_usd_per_mmbtu", "price_cents_per_kwh", "data_status"]]
    for r in rows[1:]:
        if r[mi] in keep:
            try:
                v = float(r[di])
            except ValueError:
                continue
            out.append([r[si], r[yi], keep[r[mi]], f"{v:.4f}", f"{v * 0.3412:.3f}", r[ds]])
    path = os.path.join(DATA, "eia_seds_electricity_prices.csv")
    with open(path, "w", newline="") as f:
        csv.writer(f).writerows(out)
    yrs = sorted(set(r[1] for r in out[1:]))
    return {"label": "seds_prices", "status": "ok", "rows": len(out) - 1,
            "year_range": f"{yrs[0]}-{yrs[-1]}", "states": len(set(r[0] for r in out[1:])),
            "file": path, "note": "annual; cents/kWh = $/MMBtu x 0.3412"}

def collect_mer_fuel():
    raw = get("https://www.eia.gov/totalenergy/data/browser/csv.php?tbl=T07.02B")
    path = os.path.join(DATA, "eia_mer_gen_by_fuel_monthly.csv")
    open(path, "wb").write(raw)
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8", errors="replace"))))
    fuels = sorted(set(r[4] for r in rows[1:]))
    yms = sorted(set(r[1] for r in rows[1:]))
    return {"label": "mer_gen_fuel", "status": "ok", "rows": len(rows) - 1,
            "month_range": f"{yms[0]}-{yms[-1]}", "fuels": fuels, "file": path,
            "note": "US monthly net generation by fuel, electric power sector"}

def main():
    import json
    results = [collect_seds(), collect_mer_fuel()]
    meta = {"collected_utc": datetime.now(timezone.utc).isoformat(), "results": results}
    with open(os.path.join(BASE, "sources", "eia_collection.json"), "w") as f:
        json.dump(meta, f, indent=1)
    for r in results:
        print({k: v for k, v in r.items() if k != "fuels"})
        if "fuels" in r:
            print("  fuels:", len(r["fuels"]))

if __name__ == "__main__":
    main()
