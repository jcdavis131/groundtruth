"""verify.py compares the Hub's stored hashes with the committed manifests. "Not published yet" exits 0 with its
reason; a planted mismatch exits 1; a Hub error exits 2.

    python -I data/hf/test_verify.py

No network: the tree listing is replaced by a fixture, and the HTTP layer by a fake opener.
"""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script's folder off sys.path
import verify  # noqa: E402

SID = "nid-dams.testland.2026-10-19"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def blob_oid(b: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()


class VerifyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gt-verify-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.manifests = self.tmp / "manifests"
        self.readme = self.tmp / "README.md"
        self.readme.write_text("---\npretty_name: test\n---\n", "utf8")
        self.records = b"parquet-bytes-stand-in"
        self.manifest = {
            "schemaVersion": "manifest/1",
            "snapshotId": SID,
            "collection": "nid-dams",
            "files": [{"path": "records.parquet", "format": "geoparquet", "sha256": sha(self.records), "bytes": len(self.records), "records": 2}],
        }
        self.mp = self.manifests / "nid-dams" / f"{SID}.json"
        self.mp.parent.mkdir(parents=True)
        self.mp.write_text(json.dumps(self.manifest, indent=1), "utf8")
        self.tree = self.good_tree()

    def good_tree(self):
        return [
            {"type": "directory", "path": "snapshots", "oid": "d" * 40},
            {"type": "file", "path": f"snapshots/{SID}/records.parquet", "oid": "a" * 40, "size": 99, "lfs": {"oid": sha(self.records), "size": len(self.records), "pointerSize": 134}},
            {"type": "file", "path": f"snapshots/{SID}/manifest.json", "oid": blob_oid(self.mp.read_bytes()), "size": self.mp.stat().st_size},
            {"type": "file", "path": "README.md", "oid": blob_oid(self.readme.read_bytes()), "size": self.readme.stat().st_size},
        ]

    def run_main(self, tree, *extra: str):
        def fake(repo, rev="main", urlopen=None):
            if isinstance(tree, Exception):
                raise tree
            return tree

        real = verify.fetch_tree
        verify.fetch_tree = fake
        self.addCleanup(setattr, verify, "fetch_tree", real)
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = verify.main(["--manifests", str(self.manifests), "--readme", str(self.readme), "--data-root", str(self.tmp / "no-data-root"), *extra])
        return code, out.getvalue(), err.getvalue()

    def test_git_blob_oid_matches_git(self):
        self.assertEqual(verify.git_blob_oid(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a")

    def test_not_published_yet_exits_0_with_the_reason(self):
        for tree in (None, []):
            code, out, err = self.run_main(tree)
            self.assertEqual(code, 0, err)
            self.assertIn("not published yet", out)

    def test_matching_hub_exits_0_and_names_every_file(self):
        code, out, err = self.run_main(self.tree)
        self.assertEqual(code, 0, err)
        self.assertIn(f"snapshots/{SID}/records.parquet", out)
        self.assertIn("3 of 3", out)

    def test_planted_lfs_sha_mismatch_exits_1(self):
        self.tree[1]["lfs"]["oid"] = "0" * 64
        code, out, err = self.run_main(self.tree)
        self.assertEqual(code, 1)
        self.assertIn(f"snapshots/{SID}/records.parquet", err)
        self.assertIn("sha256", err)

    def test_planted_small_file_oid_mismatch_exits_1(self):
        self.tree[3]["oid"] = "0" * 40
        code, out, err = self.run_main(self.tree)
        self.assertEqual(code, 1)
        self.assertIn("README.md", err)
        self.assertIn("blob oid", err)

    def test_file_missing_from_a_published_repo_exits_1(self):
        del self.tree[2]
        code, out, err = self.run_main(self.tree)
        self.assertEqual(code, 1)
        self.assertIn(f"snapshots/{SID}/manifest.json", err)
        self.assertIn("not on the Hub", err)

    def test_a_small_manifest_file_without_a_local_copy_is_reported_unchecked(self):
        self.tree[1] = {"type": "file", "path": f"snapshots/{SID}/records.parquet", "oid": "b" * 40, "size": 3}  # not LFS
        code, out, err = self.run_main(self.tree)
        self.assertEqual(code, 0, err)
        self.assertIn("unchecked", out)

    def test_hub_error_other_than_404_exits_2(self):
        code, out, err = self.run_main(verify.HubError("HTTP 503"))
        self.assertEqual(code, 2)
        self.assertIn("503", err)

    def test_fetch_tree_follows_link_pages_and_maps_404_to_none(self):
        class Resp(io.BytesIO):
            def __init__(self, body, link=None):
                super().__init__(json.dumps(body).encode())
                self.headers = {"Link": link} if link else {}

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        urls: list[str] = []

        def opener(req, timeout=None):
            urls.append(req.full_url)
            if len(urls) == 1:
                return Resp([{"type": "file", "path": "a"}], '<https://huggingface.co/api/next?cursor=1>; rel="next"')
            return Resp([{"type": "file", "path": "b"}])

        got = verify.fetch_tree("jcdavis210/groundtruth-snapshots", urlopen=opener)
        self.assertEqual([e["path"] for e in got], ["a", "b"])
        self.assertIn("expand=1", urls[0])
        self.assertIn("/api/datasets/jcdavis210/groundtruth-snapshots/tree/main", urls[0])

        def gone(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

        self.assertIsNone(verify.fetch_tree("jcdavis210/groundtruth-snapshots", urlopen=gone))

        def boom(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 503, "Unavailable", {}, None)

        with self.assertRaises(verify.HubError):
            verify.fetch_tree("jcdavis210/groundtruth-snapshots", urlopen=boom)


if __name__ == "__main__":
    unittest.main(verbosity=2)
