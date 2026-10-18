import { describe, expect, it } from "vitest";
import type { Brief, Finding } from "@/lib/brief/types";
import { SOURCES } from "@/lib/provenance/sources";
import type { Provenance } from "@/lib/provenance/types";
import { linksFor } from "./links";
import type { PlaceFacts, SectionState } from "./facts";
import { countyByFips, type CountyRef } from "./registry";
import { parseMetroParam, parseStateParam, type PlaceScope } from "./scope";
import { breadcrumbJsonLd, briefJsonLd, placeJsonLd, serializeJsonLd } from "./jsonld";

const RETRIEVED = "2026-08-12T00:00:00.000Z";
const GENERATED = "2026-08-12T00:05:00.000Z";
const OFF: SectionState = { status: "unavailable", asOf: null, retrievedAt: RETRIEVED, reason: "not fetched" };

function countyScope(fips: string, extra: Partial<CountyRef> = {}): PlaceScope {
  const base = countyByFips(fips);
  if (!base) throw new Error(`${fips} is missing from the place manifest`);
  return { kind: "county", id: fips, ref: { ...base, ...extra }, provisional: false };
}

function facts(scope: PlaceScope, over: Partial<PlaceFacts> = {}): PlaceFacts {
  const name = scope.kind === "county" ? (scope.ref ? `${scope.ref.name}, ${scope.ref.stusab}` : `FIPS ${scope.id}`) : scope.ref.name;
  return {
    scope,
    name,
    shortName: scope.kind === "county" ? (scope.ref?.name ?? `FIPS ${scope.id}`) : scope.ref.name,
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

const PROVENANCE: Provenance[] = [
  {
    source: SOURCES["bls-qcew"],
    seriesId: "48453",
    upstreamUrl: "https://data.bls.gov/cew/data/api/2026/1/area/48453.csv",
    period: "2026-Q1",
    retrievedAt: RETRIEVED,
    kind: "published",
  },
  {
    source: SOURCES["zillow-zhvi"],
    upstreamUrl: "https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi.csv",
    period: "2026-07",
    retrievedAt: RETRIEVED,
    kind: "published",
  },
];

const travis = () =>
  facts(countyScope("48453", { cbsa: "12420" }), {
    values: { "home.latest": 452_000, "jobs.emp": 812_455 },
    periods: { current: { "home.latest": "2026-07", "jobs.emp": "2026-Q1" }, previous: {} },
    provenance: PROVENANCE,
  });

function nodesFor(f: PlaceFacts): Record<string, unknown>[] {
  return placeJsonLd(f, linksFor(f.scope)) as Record<string, unknown>[];
}

// The ethics rule as a test: places and institutions only. A schema.org Place
// accepts `address`, an Organization accepts `founder` and `employee`, and a
// RealEstateListing accepts a parcel id. None of those keys may ever appear,
// so the key set is asserted against an allowlist rather than against a
// blocklist of the fields we happen to have thought of.
const ALLOWED_KEYS = new Set([
  "@context",
  "@type",
  "@id",
  "about",
  "abstract",
  "alternateName",
  "citation",
  "containedInPlace",
  "contentUrl",
  "creator",
  "dateModified",
  "datePublished",
  "description",
  "distribution",
  "encodingFormat",
  "geo",
  "headline",
  "identifier",
  "inLanguage",
  "isAccessibleForFree",
  "isBasedOn",
  "item",
  "itemListElement",
  "latitude",
  "license",
  "longitude",
  "measurementTechnique",
  "name",
  "position",
  "propertyID",
  "publisher",
  "spatialCoverage",
  "temporalCoverage",
  "unitText",
  "url",
  "value",
  "variableMeasured",
]);

function keysOf(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const n of node) keysOf(n, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

describe("placeJsonLd", () => {
  it("emits exactly Place, Dataset and BreadcrumbList", () => {
    expect(nodesFor(travis()).map((n) => n["@type"])).toEqual(["Place", "Dataset", "BreadcrumbList"]);
  });

  it("puts the manifest centroid on the Place node and chains it up to the country", () => {
    const [place] = nodesFor(travis());
    const geo = place.geo as { "@type": string; latitude: number; longitude: number };
    expect(geo["@type"]).toBe("GeoCoordinates");
    expect(geo.latitude).toBeCloseTo(countyByFips("48453")!.lat, 5);
    expect(geo.longitude).toBeCloseTo(countyByFips("48453")!.lon, 5);

    const metro = place.containedInPlace as Record<string, unknown>;
    const state = metro.containedInPlace as Record<string, unknown>;
    const country = state.containedInPlace as Record<string, unknown>;
    expect(metro.name).toBe("Austin-Round Rock-San Marcos, TX");
    expect(state.name).toBe("Texas");
    expect(country.name).toBe("United States");
    expect(country["@type"]).toBe("Country");
    expect(place.identifier).toEqual({ "@type": "PropertyValue", propertyID: "FIPS", value: "48453" });
  });

  it("chains a county with no CBSA straight to its state", () => {
    // Blanco County, TX lies outside every CBSA in the pulled manifest.
    expect(countyByFips("48031")?.cbsa).toBeNull();
    const [place] = nodesFor(facts(countyScope("48031")));
    const state = place.containedInPlace as Record<string, unknown>;
    expect(state.name).toBe("Texas");
    expect((state.containedInPlace as Record<string, unknown>).name).toBe("United States");
  });

  it("chains a micropolitan county straight to its state too, since only metros have a page", () => {
    // Anderson County, TX: the Palestine micropolitan area, 37300.
    expect(countyByFips("48001")?.cbsa).toBe("37300");
    const [place] = nodesFor(facts(countyScope("48001")));
    const state = place.containedInPlace as Record<string, unknown>;
    expect(state.name).toBe("Texas");
  });

  it("chains a metropolitan county through its metro from the manifest alone", () => {
    const [place] = nodesFor(facts(countyScope("48453")));
    const metro = place.containedInPlace as Record<string, unknown>;
    expect(metro.name).toBe("Austin-Round Rock-San Marcos, TX");
    expect(metro.url).toBe("https://eye.jcamd.com/metro/12420");
    expect((metro.containedInPlace as Record<string, unknown>).name).toBe("Texas");
  });

  it("offers real CSV distributions with absolute URLs", () => {
    const [, dataset] = nodesFor(travis());
    const dist = dataset.distribution as Array<Record<string, string>>;
    expect(dist.length).toBeGreaterThan(0);
    for (const d of dist) {
      expect(d["@type"]).toBe("DataDownload");
      expect(d.encodingFormat).toBe("text/csv");
      expect(d.contentUrl.startsWith("https://"), d.contentUrl).toBe(true);
      expect(d.contentUrl).toContain("format=csv");
    }
    expect(dist.map((d) => d.contentUrl)).toContain("https://eye.jcamd.com/api/economy?op=sectors&fips=48453&format=csv");
    expect(dist.map((d) => d.contentUrl)).toContain("https://eye.jcamd.com/api/screen?kind=county&format=csv");
  });

  it("licenses the dataset with a string that exists in the source registry", () => {
    const licenses = new Set<string>(Object.values(SOURCES).map((s) => s.license as string));
    const [, withData] = nodesFor(travis());
    expect(licenses.has(withData.license as string)).toBe(true);
    // And with nothing fetched at all it still names a real licence rather than inventing one.
    const [, offline] = nodesFor(facts(countyScope("48453", { cbsa: "12420" })));
    expect(licenses.has(offline.license as string)).toBe(true);
    for (const based of (withData.isBasedOn as Array<Record<string, string>>) ?? []) {
      expect(licenses.has(based.license), based.name).toBe(true);
      expect(based.url.startsWith("https://"), based.url).toBe(true);
    }
  });

  it("covers the periods it actually loaded and nothing else", () => {
    const [, dataset] = nodesFor(travis());
    expect(dataset.temporalCoverage).toBe("2026-01/2026-07");
    const [, bare] = nodesFor(facts(countyScope("48453", { cbsa: "12420" })));
    expect(bare.temporalCoverage).toBeUndefined();
  });

  it("states the measured variables it has values for", () => {
    const [, dataset] = nodesFor(travis());
    const vars = dataset.variableMeasured as Array<Record<string, unknown>>;
    expect(vars.map((v) => v.name)).toEqual(["typical home value", "covered employment"]);
    expect(vars[0].value).toBe(452_000);
  });

  it("numbers the breadcrumb and makes every item absolute", () => {
    const [, , crumbs] = nodesFor(travis());
    const items = crumbs.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(items[3].item).toBe("https://eye.jcamd.com/place/48453");
    for (const i of items) expect(String(i.item).startsWith("https://"), String(i.item)).toBe(true);
  });

  it("works for a metro and for a state", () => {
    for (const scope of [parseMetroParam("12420")!, parseStateParam("TX")!]) {
      const nodes = nodesFor(facts(scope));
      expect(nodes.map((n) => n["@type"])).toEqual(["Place", "Dataset", "BreadcrumbList"]);
      const dist = nodes[1].distribution as Array<Record<string, string>>;
      expect(dist.length).toBeGreaterThan(0);
      for (const d of dist) expect(d.encodingFormat).toBe("text/csv");
    }
  });

  it("names no person, address or parcel anywhere in the tree", () => {
    for (const scope of [countyScope("48453", { cbsa: "12420" }), parseMetroParam("12420")!, parseStateParam("TX")!]) {
      for (const key of keysOf(nodesFor(facts(scope, { provenance: PROVENANCE })))) {
        expect(ALLOWED_KEYS.has(key), `unexpected JSON-LD key: ${key}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- briefs

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "abc123",
    kind: "threshold",
    severity: "watch",
    metric: "home.yoyPct",
    sentence: "Travis County's typical home value is -7.2% against a year earlier, a watch level here.",
    arithmetic: [],
    magnitude: 7.2,
    period: "2026-07",
    previousPeriod: null,
    citation: null,
    provenance: [],
    ...over,
  };
}

const BRIEF: Brief = {
  scopeKind: "county",
  scopeId: "48453",
  scopeName: "Travis County, TX",
  lens: null,
  headline: "Travis County, TX: 1 finding, 1 at a watch level",
  status: "watch",
  findings: [finding()],
  digest: finding({ id: "digest", kind: "gap", severity: "note", metric: "", sentence: "1 finding fired for Travis County, TX this run." }),
  coversPeriods: ["2026-07"],
  nextRelease: null,
  provenance: PROVENANCE,
  citations: ["U.S. Bureau of Labor Statistics. Quarterly Census of Employment and Wages. accessed 2026-08-12."],
  caveats: [],
  generatedAt: GENERATED,
  rulesVersion: 1,
};

describe("briefJsonLd", () => {
  it("adds a Report dated by the brief's own timestamps", () => {
    const f = travis();
    const nodes = briefJsonLd(BRIEF, f, linksFor(f.scope)) as Record<string, unknown>[];
    expect(nodes.map((n) => n["@type"])).toEqual(["Place", "Dataset", "BreadcrumbList", "Report"]);
    const report = nodes[3];
    expect(report.datePublished).toBe(GENERATED);
    expect(report.dateModified).toBe(GENERATED);
    expect(report.url).toBe("https://eye.jcamd.com/place/48453/brief");
    expect(report.about).toEqual({ "@id": "https://eye.jcamd.com/place/48453#place" });
    expect(report.abstract).toBe(BRIEF.digest.sentence);
  });

  it("keeps the ethics allowlist with a brief attached", () => {
    const f = travis();
    for (const key of keysOf(briefJsonLd(BRIEF, f, linksFor(f.scope)))) {
      expect(ALLOWED_KEYS.has(key), `unexpected JSON-LD key: ${key}`).toBe(true);
    }
  });
});

describe("serializeJsonLd", () => {
  it("leaves no raw less-than character for a script tag to trip on", () => {
    const hostile = [{ "@type": "Place", name: "</script><script>alert(1)</script>" }];
    const text = serializeJsonLd(hostile);
    expect(text).not.toContain("<");
    expect(text).toContain("\\u003c");
  });

  it("round-trips back to the same nodes", () => {
    const f = travis();
    const nodes = briefJsonLd(BRIEF, f, linksFor(f.scope));
    expect(JSON.parse(serializeJsonLd(nodes))).toEqual(JSON.parse(JSON.stringify(nodes)));
    expect(serializeJsonLd(nodes)).not.toContain("<");
  });

  it("serialises a breadcrumb on its own", () => {
    const crumbs = breadcrumbJsonLd([{ name: "United States", url: "/state" }]);
    expect(JSON.parse(serializeJsonLd([crumbs]))).toEqual([
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [{ "@type": "ListItem", position: 1, name: "United States", item: "https://eye.jcamd.com/state" }],
      },
    ]);
  });
});
