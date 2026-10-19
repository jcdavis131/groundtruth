"""The dam name rule matches eye's damIsNamed, and a dam eye named but the rule labels by id loses its name.

    python -m unittest discover -s data/pipeline -p "test_*.py"

No network. The record rows are the spec's own fixtures (data/schema/fixtures/record/valid/).
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import build
import cards

REPO = Path(__file__).resolve().parents[2]
PUBLIC_DAM = json.loads((REPO / "data" / "schema" / "fixtures" / "record" / "valid" / "nid-dams.texas-public.json").read_text("utf8"))
CFG = cards.COLLECTIONS["nid-dams"]


def eye_feature(owner_type, owner_types=None, name="Bardwell Dam"):
    """The public dam fixture as eye's LayerFeature, with its owner fields set."""
    details = {**PUBLIC_DAM["details"]}
    if owner_type is None:
        details.pop("owner type", None)
    else:
        details["owner type"] = owner_type
    if owner_types is not None:
        details["owner types"] = owner_types
    props = {"id": PUBLIC_DAM["id"], "layer": "dams", "name": name, "kind": PUBLIC_DAM["kind"], "details": details, "extra": {"embedText": PUBLIC_DAM["text"]}}
    env = {"provenance": [{"source": {"id": "usace-nid", "name": "NID", "publisher": "USACE", "license": "public domain"}, "upstreamUrl": "https://example.invalid", "retrievedAt": "2026-10-18T23:07:35.318Z", "kind": "published"}]}
    return {"type": "Feature", "geometry": PUBLIC_DAM["geometry"], "properties": props}, env


class DamNameRuleTest(unittest.TestCase):
    def test_public_owner_types_keep_the_name(self):
        for t in ["Federal", "State", "Local Government", "Public Utility", "Tribal Government"]:
            self.assertEqual(cards.dam_name_rule({"owner type": t, "owner types": t}), "public-name", t)
            # No owner-types list (a stale tile, or eye before it asked NID for it) can't show every owner is public.
            self.assertEqual(cards.dam_name_rule({"owner type": t}), "label-by-id", t)
        self.assertEqual(cards.dam_name_rule({"owner type": "State", "owner types": "Local Government, State"}), "public-name")

    def test_non_answers_and_private_are_labelled_by_id(self):
        for d in [
            {"owner type": "Not Listed"},
            {"owner type": "not listed "},
            {},
            {"owner type": ""},
            {"owner type": "Private"},
            {"owner type": "Unknown"},
            {"owner type": "Local Government", "owner types": "Local Government, Private"},
            {"owner type": "Local Government", "owner types": "Private"},
            {"owner type": "Federal", "owner types": ""},
            {"owner type": "Federal", "owner types": None},
            {"owner type": "State", "owner types": "State, Not Listed"},
        ]:
            self.assertEqual(cards.dam_name_rule(d), "label-by-id", d)

    def test_a_not_listed_dam_eye_named_is_relabelled_and_its_name_leaves_the_text(self):
        build.to_record.relabelled = 0
        f, env = eye_feature("Not Listed")
        r = build.to_record(f, env, CFG, "nid-dams", PUBLIC_DAM["place"], PUBLIC_DAM["snapshotId"])
        self.assertEqual(r["nameRule"], "label-by-id")
        self.assertEqual(r["name"], "Dam TX00001")
        self.assertNotIn("Bardwell", r["text"])
        self.assertNotIn("name: ", r["text"])
        self.assertNotIn("published name", r["details"])
        self.assertEqual(build.to_record.relabelled, 1)

    def test_a_dam_eye_labels_by_id_is_never_public_name(self):
        build.to_record.relabelled = 0
        f, env = eye_feature("Federal", name="Dam TX00001")
        f["properties"]["extra"]["embedText"] = PUBLIC_DAM["text"].replace("; name: Bardwell Dam", "")
        r = build.to_record(f, env, CFG, "nid-dams", PUBLIC_DAM["place"], PUBLIC_DAM["snapshotId"])
        self.assertEqual(r["nameRule"], "label-by-id")
        self.assertEqual(build.to_record.relabelled, 0)

    def test_a_public_dam_keeps_its_name(self):
        f, env = eye_feature("Federal", "Federal")
        r = build.to_record(f, env, CFG, "nid-dams", PUBLIC_DAM["place"], PUBLIC_DAM["snapshotId"])
        self.assertEqual((r["nameRule"], r["name"]), ("public-name", "Bardwell Dam"))
        self.assertIn("name: Bardwell Dam", r["text"])


class DamRuleParityTest(unittest.TestCase):
    """The same case table the validator and eye read (data/schema/fixtures/dam-owner-cases.json): every owner pair
    NID publishes plus edge cases. dam_name_rule must agree with "named" on every one."""

    def test_every_case(self):
        doc = json.loads((REPO / "data" / "schema" / "fixtures" / "dam-owner-cases.json").read_text("utf8"))
        for c in doc["cases"]:
            details = {"owner type": c["primary"]}
            if not c.get("absent"):
                details["owner types"] = c["ownerTypes"]
            want = "public-name" if c["named"] else "label-by-id"
            self.assertEqual(cards.dam_name_rule(details), want, c)


if __name__ == "__main__":
    unittest.main()
