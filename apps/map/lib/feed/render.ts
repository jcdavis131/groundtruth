// Feed renderers over a narrow document: RSS 2.0, Atom 1.0 and JSON Feed 1.1.
//
// A FeedDoc is the whole input. It carries no watchlist, no evaluation and no
// domain vocabulary, so the same three renderers serve a place brief, a metro
// brief or anything later that can produce a title, a link and a stable id per
// entry. The caller owns entry order and entry ids: nothing is appended here
// and nothing is sorted, because the id is the contract a polling reader
// depends on and only the caller knows what makes one entry the same entry a
// week later.
//
// Pure string building, no XML library. Every interpolated value goes through
// escapeXml, so a title containing markup renders as text rather than as an
// element.

import { escapeXml } from "./hash";

export interface FeedEntry {
  id: string;
  title: string;
  link: string;
  /** Plain text body. */
  summary: string;
  /** ISO 8601. */
  published: string;
  updated: string;
  tags: string[];
}

export interface FeedDoc {
  /** Channel identity, used verbatim inside the urn:gev Atom id. */
  id: string;
  title: string;
  description: string;
  homeUrl: string;
  /** This feed's own URL (rel=self). */
  selfUrl: string;
  /** ISO time the document was assembled; the caller passes it, never Date.now(). */
  generatedAt: string;
  generator: string;
  entries: FeedEntry[];
}

export interface JsonFeed {
  version: "https://jsonfeed.org/version/1.1";
  title: string;
  home_page_url: string;
  feed_url: string;
  description: string;
  items: Array<{ id: string; url: string; title: string; content_text: string; date_published: string; date_modified: string; tags: string[] }>;
}

/** RFC 822 for an RSS pubDate; an unparseable timestamp falls back to the epoch rather than "Invalid Date". */
function rfc822(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toUTCString() : new Date(0).toUTCString();
}

export function renderRss(doc: FeedDoc): string {
  const items = doc.entries
    .map(
      (e) => `    <item>
      <title>${escapeXml(e.title)}</title>
      <link>${escapeXml(e.link)}</link>
      <guid isPermaLink="false">${escapeXml(e.id)}</guid>
      <pubDate>${rfc822(e.published)}</pubDate>
      <description>${escapeXml(e.summary)}</description>
${e.tags.map((t) => `      <category>${escapeXml(t)}</category>`).join("\n")}
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(doc.title)}</title>
    <link>${escapeXml(doc.homeUrl)}</link>
    <atom:link href="${escapeXml(doc.selfUrl)}" rel="self" type="application/rss+xml"/>
    <description>${escapeXml(doc.description)}</description>
    <lastBuildDate>${rfc822(doc.generatedAt)}</lastBuildDate>
    <generator>${escapeXml(doc.generator)}</generator>
    <ttl>300</ttl>
${items}
  </channel>
</rss>
`;
}

export function renderAtom(doc: FeedDoc): string {
  const body = doc.entries
    .map(
      (e) => `  <entry>
    <id>urn:gev:${escapeXml(e.id)}</id>
    <title>${escapeXml(e.title)}</title>
    <link href="${escapeXml(e.link)}"/>
    <published>${escapeXml(e.published)}</published>
    <updated>${escapeXml(e.updated)}</updated>
${e.tags.map((t) => `    <category term="${escapeXml(t)}"/>`).join("\n")}
    <summary type="text">${escapeXml(e.summary)}</summary>
  </entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:gev:${escapeXml(doc.id)}</id>
  <title>${escapeXml(doc.title)}</title>
  <subtitle>${escapeXml(doc.description)}</subtitle>
  <link href="${escapeXml(doc.homeUrl)}"/>
  <link href="${escapeXml(doc.selfUrl)}" rel="self" type="application/atom+xml"/>
  <updated>${escapeXml(doc.generatedAt)}</updated>
  <generator>${escapeXml(doc.generator)}</generator>
  <author><name>${escapeXml(doc.generator)}</name></author>
${body}
</feed>
`;
}

export function renderJsonFeed(doc: FeedDoc): JsonFeed {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: doc.title,
    home_page_url: doc.homeUrl,
    feed_url: doc.selfUrl,
    description: doc.description,
    items: doc.entries.map((e) => ({
      id: e.id,
      url: e.link,
      title: e.title,
      content_text: e.summary,
      date_published: e.published,
      date_modified: e.updated,
      tags: e.tags,
    })),
  };
}
