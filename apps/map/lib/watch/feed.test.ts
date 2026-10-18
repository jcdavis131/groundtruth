import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate";
import { digestEntry, escapeXml, eventEntry, feedEntries, renderAtom, renderJsonFeed, renderRss, stableHash, type FeedInput } from "./feed";
import type { Watchlist } from "./model";
import type { ResolveResult } from "./resolve";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const wl: Watchlist = {
  id: "demo",
  title: "Demo <list> & \"friends\"",
  items: [
    { kind: "county", id: "48453", name: "Travis" },
    { kind: "gauge", id: "USGS-1" },
  ],
  rules: [{ itemRef: 0, metric: "home.yoyPct", op: ">=", value: 3 }],
  createdAt: "2026-09-01T00:00:00Z",
  version: 2,
};
const results: ResolveResult[] = [
  { ok: true, kind: "county", id: "48453", name: "Travis County, TX", metrics: { "home.yoyPct": 3.4, "home.latest": 500_000 }, asOf: "2026-07-31", provenance: [], link: "https://g/?sel=realestate%3Acounty%3A48453&x=1" },
  { ok: false, kind: "gauge", id: "USGS-1", name: "gauge USGS-1", error: "USGS down <now>", link: "https://g/" },
];

function input(over: Partial<FeedInput> = {}): FeedInput {
  const evaluation = evaluate(wl, results, null, NOW);
  return { watchlist: wl, results, evaluation, selfUrl: "https://g/api/watch?t=abc&format=rss", homeUrl: "https://g/", generatedAt: new Date(NOW).toISOString(), ...over };
}

/** Minimal well-formedness: balanced tags, no raw & or < in text. */
function assertWellFormed(xml: string) {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_:][\w:.-]*)([^<>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  let last = 0;
  const body = xml.replace(/^<\?xml[^>]*\?>/, "");
  while ((m = re.exec(body))) {
    const text = body.slice(last, m.index);
    expect(text).not.toMatch(/[<]/);
    expect(text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, "")).not.toMatch(/&/);
    last = m.index + m[0].length;
    if (m[4] === "/") continue;
    if (m[1] === "/") expect(stack.pop()).toBe(m[2]);
    else stack.push(m[2]);
  }
  expect(stack).toEqual([]);
}

describe("escapeXml / stableHash", () => {
  it("escapes the five characters and strips control characters", () => {
    expect(escapeXml(`a & b < c > "d" 'e' `)).toBe("a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos; ");
  });
  it("hash is stable and sensitive", () => {
    expect(stableHash("abc")).toBe(stableHash("abc"));
    expect(stableHash("abc")).not.toBe(stableHash("abd"));
    expect(stableHash("x")).toMatch(/^[0-9a-f]{13}$/);
  });
});

describe("entries", () => {
  it("event ids depend on item, rule, value and period only", () => {
    const e = input().evaluation.events[0];
    const a = eventEntry(wl, e);
    const b = eventEntry(wl, { ...e, firedAt: "2030-01-01T00:00:00Z", message: "different wording" });
    expect(a.id).toBe(b.id);
    const c = eventEntry(wl, { ...e, value: 3.5 });
    expect(c.id).not.toBe(a.id);
    expect(a.id).toMatch(/^gev-watch-demo-[0-9a-f]{13}$/);
    expect(a.link).toBe(e.link);
    expect(a.summary).toContain("Rule: home.yoyPct >= 3.");
  });

  it("digest lists every item, names failures, and changes id only with values", () => {
    const d = digestEntry(input());
    expect(d.title).toBe("Digest: 1/2 items resolved, 1 alert, 1 checks");
    expect(d.summary).toContain("Travis County, TX (2026-07-31): home.yoyPct=3.40, home.latest=500,000");
    expect(d.summary).toContain("gauge USGS-1: not resolved (USGS down <now>)");
    expect(d.summary).toContain("Caveats:");
    const same = digestEntry(input({ generatedAt: "2030-01-01T00:00:00Z" }));
    expect(same.id).toBe(d.id);
    const first = results[0];
    if (!first.ok) throw new Error("fixture");
    const changed = digestEntry(input({ results: [{ ...first, metrics: { ...first.metrics, "home.latest": 1 } }, results[1]] }));
    expect(changed.id).not.toBe(d.id);
  });

  it("the feed is never empty", () => {
    const empty = input({ evaluation: evaluate({ ...wl, rules: [] }, results, null, NOW) });
    expect(feedEntries(empty)).toHaveLength(1);
    expect(feedEntries(empty)[0].tags).toEqual(["digest"]);
  });
});

describe("RSS", () => {
  it("is well-formed, escaped, with stable guids and RFC 822 dates", () => {
    const xml = renderRss(input());
    assertWellFormed(xml);
    expect(xml).toContain("<title>Demo &lt;list&gt; &amp; &quot;friends&quot;</title>");
    expect(xml).toContain('<atom:link href="https://g/api/watch?t=abc&amp;format=rss" rel="self"');
    expect(xml).toContain('<guid isPermaLink="false">gev-watch-demo-');
    expect(xml).toContain("<pubDate>Thu, 10 Sep 2026 12:00:00 GMT</pubDate>");
    expect(xml).toContain("<link>https://g/?sel=realestate%3Acounty%3A48453&amp;x=1</link>");
    expect(xml).toContain("USGS down &lt;now&gt;");
    expect((xml.match(/<item>/g) ?? []).length).toBe(2);
  });
});

describe("Atom", () => {
  it("is well-formed with urn ids and ISO dates", () => {
    const xml = renderAtom(input());
    assertWellFormed(xml);
    expect(xml).toContain("<id>urn:gev:watch:demo</id>");
    expect(xml).toContain("<updated>2026-09-10T12:00:00.000Z</updated>");
    expect(xml).toContain('<category term="home.yoyPct"/>');
    expect((xml.match(/<entry>/g) ?? []).length).toBe(2);
  });
});

describe("JSON Feed", () => {
  it("follows 1.1 with items", () => {
    const j = renderJsonFeed(input());
    expect(j.version).toBe("https://jsonfeed.org/version/1.1");
    expect(j.items).toHaveLength(2);
    expect(j.items[0].content_text).toContain("Travis County, TX: home.yoyPct 3.40 at or above 3.00");
    expect(j.items[1].tags).toEqual(["digest"]);
    expect(j.feed_url).toBe("https://g/api/watch?t=abc&format=rss");
  });
});
