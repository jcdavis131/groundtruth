"""The preregistered agreement scorer's pure parts: the Wilson interval, the seeded draw and the miss classes.

    python -m unittest discover -s data/pipeline -p "test_*.py"

No network and no DuckDB. The expected numbers are worked out in the prereg (JOINS-PREREG.md) or by hand.
"""

from __future__ import annotations

import random
import unittest

import agreement


class WilsonTest(unittest.TestCase):
    def test_none_for_an_empty_denominator(self):
        self.assertIsNone(agreement.wilson(0, 0))

    def test_all_of_600_agree_has_a_lower_bound_near_0_9936(self):
        lo, hi = agreement.wilson(600, 600)
        self.assertAlmostEqual(lo, 0.99364, places=4)
        self.assertAlmostEqual(hi, 1.0, places=9)

    def test_594_of_600_is_the_prereg_floor(self):
        lo, hi = agreement.wilson(594, 600)
        self.assertAlmostEqual(lo, 0.97836, places=4)
        self.assertAlmostEqual(hi, 0.99541, places=4)

    def test_none_agree(self):
        lo, hi = agreement.wilson(0, 10)
        self.assertEqual(lo, 0.0)
        self.assertAlmostEqual(hi, 0.27753, places=4)


class SampleTest(unittest.TestCase):
    IDS = [f"nid:TX{n:05d}" for n in range(7415)]

    def test_it_is_the_preregistered_draw(self):
        want = sorted(random.Random(20261020).sample(sorted(self.IDS), 600))
        self.assertEqual(agreement.sample_ids(self.IDS), want)
        self.assertEqual(len(want), 600)
        # the first five of the draw, worked out when the prereg was written (Python 3.11)
        first5 = random.Random(20261020).sample(sorted(self.IDS), 5)
        self.assertEqual(first5, ["nid:TX06342", "nid:TX03766", "nid:TX06104", "nid:TX05339", "nid:TX06701"])

    def test_input_order_does_not_matter(self):
        shuffled = list(self.IDS)
        random.Random(1).shuffle(shuffled)
        self.assertEqual(agreement.sample_ids(shuffled), agreement.sample_ids(self.IDS))

    def test_a_small_stratum_is_taken_whole(self):
        self.assertEqual(agreement.sample_ids(["b", "a"]), ["a", "b"])


class ClassTest(unittest.TestCase):
    def kw(self, **o):
        base = dict(theirs="01003", pip="01097", other_dist=0.5, tigerweb="01097", tigerweb_known=True, in_file=True, c1=False)
        base.update(o)
        return base

    def test_vintage_first(self):
        self.assertEqual(agreement.classify_miss(**self.kw(theirs="02063", other_dist=0.0)), "V")
        self.assertEqual(agreement.classify_miss(**self.kw(in_file=False)), "V")

    def test_edge_within_0_005_degrees(self):
        self.assertEqual(agreement.classify_miss(**self.kw(other_dist=0.005)), "G")
        self.assertEqual(agreement.classify_miss(**self.kw(other_dist=0.0049)), "G")
        self.assertNotEqual(agreement.classify_miss(**self.kw(other_dist=0.0051)), "G")

    def test_publisher_point_error_needs_tigerweb_to_side_with_the_polygon(self):
        self.assertEqual(agreement.classify_miss(**self.kw()), "P")
        self.assertEqual(agreement.classify_miss(**self.kw(tigerweb="01003")), "X")  # TIGERweb sides with the publisher: our fault

    def test_a_tigerweb_miss_is_never_p(self):
        self.assertEqual(agreement.classify_miss(**self.kw(c1=True, theirs="01003", tigerweb="01003")), "X")
        self.assertEqual(agreement.classify_miss(**self.kw(c1=True, theirs="01003", other_dist=0.001)), "G")

    def test_unexplained_is_x(self):
        self.assertEqual(agreement.classify_miss(**self.kw(tigerweb_known=False)), "X")

    def test_the_boundary_changed_counties_are_the_six_in_bake_ts(self):
        self.assertEqual(sorted(agreement.BOUNDARY_CHANGED_SINCE_2010), ["02063", "02066", "02105", "02195", "02198", "51019"])

    def test_the_tigerweb_layer_is_the_named_vintage_never_current(self):
        self.assertIn("tigerWMS_ACS2025/MapServer/82", agreement.TIGERWEB)
        self.assertNotIn("tigerWMS_Current", agreement.tigerweb_url(-85.0, 33.0))
        self.assertIn("geometry=-85.0000000,33.0000000", agreement.tigerweb_url(-85.0, 33.0))


if __name__ == "__main__":
    unittest.main()
