"""The collections the snapshot builder knows, and the one region it builds today.

Each collection names the eye route it reads, that route's box limits (read from eye's code on origin/master
ed1a907), how a record's place is read from the source's own fields, and the publisher layer that gives the
count. Box limits: eye clamps a box to `span` degrees around its centre and snaps it outward to a `grid`
degree grid, so tiles of exactly `span` on that grid come back unchanged (the builder checks the echoed bbox).
"""

from __future__ import annotations

import re

EYE = "https://eye.jcamd.com"

NCES = "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1"
NID = "https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0"
NRHP = "https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/nrhp_locations/MapServer/0"

# eye's own filter on NRHP points (app/api/land/route.ts NRHP_WHERE): listed, and no restricted address.
NRHP_EYE_WHERE = "STATUS='Listed' AND (Address IS NULL OR UPPER(Address) NOT LIKE '%RESTRICT%')"

REGIONS = {
    "texas": {
        "id": "texas",
        "name": "Texas",
        "stateFips": "48",
        "stateUsps": "TX",
        "stateName": "Texas",
        # eye's state outlines: /api/economy?op=areas&level=state (Census TIGERweb, generalised 1:20M).
        "boundaryUrl": f"{EYE}/api/economy?op=areas&level=state",
        "boundaryId": "state:48",
    },
    # Second state (2026-10-19): Mobile County is already the place the hallway test, the world_context evals
    # and the preview checks use, and the Gulf coast exercises the outline tolerance as Texas's coast does.
    "alabama": {
        "id": "alabama",
        "name": "Alabama",
        "stateFips": "01",
        "stateUsps": "AL",
        "stateName": "Alabama",
        "boundaryUrl": f"{EYE}/api/economy?op=areas&level=state",
        "boundaryId": "state:01",
    },
}

# The 20M outline is generalised: a coastal or river-border point can fall a little outside it. A record is in
# the region when its source says the state AND its point lies within this many degrees of the outline.
BOUNDARY_TOLERANCE_DEG = 0.05


def _county_code(details: dict) -> str | None:
    """NCES: details.county reads "Travis County (48453)"; the code is NCES's own CNTY field."""
    m = re.search(r"\((\d{5})\)\s*$", str(details.get("county", "")))
    return m.group(1) if m else None


def schools_state(details: dict, region: dict):
    """(source stateFips or None, place or None). The state is the first two digits of NCES's county code."""
    c = _county_code(details)
    if not c:
        return None, None
    st = c[:2]
    place = {"stateFips": st, "stateUsps": region["stateUsps"], "countyFips": c, "method": "source-field"} if st == region["stateFips"] else None
    return st, place


def named_state(details: dict, region: dict):
    """NID and NRHP: details.state is the state's name ("Texas", "TEXAS"), matched to the code table."""
    s = str(details.get("state", "")).strip().upper()
    if not s:
        return None, None
    if s == region["stateName"].upper():
        return region["stateFips"], {"stateFips": region["stateFips"], "stateUsps": region["stateUsps"], "method": "name-lookup"}
    return f"other:{s}", None


# The owner types under which a dam keeps its published name (eye's DAM_NAMED_OWNER_TYPES, lib/infra/features.ts).
# NID's PRIMARY_OWNER_TYPE values (FeatureServer/0, grouped 2026-10-18): Private, Local Government, State, Federal,
# Public Utility, Not Listed, Tribal Government and null. Anything not here is labelled by id (fail closed).
DAM_NAMED_OWNER_TYPES = frozenset({"federal", "state", "local government", "public utility", "tribal government"})


def dam_name_rule(details: dict) -> str:
    """eye's PUBLIC_NAME_RULE for nid-dams (lib/catalog/embedFields.ts, damIsNamed in lib/infra/features.ts): a dam
    keeps its published name only when its owner type is Federal, State, Local Government, Public Utility or Tribal
    Government and so is every entry of its owner types (NID's OWNER_TYPES list, eye's details["owner types"]).
    Private, Not Listed, a missing or empty owner type and any other value are labelled by NID id ("Dam TX00028"):
    a non-answer is unknown, not public.

    An answer with no "owner types" key (eye before it requested OWNER_TYPES, or a stale cached tile) can't show
    that every owner is public: 34 named Texas dams are Private only in that list (NID 2026-10-18). So it fails
    closed too and labels the dam by id; refetching the tile from an eye that serves the key brings the name
    back. A dam eye labels by id is never public-name (build.to_record)."""
    primary = str(details.get("owner type") or "").strip().lower()
    if primary not in DAM_NAMED_OWNER_TYPES:
        return "label-by-id"
    if "owner types" not in details:
        return "label-by-id"
    entries = [e.strip().lower() for e in str(details.get("owner types") or "").split(",")]
    if not all(e in DAM_NAMED_OWNER_TYPES for e in entries):
        return "label-by-id"
    return "public-name"


def dam_label(details: dict) -> str:
    """The label-by-id form eye gives a dam: "Dam <NIDID>"."""
    return f"Dam {details['NID id']}"


COLLECTIONS = {
    "nid-dams": {
        "route": "infra",
        "op": "dams",
        "span": 1.5,
        "grid": 0.25,
        # Per record: the owner type decides it (dam_name_rule), and a label-by-id dam must carry dam_label.
        "nameRule": dam_name_rule,
        "label": dam_label,
        "state": named_state,
        "stateSource": "NID's STATE field (eye's details.state)",
        "withheld": [
            {
                "field": "published name",
                "why": "NID's NAME on a privately owned dam can be its owner's name ('<Surname> Pond Dam'); eye shows it on click but never searches or embeds it, labels the dam by NID id, and a training snapshot leaves it out. The same holds for a dam whose owner type is Not Listed, missing or any value other than Federal, State, Local Government, Public Utility or Tribal Government (a non-answer is unknown, not public). A dam whose name is allowed carries it in name.",
            }
        ],
        # Said in the manifest when eye named dams this build labels by id (build.withheld_fields).
        "relabelNote": "This build labelled {n} dams by NID id that eye's answers still named, and took their name out of the record text: eye's rule before 2026-10-19 named Not Listed dams and dams with no owner type. eye's answers here carry no OWNER_TYPES, so a dam that is Private only in NID's OWNER_TYPES list is not seen and keeps its name (NID's FeatureServer/0 OWNER_TYPES says which); a rebuild from eye's answers after it requests OWNER_TYPES labels them by id.",
        "publisher": {
            "layer": NID,
            "stateWhere": lambda r: f"STATE='{r['stateName']}'",
            "idField": "NIDID",
            "statusField": None,
            "eyeId": lambda a: f"nid:{a['NIDID']}",
        },
    },
    "nces-public-schools": {
        "route": "civic",
        "op": "schools",
        "span": 0.2,
        "grid": 0.05,
        "nameRule": lambda details: "public-name",
        "state": schools_state,
        "stateSource": "the first two digits of NCES's county code CNTY (eye's details.county)",
        "withheld": [],
        "publisher": {
            "layer": NCES,
            "stateWhere": lambda r: f"LSTATE='{r['stateUsps']}'",
            "idField": "NCESSCH",
            "statusField": "SY_STATUS_TEXT",
            "eyeId": lambda a: f"nces:{a['NCESSCH']}",
            # eye leaves out schools NCES marks Inactive or Future (lib/civic/schools.ts NOT_OPERATING).
            "notServed": lambda a: a.get("SY_STATUS_TEXT") in ("Inactive", "Future"),
            "notServedWhy": "NCES status {SY_STATUS_TEXT}: not operating in 2024-25, and eye does not draw it",
        },
    },
    "nrhp-listed": {
        "route": "land",
        "op": "historic",
        "span": 0.12,
        "grid": 0.02,
        "nameRule": lambda details: "label-by-id",
        "state": named_state,
        "stateSource": "NPS's State field (eye's details.state)",
        "withheld": [
            {
                "field": "property name (as NPS lists it)",
                "why": "NPS's RESNAME can be a person's name (eye's nrhp-listed card: never searched or embedded); a training snapshot leaves it out",
            }
        ],
        "publisher": {
            "layer": NRHP,
            "stateWhere": lambda r: f"State='{r['stateName'].upper()}'",
            "idField": "OBJECTID",
            "statusField": "STATUS",
            "eyeId": lambda a: f"nrhp:pt:{a['OBJECTID']}",
            "notServed": lambda a: a.get("STATUS") != "Listed",
            "notServedWhy": "NPS STATUS {STATUS}: not a current listing, and eye asks only STATUS='Listed'",
            # Rows eye's filter keeps; a Listed row outside this set has a restricted address (never requested here).
            "eyeWhere": NRHP_EYE_WHERE,
        },
    },
}

# Build order: smallest first, so a problem shows up before the long runs.
ORDER = ["nid-dams", "nces-public-schools", "nrhp-listed"]
