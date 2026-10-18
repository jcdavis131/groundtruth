import { describe, expect, it } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import { fabricFeatures, strataPosition, strataStep } from "@/lib/layers/constructs";
import { countryAt, identifyUrl, inUsReach, TIGER_URL } from "./fetch";
import { ringsContain, roundRings } from "./geo";
import { assembleFabric, fabricRows, sortStack } from "./graph";
import { joinInside } from "./join";
import { federalNodes, parseEcoregions, parseElevation, parseNfhl, parseNws, parseTiger, parseWbd, type IdentifyResponse } from "./parse";
import { fedDistrict } from "./regions";

// Attributes as the services answered for 30.27 N, 97.74 W (downtown Austin), trimmed.
const TIGER: IdentifyResponse = {
  results: [
    { layerId: 8, attributes: { GEOID: "48453001101", NAME: "Census Tract 11.01", BASENAME: "11.01", AREALAND: "1144730", INTPTLAT: "+30.2711103", INTPTLON: "-097.7424793" } },
    { layerId: 14, attributes: { GEOID: "4808940", NAME: "Austin Independent School District", AREALAND: "592444352", FUNCSTAT: "E" } },
    { layerId: 28, attributes: { GEOID: "4805000", NAME: "Austin city", BASENAME: "Austin", AREALAND: "841154563", FUNCSTAT: "A" } },
    { layerId: 54, attributes: { GEOID: "4810", NAME: "Congressional District 10", BASENAME: "10", AREALAND: "22660297989" } },
    { layerId: 56, attributes: { GEOID: "48014", NAME: "State Senate District 14", AREALAND: "1333781950" } },
    { layerId: 60, attributes: { GEOID: "7", NAME: "West South Central Division", AREALAND: "1100925237701" } },
    { layerId: 62, attributes: { GEOID: "3", NAME: "South Region", AREALAND: "2249831112956" } },
    { layerId: 80, attributes: { GEOID: "48", NAME: "Texas", AREALAND: "676658961621", FUNCSTAT: "A" } },
    {
      layerId: 82,
      attributes: { GEOID: "48453", NAME: "Travis County", AREALAND: "2575354868", FUNCSTAT: "A", INTPTLAT: "+30.2395263", INTPTLON: "-097.6910527" },
      geometry: { rings: [[[-98.2, 30.0], [-97.3, 30.0], [-97.3, 30.6], [-98.2, 30.6], [-98.2, 30.0]]] },
    },
    { layerId: 93, attributes: { GEOID: "12420", NAME: "Austin-Round Rock-San Marcos, TX Metro Area", AREALAND: "10929370942" } },
    { layerId: 999, attributes: { GEOID: "x", NAME: "unknown layer" } },
  ],
};

const WBD: IdentifyResponse = {
  results: [
    { layerId: 1, attributes: { AreaSqKm: "474542.91", States: "LA,NM,TX", HUC2: "12", Name: "Texas-Gulf Region" } },
    { layerId: 3, attributes: { AREASQKM: "21387.55", STATES: "TX", HUC6: "120902", NAME: "Middle Colorado-Llano" } },
    { layerId: 4, attributes: { AreaSqKm: "3213.91", States: "TX", HUC8: "12090205", Name: "Austin-Travis Lakes" } },
    { layerId: 5, attributes: { AreaSqKm: "848.77", HUC10: "1209020503", Name: "City of Austin-Colorado River", HUType: "Standard" } },
    { layerId: 6, attributes: { AreaSqKm: "129.65", HUC12: "120902050306", Name: "Town Lake-Colorado River", HUType: "Standard", ToHUC: "120902050307" } },
  ],
};

const ECO: IdentifyResponse = {
  results: [
    { layerId: 7, attributes: { US_L4CODE: "32a", US_L4NAME: "Northern Blackland Prairie", US_L3CODE: "32", US_L3NAME: "Texas Blackland Prairies", NA_L2CODE: "9.4", NA_L2NAME: "SOUTH CENTRAL SEMI-ARID PRAIRIES", NA_L1CODE: "9", NA_L1NAME: "GREAT PLAINS" } },
    { layerId: 11, attributes: { US_L3CODE: "32", US_L3NAME: "Texas Blackland Prairies", NA_L1CODE: "9", NA_L1NAME: "GREAT PLAINS" } },
  ],
};

const NFHL: IdentifyResponse = {
  results: [
    { layerId: 28, attributes: { DFIRM_ID: "48453C", FLD_AR_ID: "48453C_1693", FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F", STATIC_BFE: "-9999", DEPTH: "-9999", LEN_UNIT: "" } },
    { layerId: 22, attributes: { POL_NAME1: "City Of Austin", CID: "480624" } },
    { layerId: 3, attributes: { FIRM_PAN: "48453C0465K", EFF_DATE: "1/6/2016" } },
  ],
};

const NWS_POINTS = {
  properties: {
    cwa: "EWX",
    forecastZone: "https://api.weather.gov/zones/forecast/TXZ192",
    county: "https://api.weather.gov/zones/county/TXC453",
    fireWeatherZone: "https://api.weather.gov/zones/fire/TXZ192",
    timeZone: "America/Chicago",
    radarStation: "KGRK",
    gridId: "EWX",
    gridX: 156,
    gridY: 91,
  },
};

describe("parseTiger", () => {
  const nodes = parseTiger(TIGER);
  const by = (id: string) => nodes.find((n) => n.id === id);
  it("maps layers to constructs and skips layers it does not know", () => {
    expect(nodes.map((n) => n.kind)).toEqual(["tract", "school", "place", "cd", "sldu", "census-division", "census-region", "state", "county", "cbsa"]);
  });
  it("names districts the way people say them", () => {
    expect(by("cd:4810")?.name).toBe("TX-10");
    expect(by("sldu:48014")?.name).toBe("Texas State Senate District 14");
    expect(by("county:48453")?.name).toBe("Travis County, TX");
  });
  it("keeps land area in km² and the internal point", () => {
    expect(by("county:48453")?.areaKm2).toBeCloseTo(2575.35, 1);
    expect(by("county:48453")?.areaBasis).toBe("land");
    expect(by("county:48453")?.anchor).toEqual([-97.6910527, 30.2395263]);
    expect(by("county:48453")?.rings?.[0].length).toBe(5);
  });
  it("links states to their page and gives school districts a layer-scoped id", () => {
    expect(by("state:48")?.links).toContainEqual({ label: "State page", url: "/state/TX" });
    expect(by("school:14-4808940")?.facts.type).toBe("unified");
    expect(by("cbsa:12420")?.facts.type).toBe("metropolitan");
  });
});

describe("parseWbd", () => {
  const { nodes, edges } = parseWbd(WBD);
  it("reads HUC codes whatever the attribute case", () => {
    expect(nodes.map((n) => n.id)).toEqual(["huc2:12", "huc6:120902", "huc8:12090205", "huc10:1209020503", "huc12:120902050306"]);
    expect(nodes[1].areaKm2).toBe(21387.55);
    expect(nodes[0].areaBasis).toBe("total");
  });
  it("turns ToHUC into an external drains-to edge", () => {
    expect(edges).toEqual([{ from: "huc12:120902050306", to: "huc12:120902050307", relation: "drains-to", basis: "USGS WBD ToHUC", external: true }]);
  });
  it("keeps a terminal ToHUC as a fact, not an edge", () => {
    const r = parseWbd({ results: [{ layerId: 6, attributes: { HUC12: "120902050399", Name: "Coast", ToHUC: "OCEAN" } }] });
    expect(r.edges).toEqual([]);
    expect(r.nodes[0].facts["drains to"]).toBe("ocean");
  });
});

describe("parseEcoregions, parseNfhl, parseNws, parseElevation", () => {
  it("reads level IV and III ecoregions with the continental levels as facts", () => {
    const e = parseEcoregions(ECO);
    expect(e.map((n) => n.id)).toEqual(["eco4:32a", "eco3:32"]);
    expect(e[0].facts["level I"]).toBe("9 Great Plains");
  });
  it("drops FEMA sentinels and reads the zone, the community and the panel", () => {
    const f = parseNfhl(NFHL);
    const zone = f.find((n) => n.kind === "flood")!;
    expect(zone.name).toBe("Flood zone X");
    expect(zone.facts["special flood hazard area"]).toBe("no");
    expect(zone.facts["base flood elevation"]).toBeUndefined();
    expect(zone.facts["FIRM panel"]).toBe("48453C0465K");
    expect(f.find((n) => n.kind === "flood-community")?.name).toBe("City Of Austin");
  });
  it("reads the NWS office, zone and time zone and links zone to office", () => {
    const r = parseNws(NWS_POINTS, -97.74, 30.27, { properties: { name: "Travis" } }, { name: "Austin/San Antonio, TX" });
    expect(r.nodes.map((n) => n.id)).toEqual(["nws-office:EWX", "nws-zone:TXZ192", "timezone:America/Chicago"]);
    expect(r.nodes[0].name).toBe("NWS Austin/San Antonio, TX");
    expect(r.nodes[1].name).toBe("Travis (TXZ192)");
    expect(r.edges[0]).toMatchObject({ from: "nws-zone:TXZ192", to: "nws-office:EWX", relation: "assigned-to" });
  });
  it("treats the EPQS no-data value as missing", () => {
    expect(parseElevation({ value: "159.881988525" })).toBe(159.9);
    expect(parseElevation({ value: -1000000 })).toBeUndefined();
    expect(parseElevation(null)).toBeUndefined();
  });
});

describe("federal regions", () => {
  it("assigns Texas to EPA 6, FEMA VI and the Dallas Fed", () => {
    const r = federalNodes("48");
    expect(r.nodes.map((n) => n.name)).toEqual(["EPA Region 6 (Dallas)", "FEMA Region VI (Denton)", "Fed district 11 (Dallas)"]);
    expect(r.edges).toHaveLength(3);
  });
  it("names both districts for a split state and claims no edge", () => {
    expect(fedDistrict("IL")).toMatchObject({ split: true });
    const r = federalNodes("17");
    const fed = r.nodes.find((n) => n.kind === "fed-district")!;
    expect(fed.name).toContain("or 8");
    expect(r.edges.some((e) => e.to === fed.id)).toBe(false);
  });
});

describe("assembleFabric", () => {
  const nodes = [...parseTiger(TIGER), ...parseWbd(WBD).nodes, ...parseEcoregions(ECO), ...parseNfhl(NFHL), ...federalNodes("48").nodes];
  const f = assembleFabric({ lon: -97.74, lat: 30.27, elevationM: 159.9, nodes: [...nodes, nodes[0]], edges: [...parseWbd(WBD).edges, ...federalNodes("48").edges], answered: ["census-tigerweb", "census-tigerweb", "usgs-wbd"], failed: [] });
  it("orders the stack from the smallest construct to the largest and drops duplicates", () => {
    expect(f.nodes[0].kind).toBe("flood");
    expect(f.nodes.at(-1)?.kind).toBe("census-region");
    expect(new Set(f.nodes.map((n) => n.id)).size).toBe(f.nodes.length);
    expect(f.answered).toEqual(["census-tigerweb", "usgs-wbd"]);
    const areas = f.nodes.filter((n) => n.areaKm2 != null).map((n) => n.areaKm2!);
    expect([...areas].sort((a, b) => a - b)).toEqual(areas);
  });
  it("links only what the unit systems define", () => {
    const has = (from: string, to: string) => f.edges.some((e) => e.from === from && e.to === to && e.relation === "nests-in");
    expect(has("tract:48453001101", "county:48453")).toBe(true);
    expect(has("county:48453", "state:48")).toBe(true);
    expect(has("cd:4810", "state:48")).toBe(true);
    expect(has("state:48", "census-division:7")).toBe(true);
    expect(has("census-division:7", "census-region:3")).toBe(true);
    expect(has("huc12:120902050306", "huc10:1209020503")).toBe(true);
    expect(has("huc8:12090205", "huc6:120902")).toBe(true);
    // No HUC-4 in the answer, so HUC-6 claims no parent.
    expect(f.edges.some((e) => e.from === "huc6:120902" && e.relation === "nests-in")).toBe(false);
    expect(has("eco4:32a", "eco3:32")).toBe(true);
    // A county and a watershed share the point and nothing more.
    expect(f.edges.some((e) => e.from === "county:48453" && e.to.startsWith("huc"))).toBe(false);
    expect(f.edges.some((e) => e.relation === "drains-to" && e.external)).toBe(true);
  });
  it("says what it covers and flattens to CSV rows", () => {
    expect(f.coverage).toMatch(/^United States/);
    const rows = fabricRows(f);
    expect(rows).toHaveLength(f.nodes.length);
    expect(rows.find((r) => r.id === "county:48453")?.parents).toContain("state:48");
  });
  it("falls back to the country outside the US", () => {
    const c = countryAt(2.35, 48.85);
    expect(c?.country.properties.iso3).toBe("FRA");
    expect(assembleFabric({ lon: 2.35, lat: 48.85, nodes: [], edges: [], answered: [], failed: [] }).coverage).toMatch(/^Open ocean/);
  });
  it("keeps a stable order for ties", () => {
    const a = sortStack(f.nodes).map((n) => n.id);
    expect(sortStack([...f.nodes].reverse()).map((n) => n.id)).toEqual(a);
  });
});

describe("countryAt / inUsReach / identifyUrl", () => {
  it("finds the country under a point from the bundled table", () => {
    expect(countryAt(-97.74, 30.27)?.country.properties.iso3).toBe("USA");
    expect(countryAt(-40, 30)).toBeNull();
  });
  it("only sends US-only upstreams points they can answer", () => {
    expect(inUsReach(-97.74, 30.27)).toBe(true);
    expect(inUsReach(-66.1, 18.4)).toBe(true);
    expect(inUsReach(-155.5, 19.6)).toBe(true);
    expect(inUsReach(2.35, 48.85)).toBe(false);
  });
  it("builds an identify URL with or without geometry", () => {
    const u = new URL(identifyUrl(TIGER_URL, -97.74, 30.27, [80, 82], 0.02));
    expect(u.searchParams.get("layers")).toBe("all:80,82");
    expect(u.searchParams.get("returnGeometry")).toBe("true");
    expect(u.searchParams.get("maxAllowableOffset")).toBe("0.02");
    expect(new URL(identifyUrl(TIGER_URL, 0, 0, [80])).searchParams.get("returnGeometry")).toBe("false");
  });
});

describe("geometry helpers and the location join", () => {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
  const holed = [...square, [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];
  it("is even-odd, so holes are outside", () => {
    expect(ringsContain(square, 5, 5)).toBe(true);
    expect(ringsContain(holed, 5, 5)).toBe(false);
    expect(ringsContain(holed, 2, 2)).toBe(true);
    expect(ringsContain(square, 11, 5)).toBe(false);
  });
  it("rounds and dedupes vertices, dropping degenerate rings", () => {
    expect(roundRings([[[0.00001, 0], [0.00002, 0], [1, 0], [1, 1], [0, 0]]], 4)).toEqual([[[0, 0], [1, 0], [1, 1], [0, 0]]]);
    expect(roundRings([[[0, 0], [0, 0], [0, 0]]])).toEqual([]);
  });
  it("joins features of other layers by location and skips constructs", () => {
    const pt = (layer: string, id: string, lon: number, lat: number) =>
      ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { id, layer, name: id, source: "t" } }) as unknown as LayerFeature;
    const poly = { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { id: "c", layer: "commerce", name: "c", source: "t", anchor: [3, 3] } } as unknown as LayerFeature;
    const j = joinInside(square, [pt("water", "g1", 1, 1), pt("water", "g2", 20, 1), pt("banks", "b1", 9, 9), pt("constructs", "x", 5, 5), poly]);
    expect(j.get("water")?.map((f) => f.properties.id)).toEqual(["g1"]);
    expect(j.get("banks")).toHaveLength(1);
    expect(j.get("commerce")).toHaveLength(1);
    expect(j.has("constructs")).toBe(false);
  });
});

describe("constructs layer features", () => {
  const f = assembleFabric({ lon: -97.74, lat: 30.27, nodes: parseTiger(TIGER), edges: [], answered: ["census-tigerweb"], failed: [] });
  it("emits one stratum per construct plus the ground anchor", () => {
    const feats = fabricFeatures(f, 150_000);
    expect(feats).toHaveLength(f.nodes.length + 1);
    const here = feats.at(-1)!;
    expect(here.properties.id).toBe("here");
    expect(here.geometry.coordinates).toEqual([-97.74, 30.27, 0]);
    const alts = feats.slice(0, -1).map((x) => x.geometry.coordinates[2]);
    expect(alts).toEqual([...alts].sort((a, b) => a - b));
    for (const x of feats) expect((x.properties.extra as { ground: number[] }).ground).toEqual([-97.74, 30.27]);
  });
  it("spaces strata with camera height and keeps them near the point", () => {
    expect(strataStep(1_000)).toBe(250);
    expect(strataStep(1e9)).toBe(60_000);
    const [lon, lat, alt] = strataPosition(-97.74, 30.27, 9, 10, 150_000);
    expect(alt).toBe(strataStep(150_000) * 10);
    expect(Math.abs(lon + 97.74)).toBeLessThan(0.6);
    expect(Math.abs(lat - 30.27)).toBeLessThan(0.6);
  });
});
