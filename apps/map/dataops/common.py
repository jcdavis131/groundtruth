#!/usr/bin/env python3
"""Shared plumbing for the eye.jcamd.com data warehouse.

Layout (DATAOPS_ROOT, default ~/workspace/dataops-warehouse):
    raw/<dataset>/<pull_id>/payload          immutable bytes from the source
    raw/<dataset>/<pull_id>/meta.json        pull provenance (url, pulled_at, sha256)
    staged/<dataset>.csv                     validated, deduped canonical history
    frames/<name>.csv                         modeling frames (point-in-time correct)
    manifests/<dataset>.json                  pull history + freshness + row counts
    models/<model_id>/                        trained artifacts + metrics + forecasts

Rules, all binding:
- raw/ is append-only. Never edit a payload; fix forward with a new pull.
- staged/ is rebuilt deterministically from raw/ (or incrementally merged with
  dedupe on the dataset's natural key). Rebuilding from raw must reproduce it.
- Frames never look ahead: every feature is a strictly positive lag of data
  known on or before the row date. Verification gates fail closed.
"""
import csv
import hashlib
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

UA = "eye.jcamd.com-dataops/0.1 (+https://eye.jcamd.com; research data warehouse)"

ROOT = os.environ.get("DATAOPS_ROOT", os.path.expanduser("~/workspace/dataops-warehouse"))


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_dirs(*paths: str) -> None:
    for p in paths:
        os.makedirs(p, exist_ok=True)


def root_path(*parts: str) -> str:
    p = os.path.join(ROOT, *parts)
    ensure_dirs(os.path.dirname(p))
    return p


def http_get(url: str, params: dict | None = None, timeout: int = 60,
             retries: int = 3, accept: str | None = None) -> bytes:
    """GET with the house user-agent, retries, and honest failure."""
    if params:
        q = urllib.parse.urlencode(params)
        url = url + ("&" if "?" in url else "?") + q
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            if accept:
                req.add_header("Accept", accept)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - we retry then surface
            last = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"GET failed after {retries} attempts: {url}: {last}")


def http_json(url: str, params: dict | None = None, timeout: int = 60,
              retries: int = 3):
    return json.loads(http_get(url, params, timeout, retries,
                               accept="application/json").decode("utf-8", "replace"))


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def write_raw(dataset: str, payload: bytes, filename: str = "payload",
              extra_meta: dict | None = None) -> str:
    """Store an immutable raw pull; returns the pull dir."""
    pull_id = utcnow().replace(":", "").replace("-", "")
    d = os.path.join(ROOT, "raw", dataset, pull_id)
    ensure_dirs(d)
    with open(os.path.join(d, filename), "wb") as f:
        f.write(payload)
    meta = {"dataset": dataset, "pull_id": pull_id, "pulled_at": utcnow(),
            "filename": filename, "bytes": len(payload),
            "sha256": sha256_bytes(payload)}
    if extra_meta:
        meta.update(extra_meta)
    with open(os.path.join(d, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    return d


def manifest_path(dataset: str) -> str:
    return root_path("manifests", f"{dataset}.json")


def load_manifest(dataset: str) -> dict:
    p = manifest_path(dataset)
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {"dataset": dataset, "pulls": []}


def record_manifest(dataset: str, pull: dict) -> None:
    m = load_manifest(dataset)
    m["pulls"].append(pull)
    m["last_pull"] = pull.get("pulled_at")
    m["last_rows"] = pull.get("rows")
    m["last_status"] = pull.get("status")
    with open(manifest_path(dataset), "w") as f:
        json.dump(m, f, indent=2)


def read_csv_rows(path: str) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def write_csv_rows(path: str, rows: list[dict], fieldnames: list[str]) -> None:
    ensure_dirs(os.path.dirname(path))
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def stage_path(dataset: str) -> str:
    return os.path.join(ROOT, "staged", f"{dataset}.csv")


def fail(msg: str) -> "typing.NoReturn":  # noqa: F821
    raise SystemExit(f"dataops: {msg}")


import typing  # noqa: E402  (kept at bottom so fail() reads clean above)
