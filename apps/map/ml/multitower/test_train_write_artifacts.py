#!/usr/bin/env python3
"""A measuring run must not ship: train.py writes nothing unless told to.

Lesson 2026-08-06:a-measuring-run. A one-epoch smoke run of a trainer that
exports unconditionally overwrote the live model twice. train.py's main()
used to do the same: after the walk-forward it wrote weights_final.npz,
scalers_final.json, config.json, windows.csv and metrics.json under
DATAOPS_ROOT/models/<MODEL_ID>/, the files forecast.py reads to build the site
bundle. Those writes now sit behind --write-artifacts (default off).

Each test runs train.py as a subprocess against a temp DATAOPS_ROOT holding a
tiny frame, sentinel "live" artifacts, and the sha256 of every file and
directory before and after. It never reads or writes the real warehouse.

The frame below is a SHAPE FIXTURE, NOT DATA: seeded random numbers laid out
in the columns train.py and tasks.json name, so the trainer has something to
walk forward over. It exists only inside the temp directory of a test and is
never written anywhere else.

This file is standard library only; the child process it starts is the one
that needs numpy and pandas (the same ones train.py imports), so the test
itself stays light on a box with little memory to spare.

Run from anywhere:  python -I apps/map/ml/multitower/test_train_write_artifacts.py -v
(Not "python -I -m unittest <path>": -I keeps the working directory off
sys.path, so unittest cannot import a test given by path.)
"""
import csv
import datetime
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TRAIN = os.path.join(HERE, "train.py")
TASKS = os.path.join(HERE, "tasks.json")

with open(TRAIN, encoding="utf-8") as _f:
    _m = re.search(r'^MODEL_ID = "([^"]+)"', _f.read(), re.M)
if not _m:
    raise SystemExit('train.py no longer defines MODEL_ID = "..." at the top level')
MODEL_ID = _m.group(1)

# The five files main() writes, and two more a model dir holds that the trainer
# must leave alone (forecast.py and evaluate.py write them).
ARTIFACTS = ("weights_final.npz", "scalers_final.json", "config.json",
             "windows.csv", "metrics.json")
SIBLINGS = ("forecasts.json", "REPORT.md")

# The child runs isolated when this process does (CI: python -I). -B keeps
# .pyc files out of the checkout; PYTHONDONTWRITEBYTECODE is ignored under -I.
CHILD_FLAGS = (["-I"] if sys.flags.isolated else []) + ["-B"]

TEST_YEAR = 2013


def write_shape_fixture(root):
    """frames/multitower_daily.csv under root: 2009-01-01..2014-01-10, daily.

    That is one walk-forward window (test year 2013): train.py starts at
    max(2012, first year + 4) and stops before the last (partial) year, needs
    1000+ train rows before the 14-day purge, 30+ test rows, and 100+ non-null
    values per task. Columns follow tasks.json (tower prefixes, task kinds).
    """
    with open(TASKS, encoding="utf-8") as f:
        reg = json.load(f)
    rng = random.Random(20261020)
    names = ["date"]
    names += [f"{p}f{i}" for p in reg["tower_prefix"].values() for i in range(3)]
    names += list(reg["tasks"])
    refs = (("ref_gas", "gas_fwd7"), ("ref_wti", "wti_fwd7"), ("ref_q25", "quake_fwd7"))
    names += [r for r, t in refs if t in reg["tasks"]]
    path = os.path.join(root, "frames", "multitower_daily.csv")
    os.makedirs(os.path.dirname(path))
    day = datetime.date(2009, 1, 1)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(names)
        while day <= datetime.date(2014, 1, 10):
            row = {"date": day.isoformat()}
            for n in names[1:]:
                row[n] = f"{rng.gauss(0.0, 1.0):.6f}"
            for task, cfg in reg["tasks"].items():
                if cfg["kind"] == "clf":
                    row[task] = str(rng.randint(0, 1))
                elif cfg["kind"] == "count":
                    row[task] = str(rng.randint(0, 5))
                else:
                    row[task] = f"{3.0 + rng.gauss(0.0, 1.0):.6f}"
            w.writerow([row[n] for n in names])
            day += datetime.timedelta(days=1)


def seed_live_model(root):
    """Sentinel stand-ins for a live model dir: all five artifacts and two siblings."""
    d = os.path.join(root, "models", MODEL_ID)
    os.makedirs(d)
    for name in ARTIFACTS + SIBLINGS:
        with open(os.path.join(d, name), "wb") as f:
            f.write(f"SENTINEL live {name}: not a real model, must survive a dry run\n".encode())


def snapshot(root):
    """{'dir:<rel>': None, 'file:<rel>': sha256} for everything under root."""
    snap = {}
    for dirpath, _dirs, files in os.walk(root):
        rel = os.path.relpath(dirpath, root).replace(os.sep, "/")
        snap["dir:" + rel] = None
        for name in files:
            with open(os.path.join(dirpath, name), "rb") as f:
                snap["file:" + (rel + "/" + name).removeprefix("./")] = \
                    hashlib.sha256(f.read()).hexdigest()
    return snap


def diff(before, after):
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed = sorted(k for k in set(before) & set(after) if before[k] != after[k])
    return added, removed, changed


class MeasuringRunDoesNotShip(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = os.path.abspath(tmp.name)
        self.model_dir = os.path.join(self.root, "models", MODEL_ID)
        write_shape_fixture(self.root)

    def train(self, *args):
        env = dict(os.environ, DATAOPS_ROOT=self.root)
        proc = subprocess.run([sys.executable, *CHILD_FLAGS, TRAIN, *args],
                              cwd=self.root, env=env, capture_output=True,
                              text=True, encoding="utf-8", errors="replace",
                              timeout=120)
        self.assertEqual(proc.returncode, 0,
                         f"train.py exited {proc.returncode}\nstdout tail:\n"
                         f"{proc.stdout[-800:]}\nstderr tail:\n{proc.stderr[-800:]}")
        return proc.stdout

    def assert_walk_forward_ran(self, out):
        # A dry run that quit before the walk-forward would pass the checksum
        # tests for the wrong reason.
        self.assertIn(f"walk-forward test years: {TEST_YEAR}..{TEST_YEAR}", out)
        self.assertRegex(out, rf"(?m)^  {TEST_YEAR}: ")

    def test_a_run_without_the_flag_leaves_every_live_artifact_unchanged(self):
        seed_live_model(self.root)
        before = snapshot(self.root)
        out = self.train()
        added, removed, changed = diff(before, snapshot(self.root))
        self.assertEqual((added, removed, changed), ([], [], []),
                         "a run without --write-artifacts touched the model dir")
        self.assert_walk_forward_ran(out)
        self.assertEqual(
            out.rstrip("\n").splitlines()[-1],
            "dry run: no artifacts written; pass --write-artifacts to save to "
            + self.model_dir)

    def test_a_run_without_the_flag_creates_nothing_when_no_model_dir_exists(self):
        before = snapshot(self.root)
        out = self.train()
        added, removed, changed = diff(before, snapshot(self.root))
        self.assertEqual((added, removed, changed), ([], [], []),
                         "a run without --write-artifacts created files or directories")
        self.assertFalse(os.path.exists(os.path.join(self.root, "models")))
        self.assert_walk_forward_ran(out)

    def test_a_run_with_the_flag_rewrites_exactly_the_five_artifacts(self):
        seed_live_model(self.root)
        before = snapshot(self.root)
        out = self.train("--write-artifacts")
        added, removed, changed = diff(before, snapshot(self.root))
        rel = "file:models/" + MODEL_ID + "/"
        self.assertEqual((added, removed), ([], []))
        self.assertEqual(changed, sorted(rel + n for n in ARTIFACTS),
                         "the flag must overwrite the five artifacts and nothing else")
        self.assert_walk_forward_ran(out)
        self.assertTrue(out.rstrip("\n").splitlines()[-1].startswith("saved " + self.model_dir))
        with zipfile.ZipFile(os.path.join(self.model_dir, "weights_final.npz")) as z:
            names = z.namelist()
        self.assertTrue(names and all(n.endswith(".npy") for n in names), names)
        with open(os.path.join(self.model_dir, "metrics.json"), encoding="utf-8") as f:
            self.assertEqual([w["year"] for w in json.load(f)["windows"]], [TEST_YEAR])

    def test_a_run_with_the_flag_creates_the_model_dir_when_it_is_missing(self):
        before = snapshot(self.root)
        self.train("--write-artifacts")
        added, removed, changed = diff(before, snapshot(self.root))
        rel = "models/" + MODEL_ID
        self.assertEqual(
            added, sorted(["dir:models", "dir:" + rel]
                          + ["file:" + rel + "/" + n for n in ARTIFACTS]))
        self.assertEqual((removed, changed), ([], []))


if __name__ == "__main__":
    unittest.main()
