"""pack_raw.py packs <data root>/raw/ into a tar plus index.json, and refuses unless every committed manifest's
requests[].sha256 is the sha256 of a file it indexed.

    python -I -m unittest discover -s data/pipeline -p test_pack_raw.py

Standard library only, no network. The fixture snapshots (data/schema/fixtures/snapshots/*) pin request shas whose
bodies are not in git, so the tests write a temporary raw/ whose bodies are TEST bodies (the text "test body for"
and the URL; they stand in for responses, they are not data) and rewrite a copy of each fixture manifest's
requests[] to pin them. The committed fixture manifests are also run unmodified against an empty raw/, where every
pin must be named missing.
"""

from __future__ import annotations

import ast
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # python -I leaves the script's folder off sys.path
import pack_raw  # noqa: E402

REPO = HERE.parents[1]
FIXTURES = REPO / "data" / "schema" / "fixtures" / "snapshots"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def test_body(url: str) -> bytes:
    return ("test body for " + url).encode("utf8")


def put(raw: Path, url: str, body: bytes) -> dict:
    """A cache entry as net.Fetcher writes it: <sha256 of url>.body and its .json sidecar. Returns the request pin."""
    k = sha(url.encode("utf8"))
    (raw / f"{k}.body").write_bytes(body)
    (raw / f"{k}.json").write_text(json.dumps({"url": url, "status": 200, "retrievedAt": "2026-10-19T23:00:41.485Z", "bytes": len(body), "sha256": sha(body)}), "utf8")
    return {"url": url, "status": 200, "retrievedAt": "2026-10-19T23:00:41.485Z", "bytes": len(body), "sha256": sha(body)}


def write_manifest(manifests: Path, collection: str, snapshot_id: str, requests: list) -> Path:
    p = manifests / collection / f"{snapshot_id}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"snapshotId": snapshot_id, "collection": collection, "requests": requests}, indent=1), "utf8")
    return p


def run(*argv) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        rc = pack_raw.main([str(a) for a in argv])
    return rc, out.getvalue(), err.getvalue()


def tree(root: Path) -> dict:
    """Every path under root with its size and mtime, to show a run changed nothing."""
    return {str(p.relative_to(root)): (p.stat().st_size, p.stat().st_mtime_ns) for p in sorted(root.rglob("*"))}


class World:
    """A temporary data root and manifests folder built from the three fixture snapshots."""

    def __init__(self, tmp: Path):
        self.tmp = tmp
        self.root = tmp / "data-root"
        self.raw = self.root / "raw"
        self.manifests = tmp / "manifests"
        self.raw.mkdir(parents=True)
        self.pins = []  # (snapshotId, purpose, url, sha256)
        for src in sorted(FIXTURES.glob("*/manifest.json")):
            m = json.loads(src.read_text("utf8"))
            reqs = []
            for r in m["requests"]:
                pin = put(self.raw, r["url"], test_body(r["url"]))
                reqs.append({**r, "bytes": pin["bytes"], "sha256": pin["sha256"]})
                self.pins.append((m["snapshotId"], r["purpose"], r["url"], pin["sha256"]))
            write_manifest(self.manifests, m["collection"], m["snapshotId"], reqs)

    def body_path(self, url: str) -> Path:
        return self.raw / f"{sha(url.encode('utf8'))}.body"


class PackRawTest(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory(prefix="gt-pack-")
        self.tmp = Path(self._t.name)
        self.w = World(self.tmp)

    def tearDown(self):
        self._t.cleanup()

    def dry(self, *extra):
        return run("--dry-run", "--data-root", self.w.root, "--manifests", self.w.manifests, *extra)

    def out(self, dest, *extra):
        return run("--out", dest, "--data-root", self.w.root, "--manifests", self.w.manifests, *extra)

    # ---------------------------------------------------------------- coverage

    def test_fixture_snapshot_coverage_is_complete(self):
        self.assertEqual(len(self.w.pins), 7, "the three fixture snapshots pin 7 requests")
        rc, out, err = self.dry()
        self.assertEqual((rc, err), (0, ""), out + err)
        self.assertRegex(out, r"manifests: 3, requests: 7, distinct request sha256: 7")
        self.assertRegex(out, r"coverage: 7 of 7 distinct request sha256 present in the index \(100\.00%\)")

    def test_deleting_one_fixture_body_turns_it_red(self):
        snap, purpose, url, pinned = self.w.pins[3]
        self.w.body_path(url).unlink()
        rc, out, err = self.dry()
        self.assertEqual(rc, 1, out + err)
        self.assertIn(f"MISSING {snap} {purpose} {url} {pinned}", err)
        self.assertRegex(out, r"coverage: 6 of 7 distinct request sha256 present in the index")
        self.assertEqual(err.count("MISSING "), 1)

    def test_a_flipped_bit_in_a_pinned_body_turns_it_red(self):
        # the sidecar still claims the pinned sha; the check must hash the bytes, not read the claim
        snap, purpose, url, pinned = self.w.pins[0]
        p = self.w.body_path(url)
        data = bytearray(p.read_bytes())
        data[len(data) // 2] ^= 0x01  # one bit, same size
        p.write_bytes(bytes(data))
        side = json.loads(p.with_suffix(".json").read_text("utf8"))
        self.assertEqual(side["sha256"], pinned, "the sidecar was left untouched")
        rc, out, err = self.dry()
        self.assertEqual(rc, 1, out + err)
        self.assertIn(f"MISSING {snap} {purpose} {url} {pinned}", err)

    def test_committed_fixture_manifests_against_an_empty_raw_name_every_pin(self):
        manifests = self.tmp / "committed"
        for src in sorted(FIXTURES.glob("*/manifest.json")):
            m = json.loads(src.read_text("utf8"))
            write_manifest(manifests, m["collection"], m["snapshotId"], m["requests"])
        empty = self.tmp / "empty-root"
        (empty / "raw").mkdir(parents=True)
        rc, out, err = run("--dry-run", "--data-root", empty, "--manifests", manifests)
        self.assertEqual(rc, 1, out + err)
        shas = {r["sha256"] for src in FIXTURES.glob("*/manifest.json") for r in json.loads(src.read_text("utf8"))["requests"]}
        self.assertEqual(err.count("MISSING "), len(shas), "one named failure per distinct pin")
        for s in shas:
            self.assertIn(s, err)
        self.assertRegex(out, r"coverage: 0 of \d+ distinct request sha256")

    def test_two_urls_with_one_body_are_both_covered_and_counted_once(self):
        body = b"test body shared by two urls"
        a = put(self.w.raw, "https://example.invalid/test/a", body)
        b = put(self.w.raw, "https://example.invalid/test/b", body)
        write_manifest(self.w.manifests, "dup", "dup.testland.2026-10-19", [{"purpose": "records", **a}, {"purpose": "count", **b}])
        entries = pack_raw.scan(self.w.raw)
        pins, n = pack_raw.load_pins(self.w.manifests)
        cov = pack_raw.coverage(entries, pins)
        self.assertEqual((n, cov.requests, cov.distinct, cov.covered, cov.missing), (4, 9, 8, 8, []))

    def test_committed_manifests_all_load(self):
        manifests = REPO / "data" / "manifests"
        files = sorted(manifests.glob("*/*.json"))
        self.assertGreaterEqual(len(files), 1)
        pins, n = pack_raw.load_pins(manifests)
        self.assertEqual(n, len(files))
        self.assertGreater(len(pins), 0)
        for p in pins:
            self.assertRegex(p.sha256, r"^[0-9a-f]{64}$")

    def test_no_manifests_is_refused(self):
        rc, out, err = run("--dry-run", "--data-root", self.w.root, "--manifests", self.tmp / "nowhere")
        self.assertEqual(rc, 1)
        self.assertIn("no manifests", err)

    def test_a_manifest_without_requests_is_refused(self):
        write_manifest(self.w.manifests, "bare", "bare.testland.2026-10-19", [])
        rc, out, err = self.dry()
        self.assertEqual(rc, 1)
        self.assertIn("bare.testland.2026-10-19", err)
        self.assertIn("requests", err)

    def test_a_request_sha_that_is_not_64_hex_is_refused(self):
        write_manifest(self.w.manifests, "odd", "odd.testland.2026-10-19", [{"purpose": "records", "url": "https://example.invalid/x", "sha256": "abc123"}])
        rc, out, err = self.dry()
        self.assertEqual(rc, 1)
        self.assertIn("odd.testland.2026-10-19", err)
        self.assertIn("sha256", err)

    # ---------------------------------------------------------------- scope and the dry run

    def test_the_walk_is_recursive_sorted_and_keeps_sidecars(self):
        (self.w.raw / "athletes").mkdir()
        (self.w.raw / "athletes" / "x.body").write_bytes(b"a")
        (self.w.raw / "boundaries").mkdir()
        (self.w.raw / "boundaries" / "b.zip").write_bytes(b"zz")
        entries = pack_raw.scan(self.w.raw)
        paths = [e.path for e in entries]
        self.assertEqual(paths, sorted(paths))
        self.assertTrue(all(p.startswith("raw/") for p in paths))
        self.assertIn("raw/athletes/x.body", paths)
        self.assertIn("raw/boundaries/b.zip", paths)
        self.assertEqual(sum(p.endswith(".json") for p in paths), 7, "every sidecar is packed")
        by = {e.path: e for e in entries}
        self.assertEqual((by["raw/athletes/x.body"].bytes, by["raw/athletes/x.body"].sha256), (1, sha(b"a")))

    def test_dry_run_writes_nothing(self):
        before = tree(self.tmp)
        rc, out, err = self.dry()
        self.assertEqual(rc, 0, out + err)
        self.assertEqual(tree(self.tmp), before)
        self.assertFalse(list(Path.cwd().glob("raw.tar*")))

    def test_a_mode_is_required(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
            pack_raw.main(["--data-root", str(self.w.root)])
        self.assertEqual(cm.exception.code, 2)

    def test_a_symlink_under_raw_is_a_named_failure(self):
        target = self.tmp / "elsewhere.body"
        target.write_bytes(b"x")
        try:
            os.symlink(target, self.w.raw / "link.body")
        except (OSError, NotImplementedError):
            self.skipTest("this account cannot create symlinks")
        rc, out, err = self.dry()
        self.assertEqual(rc, 1)
        self.assertIn("link.body", err)
        self.assertIn("symlink", err)

    # ---------------------------------------------------------------- --out

    def test_out_writes_a_tar_and_an_index_that_agree(self):
        long_name = "x" * 130 + ".body"  # a path past ustar's 100 bytes, so the tar needs a pax header
        (self.w.raw / long_name).write_bytes(b"long-name body")
        dest = self.tmp / "out"
        rc, out, err = self.out(dest)
        self.assertEqual((rc, err), (0, ""), out + err)
        tar_p, idx_p = dest / "raw.tar", dest / "index.json"
        self.assertEqual(sorted(p.name for p in dest.iterdir()), ["index.json", "raw.tar"])
        idx = json.loads(idx_p.read_text("utf8"))
        self.assertEqual(idx["format"], "raw-pack/1")
        files = idx["files"]
        self.assertEqual(set(files[0]), {"path", "bytes", "sha256"})
        self.assertEqual([f["path"] for f in files], sorted(f["path"] for f in files))
        with tarfile.open(tar_p) as tf:
            members = tf.getmembers()
            self.assertEqual([m.name for m in members], [f["path"] for f in files])
            for m, f in zip(members, files):
                data = tf.extractfile(m).read()
                self.assertEqual((len(data), sha(data)), (f["bytes"], f["sha256"]), f["path"])
                self.assertEqual((m.mtime, m.uid, m.gid, m.mode), (0, 0, 0, 0o644))
                self.assertEqual(data, (self.w.root / f["path"]).read_bytes(), "the member is the cache file, byte for byte")
        self.assertIn("raw/" + long_name, [f["path"] for f in files])
        size = tar_p.stat().st_size
        self.assertEqual(idx["tar"], {"path": "raw.tar", "bytes": size, "sha256": sha(tar_p.read_bytes())})
        printed = int(re.search(r"tar \(uncompressed\): ([\d,]+) bytes", out).group(1).replace(",", ""))
        self.assertEqual(printed, size, "the size the dry run predicts is the size the tar has")
        self.assertEqual(idx["coverage"]["missing"], 0)
        self.assertEqual(idx["coverage"]["covered"], idx["coverage"]["distinctSha256"])
        # the dry run on the same input predicts the same size without writing it
        rc2, out2, _ = self.dry()
        self.assertEqual(rc2, 0)
        self.assertIn(f"tar (uncompressed): {size:,} bytes", out2)

    def test_the_index_covers_every_pinned_sha(self):
        dest = self.tmp / "out"
        self.assertEqual(self.out(dest)[0], 0)
        idx = json.loads((dest / "index.json").read_text("utf8"))
        indexed = {f["sha256"] for f in idx["files"]}
        for snap, purpose, url, pinned in self.w.pins:
            self.assertIn(pinned, indexed, f"{snap} {purpose}")

    def test_out_refuses_to_overwrite_an_existing_tar(self):
        dest = self.tmp / "out"
        dest.mkdir()
        (dest / "raw.tar").write_bytes(b"keep me")
        rc, out, err = self.out(dest)
        self.assertEqual(rc, 1)
        self.assertIn("raw.tar", err)
        self.assertEqual((dest / "raw.tar").read_bytes(), b"keep me")
        self.assertEqual(sorted(p.name for p in dest.iterdir()), ["raw.tar"])

    def test_out_refuses_to_overwrite_an_existing_index(self):
        dest = self.tmp / "out"
        dest.mkdir()
        (dest / "index.json").write_bytes(b"keep me")
        rc, out, err = self.out(dest)
        self.assertEqual(rc, 1)
        self.assertIn("index.json", err)
        self.assertEqual((dest / "index.json").read_bytes(), b"keep me")
        self.assertEqual(sorted(p.name for p in dest.iterdir()), ["index.json"])

    def test_out_refuses_a_folder_inside_raw(self):
        before = tree(self.tmp)
        rc, out, err = self.out(self.w.raw / "pack")
        self.assertEqual(rc, 1)
        self.assertIn("inside", err)
        self.assertEqual(tree(self.tmp), before)

    def test_out_refuses_a_folder_inside_the_data_root(self):
        # The data root is read-only for the pack: raw/ is not the only place under it that --out must refuse.
        before = tree(self.tmp)
        rc, out, err = self.out(self.w.root / "packs")
        self.assertEqual(rc, 1, out + err)
        self.assertIn("inside", err)
        self.assertFalse((self.w.root / "packs").exists())
        self.assertEqual(tree(self.tmp), before, "nothing was written anywhere")

    def test_out_refuses_the_data_root_itself(self):
        before = tree(self.tmp)
        rc, out, err = self.out(self.w.root)
        self.assertEqual(rc, 1, out + err)
        self.assertIn("data root", err)
        self.assertEqual(tree(self.tmp), before, "no raw.tar, no index.json, no .part in the data root")

    def test_out_next_to_the_data_root_is_still_allowed(self):
        # The refusal is the data root and what is under it, not its parent folder or its siblings.
        dest = self.tmp / "out"
        rc, out, err = self.out(dest)
        self.assertEqual(rc, 0, out + err)
        self.assertEqual(sorted(p.name for p in dest.iterdir()), ["index.json", "raw.tar"])

    def test_out_writes_nothing_when_coverage_fails(self):
        self.w.body_path(self.w.pins[0][2]).unlink()
        dest = self.tmp / "out"
        rc, out, err = self.out(dest)
        self.assertEqual(rc, 1)
        self.assertIn("MISSING", err)
        self.assertFalse(dest.exists(), "no folder, no .part, nothing")

    def test_the_predicted_size_is_the_written_size_at_every_record_boundary(self):
        # the tar is padded to 10,240-byte records, so a prediction that is off by a block hides until a size lands on an edge
        for k in range(0, 24):  # k one-byte files: 1,024 bytes each, so k = 9 ends exactly on a record
            root = self.tmp / f"edge-{k}"
            raw = root / "raw"
            raw.mkdir(parents=True)
            for i in range(k):
                (raw / f"f{i:02d}.body").write_bytes(b"x")
            entries = pack_raw.scan(raw)
            size, digest = pack_raw.write_tar(root, entries, self.tmp / f"edge-{k}.tar")
            self.assertEqual(size, (self.tmp / f"edge-{k}.tar").stat().st_size)
            self.assertEqual(digest, sha((self.tmp / f"edge-{k}.tar").read_bytes()))
            self.assertEqual(pack_raw.predicted_tar_bytes(entries), size, f"{k} files")
        for n in (0, 1, 511, 512, 513, 1023, 1024, 10240, 10241):
            root = self.tmp / f"size-{n}"
            raw = root / "raw"
            raw.mkdir(parents=True)
            (raw / "one.body").write_bytes(b"y" * n)
            entries = pack_raw.scan(raw)
            size, _ = pack_raw.write_tar(root, entries, self.tmp / f"size-{n}.tar")
            self.assertEqual(pack_raw.predicted_tar_bytes(entries), size, f"one file of {n} bytes")

    def test_the_same_input_gives_the_same_bytes(self):
        a, b = self.tmp / "a", self.tmp / "b"
        self.assertEqual(self.out(a)[0], 0)
        for p in self.w.raw.iterdir():
            os.utime(p, (1_000_000_000, 1_000_000_000))  # mtimes change; the pack must not notice
        self.assertEqual(self.out(b)[0], 0)
        self.assertEqual((a / "raw.tar").read_bytes(), (b / "raw.tar").read_bytes())
        self.assertEqual((a / "index.json").read_bytes(), (b / "index.json").read_bytes())

    # ---------------------------------------------------------------- the module itself

    def test_the_module_imports_only_the_standard_library(self):
        tree_ = ast.parse((HERE / "pack_raw.py").read_text("utf8"))
        names = set()
        for node in ast.walk(tree_):
            if isinstance(node, ast.Import):
                names.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                names.add(node.module.split(".")[0])
        self.assertTrue(names, "found no imports at all")
        self.assertEqual(sorted(n for n in names if n not in sys.stdlib_module_names), [])


if __name__ == "__main__":
    unittest.main()
