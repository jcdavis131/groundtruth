"""The publishers' terms pages behind data/LICENSES.md: fetch each once, check the sentence the row quotes is on the
page (or that the page says nothing about a licence), and write data/licenses.lock.json.

    python -I data/pipeline/licenses_fetch.py --write    fetch every target, check it, rewrite data/licenses.lock.json
    python -I data/pipeline/licenses_fetch.py --check    fetch the lock's URLs again and report, never writing

Each request is one GET, one second apart at most per host, with the pipeline's own User-Agent (net.UA); SEC hosts get
the one string the SEC asks for. Redirects are followed by hand, one request each, so the pace holds on every hop. A
response is read as UTF-8, or as Windows-1252 when it is not UTF-8 (the SEC and NPS pages are). HTML is reduced to its
visible text, PDF to the text in its Flate streams, JSON to its string values.

A quote is checked as a substring of the page text with typographic quotes written straight and all whitespace
removed, so a line break or a stray space inside a PDF word does not matter. That is the durable check. The page's
sha256 and byte count are recorded too, but a CMS page (census.gov, nps.gov) changes without its terms changing, so
--check reports "sha256 differs" as information and fails only on a status other than 200, a quote that is no longer on
the page, or a "states no licence" page that now mentions one. This is not run in CI: a publisher being down should not
fail a pull request.

A target with an emptyField (the USACE FeatureServer, whose JSON has a copyrightText) also records that top-level field of the
JSON response in the lock, and is refused unless it is the empty string: data/LICENSES.md says the service's copyrightText is
empty, and data/schema/licenses.test.mjs holds that sentence to the lock's copyrightText. --check reads the field again.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import net  # noqa: E402  (its UA, and the IPv4-only resolver this box needs)

LOCK = HERE.parent / "licenses.lock.json"
SEC_UA = "embedding-atlas/0.1 contact: jcdavis131@gmail.com"
MIN_INTERVAL_S = 1.05
MAX_HOPS = 5

# One entry per terms URL in data/LICENSES.md, in the file's order. kind "quote": the page carries `quote`.
# kind "no-licence": the page's visible text has no match for `searched` (a licence or copyright word). emptyField: a top-level
# string field of the JSON response that the row says is empty; the lock records it, and it must be "".
TARGETS = [
    {
        "publisher": "U.S. Army Corps of Engineers (USACE), National Inventory of Dams",
        "url": "https://nid.sec.usace.army.mil/",
        "kind": "no-licence",
        "searched": r"licen[cs]e|public domain|copyright|terms of use|permission",
    },
    {
        "publisher": "U.S. Army Corps of Engineers (USACE), National Inventory of Dams",
        "url": "https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer?f=pjson",
        "kind": "no-licence",
        "searched": r"licen[cs]e|public domain|copyright|terms of use|permission",
        "emptyField": "copyrightText",
    },
    {
        "publisher": "U.S. Department of Education, National Center for Education Statistics (NCES)",
        "url": "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1?f=pjson",
        "kind": "quote",
        "quote": "All information contained in this file is in the public domain.",
    },
    {
        "publisher": "U.S. Department of Education, National Center for Education Statistics (NCES)",
        "url": "https://nces.ed.gov/about/public-access-research",
        "kind": "quote",
        "quote": "is in the public domain and may be reproduced, published, linked to, or otherwise used",
    },
    {
        "publisher": "National Park Service (NPS), National Register of Historic Places",
        "url": "https://www.nps.gov/aboutus/disclaimer.htm",
        "kind": "quote",
        "quote": "material created by the National Park Service and presented on this website, unless otherwise indicated, is generally considered in the public domain",
    },
    {
        "publisher": "U.S. Census Bureau",
        "url": "https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc_Ch1.pdf",
        "kind": "quote",
        "quote": "Copyright protection is not available for any work of the United States Government",
    },
    {
        "publisher": "U.S. Census Bureau",
        "url": "https://www.census.gov/about/policies/citation.html",
        "kind": "no-licence",
        "searched": r"licen[cs]e|public domain|copyright|terms of use|permission",
    },
    {
        "publisher": "U.S. Securities and Exchange Commission (SEC), EDGAR",
        "url": "https://www.sec.gov/about/privacy-information",
        "kind": "quote",
        "quote": "Information presented on sec.gov is considered public information and may be copied or further distributed",
    },
]


# ---------------------------------------------------------------- fetching


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)
_LAST: dict[str, float] = {}


def _pace(host: str) -> None:
    wait = _LAST.get(host, 0.0) + MIN_INTERVAL_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _LAST[host] = time.monotonic()


def user_agent(url: str) -> str:
    host = urllib.parse.urlsplit(url).hostname or ""
    return SEC_UA if host == "sec.gov" or host.endswith(".sec.gov") else net.UA


def fetch(url: str) -> dict:
    """GET url, following redirects by hand. Returns the last response and the hops before it."""
    hops = []
    cur = url
    for _ in range(MAX_HOPS + 1):
        host = urllib.parse.urlsplit(cur).hostname or ""
        _pace(host)
        ua = user_agent(cur)
        at = net.utc_now()
        req = urllib.request.Request(cur, headers={"user-agent": ua, "accept": "text/html,application/json;q=0.9,application/pdf;q=0.9,*/*;q=0.5"})
        try:
            r = _OPENER.open(req, timeout=60)
            status, body, headers = r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            status, body, headers = e.code, (e.read() if e.fp else b""), e.headers
        loc = headers.get("location")
        if status in (301, 302, 303, 307, 308) and loc:
            hops.append({"url": cur, "status": status})
            cur = urllib.parse.urljoin(cur, loc)
            continue
        return {
            "finalUrl": cur,
            "redirects": hops,
            "status": status,
            "contentType": headers.get("content-type"),
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "retrievedAt": at,
            "userAgent": ua,
            "_body": body,
        }
    raise SystemExit(f"more than {MAX_HOPS} redirects from {url}")


# ---------------------------------------------------------------- text


def _decode(body: bytes) -> str:
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("cp1252", "replace")


def _json_strings(v) -> list[str]:
    if isinstance(v, str):
        return [v]
    if isinstance(v, dict):
        return [s for x in v.values() for s in _json_strings(x)]
    if isinstance(v, list):
        return [s for x in v for s in _json_strings(x)]
    return []


def _pdf_string(s: bytes) -> str:
    out = bytearray()
    i = 0
    while i < len(s):
        c = s[i]
        if c == 0x5C and i + 1 < len(s):
            n = s[i + 1]
            if 0x30 <= n <= 0x37:
                j, v, k = i + 1, 0, 0
                while j < len(s) and k < 3 and 0x30 <= s[j] <= 0x37:
                    v, j, k = v * 8 + s[j] - 0x30, j + 1, k + 1
                out.append(v & 0xFF)
                i = j
                continue
            out.append({0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return out.decode("cp1252", "replace")


def pdf_text(body: bytes) -> str:
    """The text of the Tj/TJ operators in every Flate stream. Good enough to find a sentence; not a PDF reader."""
    pieces = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", body, re.S):
        try:
            s = zlib.decompress(m.group(1))
        except zlib.error:
            continue
        for t in re.finditer(rb"\[(.*?)\]\s*TJ|\((.*?)\)\s*Tj", s, re.S):
            if t.group(2) is not None:
                pieces.append(_pdf_string(t.group(2)))
                continue
            for tok in re.finditer(rb"\(((?:\\.|[^\\()])*)\)|(-?\d+\.?\d*)", t.group(1), re.S):
                if tok.group(1) is not None:
                    pieces.append(_pdf_string(tok.group(1)))
                elif float(tok.group(2)) < -200:
                    pieces.append(" ")
        pieces.append("\n")
    return "".join(pieces)


def page_text(body: bytes, content_type: str | None) -> str:
    ct = (content_type or "").lower()
    if body[:5] == b"%PDF-" or "pdf" in ct:
        return pdf_text(body)
    text = _decode(body)
    if "json" in ct or text.lstrip()[:1] in "{[":
        try:
            return "\n".join(_json_strings(json.loads(text)))
        except ValueError:
            pass
    text = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", text)
    return html.unescape(re.sub(r"(?s)<[^>]+>", " ", text))


_QUOTES = {"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "}


def squash(s: str) -> str:
    """Typographic quotes and dashes written plain, then every whitespace character removed."""
    for a, b in _QUOTES.items():
        s = s.replace(a, b)
    return re.sub(r"\s+", "", s)


# ---------------------------------------------------------------- the lock


def json_field(body: bytes, name: str):
    """The top-level string field `name` of a JSON response, or None when the body is not a JSON object or the field is not a string."""
    try:
        obj = json.loads(_decode(body))
    except ValueError:
        return None
    value = obj.get(name) if isinstance(obj, dict) else None
    return value if isinstance(value, str) else None


def examine(target: dict, got: dict) -> dict:
    """What the page says about the target, as lock fields."""
    text = page_text(got["_body"], got["contentType"])
    out = {}
    if target["kind"] == "quote":
        out["quote"] = target["quote"]
        out["quoteWords"] = len(target["quote"].split())
        out["quoteFound"] = squash(target["quote"]) in squash(text)
    else:
        hits = re.findall(target["searched"], text, re.I)
        out["searched"] = target["searched"]
        out["matches"] = len(hits)
        out["textChars"] = len(re.sub(r"\s+", " ", text).strip())
        if target.get("emptyField"):
            out[target["emptyField"]] = json_field(got["_body"], target["emptyField"])
    return out


def ok(entry: dict, target: dict) -> bool:
    """Whether the entry checks out for its target. The target is required: the emptyField requirement comes from it."""
    if entry["status"] != 200:
        return False
    if entry["kind"] == "quote":
        return entry["quoteFound"] is True and entry["quoteWords"] < 25
    field = target.get("emptyField")
    if field and entry.get(field) != "":
        return False
    return entry["matches"] == 0 and entry["textChars"] > 0


def entry_for(target: dict, got: dict) -> dict:
    e = {"publisher": target["publisher"], "url": target["url"], "kind": target["kind"]}
    e.update({k: v for k, v in got.items() if k != "_body"})
    e.update(examine(target, got))
    return e


def write() -> int:
    entries = []
    for t in TARGETS:
        got = fetch(t["url"])
        e = entry_for(t, got)
        entries.append(e)
        print(f"{e['status']} {e['bytes']:>8} {'ok  ' if ok(e, t) else 'FAIL'} {t['url']}", flush=True)
    lock = {
        "schemaVersion": "licenses-lock/1",
        "about": (
            "Each terms page data/LICENSES.md cites, fetched once by data/pipeline/licenses_fetch.py: its status, byte count, sha256, "
            "the User-Agent sent, and whether the row's quote is on the page (kind quote) or the page's text has no licence or copyright "
            "word (kind no-licence; textChars is the length of the page's visible text, runs of whitespace counted as one). A quote is checked as a substring of the page text with typographic quotes written plain and all "
            "whitespace removed. The sha256 is the page as fetched on retrievedAt; census.gov and nps.gov pages change without their "
            "terms changing, so the quote is the durable check. python -I data/pipeline/licenses_fetch.py --check fetches them again."
        ),
        "fetches": entries,
    }
    bad = [e["url"] for t, e in zip(TARGETS, entries) if not ok(e, t)]
    if bad:
        print("not written; these did not check out:\n  " + "\n  ".join(bad), file=sys.stderr)
        return 1
    LOCK.write_text(json.dumps(lock, indent=1, ensure_ascii=False) + "\n", "utf8", newline="\n")
    print(f"wrote {LOCK.name}: {len(entries)} fetches")
    return 0


def check() -> int:
    lock = json.loads(LOCK.read_text("utf8"))
    bad = 0
    for old in lock["fetches"]:
        t = next((x for x in TARGETS if x["url"] == old["url"]), None)
        if t is None:
            print(f"FAIL  {old['url']}: in the lock but not in TARGETS")
            bad += 1
            continue
        got = fetch(t["url"])
        e = entry_for(t, got)
        what = f"quote {'found' if e.get('quoteFound') else 'MISSING'}" if t["kind"] == "quote" else f"{e['matches']} licence words"
        if t.get("emptyField"):
            what += f"; {t['emptyField']} {'empty' if e.get(t['emptyField']) == '' else 'NOT EMPTY: ' + repr(e.get(t['emptyField']))}"
        same = "sha256 same" if e["sha256"] == old["sha256"] else "sha256 differs (information only)"
        print(f"{'ok  ' if ok(e, t) else 'FAIL'}  {e['status']}  {what}; {same}; bytes {old['bytes']} -> {e['bytes']}  {t['url']}")
        bad += 0 if ok(e, t) else 1
    return 1 if bad else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--write", action="store_true")
    g.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    return write() if args.write else check()


if __name__ == "__main__":
    sys.exit(main())
