#!/usr/bin/env python3
"""Build versioned energy data bundles for the gods-eye-view site.

Reads raw collector outputs (CSV/JSON from lib/energy/collectors/) and emits
compact, versioned JSON bundles under lib/energy/data/:

  ercot_prices.json        ERCOT real-time + day-ahead hub/zone prices, weather-zone load
  us_electricity_prices.json  EIA SEDS state annual retail prices by sector, 1970-2024
  global_generation.json   Ember yearly generation by fuel, top countries, latest year + yearly history
  datacenters.json         OSM operating + under-construction data centers

Every bundle carries meta: built timestamp, sources, retrieval dates,
provenance, and coverage caveats. Published values as the sources sent them;
nothing estimated here.

Usage: python3 build_bundles.py [--raw DIR] [--out DIR]
Defaults: raw from $ENERGY_RAW or ../energy-texas data fallback, out to data/.
"""
import csv
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "data")
# Fallback: the original collection workspace (first build only; refreshes
# re-run the collectors into --raw).
FALLBACK_RAW = os.path.expanduser("~/workspace/energy-texas/data")

NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# --- label points -----------------------------------------------------------
# Approximate label points for ERCOT hubs / load zones (staged-map values).
HUB_ZONE_COORDS = {
    "HB_HOUSTON": (29.76, -95.37, "Houston hub"),
    "HB_NORTH": (32.78, -96.80, "North hub"),
    "HB_PAN": (35.20, -101.83, "Panhandle hub"),
    "HB_SOUTH": (27.80, -97.40, "South hub"),
    "HB_WEST": (31.99, -102.08, "West hub"),
    "LZ_AEN": (30.27, -97.74, "Austin Energy zone"),
    "LZ_CPS": (29.42, -98.49, "CPS (San Antonio) zone"),
    "LZ_HOUSTON": (29.76, -95.37, "Houston zone"),
    "LZ_LCRA": (30.27, -97.74, "LCRA zone"),
    "LZ_NORTH": (32.78, -96.80, "North zone"),
    "LZ_RAYBN": (31.30, -94.70, "Rayburn zone"),
    "LZ_SOUTH": (27.80, -97.40, "South zone"),
    "LZ_WEST": (31.99, -102.08, "West zone"),
}
# ERCOT load file uses abbreviated zone names.
LOAD_ZONE_MAP = {
    "COAST": "COAST", "EAST": "EAST", "FAR_WEST": "FAR WEST",
    "NORTH": "NORTH", "NORTH_C": "NORTH CENTRAL", "SOUTH_C": "SOUTH CENTRAL",
    "SOUTHERN": "SOUTHERN", "WEST": "WEST",
}
# Approximate label points for ERCOT weather zones.
WEATHER_ZONE_COORDS = {
    "COAST": (29.50, -95.20),
    "EAST": (31.30, -94.60),
    "FAR WEST": (31.00, -104.50),
    "NORTH": (33.70, -98.30),
    "NORTH CENTRAL": (32.78, -96.80),
    "SOUTH CENTRAL": (30.10, -98.00),
    "SOUTHERN": (27.60, -98.60),
    "WEST": (32.20, -102.50),
}
STATE_CENTROIDS = {
    "AL": ("Alabama", 32.7, -86.9), "AK": ("Alaska", 61.4, -152.3),
    "AZ": ("Arizona", 33.7, -111.5), "AR": ("Arkansas", 34.9, -92.3),
    "CA": ("California", 36.1, -119.7), "CO": ("Colorado", 39.1, -105.5),
    "CT": ("Connecticut", 41.6, -72.7), "DC": ("Dist. of Columbia", 38.9, -77.0),
    "DE": ("Delaware", 39.3, -75.5), "FL": ("Florida", 27.9, -81.7),
    "GA": ("Georgia", 32.9, -83.1), "HI": ("Hawaii", 21.1, -157.5),
    "ID": ("Idaho", 44.2, -114.5), "IL": ("Illinois", 40.3, -89.2),
    "IN": ("Indiana", 39.8, -86.1), "IA": ("Iowa", 42.0, -93.5),
    "KS": ("Kansas", 38.5, -98.4), "KY": ("Kentucky", 37.8, -85.3),
    "LA": ("Louisiana", 31.0, -92.0), "ME": ("Maine", 45.3, -69.4),
    "MD": ("Maryland", 39.0, -76.6), "MA": ("Massachusetts", 42.2, -71.5),
    "MI": ("Michigan", 43.9, -84.9), "MN": ("Minnesota", 45.7, -93.9),
    "MS": ("Mississippi", 32.7, -89.6), "MO": ("Missouri", 38.4, -92.4),
    "MT": ("Montana", 46.9, -110.0), "NE": ("Nebraska", 41.1, -99.9),
    "NV": ("Nevada", 38.9, -117.1), "NH": ("New Hampshire", 43.4, -71.5),
    "NJ": ("New Jersey", 40.3, -74.5), "NM": ("New Mexico", 34.8, -106.2),
    "NY": ("New York", 42.1, -75.0), "NC": ("North Carolina", 35.6, -79.5),
    "ND": ("North Dakota", 47.4, -100.4), "OH": ("Ohio", 40.4, -82.9),
    "OK": ("Oklahoma", 35.6, -97.5), "OR": ("Oregon", 44.6, -120.5),
    "PA": ("Pennsylvania", 41.2, -77.2), "RI": ("Rhode Island", 41.6, -71.5),
    "SC": ("South Carolina", 33.8, -80.9), "SD": ("South Dakota", 44.2, -99.4),
    "TN": ("Tennessee", 35.7, -86.6), "TX": ("Texas", 31.5, -99.3),
    "UT": ("Utah", 39.5, -111.4), "VT": ("Vermont", 44.0, -72.7),
    "VA": ("Virginia", 37.9, -78.1), "WA": ("Washington", 47.3, -120.5),
    "WV": ("West Virginia", 38.6, -80.6), "WI": ("Wisconsin", 44.2, -89.5),
    "WY": ("Wyoming", 43.0, -107.5),
}
# Label points (lon, lat) for top generating countries.
COUNTRY_CENTROIDS = {
    "United States": (-98.5, 39.8), "China": (104.2, 35.9),
    "India": (78.9, 21.1), "Russia": (90.0, 61.0), "Japan": (138.3, 36.2),
    "Brazil": (-51.9, -14.2), "Canada": (-106.3, 56.1), "Germany": (10.5, 51.2),
    "France": (2.4, 46.2), "South Korea": (127.9, 36.4),
    "United Kingdom": (-3.4, 54.0), "Italy": (12.8, 42.8),
    "Spain": (-3.7, 40.3), "Australia": (134.0, -25.0),
    "Mexico": (-102.5, 23.6), "Saudi Arabia": (45.0, 24.0),
    "Indonesia": (113.9, -0.8), "Türkiye": (35.2, 39.0), "Iran": (53.7, 32.4),
    "Finland": (26.0, 64.0), "Austria": (14.1, 47.6), "Belgium": (4.6, 50.8),
    "Czechia": (15.5, 49.8), "Switzerland": (8.2, 46.8),
    "Portugal": (-8.0, 39.6), "Greece": (24.0, 38.0), "Romania": (25.0, 46.0),
    "Denmark": (10.0, 56.0), "Serbia": (20.8, 44.0), "Hungary": (19.4, 47.2),
    "Bulgaria": (25.5, 42.8), "Ireland": (-8.0, 53.3),
    "Slovakia": (19.7, 48.7), "Croatia": (16.4, 45.3),
    "Bosnia Herzegovina": (17.7, 44.2), "Slovenia": (15.0, 46.0),
    "Lithuania": (24.0, 55.3), "North Macedonia": (21.7, 41.6),
    "Estonia": (25.0, 58.7), "Latvia": (25.0, 57.0), "Kosovo": (21.0, 42.6),
    "Cyprus": (33.0, 35.0), "Luxembourg": (6.1, 49.8),
    "Montenegro": (19.3, 42.7), "Malta": (14.4, 35.9),
    "Viet Nam": (108.0, 14.0), "Taiwan (China)": (121.0, 23.7),
    "The Philippines": (122.0, 13.0), "Uzbekistan": (64.0, 41.3),
    "Kuwait": (47.5, 29.3), "Israel": (35.0, 31.0), "Peru": (-77.0, -9.2),
    "Singapore": (103.8, 1.35), "Qatar": (51.2, 25.3), "Oman": (58.0, 21.0),
    "Morocco": (-6.0, 32.0), "Belarus": (28.0, 53.5),
    "Paraguay": (-58.3, -23.3), "New Zealand": (172.0, -41.0),
    "Egypt": (30.8, 26.8), "South Africa": (22.9, -30.6),
    "Argentina": (-63.6, -38.4), "Thailand": (101.0, 15.9),
    "Vietnam": (108.0, 14.0), "Poland": (19.1, 51.9),
    "Netherlands": (5.3, 52.2), "Sweden": (18.6, 62.0), "Norway": (8.5, 64.5),
    "Ukraine": (32.0, 49.0), "Kazakhstan": (66.9, 48.0),
    "Malaysia": (101.9, 4.2), "Philippines": (122.0, 13.0),
    "Pakistan": (69.3, 30.4), "Bangladesh": (90.4, 23.7),
    "Nigeria": (8.7, 9.1), "Chile": (-70.7, -33.4), "Colombia": (-74.1, 4.6),
    "Taiwan": (121.0, 23.7), "Thailand ": (101.0, 15.9),
}


def meta(sources, caveats=None, freshness=""):
    m = {
        "built": NOW,
        "sources": sources,
        "provenance": "gods-eye-view lib/energy collectors (free public sources only)",
        "freshness": freshness,
    }
    if caveats:
        m["coverage_caveats"] = caveats
    return m


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def build_ercot(raw, out):
    rtm = read_csv(os.path.join(raw, "ercot_rtm_spp.csv"))
    dam = read_csv(os.path.join(raw, "ercot_dam_spp.csv"))
    load = read_csv(os.path.join(raw, "ercot_actual_load_weather_zone.csv"))

    def points(rows, price_key):
        pts = []
        for r in rows:
            sp = r["settlement_point"]
            if sp not in HUB_ZONE_COORDS:
                continue
            lat, lon, label = HUB_ZONE_COORDS[sp]
            try:
                price = float(r[price_key])
            except ValueError:
                continue
            pts.append({"id": sp, "label": label,
                        "kind": "hub" if sp.startswith("HB_") else "zone",
                        "lat": lat, "lon": lon, "price_usd_mwh": round(price, 2)})
        return pts

    rtm_pts = points(rtm, "price_usd_mwh")
    # DAM file carries a full 24h; keep only the latest delivery hour.
    latest_dam = max((r["delivery_date"], r["hour_ending"]) for r in dam) if dam else None
    dam_latest = [r for r in dam
                  if (r["delivery_date"], r["hour_ending"]) == latest_dam] if latest_dam else []
    dam_pts = points(dam_latest, "price_usd_mwh")
    rtm_asof = f"{rtm[0]['delivery_date']} hour {rtm[0]['delivery_hour']} interval {rtm[0]['delivery_interval']}" if rtm else None
    dam_asof = f"{dam[0]['delivery_date']} hour ending {dam[0]['hour_ending']}" if dam else None

    latest_load = max((r["oper_day"], r["hour_ending"]) for r in load) if load else None
    load_zones = []
    if latest_load:
        for r in load:
            if (r["oper_day"], r["hour_ending"]) != latest_load:
                continue
            zone = LOAD_ZONE_MAP.get(r["zone"])
            if zone and zone in WEATHER_ZONE_COORDS:
                lat, lon = WEATHER_ZONE_COORDS[zone]
                load_zones.append({"zone": zone, "lat": lat, "lon": lon,
                                   "load_mw": round(float(r["load_mw"]), 1)})

    bundle = {
        "meta": meta(
            {"ERCOT MIS public reports": "https://www.ercot.com/misapp/servlets/IceDocListJsonWS"},
            freshness="Real-time prices move every 15 minutes; this bundle is a snapshot. Refresh with `npm run data:energy`.",
        ),
        "rtm": {"asof": rtm_asof, "points": rtm_pts},
        "dam": {"asof": dam_asof, "points": dam_pts},
        "load": {"asof": f"{latest_load[0]} hour ending {latest_load[1]}" if latest_load else None,
                 "zones": load_zones,
                 "note": "Weather-zone label points are approximate."},
    }
    return bundle


def build_us_prices(raw, out):
    rows = read_csv(os.path.join(raw, "eia_seds_electricity_prices.csv"))
    by_state = {}
    for r in rows:
        st = r["state"]
        if st not in STATE_CENTROIDS:
            continue
        try:
            cents = float(r["price_cents_per_kwh"])
        except ValueError:
            continue
        s = by_state.setdefault(st, {})
        s.setdefault(r["sector"], {})[int(r["year"])] = round(cents, 2)
    latest_year = max(y for s in by_state.values() for y in s.get("residential", {}))
    states = {}
    for st, sectors in sorted(by_state.items()):
        name, lat, lon = STATE_CENTROIDS[st]
        res = sectors.get("residential", {})
        hist = [[y, res[y]] for y in sorted(res) if res[y] > 0]
        states[st] = {
            "name": name, "lat": lat, "lon": lon,
            "residential": res.get(latest_year),
            "commercial": sectors.get("commercial", {}).get(latest_year),
            "industrial": sectors.get("industrial", {}).get(latest_year),
            "transportation": sectors.get("transportation", {}).get(latest_year),
            "history_residential": hist,
        }
    res_vals = [s["residential"] for s in states.values() if s["residential"]]
    bundle = {
        "meta": meta(
            {"U.S. EIA State Energy Data System (SEDS)": "https://www.eia.gov/state/seds/"},
            freshness="Annual data; latest year in bundle is the most recent EIA release.",
        ),
        "asof_year": latest_year,
        "national_residential_avg": round(sum(res_vals) / len(res_vals), 2) if res_vals else None,
        "units": "cents per kWh",
        "states": states,
    }
    return bundle


def top_fuels(fuels):
    """Top 6 fuels by TWh, dropping <1% share slivers. Real values only."""
    ranked = sorted(fuels.items(), key=lambda kv: kv[1]["twh"], reverse=True)
    kept = [(k, v) for k, v in ranked if v["share_pct"] >= 1.0][:6]
    return [{"fuel": k, "twh": v["twh"], "share_pct": v["share_pct"]} for k, v in kept]


def build_global_generation(raw, out):
    path = os.path.join(raw, "ember_generation_yearly_global.csv")
    rows = read_csv(path)
    countries = [r for r in rows
                 if r.get("Area type") == "Country or economy"
                 and r.get("Is aggregated source") == "False"]
    latest_year = max(int(r["Year"]) for r in countries)
    # per country -> per year -> fuels. Published values as Ember sent them;
    # missing years stay missing (the site steps from the last known year).
    per_country = {}
    for r in countries:
        try:
            year = int(r["Year"])
            twh = float(r.get("Generation (TWh)") or 0)
            share = float(r.get("Share of generation (%)") or 0)
        except ValueError:
            continue
        if twh <= 0:
            continue
        c = per_country.setdefault(r["Area"], {})
        c.setdefault(year, {})[r["Electricity source"]] = {
            "twh": round(twh, 1), "share_pct": round(share, 1)}
    ranked = sorted(per_country.items(),
                    key=lambda kv: sum(f["twh"] for f in kv[1].get(latest_year, {}).values()),
                    reverse=True)
    out_countries = []
    skipped = []
    for name, by_year in ranked[:60]:
        if name not in COUNTRY_CENTROIDS:
            skipped.append(name)
            continue
        lon, lat = COUNTRY_CENTROIDS[name]
        history = []
        for year in sorted(by_year):
            fuels = top_fuels(by_year[year])
            history.append({
                "year": year,
                "total_twh": round(sum(f["twh"] for f in by_year[year].values()), 1),
                "fuels": fuels,
            })
        latest = history[-1]
        out_countries.append({
            "country": name, "lat": lat, "lon": lon,
            "year": latest_year, "total_twh": latest["total_twh"],
            "fuels": latest["fuels"],
            "history": history,
        })
    bundle = {
        "meta": meta(
            {"Ember Electricity Data Explorer": "https://ember-energy.org/data/electricity-data-explorer/"},
            caveats=[
                "Country label points are approximate; only countries with a label point are drawn.",
                "Yearly history 1985-latest; pre-2000 coverage is sparser and some countries "
                "enter the record late. Missing years stay missing: the time machine steps "
                "from the last known year, never interpolates.",
                "Top 60 countries by latest-year generation; per-year top 6 fuels, <1% share dropped.",
            ],
            freshness="Annual data; latest year in bundle is the most recent Ember release.",
        ),
        "asof_year": latest_year,
        "countries": out_countries,
        "skipped_no_label_point": skipped,
    }
    # year span actually present across countries (min/max of history starts)
    starts = [c["history"][0]["year"] for c in out_countries if c["history"]]
    ends = [c["history"][-1]["year"] for c in out_countries if c["history"]]
    bundle["history_years"] = [min(starts), max(ends)] if starts else [latest_year, latest_year]
    return bundle


def norm_point(name, operator, lat, lon, extra=None):
    p = {"name": name or "Unnamed data center",
         "operator": operator or None,
         "lat": round(float(lat), 5), "lon": round(float(lon), 5)}
    if extra:
        p.update(extra)
    return p


def build_datacenters(raw, out):
    def load_any(fname):
        with open(os.path.join(raw, fname)) as f:
            d = json.load(f)
        return d["elements"] if isinstance(d, dict) else d

    operating, seen = [], set()
    for fname in ("osm_datacenters_global.json", "osm_datacenters_texas.json"):
        for e in load_any(fname):
            tags = e.get("tags", {})
            name = e.get("name") or tags.get("name")
            operator = e.get("operator") or tags.get("operator")
            lat, lon = e.get("lat"), e.get("lon")
            if lat is None or lon is None:
                continue
            key = (round(float(lat), 3), round(float(lon), 3))
            if key in seen:
                continue
            seen.add(key)
            operating.append(norm_point(name, operator, lat, lon))

    construction = []
    for fname in ("osm_datacenters_us_construction.json", "osm_datacenters_texas_construction.json"):
        for e in load_any(fname):
            tags = e.get("tags", {})
            name = e.get("name") or tags.get("name")
            operator = e.get("operator") or tags.get("operator")
            lat, lon = e.get("lat"), e.get("lon")
            if lat is None or lon is None:
                c = e.get("center") or {}
                lat, lon = c.get("lat"), c.get("lon")
            if lat is None or lon is None:
                continue
            extra = {}
            for k in ("start_date", "opening_date"):
                v = e.get(k) or tags.get(k)
                if v:
                    extra[k] = v
            construction.append(norm_point(name, operator, lat, lon, extra or None))

    bundle = {
        "meta": meta(
            {"OpenStreetMap via Overpass API": "https://overpass-api.de/api/interpreter"},
            caveats=[
                "No complete data-center registry exists; this is the OpenStreetMap subset.",
                "OSM skews toward well-mapped regions and misses stealth/unlisted sites — treat counts as a floor.",
                "Under-construction projects come from OSM construction tags; permit portals were bot-walled.",
            ],
            freshness="Snapshot of OSM at build time. Refresh with `npm run data:energy`.",
        ),
        "operating": operating,
        "construction": construction,
    }
    return bundle


def main():
    raw = os.environ.get("ENERGY_RAW", FALLBACK_RAW)
    out = DEFAULT_OUT
    args = sys.argv[1:]
    if "--raw" in args:
        raw = args[args.index("--raw") + 1]
    if "--out" in args:
        out = args[args.index("--out") + 1]
    os.makedirs(out, exist_ok=True)

    bundles = {
        "ercot_prices.json": build_ercot(raw, out),
        "us_electricity_prices.json": build_us_prices(raw, out),
        "global_generation.json": build_global_generation(raw, out),
        "datacenters.json": build_datacenters(raw, out),
    }
    for name, bundle in bundles.items():
        path = os.path.join(out, name)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(bundle, f)
        os.replace(tmp, path)
        print(f"wrote {path}")
    print("energy bundles complete")


if __name__ == "__main__":
    main()
