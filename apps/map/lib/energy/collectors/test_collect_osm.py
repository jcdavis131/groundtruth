#!/usr/bin/env python3
"""Tests for collect_osm.py (stdlib only, no network).

Run: python3 -m unittest -v apps/map/lib/energy/collectors/test_collect_osm.py
(from the groundtruth root). A local HTTP server plays the Overpass replies,
so no request leaves the machine. The fixture points are four real OSM
entries from the 2026-11-03 Overpass result.
"""
import http.server
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect_osm  # noqa: E402

# Local requests must not go through a proxy from the environment.
for _k in ("no_proxy", "NO_PROXY"):
    os.environ[_k] = ",".join(x for x in (os.environ.get(_k), "127.0.0.1", "localhost") if x)

TEXAS = {"type": "node", "lat": 35.4672, "lon": -97.64975, "tags": {"name": "Rack59 Data Center"}}
US = {"type": "node", "lat": 38.90289, "lon": -77.02915,
      "tags": {"name": "CoreSite DC1", "operator": "CoreSite"}}
ABROAD = {"type": "node", "lat": 52.16809, "lon": 5.89655, "tags": {"name": "Cellnex"}}
BUILDING = {"type": "way", "center": {"lat": 47.3595, "lon": -120.16009}, "tags": {"name": "EAT14"}}

OK_GLOBAL = (200, {}, json.dumps({"elements": [TEXAS, US, ABROAD]}))
OK_CONS = (200, {}, json.dumps({"elements": [BUILDING]}))


class Script(http.server.BaseHTTPRequestHandler):
    replies = []
    seen = []

    def do_GET(self):  # noqa: N802
        Script.seen.append(self.path)
        status, headers, body = Script.replies.pop(0)
        data = body.encode()
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Script)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}/api/interpreter"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        Script.replies, Script.seen = [], []
        self.sleeps = []

    def ask(self, replies, deadline=None):
        Script.replies = list(replies)
        clock = lambda: 0.0  # noqa: E731
        return collect_osm.overpass("[out:json];node(1);out;", 10_000 if deadline is None else deadline,
                                    url=self.url, timeout=5, sleep=self.sleeps.append, clock=clock)


class RetryPolicy(Base):
    def test_502_then_success_waits_60s(self):
        d = self.ask([(502, {}, "bad gateway"), OK_GLOBAL])
        self.assertEqual(len(d["elements"]), 3)
        self.assertEqual(self.sleeps, [60])

    def test_429_stops_at_once(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.ask([(429, {}, "too many"), OK_GLOBAL])
        self.assertEqual(cm.exception.code, 429)
        self.assertEqual(self.sleeps, [])
        self.assertEqual(len(Script.seen), 1)

    def test_other_4xx_stops_at_once(self):
        with self.assertRaises(urllib.error.HTTPError):
            self.ask([(400, {}, "bad query"), OK_GLOBAL])
        self.assertEqual(self.sleeps, [])

    def test_three_server_errors_give_up(self):
        with self.assertRaises(collect_osm.OverpassError):
            self.ask([(502, {}, ""), (503, {}, ""), (504, {}, ""), OK_GLOBAL])
        self.assertEqual(self.sleeps, [60, 120])
        self.assertEqual(len(Script.seen), 3)

    def test_retry_after_replaces_wait_and_is_capped(self):
        self.ask([(503, {"Retry-After": "7"}, ""), OK_GLOBAL])
        self.assertEqual(self.sleeps, [7])
        self.setUp()
        self.ask([(503, {"Retry-After": "9999"}, ""), OK_GLOBAL])
        self.assertEqual(self.sleeps, [collect_osm.MAX_RETRY_AFTER])

    def test_runtime_error_remark_is_retried(self):
        remark = json.dumps({"elements": [], "remark": 'runtime error: Query timed out in "query" at line 1 after 181 seconds.'})
        d = self.ask([(200, {}, remark), OK_GLOBAL])
        self.assertEqual(len(d["elements"]), 3)
        self.assertEqual(self.sleeps, [60])

    def test_cut_short_body_is_retried(self):
        self.ask([(200, {}, '{"elements": [{"type": "node"'), OK_GLOBAL])
        self.assertEqual(self.sleeps, [60])

    def test_no_retry_past_the_time_budget(self):
        with self.assertRaises(collect_osm.OverpassError) as cm:
            self.ask([(502, {}, ""), OK_GLOBAL], deadline=30)
        self.assertIn("time budget", str(cm.exception))
        self.assertEqual(self.sleeps, [])


class Main(Base):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        os.makedirs(os.path.join(root, "sources"))
        os.makedirs(os.path.join(root, "raw"))
        self.raw = os.path.join(root, "raw")
        self.old = (collect_osm.BASE, collect_osm.DATA, os.environ.get("OVERPASS_URL"))
        collect_osm.BASE, collect_osm.DATA = root, self.raw
        os.environ["OVERPASS_URL"] = self.url

    def tearDown(self):
        collect_osm.BASE, collect_osm.DATA, url = self.old
        if url is None:
            os.environ.pop("OVERPASS_URL", None)
        else:
            os.environ["OVERPASS_URL"] = url
        self.tmp.cleanup()

    def load(self, name):
        with open(os.path.join(self.raw, name)) as f:
            return json.load(f)

    def test_two_requests_four_files(self):
        Script.replies = [OK_GLOBAL, OK_CONS]
        collect_osm.main(sleep=self.sleeps.append)
        self.assertEqual(len(Script.seen), 2)
        self.assertEqual([p["name"] for p in self.load("osm_datacenters_global.json")],
                         ["Rack59 Data Center", "CoreSite DC1", "Cellnex"])
        self.assertEqual([p["name"] for p in self.load("osm_datacenters_us.json")],
                         ["Rack59 Data Center", "CoreSite DC1"])
        self.assertEqual([p["name"] for p in self.load("osm_datacenters_texas.json")],
                         ["Rack59 Data Center"])
        self.assertEqual([p["name"] for p in self.load("osm_datacenters_us_construction.json")],
                         ["EAT14"])
        with open(os.path.join(collect_osm.BASE, "sources", "osm_collection.json")) as f:
            self.assertEqual(json.load(f)["requests"], 2)

    def test_failed_second_request_writes_nothing(self):
        prior = os.path.join(self.raw, "osm_datacenters_global.json")
        with open(prior, "w") as f:
            f.write("[]")
        Script.replies = [OK_GLOBAL, (502, {}, ""), (502, {}, ""), (502, {}, "")]
        with self.assertRaises(collect_osm.OverpassError):
            collect_osm.main(sleep=self.sleeps.append)
        self.assertEqual(sorted(os.listdir(self.raw)), ["osm_datacenters_global.json"])
        with open(prior) as f:
            self.assertEqual(f.read(), "[]")

    def test_429_writes_pause_file_and_next_run_sends_nothing(self):
        Script.replies = [OK_GLOBAL, (429, {}, "too many")]
        with self.assertRaises(urllib.error.HTTPError):
            collect_osm.main(sleep=self.sleeps.append)
        pause = self.load(collect_osm.PAUSE_FILE)
        self.assertEqual(pause["http_status"], 429)
        Script.seen = []
        Script.replies = [OK_GLOBAL, OK_CONS]
        with self.assertRaises(SystemExit):
            collect_osm.main(sleep=self.sleeps.append)
        self.assertEqual(Script.seen, [])
        self.assertFalse(os.path.exists(os.path.join(self.raw, "osm_datacenters_us.json")))


if __name__ == "__main__":
    unittest.main()
