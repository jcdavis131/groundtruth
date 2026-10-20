"""County joins for a snapshot's records: the county a point lies in, tested against one named boundary file.

For every record whose region config gives no countyFips (dams, NRHP listings), the record's point is tested
against the TIGER/Line 2025 county polygons of the record's own state (DuckDB ST_Contains). One polygon
contains it: place.countyFips is that county and place.method is 'point-in-polygon'. The publisher's own county
string is joined by name as a second, independent check (a Python port of apps/map/lib/places/countyJoin.ts,
both held to apps/map/lib/places/countyJoin.cases.json), and where the two disagree the polygon wins and the
pair is listed in the manifest's joins[].disagreements.

No polygon contains the point (offshore inside the 0.05 degree tolerance, or on a state line): the name join
is tried, and if it places the record the method is 'name-lookup'. Otherwise the record is unplaced, with a
reason in joins[].unplaced. A point in more than one polygon is unplaced too. The nearest county is never used
and no point or code is ever invented. Reasons live in the manifest, never on the record.

A record that already has a countyFips from its source (schools: NCES's county code, 'source-field') keeps it;
its point is still tested, and the two are compared as the control cross-check.

    join_records(con, records, name_ix, boundary) -> (records, joins_block)

`con` holds the table county_2025(GEOID, NAME, geom) (boundaries.load). Everything is sorted, so two runs on
the same inputs give the same records and the same block.
"""

from __future__ import annotations

import html
import json
import re
import unicodedata
from pathlib import Path

import geo

REPO = Path(__file__).resolve().parents[2]
COUNTIES_JSON = REPO / "apps" / "map" / "lib" / "places" / "data" / "counties.json"
CASES_JSON = REPO / "apps" / "map" / "lib" / "places" / "countyJoin.cases.json"

# ---------------------------------------------------------------- the name rule (port of countyJoin.ts)

_ENTITIES = {"amp": "&", "ntilde": "ñ", "Ntilde": "Ñ", "aacute": "á", "eacute": "é", "iacute": "í", "oacute": "ó", "uacute": "ú", "uuml": "ü", "apos": "'", "quot": '"'}


def decode_entities(s) -> str:
    """Agency county strings can carry HTML entities ("Pe&ntilde;uelas"); decode the named and numeric ones."""
    def one(m):
        e = m.group(1)
        if e[0] == "#":
            return chr(int(e[1:]))
        return _ENTITIES.get(e, m.group(0))
    return re.sub(r"&(#\d+|[a-z]+);", one, "" if s is None else str(s), flags=re.I)


def norm(s) -> str:
    """Lower case, no accents, "St." as "saint", punctuation as space, and the county-type suffix dropped."""
    t = decode_entities(s).lower()
    t = unicodedata.normalize("NFD", t)
    t = re.sub("[̀-ͯ]", "", t)
    t = re.sub(r"\bst\.?\s", "saint ", t, flags=re.A)
    t = re.sub(r"\bste\.?\s", "sainte ", t, flags=re.A)
    t = re.sub(r"[^a-z ]", " ", t)
    t = re.sub(r"\s+(county|parish|borough|census area|city and borough|municipality|municipio)$", "", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


class NameIndex:
    def __init__(self, rows):
        self.state_key: dict[str, str] = {}
        self.by_state: dict[str, dict[str, str]] = {}
        self.counties_of: dict[str, list[str]] = {}
        for c in rows:
            st = c["stusab"]
            self.state_key[st.upper()] = st
            self.state_key[c["stateName"].upper()] = st
            m = self.by_state.setdefault(st, {})
            self.counties_of.setdefault(st, []).append(c["geoid"])
            n = norm(c["name"])
            m[n] = "ambiguous" if n in m else c["geoid"]
            ns = f"nospace:{n.replace(' ', '')}"
            m[ns] = "ambiguous" if ns in m else c["geoid"]
        self.geoids = {c["geoid"] for c in rows}


def name_index(counties_json: Path = COUNTIES_JSON) -> NameIndex:
    return NameIndex(json.loads(Path(counties_json).read_text("utf8"))["rows"])


def _one(m: dict, n: str) -> dict:
    # A bare name where the state has both "<X> County" and "<X> city" cannot be placed.
    if f"{n} city" in m and n in m:
        return {"geoid": None, "reason": "ambiguous_county_or_city", "candidates": [m[n], m[f"{n} city"]]}
    g = m.get(n) or m.get(f"nospace:{n.replace(' ', '')}") or (None if n.endswith(" city") else m.get(f"{n} city"))
    if not g:
        return {"geoid": None, "reason": "no_name_match", "candidates": None}
    if g == "ambiguous":
        return {"geoid": None, "reason": "ambiguous", "candidates": None}
    return {"geoid": g, "reason": None, "candidates": None}


def join_name(ix: NameIndex, state, county) -> dict:
    """A county string + state to a FIPS, or why not and which counties it could be in (candidates; None = any)."""
    st = ix.state_key.get(("" if state is None else str(state)).strip().upper())
    m = ix.by_state.get(st) if st else None
    if not st or m is None:
        return {"geoid": None, "reason": "state_not_in_counties", "candidates": []}
    allc = ix.counties_of[st]
    whole = norm(county)
    if whole:
        w = _one(m, whole)
        if w["geoid"]:
            return w
    parts = [p for p in (norm(x) for x in re.split(r"[,/]", decode_entities(county))) if p]
    if not parts:
        return {"geoid": None, "reason": "no_county", "candidates": allc}
    if len(parts) == 1:
        r = _one(m, parts[0])
        return r if (r["geoid"] or r["candidates"]) else {**r, "candidates": allc}
    each = [_one(m, p) for p in parts]
    known = all(r["geoid"] or r["candidates"] for r in each)
    if known:
        cands = sorted({c for r in each for c in ([r["geoid"]] if r["geoid"] else r["candidates"])})
    else:
        cands = allc
    return {"geoid": None, "reason": "multi_county", "candidates": cands}


# ---------------------------------------------------------------- the publisher's own county

def publisher_county(rec: dict, region_name: str) -> tuple[str | None, str | None]:
    """(kind, value): the county as the publisher wrote it on this row, or (None, None) when it didn't.

    'code': NCES's 5-digit county code in details.county ("Travis County (48453)").
    'name': a county name. NID writes "<County>, <State>" and NPS the bare name; the state suffix, when it names
    this record's own state, is dropped before the name rule (the rule would read it as a second county).
    """
    d = rec["details"]
    v = d.get("county")
    if not isinstance(v, str) or not v.strip():
        return None, None
    m = re.search(r"\((\d{5})\)\s*$", v)
    if rec["collection"] == "nces-public-schools":
        return ("code", m.group(1)) if m else (None, None)
    s = v.strip()
    tail = f", {region_name}"
    if s.lower().endswith(tail.lower()):
        s = s[: -len(tail)].strip()
    return "name", s


# ---------------------------------------------------------------- point in polygon

def point_in_polygon(con, points: list[tuple[str, str, float, float]]) -> dict[str, list[str]]:
    """{id: [GEOID, ...]} for each (id, stateFips, lon, lat): the county polygons of that state containing the point.

    A bounding-box pass picks the few candidate counties first, so ST_Contains only runs on polygons that
    could hold the point. Ties are never broken: an id with two geoids is returned with both.
    """
    out: dict[str, list[str]] = {i: [] for i, *_ in points}
    if not points:
        return out
    con.execute(
        "CREATE OR REPLACE TEMP TABLE county_box AS SELECT GEOID, geom, ST_XMin(geom) AS x0, ST_YMin(geom) AS y0, ST_XMax(geom) AS x1, ST_YMax(geom) AS y1 FROM county_2025"
    )
    with geo._ndjson([{"id": i, "st": st, "x": x, "y": y} for i, st, x, y in points]) as p:
        con.execute(
            f"CREATE OR REPLACE TEMP TABLE pts AS SELECT * FROM read_json('{geo._sql_path(p)}', format='newline_delimited', columns={{id: 'VARCHAR', st: 'VARCHAR', x: 'DOUBLE', y: 'DOUBLE'}})"
        )
    # Candidate pairs by state and bounding box only, without the polygons, so no geometry is copied per pair.
    con.execute(
        "CREATE OR REPLACE TEMP TABLE cand AS SELECT p.id, p.x, p.y, c.GEOID FROM pts p JOIN county_box c "
        "ON starts_with(c.GEOID, p.st) AND p.x BETWEEN c.x0 AND c.x1 AND p.y BETWEEN c.y0 AND c.y1"
    )
    rows = con.execute(
        "SELECT cand.id, cand.GEOID FROM cand JOIN county_2025 c ON c.GEOID = cand.GEOID WHERE ST_Contains(c.geom, ST_Point(cand.x, cand.y)) ORDER BY cand.id, cand.GEOID"
    ).fetchall()
    for i, g in rows:
        out[i].append(g)
    return out


# ---------------------------------------------------------------- the join

def unplaced_reason(vintage_note: str, kind: str | None, value: str | None, name: dict | None, hits: list[str]) -> str:
    """The joins[].unplaced reason. Never on the record."""
    if len(hits) > 1:
        return f"the point lies in {len(hits)} county polygons ({', '.join(hits)}; {vintage_note}); not placed in one"
    shown = "absent" if value is None else json.dumps(value, ensure_ascii=False)
    r = f"no county polygon contains the point ({vintage_note}); publisher county string {shown}"
    if kind == "name" and name is not None and name["reason"]:
        r += f"; name join: {name['reason']}"
    return r


def join_records(con, records: list[dict], ix: NameIndex, boundary: dict, region_name: str) -> tuple[list[dict], dict]:
    """(records with place.countyFips and place.method set where the join places them, the manifest's joins[] entry)."""
    vintage_note = f"TIGER/Line {boundary['vintage']}"
    pts = []
    for r in records:
        g = r["geometry"]
        if g["type"] != "Point":
            raise SystemExit(f"{r['id']}: geometry {g['type']}; the county join handles Point records")
        pts.append((r["id"], r["place"]["stateFips"], float(g["coordinates"][0]), float(g["coordinates"][1])))
    hits = point_in_polygon(con, pts)

    out, unplaced, disagreements = [], [], []
    methods = {"point-in-polygon": 0, "source-field": 0, "name-lookup": 0}
    agree = disagree = unchecked = 0
    for r in sorted(records, key=lambda x: x["id"]):
        place = dict(r["place"])
        h = hits[r["id"]]
        kind, value = publisher_county(r, region_name)
        name = None
        if kind == "name":
            name = join_name(ix, place["stateUsps"], value)
            theirs = name["geoid"]
        elif kind == "code":
            theirs = value
        else:
            theirs = None
        if place.get("countyFips"):
            # The source already says the county (NCES): keep it, and compare it with the polygon as the control.
            if len(h) == 1 and theirs:
                if h[0] == theirs:
                    agree += 1
                else:
                    disagree += 1
                    disagreements.append({"id": r["id"], "pip": h[0], "name": theirs})
            else:
                unchecked += 1
        elif len(h) == 1:
            place["countyFips"] = h[0]
            place["method"] = "point-in-polygon"
            if theirs:
                if h[0] == theirs:
                    agree += 1
                else:
                    disagree += 1
                    disagreements.append({"id": r["id"], "pip": h[0], "name": theirs})
            else:
                unchecked += 1
        elif len(h) == 0 and theirs:
            place["countyFips"] = theirs
            place["method"] = "name-lookup"
            unchecked += 1
        else:
            unplaced.append({"id": r["id"], "reason": unplaced_reason(vintage_note, kind, value, name, h)})
            unchecked += 1
        if place.get("countyFips"):
            methods[place["method"]] += 1
            if place["countyFips"] not in ix.geoids:
                raise SystemExit(f"{r['id']}: county {place['countyFips']} is not in counties.json (ACS2023); the boundary vintages disagree on this county")
        # record/1's own key order (stateFips, stateUsps, countyFips, method), so records are written the same way every run
        place = {k: place[k] for k in ("stateFips", "stateUsps", "countyFips", "method") if k in place}
        out.append({**r, "place": place})
    src = "details.county (NCES county code, source-field)" if records and records[0]["collection"] == "nces-public-schools" else "details.county (publisher's county name, joined by the countyJoin name rule)"
    block = {
        "field": "place.countyFips",
        "boundary": boundary,
        "methods": methods,
        "crossCheck": {"source": src, "agree": agree, "disagree": disagree, "unchecked": unchecked},
        "placed": len(out) - len(unplaced),
        "unplaced": unplaced,
        "disagreements": disagreements,
    }
    return out, block
