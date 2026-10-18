import { describe, expect, it } from "vitest";

import { renderAtom, renderJsonFeed, renderRss, type FeedDoc, type FeedEntry } from "./render";

// One frozen document drives every assertion, so a wording or layout change in
// the renderers shows up as a diff here and nowhere else.

const ENTRIES: FeedEntry[] = [
  {
    id: "gev-place-48453-zhvi-a1b2c3d4e5f60",
    title: "Typical home value rose to $412,000",
    link: "https://eye.jcamd.com/place/48453/brief",
    summary: "Typical home value went from $408,000 in July 2025 to $412,000 in August 2025.\n412000 - 408000 = 4000.",
    published: "2025-09-10T00:00:00.000Z",
    updated: "2025-09-10T00:00:00.000Z",
    tags: ["move", "home"],
  },
  {
    id: "gev-place-48453-rank-0f1e2d3c4b5a6",
    title: "Rent & price-to-rent sit in the top tenth <nationally>",
    link: "https://eye.jcamd.com/place/48453",
    summary: 'Rent is 1st of 812 counties with a published value; "top tenth" means the 90th percentile or above.',
    published: "2025-09-10T00:00:00.000Z",
    updated: "2025-09-10T00:00:00.000Z",
    tags: ["rank"],
  },
  {
    id: "gev-place-48453-digest-9876543210abc",
    title: "Digest: Travis County, Texas",
    link: "https://eye.jcamd.com/place/48453",
    summary: "Two findings this period.",
    published: "2025-09-10T00:00:00.000Z",
    updated: "2025-09-10T00:00:00.000Z",
    tags: ["digest"],
  },
];

const DOC: FeedDoc = {
  id: "place:48453",
  title: "Travis County, Texas — brief",
  description: "Findings for Travis County, Texas from public data, with provenance & arithmetic.",
  homeUrl: "https://eye.jcamd.com/place/48453",
  selfUrl: "https://eye.jcamd.com/place/48453/feed.xml",
  generatedAt: "2025-09-10T00:00:00.000Z",
  generator: "Embedding Atlas",
  entries: ENTRIES,
};

const EMPTY: FeedDoc = { ...DOC, entries: [] };

/** Any & that does not begin one of the five entities this codebase emits. */
const UNESCAPED_AMP = /&(?!(?:amp|lt|gt|quot|apos);)/;

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("renderRss", () => {
  const xml = renderRss(DOC);

  it("starts with the XML declaration and closes the feed", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(xml.trimEnd().endsWith("</rss>")).toBe(true);
  });

  it("emits one item per entry, in document order", () => {
    expect(countOf(xml, "<item>")).toBe(DOC.entries.length);
    expect(countOf(xml, "</item>")).toBe(DOC.entries.length);
    const positions = DOC.entries.map((e) => xml.indexOf(e.id));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("carries the self link, the channel description, ttl and the generator", () => {
    expect(xml).toContain(`<atom:link href="${DOC.selfUrl}" rel="self" type="application/rss+xml"/>`);
    expect(xml).toContain("<description>Findings for Travis County, Texas from public data, with provenance &amp; arithmetic.</description>");
    expect(xml).toContain("<ttl>300</ttl>");
    expect(xml).toContain("<generator>Embedding Atlas</generator>");
  });

  it("marks guids as non-permalinks and dates them in RFC 822", () => {
    expect(xml).toContain('<guid isPermaLink="false">gev-place-48453-zhvi-a1b2c3d4e5f60</guid>');
    expect(xml).toContain("<pubDate>Wed, 10 Sep 2025 00:00:00 GMT</pubDate>");
    expect(xml).toContain("<lastBuildDate>Wed, 10 Sep 2025 00:00:00 GMT</lastBuildDate>");
  });

  it("leaves no unescaped ampersand anywhere in the output", () => {
    expect(UNESCAPED_AMP.test(xml)).toBe(false);
  });

  it("is byte-identical when rendered twice", () => {
    expect(renderRss(DOC)).toBe(xml);
  });

  it("still produces a well-formed channel with zero entries", () => {
    const empty = renderRss(EMPTY);
    expect(empty.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(countOf(empty, "<item>")).toBe(0);
    expect(empty).toContain("<channel>");
    expect(empty).toContain("</channel>");
    expect(empty.trimEnd().endsWith("</rss>")).toBe(true);
    expect(UNESCAPED_AMP.test(empty)).toBe(false);
  });
});

describe("renderAtom", () => {
  const xml = renderAtom(DOC);

  it("starts with the XML declaration and closes the feed", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml.trimEnd().endsWith("</feed>")).toBe(true);
  });

  it("emits one entry per entry with a urn:gev id", () => {
    expect(countOf(xml, "<entry>")).toBe(DOC.entries.length);
    expect(countOf(xml, "</entry>")).toBe(DOC.entries.length);
    for (const e of DOC.entries) {
      expect(xml).toContain(`<id>urn:gev:${e.id}</id>`);
    }
  });

  it("gives the feed itself a urn:gev id, a self link and an author", () => {
    expect(xml).toContain("<id>urn:gev:place:48453</id>");
    expect(xml).toContain(`<link href="${DOC.selfUrl}" rel="self" type="application/atom+xml"/>`);
    expect(xml).toContain("<author><name>Embedding Atlas</name></author>");
    expect(xml).toContain("<updated>2025-09-10T00:00:00.000Z</updated>");
  });

  it("leaves no unescaped ampersand anywhere in the output", () => {
    expect(UNESCAPED_AMP.test(xml)).toBe(false);
  });

  it("is byte-identical when rendered twice", () => {
    expect(renderAtom(DOC)).toBe(xml);
  });

  it("still produces a well-formed feed with zero entries", () => {
    const empty = renderAtom(EMPTY);
    expect(empty.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(countOf(empty, "<entry>")).toBe(0);
    expect(empty).toContain("<id>urn:gev:place:48453</id>");
    expect(empty.trimEnd().endsWith("</feed>")).toBe(true);
    expect(UNESCAPED_AMP.test(empty)).toBe(false);
  });
});

describe("renderJsonFeed", () => {
  const feed = renderJsonFeed(DOC);

  it("declares JSON Feed 1.1 by URL", () => {
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
  });

  it("maps items one to one, in order, unescaped", () => {
    expect(feed.items).toHaveLength(DOC.entries.length);
    expect(feed.items.map((i) => i.id)).toEqual(DOC.entries.map((e) => e.id));
    expect(feed.items[0]).toEqual({
      id: ENTRIES[0].id,
      url: ENTRIES[0].link,
      title: ENTRIES[0].title,
      content_text: ENTRIES[0].summary,
      date_published: ENTRIES[0].published,
      date_modified: ENTRIES[0].updated,
      tags: ENTRIES[0].tags,
    });
  });

  it("carries the channel fields", () => {
    expect(feed.title).toBe(DOC.title);
    expect(feed.home_page_url).toBe(DOC.homeUrl);
    expect(feed.feed_url).toBe(DOC.selfUrl);
    expect(feed.description).toBe(DOC.description);
  });

  it("serialises identically when rendered twice", () => {
    expect(JSON.stringify(renderJsonFeed(DOC))).toBe(JSON.stringify(feed));
  });

  it("produces an empty item list with zero entries", () => {
    expect(renderJsonFeed(EMPTY).items).toEqual([]);
  });
});

describe("escaping across all three renderers", () => {
  const hostile: FeedDoc = {
    ...DOC,
    entries: [{ ...ENTRIES[0], title: "<script>x & y</script>", summary: "quote \" and apostrophe ' and <b>", tags: ["a&b"] }],
  };

  it("renders markup and ampersands as text in RSS", () => {
    const xml = renderRss(hostile);
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("<title>&lt;script&gt;x &amp; y&lt;/script&gt;</title>");
    expect(xml).toContain("<category>a&amp;b</category>");
    expect(UNESCAPED_AMP.test(xml)).toBe(false);
  });

  it("renders markup and ampersands as text in Atom", () => {
    const xml = renderAtom(hostile);
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("<title>&lt;script&gt;x &amp; y&lt;/script&gt;</title>");
    expect(xml).toContain('<category term="a&amp;b"/>');
    expect(UNESCAPED_AMP.test(xml)).toBe(false);
  });

  it("leaves JSON Feed text unescaped, because JSON is not XML", () => {
    const feed = renderJsonFeed(hostile);
    expect(feed.items[0].title).toBe("<script>x & y</script>");
    expect(JSON.parse(JSON.stringify(feed)).items[0].content_text).toBe("quote \" and apostrophe ' and <b>");
  });
});
