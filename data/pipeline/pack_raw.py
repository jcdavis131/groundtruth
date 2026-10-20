"""Pack <data-root>/raw/ into one tar with an index.json, and refuse unless the index covers every committed manifest's requests[].sha256.

    python -I data/pipeline/pack_raw.py --dry-run      hash every file, print the sizes and the coverage count, write nothing
    python -I data/pipeline/pack_raw.py --out DIR      the same, then write DIR/raw.tar and DIR/index.json (never over an existing one)

The raw cache (net.py) holds each response body as <sha256 of url>.body beside a <sha256 of url>.json sidecar with its
url and retrievedAt; raw/ also holds the athletes cache and the county boundary zip. The pack takes every regular file
under raw/, sidecars included (they are the provenance), and nothing else: raw-stale-nid-2026-10-19/ sits beside raw/ in
the data root, not under it, and is not packed. A symlink or any other non-regular file under raw/ is a failure, not a
skip. Empty folders are not packed (a tar of files holds none).

Tar members are named raw/<path under raw/>, so `tar -xf raw.tar -C <data-root>` restores the cache. They are sorted by name,
with mtime 0, uid and gid 0 and mode 0644, and the tar is not compressed, so the same raw/ always gives the same bytes. The
dry run prints the exact byte size the tar will have; the size of a compressed tar has not been measured here. index.json
lists every member as {path, bytes, sha256} (path is the tar member name), the tar's own size and sha256, and the coverage.

Coverage. Every data/manifests/<collection>/<snapshot-id>.json has requests[], each pinning the sha256 of the body it got.
The pack hashes the bytes of every file (never trusting a sidecar's claim) and asks, for each distinct pinned sha256,
whether some indexed file has it. A pin with no file is a named failure (MISSING <snapshot> <purpose> <url> <sha256>) and the
exit code is 1; nothing is written. No manifests, a manifest without requests[], or a pin that is not 64 hex digits is a
refusal too: coverage of nothing is not coverage.

--out hashes first (the dry run's whole job), checks coverage, and only then writes, re-hashing each file as it goes into the
tar and stopping if one changed since the first pass. The tar and the index are written under .part names and renamed once
both are complete. Nothing here uploads anything. The pack never writes in the data root: --out writes only into the folder you
name, and refuses the data root itself and any folder inside it (raw/ included). Where the tar goes is Cam's call.

Standard library only and no sibling imports, because `python -I` leaves this folder off sys.path. The data root is
--data-root, else GROUNDTRUTH_DATA_ROOT, else <home>/datastore/groundtruth-snapshots, as in data/pipeline/read.py.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tarfile
from pathlib import Path
from typing import NamedTuple

REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFESTS = REPO / "data" / "manifests"
CHUNK = 1 << 20
HEX64 = re.compile(r"^[0-9a-f]{64}$")
FORMAT = tarfile.PAX_FORMAT
ENCODING = "utf-8"
ERRORS = "surrogateescape"
MISSING_SHOWN = 50  # named failures printed; the count of the rest is printed too


def default_data_root() -> Path:
    """GROUNDTRUTH_DATA_ROOT, else <home>/datastore/groundtruth-snapshots (read.py's rule, repeated: python -I can't import it)."""
    env = os.environ.get("GROUNDTRUTH_DATA_ROOT")
    return Path(env) if env else Path.home() / "datastore" / "groundtruth-snapshots"


class PackError(Exception):
    pass


class Entry(NamedTuple):
    path: str  # raw/<path under raw/>, with "/"; also the tar member name
    bytes: int
    sha256: str


class Pin(NamedTuple):
    snapshot: str
    purpose: str
    url: str
    sha256: str


class Coverage(NamedTuple):
    per_manifest: list  # (snapshot id, requests, distinct sha256, covered distinct sha256)
    requests: int
    distinct: int
    covered: int
    missing: list  # one Pin per distinct pinned sha256 that no indexed file has (the first request that pins it)


# ---------------------------------------------------------------- the walk and the hashes

def walk(raw: Path) -> list[tuple[str, Path]]:
    """Every regular file under raw/ as (path under raw/ with "/", file), sorted by that path."""
    raw = Path(raw)
    if not raw.is_dir():
        raise PackError(f"{raw} is not a folder")
    found: list[tuple[str, Path]] = []

    def go(d: str, prefix: str) -> None:
        with os.scandir(d) as it:
            for e in it:
                rel = prefix + e.name
                if e.is_symlink():
                    raise PackError(f"{rel} is a symlink; the pack takes regular files only")
                if e.is_dir(follow_symlinks=False):
                    go(e.path, rel + "/")
                elif e.is_file(follow_symlinks=False):
                    found.append((rel, Path(e.path)))
                else:
                    raise PackError(f"{rel} is neither a regular file nor a folder")

    go(str(raw), "")
    found.sort(key=lambda t: t[0])
    return found


def hash_file(path: Path) -> tuple[int, str]:
    h = hashlib.sha256()
    n = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
            n += len(chunk)
    return n, h.hexdigest()


def scan(raw: Path) -> list[Entry]:
    """The index: every file's size and the sha256 of the bytes read from it (a sidecar's claim is never consulted)."""
    entries = []
    for rel, p in walk(raw):
        n, digest = hash_file(p)
        if n != p.stat().st_size:
            raise PackError(f"raw/{rel} changed while it was being read")
        entries.append(Entry("raw/" + rel, n, digest))
    return entries


# ---------------------------------------------------------------- coverage

def load_pins(manifests: Path) -> tuple[list[Pin], int]:
    """Every requests[] entry of every committed manifest, and how many manifests there were."""
    files = sorted(Path(manifests).glob("*/*.json"))
    if not files:
        raise PackError(f"no manifests under {manifests} (expected <collection>/<snapshot-id>.json); coverage of nothing is not coverage")
    pins: list[Pin] = []
    for f in files:
        try:
            m = json.loads(f.read_text("utf8"))
        except ValueError as e:
            raise PackError(f"{f.name} is not JSON: {e}") from None
        if not isinstance(m, dict):
            raise PackError(f"{f.name} is not a manifest object")
        sid = str(m.get("snapshotId") or f.stem)
        reqs = m.get("requests")
        if not isinstance(reqs, list) or not reqs:
            raise PackError(f"{sid} has no requests[] to check")
        for i, r in enumerate(reqs):
            s = r.get("sha256") if isinstance(r, dict) else None
            if not (isinstance(s, str) and HEX64.match(s)):
                raise PackError(f"{sid} requests[{i}].sha256 is not 64 lowercase hex digits: {s!r}")
            pins.append(Pin(sid, str(r.get("purpose")), str(r.get("url")), s))
    return pins, len(files)


def coverage(entries: list[Entry], pins: list[Pin]) -> Coverage:
    have = {e.sha256 for e in entries}
    per: dict[str, dict] = {}
    missing: dict[str, Pin] = {}
    every: set[str] = set()
    for p in pins:
        d = per.setdefault(p.snapshot, {"requests": 0, "shas": set(), "covered": set()})
        d["requests"] += 1
        d["shas"].add(p.sha256)
        every.add(p.sha256)
        if p.sha256 in have:
            d["covered"].add(p.sha256)
        else:
            missing.setdefault(p.sha256, p)
    rows = [(sid, d["requests"], len(d["shas"]), len(d["covered"])) for sid, d in sorted(per.items())]
    return Coverage(rows, len(pins), len(every), len(every) - len(missing), list(missing.values()))


# ---------------------------------------------------------------- the tar

def member(path: str, size: int) -> tarfile.TarInfo:
    ti = tarfile.TarInfo(path)
    ti.size = size
    ti.mode = 0o644
    ti.mtime = 0
    ti.uid = ti.gid = 0
    ti.uname = ti.gname = ""
    ti.type = tarfile.REGTYPE
    return ti


def predicted_tar_bytes(entries: list[Entry]) -> int:
    """The exact size of the tar write_tar makes: each header (a long name adds a pax header), each body padded to 512,
    two zero blocks, then the whole padded to tarfile's record size."""
    total = 0
    for e in entries:
        total += len(member(e.path, e.bytes).tobuf(FORMAT, ENCODING, ERRORS)) + ((e.bytes + 511) // 512) * 512
    total += 2 * tarfile.BLOCKSIZE
    rem = total % tarfile.RECORDSIZE
    return total + (tarfile.RECORDSIZE - rem if rem else 0)


class _Out:
    """What tarfile writes to: counts and hashes every byte."""

    def __init__(self, f):
        self.f, self.n, self.h = f, 0, hashlib.sha256()

    def write(self, b: bytes) -> int:
        self.h.update(b)
        self.n += len(b)
        return self.f.write(b)

    def tell(self) -> int:
        return self.n

    def flush(self) -> None:
        self.f.flush()


class _In:
    """What tarfile reads a member from: counts and hashes every byte."""

    def __init__(self, f):
        self.f, self.n, self.h = f, 0, hashlib.sha256()

    def read(self, k: int = -1) -> bytes:
        b = self.f.read(k)
        self.h.update(b)
        self.n += len(b)
        return b


def write_tar(data_root: Path, entries: list[Entry], dest: Path) -> tuple[int, str]:
    """Write the tar to dest (which must not exist). Each file is hashed again on its way in and must still be what the index says."""
    with open(dest, "xb") as f:
        out = _Out(f)
        tf = tarfile.TarFile(fileobj=out, mode="w", format=FORMAT, encoding=ENCODING, errors=ERRORS, copybufsize=CHUNK)
        for e in entries:
            with open(Path(data_root) / e.path, "rb") as src:
                r = _In(src)
                tf.addfile(member(e.path, e.bytes), r)
                if r.n != e.bytes or src.read(1) or r.h.hexdigest() != e.sha256:
                    raise PackError(f"{e.path} changed between the hashing pass and the writing pass")
        tf.close()
        f.flush()
    return out.n, out.h.hexdigest()


def render_index(head: dict, entries: list[Entry]) -> str:
    """Valid JSON with one file entry per line, so a 24,000-line index is still greppable."""
    lines = [f" {json.dumps(k)}: {json.dumps(v)}" for k, v in head.items()]
    files = ",\n".join("  " + json.dumps({"path": e.path, "bytes": e.bytes, "sha256": e.sha256}) for e in entries)
    return "{\n" + ",\n".join(lines) + ',\n "files": [\n' + files + "\n ]\n}\n"


# ---------------------------------------------------------------- the run

def check_out(out: Path, root: Path) -> None:
    """--out may be anywhere except the data root and what is under it: the data root is read-only here, and raw/ sits in it."""
    out_r, root_r = out.resolve(), root.resolve()
    if out_r == root_r:
        raise PackError(f"--out {out} is the data root; the pack never writes in the data root")
    if root_r in out_r.parents:
        raise PackError(f"--out {out} is inside the data root {root}; the pack never writes in the data root")
    for name in ("raw.tar", "index.json", "raw.tar.part", "index.json.part"):
        if (out / name).exists():
            raise PackError(f"{out / name} already exists; this never overwrites a pack")
    if not out_r.parent.is_dir():
        raise PackError(f"the folder {out_r.parent} does not exist")


def report(entries: list[Entry], n_manifests: int, cov: Coverage, tar_bytes: int) -> None:
    kinds = {".body": [0, 0], ".json": [0, 0], "other": [0, 0]}
    for e in entries:
        k = ".body" if e.path.endswith(".body") else ".json" if e.path.endswith(".json") else "other"
        kinds[k][0] += 1
        kinds[k][1] += e.bytes
    print(f"raw/: {len(entries):,} files, {sum(e.bytes for e in entries):,} bytes")
    print("  " + ", ".join(f"{k} {c:,} ({b:,} bytes)" for k, (c, b) in kinds.items()))
    print(f"tar (uncompressed): {tar_bytes:,} bytes")
    print(f"manifests: {n_manifests}, requests: {cov.requests}, distinct request sha256: {cov.distinct}")
    for sid, reqs, distinct, covered in cov.per_manifest:
        print(f"  {sid}: {reqs} requests, {distinct} distinct, {covered} covered")
    pct = 100.0 * cov.covered / cov.distinct if cov.distinct else 0.0
    print(f"coverage: {cov.covered} of {cov.distinct} distinct request sha256 present in the index ({pct:.2f}%)")


def run(a: argparse.Namespace) -> int:
    root = Path(a.data_root or default_data_root())
    raw = root / "raw"
    if a.out is not None:
        check_out(a.out, root)
    print(f"data root: {root}")
    pins, n_manifests = load_pins(a.manifests)  # before the walk: a bad manifest fails cheaply
    entries = scan(raw)
    cov = coverage(entries, pins)
    predicted = predicted_tar_bytes(entries)
    report(entries, n_manifests, cov, predicted)
    if cov.missing:
        for p in cov.missing[:MISSING_SHOWN]:
            print(f"MISSING {p.snapshot} {p.purpose} {p.url} {p.sha256}", file=sys.stderr)
        if len(cov.missing) > MISSING_SHOWN:
            print(f"... and {len(cov.missing) - MISSING_SHOWN} more pinned sha256 with no file (not shown)", file=sys.stderr)
        print(f"refused: {len(cov.missing)} of {cov.distinct} distinct pinned request sha256 have no file in raw/; nothing was written", file=sys.stderr)
        return 1
    if a.out is None:
        return 0
    out = Path(a.out)
    out.mkdir(exist_ok=True)
    tar_part, idx_part = out / "raw.tar.part", out / "index.json.part"
    try:
        nbytes, tsha = write_tar(root, entries, tar_part)
        if nbytes != predicted:
            raise PackError(f"the tar has {nbytes} bytes, the size predicted from the index was {predicted}")
        head = {
            "format": "raw-pack/1",
            "tar": {"path": "raw.tar", "bytes": nbytes, "sha256": tsha},
            "counts": {"files": len(entries), "bytes": sum(e.bytes for e in entries)},
            "coverage": {
                "manifests": n_manifests,
                "requests": cov.requests,
                "distinctSha256": cov.distinct,
                "covered": cov.covered,
                "missing": len(cov.missing),
                "perManifest": [{"snapshotId": s, "requests": r, "distinctSha256": d, "covered": c} for s, r, d, c in cov.per_manifest],
            },
        }
        idx_part.write_bytes(render_index(head, entries).encode("utf8"))
        if (out / "raw.tar").exists() or (out / "index.json").exists():
            raise PackError(f"{out} gained a raw.tar or index.json while the pack was being written; not overwriting")
        tar_part.rename(out / "raw.tar")
        idx_part.rename(out / "index.json")
    except BaseException:
        for p in (tar_part, idx_part):
            p.unlink(missing_ok=True)
        raise
    print(f"wrote {out / 'raw.tar'}: {nbytes:,} bytes, sha256 {tsha}")
    print(f"wrote {out / 'index.json'}: {len(entries):,} files")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="hash everything and print sizes and the coverage count; write nothing")
    mode.add_argument("--out", type=Path, metavar="DIR", help="after the checks pass, write DIR/raw.tar and DIR/index.json (never over an existing one)")
    ap.add_argument("--data-root", type=Path, help="default: GROUNDTRUTH_DATA_ROOT or <home>/datastore/groundtruth-snapshots")
    ap.add_argument("--manifests", type=Path, default=DEFAULT_MANIFESTS, help="the committed manifests (default data/manifests)")
    a = ap.parse_args(argv)
    try:
        return run(a)
    except (PackError, OSError) as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
