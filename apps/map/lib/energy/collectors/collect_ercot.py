#!/usr/bin/env python3
"""Lane 1: ERCOT public market data collector (stdlib only).
Sources: ERCOT MIS public reports (no key required).
Saves: latest RTM + DAM settlement point prices, actual system load by weather zone,
       fuel mix (dashboard API if reachable).
"""
import csv, io, json, os, time, urllib.request, zipfile
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("ENERGY_RAW", os.path.join(BASE, "data"))
SRC = os.path.join(BASE, "sources")
UA = {"User-Agent": "Mozilla/5.0 (research; energy-texas data collection)"}

def get(url, timeout=60):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)

def doc_list(rid):
    url = f"https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId={rid}&_={int(time.time()*1000)}"
    d = json.loads(get(url).read().decode())
    return d.get("ListDocsByRptTypeRes", {}).get("DocumentList", [])

def download_doc(docid):
    url = f"https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={docid}"
    return get(url).read()

def latest(rid):
    docs = sorted(doc_list(rid), key=lambda d: d["Document"]["PublishDate"])
    return docs[-1]["Document"] if docs else None

def save_csv(rows, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerows(rows)

def extract_first_csv(zipbytes):
    z = zipfile.ZipFile(io.BytesIO(zipbytes))
    names = [n for n in z.namelist() if n.lower().endswith(".csv")]
    if not names:
        return None, None
    return names[0], z.read(names[0]).decode("utf-8", errors="replace")

NS = "http://www.ercot.com/schema/2009-01/nodal/cdr"

def parse_xml_records(zbytes, rec_tag, fields):
    import xml.etree.ElementTree as ET
    z = zipfile.ZipFile(io.BytesIO(zbytes))
    names = [n for n in z.namelist() if n.lower().endswith(".xml")]
    if not names:
        return None, []
    root = ET.fromstring(z.read(names[0]))
    rows = []
    for rec in root.findall(f"e:{rec_tag}", {"e": NS}):
        row = []
        for tag in fields:
            el = rec.find(f"e:{tag}", {"e": NS})
            row.append(el.text if el is not None else "")
        rows.append(row)
    return names[0], rows

def collect_spp(rid, label):
    doc = latest(rid)
    if not doc:
        return {"label": label, "status": "no_docs"}
    zbytes = download_doc(doc["DocID"])
    if label == "rtm_spp":
        name, rows = parse_xml_records(zbytes, "SPPatHubsLoadZone",
            ["DeliveryDate", "DeliveryHour", "DeliveryInterval",
             "SettlementPointName", "SettlementPointType", "SettlementPointPrice", "DSTFlag"])
        hdr = ["delivery_date", "delivery_hour", "delivery_interval",
               "settlement_point", "point_type", "price_usd_mwh", "dst_flag"]
        hz = [r for r in rows if r[4] in ("HU", "LZ")]
    else:
        name, rows = parse_xml_records(zbytes, "DAMSettlementPointPrice",
            ["DeliveryDate", "HourEnding", "SettlementPoint", "SettlementPointPrice", "DSTFlag"])
        hdr = ["delivery_date", "hour_ending", "settlement_point", "price_usd_mwh", "dst_flag"]
        hz = [r for r in rows if r[2].startswith(("HB_", "LZ_"))]
    if name is None:
        return {"label": label, "status": "no_xml_in_zip"}
    out_all = os.path.join(DATA, f"ercot_{label}_all.csv")
    out_hz = os.path.join(DATA, f"ercot_{label}.csv")
    save_csv([hdr] + rows, out_all)
    save_csv([hdr] + hz, out_hz)
    return {"label": label, "status": "ok", "publish_date": doc["PublishDate"],
            "constructed_name": doc["ConstructedName"], "doc_id": doc["DocID"],
            "rows_total": len(rows), "rows_hub_zone": len(hz),
            "file": out_hz, "file_all": out_all, "xml_name": name}

def collect_load():
    doc = latest(13101)
    if not doc:
        return {"label": "load", "status": "no_docs"}
    zbytes = download_doc(doc["DocID"])
    name, rows = parse_xml_records(zbytes, "ACTUALSYSLOADWZ",
        ["OperDay", "HourEnding", "COAST", "EAST", "FAR_WEST", "NORTH",
         "NORTH_C", "SOUTHERN", "SOUTH_C", "WEST", "TOTAL"])
    if name is None:
        return {"label": "load", "status": "no_xml_in_zip"}
    zones = ["COAST", "EAST", "FAR_WEST", "NORTH", "NORTH_C", "SOUTHERN", "SOUTH_C", "WEST"]
    flat = []
    for r in rows:
        for i, z_ in enumerate(zones):
            flat.append([r[0], r[1], z_, r[2 + i]])
        flat.append([r[0], r[1], "ERCOT_TOTAL", r[10]])
    out = os.path.join(DATA, "ercot_actual_load_weather_zone.csv")
    save_csv([["oper_day", "hour_ending", "zone", "load_mw"]] + flat, out)
    return {"label": "load", "status": "ok", "publish_date": doc["PublishDate"],
            "constructed_name": doc["ConstructedName"], "rows": len(flat),
            "file": out, "xml_name": name}

def collect_fuel_mix():
    # ERCOT public dashboard fuel-mix JSON
    for url in [
        "https://www.ercot.com/api/1/services/read/dashboards/fuelMix",
        "https://www.ercot.com/api/1/services/read/dashboards/combCurrentDay",
    ]:
        try:
            d = json.loads(get(url, timeout=30).read().decode())
            out = os.path.join(DATA, "ercot_fuel_mix.json")
            with open(out, "w") as f:
                json.dump({"retrieved_utc": datetime.now(timezone.utc).isoformat(),
                           "source_url": url, "data": d}, f, indent=1)
            return {"label": "fuel_mix", "status": "ok", "url": url, "file": out}
        except Exception as e:
            last = str(e)
    return {"label": "fuel_mix", "status": "unreachable", "error": last}

def main():
    results = []
    results.append(collect_spp(12301, "rtm_spp"))
    results.append(collect_spp(12331, "dam_spp"))
    results.append(collect_load())
    results.append(collect_fuel_mix())
    meta = {"collected_utc": datetime.now(timezone.utc).isoformat(), "results": results}
    with open(os.path.join(SRC, "ercot_collection.json"), "w") as f:
        json.dump(meta, f, indent=1)
    for r in results:
        print(json.dumps(r))

if __name__ == "__main__":
    main()
