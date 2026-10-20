"""publish.py refuses a file whose sha256 or size differs from its manifest, passes one that matches, and never
imports huggingface_hub unless asked to upload.

    python -I data/hf/test_publish.py

Everything happens in a temporary data root with a fixture manifest and small files. No network, no install.
"""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script's folder off sys.path
import publish  # noqa: E402

SID = "nid-dams.testland.2026-10-19"
EXTRA = "companies/companies.full.2026-10-20.json"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gt-hf-"))
        self.root = self.tmp / "data-root"
        self.manifests = self.tmp / "manifests"
        self.readme = self.tmp / "README.md"
        self.readme.write_text("---\npretty_name: test\n---\n", "utf8")
        self.records = b'{"id":"nid:TX00001"}\n{"id":"nid:TX00002"}\n'
        folder = self.root / "snapshots" / SID
        folder.mkdir(parents=True)
        (folder / "records.jsonl").write_bytes(self.records)
        self.manifest = {
            "schemaVersion": "manifest/1",
            "snapshotId": SID,
            "collection": "nid-dams",
            "recordCount": 2,
            "files": [{"path": "records.jsonl", "format": "jsonl", "sha256": sha(self.records), "bytes": len(self.records), "records": 2}],
        }
        self.mp = self.manifests / "nid-dams" / f"{SID}.json"
        self.mp.parent.mkdir(parents=True)
        self.write_manifest()
        self.companies = b'{"source":"test","companies":[]}\n'
        cp = self.root / EXTRA
        cp.parent.mkdir(parents=True)
        cp.write_bytes(self.companies)
        self.sidecar = cp.with_name(cp.name + ".sha256")
        self.sidecar.write_text(sha(self.companies) + "\n", "utf8")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def write_manifest(self):
        self.mp.write_text(json.dumps(self.manifest, indent=1), "utf8")

    def run_main(self, *extra: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = publish.main(["--data-root", str(self.root), "--manifests", str(self.manifests), "--readme", str(self.readme), *extra])
        return code, out.getvalue(), err.getvalue()

    def test_matching_sha_passes_and_prints_every_file(self):
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        for path in (f"snapshots/{SID}/records.jsonl", f"snapshots/{SID}/manifest.json", EXTRA, EXTRA + ".sha256", "README.md"):
            self.assertIn(path, out)
        self.assertIn(sha(self.records)[:12], out)
        self.assertIn(f"{len(self.records):,}", out)
        self.assertIn("nothing uploaded", out)
        self.assertEqual(err, "")

    def test_mismatched_sha_fails(self):
        self.manifest["files"][0]["sha256"] = "0" * 64
        self.write_manifest()
        code, out, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("FAIL", out)
        self.assertIn("records.jsonl: sha256", err)
        self.assertIn("nothing uploaded", err)

    def test_changed_file_fails(self):
        (self.root / "snapshots" / SID / "records.jsonl").write_bytes(self.records + b"x")
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("bytes, the manifest", err)

    def test_missing_file_fails(self):
        (self.root / "snapshots" / SID / "records.jsonl").unlink()
        code, out, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("missing", err)

    def test_sidecar_mismatch_fails(self):
        self.sidecar.write_text("f" * 64 + "  companies.full.2026-10-20.json\n", "utf8")
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn(f"{EXTRA}: sha256", err)

    def test_sidecar_that_is_not_a_digest_is_refused(self):
        self.sidecar.write_text("not a hash\n", "utf8")
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("refused", err)

    def test_manifest_path_that_leaves_the_folder_is_refused(self):
        self.manifest["files"][0]["path"] = "../records.jsonl"
        self.write_manifest()
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("leaves the snapshot folder", err)

    def test_dry_run_never_imports_huggingface_hub(self):
        before = sys.modules.pop("huggingface_hub", None)
        sys.modules["huggingface_hub"] = None  # makes any import of it raise ImportError
        try:
            code, out, _ = self.run_main("--dry-run")
            self.assertEqual(code, 0)
            self.assertIn("nothing uploaded", out)
        finally:
            del sys.modules["huggingface_hub"]
            if before is not None:
                sys.modules["huggingface_hub"] = before

    def test_upload_without_huggingface_hub_exits_2_after_the_checks(self):
        before = sys.modules.pop("huggingface_hub", None)
        sys.modules["huggingface_hub"] = None
        try:
            code, out, err = self.run_main("--upload")
            self.assertEqual(code, 2)
            self.assertIn("every checked hash matches", out)
            self.assertIn("needs huggingface_hub", err)
        finally:
            del sys.modules["huggingface_hub"]
            if before is not None:
                sys.modules["huggingface_hub"] = before

    def stub_hub(self):
        """A stand-in huggingface_hub that records what --upload would send. No network."""
        calls: list[tuple] = []

        class HfApi:
            def whoami(self):
                calls.append(("whoami",))
                return {"name": "stub"}

            def create_repo(self, repo_id, repo_type, private, exist_ok):
                calls.append(("create_repo", repo_id, repo_type, private, exist_ok))

            def create_commit(self, repo_id, repo_type, operations, commit_message):
                calls.append(("create_commit", repo_id, repo_type, [(o.path_in_repo, o.path_or_fileobj) for o in operations]))
                return types.SimpleNamespace(commit_url=f"https://huggingface.co/datasets/{repo_id}/commit/stub")

        class CommitOperationAdd:
            def __init__(self, path_in_repo, path_or_fileobj):
                self.path_in_repo, self.path_or_fileobj = path_in_repo, path_or_fileobj

        mod = types.ModuleType("huggingface_hub")
        mod.HfApi, mod.CommitOperationAdd = HfApi, CommitOperationAdd
        return mod, calls

    def test_upload_sends_every_checked_file_in_one_commit(self):
        mod, calls = self.stub_hub()
        before = sys.modules.pop("huggingface_hub", None)
        sys.modules["huggingface_hub"] = mod
        try:
            code, out, err = self.run_main("--upload", "--repo-id", "someone/somewhere")
        finally:
            del sys.modules["huggingface_hub"]
            if before is not None:
                sys.modules["huggingface_hub"] = before
        self.assertEqual(code, 0, err)
        self.assertEqual([c[0] for c in calls], ["whoami", "create_repo", "create_commit"])
        self.assertEqual(calls[1], ("create_repo", "someone/somewhere", "dataset", True, True))
        paths = [p for p, _ in calls[2][3]]
        self.assertEqual(paths, [f"snapshots/{SID}/records.jsonl", f"snapshots/{SID}/manifest.json", EXTRA, EXTRA + ".sha256", "README.md"])
        self.assertEqual(calls[2][3][1][1], str(self.mp))  # the committed manifest, not a copy in the data root
        self.assertIn("uploaded as stub", out)

    def test_upload_is_not_attempted_when_a_check_fails(self):
        self.manifest["files"][0]["sha256"] = "0" * 64
        self.write_manifest()
        mod, calls = self.stub_hub()
        before = sys.modules.pop("huggingface_hub", None)
        sys.modules["huggingface_hub"] = mod
        try:
            code, _, err = self.run_main("--upload")
        finally:
            del sys.modules["huggingface_hub"]
            if before is not None:
                sys.modules["huggingface_hub"] = before
        self.assertEqual(code, 1)
        self.assertEqual(calls, [])
        self.assertIn("nothing uploaded", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)
