"""REACH counter: how often an agent's first place lookup is mcp__eye__world_context.

Read-only. Streams Claude Code transcripts (.jsonl, main sessions and
subagents) under one directory given as an argument, line by line, and prints
one JSON summary to stdout. It writes nothing, keeps no transcript text beyond
a short redacted excerpt of the first lookup, and has no default directory.

Run:  python3 -I scripts/usage-scan.py <transcript-dir> [--since YYYY-MM-DD] [--claude-version X.Y.Z]

The rule (the preregistered one is writeups REACH-PREREG.md; this file is its
code, hashed on groundtruth PR #15):

  task          one transcript file, main session or subagent.
  lookup        a WebFetch, or a Bash/PowerShell call that fetches, naming a
                place publisher in HOSTS; or any mcp__eye__* / mcp__gev__* call.
  place task    a task with a place-question match in its user text (PLACEQ_RE)
                or a lookup of a non-eye publisher. These make the denominator.
  first lookup  the earliest lookup in the file, by line order.
  numerator     place tasks whose first lookup is mcp__eye__world_context.
  unprompted    no user or task text of the task names eye, mcp__eye or
                world_context (NAMES_EYE_RE).
  false positive  a world_context call in a task that is not a place task.

Secondary: eye calls per place task that made any, false-positive calls, and
seconds from the task's first timestamp to its first world_context call.
Builder vs consumer: the task's cwd or first user text names a build repo
(BUILDER_RE), or at least 20% of its tool inputs do.
"""
import json
import os
import re
import sys

MAX_BYTES = 200 * 1024 * 1024
TOOL = "mcp__eye__world_context"

HOSTS = [
    ("tigerweb", r"tigerweb\.geo\.census\.gov"),
    ("census-geocoder", r"geocoding\.geo\.census\.gov"),
    ("census-api", r"api\.census\.gov"),
    ("census-other", r"(?<![a-z])(www\d?\.)?census\.gov"),
    ("fema", r"fema\.gov"),
    ("bls", r"bls\.gov"),
    ("usace-nid", r"nid\.(sec\.)?usace\.army\.mil|usace\.army\.mil"),
    ("nces", r"nces\.ed\.gov"),
    ("nps", r"nps\.gov"),
    ("epa", r"epa\.gov"),
    ("noaa", r"noaa\.gov"),
    ("weather.gov", r"weather\.gov"),
    ("usgs", r"usgs\.gov"),
    ("wikidata", r"wikidata\.org"),
    ("osm", r"nominatim\.openstreetmap|overpass-api|openstreetmap\.org"),
    ("fcc", r"geo\.fcc\.gov|broadbandmap\.fcc"),
]
HOST_RE = [(k, re.compile(v, re.I)) for k, v in HOSTS]
FETCH_RE = re.compile(r"curl|wget|Invoke-WebRequest|Invoke-RestMethod|\biwr\b|\birm\b|requests\.(get|post)|urllib|urlopen|fetch\(|httpx|gh api", re.I)
BUILDER_RE = re.compile(r"groundtruth|gods-eye-view|[\\/]gt-[a-z]|vector-(places|realty|hoops|gridiron|unified|guard|pitch|equities)|eye-wt", re.I)
SECRET_RE = re.compile(r"(api[_-]?key|token|secret|password|passwd|bearer|cookie|authorization|ghp_|gho_|github_pat_|sk-[A-Za-z0-9]{8}|hf_[A-Za-z0-9]{10}|AKIA[0-9A-Z]{12})", re.I)
PLACEQ_RE = re.compile(
    r"\b(which|what) (county|counties|metro|state|city|zip|census tract|congressional district)\b|\bwhere is\b|\bFIPS\b|\bcounty (of|for|is)\b"
    r"|disaster declaration|flood zone|\bweather (at|in|for)\b|\bpopulation of\b|\bhow many (dams|schools|parks|hospitals|people)\b|school district"
    r"|\bnear(est|by)? (dam|park|school|airport|station)\b|\b(lat|latitude)[ /,]+(lon|lng|longitude)\b|\bgeocod",
    re.I,
)
NAMES_EYE_RE = re.compile(r"world_context|mcp__eye|\beye\b", re.I)


def clean(s, n=200):
    """Redact before anything is emitted: key-like query params, emails, secret-looking words."""
    s = re.sub(r"\s+", " ", s or "").strip()
    s = re.sub(r"([?&](key|token|api_key|apikey)=)[^&\s'\"]+", r"\1REDACTED", s, flags=re.I)
    s = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[email]", s)
    if SECRET_RE.search(s):
        s = SECRET_RE.sub("[REDACTED]", s)
    return s[:n]


def block_text(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return ""


def input_text(name, inp):
    if not isinstance(inp, dict):
        return ""
    for k in ("url", "command", "query", "pattern"):
        if isinstance(inp.get(k), str):
            return inp[k]
    return json.dumps(inp)[:2000]


def secs(a, b):
    from datetime import datetime

    def p(x):
        return datetime.fromisoformat(x.replace("Z", "+00:00"))

    try:
        return int((p(b) - p(a)).total_seconds())
    except Exception:
        return None


def scan_file(path, rel):
    t = {"task": rel.replace(os.sep, "/"), "version": "", "first_ts": "", "cwd": "", "user_text": [], "lookups": [], "tool_inputs": 0, "builder_inputs": 0}
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for ln, line in enumerate(fh, 1):
            try:
                d = json.loads(line)
            except Exception:
                continue
            if not isinstance(d, dict):
                continue
            ts = d.get("timestamp") or ""
            if ts and not t["first_ts"]:
                t["first_ts"] = ts
            if d.get("cwd") and not t["cwd"]:
                t["cwd"] = d["cwd"]
            if d.get("version") and not t["version"]:
                t["version"] = str(d["version"])
            m = d.get("message") or {}
            c = m.get("content") if isinstance(m, dict) else None
            if d.get("type") == "user":
                if d.get("isMeta"):
                    continue
                txt = block_text(c)
                if txt.strip() and not txt.lstrip().startswith("<system-reminder>"):
                    t["user_text"].append(txt[:6000])
                continue
            if d.get("type") != "assistant" or not isinstance(c, list):
                continue
            for b in c:
                if not isinstance(b, dict) or b.get("type") != "tool_use":
                    continue
                name = b.get("name", "")
                inp = b.get("input")
                raw = input_text(name, inp)
                t["tool_inputs"] += 1
                if BUILDER_RE.search(json.dumps(inp)[:4000] if inp else ""):
                    t["builder_inputs"] += 1
                if name.startswith(("mcp__eye__", "mcp__gev__")):
                    t["lookups"].append({"line": ln, "ts": ts, "tool": name, "host": "mcp-eye", "input": clean(raw, 200)})
                    continue
                if name not in ("WebFetch", "Bash", "PowerShell"):
                    continue
                hosts = [k for k, rx in HOST_RE if rx.search(raw)]
                if not hosts:
                    continue
                if name != "WebFetch" and not FETCH_RE.search(raw):
                    continue  # a mention in grep or sed, not a fetch
                if "census-other" in hosts and len(hosts) > 1:
                    hosts.remove("census-other")
                t["lookups"].append({"line": ln, "ts": ts, "tool": name, "host": hosts[0], "input": clean(raw, 200)})
    return t


def classify(t):
    text = "\n".join(t["user_text"])
    first_user = t["user_text"][0][:4000] if t["user_text"] else ""
    builder = bool(BUILDER_RE.search(t["cwd"]) or BUILDER_RE.search(first_user) or (t["tool_inputs"] and t["builder_inputs"] / t["tool_inputs"] >= 0.2))
    non_eye = [x for x in t["lookups"] if x["host"] != "mcp-eye"]
    place = bool(PLACEQ_RE.search(text) or non_eye)
    first = t["lookups"][0] if t["lookups"] else None
    wc = [x for x in t["lookups"] if x["tool"] == TOOL]
    eye = [x for x in t["lookups"] if x["host"] == "mcp-eye"]
    return {
        "task": t["task"],
        "group": "builder" if builder else "consumer",
        "version": t["version"],
        "first_ts": t["first_ts"],
        "place_related": place,
        "first_lookup": first["host"] if first else None,
        "first_lookup_tool": first["tool"] if first else None,
        "first_lookup_input": first["input"] if first else None,
        "first_is_world_context": bool(first and first["tool"] == TOOL),
        "unprompted": not NAMES_EYE_RE.search(text),
        "eye_calls": len(eye),
        "world_context_calls": len(wc),
        "time_to_first_call_s": secs(t["first_ts"], wc[0]["ts"]) if wc and t["first_ts"] and wc[0]["ts"] else None,
        "false_positive": bool(wc) and not place,
    }


def ratio(n, d):
    return (n / d) if d else None


def scan(root, since=None, claude_version=None):
    files = []
    for dp, _dn, fs in os.walk(root):
        for f in fs:
            if f.endswith(".jsonl"):
                files.append(os.path.join(dp, f))
    files.sort()
    tasks, skipped, versions = [], [], {}
    for p in files:
        rel = os.path.relpath(p, root)
        try:
            if os.path.getsize(p) > MAX_BYTES:
                skipped.append(rel)
                continue
            t = scan_file(p, rel)
        except OSError as ex:
            skipped.append(rel + " (" + type(ex).__name__ + ")")
            continue
        if since and (t["first_ts"] or "")[:10] < since:
            continue
        if claude_version and t["version"] != claude_version:
            continue
        versions[t["version"] or "unknown"] = versions.get(t["version"] or "unknown", 0) + 1
        tasks.append(classify(t))
    place = [x for x in tasks if x["place_related"]]
    num = [x for x in place if x["first_is_world_context"]]
    num_un = [x for x in num if x["unprompted"]]
    by_group = {}
    for g in ("builder", "consumer"):
        pg = [x for x in place if x["group"] == g]
        ng = [x for x in pg if x["first_is_world_context"]]
        by_group[g] = {"denominator": len(pg), "numerator": len(ng), "numerator_unprompted": len([x for x in ng if x["unprompted"]])}
    with_call = [x for x in place if x["eye_calls"]]
    fp = [x for x in tasks if x["false_positive"]]
    return {
        "rule": "usage-scan v1",
        "since": since,
        "claude_version_pin": claude_version,
        "claude_versions": versions,
        "files": len(files),
        "skipped": skipped,
        "tasks_scanned": len(tasks),
        "denominator": len(place),
        "numerator": len(num),
        "numerator_unprompted": len(num_un),
        "ratio_all": ratio(len(num), len(place)),
        "ratio_unprompted": ratio(len(num_un), len(place)),
        "by_group": by_group,
        "secondary": {
            "place_tasks_with_an_eye_call": len(with_call),
            "calls_per_place_task_with_a_call": ratio(sum(x["eye_calls"] for x in with_call), len(with_call)),
            "false_positive_tasks": len(fp),
            "false_positive_calls": sum(x["world_context_calls"] for x in fp),
            "time_to_first_call_s": [x["time_to_first_call_s"] for x in tasks if x["time_to_first_call_s"] is not None],
        },
        "tasks": tasks,
    }


def main(argv):
    args = argv[1:]
    since = version = root = None
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--since" and i + 1 < len(args):
            since = args[i + 1]
            i += 2
        elif a == "--claude-version" and i + 1 < len(args):
            version = args[i + 1]
            i += 2
        elif root is None and not a.startswith("--"):
            root = a
            i += 1
        else:
            root = None
            break
    if not root or not os.path.isdir(root):
        sys.stderr.write("usage: python3 -I usage-scan.py <transcript-dir> [--since YYYY-MM-DD] [--claude-version X.Y.Z]\n")
        return 2
    json.dump(scan(root, since, version), sys.stdout, indent=1)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
