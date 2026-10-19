// Render tests for the Ask Jev panel over six production world_context v2
// replies (lib/jev/__fixtures__, recorded 2026-10-19 by
// writeups/jev-2026-10-18/ask-panel-raw/fetch.py, uncapped): Mobile County AL,
// Connecticut's Capitol planning region, Chugach AK, an ocean point, Texas and
// a point in Austin. The rules are ASK-PANEL-SPEC.md as amended by
// ASK-PANEL-DATA-AUDIT.md (see lib/jev/format.ts).
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorldItem, WorldSection } from "@/lib/mcp/world";
import { JEV_SECTIONS, gapSentence, type JevBundle } from "@/lib/jev/format";
import { plainNote, plainWhat } from "@/lib/jev/plain";
import { GLOSSARY } from "@/lib/jev/glossary";
import JevAnswer, { JEV_FADE_CLASS } from "./JevAnswer";

const DIR = path.join(__dirname, "..", "..", "lib", "jev", "__fixtures__");
const NAMES = ["mobile", "ct-capitol", "chugach", "ocean", "texas", "austin-pt"] as const;
const FIXTURES = NAMES.map((n) => ({ name: n, bundle: JSON.parse(fs.readFileSync(path.join(DIR, `${n}.full.json`), "utf8")) as JevBundle & { coverageStatus?: { status: string } } }));

/** Text as renderToStaticMarkup escapes it. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

/** Visible text with each first-use expansion folded back to the bare acronym. */
function plainOf(html: string): string {
  const t = html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  return Object.entries(GLOSSARY).reduce((acc, [a, f]) => acc.split(`${a} (${f})`).join(a), t);
}

function render(bundle: JevBundle, reducedMotion = false): string {
  return renderToStaticMarkup(<JevAnswer bundle={bundle} reducedMotion={reducedMotion} />);
}

/** Each shown section's markup, by topic key. */
function sectionsOf(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<section data-jev-section="([a-z]+)"[\s\S]*?<\/section>/g)) out.set(m[1], m[0]);
  return out;
}

const linesOf = (sec: string) => [...sec.matchAll(/<li data-jev-line=""[\s\S]*?<\/li>/g)].map((m) => m[0]);
const gapsOf = (sec: string) => [...sec.matchAll(/<li data-jev-gap=""[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const valueOf = (line: string) => /<span data-jev-value=""[^>]*>([\s\S]*?)<\/span><span class="text-\[9px\]/.exec(line)?.[1] ?? null;
const hrefOf = (line: string) => /<a data-jev-source="" href="([^"]*)"/.exec(line)?.[1] ?? null;

function shownTopics(b: JevBundle): [string, WorldSection][] {
  return JEV_SECTIONS.filter((k) => b.topics?.[k]).map((k) => [k, b.topics![k]!]);
}

describe("Ask Jev fixtures", () => {
  it("are the six recorded replies, every one partial at the top level", () => {
    expect(FIXTURES).toHaveLength(6);
    for (const f of FIXTURES) expect(f.bundle.coverageStatus?.status, f.name).toBe("partial");
  });
});

describe.each(FIXTURES)("JevAnswer over $name", ({ bundle }) => {
  const html = render(bundle);
  const secs = sectionsOf(html);

  it("shows the spec's sections in topic order and nothing else", () => {
    expect([...secs.keys()]).toEqual(JEV_SECTIONS.filter((k) => bundle.topics?.[k]));
    expect(secs.has("fabric")).toBe(false);
  });

  it("renders every missing[] entry as a gap sentence (what, then the plain why, both in plain words), never as a 0", () => {
    for (const [k, t] of shownTopics(bundle)) {
      const gaps = gapsOf(secs.get(k)!).map(plainOf);
      const missing = t.missing ?? [];
      expect(gaps, k).toEqual(missing.map((m) => gapSentence(m)));
      for (const [i, g] of gaps.entries()) {
        expect(g.startsWith(`${plainWhat(missing[i].what)}: `)).toBe(true);
        expect(g.trim()).not.toBe("0");
      }
      // A topic with gaps and no items draws no value at all, so nothing can read as 0.
      if (!t.items.length) expect(secs.get(k)!, k).not.toContain("data-jev-value");
    }
  });

  it("renders a null-valued item as its note: not a gap, not a 0", () => {
    for (const [k, t] of shownTopics(bundle)) {
      const lines = linesOf(secs.get(k)!);
      expect(lines, k).toHaveLength(t.items.length);
      t.items.forEach((it: WorldItem, i) => {
        if (it.value !== null) return;
        const v = valueOf(lines[i]);
        expect(it.note, `${k} item ${i} has a note`).toBeTruthy();
        expect(plainOf(v ?? "")).toBe(plainNote(it.note!));
        expect(v).not.toBe("0");
        expect(lines[i]).toContain("data-jev-from-note");
        expect(gapsOf(secs.get(k)!).map(plainOf)).not.toContain(plainNote(it.note!));
      });
    }
  });

  it("gives every fact line a source link: upstreamRecordUrl, else link", () => {
    let n = 0;
    for (const [k, t] of shownTopics(bundle)) {
      const lines = linesOf(secs.get(k)!);
      t.items.forEach((it: WorldItem, i) => {
        const want = it.upstreamRecordUrl || it.link;
        expect(want, `${k} item ${i}`).toBeTruthy();
        expect(hrefOf(lines[i]), `${k} item ${i}`).toBe(esc(want));
        n++;
      });
    }
    expect([...html.matchAll(/data-jev-line=""/g)]).toHaveLength(n);
    expect([...html.matchAll(/data-jev-source=""/g)]).toHaveLength(n);
  });

  it("marks only the topics that have missing[] entries, and has no panel-wide partial badge", () => {
    let marked = 0;
    for (const [k, t] of shownTopics(bundle)) {
      const has = (t.missing?.length ?? 0) > 0;
      expect(secs.get(k)!.includes(`data-jev-marker="${k}"`), k).toBe(has);
      if (has) marked++;
    }
    expect([...html.matchAll(/data-jev-marker=/g)]).toHaveLength(marked);
    // Outside the sections there is nothing at all, so no badge for the whole reply.
    const outside = html.replace(/<section[\s\S]*?<\/section>/g, "");
    expect(outside).toBe('<div data-jev-answer=""></div>');
  });

  it("applies no animation class or delay under reduced motion", () => {
    const still = render(bundle, true);
    expect(still).not.toContain(JEV_FADE_CLASS);
    expect(still).not.toContain("animation");
    // With motion: every section fades, in topic order.
    const delays = [...html.matchAll(/<section data-jev-section="[a-z]+" class="[^"]*\bjev-fade\b[^"]*" style="animation-delay:(\d+)ms"/g)].map((m) => Number(m[1]));
    expect(delays).toHaveLength(secs.size);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
  });
});

describe("fixture coverage of the rules", () => {
  it("includes null-valued items, topics with and without missing[], and items with no record URL", () => {
    const all = FIXTURES.flatMap((f) => shownTopics(f.bundle).map(([, t]) => t));
    expect(all.some((t) => t.items.some((i) => i.value === null))).toBe(true);
    expect(all.some((t) => (t.missing?.length ?? 0) > 0)).toBe(true);
    expect(all.some((t) => !(t.missing?.length ?? 0))).toBe(true);
    expect(all.some((t) => t.items.some((i) => !i.upstreamRecordUrl))).toBe(true);
  });
});
