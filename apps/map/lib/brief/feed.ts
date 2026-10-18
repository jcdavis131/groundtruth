// A Brief, as the narrow document lib/feed/render.ts renders.
//
// The only thing this adapter has to get right is the entry id. A reader
// polls a place feed every hour and decides what is new by guid, so an id
// that carries a wall-clock term re-notifies every Monday morning on a brief
// that has not changed. Finding.id is already a content hash over kind,
// scope, metric, period and value with no timestamp in it, so the id here is
// just that hash namespaced by the scope — two runs a week apart over
// unchanged data produce the same guids, and a finding that moves produces
// exactly one new one.
//
// The digest is appended last rather than first: it is the entry that exists
// so the feed is never empty, and a reader scanning newest-first should meet
// the findings before the summary of them. It also carries the full citation
// list, because a feed reader that never visits the page still has to be able
// to see where the numbers came from.
//
// lib/watch/feed.ts is deliberately not imported. Its FeedInput needs a
// watchlist, a resolve pass and an evaluation, its channel description is
// written in watchlist vocabulary, and its event guid hashes a positional
// index into watchlist.rules — which is exactly the instability this feed
// exists to avoid.

import type { FeedDoc, FeedEntry } from "@/lib/feed/render";
import { num } from "./format";
import { joinList } from "./sentence";
import type { Brief, Finding } from "./types";

/** The generator string every place brief feed carries; not the watchlist one. */
export const BRIEF_GENERATOR = "Embedding Atlas place briefs";

function entryFor(b: Brief, f: Finding, pageUrl: string, citations: string[]): FeedEntry {
  const lines: string[] = [f.sentence, ...f.arithmetic];
  if (f.citation) lines.push(`Basis: ${f.citation}.`);
  if (f.period) lines.push(`Period ${f.period}.`);
  // Only the digest gets the source list, so a reader of one finding is not
  // handed the whole bibliography on every item.
  if (citations.length > 0) lines.push("Sources:", ...citations);
  return {
    id: `gev-brief-${b.scopeId}-${f.id}`,
    title: f.sentence,
    link: `${pageUrl}#${f.id}`,
    summary: lines.join("\n"),
    // There is no crossing timestamp anywhere in this repo: nothing records
    // when a finding first fired, so inventing a per-finding published time
    // would be a fabricated fact. Both stamps are the brief's own.
    published: b.generatedAt,
    updated: b.generatedAt,
    // The digest's metric is "" — a finding about the place as a whole — and
    // an empty <category> is noise rather than a tag.
    tags: [f.kind, f.severity, f.metric].filter((t) => t.length > 0),
  };
}

/** One entry per finding in the brief's order, then the digest, so the feed always has an item. */
export function briefFeedEntries(b: Brief, pageUrl: string): FeedEntry[] {
  return [...b.findings.map((f) => entryFor(b, f, pageUrl, [])), entryFor(b, b.digest, pageUrl, b.citations)];
}

/** The channel sentence: which place, how many findings, and which periods they describe. */
function describe(b: Brief): string {
  const n = b.findings.length;
  const count = `${num(n)} finding${n === 1 ? "" : "s"}`;
  const covers = b.coversPeriods.length > 0 ? `covering ${joinList([...b.coversPeriods])}` : "covering no published period yet";
  const lens = b.lens ? `, filtered to the ${b.lens} lens` : "";
  return `What changed in ${b.scopeName}${lens}: ${count} ${covers}, each one printed with the arithmetic behind it. Entry ids are content-addressed, so an unchanged finding is never sent twice.`;
}

export function briefFeedDoc(b: Brief, urls: { self: string; home: string; page: string }): FeedDoc {
  return {
    id: `brief:${b.scopeId}${b.lens ? `:${b.lens}` : ""}`,
    title: `${b.scopeName} brief`,
    description: describe(b),
    homeUrl: urls.home,
    selfUrl: urls.self,
    generatedAt: b.generatedAt,
    generator: BRIEF_GENERATOR,
    entries: briefFeedEntries(b, urls.page),
  };
}
