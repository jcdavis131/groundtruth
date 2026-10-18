#!/usr/bin/env python3
"""
Tests for scripts/people-data.py and scripts/people_classify.py. Stdlib only,
no network: python scripts/test_people_data.py

T2   a Form 345 zip built here, with a sentinel in every address, signature,
     footnote and remarks column: no sentinel reaches the output, only
     SUBMISSION.tsv and REPORTINGOWNER.tsv are ever opened, and the
     REPORTINGOWNER column list is the allowlist.
T10  the class word test, on placeholder names shaped like real ones, and a
     trust that files with the grantor's roles and title staying a vehicle.
T11  period ordering, the title from the latest officer filing, joint
     filings, the five boolean encodings, the owner that is the issuer, and
     the empty relationship.
T13  EDGAR's disambiguators (a state, ZIP code or birth year after the name)
     are dropped from an individual's stored name, and only an individual's.

Names here are placeholders, never a real person's name (CONTRIBUTING.md).
"""
import collections
import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no scripts/__pycache__ in the working tree


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pd = _load("people_data", "people-data.py")
pc = _load("people_classify_t", "people_classify.py")

ALLOWLIST_REPORTINGOWNER = (
    "ACCESSION_NUMBER",
    "RPTOWNERCIK",
    "RPTOWNERNAME",
    "RPTOWNER_RELATIONSHIP",
    "RPTOWNER_TITLE",
    "RPTOWNER_TXT",
)
ALLOWLIST_SUBMISSION = (
    "ACCESSION_NUMBER",
    "FILING_DATE",
    "PERIOD_OF_REPORT",
    "DATE_OF_ORIG_SUB",
    "DOCUMENT_TYPE",
    "ISSUERCIK",
    "NOT_SUBJECT_SEC16",
)

# Real headers (2026q2), plus the CONTACT_* columns the metadata file lists,
# as if a later quarter's TSV carried them.
SUB_HEADER = [
    "ACCESSION_NUMBER", "FILING_DATE", "PERIOD_OF_REPORT", "DATE_OF_ORIG_SUB", "NO_SECURITIES_OWNED",
    "NOT_SUBJECT_SEC16", "FORM3_HOLDINGS_REPORTED", "FORM4_TRANS_REPORTED", "DOCUMENT_TYPE", "ISSUERCIK",
    "ISSUERNAME", "ISSUERTRADINGSYMBOL", "REMARKS", "AFF10B5ONE",
    "CONTACT_NAME", "CONTACT_PHONE_NUMBER", "CONTACT_EMAIL_ADDRESS",
]
OWNER_HEADER = [
    "ACCESSION_NUMBER", "RPTOWNERCIK", "RPTOWNERNAME", "RPTOWNER_RELATIONSHIP", "RPTOWNER_TITLE",
    "RPTOWNER_TXT", "RPTOWNER_STREET1", "RPTOWNER_STREET2", "RPTOWNER_CITY", "RPTOWNER_STATE",
    "RPTOWNER_ZIPCODE", "RPTOWNER_STATE_DESC", "FILE_NUMBER",
]
OTHER_TABLES = {
    "FOOTNOTES.tsv": ["ACCESSION_NUMBER", "FOOTNOTE_ID", "FOOTNOTE_TXT"],
    "OWNER_SIGNATURE.tsv": ["ACCESSION_NUMBER", "OWNERSIGNATURENAME", "OWNERSIGNATUREDATE"],
    "NONDERIV_TRANS.tsv": ["ACCESSION_NUMBER", "NONDERIV_TRANS_SK", "SECURITY_TITLE", "TRANS_SHARES"],
    "NONDERIV_HOLDING.tsv": ["ACCESSION_NUMBER", "NONDERIV_HOLDING_SK", "SECURITY_TITLE", "SHRS_OWND_FOLWNG_TRANS"],
    "DERIV_TRANS.tsv": ["ACCESSION_NUMBER", "DERIV_TRANS_SK", "SECURITY_TITLE", "TRANS_SHARES"],
    "DERIV_HOLDING.tsv": ["ACCESSION_NUMBER", "DERIV_HOLDING_SK", "SECURITY_TITLE", "SHRS_OWND_FOLWNG_TRANS"],
}
NEVER_READ_SUB = [c for c in SUB_HEADER if c not in ALLOWLIST_SUBMISSION]
NEVER_READ_OWNER = [c for c in OWNER_HEADER if c not in ALLOWLIST_REPORTINGOWNER]

ISSUER = "0000900001"
ISSUER_2 = "0000900002"
UNLISTED = "0000900099"
LISTED_OWNER = "0000900003"  # an issuer that files as another issuer's owner


def sentinel(col, i=0):
    return f"SENTINEL-{col}-{i}"


def sub_row(acc, filed, period, issuer=ISSUER, form="4", nss="", orig=""):
    vals = {
        "ACCESSION_NUMBER": acc, "FILING_DATE": filed, "PERIOD_OF_REPORT": period, "DATE_OF_ORIG_SUB": orig,
        "DOCUMENT_TYPE": form, "ISSUERCIK": issuer, "NOT_SUBJECT_SEC16": nss,
    }
    return [vals.get(c, sentinel(c, acc)) for c in SUB_HEADER]


def owner_row(acc, cik, name, rel="Director", title="", txt=""):
    vals = {
        "ACCESSION_NUMBER": acc, "RPTOWNERCIK": cik, "RPTOWNERNAME": name, "RPTOWNER_RELATIONSHIP": rel,
        "RPTOWNER_TITLE": title, "RPTOWNER_TXT": txt,
    }
    return [vals.get(c, sentinel(c, acc + cik)) for c in OWNER_HEADER]


def tsv(header, rows):
    return "\n".join("\t".join(r) for r in [header] + rows) + "\n"


def write_zip(path, subs, owners, raw_owner_lines=()):
    """A Form 345 data set zip: every member of the real one, with sentinels in
    each table and column the builder must never read."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("SUBMISSION.tsv", tsv(SUB_HEADER, subs))
        body = tsv(OWNER_HEADER, owners) + "".join(line + "\n" for line in raw_owner_lines)
        z.writestr("REPORTINGOWNER.tsv", body)
        for table, header in OTHER_TABLES.items():
            rows = [[r[0]] + [sentinel(f"{table}:{c}", r[0]) for c in header[1:]] for r in subs]
            z.writestr(table, tsv(header, rows))
        z.writestr("FORM_345_metadata.json", json.dumps({"tables": [{"url": "SENTINEL-METADATA"}]}))
        z.writestr("FORM_345_readme.htm", "<html>SENTINEL-README</html>")


class Fixture:
    """Zips in a temp dir plus a matching universe."""

    def __init__(self, quarters):
        self.dir = tempfile.mkdtemp(prefix="people-data-test-")
        self.paths = {}
        for q, (subs, owners, *raw) in quarters.items():
            p = os.path.join(self.dir, f"{q}_form345.zip")
            write_zip(p, subs, owners, raw[0] if raw else ())
            self.paths[q] = p
        self.issuers = {ISSUER, ISSUER_2, LISTED_OWNER}

    def build(self, overrides=None):
        return pd.build(self.paths, self.issuers, set(self.issuers), overrides or {}, pulled="2026-07-09")

    def files(self):
        tickers = os.path.join(self.dir, "tickers.json")
        with open(tickers, "w") as f:
            json.dump({"fields": ["cik", "name", "ticker", "exchange"], "data": [
                [int(ISSUER), "PLACEHOLDER ISSUER ONE INC", "PHA", "Nasdaq"],
                [int(ISSUER_2), "PLACEHOLDER ISSUER TWO CORP", "PHB", "NYSE"],
                [int(LISTED_OWNER), "PLACEHOLDER PARENT INC", "PHC", "CBOE"],
                [int(UNLISTED), "PLACEHOLDER OTC INC", "PHD", "OTC"],
            ]}, f)
        companies = os.path.join(self.dir, "companies.json")
        with open(companies, "w") as f:
            json.dump({"companies": []}, f)
        overrides = os.path.join(self.dir, "overrides.json")
        with open(overrides, "w") as f:
            json.dump({"overrides": []}, f)
        return tickers, companies, overrides


def rows_by_owner(bundle, issuer=ISSUER):
    fields = bundle["row"]
    out = {}
    for r in bundle["issuers"].get(issuer, []):
        d = dict(zip(fields, r + [None] * (len(fields) - len(r))))
        out[str(d["ownerCik"]).zfill(10)] = d
    return out


def sentinel_fixture():
    """One quarter with a filing per case, every unread column a sentinel."""
    subs = [
        sub_row("0000000001-26-000001", "05-MAY-2026", "01-MAY-2026", nss="1"),
        sub_row("0000000001-26-000002", "06-MAY-2026", "04-MAY-2026"),
        sub_row("0000000001-26-000003", "07-MAY-2026", "05-MAY-2026"),
        sub_row("0000000001-26-000004", "08-MAY-2026", "06-MAY-2026", issuer=UNLISTED),
        sub_row("0000000001-26-000005", "09-MAY-2026", "07-MAY-2026"),
    ]
    owners = [
        owner_row("0000000001-26-000001", "0001000001", "PLACEHOLDER JANE", "Officer", "See Remarks"),
        owner_row("0000000001-26-000002", "0001000002", "PLACEHOLDER FAMILY TRUST", "TenPercentOwner"),
        owner_row("0000000001-26-000003", "0001000003", "PLACEHOLDER CAPITAL PARTNERS L.P.", "Other",
                  txt="FREE-TEXT-SENTINEL about a person"),
        owner_row("0000000001-26-000004", "0001000004", "PLACEHOLDER OTC OWNER", "Director"),
        owner_row("0000000001-26-000005", "0001000005", "PLACEHOLDER JOHN", "Director,Other",
                  txt="member of a group."),
    ]
    # A shifted line (an extra tab) is skipped, not parsed into the wrong slots.
    shifted = "\t".join(owner_row("0000000001-26-000005", "0001000006", "PLACEHOLDER SHIFTED")[:3]
                        + ["SENTINEL-SHIFTED-STREET"] + owner_row("x", "y", "z")[3:])
    return Fixture({"2026q2": (subs, owners, [shifted])})


class T2NeverRead(unittest.TestCase):
    def test_reportingowner_columns_are_the_allowlist(self):
        self.assertEqual(pd.REPORTINGOWNER_COLUMNS, ALLOWLIST_REPORTINGOWNER)
        self.assertEqual(pd.SUBMISSION_COLUMNS, ALLOWLIST_SUBMISSION)
        self.assertEqual(set(pd.TABLES), {"SUBMISSION.tsv", "REPORTINGOWNER.tsv"})
        fx = sentinel_fixture()
        b = fx.build()
        self.assertEqual(b["columnsRead"]["REPORTINGOWNER"], list(ALLOWLIST_REPORTINGOWNER))
        self.assertEqual(b["columnsRead"]["SUBMISSION"], list(ALLOWLIST_SUBMISSION))
        with zipfile.ZipFile(fx.paths["2026q2"]) as zf:
            counts = collections.Counter()
            rows = list(pd.read_table(zf, "REPORTINGOWNER.tsv", counts))
            subs = list(pd.read_table(zf, "SUBMISSION.tsv", counts))
        self.assertTrue(rows and all(len(r) == len(ALLOWLIST_REPORTINGOWNER) for r in rows))
        self.assertTrue(subs and all(len(r) == len(ALLOWLIST_SUBMISSION) for r in subs))
        for r in rows + subs:
            for v in r:
                for col in NEVER_READ_OWNER + NEVER_READ_SUB:
                    self.assertNotIn(f"SENTINEL-{col}-", v)
        self.assertEqual(counts["misalignedReportingownerLines"], 1)

    def test_no_sentinel_reaches_the_output(self):
        fx = sentinel_fixture()
        data = pd.serialize(fx.build())
        self.assertNotIn(b"SENTINEL", data)
        self.assertNotIn(b"FREE-TEXT", data)
        self.assertNotIn(b"PLACEHOLDER FAMILY TRUST", data)  # a vehicle's name is withheld
        self.assertNotIn(b"PLACEHOLDER OTC OWNER", data)     # an unlisted issuer is not read
        b = json.loads(data)
        rows = rows_by_owner(b)
        self.assertEqual(set(rows), {"0001000001", "0001000002", "0001000003", "0001000005"})
        self.assertEqual(rows["0001000003"]["otherText"], "Other (see filing)")
        self.assertEqual(rows["0001000005"]["otherText"], "Member of a Group")
        self.assertEqual((rows["0001000001"]["title"], rows["0001000001"]["titleInFiling"]), (None, 1))
        self.assertIsNone(rows["0001000002"]["name"])
        self.assertEqual(rows["0001000002"]["class"], "v")
        self.assertEqual(rows["0001000003"]["class"], "e")

    def test_only_two_members_are_ever_opened(self):
        fx = sentinel_fixture()
        opened = []
        real_open = zipfile.ZipFile.open

        def spy(self, name, *args, **kwargs):
            opened.append(name.filename if isinstance(name, zipfile.ZipInfo) else name)
            return real_open(self, name, *args, **kwargs)

        with mock.patch.object(zipfile.ZipFile, "open", spy):
            fx.build()
        self.assertTrue(opened)
        self.assertLessEqual(set(opened), {"SUBMISSION.tsv", "REPORTINGOWNER.tsv"})
        self.assertNotIn("FOOTNOTES.tsv", opened)
        self.assertNotIn("OWNER_SIGNATURE.tsv", opened)

    def test_any_other_table_is_refused(self):
        fx = sentinel_fixture()
        with zipfile.ZipFile(fx.paths["2026q2"]) as zf:
            for table in ("FOOTNOTES.tsv", "OWNER_SIGNATURE.tsv", "NONDERIV_TRANS.tsv"):
                with self.assertRaises(pd.BuildError):
                    list(pd.read_table(zf, table, collections.Counter()))


class T10Classify(unittest.TestCase):
    CASES = [
        # vehicle markers win over entity tokens
        ("PLACEHOLDER FAMILY LLC", "vehicle"),
        ("PLACEHOLDER FAMILY HOLDINGS, LLC", "vehicle"),
        ("Placeholder Family Fund", "vehicle"),
        ("Placeholder Jane Trust, Placeholder John & Example Bank Co-Trustees", "vehicle"),
        ("PLACEHOLDER JANE REVOCABLE TRUST DTD 01/02/2003", "vehicle"),
        ("Placeholder John U/A/D 01/02/2003", "vehicle"),
        ("Placeholder 2020 GRAT", "vehicle"),
        ("PLACEHOLDER JANE LIVING TRUST", "vehicle"),
        ("ESTATE OF PLACEHOLDER JOHN", "vehicle"),
        ("PLACEHOLDER JANE FBO PLACEHOLDER JOHN", "vehicle"),
        ("PLACEHOLDER JANE CUSTODIAN FOR PLACEHOLDER JOHN UTMA", "vehicle"),
        ("Placeholder John as custodian for a minor", "vehicle"),
        ("Placeholder John Conservatorship, Placeholder Jane, Conservator", "vehicle"),
        # entity tokens
        ("EXAMPLE CAPITAL PARTNERS L.P.", "entity"),
        ("Example Capital Partners LP", "entity"),
        ("EXAMPLE ASSOCIATES L P", "entity"),
        ("EXAMPLE TRUST CO, AS TRUSTEE", "entity"),
        ("EXAMPLE TRUST CO.", "entity"),
        ("Example Trust Company", "entity"),
        ("EXAMPLE CO", "entity"),
        # "CO-" is a prefix, not the CO token: a trust with co-trustees
        ("PLACEHOLDER TRUST CO-TRUSTEES", "vehicle"),
        ("Placeholder Jane Trust Co-Trustees Placeholder John", "vehicle"),
        ("PLACEHOLDER JANE CO-TRUSTEE", "individual"),
        ("EXAMPLE HOLDINGS INC.", "entity"),
        ("Example Group S.A.", "entity"),
        ("Example Investments S.a r.l.", "entity"),
        ("Example Europe S.p.A.", "entity"),
        ("Example AB", "entity"),
        ("Example SE", "entity"),
        ("Example Ventures III CommV", "entity"),
        ("Example Investment Authority", "entity"),
        # individuals: surnames that look like markers or tokens
        ("HOLDING PLACEHOLDER B JR", "individual"),
        ("Placeholder Jane Holding", "individual"),
        ("XUTMAN PLACEHOLDER", "individual"),
        ("PLACEHOLDERUTMA JOHN", "individual"),
        ("MINOR PLACEHOLDER J", "individual"),
        ("Minor Placeholder", "individual"),
        ("PLACEHOLDER JOHN SA", "individual"),
        ("SA PLACEHOLDER A", "individual"),
        ("SE PLACEHOLDER", "individual"),
        ("AB PLACEHOLDER", "individual"),
        ("PLACEHOLDER J L P", "entity"),  # "L P" at the end reads as a partnership
        ("PLACEHOLDER J L P JR", "individual"),
        ("PLACEHOLDER IRA J", "individual"),
        ("ROTH PLACEHOLDER", "individual"),
        ("PLACEHOLDER TRUSTEE JANE", "individual"),
        ("Placeholder", "individual"),
    ]

    def test_name_cases(self):
        for name, want in self.CASES:
            with self.subTest(name=name):
                self.assertEqual(pc.name_class(name), want)

    def test_business_is_by_cik_not_name(self):
        businesses = {"0000000042"}
        self.assertEqual(pc.owner_class("0000000042", {"PLACEHOLDER JANE"}, businesses, {}), "business")
        self.assertEqual(pc.owner_class("0000000043", {"EXAMPLE CORP"}, businesses, {}), "entity")

    def test_overrides_win_and_hold_ids_only(self):
        self.assertEqual(pc.owner_class("0000000044", {"Placeholder"}, set(), {"0000000044": "entity"}), "entity")
        d = tempfile.mkdtemp()
        p = os.path.join(d, "o.json")
        with open(p, "w") as f:
            json.dump({"overrides": [{"cik": "44", "class": "entity"}]}, f)
        self.assertEqual(pc.load_overrides(p), {"0000000044": "entity"})
        for bad in ({"cik": "44", "class": "entity", "name": "PLACEHOLDER"}, {"cik": "x", "class": "entity"},
                    {"cik": "44", "class": "person"}):
            with open(p, "w") as f:
                json.dump({"overrides": [bad]}, f)
            with self.assertRaises(ValueError):
                pc.load_overrides(p)

    def test_committed_overrides_hold_ids_only(self):
        path = os.path.join(os.path.dirname(HERE), "lib", "people", "data", "class-overrides.json")
        ov = pc.load_overrides(path)
        self.assertTrue(all(len(k) == 10 and k.isdigit() for k in ov))

    def test_most_protective_class_across_names(self):
        self.assertEqual(pc.owner_class("0000000045", {"PLACEHOLDER JANE", "PLACEHOLDER JANE FAMILY TRUST"},
                                        set(), {}), "vehicle")
        self.assertEqual(pc.owner_class("0000000046", {"PLACEHOLDER JANE", "PLACEHOLDER JANE LLC"},
                                        set(), {}), "entity")

    def test_same_name_two_ciks_stay_two_people(self):
        subs = [sub_row("0000000002-26-000001", "05-MAY-2026", "01-MAY-2026")]
        owners = [
            owner_row("0000000002-26-000001", "0001000011", "PLACEHOLDER JANE", "Director"),
            owner_row("0000000002-26-000001", "0001000012", "PLACEHOLDER JANE", "Director"),
        ]
        b = Fixture({"2026q2": (subs, owners)}).build()
        rows = rows_by_owner(b)
        self.assertEqual(set(rows), {"0001000011", "0001000012"})
        self.assertEqual(b["counts"]["persons"], 2)

    def test_listed_owner_is_a_business(self):
        subs = [sub_row("0000000003-26-000001", "05-MAY-2026", "01-MAY-2026")]
        owners = [owner_row("0000000003-26-000001", LISTED_OWNER, "PLACEHOLDER PARENT INC", "TenPercentOwner")]
        b = Fixture({"2026q2": (subs, owners)}).build()
        self.assertEqual(rows_by_owner(b)[LISTED_OWNER]["class"], "b")
        self.assertEqual(b["counts"]["businesses"], 1)

    def test_trust_with_the_grantors_roles_and_title_stays_a_vehicle(self):
        # A trust can file with the grantor's Director, Officer and title on
        # its own row. The roles are the grantor's; the filer is still the
        # trust, and its name (which names the family) is still withheld.
        subs = [
            sub_row("0000000011-26-000001", "05-MAY-2026", "01-MAY-2026"),
            sub_row("0000000011-26-000002", "06-MAY-2026", "02-MAY-2026"),
        ]
        owners = [
            owner_row("0000000011-26-000001", "0001000061", "Placeholder Jane & Placeholder John Living Trust",
                      "Director,Officer,TenPercentOwner", "Chief Placeholder Officer"),
            owner_row("0000000011-26-000002", "0001000062", "PLACEHOLDER 2001 EXAMPLE DYNASTY TRUST",
                      "Director,Officer,TenPercentOwner", "Executive Placeholder Chair"),
        ]
        b = Fixture({"2026q2": (subs, owners)}).build()
        rows = rows_by_owner(b)
        for cik in ("0001000061", "0001000062"):
            with self.subTest(cik=cik):
                r = rows[cik]
                self.assertEqual(r["class"], "v")
                self.assertEqual(r["roles"], 7)
                self.assertIsNone(r["name"])
                self.assertIsNone(r["title"])
                self.assertEqual(r["titleInFiling"], 0)
        data = pd.serialize(b)
        for s in (b"Living Trust", b"DYNASTY", b"Chief Placeholder Officer", b"Executive Placeholder Chair"):
            self.assertNotIn(s, data)
        self.assertEqual(b["counts"]["vehicles"], 2)
        self.assertEqual(b["counts"]["persons"], 0)


class T11Links(unittest.TestCase):
    def test_backdated_amendment_does_not_set_the_title(self):
        subs = [
            sub_row("0000000004-26-000001", "05-MAY-2026", "01-MAY-2026", form="4"),
            # filed later, about an older period: an amendment
            sub_row("0000000004-26-000002", "01-JUN-2026", "10-APR-2026", form="4/A", orig="14-APR-2026"),
        ]
        owners = [
            owner_row("0000000004-26-000001", "0001000021", "PLACEHOLDER JANE", "Officer", "Chief Placeholder Officer"),
            owner_row("0000000004-26-000002", "0001000021", "PLACEHOLDER JANE", "Officer", "Former Placeholder Title"),
        ]
        r = rows_by_owner(Fixture({"2026q2": (subs, owners)}).build())["0001000021"]
        self.assertEqual(r["title"], "Chief Placeholder Officer")
        self.assertEqual(r["lastForm"], "4")
        self.assertEqual(r["lastAccession"], "0000000004-26-000001")
        self.assertEqual(r["lastPeriod"], "2026-05-01")
        self.assertEqual((r["firstFiled"], r["lastFiled"]), ("2026-05-05", "2026-06-01"))

    def test_title_comes_from_the_latest_officer_filing(self):
        # The latest filing of any role is a director-only one with a title of
        # its own; the title is still the latest officer filing's.
        subs = [
            sub_row("0000000012-26-000001", "05-MAY-2026", "01-MAY-2026"),
            sub_row("0000000012-26-000002", "12-MAY-2026", "10-MAY-2026"),
        ]
        owners = [
            owner_row("0000000012-26-000001", "0001000071", "PLACEHOLDER JANE", "Officer", "Chief Placeholder Officer"),
            owner_row("0000000012-26-000002", "0001000071", "PLACEHOLDER JANE", "Director", "Placeholder Board Title"),
        ]
        r = rows_by_owner(Fixture({"2026q2": (subs, owners)}).build())["0001000071"]
        self.assertEqual(r["title"], "Chief Placeholder Officer")
        self.assertEqual(r["roles"], pd.ROLE_BITS["director"] | pd.ROLE_BITS["officer"])
        self.assertEqual(r["lastAccession"], "0000000012-26-000002")
        self.assertEqual(r["lastPeriod"], "2026-05-10")

    def test_owner_that_is_the_issuer_is_skipped_and_counted(self):
        subs = [sub_row("0000000013-26-000001", "05-MAY-2026", "01-MAY-2026")]
        owners = [
            owner_row("0000000013-26-000001", ISSUER, "PLACEHOLDER ISSUER ONE INC", "TenPercentOwner"),
            owner_row("0000000013-26-000001", "0001000072", "PLACEHOLDER JOHN", "Director"),
        ]
        b = Fixture({"2026q2": (subs, owners)}).build()
        rows = rows_by_owner(b)
        self.assertEqual(set(rows), {"0001000072"})
        self.assertEqual(b["counts"]["read"]["ownerRowsSelf"], 1)
        self.assertEqual(b["counts"]["read"]["ownerRows"], 1)
        self.assertEqual(b["counts"]["businesses"], 0)
        self.assertNotIn(b"PLACEHOLDER ISSUER ONE", pd.serialize(b))

    def test_latest_is_by_period_then_filing_date_then_accession(self):
        subs = [
            sub_row("0000000005-26-000002", "05-MAY-2026", "01-MAY-2026"),
            sub_row("0000000005-26-000001", "06-MAY-2026", "01-MAY-2026"),
            sub_row("0000000005-26-000003", "06-MAY-2026", "01-MAY-2026"),
        ]
        owners = [owner_row(s[0], "0001000022", "PLACEHOLDER JANE", "Officer", f"Title {s[0][-1]}") for s in subs]
        r = rows_by_owner(Fixture({"2026q2": (subs, owners)}).build())["0001000022"]
        self.assertEqual((r["title"], r["lastAccession"]), ("Title 3", "0000000005-26-000003"))

    def test_window_is_by_period_and_spans_quarters(self):
        q3 = ([sub_row("0000000006-24-000001", "02-JUL-2024", "28-JUN-2024", nss="1"),
               sub_row("0000000006-24-000002", "03-JUL-2024", "01-JUL-2024")],
              [owner_row("0000000006-24-000001", "0001000023", "PLACEHOLDER JANE", "Director"),
               owner_row("0000000006-24-000002", "0001000023", "PLACEHOLDER JANE", "Officer", "Placeholder VP")])
        q2 = ([sub_row("0000000006-26-000001", "05-MAY-2026", "01-MAY-2026")],
              [owner_row("0000000006-26-000001", "0001000023", "PLACEHOLDER JANE", "Officer", "Placeholder SVP")])
        b = Fixture({"2024q3": q3, "2026q2": q2}).build()
        r = rows_by_owner(b)["0001000023"]
        self.assertEqual(b["periodFrom"], "2024-07-01")
        self.assertEqual(b["periodTo"], "2026-06-30")
        self.assertEqual(r["roles"], pd.ROLE_BITS["officer"])  # the out-of-window Director filing is not read
        self.assertEqual((r["firstFiled"], r["lastFiled"], r["title"]), ("2024-07-03", "2026-05-05", "Placeholder SVP"))
        self.assertEqual(b["counts"]["read"]["submissionsOutOfWindow"], 1)

    def test_joint_filing_gives_null_nss(self):
        subs = [
            sub_row("0000000007-26-000001", "05-MAY-2026", "01-MAY-2026", nss="1"),
            sub_row("0000000007-26-000002", "06-MAY-2026", "02-MAY-2026", nss="true"),
        ]
        owners = [
            owner_row("0000000007-26-000001", "0001000031", "PLACEHOLDER JANE", "Director"),
            owner_row("0000000007-26-000001", "0001000032", "PLACEHOLDER JOHN", "Director"),
            owner_row("0000000007-26-000002", "0001000033", "PLACEHOLDER ALEX", "Director"),
        ]
        rows = rows_by_owner(Fixture({"2026q2": (subs, owners)}).build())
        self.assertIsNone(rows["0001000031"]["nssFiled"])
        self.assertIsNone(rows["0001000032"]["nssFiled"])
        self.assertEqual(rows["0001000033"]["nssFiled"], "2026-05-06")

    def test_joint_count_includes_owners_outside_the_link(self):
        # The co-filer has an empty relationship and is dropped, but the
        # filing is still joint.
        subs = [sub_row("0000000008-26-000001", "05-MAY-2026", "01-MAY-2026", nss="1")]
        owners = [
            owner_row("0000000008-26-000001", "0001000034", "PLACEHOLDER JANE", "Director"),
            owner_row("0000000008-26-000001", "0001000035", "PLACEHOLDER JOHN", ""),
        ]
        b = Fixture({"2026q2": (subs, owners)}).build()
        self.assertIsNone(rows_by_owner(b)["0001000034"]["nssFiled"])

    def test_five_boolean_encodings(self):
        self.assertEqual([pd.parse_bool(v) for v in ("0", "1", "false", "true", "")],
                         [False, True, False, True, False])
        self.assertEqual([pd.parse_bool(v) for v in ("TRUE", " 1 ", "False")], [True, True, False])
        self.assertIsNone(pd.parse_bool("yes"))
        subs = [sub_row(f"0000000009-26-00000{i}", "05-MAY-2026", "01-MAY-2026", nss=v)
                for i, v in enumerate(("0", "1", "false", "true", ""))]
        owners = [owner_row(s[0], f"000100004{i}", "PLACEHOLDER JANE", "Director") for i, s in enumerate(subs)]
        rows = rows_by_owner(Fixture({"2026q2": (subs, owners)}).build())
        self.assertEqual([rows[f"000100004{i}"]["nssFiled"] for i in range(5)],
                         [None, "2026-05-05", None, "2026-05-05", None])

    def test_empty_relationship_is_dropped_and_counted(self):
        subs = [
            sub_row("0000000010-26-000001", "05-MAY-2026", "01-MAY-2026"),
            sub_row("0000000010-26-000002", "06-MAY-2026", "02-MAY-2026"),
        ]
        owners = [
            owner_row("0000000010-26-000001", "0001000051", "PLACEHOLDER JANE", ""),
            owner_row("0000000010-26-000001", "0001000052", "PLACEHOLDER JOHN", "Director"),
            owner_row("0000000010-26-000002", "0001000052", "PLACEHOLDER JOHN", ""),
        ]
        b = Fixture({"2026q2": (subs, owners)}).build()
        rows = rows_by_owner(b)
        self.assertNotIn("0001000051", rows)
        self.assertEqual(rows["0001000052"]["roles"], pd.ROLE_BITS["director"])
        self.assertEqual(b["counts"]["dropped"]["emptyRelationship"], 1)
        self.assertEqual(b["counts"]["edges"], 1)

    def test_relationship_tokens_union(self):
        self.assertEqual(pd.parse_roles("Director,Officer,TenPercentOwner,Other"), (15, 0))
        self.assertEqual(pd.parse_roles(""), (0, 0))
        self.assertEqual(pd.parse_roles("Director,Something"), (1, 1))
        self.assertEqual(pd.parse_roles("TenPercentOwnerOther"), (12, 0))
        self.assertEqual(pd.parse_roles("OfficerDirectorX"), (0, 1))


class T13Disambiguators(unittest.TestCase):
    CHANGED = [
        # a state after a slash, with or without a space, closed or not
        ("PLACEHOLDER JOHN A /WI", "PLACEHOLDER JOHN A"),
        ("PLACEHOLDER JOHN J/NY", "PLACEHOLDER JOHN J"),
        ("PLACEHOLDER JOHN /DE/", "PLACEHOLDER JOHN"),
        # other EDGAR suffixes and a bare slash
        ("PLACEHOLDER JOHN J /ADV", "PLACEHOLDER JOHN J"),
        ("PLACEHOLDER JOHN/ FA", "PLACEHOLDER JOHN"),
        ("PLACEHOLDER JOHN G/", "PLACEHOLDER JOHN G"),
        # a ZIP code, bare, ZIP+4, in parentheses, or after a comma
        ("PLACEHOLDER JANE 12345", "PLACEHOLDER JANE"),
        ("PLACEHOLDER JANE (12345-1234)", "PLACEHOLDER JANE"),
        ("Placeholder Jane, 12345", "Placeholder Jane"),
        ("PLACEHOLDER JANE 123451234", "PLACEHOLDER JANE"),
        # a birth year
        ("Placeholder Jane 1962", "Placeholder Jane"),
        ("Placeholder Jane (2001)", "Placeholder Jane"),
        # a state name in parentheses
        ("Placeholder Jane (Michigan)", "Placeholder Jane"),
        ("Placeholder Jane (New  York)", "Placeholder Jane"),
        # more than one, in any order
        ("PLACEHOLDER JOHN /NY 10017", "PLACEHOLDER JOHN"),
        ("PLACEHOLDER JOHN 1962 /ADV/NY", "PLACEHOLDER JOHN"),
        # nothing else left
        ("12345", ""),
        ("/NY", ""),
    ]
    UNCHANGED = [
        "Placeholder Jane N/A",           # one letter after the slash
        "Placeholder Workers/ABCD",       # four letters after the slash
        "Placeholder Jane (NMN)",         # no middle name
        "Placeholder Jane (CA)",          # can be initials
        "Placeholder (PJ) Jane",
        "Placeholder Jane (Placeholder)", # a nickname
        "Placeholder 19 Jane",            # not a year
        "Placeholder 1850 Jane",          # outside 1900-2099
        "Placeholder Jane 1234",          # not a ZIP code, not a year
        "PLACEHOLDER JANE1962",           # not standing alone
        "Placeholder Jane III",
        "Placeholder-Example Jane",
        "PLACEHOLDER JANE A.",
    ]

    def test_names(self):
        for raw, want in self.CHANGED:
            with self.subTest(raw=raw):
                self.assertEqual(pc.individual_name(raw), want)
        for raw in self.UNCHANGED:
            with self.subTest(raw=raw):
                self.assertEqual(pc.individual_name(raw), raw)
        self.assertEqual(pc.individual_name("  PLACEHOLDER   JANE  "), "PLACEHOLDER JANE")
        self.assertEqual(pc.individual_name(""), "")
        self.assertEqual(pc.individual_name(None), "")

    def test_only_an_individuals_stored_name_drops_them(self):
        subs = [
            sub_row("0000000014-26-000001", "05-MAY-2026", "01-MAY-2026"),
            sub_row("0000000014-26-000002", "12-MAY-2026", "10-MAY-2026"),
        ]
        owners = [
            # filed under two names; the latest is the one stored, less its ZIP
            owner_row("0000000014-26-000001", "0001000081", "PLACEHOLDER JOHN A /WI", "Director"),
            owner_row("0000000014-26-000002", "0001000081", "PLACEHOLDER JOHN A 12345", "Director"),
            owner_row("0000000014-26-000001", "0001000082", "Placeholder Jane 1962", "Officer", "Placeholder VP"),
            owner_row("0000000014-26-000001", "0001000083", "EXAMPLE HOLDINGS CORP /DE/", "TenPercentOwner"),
            owner_row("0000000014-26-000001", "0001000084", "PLACEHOLDER FAMILY TRUST /NY", "TenPercentOwner"),
            owner_row("0000000014-26-000001", "0001000085", "12345", "Director"),
        ]
        b = Fixture({"2026q2": (subs, owners)}).build()
        rows = rows_by_owner(b)
        self.assertEqual(rows["0001000081"]["name"], "PLACEHOLDER JOHN A")
        self.assertEqual(rows["0001000082"]["name"], "Placeholder Jane")
        self.assertEqual((rows["0001000083"]["class"], rows["0001000083"]["name"]), ("e", "EXAMPLE HOLDINGS CORP /DE/"))
        self.assertEqual((rows["0001000084"]["class"], rows["0001000084"]["name"]), ("v", None))
        # nothing left but the ZIP: no made-up name, the link is dropped and counted
        self.assertNotIn("0001000085", rows)
        self.assertEqual(b["counts"]["dropped"], {"emptyRelationship": 0, "emptyName": 1})
        self.assertEqual(b["counts"]["namesCleaned"], 2)
        data = pd.serialize(b)
        for s in (b"12345", b"1962", b"/WI"):
            self.assertNotIn(s, data)


class Parsing(unittest.TestCase):
    def test_dates(self):
        self.assertEqual(pd.parse_sec_date("31-MAR-2015"), "2015-03-31")
        self.assertIsNone(pd.parse_sec_date(""))
        self.assertIsNone(pd.parse_sec_date("31-FOO-2015"))
        self.assertIsNone(pd.parse_sec_date("31-FEB-2015"))

    def test_titles(self):
        for raw in ("See Remarks", "SEE REMARKS", "See Remarks below.", "*** See Remarks", "Please See Remarks",
                    '"See ""Remarks"""', "(See remarks (3))", "See Remark", "SEE BELOW", "(title in explanation below)"):
            with self.subTest(raw=raw):
                self.assertEqual(pd.parse_title(raw), (None, True))
        self.assertEqual(pd.parse_title("Co-Placeholder (See Remarks)"), ("Co-Placeholder (See Remarks)", True))
        self.assertEqual(pd.parse_title("  Chief  Placeholder Officer "), ("Chief Placeholder Officer", False))
        self.assertEqual(pd.parse_title(""), (None, False))

    def test_other_text_allowlist(self):
        self.assertEqual(pd.parse_other("member of 10% OWNER group"), "Member of 10% owner group")
        self.assertEqual(pd.parse_other("Trustee."), "Trustee")
        self.assertEqual(pd.parse_other("Trustee of the Placeholder Family Trust"), "Other (see filing)")
        self.assertEqual(pd.parse_other(""), "Other (see filing)")

    def test_quarters(self):
        self.assertEqual(pd.quarter_range("2024q3", "2025q2"), ["2024q3", "2024q4", "2025q1", "2025q2"])
        self.assertEqual(pd.period_bounds(["2024q4", "2025q4"]), ("2024-10-01", "2025-12-31"))
        with self.assertRaises(pd.BuildError):
            pd.quarter_range("2026q2", "2024q3")


class Cli(unittest.TestCase):
    def run_main(self, args):
        out = io.StringIO()
        err = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = pd.main(args)
        return rc, out.getvalue(), err.getvalue()

    def test_deterministic_and_size_gate(self):
        fx = sentinel_fixture()
        tickers, companies, overrides = fx.files()
        base = ["--zip-dir", fx.dir, "--from", "2026q2", "--to", "2026q2", "--universe", tickers,
                "--companies", companies, "--overrides", overrides]
        a, b = os.path.join(fx.dir, "a.json"), os.path.join(fx.dir, "b.json")
        self.assertEqual(self.run_main(base + ["--out", a])[0], 0)
        self.assertEqual(self.run_main(base + ["--out", b])[0], 0)
        with open(a, "rb") as fa, open(b, "rb") as fb:
            da, db = fa.read(), fb.read()
        self.assertEqual(hashlib.sha256(da).hexdigest(), hashlib.sha256(db).hexdigest())
        self.assertNotIn(b"SENTINEL", da)
        self.assertIn(b'"issuers"', da)
        self.assertLess(len(gzip.compress(da)), pd.MAX_GZIP_BYTES)

        over = os.path.join(fx.dir, "over.json")
        rc, out, err = self.run_main(base + ["--out", over, "--max-raw-bytes", "100"])
        self.assertEqual(rc, 2)
        self.assertFalse(os.path.exists(over))
        self.assertIn("over the size budget", err)
        rc, _out, _err = self.run_main(base + ["--out", over, "--max-gzip-bytes", "100"])
        self.assertEqual(rc, 2)
        self.assertFalse(os.path.exists(over))

    def test_business_is_keyed_by_cik_not_name(self):
        # Two listed issuers share a name. A listed CIK is a business under any
        # filed name; an unlisted CIK filing under that same name is not.
        shared = "PLACEHOLDER SHARED NAME INC"
        unlisted_owner = "0001000091"
        subs = [
            sub_row("0000000015-26-000001", "05-MAY-2026", "01-MAY-2026", issuer=ISSUER),
            sub_row("0000000015-26-000002", "06-MAY-2026", "02-MAY-2026", issuer=ISSUER_2),
        ]
        owners = [
            owner_row("0000000015-26-000001", ISSUER_2, "PLACEHOLDER OTHER FILED NAME", "TenPercentOwner"),
            owner_row("0000000015-26-000002", unlisted_owner, shared, "TenPercentOwner"),
            owner_row("0000000015-26-000002", "0001000092", "PLACEHOLDER JANE", "Director"),
        ]
        fx = Fixture({"2026q2": (subs, owners)})
        _tickers, companies, overrides = fx.files()
        tickers = os.path.join(fx.dir, "shared-tickers.json")
        with open(tickers, "w") as f:
            json.dump({"fields": ["cik", "name", "ticker", "exchange"], "data": [
                [int(ISSUER), shared, "PHA", "Nasdaq"],
                [int(ISSUER_2), shared, "PHB", "NYSE"],
            ]}, f)
        out = os.path.join(fx.dir, "shared.json")
        rc, _out, err = self.run_main(["--zip-dir", fx.dir, "--from", "2026q2", "--to", "2026q2", "--universe", tickers,
                                       "--companies", companies, "--overrides", overrides, "--out", out])
        self.assertEqual(rc, 0, err)
        with open(out, encoding="utf-8") as f:
            b = json.load(f)
        self.assertEqual(sorted(b["issuers"]), [ISSUER, ISSUER_2])
        self.assertEqual(rows_by_owner(b, ISSUER)[ISSUER_2]["class"], "b")
        self.assertEqual(rows_by_owner(b, ISSUER)[ISSUER_2]["name"], "PLACEHOLDER OTHER FILED NAME")
        self.assertEqual(rows_by_owner(b, ISSUER_2)[unlisted_owner]["class"], "e")
        self.assertEqual(set(rows_by_owner(b, ISSUER_2)), {unlisted_owner, "0001000092"})
        self.assertEqual((b["counts"]["businesses"], b["counts"]["entities"], b["counts"]["persons"]), (1, 1, 1))

    def test_missing_zip_is_an_error(self):
        fx = sentinel_fixture()
        tickers, companies, overrides = fx.files()
        rc, _out, err = self.run_main(["--zip-dir", fx.dir, "--from", "2026q1", "--to", "2026q2",
                                       "--universe", tickers, "--companies", companies, "--overrides", overrides,
                                       "--out", os.path.join(fx.dir, "x.json")])
        self.assertEqual(rc, 1)
        self.assertIn("2026q1", err)

    def test_list_quarters_reads_the_landing_page_once(self):
        page = b"""<html><body>
          <a href="/files/datastandardsinnovation/data/insider-transactions-data-sets/2026q2_form345.zip">2026 Q2</a>
          <a href="/files/structureddata/data/insider-transactions-data-sets/2026q1_form345.zip">2026 Q1</a>
          <a href="/files/structureddata/data/insider-transactions-data-sets/2025q4_form345.zip">2025 Q4</a>
          <a href="/files/structureddata/data/insider-transactions-data-sets/readme.htm">readme</a>
        </body></html>"""
        calls = []

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def fake_urlopen(req, timeout=None):
            calls.append(req)
            return Resp(page)

        with mock.patch.object(pd.urllib.request, "urlopen", fake_urlopen):
            rc, out, _err = self.run_main(["--list-quarters"])
        self.assertEqual(rc, 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].full_url, pd.LANDING)
        self.assertEqual(calls[0].get_header("User-agent"), "embedding-atlas/0.1 contact: jcdavis131@gmail.com")
        self.assertEqual(out.splitlines(), [
            "2025q4  /files/structureddata/data/insider-transactions-data-sets/2025q4_form345.zip",
            "2026q1  /files/structureddata/data/insider-transactions-data-sets/2026q1_form345.zip",
            "2026q2  /files/datastandardsinnovation/data/insider-transactions-data-sets/2026q2_form345.zip",
        ])


if __name__ == "__main__":
    unittest.main(verbosity=1)
