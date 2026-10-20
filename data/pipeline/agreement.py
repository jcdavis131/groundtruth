"""The preregistered agreement check for the county joins (writeups/jev-2026-10-18/JOINS-PREREG.md).

    python data/pipeline/agreement.py --date 2026-10-20 [--data-root DIR] [--offline]

For the six strata (nid-dams, nrhp-listed, nces-public-schools x Alabama, Texas) it reads the snapshots' records
(<data-root>/work/<snapshot-id>.jsonl, the records as validated), re-tests every point against the TIGER/Line 2025
polygons, and reports:

  C1  TIGERweb layer 82 of tigerWMS_ACS2025 at the same point vs the PIP county, on a seeded sample of 600 per
      stratum (random.Random(20261020).sample of the ids sorted as strings), plus every C2 disagreement and every
      PIP-unplaced record within 0.05 degrees of a polygon, reported apart from the sample's rate.
  C2  the publisher's own county (name join, or NCES's code) vs the PIP county, on the whole population.

Every miss gets exactly one class, tested in this order (the prereg's section 7): V vintage change, T our 0.05
degree tolerance, G within 0.005 degrees of the other county's polygon, P publisher point error, X unexplained.
Raw agreement is reported before explained agreement, both with Wilson 95% intervals. A TIGERweb request that fails
stays unscored and is listed. The report goes to <data-root>/work/agreement.<date>.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path

import boundaries
import cards
import geo
import join
import net
import read

SEED = 20261020
N_SAMPLE = 600
EDGE_DEG = 0.005
TOLERANCE_DEG = cards.BOUNDARY_TOLERANCE_DEG
# apps/map/lib/hazards/bake.ts BOUNDARY_CHANGED_SINCE_2010: counties whose boundary or code changed since 2010.
BOUNDARY_CHANGED_SINCE_2010 = ("02063", "02066", "02105", "02195", "02198", "51019")
TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2025/MapServer/82"
STATES = {"alabama": ("01", (-88.6, 30.0, -84.8, 35.1)), "texas": ("48", (-106.8, 25.7, -93.4, 36.7))}
COLLECTIONS = ["nid-dams", "nrhp-listed", "nces-public-schools"]


def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float] | None:
    """The Wilson score interval for k of n; None when n is 0."""
    if n == 0:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def sample_ids(ids: list[str], n: int = N_SAMPLE, seed: int = SEED) -> list[str]:
    """The preregistered draw: ids sorted ascending as strings, then random.Random(seed).sample."""
    ids = sorted(ids)
    return sorted(random.Random(seed).sample(ids, min(n, len(ids))))


def classify_miss(*, theirs: str | None, pip: str, other_dist: float | None, tigerweb: str | None, tigerweb_known: bool, in_file: bool, c1: bool) -> str:
    """The class of one miss (prereg section 7), tested in order V, G, P, X (T is for unplaced records).

    c1 is True for a TIGERweb-vs-PIP miss (`theirs` is TIGERweb's county), False for a publisher-vs-PIP miss.
    other_dist is the distance in degrees from the point to the other county's polygon (None when unknown).
    """
    if theirs is not None and (theirs in BOUNDARY_CHANGED_SINCE_2010 or not in_file):
        return "V"
    if other_dist is not None and other_dist <= EDGE_DEG:
        return "G"
    if not c1 and tigerweb_known and tigerweb == pip:
        return "P"
    return "X"


def tigerweb_url(x: float, y: float) -> str:
    return f"{TIGERWEB}/query?geometry={x:.7f},{y:.7f}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=GEOID,NAME&returnGeometry=false&f=json"


def tigerweb_county(fx: net.Fetcher, x: float, y: float) -> tuple[bool, str | None]:
    """(answered, GEOID or None). answered False means the request failed: the row stays unscored."""
    try:
        j = fx.get_json(tigerweb_url(x, y), "tigerweb")
    except Exception:
        return False, None
    if "error" in j or "features" not in j:
        return False, None
    f = j["features"]
    if not f:
        return True, None
    return True, f[0]["attributes"]["GEOID"]


def stratum_rows(data_root: Path, collection: str, region: str, date: str) -> list[dict]:
    p = data_root / "work" / f"{collection}.{region}.{date}.jsonl"
    return [json.loads(line) for line in p.read_text("utf8").splitlines() if line]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--date", required=True)
    ap.add_argument("--data-root", type=Path, default=None)
    ap.add_argument("--offline", action="store_true", help="TIGERweb answers from the raw cache only")
    ap.add_argument("--dry-run", action="store_true", help="no TIGERweb request and no miss class: print the polygon and publisher counts only")
    a = ap.parse_args(argv)
    root = a.data_root or read.default_data_root()
    zp, bmeta = boundaries.ensure(root, offline=True)
    fx = net.Fetcher(root / "raw", offline=a.offline)
    ix = join.name_index()
    report = {"preregistered": "writeups/jev-2026-10-18/JOINS-PREREG.md", "seed": SEED, "boundary": boundaries.boundary_block(bmeta), "tigerweb": TIGERWEB, "strata": {}, "boundaryChangedCountiesInStates": []}
    sample_all: dict[str, list[str]] = {}
    for region, (fips, bbox) in STATES.items():
        con = geo.connect()
        boundaries.load(con, zp, bbox=bbox)
        in_file = {r[0] for r in con.execute("SELECT GEOID FROM county_2025").fetchall()}
        report["boundaryChangedCountiesInStates"] += [g for g in BOUNDARY_CHANGED_SINCE_2010 if g.startswith(fips)]
        for coll in COLLECTIONS:
            rows = stratum_rows(root, coll, region, a.date)
            name = f"{coll}.{region}"
            rec = {r["id"]: r for r in rows}
            pts = [(r["id"], fips, float(r["geometry"]["coordinates"][0]), float(r["geometry"]["coordinates"][1])) for r in rows]
            hits = join.point_in_polygon(con, pts)
            region_name = {"alabama": "Alabama", "texas": "Texas"}[region]
            # distance from each point to the publisher's county polygon, and to any polygon at all
            theirs: dict[str, str | None] = {}
            for r in rows:
                kind, val = join.publisher_county(r, region_name)
                theirs[r["id"]] = join.join_name(ix, {"alabama": "AL", "texas": "TX"}[region], val)["geoid"] if kind == "name" else (val if kind == "code" else None)
            geoms = {i: (x, y) for i, _, x, y in pts}
            pip = {i: (h[0] if len(h) == 1 else None) for i, h in hits.items()}
            ids = sorted(rec)
            smp = sample_ids(ids)
            sample_all[name] = smp
            c2_miss = [i for i in ids if pip[i] and theirs[i] and pip[i] != theirs[i]]
            unplaced_ids = [i for i in ids if not hits[i]]
            # Distances are only needed for the misses (to the publisher's county) and the unplaced (to any county of the
            # state), so only those points go in: a distance from every point to every county ran the box out of RAM.
            need = sorted(set(c2_miss) | set(unplaced_ids))
            d_theirs: dict[str, float] = {}
            d_any: dict[str, float] = {}
            if need:
                con.execute("CREATE OR REPLACE TEMP TABLE q AS SELECT * FROM (VALUES " + ",".join(f"('{i}',{geoms[i][0]!r},{geoms[i][1]!r},{('NULL' if theirs[i] is None else repr(theirs[i]))})" for i in need) + ") t(id,x,y,theirs)")
                d_theirs = {i: d for i, d in con.execute("SELECT q.id, ST_Distance(c.geom, ST_Point(q.x, q.y)) FROM q JOIN county_2025 c ON c.GEOID = q.theirs").fetchall()}
                d_any = {i: d for i, d in con.execute("SELECT q.id, min(ST_Distance(c.geom, ST_Point(q.x, q.y))) FROM q JOIN county_2025 c ON starts_with(c.GEOID, ?) GROUP BY q.id", [fips]).fetchall()}
            # C2 misses and near-tolerance unplaced ids also get a TIGERweb answer, outside the sample.
            near_unplaced = [i for i in unplaced_ids if d_any.get(i, 1e9) <= TOLERANCE_DEG]
            ask = sorted(set(smp) | set(c2_miss) | set(near_unplaced))
            if a.dry_run:
                # No TIGERweb request and no class: only what the polygons and the publisher's county already say.
                agree = sum(1 for i in ids if pip[i] and theirs[i] and pip[i] == theirs[i])
                print(json.dumps({"stratum": name, "records": len(ids), "pipPlaced": sum(1 for i in ids if pip[i]), "pipUnplaced": sum(1 for i in ids if not hits[i]), "c2Agree": agree, "c2Disagree": len(c2_miss), "tigerwebWouldAsk": len(ask), "sample": len(smp)}))
                continue
            tw: dict[str, tuple[bool, str | None]] = {}
            for n, i in enumerate(ask):
                tw[i] = tigerweb_county(fx, *geoms[i])
                if n % 200 == 0:
                    print(f"  {name}: TIGERweb {n}/{len(ask)}", file=sys.stderr, flush=True)
            # C1 on the sample
            c1 = {"sampled": len(smp), "pipUnplaced": 0, "failed": [], "scored": 0, "agree": 0, "misses": {"V": [], "G": [], "P": [], "X": []}}
            for i in smp:
                if pip[i] is None:
                    c1["pipUnplaced"] += 1
                    continue
                ok, g = tw[i]
                if not ok:
                    c1["failed"].append(i)
                    continue
                c1["scored"] += 1
                if g == pip[i]:
                    c1["agree"] += 1
                    continue
                d_other = None
                if g:
                    d_other = con.execute("SELECT ST_Distance(geom, ST_Point(?, ?)) FROM county_2025 WHERE GEOID = ?", [*geoms[i], g]).fetchone()
                    d_other = d_other[0] if d_other else None
                cls = classify_miss(theirs=g, pip=pip[i], other_dist=d_other, tigerweb=g, tigerweb_known=True, in_file=(g in in_file) if g else True, c1=True)
                c1["misses"][cls].append({"id": i, "pip": pip[i], "tigerweb": g})
            # C2 on the population
            c2 = {"population": len(ids), "pipPlaced": sum(1 for i in ids if pip[i]), "unchecked": 0, "noPublisherCounty": [], "scored": 0, "agree": 0, "failed": [], "misses": {"V": [], "G": [], "P": [], "X": []}}
            for i in ids:
                if join.publisher_county(rec[i], region_name)[0] is None:
                    c2["noPublisherCounty"].append(i)
                if pip[i] is None or theirs[i] is None:
                    c2["unchecked"] += 1
                    continue
                if pip[i] == theirs[i]:
                    c2["scored"] += 1
                    c2["agree"] += 1
                    continue
                ok, g = tw[i]
                if not ok:
                    c2["failed"].append(i)
                    continue
                c2["scored"] += 1
                cls = classify_miss(theirs=theirs[i], pip=pip[i], other_dist=d_theirs.get(i), tigerweb=g, tigerweb_known=True, in_file=theirs[i] in in_file, c1=False)
                c2["misses"][cls].append({"id": i, "pip": pip[i], "publisher": theirs[i], "tigerweb": g, "distToPublisherCounty": d_theirs.get(i)})
            unplaced = unplaced_ids
            tol = {"T": [], "X": []}
            for i in unplaced:
                (tol["T"] if d_any.get(i, 1e9) <= TOLERANCE_DEG else tol["X"]).append({"id": i, "nearestPolygonDeg": d_any.get(i), "tigerweb": (tw.get(i) or (None, None))[1], "tigerwebAnswered": (tw.get(i) or (None, None))[0]})
            multi = [i for i in ids if len(hits[i]) > 1]
            for blk, key in ((c1, "c1"), (c2, "c2")):
                k = blk["agree"]
                n = blk["scored"]
                blk["rawAgreement"] = (k / n) if n else None
                blk["rawWilson95"] = wilson(k, n)
                expl = k + sum(len(blk["misses"][c]) for c in ("V", "G", "P"))
                blk["explainedAgreement"] = (expl / n) if n else None
                blk["explainedWilson95"] = wilson(expl, n)
                blk["missCounts"] = {c: len(v) for c, v in blk["misses"].items()}
            report["strata"][name] = {
                "records": len(ids),
                "methods": {m: sum(1 for r in rows if r["place"].get("countyFips") and r["place"]["method"] == m) for m in ("point-in-polygon", "source-field", "name-lookup")},
                "unplaced": len(unplaced),
                "pipInMoreThanOnePolygon": multi,
                "unplacedByClass": {"T": len(tol["T"]), "X": len(tol["X"])},
                "unplacedDetail": tol,
                "countiesNotInCountiesJson": sorted({r["place"]["countyFips"] for r in rows if r["place"].get("countyFips") and r["place"]["countyFips"] not in ix.geoids}),
                "tigerwebQueries": len(ask),
                "c1": c1,
                "c2": c2,
            }
    if a.dry_run:
        return 0
    sample_text = json.dumps({k: v for k, v in sorted(sample_all.items())}, separators=(",", ":"))
    report["sampleIdsSha256"] = hashlib.sha256(sample_text.encode("utf8")).hexdigest()
    out = root / "work" / f"agreement.{a.date}.json"
    out.write_text(json.dumps(report, indent=1), "utf8")
    (root / "work" / f"agreement.{a.date}.sample-ids.json").write_text(sample_text, "utf8")
    print(json.dumps({k: {"c1": {x: v["c1"][x] for x in ("scored", "agree", "rawAgreement", "rawWilson95", "missCounts")}, "c2": {x: v["c2"][x] for x in ("scored", "agree", "rawAgreement", "rawWilson95", "explainedAgreement", "missCounts", "unchecked")}, "unplacedByClass": v["unplacedByClass"]} for k, v in report["strata"].items()}, indent=1))
    print(f"report: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
