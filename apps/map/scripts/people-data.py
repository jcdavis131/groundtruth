#!/usr/bin/env python3
"""
Build lib/people/data/insiders.json: the reporting owners on SEC Forms 3, 4
and 5 for every issuer listed on Nasdaq, NYSE or Cboe, one row per (issuer,
owner CIK), from the SEC Insider Transactions Data Sets (one zip per quarter,
keyless, public domain). Stdlib only. The rules are in docs/PEOPLE.md.

  python scripts/people-data.py --zip-dir DIR --from 2024q3 --to 2026q2 \\
      --out lib/people/data/insiders.json
  python scripts/people-data.py --list-quarters
  python scripts/people-data.py --zip-dir DIR --from 2024q3 --to 2026q2 --fetch --out ...

What is read, and only this:
  SUBMISSION.tsv      ACCESSION_NUMBER, FILING_DATE, PERIOD_OF_REPORT,
                      DATE_OF_ORIG_SUB, DOCUMENT_TYPE, ISSUERCIK, NOT_SUBJECT_SEC16
  REPORTINGOWNER.tsv  ACCESSION_NUMBER, RPTOWNERCIK, RPTOWNERNAME,
                      RPTOWNER_RELATIONSHIP, RPTOWNER_TITLE, RPTOWNER_TXT
                      (RPTOWNER_TXT only through the G3 phrase allowlist)

No other member of the zip is opened (FOOTNOTES.tsv, OWNER_SIGNATURE.tsv and
the four transaction and holding tables never are), and every other column is
dropped by index as each line is split: the owner's address, FILE_NUMBER,
REMARKS, AFF10B5ONE, the issuer's name and ticker (the join is on ISSUERCIK).

The window is by PERIOD_OF_REPORT, not filing date. The latest filing of a
link is the max of (period, filing date, accession), so a late Form 5 or a
back-dated amendment cannot overwrite a newer title. The zip links come from
the SEC landing page, never from a URL template (2026q2 moved directories).

An individual's name is stored less the tokens EDGAR adds to tell same-named
filers apart (people_classify.individual_name); a vehicle's name and title are
not stored at all.
"""
import argparse
import collections
import datetime
import gzip
import hashlib
import html.parser
import importlib.util
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

sys.dont_write_bytecode = True  # no scripts/__pycache__ in the working tree
_spec = importlib.util.spec_from_file_location("people_classify", os.path.join(HERE, "people_classify.py"))
people_classify = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(people_classify)

# SEC fair-access policy: a descriptive User-Agent with a contact address,
# at most 10 requests a second.
SEC_USER_AGENT = "embedding-atlas/0.1 contact: jcdavis131@gmail.com"
SEC_MIN_INTERVAL_S = 0.125  # 8 requests a second at most
LANDING = "https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets"
SOURCE = "sec-form345"

UNIVERSE_FILE = os.path.join(REPO, "lib", "companies", "data", "raw", "company_tickers_exchange.json")
COMPANIES_FILE = os.path.join(REPO, "lib", "companies", "data", "companies.json")
OVERRIDES_FILE = os.path.join(REPO, "lib", "people", "data", "class-overrides.json")
EXCHANGES = ("Nasdaq", "NYSE", "CBOE")

# The explicit column allowlist: the only columns ever taken out of a line.
SUBMISSION_COLUMNS = (
    "ACCESSION_NUMBER",
    "FILING_DATE",
    "PERIOD_OF_REPORT",
    "DATE_OF_ORIG_SUB",
    "DOCUMENT_TYPE",
    "ISSUERCIK",
    "NOT_SUBJECT_SEC16",
)
REPORTINGOWNER_COLUMNS = (
    "ACCESSION_NUMBER",
    "RPTOWNERCIK",
    "RPTOWNERNAME",
    "RPTOWNER_RELATIONSHIP",
    "RPTOWNER_TITLE",
    "RPTOWNER_TXT",
)
# The only zip members ever opened.
TABLES = {"SUBMISSION.tsv": SUBMISSION_COLUMNS, "REPORTINGOWNER.tsv": REPORTINGOWNER_COLUMNS}

# G3: RPTOWNER_TXT is shown only when it is one of these phrases (compared
# without case, spacing or a trailing period); anything else is OTHER_FALLBACK.
OTHER_PHRASES = (
    "Member of a Group",
    "Member of 10% owner group",
    "Trustee",
    "Former 10% Owner",
    "Portfolio Manager",
    "Chairman of the Board",
)
OTHER_FALLBACK = "Other (see filing)"

ROLE_BITS = {"director": 1, "officer": 2, "ten-percent-owner": 4, "other": 8}
RELATIONSHIP_TOKENS = {
    "DIRECTOR": "director",
    "OFFICER": "officer",
    "TENPERCENTOWNER": "ten-percent-owner",
    "OTHER": "other",
}
CLASS_CODES = {"individual": "i", "entity": "e", "vehicle": "v", "business": "b"}
ROW_FIELDS = (
    "ownerCik",
    "name",
    "class",
    "roles",
    "title",
    "titleInFiling",
    "firstFiled",
    "lastFiled",
    "lastPeriod",
    "nssFiled",
    "lastForm",
    "lastAccession",
    "otherText",
)

MAX_RAW_BYTES = 10_000_000
MAX_GZIP_BYTES = 2_500_000

MONTHS = {m: i + 1 for i, m in enumerate(
    ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"))}


class BuildError(Exception):
    pass


# ---------------------------------------------------------------- parsing


def parse_sec_date(s):
    """'31-MAR-2015' -> '2015-03-31'; None when blank or unparseable."""
    s = (s or "").strip()
    parts = s.split("-")
    if len(parts) != 3:
        return None
    dd, mon, yyyy = parts
    m = MONTHS.get(mon.upper())
    if not m or not (dd.isdigit() and yyyy.isdigit() and len(yyyy) == 4):
        return None
    try:
        return datetime.date(int(yyyy), m, int(dd)).isoformat()
    except ValueError:
        return None


def parse_bool(s):
    """The data sets write booleans five ways: '0', '1', 'false', 'true' or
    empty. Returns True, False, or None for anything else."""
    v = (s or "").strip().lower()
    if v in ("1", "true"):
        return True
    if v in ("", "0", "false"):
        return False
    return None


_TOKEN_RUN = re.compile("|".join(RELATIONSHIP_TOKENS))


def parse_roles(rel):
    """'Director,Officer' -> (bitmask, unknown token count). Older quarters
    also run two tokens together ('TenPercentOwnerOther', 2006)."""
    bits = 0
    unknown = 0
    for tok in (rel or "").split(","):
        t = tok.strip().upper().replace(" ", "")
        if not t:
            continue
        parts = _TOKEN_RUN.findall(t)
        if parts and "".join(parts) == t:
            for part in parts:
                bits |= ROLE_BITS[RELATIONSHIP_TOKENS[part]]
        else:
            unknown += 1
    return bits, unknown


def cik10(s):
    s = (s or "").strip()
    return s.zfill(10) if s.isdigit() and 0 < len(s) <= 10 else None


def unquote(field):
    """A field holding a double quote is written CSV-style, wrapped in quotes
    with the inner quotes doubled; undo that."""
    if len(field) >= 2 and field[0] == '"' and field[-1] == '"':
        return field[1:-1].replace('""', '"')
    return field


_WS = re.compile(r"\s+")


def clean(s):
    return _WS.sub(" ", unquote(s or "")).strip()


# A title that only points at the filing's remarks or footnotes.
_POINTER_WORDS = {
    "see", "please", "below", "the", "remark", "remarks", "footnote", "footnotes",
    "explanation", "of", "responses", "response", "title", "in", "and",
}
_POINTER_CORE = {"remark", "remarks", "footnote", "footnotes", "explanation", "below"}
_POINTS_AT = re.compile(r"\bsee\b.*\b(?:remarks?|footnotes?|below|explanation)\b|\btitle in explanation\b", re.I)


def parse_title(raw):
    """Officer title as filed -> (title or None, titleInFiling).

    'See Remarks' and its variants become (None, True): the title is in the
    filing's remarks, which are never read. A title with a pointer added
    ('Co-President (See Remarks)') is kept as filed, with titleInFiling True.
    """
    t = clean(raw)
    if not t:
        return None, False
    words = re.sub(r"[^a-z0-9 ]", " ", t.lower()).split()
    if words and all(w in _POINTER_WORDS or len(w) == 1 or w.isdigit() for w in words) \
            and any(w in _POINTER_CORE for w in words):
        return None, True
    return t, bool(_POINTS_AT.search(t))


_PHRASE_KEY = {re.sub(r"\s+", " ", p.lower()): p for p in OTHER_PHRASES}


def parse_other(raw):
    """RPTOWNER_TXT -> one of OTHER_PHRASES, else OTHER_FALLBACK. Free text
    never passes through (G3)."""
    k = clean(raw).lower().rstrip(".").strip()
    return _PHRASE_KEY.get(k, OTHER_FALLBACK)


def quarter_tuple(q):
    m = re.fullmatch(r"(\d{4})q([1-4])", (q or "").strip().lower())
    if not m:
        raise BuildError(f"bad quarter {q!r} (want e.g. 2024q3)")
    return int(m.group(1)), int(m.group(2))


def quarter_range(q_from, q_to):
    a, b = quarter_tuple(q_from), quarter_tuple(q_to)
    if a > b:
        raise BuildError(f"--from {q_from} is after --to {q_to}")
    out = []
    y, q = a
    while (y, q) <= b:
        out.append(f"{y}q{q}")
        y, q = (y, q + 1) if q < 4 else (y + 1, 1)
    return out


def period_bounds(quarters):
    y0, q0 = quarter_tuple(quarters[0])
    y1, q1 = quarter_tuple(quarters[-1])
    start = datetime.date(y0, 3 * (q0 - 1) + 1, 1)
    end = (datetime.date(y1 + (q1 == 4), (3 * q1) % 12 + 1, 1) - datetime.timedelta(days=1))
    return start.isoformat(), end.isoformat()


# ---------------------------------------------------------------- reading


def table_member(zf, table):
    """The zip member for a table, keyed on its file name (the readme's name
    changed between years, the table names did not)."""
    for name in zf.namelist():
        if name.rsplit("/", 1)[-1].upper() == table.upper():
            return name
    raise BuildError(f"{zf.filename}: no {table}")


def read_table(zf, table, counts):
    """Yield tuples of exactly TABLES[table]'s columns, in that order.

    Lines are split on tabs, not parsed as CSV (thousands of fields hold a
    double quote). A line whose field count differs from the header's is
    skipped and counted: a shifted line is how an address could land in a
    name slot.
    """
    if table not in TABLES:
        raise BuildError(f"{table} is not read")
    columns = TABLES[table]
    member = table_member(zf, table)
    with zf.open(member) as fh:
        text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace", newline="")
        header = text.readline().rstrip("\r\n").split("\t")
        index = {c: i for i, c in enumerate(header)}
        missing = [c for c in columns if c not in index]
        if missing:
            raise BuildError(f"{zf.filename}:{table} lacks {missing}")
        picks = [index[c] for c in columns]
        width = len(header)
        for line in text:
            line = line.rstrip("\r\n")
            if not line:
                continue
            fields = line.split("\t")
            if len(fields) != width:
                counts[f"misaligned{table.split('.')[0].title()}Lines"] += 1
                continue
            yield tuple(fields[i] for i in picks)


# ---------------------------------------------------------------- universe


def load_universe(path=UNIVERSE_FILE, exchanges=EXCHANGES):
    """Listed issuer CIKs (10-digit strings) from the committed ticker file."""
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    fields = doc["fields"]
    ci, ei = fields.index("cik"), fields.index("exchange")
    want = {e.upper() for e in exchanges}
    return {str(r[ci]).zfill(10) for r in doc["data"] if (r[ei] or "").upper() in want}


def load_bundle_ciks(path=COMPANIES_FILE):
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as f:
        return {str(c["cik"]).zfill(10) for c in json.load(f)["companies"]}


# ---------------------------------------------------------------- build


class Link:
    __slots__ = ("roles", "first", "last", "last_period", "latest", "officer", "other")

    def __init__(self):
        self.roles = 0
        self.first = None
        self.last = None
        self.last_period = None
        self.latest = None   # (key, name, form, accession, nss_filed)
        self.officer = None  # (key, raw title)
        self.other = None    # (key, raw RPTOWNER_TXT)


def build(zip_paths, issuers, businesses, overrides, pulled=None, universe_meta=None):
    """zip_paths: {quarter: path}. Returns the bundle dict."""
    quarters = sorted(zip_paths, key=quarter_tuple)
    period_from, period_to = period_bounds(quarters)
    counts = collections.Counter()
    links = {}
    names = collections.defaultdict(set)
    seen_acc = set()
    zips = []

    for q in quarters:
        path = zip_paths[q]
        with zipfile.ZipFile(path) as zf:
            built = max((i.date_time for i in zf.infolist()), default=None)
            subs = {}
            for acc, filed, period, _orig, form, issuer, nss in read_table(zf, "SUBMISSION.tsv", counts):
                counts["submissions"] += 1
                acc = acc.strip()
                issuer = cik10(issuer)
                if issuer not in issuers:
                    counts["submissionsNotListed"] += 1
                    continue
                filed, period = parse_sec_date(filed), parse_sec_date(period)
                if not acc or not filed or not period:
                    counts["submissionsBadDate"] += 1
                    continue
                if not (period_from <= period <= period_to):
                    counts["submissionsOutOfWindow"] += 1
                    continue
                if acc in seen_acc or acc in subs:
                    counts["submissionsDuplicate"] += 1
                    continue
                flag = parse_bool(nss)
                if flag is None:
                    counts["unknownSec16Flag"] += 1
                    flag = False
                subs[acc] = (filed, period, form.strip(), issuer, flag)
            seen_acc.update(subs)
            counts["submissionsInWindow"] += len(subs)

            owners = list(read_table(zf, "REPORTINGOWNER.tsv", counts))
            # Owners per filing, over every row of the filing: a joint filing's
            # "not subject to Section 16" mark is not any one co-filer's.
            per_filing = collections.Counter(o[0].strip() for o in owners)
            for acc, owner, name, rel, title, txt in owners:
                acc = acc.strip()
                sub = subs.get(acc)
                if sub is None:
                    continue
                owner = cik10(owner)
                if owner is None:
                    counts["ownerRowsBadCik"] += 1
                    continue
                filed, period, form, issuer, flag = sub
                if owner == issuer:
                    counts["ownerRowsSelf"] += 1
                    continue
                counts["ownerRows"] += 1
                bits, unknown = parse_roles(rel)
                counts["unknownRelationshipTokens"] += unknown
                name = clean(name)
                if name:
                    names[owner].add(name)
                key = (period, filed, acc)
                ln = links.get((issuer, owner))
                if ln is None:
                    ln = links[(issuer, owner)] = Link()
                ln.roles |= bits
                ln.first = filed if ln.first is None or filed < ln.first else ln.first
                ln.last = filed if ln.last is None or filed > ln.last else ln.last
                ln.last_period = period if ln.last_period is None or period > ln.last_period else ln.last_period
                if ln.latest is None or key > ln.latest[0]:
                    nss_filed = filed if flag and per_filing[acc] == 1 else None
                    ln.latest = (key, name, form, acc, nss_filed)
                if bits & ROLE_BITS["officer"] and (ln.officer is None or key > ln.officer[0]):
                    ln.officer = (key, title)
                if bits & ROLE_BITS["other"] and (ln.other is None or key > ln.other[0]):
                    ln.other = (key, txt)
            del owners
        zips.append({
            "quarter": q,
            "file": os.path.basename(path),
            "bytes": os.path.getsize(path),
            "secBuilt": "%04d-%02d-%02d" % built[:3] if built else None,
        })

    classes = {o: people_classify.owner_class(o, names.get(o, ()), businesses, overrides)
               for o in sorted({o for (_i, o) in links})}

    by_issuer = collections.defaultdict(list)
    dropped = collections.Counter()
    kept_owners = collections.defaultdict(set)
    title_in_filing = 0
    names_cleaned = 0
    for (issuer, owner) in sorted(links):
        ln = links[(issuer, owner)]
        if ln.roles == 0:
            dropped["emptyRelationship"] += 1
            continue
        cls = classes[owner]
        _key, name, form, acc, nss_filed = ln.latest
        cleaned = False
        if cls == "individual":
            shown = people_classify.individual_name(name)
            cleaned = shown != name
            name = shown
        if cls != "vehicle" and not name:
            # The store refuses a nameless individual, entity or business row,
            # and a placeholder name would be made up: drop the link, count it.
            dropped["emptyName"] += 1
            continue
        names_cleaned += cleaned
        if cls == "vehicle":
            # A trust's filing can carry the grantor's officer title; the row
            # is listed by role only, so the title is not stored either.
            title, in_filing = None, False
        else:
            title, in_filing = parse_title(ln.officer[1]) if ln.officer else (None, False)
        title_in_filing += in_filing
        other = parse_other(ln.other[1]) if ln.other else None
        row = [
            int(owner),
            None if cls == "vehicle" else name,
            CLASS_CODES[cls],
            ln.roles,
            title,
            1 if in_filing else 0,
            ln.first,
            ln.last,
            ln.last_period,
            nss_filed,
            form,
            acc,
            other,
        ]
        while row[-1] is None:  # trailing nulls are left off
            row.pop()
        by_issuer[issuer].append(row)
        kept_owners[cls].add(owner)

    edges = sum(len(v) for v in by_issuer.values())
    out_counts = {
        "issuers": len(by_issuer),
        "edges": edges,
        "persons": len(kept_owners["individual"]),
        "entities": len(kept_owners["entity"]),
        "vehicles": len(kept_owners["vehicle"]),
        "businesses": len(kept_owners["business"]),
        "titleInFiling": title_in_filing,
        "nssFiled": sum(1 for rows in by_issuer.values() for r in rows if r[9]),
        "otherText": sum(1 for rows in by_issuer.values() for r in rows if len(r) > 12),
        "namesCleaned": names_cleaned,
        "dropped": {"emptyRelationship": dropped["emptyRelationship"], "emptyName": dropped["emptyName"]},
        "read": {k: counts[k] for k in sorted(counts)},
    }
    return {
        "source": SOURCE,
        "sourceUrl": LANDING,
        "license": "public domain (SEC Insider Transactions Data Sets)",
        "quarters": quarters,
        "window": "period",
        "periodFrom": period_from,
        "periodTo": period_to,
        "pulled": pulled,
        "zips": zips,
        "universe": universe_meta or {},
        "columnsRead": {"SUBMISSION": list(SUBMISSION_COLUMNS), "REPORTINGOWNER": list(REPORTINGOWNER_COLUMNS)},
        "tablesOpened": sorted(TABLES),
        "notRead": "owner addresses, signatures, footnotes, remarks, FILE_NUMBER, AFF10B5ONE, transactions and holdings",
        "row": list(ROW_FIELDS),
        "rowNotes": ("ownerCik is a number (pad to 10 digits); name is null for a vehicle, and an individual's "
                     "name is as filed less EDGAR's disambiguators (a state, ZIP code or birth year after the "
                     "name); class is a code from classes; roles is a bitmask of roleBits; title is null and "
                     "titleInFiling 0 for a vehicle; titleInFiling is 0 or 1; dates are "
                     "YYYY-MM-DD; nssFiled is the latest filing's date when that filing has this owner alone "
                     "and is marked not subject to Section 16, else null; trailing nulls are left off"),
        "classes": {v: k for k, v in CLASS_CODES.items()},
        "roleBits": ROLE_BITS,
        "otherPhrases": list(OTHER_PHRASES) + [OTHER_FALLBACK],
        "counts": out_counts,
        "issuers": {k: by_issuer[k] for k in sorted(by_issuer)},
    }


def serialize(bundle):
    """Deterministic bytes: fixed key order, one issuer per line."""
    head = {k: v for k, v in bundle.items() if k != "issuers"}
    parts = ["{"]
    for k, v in head.items():
        parts.append(json.dumps(k) + ":" + json.dumps(v, ensure_ascii=False, separators=(",", ":")) + ",\n")
    parts.append('"issuers":{\n')
    items = list(bundle["issuers"].items())
    for n, (cik, rows) in enumerate(items):
        sep = ",\n" if n < len(items) - 1 else "\n"
        parts.append(json.dumps(cik) + ":" + json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + sep)
    parts.append("}}\n")
    return "".join(parts).encode("utf-8")


def size_check(data, max_raw=MAX_RAW_BYTES, max_gzip=MAX_GZIP_BYTES):
    gz = len(gzip.compress(data, compresslevel=9, mtime=0))
    return len(data), gz, len(data) <= max_raw and gz <= max_gzip


# ---------------------------------------------------------------- network


class _Links(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for k, v in attrs:
                if k == "href" and v:
                    self.hrefs.append(v)


_last_request = [0.0]


def sec_get(url, timeout=60):
    """One GET to sec.gov with SEC_USER_AGENT, at most 8 a second."""
    wait = _last_request[0] + SEC_MIN_INTERVAL_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "identity"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    finally:
        _last_request[0] = time.monotonic()


def list_quarters():
    """{quarter: absolute zip URL}, read from the landing page (one GET)."""
    page = sec_get(LANDING).decode("utf-8", errors="replace")
    p = _Links()
    p.feed(page)
    out = {}
    for href in p.hrefs:
        m = re.search(r"(\d{4}q[1-4])_form345\.zip$", href, re.I)
        if m:
            out[m.group(1).lower()] = urllib.parse.urljoin(LANDING, href)
    return dict(sorted(out.items(), key=lambda kv: quarter_tuple(kv[0])))


def fetch_missing(zip_dir, quarters):
    """Download the quarters not already in zip_dir, by the landing page's links."""
    missing = [q for q in quarters if not os.path.exists(os.path.join(zip_dir, f"{q}_form345.zip"))]
    if not missing:
        return []
    links = list_quarters()
    absent = [q for q in missing if q not in links]
    if absent:
        raise BuildError(f"not posted on the SEC landing page: {', '.join(absent)}")
    os.makedirs(zip_dir, exist_ok=True)
    for q in missing:
        data = sec_get(links[q], timeout=300)
        zipfile.ZipFile(io.BytesIO(data)).testzip()
        tmp = os.path.join(zip_dir, f".{q}_form345.zip.part")
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, os.path.join(zip_dir, f"{q}_form345.zip"))
        print(f"fetched {q} {len(data):,} B from {links[q]}")
    return missing


# ---------------------------------------------------------------- cli


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--zip-dir", help="directory of <yyyy>q<n>_form345.zip files")
    ap.add_argument("--from", dest="q_from", default="2024q3")
    ap.add_argument("--to", dest="q_to", default="2026q2")
    ap.add_argument("--out", default=os.path.join(REPO, "lib", "people", "data", "insiders.json"))
    ap.add_argument("--universe", default=UNIVERSE_FILE)
    ap.add_argument("--companies", default=COMPANIES_FILE)
    ap.add_argument("--overrides", default=OVERRIDES_FILE)
    ap.add_argument("--pulled", help="YYYY-MM-DD the zips were downloaded (default: newest zip's file date, UTC)")
    ap.add_argument("--fetch", action="store_true", help="download quarters missing from --zip-dir")
    ap.add_argument("--list-quarters", action="store_true", help="list the zips on the SEC landing page and exit")
    ap.add_argument("--max-raw-bytes", type=int, default=MAX_RAW_BYTES)
    ap.add_argument("--max-gzip-bytes", type=int, default=MAX_GZIP_BYTES)
    a = ap.parse_args(argv)

    try:
        if a.list_quarters:
            for q, url in list_quarters().items():
                print(f"{q}  {urllib.parse.urlsplit(url).path}")
            return 0
        if not a.zip_dir:
            ap.error("--zip-dir is required")
        t0 = time.monotonic()
        quarters = quarter_range(a.q_from, a.q_to)
        if a.fetch:
            fetch_missing(a.zip_dir, quarters)
        paths = {q: os.path.join(a.zip_dir, f"{q}_form345.zip") for q in quarters}
        missing = [q for q, p in paths.items() if not os.path.exists(p)]
        if missing:
            raise BuildError(f"missing zips in {a.zip_dir}: {', '.join(missing)} (use --fetch)")
        issuers = load_universe(a.universe)
        businesses = issuers | load_bundle_ciks(a.companies)
        overrides = people_classify.load_overrides(a.overrides) if os.path.exists(a.overrides) else {}
        pulled = a.pulled or datetime.datetime.fromtimestamp(
            max(os.path.getmtime(p) for p in paths.values()), datetime.timezone.utc).date().isoformat()
        rel = os.path.relpath(os.path.abspath(a.universe), REPO).replace(os.sep, "/")
        meta = {"file": rel, "exchanges": list(EXCHANGES), "issuerCiks": len(issuers), "join": "ISSUERCIK",
                "overrides": len(overrides)}
        bundle = build(paths, issuers, businesses, overrides, pulled=pulled, universe_meta=meta)
        data = serialize(bundle)
        raw, gz, fits = size_check(data, a.max_raw_bytes, a.max_gzip_bytes)
        c = bundle["counts"]
        print(f"quarters {quarters[0]}..{quarters[-1]} (period {bundle['periodFrom']}..{bundle['periodTo']})")
        print(f"issuers {c['issuers']:,}  edges {c['edges']:,}  persons {c['persons']:,}  entities {c['entities']:,}  "
              f"vehicles {c['vehicles']:,}  businesses {c['businesses']:,}  dropped {c['dropped']['emptyRelationship']:,} "
              f"(empty relationship) {c['dropped']['emptyName']:,} (empty name)  names cleaned {c['namesCleaned']:,}")
        print("read " + "  ".join(f"{k} {v:,}" for k, v in c["read"].items()))
        print(f"size {raw:,} B raw, {gz:,} B gzipped (budget {a.max_raw_bytes:,} / {a.max_gzip_bytes:,})")
        if not fits:
            print("over the size budget; nothing written", file=sys.stderr)
            return 2
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        tmp = a.out + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, a.out)
        print(f"wrote {a.out} sha256 {hashlib.sha256(data).hexdigest()} in {time.monotonic() - t0:.1f} s")
        return 0
    except BuildError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
