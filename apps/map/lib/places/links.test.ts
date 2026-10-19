import { describe, expect, it } from "vitest";
import { MANIFEST, countyByFips, type CountyRef } from "./registry";
import { parseComparePair, parseCountyParam, parseMetroParam, parseStateParam, type PlaceScope } from "./scope";
import { SAME_STATE_MAX, graphCompleteness, linksFor, type LinkSets, type PlaceLink } from "./links";

// Most of these tests pin a ref by hand (Travis with a single neighbour) so
// the assertions do not move when the Census republishes adjacency; the
// "pulled manifest" tests below read the real tables instead.
function withRef(fips: string, extra: Partial<CountyRef>): PlaceScope {
  const base = countyByFips(fips);
  if (!base) throw new Error(`${fips} is missing from the place manifest`);
  return { kind: "county", id: fips, ref: { ...base, ...extra }, provisional: false };
}

const travis = () => withRef("48453", { cbsa: "12420", adj: ["48491"] });

function allLinks(l: LinkSets): PlaceLink[] {
  return [...l.up, ...l.neighbours, ...l.sameState, ...l.sameMetro, ...l.compare, l.brief];
}

describe("linksFor, county", () => {
  it("builds a four-step breadcrumb ending at the county, every url site-relative", () => {
    const l = linksFor(travis());
    expect(l.breadcrumb.map((b) => b.name)).toEqual(["United States", "Texas", "Austin-Round Rock-San Marcos, TX", "Travis County"]);
    expect(l.breadcrumb).toHaveLength(4);
    expect(l.breadcrumb[l.breadcrumb.length - 1].url).toBe("/place/48453");
    for (const step of l.breadcrumb) expect(step.url.startsWith("/"), step.url).toBe(true);
  });

  it("links up to the metro and the state, and never emits a lens brief", () => {
    const l = linksFor(travis());
    expect(l.up.map((u) => u.href)).toContain("/metro/12420");
    expect(l.up.map((u) => u.href)).toContain("/state/TX");
    expect(l.brief.href).toBe("/place/48453/brief");
    expect(l.feeds).toEqual({ rss: "/place/48453/feed.xml", json: "/place/48453/feed.json" });
    for (const link of allLinks(l)) {
      expect(link.href.startsWith("/"), link.href).toBe(true);
      // /place/48453/brief is legal; /place/48453/brief/housing never is.
      expect(/\/brief\/[^/]+$/.test(link.href), link.href).toBe(false);
    }
  });

  it("excludes neighbours from the in-state list so no county is linked twice", () => {
    const l = linksFor(travis());
    expect(l.neighbours.map((n) => n.href)).toEqual(["/place/48491"]);
    const state = l.sameState.map((s) => s.href);
    expect(state).not.toContain("/place/48491");
    expect(state).not.toContain("/place/48453");
    expect(new Set(state).size).toBe(state.length);
  });

  it("caps the in-state list and orders it by the ranked map when one is supplied", () => {
    const ranked = new Map([
      ["48201", 2_400_000],
      ["48113", 1_700_000],
      ["48029", 900_000],
      ["48439", 1_100_000],
    ]);
    const l = linksFor(travis(), { ranked });
    expect(l.sameState.length).toBeLessThanOrEqual(SAME_STATE_MAX);
    expect(l.sameState.slice(0, 4).map((s) => s.href)).toEqual(["/place/48201", "/place/48113", "/place/48439", "/place/48029"]);
    expect(linksFor(travis(), { ranked, max: 2 }).sameState).toHaveLength(2);
  });

  it("falls back to manifest order when there is no ranking, so the block never disappears", () => {
    const l = linksFor(travis());
    expect(l.sameState.length).toBeGreaterThan(0);
    const labels = l.sameState.map((s) => s.label);
    expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(labels);
  });

  it("emits a compare link per neighbour that parses back through parseComparePair", () => {
    const l = linksFor(travis());
    expect(l.compare.length).toBeGreaterThan(0);
    for (const c of l.compare) {
      const pair = c.href.replace("/compare/", "");
      const parsed = parseComparePair(pair);
      expect(parsed, c.href).not.toBeNull();
      expect(parsed?.[0].id).toBe("48453");
    }
  });

  it("404s a code the complete manifest cannot name, and still links a provisional scope", () => {
    // 48999 is structurally valid, with a known state prefix, and names no
    // county: with the pulled manifest that is an exact 404, not a guess.
    expect(MANIFEST.countiesComplete).toBe(true);
    expect(parseCountyParam("48999")).toBeNull();
    // A provisional scope can still be built by hand (and by any build that
    // ships an incomplete table), and its link block must stay usable.
    const scope: PlaceScope = { kind: "county", id: "48999", ref: null, provisional: true };
    const l = linksFor(scope);
    expect(l.neighbours).toEqual([]);
    expect(l.sameMetro).toEqual([]);
    expect(l.sameState.length).toBeGreaterThan(0);
    expect(l.up.map((u) => u.href)).toContain("/state/TX");
    expect(l.brief.href).toBe("/place/48999/brief");
    expect(l.breadcrumb[l.breadcrumb.length - 1].url).toBe("/place/48999");
  });

  it("fills the neighbour and metro groups from the pulled manifest, each county in one group only", () => {
    const travisL = linksFor(parseCountyParam("48453")!);
    expect(travisL.neighbours.map((n) => n.href).sort()).toEqual(["/place/48021", "/place/48031", "/place/48053", "/place/48055", "/place/48209", "/place/48491"]);
    expect(travisL.up.map((u) => u.href)).toContain("/metro/12420");
    expect(travisL.breadcrumb.map((b) => b.name)).toEqual(["United States", "Texas", "Austin-Round Rock-San Marcos, TX", "Travis County"]);
    // Every other Austin county borders Travis, so all of them are claimed by
    // the neighbour group and the metro group has nothing left to list.
    expect(travisL.sameMetro).toEqual([]);

    // Caldwell borders Bastrop, Hays and Travis but not Williamson.
    const caldwell = linksFor(parseCountyParam("48055")!);
    expect(caldwell.sameMetro.map((m) => m.href)).toEqual(["/place/48491"]);
    const listed = [...caldwell.neighbours, ...caldwell.sameMetro, ...caldwell.sameState].map((x) => x.href);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).not.toContain("/place/48055");

    expect(graphCompleteness().adjacency).toBe(true);
    expect(graphCompleteness().membership).toBe(true);
    expect(graphCompleteness().note).toMatch(/manifest pull/);
  });

  it("gives a micropolitan county no metro link, because only metros have a page", () => {
    // Anderson County, TX: the Palestine micropolitan area, 37300.
    const l = linksFor(parseCountyParam("48001")!);
    expect(l.up.map((u) => u.href).some((h) => h.startsWith("/metro/"))).toBe(false);
    expect(l.sameMetro).toEqual([]);
    expect(l.breadcrumb.map((b) => b.name)).toEqual(["United States", "Texas", "Anderson County"]);
    expect(l.neighbours.length).toBeGreaterThan(0);
  });
});

describe("linksFor, metro and state", () => {
  it("gives a metro its state, its briefs and compare pairs that parse", () => {
    const l = linksFor(parseMetroParam("12420")!);
    expect(l.breadcrumb.map((b) => b.name)).toEqual(["United States", "Texas", "Austin-Round Rock-San Marcos, TX"]);
    expect(l.up.map((u) => u.href)).toContain("/state/TX");
    expect(l.brief.href).toBe("/metro/12420/brief");
    expect(l.sameState.length).toBeGreaterThan(0);
    expect(l.sameState.length).toBeLessThanOrEqual(SAME_STATE_MAX);
    for (const c of l.compare) {
      expect(c.href.startsWith("/compare/metro.12420-vs-metro."), c.href).toBe(true);
      expect(parseComparePair(c.href.replace("/compare/", "")), c.href).not.toBeNull();
      // A colon in a path segment never reaches the page: the router 404s
      // first, so a link carrying one is dead on arrival however well it parses.
      expect(c.href.includes(":"), c.href).toBe(false);
    }
  });

  it("gives a state its counties, its metros and a two-step breadcrumb", () => {
    const l = linksFor(parseStateParam("tx")!);
    expect(l.breadcrumb).toHaveLength(2);
    expect(l.breadcrumb[1].url).toBe("/state/TX");
    expect(l.up.map((u) => u.href)).toEqual(["/state"]);
    expect(l.sameState.length).toBeGreaterThan(0);
    expect(l.sameMetro.length).toBeGreaterThan(0);
    expect(l.sameMetro.every((m) => m.href.startsWith("/metro/"))).toBe(true);
    for (const c of l.compare) expect(parseComparePair(c.href.replace("/compare/", "")), c.href).not.toBeNull();
    expect(l.feeds.rss).toBe("/state/TX/feed.xml");
  });
});
