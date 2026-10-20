"""Check what the Hugging Face Hub stored against the committed manifests. Keyless, standard library only.

    python -I data/hf/verify.py       compare and print a table; exit 0 (all match, or not published yet), 1 (mismatch), 2 (Hub error)

It GETs the dataset repo's file tree with expand=1 (https://huggingface.co/api/datasets/<repo>/tree/main?recursive=1&expand=1,
following Link pages) and compares, for each file publish.py would upload, what the Hub says it stores:

- a file the Hub keeps in LFS: the Hub's lfs.oid is the file's sha256. It is compared with the manifest's files[].sha256,
  or for the companies bundle with its .sha256 sidecar.
- a small file: the Hub's oid is the git blob oid, sha1(b"blob <size>\\0" + bytes). It is compared with the oid of the
  committed manifest.json, the dataset card data/hf/README.md or the sidecar. A small manifest-listed file with no local
  copy (the data root is not in git, so CI has none) is reported "unchecked" and never counted as a match.

A repo an anonymous request cannot see (404, or 401/403, which the Hub also answers for a private repo) or one with no files is "not published yet": exit 0 with that reason. A file the repo should
hold and doesn't, or a hash that differs, exits 1. Any other Hub failure exits 2. It reports; nothing is uploaded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script's folder off sys.path
import publish  # noqa: E402

API = "https://huggingface.co/api/datasets"
UA = "groundtruth-hf-verify/1.0 (reads the public dataset tree; github.com/jcdavis131/groundtruth)"


class HubError(Exception):
    """The Hub answered with something other than a tree or a 404."""


def git_blob_oid(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def fetch_tree(repo: str, rev: str = "main", urlopen=urllib.request.urlopen) -> list[dict] | None:
    """Every entry of the repo's tree, or None when the repo is not visible anonymously (401, 403, 404)."""
    url: str | None = f"{API}/{repo}/tree/{rev}?recursive=1&expand=1"
    out: list[dict] = []
    while url:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urlopen(req, timeout=30) as resp:
                page = json.loads(resp.read().decode("utf8"))
                link = resp.headers.get("Link") or ""
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404):
                return None
            raise HubError(f"HTTP {e.code} from {url}") from e
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise HubError(f"{type(e).__name__}: {e}") from e
        if not isinstance(page, list):
            raise HubError(f"{url} did not return a list")
        out.extend(page)
        m = re.search(r'<([^>]+)>;\s*rel="next"', link)
        url = m.group(1) if m else None
    return out


@dataclass
class Want:
    path: str
    sha256: str | None = None  # expected sha256 of the whole file, when a manifest or sidecar gives it
    local: Path | None = None  # the bytes, when they are here (committed files always; data-root files if present)
    source: str = ""


def wants(manifests: Path, readme: Path, data_root: Path | None) -> tuple[list[Want], list[str]]:
    """What the Hub should hold, from the committed manifests, and notes on what can't be expected from here."""
    out: list[Want] = []
    notes: list[str] = []
    for mp in sorted(Path(manifests).glob("*/*.json")):
        m = json.loads(mp.read_text("utf8"))
        sid = m["snapshotId"]
        for f in m.get("files") or []:
            local = data_root / "snapshots" / sid / f["path"] if data_root else None
            out.append(Want(f"snapshots/{sid}/{f['path']}", f.get("sha256"), local if local and local.is_file() else None, f"manifest files[] ({sid})"))
        out.append(Want(f"snapshots/{sid}/manifest.json", None, mp, "committed manifest"))
    for rel in publish.EXTRA_FILES:
        side = data_root / (rel + ".sha256") if data_root else None
        if not side or not side.is_file():
            notes.append(f"{rel} and its sidecar are not expected: no sidecar under the data root")
            continue
        local = data_root / rel
        out.append(Want(rel, publish.read_sidecar(side), local if local.is_file() else None, f"sidecar {rel}.sha256"))
        out.append(Want(rel + ".sha256", None, side, "sidecar"))
    out.append(Want("README.md", None, Path(readme), "dataset card"))
    return out, notes


def compare(want: Want, entry: dict | None) -> tuple[str, str]:
    """('ok' | 'FAIL' | 'unchecked', detail)."""
    if entry is None:
        return "FAIL", "not on the Hub"
    lfs = entry.get("lfs")
    if lfs:
        sha = want.sha256
        if sha is None and want.local is not None:
            sha = hashlib.sha256(want.local.read_bytes()).hexdigest()
        if sha is None:
            return "unchecked", "LFS file with no expected sha256 here"
        if lfs.get("oid") != sha:
            return "FAIL", f"sha256 {str(lfs.get('oid'))[:12]} on the Hub, the {want.source} says {sha[:12]}"
        return "ok", f"sha256 {sha[:12]}"
    if want.local is None:
        return "unchecked", f"small file (blob oid {str(entry.get('oid'))[:12]}) with no local copy to compare"
    data = want.local.read_bytes()
    if want.sha256 is not None and hashlib.sha256(data).hexdigest() != want.sha256:
        return "FAIL", f"the local copy no longer matches the {want.source}; nothing to compare the Hub with"
    oid = git_blob_oid(data)
    if entry.get("oid") != oid:
        return "FAIL", f"blob oid {str(entry.get('oid'))[:12]} on the Hub, {oid[:12]} for the {want.source}"
    return "ok", f"blob oid {oid[:12]}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo-id", default=publish.DEFAULT_REPO_ID)
    ap.add_argument("--manifests", type=Path, default=publish.DEFAULT_MANIFESTS)
    ap.add_argument("--readme", type=Path, default=publish.DEFAULT_README)
    ap.add_argument("--data-root", type=Path, help="optional: sidecars and small files to compare (default: GROUNDTRUTH_DATA_ROOT or <home>/datastore/groundtruth-snapshots, used only if present)")
    args = ap.parse_args(argv)
    root = Path(args.data_root) if args.data_root else publish.default_data_root()
    root = root if root.is_dir() else None

    try:
        tree = fetch_tree(args.repo_id)
    except HubError as e:
        print(f"hub error: {e}", file=sys.stderr)
        return 2
    files = [e for e in (tree or []) if e.get("type") == "file"]
    if not files:
        why = "the repo is absent or private: an anonymous request gets 401 or 404 for both" if tree is None else "the repo has no files"
        print(f"not published yet: {why}: {args.repo_id}. Nothing to compare; exit 0.")
        return 0
    by_path = {e["path"]: e for e in files}
    ws, notes = wants(args.manifests, args.readme, root)
    bad: list[str] = []
    unchecked = 0
    matched = 0
    for w in ws:
        status, detail = compare(w, by_path.get(w.path))
        print(f"{status:9} {w.path}  {detail}")
        if status == "FAIL":
            bad.append(f"  {w.path}: {detail}")
        elif status == "unchecked":
            unchecked += 1
        else:
            matched += 1
    for n in notes:
        print(f"note: {n}")
    for p in sorted(set(by_path) - {w.path for w in ws}):
        print(f"note: {p} is on the Hub and in no manifest")
    print(f"\n{matched} of {len(ws)} files match the Hub's stored hashes; {unchecked} unchecked; {len(bad)} mismatched.")
    if bad:
        print(f"{len(bad)} file(s) differ from the Hub:", file=sys.stderr)
        print("\n".join(bad), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
