"""Self-test for eval/score.py. Standard library only, no network.

    python -I eval/test_score.py

The gold values are real recorded replies, copied from apps/map/lib/mcp/__fixtures__/world/, each from the publisher named in the reply's
provenance. Recording provenance, as each fixture's own header says: ct_09110.json "recorded"
2026-10-19T02:31:52.721Z, "from" "https://www.arxiviq.com"; mobile_01097.json 2026-10-19T02:32:03.493Z,
"https://www.arxiviq.com"; pr_72127.json 2026-10-19T02:32:29.848Z, "https://www.arxiviq.com"; chugach_02063.json
2026-10-19T02:41:22.335Z, "the PR preview deployment of this branch" (not www.arxiviq.com):

  g1  NRI RISK_RATNG for county 09110      "Relatively High"    ct_09110.json, /api/hazards?op=nri&fips=09110
  g2  QCEW jobs.emp for county 01097       177202               mobile_01097.json, /api/screen?kind=county
  g3  GEOID of Chugach Census Area         "02063"              chugach_02063.json, /api/screen?kind=county
  g4  NRI RISK_RATNG for county 72127      "Insufficient Data"  pr_72127.json: the publisher's own flag, so NOT_PUBLISHED
  g5  states of the four fixture counties  AK, AL, CT, PR       the state field of the four screen rows
  g6  NRI EAL_VALT for county 09110        302299864.61157477   ct_09110.json, with a declared tolerance of 1 USD

Substitution, stated plainly: the brief asks for fixtures from the publisher records themselves (B1's
__fixtures__/publisher). B1 is not on master, so these are our own route's rendering of the publisher row, one hop
removed. Once B1 lands, add or re-point at least one fixture drawn from a publisher record itself.

The expected numbers below are worked by hand (see the comment above each test), not read back from score.py.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCORE = os.path.join(HERE, "score.py")
MARKER = "-".join(["groundtruth", "eval", "gold", "v1"])

GOLD = {
    "marker": MARKER,
    "items": {
        "g1": {"type": "exact", "verdict": "PUBLISHED", "gold": "Relatively High", "url": "https://hazards.fema.gov/nri/"},
        "g2": {"type": "number", "tolerance": 0, "verdict": "PUBLISHED", "gold": 177202, "url": "https://www.bls.gov/cew/"},
        "g3": {"type": "exact", "verdict": "PUBLISHED", "gold": "02063", "url": "https://tigerweb.geo.census.gov/"},
        "g4": {"type": "exact", "verdict": "NOT_PUBLISHED", "gold": None, "flag": "Insufficient Data", "url": "https://hazards.fema.gov/nri/"},
        "g5": {"type": "list", "verdict": "PUBLISHED", "gold": ["AK", "AL", "CT", "PR"], "url": "https://tigerweb.geo.census.gov/"},
    },
}


def ans(answer, status="answered", citation="https://example.invalid/record"):
    return {"answer": answer, "status": status, "citation": citation}


ARM_A = {
    "arm": "A",
    "runs": {
        "r1": {"answers": {
            "g1": ans("Relatively High"), "g2": ans(177000), "g3": ans("02063"),
            "g4": ans("Relatively Low"), "g5": ans(["AK", "AL"]),
        }},
        "r2": {
            "answers": {
                "g1": ans("Very High"), "g2": ans(177202), "g3": ans(None, "unknown", None),
                "g4": ans(None, "not_published", None),
            },
            "errors": {"g5": "timeout"},
        },
    },
}
ARM_B = {
    "arm": "B",
    "runs": {
        "r1": {"answers": {
            "g1": ans("Relatively High"), "g2": ans("177,202"), "g3": ans(" 02063 "),
            "g4": ans(None, "not_published", None), "g5": ans(["CT", "PR", "AK", "AL"]),
        }},
        "r2": {"error": "RAM kill"},
        "r3": {"answers": {
            "g1": ans("Relatively High"), "g2": ans(None, "not_published", None), "g3": ans("02063"),
            "g4": ans("Relatively Low"),
        }},
    },
}


def clone(o):
    return json.loads(json.dumps(o))


def run(*args):
    return subprocess.run([sys.executable, "-I", SCORE, *args], capture_output=True, text=True)


def score(gold=GOLD, a=ARM_A, b=ARM_B, extra=()):
    d = tempfile.mkdtemp(prefix="score-")
    paths = []
    for name, obj in (("g.json", gold), ("a.json", a), ("b.json", b)):
        p = os.path.join(d, name)
        with open(p, "w", encoding="utf8") as f:
            json.dump(obj, f)
        paths.append(p)
    return run("--gold", paths[0], "--arm", paths[1], "--arm", paths[2], *extra)


class ScoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = score()
        assert cls.r.returncode == 0, cls.r.stderr
        cls.out = json.loads(cls.r.stdout)

    # Hand work, arm A. Credits: r1 g1 1, g2 0, g3 1, g4 0 (false fill), g5 F1 of {AK,AL} against 4 = 2*2/(2+4) = 2/3.
    # r2 g1 0, g2 1, g3 unknown (abstain, 0), g4 not_published on a NOT_PUBLISHED item (+1); g5 errored, unscored.
    # Scored item-runs 9; answered 7; coverage 7/9 = 0.777778; credit on answered 1+0+1+0+2/3+0+1 = 11/3,
    # selective accuracy (11/3)/7 = 0.523810; NOT_PUBLISHED item-runs 2 (g4 r1, r2), one answered: false-fill 0.5.
    def test_arm_a_counts(self):
        a = self.out["arms"]["A"]
        self.assertEqual(a["scored_item_runs"], 9)
        self.assertEqual(a["answered"], 7)
        self.assertEqual(a["coverage"], 0.777778)
        self.assertEqual(a["selective_accuracy"], 0.52381)
        self.assertEqual(a["false_fill_rate"], 0.5)

    # Per-item mean over replicates, then mean over the 5 items. A: g1 (1-k)/2, g2 (1-k)/2, g3 (1+0)/2, g4 (1-k)/2,
    # g5 (2/3 - k/3) from its one scored run. Sum = 8/3 - 11k/6, Q(k) = that / 5:
    # k=1 5/30 = 0.166667, k=2 -6/30 = -0.2, k=4 -28/30 = -0.933333, k=9 -83/30 = -2.766667.
    def test_arm_a_q(self):
        self.assertEqual(self.out["arms"]["A"]["Q"], {"1": 0.166667, "2": -0.2, "4": -0.933333, "9": -2.766667})

    # Arm B: r2 is an errored run, g5 is missing from r3. Scored item-runs: r1 5, r3 4 = 9. Answered r1 g1 g2 g3 g5 = 4,
    # r3 g1 g3 g4 = 3, so 7 and coverage 0.777778. Credit on answered 4 + (1+1+0) = 6, selective accuracy 6/7 = 0.857143.
    # NOT_PUBLISHED item-runs: g4 r1 (abstained), g4 r3 (answered): false-fill 0.5.
    def test_arm_b_counts(self):
        b = self.out["arms"]["B"]
        self.assertEqual(b["scored_item_runs"], 9)
        self.assertEqual(b["answered"], 7)
        self.assertEqual(b["coverage"], 0.777778)
        self.assertEqual(b["selective_accuracy"], 0.857143)
        self.assertEqual(b["false_fill_rate"], 0.5)

    # B per item: g1 1, g2 (1+0)/2, g3 1, g4 (1-k)/2, g5 1. Sum = 4 - k/2, Q(k) = that / 5:
    # k=1 0.7, k=2 0.6, k=4 0.4, k=9 -0.1.
    def test_arm_b_q(self):
        self.assertEqual(self.out["arms"]["B"]["Q"], {"1": 0.7, "2": 0.6, "4": 0.4, "9": -0.1})

    # Paired difference B - A over the 5 paired items is the difference of the two Q rows:
    # k=1 0.533333, k=2 0.8, k=4 1.333333, k=9 2.666667.
    def test_paired_means(self):
        d = self.out["paired"]["diff_B_minus_A"]
        self.assertEqual({k: d[k]["mean"] for k in d}, {"1": 0.533333, "2": 0.8, "4": 1.333333, "9": 2.666667})
        self.assertEqual(self.out["paired"]["n_items"], 5)
        for k in d:
            self.assertLessEqual(d[k]["lo"], d[k]["hi"])
        self.assertEqual(self.out["resamples"], 10000)

    def test_failed_runs_are_listed_and_never_zero(self):
        u = self.out["unscored"]
        self.assertIn({"arm": "A", "run": "r2", "item": "g5", "reason": "timeout"}, u)
        self.assertIn({"arm": "B", "run": "r2", "item": "*", "reason": "RAM kill"}, u)
        self.assertIn({"arm": "B", "run": "r3", "item": "g5", "reason": "missing"}, u)
        self.assertEqual(len(u), 3)
        # Scored as zeros they would add item-runs: A would have 10 and B 14. They are not counted at all.
        self.assertEqual(self.out["arms"]["A"]["scored_item_runs"], 9)
        self.assertEqual(self.out["arms"]["B"]["scored_item_runs"], 9)

    def test_same_seed_is_byte_identical(self):
        again = score()
        self.assertEqual(again.stdout, self.r.stdout)
        other = score(extra=("--seed", "7"))
        self.assertNotEqual(other.stdout, self.r.stdout)

    def test_items_scored_in_only_one_arm_are_dropped_and_listed(self):
        gold = clone(GOLD)
        gold["items"]["g6"] = {"type": "number", "tolerance": 1, "verdict": "PUBLISHED", "gold": 302299864.61157477, "url": "https://hazards.fema.gov/nri/"}
        a = clone(ARM_A)
        a["runs"]["r1"]["answers"]["g6"] = ans(302299865)
        out = json.loads(score(gold=gold, a=a).stdout)
        self.assertEqual(out["paired"]["n_items"], 5)
        self.assertEqual(out["paired"]["dropped"], [{"item": "g6", "reason": "scored in A only"}])
        self.assertEqual(out["arms"]["A"]["scored_item_runs"], 9)  # g6 is not paired, so not counted

    # n: 177203 is off by 1 against tolerance 0, wrong. x: inner whitespace is normalised, case is kept.
    # t: tolerance 1, 302299865 is off by 0.39, right; 302299900 is off by 35, wrong.
    # A: n wrong, x right, t right = 2/3. B: n right, x wrong, t wrong = 1/3.
    def test_tolerance_and_normalisation(self):
        gold = {"marker": MARKER, "items": {
            "n": GOLD["items"]["g2"], "x": GOLD["items"]["g1"],
            "t": {"type": "number", "tolerance": 1, "verdict": "PUBLISHED", "gold": 302299864.61157477, "url": "u"}}}

        def arm(name, n, x, t):
            return {"arm": name, "runs": {"r1": {"answers": {"n": ans(n), "x": ans(x), "t": ans(t)}}}}

        out = json.loads(score(gold=gold, a=arm("A", 177203, "Relatively  High", 302299865),
                               b=arm("B", 177202, "relatively high", 302299900)).stdout)
        self.assertEqual(out["arms"]["A"]["selective_accuracy"], 0.666667)
        self.assertEqual(out["arms"]["B"]["selective_accuracy"], 0.333333)

    # A abstains on both: p (published) scores 0, a miss and not a wrong answer; q (NOT_PUBLISHED) scores +1.
    # Q(9) = (0 + 1)/2. B answers both: p +1, q is a false fill, -9. Q(9) = (1 - 9)/2 = -4.
    def test_abstain_is_correct_only_on_not_published(self):
        gold = {"marker": MARKER, "items": {"p": GOLD["items"]["g1"], "q": GOLD["items"]["g4"]}}
        absent = ans(None, "not_published", None)

        def both(name, p, q):
            return {"arm": name, "runs": {"r1": {"answers": {"p": p, "q": q}}}}

        out = json.loads(score(gold=gold, a=both("A", absent, absent),
                               b=both("B", ans("Relatively High"), ans("Relatively Low"))).stdout)
        self.assertEqual(out["arms"]["A"]["Q"]["9"], 0.5)
        self.assertEqual(out["arms"]["A"]["coverage"], 0.0)
        self.assertIsNone(out["arms"]["A"]["selective_accuracy"])
        self.assertEqual(out["arms"]["B"]["Q"]["9"], -4.0)
        self.assertEqual(out["arms"]["B"]["false_fill_rate"], 1.0)

    def test_malformed_status_is_unscored_not_zero(self):
        a = clone(ARM_A)
        a["runs"]["r1"]["answers"]["g1"] = {"answer": "x", "status": "maybe", "citation": None}
        out = json.loads(score(a=a).stdout)
        self.assertIn({"arm": "A", "run": "r1", "item": "g1", "reason": "malformed status"}, out["unscored"])

    def test_refuses_a_file_without_the_gold_marker(self):
        r = score(gold={"items": GOLD["items"]})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("marker", r.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
