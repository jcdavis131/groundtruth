// The Ask Jev panel's person-facing layer (writeups jev-2026-10-18:
// ASK-PANEL-PLAIN-TEXT.md) and the first review's follow-ups, over the six
// recorded world_context replies in lib/jev/__fixtures__.
//
// Scope of the acronym rule: the panel's own words (titles, facts, notes,
// publishers, gap sentences, cut lines, the subtitle and status line). A
// record's value (a hospital's name, a declaration's title, a ticker, a
// system id) and the place's name are the publisher's own words and are not
// checked; the banned-words rule below reads everything, values included.
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldItem } from "@/lib/mcp/world";
import { JEV_SECTIONS, jevSections, jevStatusLine, type JevBundle } from "@/lib/jev/format";
import { GAP_RULES, cutSentences, plainNote, plainReason } from "@/lib/jev/plain";
import { ACRONYM_TOKEN, GLOSSARY, Glosser, segText, unglossed } from "@/lib/jev/glossary";
import { isCloseKey, restoreFocus, scrollOptions, scrollsOnOpen } from "@/lib/jev/focus";
import { JEV_FIPS_TYPES, JEV_PLACE_TYPES, fipsTarget, targetForPick } from "@/lib/jev/ask";
import { JevPanelView } from "./AskJevPanel";

const DIR = path.join(__dirname, "..", "..", "lib", "jev", "__fixtures__");
const NAMES = ["mobile", "ct-capitol", "chugach", "ocean", "texas", "austin-pt"] as const;
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(DIR, `${n}.full.json`), "utf8")) as JevBundle;
const FIXTURES = NAMES.map((name) => ({ name, bundle: load(name) }));

function unesc(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}
/** What a reader sees: tags stripped, entities read. */
const visible = (html: string) => unesc(html.replace(/<[^>]*>/g, ""));
const titlesOf = (html: string) => [...html.matchAll(/\btitle="([^"]*)"/g)].map((m) => unesc(m[1]));

function panel(bundle: JevBundle | null, status: "loading" | "done" | "error" = "done"): string {
  return renderToStaticMarkup(<JevPanelView state={{ asked: "x", status, bundle, error: null }} reducedMotion onClose={() => {}} />);
}

/**
 * The panel's own words: a record's real value (drawn unglossed, with no
 * data-jev-from-note) and the place's name taken out. A note standing in for
 * a null value is the panel's words and stays in.
 */
function ownWords(html: string): string {
  const cut = html.replace(/<span data-jev-value="" class="[^"]*">[^<]*<\/span>/g, "").replace(/<div data-jev-title=""[^>]*>[^<]*<\/div>/g, "");
  return visible(cut);
}

/** Lines a fixture shows a reader, one per element we draw text into. */
const AGENT_WORDS = ["pass a county FIPS", "call world_context", "/api/", "failed[]", "join:", "fixture", "pulled: null", "max_records", "world_context", "upstreamUrl", "hifld-hosp"];

describe("gap reasons in plain words", () => {
  const reasons = new Map<string, { what: string; where: string }>();
  for (const f of FIXTURES)
    for (const k of JEV_SECTIONS) for (const m of f.bundle.topics?.[k]?.missing ?? []) if (!reasons.has(m.reason)) reasons.set(m.reason, { what: m.what, where: `${f.name}/${k}` });

  it("covers every distinct reason in the six fixtures (24 today)", () => {
    expect(reasons.size).toBeGreaterThanOrEqual(24);
  });

  it.each([...reasons].map(([reason, w]) => ({ reason, ...w })))("maps a reason from $where to a template", ({ reason, what }) => {
    const p = plainReason(what, reason);
    // An unmatched reason fails here and the message prints it, so it gets a row in lib/jev/plain.ts.
    expect(p.rule, `no pattern for reason: ${reason}`).not.toBeNull();
    for (const w of AGENT_WORDS) expect(p.text, `${p.rule} leaks "${w}"`).not.toContain(w);
  });

  it("names the publisher the reason names", () => {
    expect(plainReason("FEMA declarations", "fema-openfema: the route lists it as missing: FEMA lists Connecticut under its 8 legacy counties (09001-09015), not the planning regions (09110-09190) Census now uses, so it has nothing filed under this region (join:legacy_ct_counties)").text).toBe(
      "FEMA still files Connecticut under its 8 old counties, not the planning regions Census uses now, so nothing is filed under this region.",
    );
    expect(plainReason("x", "NCEI Storm Events files Alaska by forecast zones and areas, not by county (join:ncei_areas_not_counties)").text).toBe("NCEI Storm Events files Alaska by weather zones, not counties, so there's no county count.");
    expect(plainReason("x", "this county's boundary changed after 2010, so USGS landslide susceptibility's 2010-based row is not attached to it (join:boundary_changed_since_2010): Chugach").text).toBe(
      "This county's boundary changed after 2010, so USGS landslide susceptibility's older figures don't fit it.",
    );
    expect(plainReason("typical asking rent (Zillow ZORI)", "Zillow publishes no rent index for this place").text).toBe("Zillow publishes no figure for this place.");
    expect(plainReason("place fabric: census-tigerweb", "that upstream failed on this call (listed in /api/fabric failed[])").text).toBe("census-tigerweb didn't answer just now. Try again in a minute.");
    expect(plainReason("x", "Census TIGERweb failed on this call (/api/fabric failed[]: timeout)").text).toBe("Census TIGERweb didn't answer just now. Try again in a minute.");
  });

  it("has the spec's rows, including the ones no fixture hits", () => {
    expect(plainReason("place fabric", "the fabric is per point; call world_context with lon/lat (the county's point is -88.1, 30.6)").rule).toBe("fabric-per-point");
    expect(plainReason("elevation", "USGS 3DEP gave no elevation for this point").rule).toBe("no-elevation");
    expect(new Set(GAP_RULES.map((r) => r.id)).size).toBe(GAP_RULES.length);
  });

  it("shows an unmatched reason as written, with no rule", () => {
    expect(plainReason("x", "something new happened.")).toEqual({ rule: null, text: "something new happened." });
  });
});

describe.each(FIXTURES)("the panel over $name, as a person reads it", ({ name, bundle }) => {
  const html = panel(bundle);
  const text = visible(html);

  it("never shows words written for agents", () => {
    const shown = [text, ...titlesOf(html)].join("\n");
    for (const w of AGENT_WORDS) expect(shown.includes(w), `"${w}" in ${name}: ${shown.slice(Math.max(0, shown.indexOf(w) - 80), shown.indexOf(w) + 80)}`).toBe(false);
  });

  it("has a glossary entry for every acronym in its own words", () => {
    expect(unglossed(ownWords(html))).toEqual([]);
  });

  it("spells each acronym out on first use and gives later uses an <abbr> title", () => {
    const own = ownWords(html);
    for (const [abbr, full] of Object.entries(GLOSSARY)) {
      const re = new RegExp(`\\b${abbr}\\b`, "g");
      const hits = [...own.matchAll(re)];
      if (!hits.length) continue;
      const at = hits[0].index ?? 0;
      expect(own.slice(at, at + abbr.length + full.length + 3), `${name}: first ${abbr}`).toBe(`${abbr} (${full})`);
      // Spelled out once only.
      expect(own.split(`${abbr} (${full})`).length - 1, `${name}: ${abbr} spelled out once`).toBe(1);
      if (hits.length > 1) expect(html, `${name}: ${abbr} as abbr`).toContain(`<abbr title="${full.replace(/&/g, "&amp;")}" class="no-underline">${abbr}</abbr>`);
    }
  });

  it("puts only a short status line in the live region, never the answer", () => {
    const live = [...html.matchAll(/aria-live="polite"/g)];
    expect(live).toHaveLength(1);
    const region = /<div data-jev-status=""[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(region).not.toContain("<");
    const secs = jevSections(bundle);
    const facts = secs.reduce((n, s) => n + s.lines.length, 0);
    const gaps = secs.reduce((n, s) => n + s.gaps.length, 0);
    expect(unesc(region)).toBe(`Answer loaded: ${facts} ${facts === 1 ? "fact" : "facts"}, ${gaps} ${gaps === 1 ? "gap" : "gaps"}`);
  });

  it("shows notes beside real values as visible text, not only a tooltip", () => {
    const items = JEV_SECTIONS.flatMap((k) => bundle.topics?.[k]?.items ?? []);
    const noted = items.filter((it: WorldItem) => it.value !== null && it.note);
    expect([...html.matchAll(/data-jev-note=""/g)]).toHaveLength(noted.length);
    const shown = [...html.matchAll(/<span data-jev-note=""[^>]*>([\s\S]*?)<\/span><\/li>/g)].map((m) => visible(m[1]));
    // Each visible note reads as the item's plain note once its acronym expansions are folded back.
    const fold = (t: string) => Object.entries(GLOSSARY).reduce((acc, [a, f]) => acc.split(`${a} (${f})`).join(a), t);
    expect(shown.map(fold)).toEqual(noted.map((it) => plainNote(it.note!)));
    expect(html).not.toMatch(/<li data-jev-line=""[^>]*title=/);
  });
});

describe("the panel's live region outside an answer", () => {
  it("says it is asking, then that there was no answer", () => {
    expect(jevStatusLine("loading", null)).toBe("Asking Jev…");
    expect(visible(/<div data-jev-status=""[^>]*>([\s\S]*?)<\/div>/.exec(panel(null, "loading"))![1])).toBe("Asking Jev…");
    expect(jevStatusLine("error", null)).toBe("No answer for this place.");
  });
});

describe("the glossary", () => {
  it("expansions carry no acronym of their own", () => {
    for (const [abbr, full] of Object.entries(GLOSSARY)) expect([...full.matchAll(ACRONYM_TOKEN)].map((m) => m[0]), abbr).toEqual([]);
  });

  it("spells out once per glosser, in reading order", () => {
    const g = new Glosser();
    expect(segText(g.gloss("FEMA and NWS"))).toBe("FEMA (Federal Emergency Management Agency) and NWS (National Weather Service)");
    expect(segText(g.gloss("FEMA again"))).toBe("FEMA again");
    expect(segText(new Glosser(["FEMA"]).gloss("FEMA"))).toBe("FEMA");
  });

  it("flags a word with 2+ capitals that has no entry, but not a code with digits", () => {
    expect(unglossed("ask XYZQ about TX2270001 and FEMA")).toEqual(["XYZQ"]);
  });
});

describe("cuts at max_records and a trimmed reply (Mobile County)", () => {
  const mobile = load("mobile");

  it("says how many of each list are shown", () => {
    const html = panel(mobile);
    const inst = /<section data-jev-section="institutions"[\s\S]*?<\/section>/.exec(html)![0];
    const cuts = [...inst.matchAll(/<li data-jev-cut=""[^>]*>([\s\S]*?)<\/li>/g)].map((m) => visible(m[1]));
    expect(cuts).toEqual(["3 of 7 hospitals shown.", "3 of 28 dams shown."]);
    expect(cutSentences(["UCMR 5 detections for TX2270001: 3 of 6 shown (max_records)", "dams: 3 of at least 40 shown (max_records)", "FEMA declarations: the latest 3 distinct shown, any date"])).toEqual([
      "3 of 6 UCMR 5 detections for TX2270001 shown.",
      "3 of at least 40 dams shown.",
    ]);
  });

  it("notes a reply trimmed for size in one line, and only then", () => {
    expect(panel(mobile)).not.toContain("data-jev-truncated");
    const html = panel({ ...mobile, truncated: { droppedItems: 4, note: "items cut from the longest topics to stay under 40000 bytes; ask fewer topics or a smaller max_records" } });
    const notes = [...html.matchAll(/<div data-jev-truncated=""[^>]*>([\s\S]*?)<\/div>/g)].map((m) => visible(m[1]));
    expect(notes).toEqual(["This answer was long, so 4 lines were left out to keep it short."]);
  });

  it("shows a private dam's NID id on its line", () => {
    const html = panel(mobile);
    const dams = [...html.matchAll(/<li data-jev-line=""[\s\S]*?<\/li>/g)].map((m) => m[0]).filter((l) => l.includes("data-jev-id"));
    const ids = dams.map((l) => visible(/<span data-jev-id=""[^>]*>([\s\S]*?)<\/span>/.exec(l)![1]).replace(/^NID \([^)]*\)/, "NID"));
    expect(ids).toEqual(["NID id AL00011", "NID id MS06238"]);
  });
});

describe("keyboard, focus and scroll", () => {
  it("closes on Escape only", () => {
    expect(isCloseKey("Escape")).toBe(true);
    expect(isCloseKey("Enter")).toBe(false);
    expect(isCloseKey("Esc")).toBe(false);
  });

  it("scrolls into view only when opened from What's here, never smoothly under reduced motion", () => {
    expect(scrollsOnOpen("here")).toBe(true);
    expect(scrollsOnOpen("search")).toBe(false);
    expect(scrollOptions(true)).toEqual({ block: "nearest", behavior: "auto" });
    expect(scrollOptions(false)).toEqual({ block: "nearest", behavior: "smooth" });
  });

  it("gives focus back to the opener only while it is on the page", () => {
    const focus = vi.fn();
    expect(restoreFocus({ isConnected: true, focus })).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    expect(restoreFocus({ isConnected: false, focus })).toBe(false);
    expect(restoreFocus(null)).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("makes the panel focusable and closes from inside it", () => {
    const html = panel(load("mobile"));
    expect(html).toMatch(/^<div data-jev-panel="" tabindex="-1"/);
  });
});

describe("⌘K place types", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks Alaska's census areas and boroughs by county FIPS, like a county", () => {
    expect([...JEV_PLACE_TYPES].sort()).toEqual(["borough", "census", "city", "county", "municipality", "state", "town", "village"]);
    expect(JEV_FIPS_TYPES).toEqual({ county: "county", census: "county", borough: "county", state: "state" });
    const nodes = [{ kind: "county", code: "02063" }, { kind: "state", code: "02" }];
    expect(fipsTarget("census", nodes)).toEqual({ kind: "county", fips: "02063" });
    expect(fipsTarget("borough", nodes)).toEqual({ kind: "county", fips: "02063" });
    expect(fipsTarget("city", nodes)).toBeNull();
    expect(fipsTarget("toString", nodes)).toBeNull();
  });

  it("reads the FIPS from the fabric for a census-area hit (Chugach)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { nodes: [{ kind: "county", code: "02063" }] } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(targetForPick({ lon: -146.2, lat: 60.5, type: "census" })).resolves.toEqual({ kind: "county", fips: "02063" });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/api/fabric?op=stack");
    await expect(targetForPick({ lon: -146.2, lat: 60.5, type: "hamlet" })).resolves.toEqual({ kind: "point", lon: -146.2, lat: 60.5 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
