#!/usr/bin/env python3
"""
Offline class of an SEC Form 3/4/5 reporting owner: business, vehicle, entity
or individual. Stdlib only; imported by scripts/people-data.py and its tests.

EDGAR's entityType cannot do this (it is "other" for an individual director,
a 10%-owner partnership and a family trust alike), and fetching each owner's
submissions JSON would pull their mailing address (G13). So the class is a
stated word test on the name as filed, run in this order (docs/PEOPLE.md,
"Who counts as what"):

  1. business   the owner's CIK is itself a listed issuer (by CIK, never name)
  2. vehicle    a trust, estate or family marker as a whole word
  3. entity     an entity token as a whole word
  4. individual everything else

class-overrides.json (CIK and class only, no names) wins over all four for
known misfires. The class decides only whether a name and a view are shown;
every class gets the same never-read column list, so a misfire cannot leak
an address, a signature or free text.

individual_name() is the name an individual is stored under: the name as
filed less the tokens EDGAR adds to tell same-named filers apart (a state, a
ZIP code, a birth year).
"""
import json
import re

CLASSES = ("individual", "entity", "vehicle", "business")

# Most protective first: when one CIK files under several names in the
# window, the class that shows least wins (a vehicle's name is withheld, an
# entity has no view of its own, an individual has both).
PROTECTIVE_ORDER = ("vehicle", "entity", "individual")

# Word edges: not preceded or followed by a letter or digit.
_L = r"(?<![A-Z0-9])"
_R = r"(?![A-Z0-9])"

# Rule 2: personal-vehicle markers (spec section 4). TRUST counts unless it is
# followed by CO / COMPANY (a trust company acting as trustee is an entity).
# "A MINOR" is a two-word phrase: 116 owner names start with the surname
# Minor, and 516 carry UTMA inside a surname, so every marker is word-bounded.
VEHICLE_MARKERS = (
    "FBO",
    r"FOR\s+THE\s+BENEFIT\s+OF",
    "U/A",
    "UAD",
    "DTD",
    "DATED",
    "REVOCABLE",
    "IRREVOCABLE",
    r"LIVING\s+TRUST",
    "FAMILY",
    r"ESTATE\s+OF",
    "GRAT",
    "GRANTOR",
    "UTMA",
    "UGMA",
    "CUSTODIAN",
    r"A\s+MINOR",
    # [proposed] additions to the spec's list, measured on the 2024q3-2026q2
    # roster: a court-appointed conservator or guardian files for a person who
    # cannot, so the name says something about that person's health.
    "CONSERVATOR",
    "CONSERVATORSHIP",
    "GUARDIANSHIP",
    # [proposed]: "CO-" is a prefix, not the CO token, so "<X> TRUST
    # CO-TRUSTEES" is a trust with two trustees, not a trust company.
    r"TRUST(?!\s*,?\s*(?:CO(?!-)|COMPANY)" + _R + ")",
)
VEHICLE_RE = re.compile(_L + "(?:" + "|".join(VEHICLE_MARKERS) + ")" + _R)

# Rule 3: entity tokens as whole words. Holdings is plural only (a surname
# "Holding" stays a person), S.A. is dotted only (a name ending "SA" stays a
# person), SE counts only as the last token, and "L P" with a space only as
# the last two tokens, the way EDGAR writes "<X> ASSOCIATES L P" (anywhere
# else it is more likely two initials). CO followed by a hyphen is the prefix
# of "co-trustee", not the token. Undotted SA and NV, ASA
# and a singular HOLDING stay out of the list: each is also part of real
# people's names, so those entities go in class-overrides.json by CIK.
ENTITY_TOKENS = (
    "LLC",
    r"L\.L\.C\.?",
    "LP",
    r"L\.P\.?",
    "LLP",
    r"L\.L\.P\.?",
    r"INC\.?",
    r"CORP\.?",
    "CORPORATION",
    r"CO(?!-)\.?",
    "COMPANY",
    r"LTD\.?",
    "LIMITED",
    "PLC",
    r"N\.V\.?",
    r"S\.A\.",
    "AG",
    "GMBH",
    r"S\.A\.R\.L\.?",
    "SARL",
    r"B\.V\.?",
    "FUND",
    "PARTNERS",
    "CAPITAL",
    "MANAGEMENT",
    "HOLDINGS",
    "BANK",
    "ADVISORS",
    "INVESTORS",
    "SECURITIES",
    "FOUNDATION",
    "PENSION",
    "RETIREMENT",
    "ASSET",
    # [proposed] additions to the spec's list: legal forms and organisation
    # words that are never part of a person's name, each seen on an entity
    # that the spec's list classed as an individual in 2024q3-2026q2.
    "INCORPORATED",
    "LLLP",
    r"L\.L\.L\.P\.?",
    "PARTNERSHIP",
    "VENTURES",
    "ASSOCIATES",
    "INVESTMENTS",
    "AUTHORITY",
    "GROUP",
    r"S\.\s?A\.?\s+R\.\s?L\.?",  # S.a r.l., the spaced form of S.A.R.L.
    r"S\.C\.A\.?",
    r"S\.?C\.?S\.?P\.?",
    r"S\.P\.A\.?",
    r"S\.R\.L\.?",
    "A/S",
    "PJSC",
    "BHD",
    "ICAV",
    "ANSTALT",
    "COMMV",
)
ENTITY_RE = re.compile(
    _L + "(?:" + "|".join(ENTITY_TOKENS) + r")(?![A-Z0-9])"
    + r"|" + _L + r"L\.?\s+P\.?\s*$"
    + r"|" + _L + r"SE\.?\s*$"
    # [proposed]: Swedish AB and French SAS, last token only like SE.
    + r"|" + _L + r"(?:AB|SAS)\.?\s*$"
)


def name_class(name):
    """Rules 2-4 on one name as filed: 'vehicle', 'entity' or 'individual'.

    The roles a filing carries do not move a name out of rule 2: a trust that
    files with the grantor's Director, Officer and title copied onto its own
    row is still a trust, and its name still names the family (docs/PEOPLE.md).
    """
    n = (name or "").upper()
    if VEHICLE_RE.search(n):
        return "vehicle"
    if ENTITY_RE.search(n):
        return "entity"
    return "individual"


# [proposed] EDGAR's disambiguators. When two filers share a conformed name,
# EDGAR tells them apart with a token after it: a state ("SMITH JOHN /NY"), a
# registration ("/ADV"), a bare slash, a ZIP code or a birth year. On an
# individual's name each is a location or a date about the person, not part
# of the name, so the stored name drops them; the CIK stays the identity
# (G8). Classification still reads the name as filed. Entity and business
# names keep theirs ("EXAMPLE CORP /DE/" is the company's conformed name).
# Removed, in this order, until none is left:
#   (a) a 5-or-more-digit number, optionally ZIP+4, standing alone (no letter
#       or digit beside it), bare or in parentheses: "12345", "(12345-1234)";
#   (b) a 4-digit year 1900-2099 standing alone, bare or in parentheses;
#   (c) a US state or territory name in parentheses: "(Michigan)";
#   (d) at the end: a slash, then nothing or two or three letters, then an
#       optional closing slash, spaces allowed around each part: " /WI",
#       "J/NY", "/ADV", "/ FA", "/DE/", "/". One letter ("N/A") and four
#       ("/SEIU") are left alone.
# Parenthesized nicknames, initials and "(NMN)" stay: "(CA)" can be initials.
US_STATE_NAMES = (
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
    "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
    "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
    "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico",
    "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
    "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
    "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
    "Puerto Rico", "Guam", "American Samoa", "U.S. Virgin Islands", "Virgin Islands",
    "Northern Mariana Islands",
)
_ALONE_L = r"(?<![A-Za-z0-9])"
_ALONE_R = r"(?![A-Za-z0-9])"
_DISAMBIGUATOR_ANYWHERE = re.compile(
    r"\(\s*" + _ALONE_L + r"(?:\d{5,}(?:-\d{4})?|(?:19|20)\d{2})" + _ALONE_R + r"\s*\)"
    + r"|" + _ALONE_L + r"(?:\d{5,}(?:-\d{4})?|(?:19|20)\d{2})" + _ALONE_R
    + r"|\(\s*(?:" + "|".join(r"\s+".join(map(re.escape, s.split())) for s in US_STATE_NAMES) + r")\s*\)",
    re.I,
)
_DISAMBIGUATOR_TRAILING = re.compile(r"\s*/\s*(?:[A-Za-z]{2,3}\s*/?)?\s*$")


def individual_name(name):
    """An individual's name as stored: the name as filed, with EDGAR's
    disambiguators (above) removed. '' when nothing else is left."""
    n = re.sub(r"\s+", " ", name or "").strip()
    out = n
    while True:
        prev = out
        out = _DISAMBIGUATOR_ANYWHERE.sub(" ", out)
        out = _DISAMBIGUATOR_TRAILING.sub("", out)
        out = re.sub(r"\s+", " ", out).strip()
        if out == prev:
            break
    if out != n:
        out = re.sub(r"^[\s,;-]+|[\s,;-]+$", "", out)
    return out


def owner_class(cik, names, businesses, overrides):
    """Class of one owner CIK.

    cik: 10-digit string. names: every name the CIK filed under in the window.
    businesses: set of 10-digit issuer CIKs (rule 1). overrides: {cik: class}.
    A CIK that filed under several names takes the most protective class among
    them; names are never compared with other CIKs' names (G8).
    """
    if cik in overrides:
        return overrides[cik]
    if cik in businesses:
        return "business"
    found = {name_class(n) for n in names} or {"individual"}
    for c in PROTECTIVE_ORDER:
        if c in found:
            return c
    return "individual"


def load_overrides(path):
    """class-overrides.json: {"overrides": [{"cik": "0000000000", "class": ...}]}.

    Only a CIK and a class per entry; any other key is refused so the file can
    never become a list of names.
    """
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    out = {}
    for row in doc.get("overrides", []):
        extra = set(row) - {"cik", "class"}
        if extra:
            raise ValueError(f"class-overrides.json: unexpected keys {sorted(extra)}")
        cik = str(row["cik"]).strip()
        if not cik.isdigit() or len(cik) > 10:
            raise ValueError(f"class-overrides.json: bad cik {cik!r}")
        if row["class"] not in CLASSES:
            raise ValueError(f"class-overrides.json: bad class {row['class']!r}")
        out[cik.zfill(10)] = row["class"]
    return out
