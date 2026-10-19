"""ERCOT puller: DAM settlement-point prices + actual load by weather zone.

Endpoints (proven 2026-10-06, energy-texas collector):
  doc list: https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=<rid>
  download: https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId=<id>
  reportTypeId 12331 -> DAMSPNP XML (hourly DAM prices)
  reportTypeId 13101 -> ACTUALSYSLOADWZ XML (hourly load by weather zone)

pull():      latest doc only (the daily-collector rhythm).
backfill():  walks every doc the MIS list exposes with PublishDate >= since,
             downloading each (polite pacing). The WS list covers recent
             history only — the manifest records exactly how far back the
             server let us reach. No silent gaps: coverage is reported.
"""
import io
import os
import time
import xml.etree.ElementTree as ET
import zipfile

from .. import common as C

REPORTS = {
    "ercot_dam_spp": {"rid": 12331, "rec": "DAMSettlementPointPrice",
                      "fields": ["DeliveryDate", "HourEnding", "SettlementPoint",
                                 "SettlementPointPrice", "DSTFlag"],
                      "cols": ["delivery_date", "hour_ending", "settlement_point",
                               "price_usd_mwh", "dst_flag"],
                      "key": ["delivery_date", "hour_ending", "settlement_point"],
                      "hub_zone_only": True},
    "ercot_load_wz": {"rid": 13101, "rec": "ACTUALSYSLOADWZ",
                      "fields": ["OperDay", "HourEnding", "COAST", "EAST",
                                 "FAR_WEST", "NORTH", "NORTH_C", "SOUTHERN",
                                 "SOUTH_C", "WEST", "TOTAL"],
                      "cols": ["oper_day", "hour_ending", "zone", "load_mw"],
                      "key": ["oper_day", "hour_ending", "zone"],
                      "hub_zone_only": False},
}
ZONES = ["COAST", "EAST", "FAR_WEST", "NORTH", "NORTH_C", "SOUTHERN",
         "SOUTH_C", "WEST"]
NS = "http://www.ercot.com/schema/2009-01/nodal/cdr"


def _doc_list(rid: int) -> list[dict]:
    url = (f"https://www.ercot.com/misapp/servlets/IceDocListJsonWS"
           f"?reportTypeId={rid}&_={int(time.time() * 1000)}")
    d = C.http_json(url)
    docs = d.get("ListDocsByRptTypeRes", {}).get("DocumentList", [])
    return [x["Document"] for x in docs if "Document" in x]


def _download(docid: str) -> bytes:
    return C.http_get("https://www.ercot.com/misdownload/servlets/mirDownload",
                      params={"doclookupId": docid}, timeout=120)


def _parse(zbytes: bytes, spec: dict) -> list[dict]:
    z = zipfile.ZipFile(io.BytesIO(zbytes))
    names = [n for n in z.namelist() if n.lower().endswith(".xml")]
    if not names:
        return []
    root = ET.fromstring(z.read(names[0]))
    out = []
    for rec in root.findall(f"e:{spec['rec']}", {"e": NS}):
        vals = []
        for tag in spec["fields"]:
            el = rec.find(f"e:{tag}", {"e": NS})
            vals.append(el.text if el is not None else "")
        if spec["hub_zone_only"]:
            sp = vals[2]
            if not sp.startswith(("HB_", "LZ_")):
                continue
            out.append(dict(zip(spec["cols"], vals)))
        else:
            oper_day, hour = vals[0], vals[1]
            for i, z_ in enumerate(ZONES):
                out.append({"oper_day": oper_day, "hour_ending": hour,
                            "zone": z_, "load_mw": vals[2 + i]})
            out.append({"oper_day": oper_day, "hour_ending": hour,
                        "zone": "ERCOT_TOTAL", "load_mw": vals[10]})
    return out


def _merge_staged(dataset: str, rows: list[dict], spec: dict) -> int:
    path = C.stage_path(dataset)
    have: dict[tuple, dict] = {}
    if os.path.exists(path):
        for r in C.read_csv_rows(path):
            have[tuple(r[k] for k in spec["key"])] = r
    for r in rows:
        have[tuple(r[k] for k in spec["key"])] = {c: r[c] for c in spec["cols"]}
    merged = [have[k] for k in sorted(have)]
    C.write_csv_rows(path, merged, spec["cols"])
    return len(merged)


def _ingest_doc(dataset: str, spec: dict, doc: dict) -> int:
    zbytes = _download(doc["DocID"])
    pdir = C.write_raw(dataset, zbytes,
                       filename=doc.get("ConstructedName", "payload.zip"),
                       extra_meta={"doc_id": doc["DocID"],
                                   "publish_date": doc.get("PublishDate"),
                                   "constructed_name": doc.get("ConstructedName")})
    rows = _parse(zbytes, spec)
    staged_rows = _merge_staged(dataset, rows, spec)
    return staged_rows, pdir, len(rows)


def pull(dataset: str) -> dict:
    spec = REPORTS[dataset]
    docs = sorted(_doc_list(spec["rid"]),
                  key=lambda d: d.get("PublishDate", ""))
    if not docs:
        pull = {"pulled_at": C.utcnow(), "status": "no_docs", "rows": 0}
        C.record_manifest(dataset, pull)
        return pull
    doc = docs[-1]
    staged_rows, pdir, n = _ingest_doc(dataset, spec, doc)
    pull = {"pulled_at": C.utcnow(), "status": "ok", "rows": n,
            "staged_rows": staged_rows, "pull_dir": pdir,
            "doc_id": doc["DocID"], "publish_date": doc.get("PublishDate")}
    C.record_manifest(dataset, pull)
    return pull


def backfill(dataset: str, since: str) -> dict:
    """Download every MIS-listed doc with PublishDate >= since."""
    spec = REPORTS[dataset]
    docs = sorted((d for d in _doc_list(spec["rid"])
                   if d.get("PublishDate", "")[:10] >= since),
                  key=lambda d: d.get("PublishDate", ""))
    manifest = C.load_manifest(dataset)
    seen = {p.get("doc_id") for p in manifest.get("pulls", []) if p.get("doc_id")}
    n_rows, n_new, staged_rows, first_date = 0, 0, 0, None
    for doc in docs:
        if doc["DocID"] in seen:
            continue
        staged_rows, _, n = _ingest_doc(dataset, spec, doc)
        n_rows += n
        n_new += 1
        first_date = first_date or doc.get("PublishDate", "")[:10]
        time.sleep(2)  # polite pacing on the MIS server
    pull = {"pulled_at": C.utcnow(), "status": "ok",
            "docs_exposed_by_server": len(docs), "docs_downloaded": n_new,
            "rows": n_rows, "staged_rows": staged_rows,
            "server_coverage_from": first_date,
            "coverage_note": ("MIS doc list is recent-history only; "
                              "deep history accumulates via daily pulls.")}
    C.record_manifest(dataset, pull)
    return pull
