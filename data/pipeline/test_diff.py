"""Snapshot diff and the id-churn probe (data/pipeline/diff.py).

    python -m unittest discover -s data/pipeline -p "test_*.py"

Every removal between two snapshot days gets one of four reasons: publisher-status, our-rule, id-churn or
unknown. The fixture pair below is small records (the shape of record/1, only the fields diff.py reads),
and what each id must come to is written in EXPECT before diff runs. The probe tests use a stub fetcher and
a temporary raw cache, so they make no request. The report is checked by the Node validator
(`validate.mjs diff`), which is the schema's own, and tampered copies must fail it.
"""

from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import build
import diff
import net

M_PER_DEG = 111_320.0  # metres per degree of latitude, near enough for a 1 m test


def rec(i, refnum=None, lon=-86.0, lat=33.0, county=None, key="nris refnum"):
    d = {"resource type": "object"}
    if refnum is not None:
        d[key] = refnum
    place = {"stateFips": "01", "stateUsps": "AL", "method": "name-lookup"}
    if county:
        place.update(countyFips=county, method="point-in-polygon")
    return {"schemaVersion": "record/1", "id": i, "collection": "nrhp-listed", "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "place": place, "details": d, "snapshotId": "x"}


GAP = [
    {"id": "nrhp:pt:3", "reason": "NPS STATUS Removed: not a current listing, and eye asks only STATUS='Listed'"},
    {"id": "nrhp:pt:4", "reason": "left out by this snapshot's region rule: the source says Alabama but the point lies more than 0.05 degrees outside eye's outline"},
    {"id": "nrhp:pt:9", "reason": "the publisher files it under the state, but its own point lies more than 0.05 degrees outside eye's outline, so no tile asked for it"},
    {"id": "nrhp:pt:10", "reason": "the publisher files it under the state and its point is inside, but no tile of eye's answers held it"},
]


def pair():
    old = [
        rec("nrhp:pt:1", "111"),
        rec("nrhp:pt:2", "222"),
        rec("nrhp:pt:3", "333"),
        rec("nrhp:pt:4", "444"),
        rec("nrhp:pt:5", "555", lat=33.0),
        rec("nrhp:pt:6", "666", lat=34.0),
        rec("nrhp:pt:7", "777", lat=35.0),
        rec("nrhp:pt:9", "999", lat=36.0),
        rec("nrhp:pt:10", "1010", lat=37.0),
    ]
    new = [
        rec("nrhp:pt:1", "111"),
        rec("nrhp:pt:2", "222", county="01001"),                       # changed: the county join
        rec("nrhp:pt:50", "555", lat=33.0 + 0.5 / M_PER_DEG),          # 0.5 m from pt:5: its id changed
        rec("nrhp:pt:60", "666", lat=34.0 + 5.0 / M_PER_DEG),          # same key but 5 m away: not a match
        rec("nrhp:pt:8", "888", lat=38.0),                             # new
    ]
    return old, new


EXPECT = {
    "added": {"nrhp:pt:50": "id-churn", "nrhp:pt:60": "new", "nrhp:pt:8": "new"},
    "removed": {
        "nrhp:pt:3": "publisher-status",
        "nrhp:pt:4": "our-rule",
        "nrhp:pt:5": "id-churn",
        "nrhp:pt:6": "unknown",       # same key, but 5 m away
        "nrhp:pt:7": "unknown",       # nothing names it
        "nrhp:pt:9": "our-rule",
        "nrhp:pt:10": "unknown",      # the gap item says only that no tile held it: not a reason we can class
    },
    "changed": {"nrhp:pt:2": ["place.countyFips", "place.method"]},
}


class Compare(unittest.TestCase):
    def setUp(self):
        old, new = pair()
        self.c = diff.compare(old, new, "nrhp-listed", GAP)

    def test_added_removed_changed_with_reasons(self):
        self.assertEqual({a["id"]: a["reason"] for a in self.c["added"]}, EXPECT["added"])
        self.assertEqual({r["id"]: r["reason"] for r in self.c["removed"]}, EXPECT["removed"])
        self.assertEqual({x["id"]: x["fields"] for x in self.c["changed"]}, EXPECT["changed"])

    def test_lists_are_sorted_by_id(self):
        for k in ("added", "removed", "changed"):
            ids = [x["id"] for x in self.c[k]]
            self.assertEqual(ids, sorted(ids))

    def test_id_churn_names_the_key_the_new_id_and_the_distance(self):
        r = next(x for x in self.c["removed"] if x["id"] == "nrhp:pt:5")
        self.assertEqual(r["replacedBy"], "nrhp:pt:50")
        self.assertEqual(r["secondaryKey"], {"name": "nris refnum", "value": "555"})
        self.assertLessEqual(r["distanceM"], 1.0)
        a = next(x for x in self.c["added"] if x["id"] == "nrhp:pt:50")
        self.assertEqual(a["replaces"], "nrhp:pt:5")

    def test_unknown_says_why_and_never_guesses(self):
        for r in self.c["removed"]:
            if r["reason"] == "unknown":
                self.assertTrue(r["why"].strip())
        far = next(x for x in self.c["removed"] if x["id"] == "nrhp:pt:6")
        self.assertIn("1 m", far["why"])

    def test_identical_snapshots_have_no_difference(self):
        old, _ = pair()
        c = diff.compare(old, copy.deepcopy(old), "nrhp-listed", [])
        self.assertEqual((c["added"], c["removed"], c["changed"]), ([], [], []))

    def test_snapshot_id_alone_is_not_a_change(self):
        old, _ = pair()
        new = copy.deepcopy(old)
        for r in new:
            r["snapshotId"] = "y"
        self.assertEqual(diff.compare(old, new, "nrhp-listed", [])["changed"], [])

    def test_two_removals_cannot_claim_one_new_record(self):
        old = [rec("nrhp:pt:1", "5"), rec("nrhp:pt:2", "5")]
        new = [rec("nrhp:pt:3", "5")]
        c = diff.compare(old, new, "nrhp-listed", [])
        self.assertEqual({r["reason"] for r in c["removed"]}, {"unknown"})

    def test_a_non_point_geometry_is_not_matched(self):
        old = [rec("nrhp:pt:1", "5")]
        new = [rec("nrhp:pt:2", "5")]
        new[0]["geometry"] = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
        self.assertEqual(diff.compare(old, new, "nrhp-listed", [])["removed"][0]["reason"], "unknown")

    def test_each_collection_uses_its_own_secondary_key(self):
        for coll, key in (("nrhp-listed", "nris refnum"), ("nid-dams", "NID id"), ("nces-public-schools", "NCES school id")):
            old = [rec("a:1", "K1", key=key)]
            new = [rec("a:2", "K1", key=key)]
            r = diff.compare(old, new, coll, [])["removed"][0]
            self.assertEqual((r["reason"], r["secondaryKey"]["name"]), ("id-churn", key), coll)

    def test_a_key_the_collection_does_not_use_is_unknown(self):
        old = [rec("a:1", "K1", key="NID id")]
        new = [rec("a:2", "K1", key="NID id")]
        self.assertEqual(diff.compare(old, new, "nrhp-listed", [])["removed"][0]["reason"], "unknown")

    def test_unrecognised_gap_reasons_are_not_classed(self):
        for gi in GAP[2:]:
            self.assertIsNone(diff.reason_of_gap(gi["reason"]) if gi["id"] == "nrhp:pt:10" else None)
        self.assertEqual(diff.reason_of_gap(GAP[0]["reason"]), "publisher-status")
        self.assertEqual(diff.reason_of_gap("NCES status Inactive: not operating in 2024-25, and eye does not draw it"), "publisher-status")
        self.assertEqual(diff.reason_of_gap(GAP[1]["reason"]), "our-rule")


def manifests():
    """Two manifests as build.py writes them, just the fields diff reads."""
    base = {"schemaVersion": "manifest/1", "collection": "nrhp-listed", "region": {"id": "alabama"}, "recordCount": 0}
    old = {**base, "snapshotId": "nrhp-listed.alabama.2026-10-19", "createdAt": "2026-10-19T22:00:00Z",
           "publisherCount": {"value": 9, "gap": "prose only"}}
    new = {**base, "snapshotId": "nrhp-listed.alabama.2026-10-20", "createdAt": "2026-10-20T06:00:00Z",
           "publisherCount": {"value": 9, "gapItems": GAP, "duplicateRows": 0}}
    return old, new


class Report(unittest.TestCase):
    def report(self):
        old, new = pair()
        mo, mn = manifests()
        mo["recordCount"], mn["recordCount"] = len(old), len(new)
        return diff.build_report(mo, mn, old, new)

    def validate(self, doc):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "diff.json"
            p.write_text(json.dumps(doc), "utf8")
            return build.node("diff", str(p))

    def test_the_report_passes_the_validator(self):
        v = self.validate(self.report())
        self.assertEqual(v.returncode, 0, v.stdout + v.stderr)

    def test_counts_add_up(self):
        r = self.report()
        self.assertEqual(r["counts"]["removed"], 7)
        self.assertEqual(r["counts"]["removedByReason"], {"publisher-status": 1, "our-rule": 2, "id-churn": 1, "unknown": 3})
        self.assertEqual(r["counts"]["added"], 3)
        self.assertEqual(r["counts"]["changed"], 1)
        self.assertEqual(r["counts"]["unchanged"], 1)
        self.assertEqual(r["from"]["snapshotId"], "nrhp-listed.alabama.2026-10-19")
        self.assertEqual(r["collection"], "nrhp-listed")

    def test_different_collections_or_regions_are_refused(self):
        old, new = pair()
        mo, mn = manifests()
        mn["region"] = {"id": "texas"}
        with self.assertRaises(diff.DiffRefused):
            diff.build_report(mo, mn, old, new)
        mo, mn = manifests()
        mn["collection"] = "nid-dams"
        with self.assertRaises(diff.DiffRefused):
            diff.build_report(mo, mn, old, new)

    def test_tampered_reports_fail_the_validator(self):
        base = self.report()

        def bent(f):
            d = copy.deepcopy(base)
            f(d)
            return d

        cases = {
            "a removal count that disagrees with the list": lambda d: d["counts"].__setitem__("removed", 99),
            "by-reason counts that disagree": lambda d: d["counts"]["removedByReason"].__setitem__("unknown", 0),
            "a reason outside the four": lambda d: d["removed"][0].__setitem__("reason", "weather"),
            "an unknown with no why": lambda d: next(r for r in d["removed"] if r["reason"] == "unknown").pop("why"),
            "an id-churn with no replacement": lambda d: next(r for r in d["removed"] if r["reason"] == "id-churn").pop("replacedBy"),
            "an id-churn farther than 1 m": lambda d: next(r for r in d["removed"] if r["reason"] == "id-churn").__setitem__("distanceM", 5.0),
            "a removed id listed twice": lambda d: d["removed"].append(copy.deepcopy(d["removed"][0])),
            "a field the schema does not know": lambda d: d.__setitem__("note", "hand-edited"),
        }
        for why, f in cases.items():
            v = self.validate(bent(f))
            self.assertEqual(v.returncode, 1, f"{why} should fail:\n{v.stdout}")


URL = "https://example.invalid/arcgis/rest/services/x/MapServer/0/query?where=State%3D%27ALABAMA%27&outFields=OBJECTID,STATUS&returnGeometry=true&outSR=4326&orderByFields=OBJECTID&resultOffset=0&resultRecordCount=2000&f=json"


def body(ids, exceeded=False, status="Listed"):
    return json.dumps({"features": [{"attributes": {"OBJECTID": i, "STATUS": status}, "geometry": {"x": -86.0, "y": 33.0}} for i in ids],
                       "exceededTransferLimit": exceeded}).encode("utf8")


def pinned(raw: Path, ids):
    """A raw cache with one gap response in it, as net.Fetcher writes it, and the manifest that names it."""
    b = body(ids)
    k = hashlib.sha256(URL.encode("utf8")).hexdigest()
    sha = hashlib.sha256(b).hexdigest()
    (raw / f"{k}.body").write_bytes(b)
    (raw / f"{k}.json").write_text(json.dumps({"url": URL, "status": 200, "retrievedAt": "2026-10-19T23:00:41.485Z", "bytes": len(b), "sha256": sha}), "utf8")
    return {"snapshotId": "nrhp-listed.alabama.2026-10-19", "requests": [
        {"purpose": "region", "url": "https://example.invalid/region", "status": 200, "retrievedAt": "2026-10-18T00:00:00Z", "bytes": 1, "sha256": "0" * 64},
        {"purpose": "gap", "url": URL, "status": 200, "retrievedAt": "2026-10-19T23:00:41.485Z", "bytes": len(b), "sha256": sha},
        {"purpose": "gap", "url": URL + "&second=1", "status": 200, "retrievedAt": "2026-10-19T23:00:42.485Z", "bytes": 1, "sha256": "1" * 64},
    ]}


class Stub:
    """Stands in for net.Fetcher on the live path: counts requests, never touches a network."""

    def __init__(self, b):
        self.b, self.network, self.urls, self.log = b, 0, [], []

    def get(self, url, purpose):
        self.network += 1
        self.urls.append(url)
        self.log.append({"purpose": purpose, "url": url, "status": 200, "retrievedAt": "2026-10-20T12:00:00.000Z", "bytes": len(self.b),
                         "sha256": hashlib.sha256(self.b).hexdigest()})
        return self.b


class Probe(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.raw = Path(self._t.name)
        self.m = pinned(self.raw, [1, 2, 3, 4])

    def tearDown(self):
        self._t.cleanup()

    def test_offline_reports_zero_churn_against_its_own_cached_body(self):
        r = diff.probe(self.m, self.raw, offline=True)
        self.assertEqual(r["churn_rate"], 0.0)
        self.assertEqual((r["removed"], r["added"], r["pinned"]["ids"], r["fresh"]["ids"]), ([], [], 4, 4))
        self.assertEqual(r["requests"], 0)
        self.assertTrue(r["offline"])
        self.assertEqual(r["pinned"]["sha256"], r["fresh"]["sha256"])

    def test_probe_uses_the_manifests_first_gap_request_url_unchanged(self):
        r = diff.probe(self.m, self.raw, offline=True)
        self.assertEqual(r["url"], URL)

    def test_a_cached_body_that_no_longer_matches_the_manifest_is_refused(self):
        k = hashlib.sha256(URL.encode("utf8")).hexdigest()
        (self.raw / f"{k}.body").write_bytes(body([1, 2, 3, 5]))
        with self.assertRaises(diff.ProbeRefused):
            diff.probe(self.m, self.raw, offline=True)

    def test_a_missing_pinned_body_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(diff.ProbeRefused):
                diff.probe(self.m, Path(d), offline=True)

    def test_a_manifest_with_no_gap_request_is_refused(self):
        m = {**self.m, "requests": [r for r in self.m["requests"] if r["purpose"] != "gap"]}
        with self.assertRaises(diff.ProbeRefused):
            diff.probe(m, self.raw, offline=True)

    def test_live_churn_is_removed_plus_added_over_the_union(self):
        stub = Stub(body([1, 2, 3, 5]))
        r = diff.probe(self.m, self.raw, offline=False, fetcher=stub)
        self.assertEqual(stub.urls, [URL])
        self.assertEqual((r["removed"], r["added"]), ([4], [5]))
        self.assertAlmostEqual(r["churn_rate"], 2 / 5)
        self.assertEqual(r["requests"], 1)
        self.assertFalse(r["offline"])
        self.assertNotEqual(r["pinned"]["sha256"], r["fresh"]["sha256"])

    def test_live_with_the_same_ids_is_zero_churn(self):
        r = diff.probe(self.m, self.raw, offline=False, fetcher=Stub(body([4, 3, 2, 1])))
        self.assertEqual(r["churn_rate"], 0.0)

    def test_status_changes_on_shared_ids_are_counted_apart(self):
        r = diff.probe(self.m, self.raw, offline=False, fetcher=Stub(body([1, 2, 3, 4], status="Removed")))
        self.assertEqual(r["churn_rate"], 0.0)
        self.assertEqual(r["statusChanged"], 4)

    def test_a_truncated_live_answer_is_reported_incomplete_and_no_second_request_is_made(self):
        stub = Stub(body([1, 2, 3], exceeded=True))
        r = diff.probe(self.m, self.raw, offline=False, fetcher=stub)
        self.assertEqual(stub.network, 1)
        self.assertFalse(r["complete"])
        self.assertIsNone(r["churn_rate"])

    def test_the_real_fetcher_is_capped_at_two_requests_and_declares_its_user_agent(self):
        f = diff.live_fetcher(self.raw)
        self.assertIsInstance(f, net.Fetcher)
        self.assertLessEqual(f.tries, 2)
        self.assertFalse(f.offline)
        self.assertNotEqual(f.raw, self.raw, "the live body must not be written into the pinned raw cache")
        self.assertIn("groundtruth", net.UA)


if __name__ == "__main__":
    unittest.main()
