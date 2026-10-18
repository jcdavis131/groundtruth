// What a subscriber is promised: an entry per finding, a digest that keeps the
// feed alive, and a guid that only moves when the underlying number moves.
//
// The golden brief is the input here for the same reason it is the review
// surface in build.test.ts — a wording change shows up as a diff in one file
// rather than as a surprise in a reader's inbox.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderAtom, renderJsonFeed, renderRss } from "@/lib/feed/render";
import { buildBrief, type BuildBriefOptions } from "./build";
import { briefFeedDoc, briefFeedEntries } from "./feed";
import { FIXTURE_OPTS, KING_INPUT, TRAVIS_INPUT } from "./fixtures";
import type { Brief } from "./types";

const GOLDEN: Brief = JSON.parse(fs.readFileSync(path.resolve(__dirname, "golden/county-48453.json"), "utf8")) as Brief;

const URLS = {
  self: "https://eye.jcamd.com/place/48453/feed.xml",
  home: "https://eye.jcamd.com/place/48453",
  page: "https://eye.jcamd.com/place/48453/brief",
};

/** The cap lifted, so a perturbation cannot change the answer by changing which findings survive the cut. */
const UNCAPPED: BuildBriefOptions = { ...FIXTURE_OPTS, maxFindings: 100 };

function ids(b: Brief): string[] {
  return briefFeedEntries(b, URLS.page).map((e) => e.id);
}

describe("briefFeedEntries", () => {
  it("emits one entry per finding and appends the digest last", () => {
    const entries = briefFeedEntries(GOLDEN, URLS.page);
    expect(entries).toHaveLength(GOLDEN.findings.length + 1);
    expect(entries[entries.length - 1].id).toBe(`gev-brief-${GOLDEN.scopeId}-${GOLDEN.digest.id}`);
    expect(entries[entries.length - 1].title).toBe(GOLDEN.digest.sentence);
    expect(entries.slice(0, -1).map((e) => e.title)).toEqual(GOLDEN.findings.map((f) => f.sentence));
  });

  it("links every entry to the finding's anchor on the page", () => {
    for (const e of briefFeedEntries(GOLDEN, URLS.page)) expect(e.link.startsWith(`${URLS.page}#`)).toBe(true);
  });

  it("carries the sentence, the arithmetic, the citation and the period in the summary", () => {
    const withArithmetic = GOLDEN.findings.find((f) => f.arithmetic.length > 0 && f.citation != null && f.period != null);
    expect(withArithmetic, "the golden brief should contain one fully-populated finding").toBeTruthy();
    const entry = briefFeedEntries(GOLDEN, URLS.page)[GOLDEN.findings.indexOf(withArithmetic!)];
    expect(entry.summary).toContain(withArithmetic!.sentence);
    for (const line of withArithmetic!.arithmetic) expect(entry.summary).toContain(line);
    expect(entry.summary).toContain(withArithmetic!.citation!);
    expect(entry.summary).toContain(`Period ${withArithmetic!.period}.`);
  });

  it("tags an entry with its kind, severity and metric", () => {
    const entries = briefFeedEntries(GOLDEN, URLS.page);
    const f = GOLDEN.findings[0];
    expect(entries[0].tags).toEqual([f.kind, f.severity, f.metric]);
    // The digest is about the place as a whole and has no metric; an empty tag is dropped.
    expect(entries[entries.length - 1].tags).toEqual([GOLDEN.digest.kind, GOLDEN.digest.severity]);
  });

  it("is stable across two calls", () => {
    expect(ids(GOLDEN)).toEqual(ids(GOLDEN));
  });

  it("keeps every id when only generatedAt moves, and moves only the timestamps", () => {
    const later: Brief = { ...GOLDEN, generatedAt: "2026-08-29T12:00:00.000Z" };
    expect(ids(later)).toEqual(ids(GOLDEN));
    const before = briefFeedEntries(GOLDEN, URLS.page);
    const after = briefFeedEntries(later, URLS.page);
    expect(after.map((e) => e.published)).not.toEqual(before.map((e) => e.published));
    expect(after.every((e) => e.published === later.generatedAt && e.updated === later.generatedAt)).toBe(true);
  });

  it("moves exactly one id when exactly one value changes", () => {
    const base = buildBrief(TRAVIS_INPUT, UNCAPPED);
    const moved = buildBrief({ ...TRAVIS_INPUT, values: { ...TRAVIS_INPUT.values, "rent.latest": 1725 } }, UNCAPPED);
    const before = new Set(ids(base));
    const after = new Set(ids(moved));
    expect(before.size).toBe(after.size);
    expect([...after].filter((id) => !before.has(id))).toHaveLength(1);
    expect([...before].filter((id) => !after.has(id))).toHaveLength(1);
  });

  it("still produces one entry for a brief with no findings", () => {
    const quiet = buildBrief(KING_INPUT, FIXTURE_OPTS);
    expect(quiet.findings).toHaveLength(0);
    const entries = briefFeedEntries(quiet, URLS.page);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe(quiet.digest.sentence);
  });

  it("puts the whole citation list in the digest summary and nowhere else", () => {
    const entries = briefFeedEntries(GOLDEN, URLS.page);
    const digest = entries[entries.length - 1];
    expect(GOLDEN.citations.length).toBeGreaterThan(0);
    for (const c of GOLDEN.citations) expect(digest.summary).toContain(c);
    for (const e of entries.slice(0, -1)) expect(e.summary).not.toContain(GOLDEN.citations[0]);
  });
});

describe("briefFeedDoc", () => {
  it("identifies the channel by scope and lens", () => {
    expect(briefFeedDoc(GOLDEN, URLS).id).toBe(`brief:${GOLDEN.scopeId}`);
    expect(briefFeedDoc({ ...GOLDEN, lens: "housing" }, URLS).id).toBe(`brief:${GOLDEN.scopeId}:housing`);
    expect(briefFeedDoc(GOLDEN, URLS).title).toBe(`${GOLDEN.scopeName} brief`);
  });

  it("describes the place in its own vocabulary, not the watchlist's", () => {
    const doc = briefFeedDoc(GOLDEN, URLS);
    expect(doc.description).toContain(GOLDEN.scopeName);
    expect(doc.description).toContain(String(GOLDEN.findings.length));
    for (const p of GOLDEN.coversPeriods) expect(doc.description).toContain(p);
    expect(doc.description.toLowerCase()).not.toContain("watchlist");
    expect(doc.description.toLowerCase()).not.toContain("rule");
    expect(doc.generator).not.toContain("watchlist");
  });

  it("takes its urls and its timestamp from the caller", () => {
    const doc = briefFeedDoc(GOLDEN, URLS);
    expect(doc.selfUrl).toBe(URLS.self);
    expect(doc.homeUrl).toBe(URLS.home);
    expect(doc.generatedAt).toBe(GOLDEN.generatedAt);
  });

  it("renders byte-identically twice in all three formats", () => {
    const a = briefFeedDoc(GOLDEN, URLS);
    const b = briefFeedDoc(GOLDEN, URLS);
    expect(renderRss(a)).toBe(renderRss(b));
    expect(renderAtom(a)).toBe(renderAtom(b));
    expect(JSON.stringify(renderJsonFeed(a))).toBe(JSON.stringify(renderJsonFeed(b)));
    // And the guids a reader keys on survive a regeneration an hour later.
    const later = briefFeedDoc({ ...GOLDEN, generatedAt: "2026-08-22T13:00:00.000Z" }, URLS);
    const guids = (xml: string) => xml.match(/<guid[^>]*>([^<]+)<\/guid>/g) ?? [];
    expect(guids(renderRss(later))).toEqual(guids(renderRss(a)));
    expect(guids(renderRss(a)).length).toBe(GOLDEN.findings.length + 1);
  });
});
