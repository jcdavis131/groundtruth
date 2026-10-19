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
import { JEV_ERROR_SENTENCE, JEV_SECTIONS, jevSections, jevStatusLine, placeSubtitle, placeTitle, toGap, type JevBundle } from "@/lib/jev/format";
import { GAP_RULES, aboutKm, cutSentences, plainBasis, plainFact, plainNote, plainPublisher, plainReason, plainWhat, upstreamName } from "@/lib/jev/plain";
import { ACRONYM_TOKEN, GLOSSARY, Glosser, TERMS, segText, unglossed } from "@/lib/jev/glossary";
import { closeOnEscape, isCloseKey, restoreFocus, scrollOptions, scrollsOnOpen } from "@/lib/jev/focus";
import { JEV_FIPS_TYPES, JEV_PLACE_TYPES, fipsTarget, targetForPick } from "@/lib/jev/ask";
import { JevPanelView } from "./AskJevPanel";

const DIR = path.join(__dirname, "..", "..", "lib", "jev", "__fixtures__");
const NAMES = ["mobile", "ct-capitol", "chugach", "ocean", "texas", "austin-pt"] as const;
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(DIR, `${n}.full.json`), "utf8")) as JevBundle;
const FIXTURES = NAMES.map((name) => ({ name, bundle: load(name) }));

function unesc(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}
/**
 * What a reader sees: tags stripped, entities read. Block ends (and the
 * source link) become a space, so words in separate elements never run
 * together ("source" + "FEMA" is not "sourceFEMA"); inline tags (an <abbr>,
 * a first-use span) vanish, so "FEMA's" stays one piece of text.
 */
const visible = (html: string) => unesc(html.replace(/<\/(?:li|div|section|h3|ul|a)>/g, " ").replace(/<[^>]*>/g, ""));
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
  // A value may carry a term's gloss ("D0 (abnormally dry)", "ng/L"): a first-use span, a later <abbr>, React's text separators.
  const cut = html.replace(/<span data-jev-value="" class="[^"]*">(?:[^<]|<!-- -->|<abbr[^>]*>[^<]*<\/abbr>|<span>(?:[^<]|<!-- -->)*<\/span>)*<\/span>/g, "").replace(/<div data-jev-title=""[^>]*>[^<]*<\/div>/g, "");
  return visible(cut);
}

/** Words written for agents, which a reader must never see: tool names, routes, ids, a search box's corners. */
const AGENT_WORDS: readonly (string | RegExp)[] = [
  "pass a county FIPS",
  "call world_context",
  "/api/",
  "failed[]",
  "join:",
  "fixture",
  "pulled: null",
  "max_records",
  "world_context",
  "upstreamUrl",
  "hifld-hosp",
  "census-tigerweb",
  "usgs-wbd",
  "fema-nfhl",
  "this box",
  "place fabric",
  "record-level URL",
  "user agent",
  "names are not copied",
  "internal point",
  /\broute\b/,
  // A search box's four corners: "(-88.4466,30.4346,-87.9466,30.9346)".
  /\(-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\)/,
  /\((?:tavg|pcp)\)/,
  // Added for the hallway test (2026-10-19): this atlas's internal name, a bare null, the box, raw degrees,
  // a magnitude code, an HTTP status and a bracketed snake_case id ("(FEMA_HQ_Preparedness_NIC)").
  /\beye\b/,
  /\bnull\b/,
  /\bthe box\b/,
  /\d degrees\b/,
  /\bM\d+(?:\.\d+)?\+/,
  /\bHTTP \d{3}\b/,
  /\([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\)/,
];

/** The first agent word in `s`, with its surroundings, or null. */
function leak(s: string): string | null {
  for (const w of AGENT_WORDS) {
    const at = typeof w === "string" ? s.indexOf(w) : s.search(w);
    if (at >= 0) return `${String(w)} at: ${s.slice(Math.max(0, at - 80), at + 80)}`;
  }
  return null;
}

describe("gap reasons in plain words", () => {
  // Every topic, the fabric's too (the panel doesn't show it today, but its reasons are mapped all the same).
  const reasons = new Map<string, { what: string; where: string }>();
  for (const f of FIXTURES)
    for (const [k, t] of Object.entries(f.bundle.topics ?? {})) for (const m of t?.missing ?? []) if (!reasons.has(m.reason)) reasons.set(m.reason, { what: m.what, where: `${f.name}/${k}` });

  it("covers every distinct reason in the six fixtures (24 shown, 30 with the fabric's)", () => {
    expect(reasons.size).toBeGreaterThanOrEqual(30);
  });

  it.each([...reasons].map(([reason, w]) => ({ reason, ...w })))("maps a reason from $where to a template", ({ reason, what }) => {
    const p = plainReason(what, reason);
    // An unmatched reason fails here and the message prints it, so it gets a row in lib/jev/plain.ts.
    expect(p.rule, `no pattern for reason: ${reason}`).not.toBeNull();
    expect(leak(toGap({ what, reason }).sentence), p.rule ?? "").toBeNull();
  });

  // One sample per row, so breaking any row's pattern fails here even where no shown fixture hits it.
  const SAMPLES: Record<string, [what: string, reason: string]> = {
    "state-or-county-only": ["water", "a state has no single water system; pass a county FIPS, a point or a box"],
    "fabric-per-point": ["place fabric", "the fabric is per point; call world_context with lon/lat (the county's point is -88.1966, 30.6846)"],
    "upstream-failed": ["place fabric: usgs-wbd", "that upstream failed on this call (listed in /api/fabric failed[])"],
    "ct-legacy-counties": ["SPC", "SPC lists Connecticut under its 8 legacy counties (09001-09015), not the planning regions (09110-09190) Census now uses, so it has nothing filed under this region (join:legacy_ct_counties)"],
    "alaska-forecast-zones": ["NCEI Storm Events", "NCEI Storm Events files Alaska by forecast zones and areas, not by county (join:ncei_areas_not_counties)"],
    "boundary-changed": ["x", "this county's boundary changed after 2010, so USGS landslide susceptibility's 2010-based row is not attached to it"],
    "sec-sample": ["SEC", "eye's SEC bundle is a committed fixture (pulled: null), not a full pull of EDGAR registrants"],
    "no-county": ["x", "no county resolved"],
    "no-water-service-area": ["water", "no EPA community water system service area contains the point: it may be served by a private well"],
    "no-value-or-rent-index": ["rent", "Zillow publishes no rent index for this place"],
    "no-metro": ["metro", "none: this county is in no metropolitan or micropolitan statistical area (Census TIGERweb answered and returned no CBSA here)"],
    "no-scheduled-release": ["next releases", "none of the sources cited here has a scheduled release on eye's calendar (2026-10-19 to 2026-11-18)"],
    "no-elevation": ["elevation", "USGS 3DEP gave no elevation for this point"],
    "ct-planning-regions": ["Connecticut county id", "Census uses planning regions (09110-09190) as county equivalents; some sources publish only legacy counties (09001-09015), so a county-keyed fact can be absent here for that reason alone"],
  };

  it("has a sample for every row, and each sample hits its own row", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(GAP_RULES.map((r) => r.id).sort());
    for (const [id, [what, reason]] of Object.entries(SAMPLES)) expect(plainReason(what, reason).rule, id).toBe(id);
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
    expect(plainReason("x", "Census TIGERweb failed on this call (/api/fabric failed[]: timeout)").text).toBe("The Census Bureau didn't answer just now. Try again in a minute.");
  });

  it("names an upstream that failed by its publisher, never its id", () => {
    const failed = "that upstream failed on this call (listed in /api/fabric failed[])";
    expect(plainReason("place fabric: census-tigerweb", failed).text).toBe("The Census Bureau didn't answer just now. Try again in a minute.");
    expect(plainReason("place fabric: usgs-wbd", failed).text).toBe("USGS didn't answer just now. Try again in a minute.");
    expect(plainReason("place fabric: fema-nfhl", failed).text).toBe("FEMA didn't answer just now. Try again in a minute.");
    expect(plainReason("place fabric: some-new-id", failed).text).toBe("One of the sources didn't answer just now. Try again in a minute.");
    expect(plainReason("place fabric", failed).text).toBe("One of the sources didn't answer just now. Try again in a minute.");
    expect(upstreamName("nws-alerts")).toBe("One of the sources");
    expect(plainWhat("place fabric: usgs-wbd")).toBe("place details from USGS");
    expect(plainWhat("place fabric: some-new-id")).toBe("place details from one of the sources");
    // The recorded Austin point: both fabric gaps, as a person reads them.
    const austin = load("austin-pt").topics?.fabric?.missing ?? [];
    expect(austin.map((m) => toGap(m).sentence)).toEqual([
      "place details from USGS: USGS didn't answer just now. Try again in a minute.",
      "place details from FEMA: FEMA didn't answer just now. Try again in a minute.",
    ]);
  });

  it("says county or state by the kind of place asked (Texas is a state)", () => {
    const sayFor = (n: string) => plainReason("place fabric", load(n).topics!.fabric!.missing![0].reason).text;
    expect(sayFor("texas")).toBe("Elevation, flood zone and watershed need a spot on the map. Click inside the state.");
    expect(sayFor("mobile")).toBe("Elevation, flood zone and watershed need a spot on the map. Click inside the county.");
    expect(plainReason("place fabric", "the fabric is per point; call world_context with lon/lat").text).toBe("Elevation, flood zone and watershed need a spot on the map. Click inside the county or state.");
  });

  it("writes parameter codes as words and drops other trailing codes (Connecticut's Capitol region)", () => {
    expect(plainWhat("NOAA Climate at a Glance (tavg)")).toBe("NOAA Climate at a Glance (average temperature)");
    expect(plainWhat("NOAA Climate at a Glance (pcp)")).toBe("NOAA Climate at a Glance (precipitation)");
    expect(plainWhat("NOAA Climate at a Glance (zndx)")).toBe("NOAA Climate at a Glance");
    expect(plainWhat("metro area (CBSA)")).toBe("metro area (CBSA)");
    expect(plainPublisher("NOAA Climate at a Glance (tavg)")).toBe("NOAA Climate at a Glance");
    const hazards = jevSections(load("ct-capitol")).find((s) => s.key === "hazards")!;
    const noaa = hazards.gaps.filter((g) => g.what.startsWith("NOAA"));
    expect(noaa.map((g) => g.sentence)).toEqual([
      "NOAA Climate at a Glance (average temperature): NOAA Climate at a Glance still files Connecticut under its 8 old counties, not the planning regions Census uses now, so nothing is filed under this region.",
      "NOAA Climate at a Glance (precipitation): NOAA Climate at a Glance still files Connecticut under its 8 old counties, not the planning regions Census uses now, so nothing is filed under this region.",
    ]);
    expect(hazards.marker).toContain("NOAA Climate at a Glance (average temperature); NOAA Climate at a Glance (precipitation)");
    const shown = visible(panel(load("ct-capitol")));
    expect(shown).not.toMatch(/\((?:tavg|pcp)\)/);
    expect(shown).toContain("Climate at a Glance (average temperature)");
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
    expect(leak(shown), name).toBeNull();
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

describe("notes about live counts in a search box", () => {
  it("say where the count was made, without the route or the box's corners", () => {
    expect(
      plainNote(
        "the box 0.25 degrees around the county's Census internal point (-88.4466,30.4346,-87.9466,30.9346), not the whole county; no record-level URL: a count over NWS's national list of active alerts, matched to this box here; NWS has no URL for exactly this box",
      ),
    ).toBe("counted near the middle of the county (about 25 km), not the whole county; counted from NWS's national list of active alerts, inside that area; the source link opens the whole list, not this count");
    expect(plainNote("the box 0.1 degrees around the point (-97.8431,30.1672,-97.6431,30.3672); no record-level URL: a count over USGS's past-day M4.5+ feed, matched to this box here; the feed has no URL for exactly this box")).toBe(
      "counted within about 10 km of the spot you picked; counted from USGS's past-day magnitude 4.5 or larger feed, inside that area; the source link opens the whole list, not this count",
    );
    expect(plainNote("within 0.1 degrees of the point; no record-level URL: a count of the route's records inside this box; the publisher has no URL for exactly this box")).toBe(
      "within about 10 km of the spot you picked; counted inside that area; the source link opens the whole list, not this count",
    );
    // Any other box tuple is dropped too.
    expect(plainNote("matched in (-1.5,2,-3,4.25) only")).toBe("matched in only");
  });
});

// The hallway-test polish (writeups jev-2026-10-18: ASK-PANEL-PLAIN-TEXT.md, rows added 2026-10-19).
describe("words a newcomer reads", () => {
  const factsOf = (n: string) => jevSections(load(n)).flatMap((s) => s.lines.map((l) => l.fact));

  it("says where a live count was made: in this county for a county, near this place otherwise", () => {
    expect(factsOf("mobile")).toEqual(expect.arrayContaining(["Severe or Extreme NWS alerts in this county now", "magnitude 4.5 or larger earthquakes in the past day in this county"]));
    expect(factsOf("austin-pt")).toEqual(expect.arrayContaining(["Severe or Extreme NWS alerts near this place now", "magnitude 4.5 or larger earthquakes in the past day near this place"]));
    expect(factsOf("ocean")).toContain("Severe or Extreme NWS alerts near this place now");
    expect(plainFact("Severe or Extreme NWS alerts touching the box now", "county")).toBe("Severe or Extreme NWS alerts in this county now");
    expect(plainFact("Severe or Extreme NWS alerts touching the box now", "point")).toBe("Severe or Extreme NWS alerts near this place now");
    expect(plainFact("M4.5+ earthquakes in the past day touching the box")).toBe("magnitude 4.5 or larger earthquakes in the past day near this place");
  });

  it("writes a magnitude in words in notes too", () => {
    expect(plainNote("a count over USGS's past-day M4.5+ feed")).toBe("a count over USGS's past-day magnitude 4.5 or larger feed");
  });

  it("drops the aside about copying names, from a fact and from a note", () => {
    expect(plainFact("public company (by ticker; names are not copied)")).toBe("public company (by ticker)");
    expect(factsOf("austin-pt")).toContain("public company (by ticker)");
    expect(plainNote("population served 279000; labelled by PWSID, names are not copied")).toBe("population served 279000; labelled by PWSID");
  });

  it("calls the county's internal point its middle, with the distance in rough kilometres", () => {
    expect(aboutKm("0.25")).toBe("about 25 km");
    expect(aboutKm("0.1")).toBe("about 10 km");
    expect(plainNote("children; open; within 0.25 degrees of the county's Census internal point, not the whole county")).toBe("children; open; near the middle of the county (about 25 km), not the whole county");
    expect(plainNote("type: metropolitan; read at the county's Census internal point")).toBe("type: metropolitan; read at the middle of the county");
    expect(plainNote("EPA's boundary (simplified to about 50 m) contains the county's Census internal point; labelled by PWSID")).toBe("EPA's boundary (simplified to about 50 m) contains the middle of the county; labelled by PWSID");
  });

  it("centres a county's subtitle on its middle, and never names a route", () => {
    expect(placeSubtitle(load("mobile"))).toBe("county · FIPS 01097 · centred on the middle of the county");
    expect(plainBasis("the point as /api/screen publishes it")).toBe("the point as this atlas publishes it");
    expect(plainBasis("from eye's county table")).toBe("from this atlas's county table");
  });

  it("glosses the Drought Monitor's classes and ng/L on first use, inside the value", () => {
    expect(visible(panel(load("mobile")))).toContain(
      "D0 (abnormally dry) 55.72%, D1 (moderate drought) 1.42%, D2 (severe drought) 0%, D3 (extreme drought) 0%, D4 (exceptional drought) 0%",
    );
    const html = panel(load("austin-pt"));
    const shown = visible(html);
    expect(shown).toContain("8.4 ng/L (parts per trillion)");
    expect(shown.split("ng/L (parts per trillion)")).toHaveLength(2);
    expect(html).toContain('<abbr title="parts per trillion" class="no-underline">ng/L</abbr>');
    // A value's acronyms stay the publisher's words; only the terms are glossed there.
    expect(segText(new Glosser().gloss("FEMA D2 and 3 ng/L", false))).toBe("FEMA D2 (severe drought) and 3 ng/L (parts per trillion)");
    expect(TERMS.D4).toBe("exceptional drought");
  });

  it("titles a spot with no name as open water, with its point", () => {
    expect(placeTitle(load("ocean"))).toBe("Open water (30.0, -40.0)");
    expect(panel(load("ocean"))).toContain(">Open water (30.0, -40.0)</div>");
  });

  it("never writes place fabric as a gap's what", () => {
    expect(plainWhat("place fabric")).toBe("Point details");
    expect(toGap({ what: "place fabric", reason: "the fabric is per point; call world_context with lon/lat (the county's point is -88.1966, 30.6846)" }).sentence).toBe(
      "Point details: Elevation, flood zone and watershed need a spot on the map. Click inside the county.",
    );
  });

  it("says the middle of this county, not this spot, when a county has no mapped water system", () => {
    const water = jevSections(load("chugach")).find((s) => s.key === "water")!;
    expect(water.gaps.map((g) => g.sentence)).toEqual([
      "community water system serving the point: No public water system's mapped area covers the middle of this county. It may use a private well, or a system EPA hasn't mapped.",
    ]);
    expect(plainReason("water", "no EPA community water system service area contains the point: it may be served by a private well").text).toBe(
      "No public water system's mapped area covers this spot. It may use a private well, or a system EPA hasn't mapped.",
    );
  });

  it("rewrites each agent aside in a note or a publisher", () => {
    expect(plainNote("FEMA NRI December 2025; NRI's own population input, not a Census table eye reads directly")).toBe("FEMA NRI December 2025; NRI's own population input, not a Census table");
    expect(plainNote("CCN 073300, for hospital hifld-hosp:0003306106; CMS lists the hospital and publishes no overall rating for it: null, not 0")).toBe("CCN 073300; CMS lists the hospital and publishes no overall rating for it");
    expect(plainNote("-3.6% over the year; no record-level URL: Zillow publishes one CSV of every region, with no URL per region")).toBe("-3.6% over the year; Zillow publishes one CSV of every region, with no URL per region");
    expect(plainNote("approximate date; the publisher's schedule page blocks automated clients (HTTP 403 to a non-browser user agent, checked 2026-10-18)")).toBe(
      "approximate date; the publisher's schedule page blocks automated readers (checked 2026-10-18)",
    );
    expect(plainNote("Severe Storm; filed by FEMA under the former county code 02261 (the route's caveats say how that code relates to this county)")).toBe("Severe Storm; filed by FEMA under the former county code 02261");
    expect(plainPublisher("Homeland Infrastructure Foundation-Level Data, hosted by FEMA (FEMA_HQ_Preparedness_NIC)")).toBe("Homeland Infrastructure Foundation-Level Data, hosted by FEMA");
  });
});

describe("the panel when the call fails", () => {
  const RAW = ["world_context could not answer for this place", "HTTP 500: the reply was not JSON", "Internal error: upstream timeout at /api/mcp"];

  it.each(RAW)("shows one plain sentence, never the raw reason (%s)", (raw) => {
    const html = renderToStaticMarkup(<JevPanelView state={{ asked: "Mobile County, AL", status: "error", bundle: null, error: raw }} reducedMotion onClose={() => {}} />);
    const shown = visible(html);
    const err = /<div data-jev-error=""[^>]*>([\s\S]*?)<\/div>/.exec(html);
    expect(err, "the error line").not.toBeNull();
    expect(visible(err![1])).toBe(JEV_ERROR_SENTENCE);
    expect(JEV_ERROR_SENTENCE).toBe("Jev couldn't reach its sources just now. Try again in a minute.");
    expect(shown).not.toContain(raw);
    expect(shown).not.toMatch(/world_context|HTTP|JSON|error/i);
    expect([shown, ...titlesOf(html)].join("\n")).not.toContain(raw);
    // Kept for us in a data attribute (and the console, lib/jev/store.ts).
    expect(html).toContain(`data-jev-error-detail="${raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
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
    const ids = dams.map((l) => visible(/<span data-jev-id=""[^>]*>([\s\S]*?)<\/span> <span data-jev-value/.exec(l)![1]).replace(/^NID \([^)]*\)/, "NID"));
    // The recorded Mobile reply's three private dams (fixture items with a null value and an nid: code).
    expect(ids).toEqual(["NID id AL00011", "NID id MS06238", "NID id MS06239"]);
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

  it("closes on Escape and stops the event there, so the cockpit's Escape does not also fire", () => {
    const onClose = vi.fn();
    const handle = closeOnEscape(onClose);
    const esc = { key: "Escape", stopPropagation: vi.fn() };
    handle(esc);
    expect(esc.stopPropagation).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    const enter = { key: "Enter", stopPropagation: vi.fn() };
    handle(enter);
    expect(enter.stopPropagation).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
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
