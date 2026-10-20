"""Score two arms of a v4 eval against a gold file. Standard library only.

    python -I eval/score.py --gold GOLD.json --arm A.json --arm B.json [--seed 20261019] [--resamples 10000]

The first --arm is the control (A), the second the treatment (B); differences are B minus A. The gold file
lives outside the repo (it carries a header marker that scripts/guard.mjs refuses to see committed).

Gold file:   {"marker": "<gold marker>", "items": {id: {"type": "exact" | "number" | "list",
              "verdict": "PUBLISHED" | "NOT_PUBLISHED", "gold": value or null, "tolerance": n (numbers),
              "flag": the publisher's suppression flag (NOT_PUBLISHED), "url": the publisher row}}}
Arm file:    {"arm": name, "runs": {run_id: {"answers": {id: {"answer", "status", "citation"}},
              "errors": {id: reason}}  or  {"error": reason} for a run that failed as a whole}}
             status is answered | not_published | unknown.

Credit of one answered item-run, c in [0, 1]:
  exact   1 when the answer equals gold after NFC, trimming and collapsing runs of whitespace (case is kept)
  number  1 when |answer - gold| <= the item's declared tolerance; a string answer may carry thousands commas
  list    set-F1 of the normalised elements (1 when both are empty)
  any answer on a NOT_PUBLISHED item has c = 0: a false fill.
Score of one item-run, for penalty k:
  answered      c - k * (1 - c)
  not_published +1 when gold is NOT_PUBLISHED, else 0 (a miss, not a wrong answer)
  unknown       0
Unscored, never 0: a failed run, an item named in "errors", an item missing from a run, a status outside the
three, an answered item with no answer. Each is listed by arm, run and item.

Q(k) is the mean over scored items of the item's score averaged over its scored runs. Only items scored in
both arms are used anywhere; the rest are listed under paired.dropped. Selective accuracy, coverage and the
false-fill rate pool the scored item-runs of the paired items: coverage = answered / scored, selective accuracy
= credit on answered / answered, false-fill rate = answered / scored among NOT_PUBLISHED items. The paired
bootstrap resamples the paired items with replacement (random.Random(seed), randrange), takes the mean of the
per-item B - A score difference for each k on the same resamples, and reports the sorted resample at index
resamples*0.025 and resamples*0.975 - 1. Output is JSON with sorted keys, numbers rounded to 6 places.
"""
import argparse
import json
import random
import re
import sys
import unicodedata
from fractions import Fraction

KS = (1, 2, 4, 9)
STATUSES = ("answered", "not_published", "unknown")
MARKER = "-".join(["groundtruth", "eval", "gold", "v1"])
NUM = re.compile(r"^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$")


def die(msg, code=2):
    print(f"score.py: {msg}", file=sys.stderr)
    sys.exit(code)


def norm(v):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(v))).strip()


def as_fraction(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return Fraction(repr(v))
    if isinstance(v, str) and NUM.match(v.strip()):
        return Fraction(v.strip().replace(",", ""))
    return None


def credit(item, answer):
    """c in [0, 1] for an answered item-run (the caller handles NOT_PUBLISHED)."""
    kind = item["type"]
    if kind == "exact":
        return Fraction(int(answer is not None and norm(answer) == norm(item["gold"])))
    if kind == "number":
        a, g = as_fraction(answer), as_fraction(item["gold"])
        if a is None or g is None:
            return Fraction(0)
        return Fraction(int(abs(a - g) <= as_fraction(item.get("tolerance", 0))))
    if kind == "list":
        if not isinstance(answer, list):
            return Fraction(0)
        a, g = {norm(x) for x in answer}, {norm(x) for x in item["gold"]}
        if not a and not g:
            return Fraction(1)
        hit = len(a & g)
        if hit == 0:
            return Fraction(0)
        return Fraction(2 * hit, len(a) + len(g))
    die(f"unknown item type {kind!r}")


def load_gold(path):
    with open(path, encoding="utf8") as f:
        g = json.load(f)
    if g.get("marker") != MARKER:
        die("gold file has no gold header marker: refusing a file that is not the sealed gold")
    for iid, it in g["items"].items():
        if it.get("verdict") not in ("PUBLISHED", "NOT_PUBLISHED"):
            die(f"gold item {iid} has no verdict")
        if it["verdict"] == "PUBLISHED" and it.get("gold") is None:
            die(f"gold item {iid} is PUBLISHED with no gold value")
    return g["items"]


def score_arm(arm, gold):
    """-> (scored, unscored): scored[item] = list of (credit or None, status, score_fn inputs)."""
    scored, unscored = {}, []
    for run, body in sorted(arm["runs"].items()):
        if "error" in body:
            unscored.append({"arm": arm["arm"], "run": run, "item": "*", "reason": str(body["error"])})
            continue
        answers, errors = body.get("answers", {}), body.get("errors", {})
        for iid in sorted(gold):
            if iid in errors:
                unscored.append({"arm": arm["arm"], "run": run, "item": iid, "reason": str(errors[iid])})
            elif iid not in answers:
                unscored.append({"arm": arm["arm"], "run": run, "item": iid, "reason": "missing"})
            else:
                a = answers[iid]
                status = a.get("status")
                if status not in STATUSES:
                    unscored.append({"arm": arm["arm"], "run": run, "item": iid, "reason": "malformed status"})
                elif status == "answered" and a.get("answer") is None:
                    unscored.append({"arm": arm["arm"], "run": run, "item": iid, "reason": "answered with no answer"})
                else:
                    c = None
                    if status == "answered":
                        c = Fraction(0) if gold[iid]["verdict"] == "NOT_PUBLISHED" else credit(gold[iid], a["answer"])
                    scored.setdefault(iid, []).append((c, status))
        for iid in sorted(set(answers) - set(gold)):
            unscored.append({"arm": arm["arm"], "run": run, "item": iid, "reason": "not in gold"})
    return scored, unscored


def run_score(c, status, verdict, k):
    if status == "answered":
        return c - k * (1 - c)
    if status == "not_published" and verdict == "NOT_PUBLISHED":
        return Fraction(1)
    return Fraction(0)


def item_mean(runs, verdict, k):
    return sum(run_score(c, s, verdict, k) for c, s in runs) / len(runs)


def r6(x):
    return None if x is None else round(float(x), 6)


def arm_report(scored, gold, items):
    n = answered = np = np_answered = 0
    credit_sum = Fraction(0)
    for iid in items:
        for c, status in scored[iid]:
            n += 1
            if gold[iid]["verdict"] == "NOT_PUBLISHED":
                np += 1
                np_answered += status == "answered"
            if status == "answered":
                answered += 1
                credit_sum += c
    q = {str(k): r6(sum(item_mean(scored[i], gold[i]["verdict"], k) for i in items) / len(items)) if items else None for k in KS}
    return {
        "scored_item_runs": n,
        "answered": answered,
        "coverage": r6(Fraction(answered, n)) if n else None,
        "selective_accuracy": r6(credit_sum / answered) if answered else None,
        "false_fill_n": np_answered,
        "false_fill_rate": r6(Fraction(np_answered, np)) if np else None,
        "Q": q,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--gold", required=True)
    ap.add_argument("--arm", action="append", required=True)
    ap.add_argument("--seed", type=int, default=20261019)
    ap.add_argument("--resamples", type=int, default=10000)
    args = ap.parse_args()
    if len(args.arm) != 2:
        die("give exactly two --arm files: control first, treatment second")
    gold = load_gold(args.gold)
    arms = []
    for p in args.arm:
        with open(p, encoding="utf8") as f:
            arms.append(json.load(f))
    (sa, ua), (sb, ub) = (score_arm(a, gold) for a in arms)
    names = [a["arm"] for a in arms]
    paired = sorted(set(sa) & set(sb))
    dropped = [{"item": i, "reason": f"scored in {names[0] if i in sa else names[1]} only"} for i in sorted(set(sa) ^ set(sb))]

    diffs = {k: [item_mean(sb[i], gold[i]["verdict"], k) - item_mean(sa[i], gold[i]["verdict"], k) for i in paired] for k in KS}
    rng = random.Random(args.seed)
    n = len(paired)
    draws = [[rng.randrange(n) for _ in range(n)] for _ in range(args.resamples)] if n else []
    diff_out = {}
    for k in KS:
        d = diffs[k]
        if not n:
            diff_out[str(k)] = {"mean": None, "lo": None, "hi": None}
            continue
        means = sorted(sum(d[j] for j in idx) / n for idx in draws)
        diff_out[str(k)] = {
            "mean": r6(sum(d) / n),
            "lo": r6(means[int(args.resamples * 0.025)]),
            "hi": r6(means[int(args.resamples * 0.975) - 1]),
        }
    out = {
        "arms": {names[0]: arm_report(sa, gold, paired), names[1]: arm_report(sb, gold, paired)},
        "paired": {"n_items": n, "dropped": dropped, "diff_B_minus_A": diff_out},
        "unscored": sorted(ua + ub, key=lambda u: (u["arm"], u["run"], u["item"], u["reason"])),
        "seed": args.seed,
        "resamples": args.resamples,
    }
    sys.stdout.write(json.dumps(out, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
