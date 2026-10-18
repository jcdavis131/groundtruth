"""read.py refuses a snapshot whose files don't match the committed manifest, and returns the rows when they do.

    python -m unittest discover -s data/pipeline -p "test_*.py"

Uses the spec's own fixture snapshot (data/schema/fixtures/snapshots/nces-public-schools.austin-east.2026-10-18),
rewritten as GeoParquet in a temporary data root. Needs duckdb and its spatial extension; no other network.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import build
import geo
import read

REPO = Path(__file__).resolve().parents[2]
SNAP = "nces-public-schools.austin-east.2026-10-18"
FIXTURE = REPO / "data" / "schema" / "fixtures" / "snapshots" / SNAP


class ReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gt-read-"))
        self.root = self.tmp / "data-root"
        self.manifests = self.tmp / "manifests"
        self.records = [json.loads(line) for line in (FIXTURE / "records.jsonl").read_text("utf8").splitlines() if line]
        folder = self.root / "snapshots" / SNAP
        self.pq = folder / "records.parquet"
        con = geo.connect()
        geo.write_geoparquet(con, self.records, self.pq)
        self.geo = geo.geo_metadata(con, self.pq)
        con.close()
        data = self.pq.read_bytes()
        m = json.loads((FIXTURE / "manifest.json").read_text("utf8"))
        m["files"] = [{"path": "records.parquet", "format": "geoparquet", "sha256": build.sha256(data), "bytes": len(data), "records": len(self.records)}]
        out = read.manifest_path(SNAP, self.manifests)
        out.parent.mkdir(parents=True)
        out.write_text(build.dump_manifest(m), "utf8")
        shutil.copy(out, folder / "manifest.json")
        v = build.node("manifest", str(folder / "manifest.json"))
        self.assertEqual(v.returncode, 0, v.stdout)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def load(self):
        return read.load(SNAP, self.root, self.manifests)

    def test_reads_the_rows_it_wrote(self):
        self.assertEqual(self.load(), sorted(self.records, key=lambda r: r["id"]))

    def test_file_is_geoparquet(self):
        self.assertIsNotNone(self.geo)
        self.assertIn("geometry", self.geo["columns"])

    def test_same_records_write_the_same_bytes(self):
        again = self.tmp / "again.parquet"
        con = geo.connect()
        geo.write_geoparquet(con, list(reversed(self.records)), again)
        con.close()
        self.assertEqual(again.read_bytes(), self.pq.read_bytes())

    def test_tampered_file_is_refused(self):
        data = bytearray(self.pq.read_bytes())
        data[len(data) // 2] ^= 0x01  # one bit, same size
        self.pq.write_bytes(bytes(data))
        with self.assertRaisesRegex(read.SnapshotRefused, "hashes to"):
            self.load()

    def test_grown_file_is_refused(self):
        with open(self.pq, "ab") as f:
            f.write(b"\n")
        with self.assertRaisesRegex(read.SnapshotRefused, "bytes"):
            self.load()

    def test_missing_file_is_refused(self):
        self.pq.unlink()
        with self.assertRaisesRegex(read.SnapshotRefused, "missing"):
            self.load()

    def test_cli_refuses_with_exit_1(self):
        with open(self.pq, "r+b") as f:
            f.seek(10)
            b = f.read(1)
            f.seek(10)
            f.write(bytes([b[0] ^ 0xFF]))
        self.assertEqual(read.main([SNAP, "--data-root", str(self.root), "--manifests", str(self.manifests)]), 1)
        self.assertEqual(read.main([SNAP, "--data-root", str(self.root), "--manifests", str(self.tmp / "nowhere")]), 1)


class TilingTest(unittest.TestCase):
    def test_tiles_are_on_eyes_grid(self):
        con = geo.connect()
        square = {"type": "Polygon", "coordinates": [[[-97.8, 30.2], [-97.3, 30.2], [-97.3, 30.6], [-97.8, 30.6], [-97.8, 30.2]]]}
        region = geo.Region(con, square, 0.05)
        tiles = [geo.cell_box(c, 0.02) for c in region.tiles(0.12, 0.02)]
        self.assertTrue(tiles)
        for w, s, e, n in tiles:
            self.assertAlmostEqual(e - w, 0.12, places=9)
            self.assertAlmostEqual(n - s, 0.12, places=9)
            for v in (w, s, e, n):
                self.assertAlmostEqual(round(v / 0.02), v / 0.02, places=6)
        self.assertEqual(region.near([("in", -97.5, 30.4), ("edge", -97.27, 30.4), ("out", -97.0, 30.4)]), {"in", "edge"})
        con.close()


if __name__ == "__main__":
    unittest.main()
