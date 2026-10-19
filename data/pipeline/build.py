"""Build region snapshots of eye's collections from eye's public API.

    python data/pipeline/build.py <collection> [<collection> ...] [--region texas] [--data-root DIR]
                                  [--manifests DIR] [--bbox w,s,e,n --allow-dirty]

For each collection:
  1. Read the region's outline from eye (/api/economy?op=areas&level=state, Census TIGERweb 1:20M).
  2. Tile the outline's extent with boxes of the route's own maximum size on eye's own grid, keep the tiles
     that touch the outline (widened by cards.BOUNDARY_TOLERANCE_DEG), and ask eye for each, one request a
     second. A tile eye answers as truncated is split in four, down to one grid cell; a cell still truncated
     stops the build. eye's echoed bbox must equal the tile asked, or the build stops.
  3. Dedupe by id (the first tile wins), keep a feature when its source's own state field names the region
     and its point lies inside or within the tolerance of the outline, and map it to record/1
     (data/SCHEMA.md, "From eye's LayerFeature").
  4. Validate every record with data/schema/validate.mjs. Any failure stops the build.
  5. Write <data-root>/snapshots/<snapshot-id>/records.parquet (GeoParquet) and manifest.json, ask the
     publisher's own layer for its count in the region (ArcGIS returnCountOnly, keyless) and for its ids
     (to name the gap), validate the manifest, copy it to data/manifests/<collection>/<snapshot-id>.json and
     read it back through read.py.

eye is the only source of records. The builder's own upstream calls are the publisher count and id queries.
Raw responses are cached in <data-root>/raw/ (net.py), so a rerun after a failure doesn't ask again.

--bbox limits the tiles to a smaller box for a smoke test. It names the region <region>-smoke, needs a
--manifests directory outside the repo, and is the only mode --allow-dirty is accepted in.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import cards
import geo
import read
from net import Fetcher, sha256, utc_now

VERSION = "0.1.0"
REPO = Path(__file__).resolve().parents[2]
VALIDATE = REPO / "data" / "schema" / "validate.mjs"
PINNED = ["data/pipeline", "data/schema", "data/pyproject.toml"]


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), *args], check=True, capture_output=True, text=True).stdout.strip()


def node(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(VALIDATE), *args], capture_output=True, text=True, encoding="utf8")


# ---------------------------------------------------------------- fetch

def region_outline(fx: Fetcher, region: dict) -> tuple[dict, dict]:
    env = fx.get_json(region["boundaryUrl"], "region")
    entry = fx.log[-1]
    feats = [f for f in env["data"]["features"] if f["properties"].get("id") == region["boundaryId"]]
    if len(feats) != 1:
        raise SystemExit(f"eye's outlines hold {len(feats)} features with id {region['boundaryId']}")
    return feats[0]["geometry"], entry


def tile_url(cfg: dict, box) -> str:
    return f"{cards.EYE}/api/{cfg['route']}?op={cfg['op']}&bbox={','.join(fmt(v) for v in box)}"


def fmt(v: float) -> str:
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def fetch_tiles(fx: Fetcher, cfg: dict, cells: list[tuple[int, int, int, int]]):
    """Features in tile order, after splitting truncated tiles. Returns (features with their envelope, stats)."""
    grid = cfg["grid"]
    queue = list(cells)
    out = []
    asked = splits = 0
    t0 = time.monotonic()
    total = len(cells)
    while queue:
        c = queue.pop(0)
        box = geo.cell_box(c, grid)
        env = fx.get_json(tile_url(cfg, box), "records")
        asked += 1
        echoed = env.get("bbox")
        if not (isinstance(echoed, list) and len(echoed) == 4 and all(abs(a - b) < 1e-9 for a, b in zip(echoed, box))):
            raise SystemExit(f"eye answered bbox {echoed} for the tile {list(box)}: the tile grid is off")
        if env.get("truncated") is True:
            gx0, gy0, gx1, gy1 = c
            if gx1 - gx0 <= 1 and gy1 - gy0 <= 1:
                raise SystemExit(f"tile {list(box)} is one grid cell and still truncated")
            mx = gx0 + max(1, (gx1 - gx0) // 2) if gx1 - gx0 > 1 else gx1
            my = gy0 + max(1, (gy1 - gy0) // 2) if gy1 - gy0 > 1 else gy1
            kids = [k for k in [(gx0, gy0, mx, my), (mx, gy0, gx1, my), (gx0, my, mx, gy1), (mx, my, gx1, gy1)] if k[0] < k[2] and k[1] < k[3]]
            queue[0:0] = kids
            splits += 1
            total += len(kids)
            log(f"  split truncated tile {list(box)} into {len(kids)}")
            continue
        # Keep only what a record needs from the envelope: holding every parsed tile answer ran the box out of RAM.
        slim = {"provenance": [env["provenance"][0]]}
        for f in env["data"]["features"]:
            out.append((f, slim))
        del env
        if asked % 50 == 0:
            rate = (time.monotonic() - t0) / asked
            log(f"  {asked}/{total} tiles, {len(out)} features so far, {fx.network} from the network, ~{(total - asked) * rate / 60:.0f} min left")
    return out, {"tilesAsked": asked, "tilesSplit": splits}


# ---------------------------------------------------------------- records

def to_record(f: dict, env: dict, cfg: dict, collection: str, place: dict, snapshot_id: str) -> dict:
    """eye's LayerFeature plus its envelope's provenance, as record/1 (same mapping as build-fixtures.mjs)."""
    p = f["properties"]
    prov = env["provenance"][0]
    withheld = {w["field"] for w in cfg["withheld"]}
    details = {k: v for k, v in (p.get("details") or {}).items() if v is not None and k not in withheld}
    g = f["geometry"]
    if g["type"] == "Point" and len(g["coordinates"]) == 3 and g["coordinates"][2] == 0:
        g = {"type": "Point", "coordinates": g["coordinates"][:2]}
    src = prov["source"]
    provenance = {
        "sourceId": src["id"],
        "sourceName": src["name"],
        "publisher": src["publisher"],
        "licence": src["license"],
        **({"seriesId": prov["seriesId"]} if prov.get("seriesId") else {}),
        "upstreamUrl": prov["upstreamUrl"],
        **({"period": prov["period"]} if prov.get("period") else {}),
        **({"releasedAt": prov["releasedAt"]} if prov.get("releasedAt") else {}),
        "retrievedAt": prov["retrievedAt"],
        "kind": prov["kind"],
        **({"method": prov["method"]} if prov.get("method") else {}),
        **({"revision": prov["revision"]} if prov.get("revision") else {}),
        **({"notes": prov["notes"]} if prov.get("notes") else {}),
    }
    text = (p.get("extra") or {}).get("embedText")
    # The name rule is per record (a dam's owner type decides it), read from the source's fields before any is withheld.
    src_details = p.get("details") or {}
    name_rule = cfg["nameRule"](src_details)
    name = p["name"]
    label = cfg["label"](src_details) if cfg.get("label") else None
    # A record eye already labels by id (no published name, or eye's own rule) is never public-name.
    if label is not None and name == label:
        name_rule = "label-by-id"
    if name_rule == "label-by-id" and label is not None and name != label:
        # eye named a record this builder labels by id (eye's dam rule before 2026-10-19 named Not Listed dams):
        # the record takes the label, and eye's name leaves the record text's name segment too.
        if isinstance(text, str):
            text = "; ".join(s for s in text.split("; ") if s != f"name: {name}")
        to_record.relabelled += 1
        name = label
    if name_rule == "label-by-id" and label is not None and isinstance(text, str) and any(s.startswith("name: ") for s in text.split("; ")):
        raise SystemExit(f"{p['id']}: labelled by id, but its record text still has a name segment")
    return {
        "schemaVersion": "record/1",
        "id": p["id"],
        "collection": collection,
        "layer": p["layer"],
        "name": name,
        "nameRule": name_rule,
        **({"kind": p["kind"]} if p.get("kind") else {}),
        "geometry": g,
        "place": place,
        "details": details,
        **({"text": text} if isinstance(text, str) and text.strip() else {}),
        "provenance": provenance,
        "snapshotId": snapshot_id,
    }


to_record.relabelled = 0  # records eye named that this builder labelled by id, per build


def select(features, cfg: dict, region: dict, outline: geo.Region):
    """(kept [(feature, env, place)], dropped {id: why}, neighbours): dedupe by id, then the region rule."""
    first = {}
    select.same_tile_repeats = 0
    for f, env in features:
        prev = first.get(f.get("properties", {}).get("id"))
        if prev is not None and prev[1] is env:
            select.same_tile_repeats += 1  # the publisher has two rows under one id (NID does), not a tile overlap
        if f.get("properties", {}).get("nameNotSearchable"):
            raise SystemExit(f"{f['properties'].get('id')}: nameNotSearchable is set, and record/1 has no rule for it yet")
        g = f.get("geometry") or {}
        if g.get("type") != "Point":
            raise SystemExit(f"{f['properties'].get('id')}: geometry {g.get('type')}, this builder handles Point collections")
        first.setdefault(f["properties"]["id"], (f, env))
    judged = {}
    for fid, (f, env) in first.items():
        st, place = cfg["state"](f["properties"].get("details") or {}, region)
        judged[fid] = (st, place)
    near = outline.near([(fid, *first[fid][0]["geometry"]["coordinates"][:2]) for fid, (st, _) in judged.items() if st == region["stateFips"]])
    kept, dropped, neighbours = [], {}, 0
    for fid in sorted(first):
        f, env = first[fid]
        st, place = judged[fid]
        if st == region["stateFips"] and fid in near:
            kept.append((f, env, place))
        elif st == region["stateFips"]:
            dropped[fid] = f"the source says {region['stateName']} but the point lies more than {outline.tolerance} degrees outside eye's outline"
        elif st is None:
            dropped[fid] = "no state in the source's own fields"
        else:
            neighbours += 1  # another state's record from an edge tile: not this region's
    return kept, dropped, neighbours


# ---------------------------------------------------------------- publisher count and gap

def arcgis(layer: str, where: str, extra: str) -> str:
    return f"{layer}/query?where={urllib.parse.quote(where)}&{extra}&f=json"


def _point(g) -> tuple[float, float] | None:
    if isinstance(g, dict) and isinstance(g.get("x"), (int, float)) and isinstance(g.get("y"), (int, float)):
        return (float(g["x"]), float(g["y"]))
    return None


def publisher_ids(fx: Fetcher, pub: dict, where: str) -> tuple[dict[str, dict], int, dict[str, int]]:
    """({eye id: attributes}, rows the publisher returned, {eye id: rows} for ids on more than one row)."""
    fields = ",".join(x for x in [pub["idField"], pub.get("statusField")] if x)
    rows, off = [], 0
    while True:
        page = fx.get_json(arcgis(pub["layer"], where, f"outFields={fields}&returnGeometry=true&outSR=4326&orderByFields={pub['idField']}&resultOffset={off}&resultRecordCount=2000"), "gap")
        if "error" in page:
            raise SystemExit(f"publisher id query failed: {page['error']}")
        # The publisher's own point rides along as _pt, to say why no tile held a row.
        got = [{**x["attributes"], "_pt": _point(x.get("geometry"))} for x in page.get("features", [])]
        rows += got
        off += len(got)
        if not got or not page.get("exceededTransferLimit"):
            break
    by_id: dict[str, dict] = {}
    times: dict[str, int] = {}
    for a in rows:
        k = pub["eyeId"](a)
        by_id.setdefault(k, a)
        times[k] = times.get(k, 0) + 1
    return by_id, len(rows), {k: n for k, n in times.items() if n > 1}


def count_and_gap(fx: Fetcher, cfg: dict, region: dict, records: list[dict], dropped: dict, neighbours: int, outline: geo.Region) -> dict:
    pub = cfg["publisher"]
    where = pub["stateWhere"](region)
    url = arcgis(pub["layer"], where, "returnCountOnly=true")
    c = fx.get_json(url, "count")
    if "count" not in c:
        raise SystemExit(f"publisher count failed: {c}")
    counted_at = fx.log[-1]["retrievedAt"]
    pc = {
        "value": c["count"],
        "method": f"ArcGIS REST query on the publisher's own layer: where {where}, returnCountOnly=true (keyless). Every row the publisher files under {region['stateName']}, whatever its status.",
        "url": url,
        "countedAt": counted_at,
    }
    theirs, rows, dups = publisher_ids(fx, pub, where)
    if rows != c["count"]:
        raise SystemExit(f"publisher id pages hold {rows} rows, its count says {c['count']}")
    served = publisher_ids(fx, pub, f"({where}) AND {pub['eyeWhere']}")[0] if pub.get("eyeWhere") else None
    have = {r["id"] for r in records}
    missing = sorted(set(theirs) - have)
    near = outline.near([(eid, *theirs[eid]["_pt"]) for eid in missing if theirs[eid]["_pt"]])
    groups: dict[str, list[str]] = {}
    for eid in missing:
        a = theirs[eid]
        if pub.get("notServed") and pub["notServed"](a):
            why = pub["notServedWhy"].format(**{k: ("(none)" if v is None else v) for k, v in a.items()})
        elif served is not None and eid not in served:
            why = "address restricted (NPS's Address field marks it; eye filters these out and never requests the address)"
        elif eid in dropped:
            why = f"left out by this snapshot's region rule: {dropped[eid]}"
        elif a["_pt"] is None:
            why = "the publisher files it under the state, but its row has no point, so no tile could hold it"
        elif eid not in near:
            why = f"the publisher files it under the state, but its own point lies more than {outline.tolerance} degrees outside eye's outline, so no tile asked for it"
        else:
            why = "the publisher files it under the state and its point is inside, but no tile of eye's answers held it"
        groups.setdefault(why, []).append(eid)
    extra = sorted(have - set(theirs))
    parts = [f"{len(ids)} {why}: {', '.join(ids)}" for why, ids in sorted(groups.items(), key=lambda kv: -len(kv[1]))]
    if dups:
        extra_rows = sum(n - 1 for n in dups.values())
        parts.insert(0, f"{extra_rows} publisher row(s) repeat an id another row already has ({pub['idField']}), and a record's key is its id, so one record per id: "
                     + ", ".join(f"{k} on {n} rows" for k, n in sorted(dups.items())))
    if extra:
        parts.append(f"{len(extra)} record(s) here that the publisher's query under the state did not return: {', '.join(extra)}")
    other_drops = sorted(fid for fid in dropped if fid not in theirs)
    if other_drops:
        parts.append(f"{len(other_drops)} feature(s) eye returned that this snapshot left out and the publisher doesn't file under the state either: " + ", ".join(f"{fid} ({dropped[fid]})" for fid in other_drops))
    if parts or c["count"] != len(records):
        pc["gap"] = (
            f"The publisher counts {c['count']}; this snapshot holds {len(records)}. "
            + ("; ".join(parts) if parts else "no row could be named")
            + f". Not counted either way: {neighbours} feature(s) from edge tiles whose source names another state."
        )
    return pc


# ---------------------------------------------------------------- manifest

def dump_manifest(m: dict) -> str:
    """Pretty JSON with one request per line, so a manifest with thousands of tile requests stays readable."""
    body = json.dumps({**m, "requests": "\0REQ\0"}, indent=2, ensure_ascii=False)
    reqs = ",\n".join("    " + json.dumps(r, ensure_ascii=False) for r in m["requests"])
    return body.replace('"\\u0000REQ\\u0000"', "[\n" + reqs + "\n  ]") + "\n"


def withheld_fields(cfg: dict, relabelled: int) -> list[dict]:
    """The card's withheld fields; the first one's why also says how many records eye named and this build labelled by id."""
    out = [dict(w) for w in cfg["withheld"]]
    if relabelled and cfg.get("relabelNote"):
        out[0]["why"] += " " + cfg["relabelNote"].format(n=relabelled)
    return out


def build(collection: str, region: dict, data_root: Path, manifests: Path, git_sha: str, smoke_bbox=None, offline: bool = False) -> dict:
    cfg = cards.COLLECTIONS[collection]
    t0 = time.monotonic()
    fx = Fetcher(data_root / "raw", offline=offline)
    to_record.relabelled = 0
    con = geo.connect()
    geometry, outline_entry = region_outline(fx, region)
    outline = geo.Region(con, geometry, cards.BOUNDARY_TOLERANCE_DEG)
    cells = outline.tiles(cfg["span"], cfg["grid"])
    if smoke_bbox:
        w, s, e, n = smoke_bbox
        cells = [c for c in cells if (b := geo.cell_box(c, cfg["grid"])) and b[0] < e and b[2] > w and b[1] < n and b[3] > s]
    log(f"{collection}: {len(cells)} tiles of {cfg['span']} degrees on a {cfg['grid']} grid")
    features, stats = fetch_tiles(fx, cfg, cells)
    kept, dropped, neighbours = select(features, cfg, region, outline)
    log(f"{collection}: {len(features)} features, {len(kept)} kept, {len(dropped)} dropped, {neighbours} from other states")

    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    snapshot_id = f"{collection}.{region['id']}.{created_at[:10]}"
    records = [to_record(f, env, cfg, collection, place, snapshot_id) for f, env, place in kept]
    records.sort(key=lambda r: r["id"])
    relabelled = to_record.relabelled
    if relabelled:
        log(f"{collection}: {relabelled} records eye named are labelled by id here (the builder's name rule is stricter than eye's answer)")

    work = data_root / "work"
    work.mkdir(parents=True, exist_ok=True)
    jsonl = work / f"{snapshot_id}.jsonl"
    jsonl.write_bytes(("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records)).encode("utf8"))
    v = node("record", str(jsonl))
    if v.returncode != 0:
        bad = [line for line in v.stdout.splitlines() if not line.startswith("ok ")]
        raise SystemExit(f"{collection}: records fail validation ({sum(1 for b in bad if b.startswith('FAIL'))} records):\n" + "\n".join(bad[:60]))
    log(f"{collection}: {len(records)} records valid")

    folder = data_root / "snapshots" / snapshot_id
    folder.mkdir(parents=True, exist_ok=True)
    pq = folder / "records.parquet"
    geo.write_geoparquet(con, records, pq)
    if not geo.geo_metadata(con, pq):
        raise SystemExit(f"{pq} has no GeoParquet 'geo' metadata")
    pq_bytes = pq.read_bytes()

    publisher_count = count_and_gap(fx, cfg, region, records, dropped, neighbours, outline)
    tol = cards.BOUNDARY_TOLERANCE_DEG
    manifest = {
        "schemaVersion": "manifest/1",
        "snapshotId": snapshot_id,
        "collection": collection,
        "region": {
            "id": region["id"],
            "name": region["name"],
            "bbox": outline.bbox(),
            "rule": "point-in-polygon",
            "definition": (
                f"A record is in when {cfg['stateSource']} puts it in {region['stateName']} and its point lies inside, or within {tol} degrees of, "
                f"eye's outline {region['boundaryId']} from {region['boundaryUrl']} (Census TIGERweb, generalised 1:20M; response sha256 "
                f"{outline_entry['sha256']}, retrieved {outline_entry['retrievedAt']}). The tolerance covers the generalised coast and river "
                f"borders; the source's own state field decides between neighbours. bbox is the widened outline's extent. Records came from "
                f"{stats['tilesAsked']} requests to eye's {cfg['route']}?op={cfg['op']}: {cfg['span']}-degree boxes on eye's {cfg['grid']}-degree "
                f"grid that touch the widened outline, each split in four while eye said truncated ({stats['tilesSplit']} split), deduplicated by id."
            ),
        },
        "createdAt": created_at,
        "builder": {"name": "groundtruth data/pipeline/build.py", "version": VERSION, "gitSha": git_sha, "repo": "github.com/jcdavis131/groundtruth"},
        "recordSchemaVersion": "record/1",
        "sources": list({r["provenance"]["sourceId"]: {"sourceId": r["provenance"]["sourceId"], "licence": r["provenance"]["licence"]} for r in records}.values()),
        "requests": fx.log,
        "recordCount": len(records),
        "publisherCount": publisher_count,
        "files": [{"path": "records.parquet", "format": "geoparquet", "sha256": sha256(pq_bytes), "bytes": len(pq_bytes), "records": len(records)}],
        **({"withheldFields": withheld_fields(cfg, relabelled)} if cfg["withheld"] else {}),
    }
    text = dump_manifest(manifest)
    (folder / "manifest.json").write_bytes(text.encode("utf8"))
    v = node("manifest", str(folder / "manifest.json"))
    if v.returncode != 0:
        raise SystemExit(f"{snapshot_id}: manifest fails validation:\n{v.stdout}")
    out = Path(manifests) / collection / f"{snapshot_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(text.encode("utf8"))
    back = read.load(snapshot_id, data_root, manifests)
    if back != records:
        raise SystemExit(f"{snapshot_id}: read.py gives back different rows than were written")
    summary = {
        "snapshotId": snapshot_id,
        "records": len(records),
        "publisherCount": publisher_count["value"],
        "parquetBytes": len(pq_bytes),
        "manifestBytes": len(text.encode("utf8")),
        "requests": len(fx.log),
        "network": fx.network,
        "cached": fx.cached,
        "transportErrors": fx.transport_errors,
        "dropped": len(dropped),
        "neighbours": neighbours,
        "sameTileRepeats": select.same_tile_repeats,
        **stats,
        "seconds": round(time.monotonic() - t0, 1),
        "manifest": str(out),
    }
    (work / f"{snapshot_id}.summary.json").write_text(json.dumps({**summary, "droppedIds": dropped}, indent=2), "utf8")
    log(f"{snapshot_id}: done {json.dumps(summary)}")
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("collections", nargs="+", choices=sorted(cards.COLLECTIONS))
    ap.add_argument("--region", default="texas", choices=sorted(cards.REGIONS))
    ap.add_argument("--data-root", type=Path, default=None, help="default: GROUNDTRUTH_DATA_ROOT or <home>/datastore/groundtruth-snapshots")
    ap.add_argument("--manifests", type=Path, default=read.DEFAULT_MANIFESTS)
    ap.add_argument("--bbox", default=None, help="smoke test: only tiles touching w,s,e,n")
    ap.add_argument("--allow-dirty", action="store_true", help="smoke test only: build from uncommitted code")
    ap.add_argument("--offline", action="store_true", help="build from the raw cache only; a cache miss stops the build")
    a = ap.parse_args(argv)
    data_root = a.data_root or read.default_data_root()
    region = dict(cards.REGIONS[a.region])
    smoke = [float(x) for x in a.bbox.split(",")] if a.bbox else None
    in_repo = Path(a.manifests).resolve().is_relative_to(REPO.resolve())
    if smoke:
        region["id"] += "-smoke"
        region["name"] += f" (smoke test: tiles touching {a.bbox} only)"
        if in_repo:
            raise SystemExit("a smoke test writes its manifests outside the repo: pass --manifests")
    if git("status", "--porcelain", "--", *PINNED):
        if not (a.allow_dirty and smoke):
            raise SystemExit("commit data/pipeline, data/schema and data/pyproject.toml first: the manifest names that commit")
        log("building from uncommitted code (smoke test)")
    git_sha = git("rev-parse", "HEAD")
    results = [build(c, region, data_root, a.manifests, git_sha, smoke, a.offline) for c in a.collections]
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
