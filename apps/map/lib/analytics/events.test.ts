// The analytics payload contract: three events, fixed keys, values from fixed lists or buckets,
// and nothing a viewer typed. track() is mocked; every call it receives is checked.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<[string, Record<string, unknown>]> = [];
vi.mock("@vercel/analytics", () => ({
  track: (name: string, props: Record<string, unknown>) => sent.push([name, props]),
}));

import {
  ALLOWED_KEYS,
  RECORD_VIA,
  RESULT_BUCKETS,
  RESULT_GROUPS,
  SEARCH_GROUPS,
  allSearchKinds,
  propsAllowed,
  resultBucket,
  send,
  stripUrl,
  trackRecordOpen,
  trackResultOpen,
  trackSearch,
  type EventName,
} from "./events";
import { LAYER_IDS } from "@/lib/layers/types";

const QUERY = "jcdavis 123 main st";

/** Every value in a sent payload is a string from that key's fixed list. */
function assertShape(name: string, props: Record<string, unknown>) {
  expect(Object.keys(ALLOWED_KEYS)).toContain(name);
  const allowed = ALLOWED_KEYS[name as EventName] as readonly string[];
  for (const [k, v] of Object.entries(props)) {
    expect(allowed).toContain(k);
    expect(typeof v).toBe("string");
  }
  const lists: Record<string, readonly unknown[]> = {
    results: RESULT_BUCKETS,
    kind: allSearchKinds(),
    group: RESULT_GROUPS,
    source: ["palette"],
    layer: LAYER_IDS,
    via: RECORD_VIA,
  };
  for (const [k, v] of Object.entries(props)) expect(lists[k]).toContain(v);
}

beforeEach(() => {
  sent.length = 0;
});

describe("analytics events", () => {
  it("buckets result counts and never sends the exact count", () => {
    expect([0, 1, 3, 4, 8, 9, 500, -1, Number.NaN].map(resultBucket)).toEqual(["0", "1-3", "1-3", "4-8", "4-8", "9+", "9+", "0", "0"]);
  });

  it("search carries a bucket and the groups present, never the query", () => {
    trackSearch(QUERY, { objects: 2, catalog: 3, place: 5 });
    trackSearch(QUERY, {});
    trackSearch("a", { objects: 4 }); // shorter than the palette searches: not a search
    expect(sent).toEqual([
      ["search", { results: "9+", kind: "objects+catalog+place" }],
      ["search", { results: "0", kind: "none" }],
    ]);
  });

  it("result_open maps any unknown group, the query included, to 'other'", () => {
    trackResultOpen("aircraft");
    trackResultOpen("catalog");
    trackResultOpen(QUERY);
    expect(sent).toEqual([
      ["result_open", { group: "aircraft", source: "palette" }],
      ["result_open", { group: "catalog", source: "palette" }],
      ["result_open", { group: "other", source: "palette" }],
    ]);
  });

  it("record_open sends only a layer eye defines", () => {
    trackRecordOpen("parcels", "map");
    trackRecordOpen("water", "search");
    trackRecordOpen(QUERY, "search");
    trackRecordOpen(undefined, "map");
    trackRecordOpen("zoning", QUERY as never);
    expect(sent).toEqual([
      ["record_open", { layer: "parcels", via: "map" }],
      ["record_open", { layer: "water", via: "search" }],
    ]);
  });

  it("send drops extra keys and off-list values", () => {
    send("search", { results: "1-3", kind: "objects", q: QUERY } as never);
    send("search", { results: "7", kind: "objects" } as never);
    send("search", { results: "1-3", kind: QUERY } as never);
    send("result_open", { group: "aircraft", source: QUERY } as never);
    send("record_open", { layer: "aircraft", via: "map", lat: 30.27 } as never);
    expect(sent).toEqual([]);
    expect(propsAllowed("record_open", { layer: "aircraft", via: "map" })).toBe(true);
  });

  it("every payload from every helper, fed the query everywhere it can go, is on the fixed lists", () => {
    for (const g of SEARCH_GROUPS) trackSearch(QUERY, { [g]: 1 });
    for (let n = 0; n < 12; n++) trackSearch(QUERY, { objects: n, meaning: n % 3, plss: n % 2 });
    for (const g of [...RESULT_GROUPS, QUERY, "", "1600 pennsylvania ave"]) trackResultOpen(g);
    for (const l of [...LAYER_IDS, QUERY]) for (const v of [...RECORD_VIA, QUERY]) trackRecordOpen(l, v as never);
    expect(sent.length).toBeGreaterThan(50);
    for (const [name, props] of sent) assertShape(name, props);
    const all = JSON.stringify(sent);
    for (const piece of [QUERY, "jcdavis", "123", "main st", "pennsylvania"]) expect(all).not.toContain(piece);
  });

  it("stripUrl keeps the path only", () => {
    expect(stripUrl({ type: "pageview", url: "https://eye.jcamd.com/?layers=parcels&bbox=-97.8,30.2,-97.7,30.3#sel=parcels:42" }).url).toBe(
      "https://eye.jcamd.com/",
    );
    expect(stripUrl({ type: "event", url: "https://eye.jcamd.com/catalog?q=jcdavis#water-quality" })).toEqual({
      type: "event",
      url: "https://eye.jcamd.com/catalog",
    });
    expect(stripUrl({ type: "pageview", url: "/place/48453?bbox=1,2#x" }).url).toBe("/place/48453");
  });

  it("only lib/analytics/events.ts imports @vercel/analytics' track", () => {
    const root = path.resolve(__dirname, "../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".") || name === "public") continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) {
          if (/from\s+["']@vercel\/analytics["']/.test(readFileSync(p, "utf8"))) hits.push(path.relative(root, p).replace(/\\/g, "/"));
        }
      }
    };
    for (const d of ["app", "components", "lib"]) walk(path.join(root, d));
    expect(hits).toEqual(["lib/analytics/events.ts"]);
  });
});
