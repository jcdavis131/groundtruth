"""County joins: real geometry only.

    python -m unittest discover -s data/pipeline -p "test_*.py"

The boundary is a small real cut of Census TIGER/Line 2025 COUNTY (data/schema/fixtures/boundaries/: a few real
county polygons, with the source zip's URL and sha256, the GEOIDs cut and the cut's own sha256 in a sidecar). The
records are real ones from the 2026-10-19 Texas snapshots (join-records.jsonl). What each must come to is
written in join-cases.json before the join runs: placement, method, and the manifest entry. No polygon was
drawn by hand. The DuckDB spatial extension is loaded at runtime, as test_read.py does.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import boundaries
import build
import cards
import geo
import join
import read

REPO = Path(__file__).resolve().parents[2]
FIX = REPO / "data" / "schema" / "fixtures"
BND = FIX / "boundaries"
SUBSET = BND / "counties-subset.geojson"
SIDECAR = BND / "counties-subset.json"
RECORDS = BND / "join-records.jsonl"
CASES = json.loads((BND / "join-cases.json").read_text("utf8"))
SHARED = json.loads((REPO / "apps" / "map" / "lib" / "places" / "countyJoin.cases.json").read_text("utf8"))
BOUNDARY = {
    "publisher": "U.S. Census Bureau",
    "product": "TIGER/Line 2025 COUNTY",
    "vintage": "2025",
    "url": boundaries.URL,
    "sha256": "0" * 63 + "1",
    "retrievedAt": "2026-10-20T05:50:00.000Z",
}


def sha(p: Path) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def load_records() -> list[dict]:
    return [json.loads(line) for line in RECORDS.read_text("utf8").splitlines() if line]


class SharedCasesTest(unittest.TestCase):
    """apps/map/lib/places/countyJoin.cases.json is read by countyJoin.test.ts too, so the two can't drift."""

    @classmethod
    def setUpClass(cls):
        cls.ix = join.name_index()

    def test_the_typescript_test_reads_the_same_file(self):
        ts = (REPO / "apps" / "map" / "lib" / "places" / "countyJoin.test.ts").read_text("utf8")
        self.assertIn("countyJoin.cases.json", ts)

    def test_norm(self):
        self.assertGreaterEqual(len(SHARED["norm"]), 10)
        for c in SHARED["norm"]:
            self.assertEqual(join.norm(c["input"]), c["expected"], c["input"])

    def test_join_name(self):
        self.assertGreaterEqual(len(SHARED["joinName"]), 30)
        for c in SHARED["joinName"]:
            r = join.join_name(self.ix, c["state"], c["county"])
            got = {"geoid": r["geoid"], "reason": r["reason"], "candidates": sorted(r["candidates"]) if r["candidates"] is not None else None}
            self.assertEqual(got, {"geoid": c["geoid"], "reason": c["reason"], "candidates": c["candidates"]}, json.dumps([c["state"], c["county"]]))


class PublisherCountyTest(unittest.TestCase):
    def test_nid_writes_county_comma_state(self):
        r = {"collection": "nid-dams", "details": {"county": "Harris, Texas"}}
        self.assertEqual(join.publisher_county(r, "Texas"), ("name", "Harris"))

    def test_a_state_suffix_naming_another_state_is_kept_for_the_name_rule(self):
        r = {"collection": "nid-dams", "details": {"county": "Harmon, Oklahoma"}}
        self.assertEqual(join.publisher_county(r, "Texas"), ("name", "Harmon, Oklahoma"))

    def test_nps_writes_the_bare_name(self):
        self.assertEqual(join.publisher_county({"collection": "nrhp-listed", "details": {"county": "Kendall"}}, "Texas"), ("name", "Kendall"))

    def test_nces_writes_a_code(self):
        r = {"collection": "nces-public-schools", "details": {"county": "Travis County (48453)"}}
        self.assertEqual(join.publisher_county(r, "Texas"), ("code", "48453"))

    def test_absent_means_absent(self):
        self.assertEqual(join.publisher_county({"collection": "nid-dams", "details": {}}, "Texas"), (None, None))
        self.assertEqual(join.publisher_county({"collection": "nid-dams", "details": {"county": "  "}}, "Texas"), (None, None))


class RealGeometryTest(unittest.TestCase):
    """Real county polygons cut from the TIGER/Line 2025 file, and real records from the Texas snapshots."""

    @classmethod
    def setUpClass(cls):
        cls.con = geo.connect()
        cls.count = boundaries.load_subset(cls.con, SUBSET)
        cls.ix = join.name_index()
        cls.records = load_records()
        cls.by_id = {r["id"]: r for r in cls.records}
        cls.out, cls.block = join.join_records(cls.con, cls.records, cls.ix, BOUNDARY, "Texas")
        cls.placed = {r["id"]: r for r in cls.out}

    def test_the_fixture_is_a_sha_recorded_cut_of_the_real_file(self):
        side = json.loads(SIDECAR.read_text("utf8"))
        self.assertEqual(side["source"]["url"], boundaries.URL)
        self.assertRegex(side["source"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(side["subset"]["sha256"], sha(SUBSET))
        self.assertEqual(sorted(side["geoids"]), sorted(r[0] for r in self.con.execute("SELECT GEOID FROM county_2025").fetchall()))
        self.assertLessEqual(SUBSET.stat().st_size, 5 * 1024 * 1024)
        self.assertGreaterEqual(self.count, 2)
        self.assertLessEqual(self.count, 3)

    def test_each_pre_stated_case(self):
        self.assertGreaterEqual(len(CASES["cases"]), 4)
        for c in CASES["cases"]:
            with self.subTest(c["id"], why=c["why"]):
                r = self.placed[c["id"]]
                e = c["expect"]
                self.assertEqual(r["place"].get("countyFips"), e["countyFips"])
                self.assertEqual(r["place"]["method"], e["method"])
                un = [u for u in self.block["unplaced"] if u["id"] == c["id"]]
                dis = [d for d in self.block["disagreements"] if d["id"] == c["id"]]
                if e.get("unplacedReasonStartsWith"):
                    self.assertEqual(len(un), 1)
                    self.assertTrue(un[0]["reason"].startswith(e["unplacedReasonStartsWith"]), un[0]["reason"])
                    self.assertIn(e["unplacedReasonEndsWith"], un[0]["reason"])
                else:
                    self.assertEqual(un, [])
                self.assertEqual(dis, [e["disagreement"]] if e.get("disagreement") else [])

    def test_the_cases_cover_the_three_hard_ones(self):
        kinds = {k for c in CASES["cases"] for k in c["kinds"]}
        self.assertTrue({"county-line", "no-polygon-within-tolerance", "name-disagrees", "unplaced-with-reason", "control-source-field"} <= kinds, kinds)

    def test_an_unplaced_record_has_no_county_and_no_reason_on_the_record(self):
        for u in self.block["unplaced"]:
            r = self.placed[u["id"]]
            self.assertNotIn("countyFips", r["place"])
            self.assertNotIn("reason", json.dumps(r["place"]))
            self.assertTrue(u["reason"].strip())

    def test_the_block_adds_up(self):
        b = self.block
        self.assertEqual(b["placed"] + len(b["unplaced"]), len(self.records))
        self.assertEqual(sum(b["methods"].values()), b["placed"])
        cc = b["crossCheck"]
        self.assertEqual(cc["agree"] + cc["disagree"] + cc["unchecked"], len(self.records))
        self.assertEqual(cc["disagree"], len(b["disagreements"]))
        self.assertEqual(b["boundary"], BOUNDARY)

    def test_every_county_written_is_in_counties_json(self):
        for r in self.out:
            if r["place"].get("countyFips"):
                self.assertIn(r["place"]["countyFips"], self.ix.geoids)
                self.assertTrue(r["place"]["countyFips"].startswith(r["place"]["stateFips"]))

    def test_the_input_records_are_not_changed_and_other_fields_are_untouched(self):
        for r in self.out:
            before = self.by_id[r["id"]]
            self.assertEqual({k: v for k, v in r.items() if k != "place"}, {k: v for k, v in before.items() if k != "place"})

    def test_a_missing_publisher_county_is_unchecked_not_agreed(self):
        # A real record no polygon contains, with its county string taken away: nothing can place it.
        outside = [c for c in CASES["cases"] if "no-polygon-within-tolerance" in c["kinds"]][0]
        r = json.loads(json.dumps(self.by_id[outside["id"]]))
        r["details"].pop("county", None)
        out, block = join.join_records(self.con, [r], self.ix, BOUNDARY, "Texas")
        self.assertNotIn("countyFips", out[0]["place"])
        self.assertEqual(block["placed"], 0)
        self.assertTrue(block["unplaced"][0]["reason"].endswith("publisher county string absent"), block["unplaced"][0]["reason"])
        self.assertEqual(block["crossCheck"], {"source": block["crossCheck"]["source"], "agree": 0, "disagree": 0, "unchecked": 1})

    def test_two_runs_write_byte_identical_parquet(self):
        d = Path(tempfile.mkdtemp(prefix="gt-join-"))
        try:
            shas = []
            for n in (1, 2):
                con = geo.connect()
                boundaries.load_subset(con, SUBSET)
                out, _ = join.join_records(con, load_records(), self.ix, BOUNDARY, "Texas")
                geo.write_geoparquet(con, out, d / f"{n}.parquet")
                shas.append(sha(d / f"{n}.parquet"))
            self.assertEqual(shas[0], shas[1])
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_a_point_in_two_polygons_is_not_placed_in_either(self):
        # Two overlapping polygons that are only there to test the tie rule (no real county pair overlaps).
        con = geo.connect()
        con.execute("CREATE TABLE county_2025 AS SELECT * FROM (VALUES ('01001','A',ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))')),('01002','B',ST_GeomFromText('POLYGON((1 1,3 1,3 3,1 3,1 1))'))) t(GEOID,NAME,geom)")
        self.assertEqual(join.point_in_polygon(con, [("p", "01", 1.5, 1.5), ("q", "01", 0.5, 0.5), ("r", "01", 5.0, 5.0), ("s", "02", 0.5, 0.5)]), {"p": ["01001", "01002"], "q": ["01001"], "r": [], "s": []})


class GapAndReadTest(unittest.TestCase):
    def test_read_refuses_a_joins_block_the_rows_do_not_bear_out(self):
        rows = load_records()
        for r in rows:
            r["place"] = {k: v for k, v in r["place"].items() if k != "countyFips"}
        m = {"joins": [{"placed": 0, "unplaced": [{"id": r["id"], "reason": "x"} for r in rows], "methods": {"point-in-polygon": 0, "source-field": 0, "name-lookup": 0}}]}
        read._check_joins(m, rows)  # consistent: passes
        m["joins"][0]["unplaced"] = m["joins"][0]["unplaced"][1:]
        with self.assertRaises(read.SnapshotRefused):
            read._check_joins(m, rows)
        m["joins"][0]["unplaced"] = [{"id": "nid:NOPE", "reason": "x"}] + [{"id": r["id"], "reason": "x"} for r in rows]
        with self.assertRaises(read.SnapshotRefused):
            read._check_joins(m, rows)

    def test_a_manifest_without_joins_is_not_checked(self):
        read._check_joins({}, load_records())


class BoundaryFileTest(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="gt-bnd-"))
        self.zip = self.d / boundaries.FILE
        self.zip.write_bytes(b"not a real zip, just bytes to hash")
        self.side = self.d / (boundaries.FILE + ".json")
        self.meta = {"url": boundaries.URL, "retrievedAt": "2026-10-20T05:50:00.000Z", "bytes": self.zip.stat().st_size, "sha256": sha(self.zip)}

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_a_file_that_hashes_to_its_sidecar_is_accepted(self):
        self.side.write_text(json.dumps(self.meta), "utf8")
        self.assertEqual(boundaries.verify(self.zip), self.meta)
        self.assertEqual(boundaries.boundary_block(self.meta)["sha256"], self.meta["sha256"])

    def test_a_different_sha_is_refused(self):
        self.side.write_text(json.dumps({**self.meta, "sha256": "0" * 64}), "utf8")
        with self.assertRaises(boundaries.BoundaryRefused):
            boundaries.verify(self.zip)

    def test_a_changed_file_is_refused(self):
        self.side.write_text(json.dumps(self.meta), "utf8")
        self.zip.write_bytes(self.zip.read_bytes() + b"x")
        with self.assertRaises(boundaries.BoundaryRefused):
            boundaries.verify(self.zip)

    def test_no_sidecar_is_refused(self):
        with self.assertRaises(boundaries.BoundaryRefused):
            boundaries.verify(self.zip)

    def test_offline_never_downloads(self):
        with self.assertRaises(boundaries.BoundaryRefused):
            boundaries.ensure(self.d / "empty-root", offline=True)


class BuilderTest(unittest.TestCase):
    def test_every_collection_names_a_secondary_key_a_record_carries(self):
        want = {"nid-dams": ("NIDID", "NID id"), "nces-public-schools": ("NCESSCH", "NCES school id"), "nrhp-listed": ("NRIS_Refnum", "nris refnum")}
        for c, (field, detail) in want.items():
            self.assertEqual(cards.COLLECTIONS[c]["secondaryKey"], {"publisherField": field, "detailKey": detail})
        valid = FIX / "record" / "valid"
        for f in valid.glob("*.json"):
            r = json.loads(f.read_text("utf8"))
            self.assertIn(cards.COLLECTIONS[r["collection"]]["secondaryKey"]["detailKey"], r["details"], f.name)

    def test_the_manifest_writer_keeps_long_lists_one_entry_per_line_and_round_trips(self):
        m = {
            "requests": [{"a": 1}, {"a": 2}],
            "publisherCount": {"value": 3, "gapItems": [{"id": "x:1", "reason": "r"}]},
            "joins": [{"field": "place.countyFips", "unplaced": [{"id": "x:2", "reason": "r"}], "disagreements": []}],
        }
        text = build.dump_manifest(m)
        self.assertEqual(json.loads(text), m)
        self.assertIn('\n      {"id": "x:1", "reason": "r"}\n', text)
        self.assertIn('\n        {"id": "x:2", "reason": "r"}\n', text)
        self.assertIn('"disagreements": []', text)
        self.assertTrue(text.endswith("}\n"))


if __name__ == "__main__":
    unittest.main()
