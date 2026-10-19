"""DuckDB with its spatial extension: the region test, the tile list and the GeoParquet files.

The spatial extension is loaded at runtime from DuckDB's own keyless extension repository (INSTALL spatial).
Everything runs single-threaded so a rebuild from the same records writes the same bytes.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path

import duckdb


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("SET threads=1")
    con.execute("INSTALL spatial")
    con.execute("LOAD spatial")
    return con


class Region:
    """A boundary polygon (GeoJSON geometry, WGS84) and a tolerance in degrees around it."""

    def __init__(self, con, geometry: dict, tolerance_deg: float):
        self.con = con
        self.tolerance = tolerance_deg
        con.execute("CREATE OR REPLACE TABLE region AS SELECT ST_GeomFromGeoJSON(?) AS g", [json.dumps(geometry)])
        con.execute("CREATE OR REPLACE TABLE region_buf AS SELECT ST_Buffer(g, ?) AS g FROM region", [tolerance_deg])
        self.extent = con.execute("SELECT ST_XMin(g), ST_YMin(g), ST_XMax(g), ST_YMax(g) FROM region_buf").fetchone()

    def bbox(self) -> list[float]:
        """The tolerance-widened extent, rounded outward to 4 decimals: every record lies inside it."""
        w, s, e, n = self.extent
        return [math.floor(w * 1e4) / 1e4, math.floor(s * 1e4) / 1e4, math.ceil(e * 1e4) / 1e4, math.ceil(n * 1e4) / 1e4]

    def tiles(self, span: float, grid: float) -> list[tuple[float, float, float, float]]:
        """Boxes of `span` degrees on eye's `grid` that touch the widened region, west to east, south to north."""
        k = round(span / grid)
        w, s, e, n = self.extent
        gx0, gy0 = math.floor(w / grid), math.floor(s / grid)
        gx1, gy1 = math.ceil(e / grid), math.ceil(n / grid)
        rows = self.con.execute(
            """
            SELECT gx, gy FROM range(?, ?, ?) x(gx), range(?, ?, ?) y(gy), region_buf
            WHERE ST_Intersects(region_buf.g, ST_MakeEnvelope(round(gx * ?, 4), round(gy * ?, 4), round((gx + ?) * ?, 4), round((gy + ?) * ?, 4)))
            ORDER BY gx, gy
            """,
            [gx0, gx1, k, gy0, gy1, k, grid, grid, k, grid, k, grid],
        ).fetchall()
        return [(gx, gy, gx + k, gy + k) for gx, gy in rows]

    def near(self, points: list[tuple[str, float, float]]) -> set[str]:
        """Ids whose point lies inside the outline or within the tolerance of it."""
        if not points:
            return set()
        with _ndjson([{"id": i, "x": x, "y": y} for i, x, y in points]) as p:
            rows = self.con.execute(
                f"SELECT id FROM read_json('{_sql_path(p)}', format='newline_delimited', columns={{id: 'VARCHAR', x: 'DOUBLE', y: 'DOUBLE'}}) pts, region_buf "
                "WHERE ST_Intersects(region_buf.g, ST_Point(x, y))"
            ).fetchall()
        return {r[0] for r in rows}


def cell_box(c, grid: float) -> tuple[float, float, float, float]:
    """Integer grid cells (gx0, gy0, gx1, gy1) as degrees, rounded to 4 decimals the way eye snaps them."""
    return tuple(round(v * grid, 4) for v in c)


# ---------------------------------------------------------------- GeoParquet

COLUMNS = [
    "schemaVersion", "id", "collection", "layer", "name", "nameRule", "kind", "geometry_json", "stateFips", "stateUsps",
    "countyFips", "placeMethod", "details", "text", "provenance", "snapshotId", "record",
]


def write_geoparquet(con, records: list[dict], path: Path) -> None:
    """One row per record, sorted by id. Typed columns for queries, plus `record`: the exact validated JSON line.

    Absent optional fields (kind, countyFips, text) are Parquet nulls; `record` never carries a null.
    """
    rows = []
    for r in records:
        p = r["place"]
        rows.append(dict(zip(COLUMNS, (
            r["schemaVersion"], r["id"], r["collection"], r["layer"], r["name"], r["nameRule"], r.get("kind"),
            json.dumps(r["geometry"]), p["stateFips"], p["stateUsps"], p.get("countyFips"), p["method"],
            json.dumps(r["details"], ensure_ascii=False), r.get("text"), json.dumps(r["provenance"], ensure_ascii=False),
            r["snapshotId"], json.dumps(r, ensure_ascii=False, separators=(",", ":")),
        ))))
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    cols = ", ".join(f"{c}: 'VARCHAR'" for c in COLUMNS)
    with _ndjson(rows) as src:
        con.execute(f"""
          COPY (
            SELECT schemaVersion, id, collection, layer, name, nameRule, kind,
                   ST_GeomFromGeoJSON(geometry_json) AS geometry,
                   stateFips, stateUsps, countyFips, placeMethod,
                   details::JSON AS details, text, provenance::JSON AS provenance, snapshotId, record
            FROM read_json('{_sql_path(src)}', format='newline_delimited', columns={{{cols}}})
            ORDER BY id
          ) TO '{_sql_path(path)}' (FORMAT parquet, COMPRESSION zstd)
        """)


@contextmanager
def _ndjson(rows: list[dict]):
    """A temporary newline-delimited JSON file DuckDB can read (much faster than executemany)."""
    fd, name = tempfile.mkstemp(suffix=".ndjson", prefix="gt-")
    try:
        with os.fdopen(fd, "w", encoding="utf8", newline="\n") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        yield Path(name)
    finally:
        os.unlink(name)


def read_records(con, path: Path) -> list[dict]:
    """The `record` column, in file order, parsed."""
    return [json.loads(r[0]) for r in con.execute(f"SELECT record FROM read_parquet('{_sql_path(path)}')").fetchall()]


def geo_metadata(con, path: Path) -> dict | None:
    """The file's GeoParquet `geo` key, parsed, or None."""
    rows = con.execute(f"SELECT key, value FROM parquet_kv_metadata('{_sql_path(path)}')").fetchall()
    for k, v in rows:
        if (k.decode() if isinstance(k, bytes) else k) == "geo":
            return json.loads(v.decode() if isinstance(v, bytes) else v)
    return None


def _sql_path(p: Path) -> str:
    s = Path(p).resolve().as_posix()
    if "'" in s:
        raise ValueError(f"path with a quote: {s}")
    return s
