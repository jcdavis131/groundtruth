"""HTTP for the snapshot builder: one request a second, IPv4, a disk cache outside git, and a log entry per
response in the manifest's `requests` shape.

The cache lives under <data-root>/raw/: <sha256 of the URL>.body holds the response body as received, and
<sha256 of the URL>.json holds {url, status, retrievedAt, bytes, sha256}. Only 200 answers are cached. A
cached answer is checked against its sha256 before use and keeps its original retrievedAt, so a rerun's
manifest says when each body was really fetched.
"""

from __future__ import annotations

import hashlib
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

UA = "groundtruth-snapshots/0.1 (eye.jcamd.com)"

# Resolve IPv4 only: this box's IPv6 route to some hosts stalls (the probes used curl -4 for the same reason).
_getaddrinfo = socket.getaddrinfo


def _ipv4_only(host, port, family=0, type=0, proto=0, flags=0):
    return _getaddrinfo(host, port, socket.AF_INET, type, proto, flags)


socket.getaddrinfo = _ipv4_only


def utc_now() -> str:
    """ISO 8601 UTC with milliseconds and a Z, the manifest's utc shape."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class FetchError(RuntimeError):
    pass


class Fetcher:
    """GET with a minimum interval between network requests (start to start) and a disk cache."""

    def __init__(self, raw_dir: Path, min_interval_s: float = 1.0, timeout_s: float = 90.0, tries: int = 4):
        self.raw = Path(raw_dir)
        self.raw.mkdir(parents=True, exist_ok=True)
        self.min_interval_s = min_interval_s
        self.timeout_s = timeout_s
        self.tries = tries
        self._last = 0.0
        self.log: list[dict] = []  # every response, in order, in the manifest's request shape
        self.network = 0  # requests that went to the network in this run
        self.cached = 0
        self.transport_errors = 0  # attempts that got no HTTP response at all (not in the manifest)

    def _paths(self, url: str) -> tuple[Path, Path]:
        k = sha256(url.encode("utf8"))
        return self.raw / f"{k}.body", self.raw / f"{k}.json"

    def _cached(self, url: str):
        body_p, meta_p = self._paths(url)
        if not (body_p.exists() and meta_p.exists()):
            return None
        meta = json.loads(meta_p.read_text("utf8"))
        body = body_p.read_bytes()
        if meta.get("url") != url or meta.get("status") != 200 or sha256(body) != meta.get("sha256") or len(body) != meta.get("bytes"):
            return None  # a damaged or foreign entry is refetched, never trusted
        return body, meta

    def _throttle(self):
        wait = self._last + self.min_interval_s - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def get(self, url: str, purpose: str) -> bytes:
        hit = self._cached(url)
        if hit:
            body, meta = hit
            self.cached += 1
            self.log.append({"purpose": purpose, **{k: meta[k] for k in ("url", "status", "retrievedAt", "bytes", "sha256")}})
            return body
        delay = 5.0
        for attempt in range(1, self.tries + 1):
            self._throttle()
            self.network += 1
            status, body, at = None, b"", utc_now()
            try:
                req = urllib.request.Request(url, headers={"user-agent": UA, "accept": "application/json"})
                with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
                    status, body = r.status, r.read()
            except urllib.error.HTTPError as e:
                status, body = e.code, e.read() or b""
            except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError) as e:
                self.transport_errors += 1
                print(f"  transport error ({attempt}/{self.tries}) {url}: {e}", file=sys.stderr, flush=True)
            if status is not None:
                entry = {"purpose": purpose, "url": url, "status": status, "retrievedAt": at, "bytes": len(body), "sha256": sha256(body)}
                self.log.append(entry)
                if status == 200:
                    body_p, meta_p = self._paths(url)
                    body_p.write_bytes(body)
                    meta_p.write_text(json.dumps({k: entry[k] for k in ("url", "status", "retrievedAt", "bytes", "sha256")}), "utf8")
                    return body
                print(f"  HTTP {status} ({attempt}/{self.tries}) {url}", file=sys.stderr, flush=True)
                if status < 500 and status != 429:
                    break  # a 4xx other than 429 won't change on retry
            if attempt < self.tries:
                time.sleep(delay)
                delay *= 3
        raise FetchError(f"{url} failed after {self.tries} tries")

    def get_json(self, url: str, purpose: str):
        return json.loads(self.get(url, purpose).decode("utf8"))
