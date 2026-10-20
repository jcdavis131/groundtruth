"""Read a snapshot's rows, but only after every file it lists matches its committed manifest.

    python data/pipeline/read.py <snapshot-id> [--data-root DIR] [--manifests DIR] [--jsonl]

The manifest is the committed copy, data/manifests/<collection>/<snapshot-id>.json. The files are under
<data-root>/snapshots/<snapshot-id>/. Every file's byte count and sha256 must equal the manifest's before any
row is read; then the row count, each row's snapshot id and the ids' uniqueness are checked. Any mismatch
raises SnapshotRefused and the CLI exits 1 without printing rows.

From Python:  import read; rows = read.load("nid-dams.texas.2026-10-19")
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFESTS = REPO / "data" / "manifests"


def default_data_root() -> Path:
    """GROUNDTRUTH_DATA_ROOT, else <home>/datastore/groundtruth-snapshots (docs write it as <data-root>)."""
    env = os.environ.get("GROUNDTRUTH_DATA_ROOT")
    return Path(env) if env else Path.home() / "datastore" / "groundtruth-snapshots"


class SnapshotRefused(Exception):
    pass


def _sha256_file(p: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            n += len(chunk)
    return h.hexdigest(), n


def manifest_path(snapshot_id: str, manifests: Path = DEFAULT_MANIFESTS) -> Path:
    parts = snapshot_id.split(".")
    if len(parts) != 3 or not all(parts):
        raise SnapshotRefused(f"{snapshot_id!r} is not <collection>.<region>.<YYYY-MM-DD>")
    return Path(manifests) / parts[0] / f"{snapshot_id}.json"


def verify(snapshot_id: str, data_root: Path | None = None, manifests: Path = DEFAULT_MANIFESTS) -> tuple[dict, Path]:
    """The manifest and the snapshot folder, after checking every listed file's bytes and sha256."""
    mp = manifest_path(snapshot_id, manifests)
    if not mp.exists():
        raise SnapshotRefused(f"no committed manifest at {mp}")
    m = json.loads(mp.read_text("utf8"))
    if m.get("snapshotId") != snapshot_id:
        raise SnapshotRefused(f"{mp} is the manifest of {m.get('snapshotId')}, not {snapshot_id}")
    folder = Path(data_root or default_data_root()) / "snapshots" / snapshot_id
    files = m.get("files") or []
    if not files:
        raise SnapshotRefused("the manifest lists no files")
    for f in files:
        rel = f["path"]
        if rel.startswith("/") or ".." in rel.split("/"):
            raise SnapshotRefused(f"file path {rel!r} leaves the snapshot folder")
        p = folder / rel
        if not p.is_file():
            raise SnapshotRefused(f"{rel} is missing from {folder}")
        sha, n = _sha256_file(p)
        if n != f["bytes"]:
            raise SnapshotRefused(f"{rel} is {n} bytes, the manifest says {f['bytes']}")
        if sha != f["sha256"]:
            raise SnapshotRefused(f"{rel} hashes to {sha}, the manifest says {f['sha256']}")
    return m, folder


def load(snapshot_id: str, data_root: Path | None = None, manifests: Path = DEFAULT_MANIFESTS) -> list[dict]:
    """Every record of the snapshot, as record/1 dicts sorted by id, once the files check out."""
    m, folder = verify(snapshot_id, data_root, manifests)
    import geo  # duckdb only once the hashes are good

    con = geo.connect()
    rows: list[dict] = []
    for f in m["files"]:
        p = folder / f["path"]
        if f["format"] == "geoparquet":
            got = geo.read_records(con, p)
        elif f["format"] == "jsonl":
            got = [json.loads(line) for line in p.read_text("utf8").split("\n") if line]
        else:
            raise SnapshotRefused(f"{f['path']}: unknown format {f['format']}")
        if len(got) != f["records"]:
            raise SnapshotRefused(f"{f['path']} holds {len(got)} rows, the manifest says {f['records']}")
        rows.extend(got)
    if len(rows) != m["recordCount"]:
        raise SnapshotRefused(f"{len(rows)} rows, the manifest's recordCount is {m['recordCount']}")
    seen = set()
    for r in rows:
        if r.get("snapshotId") != snapshot_id:
            raise SnapshotRefused(f"row {r.get('id')} belongs to {r.get('snapshotId')}")
        if r["id"] in seen:
            raise SnapshotRefused(f"id {r['id']} appears twice")
        seen.add(r["id"])
    rows.sort(key=lambda r: r["id"])
    _check_joins(m, rows)
    return rows


def _check_joins(m: dict, rows: list[dict]) -> None:
    """The manifest's joins block against the rows (validate.mjs can't read Parquet, so this is that check for GeoParquet):
    every row without a countyFips has an unplaced entry, every unplaced id is a row without one, and placed is the rest."""
    for j in m.get("joins") or []:
        has = {r["id"]: bool(r["place"].get("countyFips")) for r in rows}
        listed = set()
        for u in j["unplaced"]:
            if u["id"] not in has:
                raise SnapshotRefused(f"joins: unplaced id {u['id']} is not a row of the snapshot")
            if has[u["id"]]:
                raise SnapshotRefused(f"joins: {u['id']} is listed unplaced but carries a countyFips")
            if not str(u.get("reason", "")).strip():
                raise SnapshotRefused(f"joins: unplaced {u['id']} has no reason")
            listed.add(u["id"])
        bare = {i for i, h in has.items() if not h}
        if bare != listed:
            raise SnapshotRefused(f"joins: {len(bare - listed)} rows have no countyFips and no unplaced entry (first: {sorted(bare - listed)[:3]})")
        if j["placed"] != len(rows) - len(bare):
            raise SnapshotRefused(f"joins: placed is {j['placed']}, the rows bear out {len(rows) - len(bare)}")
        counts = {}
        for r in rows:
            if r["place"].get("countyFips"):
                counts[r["place"]["method"]] = counts.get(r["place"]["method"], 0) + 1
        for k, v in j["methods"].items():
            if counts.get(k, 0) != v:
                raise SnapshotRefused(f"joins: methods say {v} by {k}, the rows bear out {counts.get(k, 0)}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("snapshot_id")
    ap.add_argument("--data-root", type=Path, default=None, help="default: GROUNDTRUTH_DATA_ROOT or <home>/datastore/groundtruth-snapshots")
    ap.add_argument("--manifests", type=Path, default=DEFAULT_MANIFESTS)
    ap.add_argument("--jsonl", action="store_true", help="print the records, one JSON object per line")
    a = ap.parse_args(argv)
    try:
        rows = load(a.snapshot_id, a.data_root, a.manifests)
    except SnapshotRefused as e:
        print(f"refused {a.snapshot_id}: {e}", file=sys.stderr)
        return 1
    if a.jsonl:
        out = sys.stdout.buffer
        for r in rows:
            out.write((json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf8"))
    else:
        print(f"ok {a.snapshot_id}: {len(rows)} records, every file matches its manifest")
    return 0


if __name__ == "__main__":
    sys.exit(main())
