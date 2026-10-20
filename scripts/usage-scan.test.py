"""Self-test for scripts/usage-scan.py. Plain unittest, no network, no installs.

Run:  python3 -I scripts/usage-scan.test.py

The fixture is built here, in a temporary directory, from synthetic
schema-shaped JSONL lines: the field names Claude Code writes (type,
timestamp, cwd, version, message.content, tool_use name/input) and
placeholder text. It holds no session content.
"""
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "usage-scan.py")

spec = importlib.util.spec_from_file_location("usage_scan", SCRIPT)
scan_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan_mod)

WC = "mcp__eye__world_context"


def user(ts, text, cwd="/work/app", version="2.1.302"):
    return {"type": "user", "timestamp": ts, "cwd": cwd, "version": version, "message": {"content": text}}


def call(ts, name, inp, tid, cwd="/work/app", version="2.1.302"):
    return {
        "type": "assistant",
        "timestamp": ts,
        "cwd": cwd,
        "version": version,
        "message": {"content": [{"type": "tool_use", "id": tid, "name": name, "input": inp}]},
    }


def fetch(ts, url, tid, **kw):
    return call(ts, "WebFetch", {"url": url, "prompt": "p"}, tid, **kw)


def write_jsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")


def build(root):
    d = "2026-11-02T10:00:"
    # A: place question, first lookup is world_context, nobody named it.
    write_jsonl(os.path.join(root, "proj", "a.jsonl"), [
        user(d + "00Z", "which county is this point in"),
        call(d + "05Z", WC, {"lon": -97.7, "lat": 30.2}, "a1"),
        call(d + "09Z", WC, {"fips": "48453"}, "a2"),
    ])
    # B: place question, a publisher fetch comes first, then world_context.
    write_jsonl(os.path.join(root, "proj", "b.jsonl"), [
        user(d + "00Z", "what county is this"),
        fetch(d + "02Z", "https://tigerweb.geo.census.gov/arcgis/rest/services/x?api_key=SECRETVALUE1234", "b1"),
        call(d + "08Z", WC, {"lon": 1, "lat": 2}, "b2"),
    ])
    # C: the user names the tool, so a world_context first call is prompted.
    write_jsonl(os.path.join(root, "proj", "c.jsonl"), [
        user(d + "00Z", "use mcp__eye__world_context for the flood zone at this point"),
        call(d + "04Z", WC, {"lon": 1, "lat": 2}, "c1"),
    ])
    # D: no place event at all.
    write_jsonl(os.path.join(root, "proj", "d.jsonl"), [
        user(d + "00Z", "rename this variable"),
        call(d + "03Z", "Read", {"file_path": "/work/app/x.ts"}, "d1"),
    ])
    # E: world_context on a task that is not a place task: a false positive, outside the denominator.
    write_jsonl(os.path.join(root, "proj", "e.jsonl"), [
        user(d + "00Z", "refactor the parser"),
        call(d + "06Z", WC, {"fips": "01097"}, "e1"),
    ])
    # F: older than --since.
    write_jsonl(os.path.join(root, "proj", "f.jsonl"), [
        user("2026-10-01T10:00:00Z", "what county is this"),
        call("2026-10-01T10:00:05Z", WC, {"fips": "01097"}, "f1"),
    ])
    # G: a subagent transcript in a builder cwd; its task text names a path in the build repo; publisher call only.
    write_jsonl(os.path.join(root, "proj", "sess", "subagents", "g.jsonl"), [
        user(d + "00Z", "look up the FIPS for this point", cwd="/work/groundtruth/apps/map", version="2.1.400"),
        fetch(d + "03Z", "https://www.fema.gov/api/open/v2/x", "g1", cwd="/work/groundtruth/apps/map", version="2.1.400"),
    ])
    # H: place question, then a shell fetch of a publisher, never world_context.
    write_jsonl(os.path.join(root, "proj", "h.jsonl"), [
        user(d + "00Z", "population of this county"),
        call(d + "02Z", "Bash", {"command": "curl -s https://api.census.gov/data/2022/acs"}, "h1"),
    ])
    # I: a line that is not JSON and a tool-list mention of eye that is not a call.
    with open(os.path.join(root, "proj", "i.jsonl"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("not json\n")
        fh.write(json.dumps(user(d + "00Z", "hello")) + "\n")
        fh.write(json.dumps({"type": "attachment", "timestamp": d + "01Z", "attachment": {"names": [WC]}}) + "\n")


def tree_hash(root):
    h = hashlib.sha256()
    for dp, dn, fn in os.walk(root):
        dn.sort()
        for f in sorted(fn):
            p = os.path.join(dp, f)
            h.update(os.path.relpath(p, root).encode())
            with open(p, "rb") as fh:
                h.update(fh.read())
    return h.hexdigest()


class UsageScan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = cls.tmp.name
        build(cls.root)
        cls.before = tree_hash(cls.root)
        cls.out = scan_mod.scan(cls.root, since="2026-11-01")
        cls.by = {t["task"].split("/")[-1]: t for t in cls.out["tasks"]}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_denominator_is_place_tasks_by_publisher_or_question(self):
        # A, B, C, G, H are place tasks; D, E, I are not; F is before --since.
        self.assertEqual(sorted(k for k, t in self.by.items() if t["place_related"]), ["a.jsonl", "b.jsonl", "c.jsonl", "g.jsonl", "h.jsonl"])
        self.assertEqual(self.out["denominator"], 5)
        self.assertNotIn("f.jsonl", self.by)

    def test_numerator_is_first_lookup_being_world_context(self):
        self.assertEqual(sorted(k for k, t in self.by.items() if t["place_related"] and t["first_is_world_context"]), ["a.jsonl", "c.jsonl"])
        self.assertEqual(self.out["numerator"], 2)
        self.assertFalse(self.by["b.jsonl"]["first_is_world_context"])  # a publisher fetch came first
        self.assertEqual(self.by["b.jsonl"]["first_lookup"], "tigerweb")
        self.assertFalse(self.by["h.jsonl"]["first_is_world_context"])

    def test_unprompted_means_the_task_text_does_not_name_eye_or_the_tool(self):
        self.assertTrue(self.by["a.jsonl"]["unprompted"])
        self.assertFalse(self.by["c.jsonl"]["unprompted"])
        self.assertEqual(self.out["numerator_unprompted"], 1)
        self.assertAlmostEqual(self.out["ratio_unprompted"], 1 / 5)
        self.assertAlmostEqual(self.out["ratio_all"], 2 / 5)

    def test_secondary_measures(self):
        s = self.out["secondary"]
        self.assertEqual(self.by["a.jsonl"]["eye_calls"], 2)
        self.assertEqual(self.by["a.jsonl"]["time_to_first_call_s"], 5)
        self.assertEqual(s["false_positive_tasks"], 1)
        self.assertEqual(s["false_positive_calls"], 1)
        self.assertTrue(self.by["e.jsonl"]["false_positive"])
        self.assertFalse(self.by["e.jsonl"]["place_related"])
        # world_context calls over the place tasks that made any: A 2, B 1, C 1 over 3 tasks
        self.assertAlmostEqual(s["calls_per_place_task_with_a_call"], 4 / 3)

    def test_builder_and_consumer_split_and_versions(self):
        self.assertEqual(self.by["g.jsonl"]["group"], "builder")
        self.assertEqual(self.by["a.jsonl"]["group"], "consumer")
        self.assertEqual(self.out["by_group"]["builder"]["denominator"], 1)
        self.assertEqual(self.out["by_group"]["consumer"]["denominator"], 4)
        self.assertEqual(self.out["claude_versions"], {"2.1.302": 7, "2.1.400": 1})

    def test_pinning_a_version_drops_the_other_versions_tasks(self):
        o = scan_mod.scan(self.root, since="2026-11-01", claude_version="2.1.302")
        self.assertNotIn("g.jsonl", {t["task"].split("/")[-1] for t in o["tasks"]})
        self.assertEqual(o["denominator"], 4)

    def test_nothing_that_looks_like_a_credential_or_address_is_emitted(self):
        text = json.dumps(self.out)
        self.assertNotIn("SECRETVALUE1234", text)
        self.assertIn("REDACTED", json.dumps(scan_mod.clean("https://x.example/a?api_key=SECRETVALUE1234&b=1")))
        self.assertEqual(scan_mod.clean("write to someone@example.com now"), "write to [email] now")

    def test_reads_only(self):
        self.assertEqual(tree_hash(self.root), self.before)

    def test_cli_needs_the_directory_and_prints_json(self):
        r = subprocess.run([sys.executable, "-I", SCRIPT], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("usage", (r.stderr + r.stdout).lower())
        r = subprocess.run([sys.executable, "-I", SCRIPT, self.root, "--since", "2026-11-01"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["denominator"], 5)
        r = subprocess.run([sys.executable, "-I", SCRIPT, os.path.join(self.root, "missing")], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)

    def test_script_names_no_home_directory_and_has_no_default_transcript_path(self):
        src = open(SCRIPT, encoding="utf-8").read()
        self.assertIsNone(re.search(r"[A-Za-z]:[\\/]+Users[\\/]", src))
        self.assertIsNone(re.search(r"expanduser|Path\.home|\.claude", src))
        self.assertNotIn("\r", src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
