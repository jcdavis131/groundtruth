"""Publish groundtruth's snapshots to one Hugging Face dataset repo, once a token exists.

    python -I data/hf/publish.py                dry run (the default): check every file, print the table, upload nothing
    python -I data/hf/publish.py --upload       the same checks, then create or update the dataset repo and upload

The file list is built from the committed manifests, data/manifests/<collection>/<snapshot-id>.json. For each
manifest, every file in its files[] is read from <data-root>/snapshots/<snapshot-id>/ and its byte count and sha256
are compared with the manifest's entry; the committed manifest itself goes along as snapshots/<snapshot-id>/manifest.json
(the committed copy is the one with embeddableFields; the copy next to the files in the data root is not). The
companies full copy, <data-root>/companies/companies.full.<date>.json, is checked against its .sha256 sidecar, and
the sidecar goes along too. data/hf/README.md is the dataset card.

A missing file or a mismatch is printed, the exit code is 1, and nothing is uploaded. huggingface_hub is imported
only under --upload, so the dry run needs nothing beyond the standard library. The token is whatever
huggingface_hub finds on its own (HF_TOKEN, or `hf auth login`); this script never takes one on the command line.

The data root is --data-root, else GROUNDTRUTH_DATA_ROOT, else <home>/datastore/groundtruth-snapshots, as in
data/pipeline/read.py.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DEFAULT_MANIFESTS = REPO / "data" / "manifests"
DEFAULT_README = HERE / "README.md"
DEFAULT_REPO_ID = "jcdavis210/groundtruth-snapshots"

# Files that no manifest lists, relative to the data root. Each must have a sidecar <path>.sha256 whose first
# word is the hex digest. A new companies pull adds its line here.
EXTRA_FILES = ["companies/companies.full.2026-10-20.json"]

HEX64 = re.compile(r"^[0-9a-f]{64}$")


class PublishRefused(Exception):
    """A file list that can't be built: a manifest without files, a path that leaves its folder, a bad sidecar."""


@dataclass
class Item:
    """One file to publish: where it lands in the dataset repo, where it is here, and what its hash is checked against."""

    path_in_repo: str
    local: Path
    expected_sha: str | None = None
    expected_bytes: int | None = None
    against: str = "nothing"
    sha256: str | None = None
    bytes: int | None = None
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def default_data_root() -> Path:
    env = os.environ.get("GROUNDTRUTH_DATA_ROOT")
    return Path(env) if env else Path.home() / "datastore" / "groundtruth-snapshots"


def sha256_file(p: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            n += len(chunk)
    return h.hexdigest(), n


def _inside(rel: str) -> bool:
    parts = rel.replace("\\", "/").split("/")
    return bool(rel) and not rel.startswith("/") and ".." not in parts and "" not in parts


def read_sidecar(side: Path) -> str:
    """The hex digest in a .sha256 sidecar (`<hex>` or `<hex>  <name>`, as sha256sum writes it)."""
    words = side.read_text("utf8").split()
    if not words or not HEX64.match(words[0]):
        raise PublishRefused(f"{side} does not start with a 64-character lowercase hex sha256")
    return words[0]


def plan(
    manifests: Path = DEFAULT_MANIFESTS,
    data_root: Path | None = None,
    extra: list[str] = EXTRA_FILES,
    readme: Path = DEFAULT_README,
) -> list[Item]:
    """The files to publish, in upload order, before any of them is read."""
    root = Path(data_root or default_data_root())
    items: list[Item] = []
    paths = sorted(Path(manifests).glob("*/*.json"))
    if not paths:
        raise PublishRefused(f"no committed manifests under {manifests}")
    for mp in paths:
        m = json.loads(mp.read_text("utf8"))
        sid = m.get("snapshotId")
        if not sid or mp.stem != sid or mp.parent.name != m.get("collection"):
            raise PublishRefused(f"{mp} is not the committed manifest of its own snapshot id and collection")
        files = m.get("files") or []
        if not files:
            raise PublishRefused(f"{mp} lists no files")
        folder = root / "snapshots" / sid
        for f in files:
            rel = f["path"]
            if not _inside(rel):
                raise PublishRefused(f"{mp}: file path {rel!r} leaves the snapshot folder")
            sha = f.get("sha256")
            if not isinstance(sha, str) or not HEX64.match(sha):
                raise PublishRefused(f"{mp}: {rel} has no 64-character lowercase hex sha256")
            items.append(
                Item(f"snapshots/{sid}/{rel}", folder / rel, sha, f.get("bytes"), f"manifest files[] ({sid})")
            )
        items.append(Item(f"snapshots/{sid}/manifest.json", mp, against="committed copy"))
    for rel in extra:
        if not _inside(rel):
            raise PublishRefused(f"extra file path {rel!r} leaves the data root")
        local = root / rel
        side = local.with_name(local.name + ".sha256")
        if not side.is_file():
            raise PublishRefused(f"{side} is missing: every extra file needs its .sha256 sidecar")
        items.append(Item(rel, local, read_sidecar(side), None, f"sidecar {rel}.sha256"))
        items.append(Item(rel + ".sha256", side, against="sidecar"))
    items.append(Item("README.md", Path(readme), against="dataset card"))
    return items


def check(items: list[Item]) -> list[Item]:
    """Reads every file. Fills in sha256 and bytes, and lists each problem on its item."""
    for it in items:
        if not it.local.is_file():
            it.problems.append(f"missing: {it.local}")
            continue
        it.sha256, it.bytes = sha256_file(it.local)
        if it.expected_bytes is not None and it.bytes != it.expected_bytes:
            it.problems.append(f"{it.bytes} bytes, the {it.against} says {it.expected_bytes}")
        if it.expected_sha is not None and it.sha256 != it.expected_sha:
            it.problems.append(f"sha256 {it.sha256[:12]}, the {it.against} says {it.expected_sha[:12]}")
    return items


def table(items: list[Item]) -> str:
    rows = [("path", "bytes", "sha256", "checked against", "status")]
    for it in items:
        rows.append(
            (
                it.path_in_repo,
                "" if it.bytes is None else f"{it.bytes:,}",
                "" if it.sha256 is None else it.sha256[:12],
                it.against,
                "ok" if it.ok else "FAIL",
            )
        )
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    out = []
    for n, r in enumerate(rows):
        cells = [r[i].rjust(widths[i]) if i == 1 else r[i].ljust(widths[i]) for i in range(len(r))]
        out.append("  ".join(cells).rstrip())
        if n == 0:
            out.append("  ".join("-" * w for w in widths))
    return "\n".join(out)


def upload(items: list[Item], repo_id: str, private: bool) -> str:
    """Creates the dataset repo if it doesn't exist, then uploads every item in one commit. Returns the commit URL."""
    from huggingface_hub import CommitOperationAdd, HfApi  # only here, so the dry run needs no install

    api = HfApi()
    who = api.whoami()
    api.create_repo(repo_id, repo_type="dataset", private=private, exist_ok=True)
    ops = [CommitOperationAdd(path_in_repo=it.path_in_repo, path_or_fileobj=str(it.local)) for it in items]
    total = sum(it.bytes or 0 for it in items)
    info = api.create_commit(
        repo_id=repo_id,
        repo_type="dataset",
        operations=ops,
        commit_message=f"groundtruth snapshots: {len(ops)} files, {total:,} bytes, from data/hf/publish.py",
    )
    print(f"uploaded as {who.get('name', '?')} to {repo_id}: {info.commit_url}")
    return str(info.commit_url)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="check and print the table, upload nothing (the default)")
    mode.add_argument("--upload", action="store_true", help="after the checks pass, create or update the repo and upload")
    ap.add_argument("--repo-id", default=DEFAULT_REPO_ID, help=f"dataset repo on Hugging Face (default {DEFAULT_REPO_ID})")
    ap.add_argument("--data-root", type=Path, help="where the snapshot files live (default: GROUNDTRUTH_DATA_ROOT or <home>/datastore/groundtruth-snapshots)")
    ap.add_argument("--manifests", type=Path, default=DEFAULT_MANIFESTS, help="the committed manifests (default data/manifests)")
    ap.add_argument("--readme", type=Path, default=DEFAULT_README, help="the dataset card (default data/hf/README.md)")
    ap.add_argument("--public", action="store_true", help="create the repo public; the default creates it private, and an existing repo keeps its setting")
    args = ap.parse_args(argv)

    try:
        items = plan(args.manifests, args.data_root, readme=args.readme)
    except PublishRefused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    check(items)
    print(f"data root: {Path(args.data_root or default_data_root())}")
    print(f"repo: {args.repo_id} (dataset)")
    print(table(items))
    bad = [it for it in items if not it.ok]
    if bad:
        print(f"\n{len(bad)} file(s) failed; nothing uploaded:", file=sys.stderr)
        for it in bad:
            for p in it.problems:
                print(f"  {it.path_in_repo}: {p}", file=sys.stderr)
        return 1
    print(f"\n{len(items)} files, {sum(it.bytes or 0 for it in items):,} bytes, every checked hash matches.")
    if not args.upload:
        print("dry run: nothing uploaded. Add --upload to publish.")
        return 0
    try:
        import huggingface_hub  # noqa: F401
    except ImportError:
        print("refused: --upload needs huggingface_hub (python -m pip install huggingface_hub) and a token (hf auth login or HF_TOKEN)", file=sys.stderr)
        return 2
    try:
        upload(items, args.repo_id, private=not args.public)
    except Exception as e:  # a missing token, a refused repo, a network failure: say which and stop
        print(f"upload failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
