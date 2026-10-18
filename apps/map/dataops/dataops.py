#!/usr/bin/env python3
"""dataops — the eye.jcamd.com data warehouse CLI.

    python3 dataops/dataops.py pull <dataset>            # latest from source
    python3 dataops/dataops.py pull --all                # every dataset
    python3 dataops/dataops.py backfill <dataset> --since YYYY-MM-DD
    python3 dataops/dataops.py validate <dataset>        # schema + key + gap check
    python3 dataops/dataops.py frame <name>              # build modeling frame
    python3 dataops/dataops.py status                   # freshness of everything

Datasets come from registry.json. Run from the repo root or anywhere;
the warehouse root is $DATAOPS_ROOT (default ~/workspace/dataops-warehouse).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dataops import common as C  # noqa: E402

REG_PATH = os.path.join(os.path.dirname(__file__), "registry.json")


def registry() -> dict:
    with open(REG_PATH) as f:
        return json.load(f)


def _puller(dataset: str):
    reg = registry()["datasets"][dataset]
    mod = __import__(f"dataops.pullers.{reg['puller']}", fromlist=["x"])
    return mod, reg


def cmd_pull(args):
    reg = registry()["datasets"]
    targets = list(reg) if args.all else [args.dataset]
    for ds in targets:
        mod, r = _puller(ds)
        print(f"--- pull {ds} ({r['source'][:60]}...)")
        kwargs = {}
        if r["puller"] == "fred":
            kwargs["series_id"] = r["series_id"]
        try:
            res = mod.pull(ds, **kwargs)
        except Exception as e:  # noqa: BLE001
            res = {"pulled_at": C.utcnow(), "status": f"error: {e}", "rows": 0}
            C.record_manifest(ds, res)
        print(json.dumps(res, indent=2)[:800])


def cmd_backfill(args):
    mod, r = _puller(args.dataset)
    print(f"--- backfill {args.dataset} since {args.since}")
    kwargs = {"since": args.since}
    if r["puller"] == "fred":
        kwargs["series_id"] = r["series_id"]
    res = mod.backfill(args.dataset, **kwargs)
    print(json.dumps(res, indent=2)[:1200])


def cmd_validate(args):
    r = registry()["datasets"][args.dataset]
    path = C.stage_path(args.dataset)
    if not os.path.exists(path):
        C.fail(f"no staged file for {args.dataset} — pull first")
    rows = C.read_csv_rows(path)
    cols = r["schema"]
    missing = [c for c in cols if c not in (rows[0].keys() if rows else [])]
    key = r["natural_key"]
    seen, dupes = set(), 0
    for row in rows:
        k = tuple(row[c] for c in key)
        if k in seen:
            dupes += 1
        seen.add(k)
    dates = sorted(row[key[0]] for row in rows)
    print(f"dataset: {args.dataset}")
    print(f"  staged rows : {len(rows)}")
    print(f"  schema      : {'OK' if not missing else 'MISSING ' + str(missing)}")
    print(f"  key dupes   : {dupes}")
    print(f"  date range  : {dates[0]} .. {dates[-1]}" if dates else "  (empty)")
    manifest = C.load_manifest(args.dataset)
    print(f"  last pull   : {manifest.get('last_pull')} ({manifest.get('last_status')})")


def cmd_frame(args):
    from dataops.frames import build_domain, build_multitower
    name = args.name
    if name == "multitower_daily":
        res = build_multitower.build()
    else:
        res = build_domain.build(name)
    print(json.dumps(res, indent=2))


def cmd_status(_args):
    reg = registry()["datasets"]
    print(f"warehouse: {C.ROOT}")
    for ds, r in reg.items():
        m = C.load_manifest(ds)
        staged = os.path.exists(C.stage_path(ds))
        print(f"  {ds:16s} staged={'yes' if staged else 'no ':4s} "
              f"last={m.get('last_pull', '-')[:16] if m.get('last_pull') else '-':16s} "
              f"status={m.get('last_status', 'never pulled')}")


def main():
    ap = argparse.ArgumentParser(prog="dataops")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pull")
    p.add_argument("dataset", nargs="?")
    p.add_argument("--all", action="store_true")
    p.set_defaults(fn=cmd_pull)
    b = sub.add_parser("backfill")
    b.add_argument("dataset")
    b.add_argument("--since", required=True)
    b.set_defaults(fn=cmd_backfill)
    v = sub.add_parser("validate")
    v.add_argument("dataset")
    v.set_defaults(fn=cmd_validate)
    f = sub.add_parser("frame")
    f.add_argument("name", help="commodities_daily | seismic_daily | hydro_daily | grid_daily | multitower_daily")
    f.set_defaults(fn=cmd_frame)
    s = sub.add_parser("status")
    s.set_defaults(fn=cmd_status)
    args = ap.parse_args()
    if args.cmd == "pull" and not args.all and not args.dataset:
        C.fail("pull needs a dataset or --all")
    args.fn(args)


if __name__ == "__main__":
    main()
