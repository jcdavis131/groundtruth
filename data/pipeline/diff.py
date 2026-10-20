"""Diff two snapshot days of one collection and region, and probe the publisher's id list for churn.

    python data/pipeline/diff.py <from-snapshot-id> <to-snapshot-id> [--data-root DIR] [--out FILE]
    python data/pipeline/diff.py --probe [--offline] [--manifest FILE] [--data-root DIR]

Diff. Both snapshots are read through read.py, so every file is checked against its committed manifest first.
Every id in <from> and not in <to> is a removal, and it gets exactly one reason:

  publisher-status  the <to> manifest's publisherCount.gapItems names the id, and says the publisher's own status
                    field (NPS STATUS, NCES status) or its address flag keeps it out
  our-rule          the same gap item says our region rule or the builder's outline test left it out
  id-churn          no gap item names it, but a record added in <to> has the same secondary key (NRIS_Refnum for
                    NRHP, NIDID for dams, NCESSCH for schools) and sits within 1 m. Only one removed id may claim
                    one added record, and only one added record may match
  unknown           anything else, with a why. Nothing is guessed

A gap reason this module does not recognise is unknown, not our-rule. Records with the same id in both are compared
field by field (snapshotId aside); a change lists its dotted paths.

Probe. Re-fetches the id list that a manifest's first `gap` request asked for, with the same URL, and compares the
OBJECTIDs with the sha-pinned body in <data-root>/raw/. At most two requests, one page (the pinned list is one page of
2000). churn_rate = (removed + added) / the union of both id sets. --offline reads the cached body for both sides, so
it reports 0.0 against itself and makes no request. A cached body that no longer hashes to the manifest's sha256 is
refused. The live answer is cached in a temporary folder, never in the data root.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import net
import read

REPO = Path(__file__).resolve().parents[2]
VERSION = "0.1.0"
CHURN_M = 1.0
REASONS = ("publisher-status", "our-rule", "id-churn", "unknown")

# The record detail that carries each collection's secondary key (the publisher's own, not our id).
SECONDARY_KEY = {
    "nrhp-listed": ("nris refnum", "NRIS_Refnum"),
    "nid-dams": ("NID id", "NIDID"),
    "nces-public-schools": ("NCES school id", "NCESSCH"),
}


class DiffRefused(Exception):
    pass


class ProbeRefused(Exception):
    pass


# ---------------------------------------------------------------- classify

def reason_of_gap(text: str) -> str | None:
    """publisher-status, our-rule, or None for a gap reason this module does not class (builder wording, build.py)."""
    t = text.strip()
    if t.startswith(("NPS STATUS", "NCES status", "address restricted")):
        return "publisher-status"
    if t.startswith("left out by this snapshot's region rule") or (t.startswith("the publisher files it under the state, but its own point lies more than") and t.endswith("so no tile asked for it")):
        return "our-rule"
    return None


def _point(r: dict):
    g = r.get("geometry")
    if isinstance(g, dict) and g.get("type") == "Point":
        c = g.get("coordinates")
        if isinstance(c, list) and len(c) >= 2 and all(isinstance(x, (int, float)) for x in c[:2]):
            return float(c[0]), float(c[1])
    return None


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in metres (haversine, mean earth radius)."""
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(min(1.0, math.sqrt(h)))


def _flat(v, path=""):
    if isinstance(v, dict):
        for k in sorted(v):
            yield from _flat(v[k], f"{path}.{k}" if path else k)
    else:
        yield path, v


def changed_fields(a: dict, b: dict) -> list[str]:
    fa, fb = dict(_flat(a)), dict(_flat(b))
    return sorted(p for p in set(fa) | set(fb) if p != "snapshotId" and fa.get(p, _MISSING) != fb.get(p, _MISSING))


_MISSING = object()


def compare(old: list[dict], new: list[dict], collection: str, gap_items: list[dict] | None) -> dict:
    """{"added", "removed", "changed"} between two lists of record/1 rows. gap_items are the <to> manifest's."""
    o = {r["id"]: r for r in old}
    n = {r["id"]: r for r in new}
    gap = {g["id"]: g["reason"] for g in (gap_items or [])}
    key_name = SECONDARY_KEY.get(collection, (None, None))[0]

    added_ids = sorted(set(n) - set(o))
    by_key: dict[str, list[str]] = {}
    if key_name:
        for i in added_ids:
            v = n[i].get("details", {}).get(key_name)
            if v not in (None, ""):
                by_key.setdefault(str(v), []).append(i)

    removed, claims = [], {}
    for i in sorted(set(o) - set(n)):
        if i in gap:
            klass = reason_of_gap(gap[i])
            if klass:
                removed.append({"id": i, "reason": klass, "why": gap[i]})
            else:
                removed.append({"id": i, "reason": "unknown", "why": f"the <to> manifest's gap item names it, in words diff.py does not class: {gap[i]}"})
            continue
        v = o[i].get("details", {}).get(key_name) if key_name else None
        if v in (None, ""):
            removed.append({"id": i, "reason": "unknown", "why": f"no gap item names it, and it has no {key_name or 'secondary key'} to match a new id by"})
            continue
        pt = _point(o[i])
        near, far = [], []
        for c in by_key.get(str(v), []):
            q = _point(n[c])
            d = metres(pt, q) if pt and q else None
            (near if d is not None and d <= CHURN_M else far).append((c, d))
        if len(near) == 1:
            c, d = near[0]
            claims.setdefault(c, []).append(i)
            removed.append({"id": i, "reason": "id-churn", "why": f"{key_name} {v} is on {c}, {d:.3f} m away",
                            "replacedBy": c, "secondaryKey": {"name": key_name, "value": str(v)}, "distanceM": round(d, 3)})
        elif len(near) > 1:
            removed.append({"id": i, "reason": "unknown", "why": f"{len(near)} added records share {key_name} {v} within {CHURN_M:g} m: " + ", ".join(c for c, _ in near)})
        elif far:
            removed.append({"id": i, "reason": "unknown", "why": f"{key_name} {v} is on {far[0][0]}, but it is not within {CHURN_M:g} m (or a geometry is not a point)"})
        else:
            removed.append({"id": i, "reason": "unknown", "why": f"no gap item names it and no added record has {key_name} {v}"})

    # one added record can stand in for only one removed id: when two claim it, neither is taken
    for r in removed:
        if r["reason"] == "id-churn" and len(claims[r["replacedBy"]]) > 1:
            why = f"{len(claims[r['replacedBy']])} removed ids ({', '.join(claims[r['replacedBy']])}) match the same added record {r['replacedBy']}, so none is taken"
            for k in ("replacedBy", "secondaryKey", "distanceM"):
                r.pop(k)
            r.update(reason="unknown", why=why)

    churned = {r["replacedBy"]: r["id"] for r in removed if r["reason"] == "id-churn"}
    added = [{"id": i, "reason": "id-churn", "replaces": churned[i]} if i in churned else {"id": i, "reason": "new"} for i in added_ids]
    changed = []
    for i in sorted(set(o) & set(n)):
        f = changed_fields(o[i], n[i])
        if f:
            changed.append({"id": i, "fields": f})
    return {"added": added, "removed": removed, "changed": changed}


# ---------------------------------------------------------------- report

def _side(m: dict, n: int) -> dict:
    return {"snapshotId": m["snapshotId"], "createdAt": m["createdAt"], "recordCount": n}


def build_report(m_from: dict, m_to: dict, old: list[dict], new: list[dict]) -> dict:
    """The diff/1 document (data/schema/diff.schema.json) for two snapshots of one collection and region."""
    if m_from["collection"] != m_to["collection"] or m_from["region"]["id"] != m_to["region"]["id"]:
        raise DiffRefused(f"{m_from['snapshotId']} and {m_to['snapshotId']} are not the same collection and region")
    gap = (m_to.get("publisherCount") or {}).get("gapItems")
    c = compare(old, new, m_to["collection"], gap)
    by = {k: 0 for k in REASONS}
    for r in c["removed"]:
        by[r["reason"]] += 1
    return {
        "schemaVersion": "diff/1",
        "collection": m_to["collection"],
        "region": m_to["region"]["id"],
        "generator": {"name": "groundtruth data/pipeline/diff.py", "version": VERSION},
        "from": _side(m_from, len(old)),
        "to": _side(m_to, len(new)),
        "counts": {
            "added": len(c["added"]), "removed": len(c["removed"]), "changed": len(c["changed"]),
            "unchanged": len(set(r["id"] for r in old) & set(r["id"] for r in new)) - len(c["changed"]),
            "removedByReason": by,
        },
        "added": c["added"], "removed": c["removed"], "changed": c["changed"],
    }


def diff_snapshots(from_id: str, to_id: str, data_root: Path | None = None, manifests: Path = read.DEFAULT_MANIFESTS) -> dict:
    m_from, _ = read.verify(from_id, data_root, manifests)
    m_to, _ = read.verify(to_id, data_root, manifests)
    return build_report(m_from, m_to, read.load(from_id, data_root, manifests), read.load(to_id, data_root, manifests))


# ---------------------------------------------------------------- probe

def live_fetcher(raw_dir: Path) -> net.Fetcher:
    """The pipeline's own fetcher (its UA, one request a second, IPv4), capped at two attempts, and caching into a
    fresh temporary folder so the pinned raw cache is never written."""
    return net.Fetcher(Path(tempfile.mkdtemp(prefix="gt-probe-")), tries=2)


def _ids(body: bytes) -> tuple[dict[int, str | None], bool]:
    j = json.loads(body.decode("utf8"))
    if "error" in j:
        raise ProbeRefused(f"the publisher answered with an error: {j['error']}")
    out = {}
    for f in j.get("features", []):
        a = f["attributes"]
        out[a["OBJECTID"]] = a.get("STATUS")
    return out, bool(j.get("exceededTransferLimit"))


def probe(manifest: dict, raw_dir: Path, offline: bool = False, fetcher=None) -> dict:
    """OBJECTID churn between the sha-pinned body of the manifest's first `gap` request and a fresh fetch of the same URL."""
    req = next((r for r in manifest.get("requests", []) if r.get("purpose") == "gap"), None)
    if req is None:
        raise ProbeRefused("the manifest has no gap request")
    url = req["url"]
    body_p, meta_p = net.Fetcher(raw_dir, offline=True)._paths(url)
    if not body_p.is_file():
        raise ProbeRefused(f"the pinned body of {url} is not in {raw_dir}")
    pinned = body_p.read_bytes()
    if net.sha256(pinned) != req["sha256"] or len(pinned) != req["bytes"]:
        raise ProbeRefused(f"the cached body hashes to {net.sha256(pinned)}, the manifest pins {req['sha256']}")
    if offline:
        fx = fetcher or net.Fetcher(raw_dir, offline=True)
    else:
        fx = fetcher or live_fetcher(raw_dir)
    fresh = fx.get(url, "probe")
    at = fx.log[-1]["retrievedAt"] if getattr(fx, "log", None) else None
    old, old_cut = _ids(pinned)
    new, new_cut = _ids(fresh)
    complete = not (old_cut or new_cut)
    removed, added = sorted(set(old) - set(new)), sorted(set(new) - set(old))
    union = len(set(old) | set(new))
    return {
        "probe": "objectid-churn",
        "snapshotId": manifest.get("snapshotId"),
        "url": url,
        "offline": offline,
        "requests": getattr(fx, "network", 0),
        "complete": complete,
        "pinned": {"sha256": req["sha256"], "bytes": req["bytes"], "retrievedAt": req["retrievedAt"], "ids": len(old)},
        "fresh": {"sha256": net.sha256(fresh), "bytes": len(fresh), "retrievedAt": at, "ids": len(new)},
        "removed": removed,
        "added": added,
        "statusChanged": sum(1 for i in set(old) & set(new) if old[i] != new[i]),
        "churn_rate": ((len(removed) + len(added)) / union if union else 0.0) if complete else None,
        "definition": "churn_rate = (ids only in the pinned body + ids only in the fresh body) / ids in either",
    }


# ---------------------------------------------------------------- cli

DEFAULT_PROBE_MANIFEST = read.DEFAULT_MANIFESTS / "nrhp-listed" / "nrhp-listed.alabama.2026-10-19.json"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("snapshots", nargs="*", help="<from-snapshot-id> <to-snapshot-id>")
    ap.add_argument("--data-root", type=Path, default=None)
    ap.add_argument("--manifests", type=Path, default=read.DEFAULT_MANIFESTS)
    ap.add_argument("--out", type=Path, default=None, help="write the full diff/1 JSON here")
    ap.add_argument("--probe", action="store_true", help="OBJECTID churn of the NRHP Alabama id list (2 requests at most)")
    ap.add_argument("--offline", action="store_true", help="with --probe: no request; the cached body against itself")
    ap.add_argument("--manifest", type=Path, default=DEFAULT_PROBE_MANIFEST, help="with --probe: the manifest whose first gap request is re-fetched")
    a = ap.parse_args(argv)
    root = Path(a.data_root or read.default_data_root())
    if a.probe:
        try:
            r = probe(json.loads(a.manifest.read_text("utf8")), root / "raw", offline=a.offline)
        except (ProbeRefused, SystemExit, net.FetchError) as e:
            print(f"probe refused: {e}", file=sys.stderr)
            return 1
        print(json.dumps(r, indent=1))
        return 0
    if len(a.snapshots) != 2:
        ap.error("two snapshot ids, or --probe")
    try:
        rep = diff_snapshots(a.snapshots[0], a.snapshots[1], root, a.manifests)
    except (read.SnapshotRefused, DiffRefused) as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    text = json.dumps(rep, indent=1, ensure_ascii=False) + "\n"
    if a.out:
        a.out.write_text(text, "utf8")
    c = rep["counts"]
    print(f"{rep['from']['snapshotId']} -> {rep['to']['snapshotId']}: {rep['from']['recordCount']} -> {rep['to']['recordCount']} records; "
          f"added {c['added']}, removed {c['removed']} {c['removedByReason']}, changed {c['changed']}, unchanged {c['unchanged']}")
    for r in rep["removed"]:
        if r["reason"] == "unknown":
            print(f"  unknown: {r['id']}: {r['why']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
