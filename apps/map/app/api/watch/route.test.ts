// Contract of /api/watch with the resolvers' upstream access replaced by
// fixtures and a memory store: validation, token minting, feed rendering,
// state across two evaluations, webhook gating. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Fetchers } from "@/lib/watch/resolve";
import { memoryKv, setDefaultKv } from "@/lib/watch/kv";
import { decodeTokenSync, encodeTokenSync } from "@/lib/watch/token-node";
import type { Watchlist } from "@/lib/watch/model";

const stage = { v: 2.5 };
vi.mock("@/lib/watch/fetchers", () => {
  const fetchers: Fetchers = {
    zillow: async () => {
      throw new Error("zillow down");
    },
    qcewLatest: async () => {
      throw new Error("bls down");
    },
    stateLookup: async () => new Map(),
    btsPortStats: async () => {
      throw new Error("bts down");
    },
    wpiPort: () => undefined,
    borderCrossings: async () => ({ asOf: "2026-06-01", rows: [] }),
    usgsLatest: async (site) => (site === "USGS-08180800" ? [{ param: "00065", value: stage.v, unit: "ft", time: "2026-09-10T00:00:00Z", lon: -98, lat: 29 }] : []),
    seriesGet: async () => null,
  };
  return { defaultFetchers: fetchers };
});

vi.mock("@/lib/server/cache", () => ({
  // No 5-minute memo in tests: every GET evaluates, so state can be observed across calls.
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));

import { GET, OPTIONS, POST } from "./route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/watch?${qs}`));
const post = (qs: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest(`http://localhost/api/watch${qs ? "?" + qs : ""}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } }));

const wl: Watchlist = {
  id: "rivers",
  title: "Rivers & <gauges>",
  items: [
    { kind: "gauge", id: "USGS-08180800", name: "Medina" },
    { kind: "county", id: "48453" },
  ],
  rules: [
    { itemRef: 0, metric: "stage", op: "crosses_above", value: 3 },
    { itemRef: 0, metric: "stage", op: ">", value: 1 },
  ],
  createdAt: "2026-09-01T00:00:00.000Z",
  version: 1,
};

describe("/api/watch", () => {
  const env = { ...process.env };
  beforeEach(() => {
    setDefaultKv(memoryKv());
    delete process.env.GEV_CRON_SECRET;
    stage.v = 2.5;
  });
  afterEach(() => {
    process.env = { ...env };
    setDefaultKv(undefined);
  });

  it("OPTIONS answers CORS with POST allowed", () => {
    const r = OPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("GET without a token or with a bad one is a 400 with guidance", async () => {
    expect((await get("")).status).toBe(400);
    const bad = await get("t=zzz");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/token:/);
    expect((await get("t=x&format=pdf")).status).toBe(400);
    expect((await get("id=nope")).status).toBe(404);
    expect((await get("id=BAD ID")).status).toBe(400);
  });

  it("GET ?op=metrics lists metric ids per kind", async () => {
    const r = await get("op=metrics");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.gauge.some((m: { id: string }) => m.id === "stage")).toBe(true);
  });

  it("POST validates, mints a token, stores under the id and returns feed URLs", async () => {
    const bad = await post("", { watchlist: { ...wl, rules: [{ metric: "x", op: "~", value: 1 }] } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).details[0]).toMatch(/rules\[0\]\.op/);
    expect((await post("", "{not json")).status).toBe(400);

    const r = await post("", { watchlist: wl });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.id).toBe("rivers");
    expect(j.data.stored).toBe(true);
    expect(decodeTokenSync(j.data.token).title).toBe(wl.title);
    expect(j.data.urls.rss).toBe(`http://localhost/api/watch?t=${encodeURIComponent(j.data.token)}&format=rss`);
    expect(j.data.shortUrls.atom).toBe("http://localhost/api/watch?id=rivers&format=atom");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("POST without a store still mints a token and says so", async () => {
    setDefaultKv(null);
    const r = await post("", { watchlist: wl });
    const j = await r.json();
    expect(j.data.stored).toBe(false);
    expect(j.data.shortUrls).toBeNull();
    expect(j.caveats.join(" ")).toMatch(/keeps no store/);
  });

  it("GET renders RSS, Atom, JSON Feed and JSON for a token, with failures as caveats", async () => {
    const token = encodeTokenSync(wl);
    const rss = await get(`t=${encodeURIComponent(token)}&format=rss`);
    expect(rss.status).toBe(200);
    expect(rss.headers.get("content-type")).toContain("application/rss+xml");
    expect(rss.headers.get("cache-control")).toContain("s-maxage=300");
    const xml = await rss.text();
    expect(xml).toContain("<title>Rivers &amp; &lt;gauges&gt;</title>");
    expect(xml).toContain("Digest:");
    expect(xml).toContain("Medina: stage 2.50 above 1.00");

    const atom = await get(`t=${encodeURIComponent(token)}`); // default format
    expect(atom.headers.get("content-type")).toContain("rss");
    const at = await get(`t=${encodeURIComponent(token)}&format=atom`);
    expect(at.headers.get("content-type")).toContain("application/atom+xml");
    expect(await at.text()).toContain("<feed xmlns=");

    const jf = await get(`t=${encodeURIComponent(token)}&format=jsonfeed`);
    const feed = await jf.json();
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.items.length).toBe(2);

    const js = await get(`t=${encodeURIComponent(token)}&format=json`);
    const j = await js.json();
    expect(j.id).toBe("rivers");
    expect(j.stateful).toBe(true);
    expect(j.data.items[0].ok).toBe(true);
    expect(j.data.items[0].metrics.stage).toBe(2.5);
    expect(j.data.items[1].ok).toBe(false);
    expect(j.data.items[1].error).toMatch(/both upstreams failed/);
    expect(j.data.events.map((e: { ruleIndex: number }) => e.ruleIndex)).toEqual([1]);
    expect(j.provenance[0].source.id).toBe("usgs-water");
    expect(j.caveats.join(" ")).toMatch(/both upstreams failed/);
    expect(j.urls.atom).toContain("format=atom");
  });

  it("crosses_above fires only on the crossing once state exists", async () => {
    const token = encodeURIComponent(encodeTokenSync(wl));
    const first = await (await get(`t=${token}&format=json`)).json();
    expect(first.data.events.map((e: { ruleIndex: number }) => e.ruleIndex)).toEqual([1]); // 2.5 is below 3: nothing to cross
    stage.v = 3.2;
    const second = await (await get(`t=${token}&format=json`)).json();
    expect(second.data.events.map((e: { ruleIndex: number; basis: string }) => [e.ruleIndex, e.basis])).toEqual([[0, "state"], [1, "threshold"]]);
    expect(second.caveats.some((c: string) => c.includes("stateless"))).toBe(false);
    const third = await (await get(`t=${token}&format=json`)).json();
    expect(third.data.events.map((e: { ruleIndex: number }) => e.ruleIndex)).toEqual([1]); // still above: no new crossing
  });

  it("GET ?id= reads the stored token", async () => {
    await post("", { watchlist: wl });
    const r = await get("id=rivers&format=json");
    expect(r.status).toBe(200);
    expect((await r.json()).id).toBe("rivers");
  });

  it("stateless when the store is off: crosses degrade and the response says so", async () => {
    setDefaultKv(null);
    stage.v = 3.2;
    const j = await (await get(`t=${encodeURIComponent(encodeTokenSync(wl))}&format=json`)).json();
    expect(j.stateful).toBe(false);
    expect(j.data.events[0].basis).toBe("degraded");
    expect(j.caveats.join(" ")).toMatch(/stateless/);
  });

  it("webhook ops are 404 without GEV_CRON_SECRET, 401 with the wrong header, validated after", async () => {
    expect((await post("op=test-webhook", { url: "https://example.com/h", secret: "12345678" })).status).toBe(404);
    process.env.GEV_CRON_SECRET = "cron-secret";
    expect((await post("op=test-webhook", { url: "https://example.com/h", secret: "12345678" }, { "x-gev-cron-secret": "wrong" })).status).toBe(401);
    const short = await post("op=test-webhook", { url: "https://example.com/h", secret: "short" }, { "x-gev-cron-secret": "cron-secret" });
    expect(short.status).toBe(400);
    expect((await short.json()).error).toMatch(/secret/);
    // A private receiver is refused before any request is made.
    const priv = await post("op=test-webhook", { url: "https://10.0.0.1/h", secret: "12345678" }, { "x-gev-cron-secret": "cron-secret" });
    expect(priv.status).toBe(502);
    expect((await priv.json()).data.error).toMatch(/private/);
    expect((await post("op=bogus", {})).status).toBe(400);
  });

  it("dispatch reports no events without sending when nothing fired", async () => {
    process.env.GEV_CRON_SECRET = "cron-secret";
    const calm: Watchlist = { ...wl, rules: [{ itemRef: 0, metric: "stage", op: ">", value: 100 }] };
    const r = await post("op=dispatch", { token: encodeTokenSync(calm), url: "https://example.com/h", secret: "12345678" }, { "x-gev-cron-secret": "cron-secret" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data.delivered).toBe(false);
    expect(j.data.events).toBe(0);
  });
});
