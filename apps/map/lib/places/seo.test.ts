import { describe, expect, it } from "vitest";
import type { Brief, Finding } from "@/lib/brief/types";
import type { PlaceFacts, SectionState } from "./facts";
import type { PeerStat } from "./percentiles";
import { countyByFips, type CountyRef } from "./registry";
import { parseCountyParam, parseMetroParam, parseStateParam, type PlaceScope } from "./scope";
import { META_MAX, TITLE_MAX, briefSeo, canonicalOf, metaDescription, placeSeo } from "./seo";

const RETRIEVED = "2026-08-12T00:00:00.000Z";
const GENERATED = "2026-08-12T00:05:00.000Z";

const OFF: SectionState = { status: "unavailable", asOf: null, retrievedAt: RETRIEVED, reason: "not fetched" };

function peer(p: Partial<PeerStat>): PeerStat {
  return {
    value: null,
    pct: null,
    rank: null,
    n: 0,
    min: null,
    p25: null,
    median: null,
    p75: null,
    max: null,
    cohortKey: "county:us",
    cohortLabel: "US counties",
    ...p,
  };
}

/** A county scope from the manifest, with any field overridden by hand. */
function countyScope(fips: string, extra: Partial<CountyRef> = {}): PlaceScope {
  const base = countyByFips(fips);
  if (!base) throw new Error(`${fips} is missing from the place manifest`);
  return { kind: "county", id: fips, ref: { ...base, ...extra }, provisional: false };
}

/** A complete PlaceFacts with every fetched section switched off; the tests fill only what they assert on. */
function facts(scope: PlaceScope, over: Partial<PlaceFacts> = {}): PlaceFacts {
  const name =
    scope.kind === "county" ? (scope.ref ? `${scope.ref.name}, ${scope.ref.stusab}` : `FIPS ${scope.id}`) : scope.ref.name;
  const shortName = scope.kind === "county" ? (scope.ref?.name ?? `FIPS ${scope.id}`) : scope.kind === "state" ? scope.ref.name : scope.ref.name;
  return {
    scope,
    name,
    shortName,
    generatedAt: GENERATED,
    retrievedAt: RETRIEVED,
    lon: scope.kind === "county" ? (scope.ref?.lon ?? null) : scope.ref.lon,
    lat: scope.kind === "county" ? (scope.ref?.lat ?? null) : scope.ref.lat,
    market: { report: null, state: OFF },
    water: { report: null, state: OFF },
    finance: { section: null, state: OFF },
    spending: { detail: null, state: OFF },
    companies: { section: null, state: OFF },
    occupations: { jobs: null, asOf: "May 2025", state: OFF },
    rollup: null,
    housing: null,
    members: null,
    values: {},
    previous: {},
    periods: { current: {}, previous: {} },
    suppressed: [],
    skipped: [],
    peers: {},
    indicators: { items: [], state: OFF },
    releases: [],
    metricProvenance: {},
    provenance: [],
    citations: [],
    caveats: [],
    ...over,
  };
}

// ---------------------------------------------------------------- the four branches

const travisWithMetro = () => countyScope("48453", { cbsa: "12420" });

/** 1. A rule fired: the title leads with the number, the direction and the period. */
const thresholdFacts = () =>
  facts(travisWithMetro(), {
    values: { "home.yoyPct": -7.2 },
    periods: { current: { "home.yoyPct": "2026-07" }, previous: {} },
  });

/** 2. No rule fired, but the county sits in a decile of a named cohort. */
const percentileFacts = () =>
  facts(travisWithMetro(), {
    values: { "home.latest": 452_000 },
    periods: { current: { "home.latest": "2026-07" }, previous: {} },
    peers: {
      "home.latest": [peer({ value: 452_000, pct: 92, rank: 21, n: 254, median: 240_000, cohortKey: "county:state:TX", cohortLabel: "Texas counties" })],
    },
  });

/** 3. Nothing published, but the bundled OEWS index knows what the metro does. */
const occupationFacts = () => facts(travisWithMetro());

/**
 * 4. Not even a metro: identity and what the page covers. Blanco County, TX
 * lies outside every CBSA in the pulled manifest, so no fallback can find a
 * metro for it. A cbsa:null override on Travis no longer means "no metro",
 * because the manifest itself now puts Travis in 12420.
 */
const offlineFacts = () => facts(countyScope("48031"));

describe("placeSeo priority order", () => {
  it("leads with a triggered threshold when one fired", () => {
    const seo = placeSeo(thresholdFacts());
    expect(seo.branch).toBe("threshold");
    expect(seo.title).toBe("Travis County, TX: typical home value fell 7.2% from a year earlier");
  });

  it("falls to a decile percentile when no rule fired", () => {
    const seo = placeSeo(percentileFacts());
    expect(seo.branch).toBe("percentile");
    expect(seo.title).toBe("Travis County, TX: typical home value in the top 8% of Texas counties");
  });

  it("falls to the metro's distinctive occupation when there is no rank either", () => {
    const seo = placeSeo(occupationFacts());
    expect(seo.branch).toBe("occupation");
    expect(seo.title).toBe("Travis County, TX — an Austin metro economy led by computer and mathematical work");
  });

  it("falls to identity and coverage when the page has nothing else, and spells the state out", () => {
    const seo = placeSeo(offlineFacts());
    expect(seo.branch).toBe("offline");
    expect(seo.title).toBe("Blanco County, Texas — housing, jobs, water and federal spending");
  });

  it("treats a micropolitan county as not a metro, even though it carries a CBSA code", () => {
    // Anderson County, TX is in the Palestine micropolitan area (37300): a
    // real CBSA with no OEWS table and no metro page.
    const anderson = countyScope("48001");
    expect(anderson.kind === "county" && anderson.ref?.cbsa).toBe("37300");
    const seo = placeSeo(facts(anderson));
    expect(seo.branch).toBe("offline");
    expect(seo.title).toBe("Anderson County, Texas — housing, jobs, water and federal spending");
  });

  it("gives every branch a title inside the length cap and never an empty one", () => {
    for (const f of [thresholdFacts(), percentileFacts(), occupationFacts(), offlineFacts()]) {
      const seo = placeSeo(f);
      expect(seo.title.length).toBeGreaterThan(10);
      expect(seo.title.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(seo.index).toBe(true);
    }
  });

  it("titles a metro and a state without a county's machinery", () => {
    expect(placeSeo(facts(parseMetroParam("12420")!)).title).toContain("Austin-Round Rock-San Marcos, TX");
    const state = placeSeo(facts(parseStateParam("TX")!));
    expect(state.branch).toBe("offline");
    expect(state.title).toBe("Texas — housing, jobs and federal spending");
  });
});

describe("placeSeo distinguishes neighbours", () => {
  it("gives two counties of the same metro different titles when their numbers differ", () => {
    // Same metro, so branch 3 would say exactly the same thing about both.
    const a = placeSeo(facts(countyScope("48453", { cbsa: "12420" }), { values: { "home.yoyPct": -7.2 }, periods: { current: { "home.yoyPct": "2026-07" }, previous: {} } }));
    const b = placeSeo(
      facts(countyScope("48491", { cbsa: "12420" }), {
        values: { "home.latest": 380_000 },
        periods: { current: { "home.latest": "2026-07" }, previous: {} },
        peers: { "home.latest": [peer({ value: 380_000, pct: 4, rank: 244, n: 254, cohortKey: "county:state:TX", cohortLabel: "Texas counties" })] },
      }),
    );
    expect(a.title).not.toBe(b.title);
    expect(a.branch).toBe("threshold");
    expect(b.branch).toBe("percentile");
    expect(b.title).toContain("bottom 4% of Texas counties");
  });

  it("gives the same metro's counties the same occupation clause only when nothing else applies", () => {
    const a = placeSeo(facts(countyScope("48453", { cbsa: "12420" })));
    const b = placeSeo(facts(countyScope("48491", { cbsa: "12420" })));
    expect(a.branch).toBe("occupation");
    expect(b.branch).toBe("occupation");
    expect(a.title).not.toBe(b.title);
    expect(a.title.endsWith("computer and mathematical work")).toBe(true);
  });
});

describe("metaDescription", () => {
  const long = [
    "Travis County's typical home value fell 7.2% from $487,000 in July 2025 to $452,000 in July 2026, on Zillow ZHVI.",
    "Travis County's typical asking rent rose 3.4% from $1,580 in June 2026 to $1,634 in July 2026, on Zillow ZORI.",
    "Travis County's covered employment of 812,455 ranks 12th of 3,088 US counties, against a median of 24,110.",
  ];

  it("never exceeds the budget and never ends inside a number", () => {
    for (const max of [40, 60, 90, META_MAX, 200]) {
      const d = metaDescription(long, max);
      expect(d.length, `max ${max}`).toBeLessThanOrEqual(max);
      expect(d, `max ${max}`).toMatch(/[A-Za-z.]$/);
    }
  });

  it("takes whole sentences when they fit and only clips a first sentence that cannot", () => {
    expect(metaDescription(long, 200)).toBe(long[0]);
    expect(metaDescription(long, 300)).toBe(`${long[0]} ${long[1]}`);
    expect(metaDescription(long, 400)).toBe(long.join(" "));
    const clipped = metaDescription(long, 60);
    expect(long[0].startsWith(clipped)).toBe(true);
    expect(clipped).not.toMatch(/\$[\d,]*$/);
  });

  it("refuses to advertise an outage or a placeholder", () => {
    const d = metaDescription([
      "The market report is unavailable: BLS QCEW did not answer within 8000 ms.",
      "Travis County's typical home value of not published carries no rank.",
      "Travis County's covered employment of 812,455 ranks 12th of 3,088 US counties.",
    ]);
    expect(d).toBe("Travis County's covered employment of 812,455 ranks 12th of 3,088 US counties.");
    expect(d.toLowerCase()).not.toContain("unavailable");
  });

  it("keeps a place description free of the word on every branch", () => {
    for (const f of [thresholdFacts(), percentileFacts(), occupationFacts(), offlineFacts()]) {
      const seo = placeSeo(f);
      expect(seo.description.length).toBeGreaterThan(20);
      expect(seo.description.length).toBeLessThanOrEqual(META_MAX);
      expect(seo.description.toLowerCase()).not.toContain("unavailable");
      expect(seo.description).toMatch(/[A-Za-z.]$/);
      expect(seo.ogDescription.length).toBeGreaterThanOrEqual(seo.description.length);
    }
  });

  it("puts real numbers in the description when the page has them", () => {
    expect(placeSeo(thresholdFacts()).description).toContain("-7.2%");
  });
});

// ---------------------------------------------------------------- canonicals

describe("canonicalOf", () => {
  it("returns an absolute https URL for a page and for a brief", () => {
    const scope = parseCountyParam("48453")!;
    expect(canonicalOf(scope, "page")).toBe("https://eye.jcamd.com/place/48453");
    expect(canonicalOf(scope, "brief")).toBe("https://eye.jcamd.com/place/48453/brief");
    expect(canonicalOf(parseMetroParam("12420")!, "page")).toBe("https://eye.jcamd.com/metro/12420");
    expect(canonicalOf(parseStateParam("tx")!, "brief")).toBe("https://eye.jcamd.com/state/TX/brief");
    for (const url of [canonicalOf(scope, "page"), canonicalOf(scope, "brief")]) expect(url.startsWith("https://")).toBe(true);
  });

  it("throws rather than canonicalising a lens brief or a compare page", () => {
    const scope = parseCountyParam("48453")!;
    expect(() => canonicalOf(scope, "lens")).toThrow(/never a canonical target/);
    expect(() => canonicalOf(scope, "compare")).toThrow(/never a canonical target/);
  });
});

// ---------------------------------------------------------------- briefs

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "abc123",
    kind: "threshold",
    severity: "watch",
    metric: "home.yoyPct",
    sentence: "Travis County's typical home value is -7.2% against a year earlier, an alert level here.",
    arithmetic: [],
    magnitude: 7.2,
    period: "2026-07",
    previousPeriod: null,
    citation: "arithmetic on Zillow ZHVI",
    provenance: [],
    ...over,
  };
}

function brief(over: Partial<Brief> = {}): Brief {
  const digest = finding({ id: "digest", kind: "gap", severity: "note", metric: "", sentence: "No rule fired for Travis County this run, against a typical home value of $452,000 in July 2026." });
  return {
    scopeKind: "county",
    scopeId: "48453",
    scopeName: "Travis County, TX",
    lens: null,
    headline: "Travis County, TX: nothing crossed a line this run",
    status: "ok",
    findings: [],
    digest,
    coversPeriods: [],
    nextRelease: null,
    provenance: [],
    citations: [],
    caveats: [],
    generatedAt: GENERATED,
    rulesVersion: 1,
    ...over,
  };
}

describe("briefSeo", () => {
  it("flags a zero-finding brief for noindex and says so in the title", () => {
    const seo = briefSeo(brief(), occupationFacts());
    expect(seo.index).toBe(false);
    expect(seo.title).toBe("Travis County, TX brief: nothing crossed a line this run");
    expect(seo.description).toContain("$452,000");
  });

  it("is indexable and specific once a rule has fired", () => {
    const f = thresholdFacts();
    const seo = briefSeo(
      brief({
        findings: [finding()],
        headline: "Travis County, TX: 1 finding, 1 at a watch level",
        status: "watch",
      }),
      f,
    );
    expect(seo.index).toBe(true);
    expect(seo.title).toBe("Travis County, TX brief: typical home value fell 7.2% from a year earlier");
    expect(seo.title.length).toBeLessThanOrEqual(TITLE_MAX);
  });

  it("names the lens when there is one, and still never exceeds the caps", () => {
    const seo = briefSeo(brief({ lens: "housing", findings: [finding()] }), occupationFacts());
    expect(seo.title).toContain("(housing lens)");
    expect(seo.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(seo.description.length).toBeLessThanOrEqual(META_MAX);
  });
});
