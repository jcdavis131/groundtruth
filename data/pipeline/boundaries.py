"""The county boundary the joins test points against: Census TIGER/Line 2025 COUNTY, vintage-pinned.

    python data/pipeline/boundaries.py [--data-root DIR] [--offline]

Downloads the zip once into <data-root>/raw/boundaries/ with a sidecar <file>.json
{url, retrievedAt, bytes, sha256}. Every later use re-hashes the file and refuses it when the hash differs
from the sidecar, so a join can only name a boundary file whose bytes are on record. It is the only download
the county join makes. DuckDB's ST_Read reads the shapefile straight out of the zip (GDAL /vsizip/).

The product is TIGER/Line 2025 (reflects boundaries as of 2025-01-01). TIGER2024 is the named fallback if the
2025 URL ever stops answering; switching to it means changing PRODUCT and the TIGERweb layer together.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import net  # the IPv4-only resolver and the descriptive user agent live there

PUBLISHER = "U.S. Census Bureau"
PRODUCT = "TIGER/Line 2025 COUNTY"
VINTAGE = "2025"
FILE = "tl_2025_us_county.zip"
URL = f"https://www2.census.gov/geo/tiger/TIGER2025/COUNTY/{FILE}"
SHAPEFILE = "tl_2025_us_county.shp"


class BoundaryRefused(Exception):
    pass


def paths(data_root: Path, file: str = FILE) -> tuple[Path, Path]:
    d = Path(data_root) / "raw" / "boundaries"
    return d / file, d / f"{file}.json"


def _sha256_file(p: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            n += len(chunk)
    return h.hexdigest(), n


def verify(zip_path: Path, sidecar: Path | None = None) -> dict:
    """The sidecar's {url, retrievedAt, bytes, sha256}, after checking the file hashes to it."""
    zip_path = Path(zip_path)
    sidecar = Path(sidecar) if sidecar else zip_path.with_name(zip_path.name + ".json")
    if not zip_path.is_file():
        raise BoundaryRefused(f"{zip_path} is missing")
    if not sidecar.is_file():
        raise BoundaryRefused(f"{zip_path} has no sidecar {sidecar.name}: refusing a boundary file whose origin isn't recorded")
    meta = json.loads(sidecar.read_text("utf8"))
    for k in ("url", "retrievedAt", "bytes", "sha256"):
        if k not in meta:
            raise BoundaryRefused(f"{sidecar.name} has no {k}")
    sha, n = _sha256_file(zip_path)
    if sha != meta["sha256"] or n != meta["bytes"]:
        raise BoundaryRefused(f"{zip_path.name} is {n} bytes and hashes to {sha}; its sidecar says {meta['bytes']} bytes and {meta['sha256']}")
    return meta


def ensure(data_root: Path, offline: bool = False, url: str = URL, file: str = FILE) -> tuple[Path, dict]:
    """(zip path, sidecar) for the boundary file, downloading it first when absent and not offline."""
    zp, sc = paths(data_root, file)
    if zp.exists() or sc.exists():
        return zp, verify(zp, sc)
    if offline:
        raise BoundaryRefused(f"offline: {zp} is not in the data root")
    zp.parent.mkdir(parents=True, exist_ok=True)
    tmp = zp.with_name(zp.name + ".part")
    at = net.utc_now()
    req = urllib.request.Request(url, headers={"user-agent": net.UA})
    h = hashlib.sha256()
    n = 0
    with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as out:
        if r.status != 200:
            raise BoundaryRefused(f"{url} answered {r.status}")
        for chunk in iter(lambda: r.read(1 << 20), b""):
            out.write(chunk)
            h.update(chunk)
            n += len(chunk)
    tmp.replace(zp)
    sc.write_text(json.dumps({"url": url, "retrievedAt": at, "bytes": n, "sha256": h.hexdigest()}, indent=2) + "\n", "utf8")
    return zp, verify(zp, sc)


def boundary_block(meta: dict) -> dict:
    """The manifest's joins[].boundary for this file."""
    return {"publisher": PUBLISHER, "product": PRODUCT, "vintage": VINTAGE, "url": meta["url"], "sha256": meta["sha256"], "retrievedAt": meta["retrievedAt"]}


def load(con, zip_path: Path, bbox: tuple[float, float, float, float] | None = None) -> int:
    """county_2025(GEOID, NAME, geom) in `con` from the zip, after verifying it. Returns the row count.

    `bbox` (west, south, east, north) reads only the counties whose extent meets the box (GDAL's spatial filter),
    which keeps the load small on a RAM-poor box: a state's counties all meet that state's box.
    """
    verify(zip_path)
    p = Path(zip_path).resolve().as_posix()
    if "'" in p:
        raise ValueError(f"path with a quote: {p}")
    flt = ""
    if bbox is not None:
        w, s, e, n = bbox
        flt = f", spatial_filter_box := ST_MakeBox2D(ST_Point({w}, {s}), ST_Point({e}, {n}))"
    con.execute(f"CREATE OR REPLACE TABLE county_2025 AS SELECT GEOID, NAME, geom FROM ST_Read('/vsizip/{p}/{SHAPEFILE}'{flt})")
    return con.execute("SELECT count(*) FROM county_2025").fetchone()[0]


def load_subset(con, geojson: Path) -> int:
    """county_2025 from a small GeoJSON cut of the real file (the test fixture)."""
    p = Path(geojson).resolve().as_posix()
    con.execute(f"CREATE OR REPLACE TABLE county_2025 AS SELECT GEOID, NAME, geom FROM ST_Read('{p}')")
    return con.execute("SELECT count(*) FROM county_2025").fetchone()[0]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data-root", type=Path, default=None)
    ap.add_argument("--offline", action="store_true")
    a = ap.parse_args(argv)
    import read

    root = a.data_root or read.default_data_root()
    try:
        zp, meta = ensure(root, a.offline)
    except BoundaryRefused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    print(json.dumps({"path": str(zp), **meta}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
