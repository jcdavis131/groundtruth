import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { errorResult, toCallResult, createServer } from "./server";
import { toolByName, type FetchJson, type JsonObject, type ToolReply } from "./tools";
import { WORLD_MAX_BYTES, worldContext, type WorldItem, type WorldSection } from "./world";

// Fixtures trimmed from real replies of www.arxiviq.com on 2026-10-18 (shapes only; values shortened).

const T = "2026-10-18T12:00:00.000Z";
const src = (id: string, publisher: string, url: string) => ({ id, name: id, publisher, url, license: "public domain" });
const prov = (id: string, publisher: string, upstreamUrl?: string) => ({ source: src(id, publisher, `https://${id}.example.gov/`), retrievedAt: T, kind: "published", ...(upstreamUrl ? { upstreamUrl } : {}) });

const STACK = {
  source: "census-tigerweb, usgs-wbd, fema-nfhl, nws-api, usgs-epqs",
  data: {
    point: { lon: -97.74, lat: 30.27, elevationM: 159.9 },
    nodes: [
      { id: "flood:x", kind: "flood", name: "Flood zone X", code: "X", facts: { "special flood hazard area": "no", "FIRM panel": "48453C0465K", "panel effective": "1/22/2020" }, source: "fema-nfhl" },
      { id: "tract:48453001101", kind: "tract", name: "Census Tract 11.01", code: "48453001101", facts: {}, source: "census-tigerweb" },
      { id: "zcta:78701", kind: "zcta", name: "78701", code: "78701", facts: {}, source: "census-tigerweb" },
      { id: "huc12:120902050306", kind: "huc12", name: "Town Lake-Colorado River", code: "120902050306", facts: { "drains to": "120902050307" }, source: "usgs-wbd" },
      { id: "flood-community:480624", kind: "flood-community", name: "City Of Austin", code: "480624", facts: {}, source: "fema-nfhl" },
      { id: "place:4805000", kind: "place", name: "Austin city", code: "4805000", facts: { wikipedia: "Austin is the capital of Texas." }, source: "census-tigerweb" },
      {
        id: "county:48453",
        kind: "county",
        name: "Travis County, TX",
        code: "48453",
        facts: { wikipedia: "The county was established in 1840 and is named in honor of William Barret Travis." },
        source: "census-tigerweb",
      },
      { id: "cbsa:12420", kind: "cbsa", name: "Austin-Round Rock-San Marcos, TX Metro Area", code: "12420", facts: { type: "metropolitan" }, source: "census-tigerweb" },
      { id: "state:48", kind: "state", name: "Texas", code: "48", facts: {}, source: "census-tigerweb" },
      { id: "timezone:America/Chicago", kind: "timezone", name: "America/Chicago", code: "America/Chicago", facts: {}, source: "nws-api" },
    ],
    failed: [],
  },
  provenance: [
    prov("census-tigerweb", "U.S. Census Bureau"),
    prov("usgs-wbd", "U.S. Geological Survey"),
    prov("fema-nfhl", "Federal Emergency Management Agency"),
    prov("nws-api", "NOAA National Weather Service"),
    prov("usgs-epqs", "U.S. Geological Survey"),
  ],
  generatedAt: T,
};

const screenRow = (over: JsonObject = {}) => ({
  data: {
    rows: [
      {
        id: "county:48453",
        kind: "county",
        name: "Travis County, TX",
        geo: [-97.6910527, 30.2395263],
        values: {
          name: "Travis County",
          geoid: "48453",
          state: "TX",
          metro: "Austin-Round Rock-San Marcos, TX",
          "home.latest": 430123.4,
          "home.yoyPct": -3.21,
          "home.asOf": "2026-09-30",
          "rent.latest": 1612.2,
          "jobs.emp": 812345,
          "jobs.avgWeeklyWage": 1688,
          "jobs.period": "2026 Q1",
          "jobs.suppressed": "false",
          ...over,
        },
      },
    ],
    total: 1,
  },
  provenance: [
    prov("census-tigerweb", "U.S. Census Bureau"),
    prov("zillow-zhvi", "Zillow Research"),
    prov("zillow-zori", "Zillow Research"),
    prov("bls-qcew", "U.S. Bureau of Labor Statistics", "https://data.bls.gov/cew/data/api/2026/1/area/48453.csv"),
  ],
  generatedAt: T,
});

const STATE_ROW = { data: { rows: [{ id: "state:48", kind: "state", name: "Texas", geo: [-99.3, 31.4], values: { name: "Texas", geoid: "48", state: "TX", "jobs.emp": 14000000, "jobs.avgWeeklyWage": 1500, "jobs.period": "2026 Q1" } }] }, provenance: [prov("census-tigerweb", "U.S. Census Bureau"), prov("bls-qcew", "U.S. Bureau of Labor Statistics")] };

const NRI = {
  data: {
    level: "county",
    fips: "48453",
    row: { STCOFIPS: "48453", COUNTY: "Travis", STATEABBRV: "TX", POPULATION: 1290188, RISK_SCORE: 99.1, RISK_RATNG: "Very High", EAL_VALT: 123456789.4, EAL_RATNG: "Very High", SOVI_SCORE: 14.7, SOVI_RATNG: "Very Low", NRI_VER: "December 2025", HAIL_RISKR: "Very High", TRND_RISKR: "Relatively High", HRCN_RISKR: "Not Applicable" },
  },
  provenance: [prov("fema-nri", "Federal Emergency Management Agency", "https://services.arcgis.com/x/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0")],
};

const NRI_BOX = {
  bbox: [-107, 35, -105, 36],
  data: { level: "county", rows: [{ STCOFIPS: "35049", COUNTY: "Santa Fe", STATEABBRV: "NM" }, { STCOFIPS: "35001", COUNTY: "Bernalillo", STATEABBRV: "NM" }] },
  provenance: [prov("fema-nri", "Federal Emergency Management Agency", "https://services.arcgis.com/x/nri")],
};

const decl = (n: number, title = "SEVERE STORMS") => ({ disasterNumber: 4000 + n, declarationType: "DR", declarationDate: `2024-0${(n % 9) + 1}-01`, incidentType: "Severe Storm", declarationTitle: title, designatedArea: "Travis (County)" });

const HISTORY = {
  data: { fips: "48453", declarations: [decl(1), decl(2), decl(3), decl(4)], droughtNow: { mapDate: "2026-10-13", none: 60, d0: 40, d1: 10, d2: 0, d3: 0, d4: 0 }, missing: [] },
  provenance: [
    prov("fema-openfema", "Federal Emergency Management Agency", "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?x"),
    prov("usdm", "National Drought Mitigation Center", "https://usdmdataservices.unl.edu/api/CountyStatistics/GetDSCI?aoi=48453"),
    prov("usdm", "National Drought Mitigation Center", "https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=48453"),
  ],
};

const LIVE = {
  data: {
    items: [
      { kind: "alert", title: "Flash Flood Warning", subtitle: "Travis, TX", lon: -97.7, lat: 30.3, bbox: [-97.9, 30.1, -97.5, 30.5], time: 1792371480000, until: 1792425600000, url: "https://api.weather.gov/alerts/urn:oid:1" },
      { kind: "alert", title: "Flood Warning", subtitle: "Lake, FL", lon: -81.5, lat: 29.2, bbox: [-81.7, 29.0, -81.4, 29.3], time: 1792371480000, url: "https://api.weather.gov/alerts/urn:oid:2" },
    ],
    failed: [],
  },
  provenance: [prov("nws-api", "NOAA National Weather Service", "https://api.weather.gov/alerts/active?status=actual&severity=Extreme,Severe"), prov("usgs-earthquakes", "U.S. Geological Survey")],
};

const SVI = { data: { level: "county", fips: "48453", row: { fips: "48453", rpl: [0.5702, 0.55, 0.09, 0.88, 0.78] } }, provenance: [prov("cdc-svi", "Centers for Disease Control and Prevention")] };

const feature = (lon: number, lat: number, properties: JsonObject) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat, 0] }, properties });

const HOSPITALS = {
  data: {
    type: "FeatureCollection",
    features: [
      feature(-97.73, 30.28, {
        id: "hifld-hosp:1",
        name: "DELL SETON MEDICAL CENTER",
        kind: "general",
        details: { type: "general acute care", address: "1500 RED RIVER ST, AUSTIN, TX 78701", website: "https://hospital.example", telephone: "555-0100" },
        extra: { status: "OPEN", cms: { ccn: "450124", rating: 4 }, embedText: "collection: Hospitals (HIFLD); name: DELL SETON MEDICAL CENTER; county: Travis" },
      }),
      feature(-95.0, 29.0, { id: "hifld-hosp:far", name: "FAR AWAY HOSPITAL", extra: { embedText: "name: FAR AWAY HOSPITAL" } }),
    ],
  },
  truncated: false,
  provenance: [prov("hifld-hospitals", "Homeland Infrastructure Foundation-Level Data", "https://services.arcgis.com/x/Hospitals_RAPT/FeatureServer/6")],
};

const DAMS = {
  data: {
    type: "FeatureCollection",
    features: [
      feature(-97.78, 30.29, { id: "nid:TX00001", name: "Tom Miller Dam", details: { "hazard potential": "High", "owner type": "Public Utility", "year completed": 1940 }, extra: { embedText: "collection: Dams; name: Tom Miller Dam; county: Travis" } }),
      feature(-97.7, 30.25, { id: "nid:TX09999", name: "Jane Doe Pond Dam", details: { "hazard potential": "Low", "owner type": "Private", representative: "Jane Doe" }, extra: { embedText: "collection: Dams; county: Travis; hazard potential: Low" } }),
    ],
  },
  truncated: false,
  provenance: [prov("usace-nid", "U.S. Army Corps of Engineers", "https://geospatial.sec.usace.army.mil/x/NID/FeatureServer/0")],
};

const COMPANIES = {
  data: { type: "FeatureCollection", features: [feature(-97.62, 30.22, { id: "cik:123", name: "Smith Family Holdings Inc", details: { HQ: "Austin, TX 78725" }, extra: { cik: 123, ticker: "SFH", exchange: "NYSE" } })] },
  // As the live route answers today: the committed 25-company fixture, pulled: null.
  pulled: null,
  provenance: [prov("sec-edgar", "U.S. Securities and Exchange Commission")],
};

const CALENDAR = {
  data: {
    from: "2026-10-19",
    to: "2026-11-18",
    releases: [
      { id: "zillow-zhvi", sourceId: "zillow-zhvi", title: "Zillow ZHVI (monthly)", precision: "approximate", window: { earliest: "2026-10-10", latest: "2026-10-30", nominal: "2026-10-20" }, scheduleUrl: "https://www.zillow.com/research/data/" },
      { id: "zillow-zhvi", sourceId: "zillow-zhvi", title: "Zillow ZHVI (monthly)", precision: "approximate", window: { nominal: "2026-11-20" }, scheduleUrl: "https://www.zillow.com/research/data/" },
      { id: "bts-border", sourceId: "bts-border", title: "BTS Border Crossing Entry Data", window: { nominal: "2026-10-19" }, scheduleUrl: "https://data.bts.gov/x" },
      { id: "bls-qcew", sourceId: "bls-qcew", title: "QCEW 2026 Q2", precision: "official", window: { earliest: "2026-12-03", latest: "2026-12-03", nominal: "2026-12-03" }, scheduleUrl: "https://www.bls.gov/schedule/news_release/cew.htm" },
    ],
  },
  provenance: [],
  generatedAt: T,
};

const CATALOG = { data: { hits: [{ id: "nid-dams", title: "Dams (USACE National Inventory of Dams)", score: 0.62 }], matched: true }, provenance: [], generatedAt: T };

type Answer = JsonObject | { status: number; body: unknown } | "hang" | "throw";

const BASE: Array<[string, Answer]> = [
  ["/api/fabric?op=stack", STACK],
  ["/api/screen?kind=county", screenRow()],
  ["/api/screen?kind=state", STATE_ROW],
  ["/api/hazards?op=nri&fips", NRI],
  ["/api/hazards?op=nri&bbox", NRI_BOX],
  ["/api/hazards?op=history", HISTORY],
  ["/api/live", LIVE],
  ["/api/civic?op=svi", SVI],
  ["/api/infra?op=hospitals", HOSPITALS],
  ["/api/infra?op=dams", DAMS],
  ["/api/companies", COMPANIES],
  ["/api/releases?op=calendar", CALENDAR],
  ["/api/catalog?op=search", CATALOG],
];

function router(over: Record<string, Answer> = {}): { calls: string[]; fetchJson: FetchJson } {
  const calls: string[] = [];
  const table: Array<[string, Answer]> = [...Object.entries(over), ...BASE];
  const fetchJson: FetchJson = async (p) => {
    calls.push(p);
    const hit = table.find(([k]) => p.startsWith(k));
    if (!hit) return { status: 500, body: { error: `unexpected ${p}` }, url: "http://t" + p };
    const a = hit[1];
    if (a === "hang") return new Promise(() => undefined);
    if (a === "throw") throw new TypeError("fetch failed");
    if ("status" in a && typeof a.status === "number" && "body" in a) return { status: a.status, body: a.body, url: "http://t" + p };
    return { status: 200, body: a, url: "http://t" + p };
  };
  return { calls, fetchJson };
}

const run = (input: unknown, over: Record<string, Answer> = {}, stepMs?: number) => {
  const f = router(over);
  const tool = toolByName("world_context")!;
  const parsed = tool.inputSchema.parse(input) as never;
  return { f, reply: worldContext(parsed, { fetchJson: f.fetchJson }, { stepMs }) };
};

const topicsOf = (r: ToolReply) => r.payload.topics as Record<string, WorldSection>;
const allItems = (r: ToolReply): WorldItem[] => Object.values(topicsOf(r)).flatMap((s) => s.items);
const facts = (r: ToolReply, t: string) => topicsOf(r)[t].items.map((i) => i.fact);

describe("world_context: shape", () => {
  it("a point resolves through the fabric, then asks every topic's route once", async () => {
    const { f, reply } = run({ lon: -97.74, lat: 30.27 });
    const r = await reply;
    expect(r.status).toBe(200);
    expect(f.calls[0]).toBe("/api/fabric?op=stack&lon=-97.74&lat=30.27");
    expect(f.calls.slice(1).sort()).toEqual(
      [
        '/api/screen?kind=county&q=geoid%20%3D%3D%20%2248453%22%20LIMIT%201',
        "/api/hazards?op=nri&fips=48453",
        "/api/hazards?op=history&fips=48453&years=10&declarations=3",
        "/api/live",
        "/api/civic?op=svi&level=place&fips=48453",
        "/api/infra?op=hospitals&bbox=-97.84,30.17,-97.64,30.37",
        "/api/infra?op=dams&bbox=-97.84,30.17,-97.64,30.37",
        "/api/companies?op=county&fips=48453",
        "/api/releases?op=calendar",
      ].sort(),
    );
    expect(r.payload.place).toMatchObject({ kind: "point", name: "Travis County, TX", countyFips: "48453", stateFips: "48", point: { lon: -97.74, lat: 30.27 } });
    expect(Object.keys(topicsOf(r))).toEqual(["identity", "fabric", "hazards", "economy", "vulnerability", "institutions", "freshness"]);
    const ident = topicsOf(r).identity.items;
    expect(ident.find((i) => i.fact === "county")).toMatchObject({ value: "Travis County, TX", code: "48453" });
    expect(ident.find((i) => i.fact.startsWith("metro"))).toMatchObject({ code: "12420" });
    expect(facts(r, "fabric")).toEqual(expect.arrayContaining(["FEMA flood zone", "NFIP community", "HUC-12 watershed", "time zone", "elevation"]));
    expect(topicsOf(r).fabric.items.find((i) => i.fact === "FEMA flood zone")!.note).toBe("special flood hazard area: no; FIRM panel: 48453C0465K");
    expect(topicsOf(r).hazards.items.find((i) => i.fact === "FEMA NRI overall risk rating")!.value).toBe("Very High");
    expect(topicsOf(r).hazards.items.find((i) => i.fact.startsWith("NRI hazards"))!.value).toBe("Very High: hail; Relatively High: tornado");
    // One alert touches the point's box; the Florida one does not.
    expect(topicsOf(r).hazards.items.filter((i) => i.fact === "NWS alert").map((i) => i.value)).toEqual(["Flash Flood Warning"]);
    expect(topicsOf(r).economy.items.find((i) => i.fact.startsWith("covered employment"))).toMatchObject({ value: 812345, period: "2026 Q1", sourceId: "bls-qcew", upstreamUrl: "https://data.bls.gov/cew/data/api/2026/1/area/48453.csv" });
    expect(topicsOf(r).economy.items.find((i) => i.fact.startsWith("population"))!.value).toBe(1290188);
    expect(facts(r, "vulnerability")).toHaveLength(2);
    // Freshness lists only releases of sources this reply cites, soonest first, each release once.
    expect(topicsOf(r).freshness.items.map((i) => i.value)).toEqual(["Zillow ZHVI (monthly)", "QCEW 2026 Q2"]);
    // Three FEMA declarations shown of four: the cut is reported, not hidden.
    expect(topicsOf(r).hazards.items.filter((i) => i.fact === "FEMA declaration")).toHaveLength(3);
    expect(topicsOf(r).hazards.coverageStatus!.basis).toContain("FEMA declarations: 3 of 4 shown (max_records)");
    expect(r.payload.coverageStatus).toMatchObject({ status: "partial" });
  });

  it("a county FIPS resolves through the screener, reads county-wide constructs at its point, and says the fabric is per point", async () => {
    const { f, reply } = run({ fips: "48453" });
    const r = await reply;
    expect(f.calls[0]).toBe('/api/screen?kind=county&q=geoid%20%3D%3D%20%2248453%22%20LIMIT%201');
    expect(f.calls).toContain("/api/fabric?op=stack&lon=-97.6911&lat=30.2395");
    expect(r.payload.place).toMatchObject({ kind: "county", name: "Travis County, TX", countyFips: "48453", usps: "TX" });
    expect(facts(r, "identity").sort()).toEqual(["county", "metro or micro area (CBSA)", "state"]);
    expect(topicsOf(r).identity.items.find((i) => i.fact === "county")).toMatchObject({ code: "48453", sourceId: "census-tigerweb" });
    expect(topicsOf(r).fabric.items).toEqual([]);
    expect(topicsOf(r).fabric.missing![0].reason).toMatch(/per point; call world_context with lon\/lat \(the county's point is -97.6911, 30.2395\)/);
    expect(topicsOf(r).institutions.items.every((i) => i.fact !== "hospital" || /not the whole county/.test(String(i.note)))).toBe(true);
  });

  it("a state FIPS answers identity and economy and says why the county topics are absent", async () => {
    const { f, reply } = run({ fips: "48000", topics: ["economy", "hazards", "institutions"] });
    const r = await reply;
    expect(f.calls).toEqual(['/api/screen?kind=state&q=geoid%20%3D%3D%20%2248%22%20LIMIT%201']);
    expect(r.payload.place).toMatchObject({ kind: "state", stateFips: "48", countyFips: null });
    expect(facts(r, "economy")).toEqual(["covered employment (BLS QCEW, all industries)", "average weekly wage (BLS QCEW)"]);
    expect(topicsOf(r).hazards.missing![0].reason).toMatch(/county-level sources only/);
    expect(topicsOf(r).institutions.missing![0].reason).toMatch(/a state is too large/);
    // Hazards and live events are said to be not asked, not silently absent.
    const hz = topicsOf(r).hazards.missing!;
    expect(hz.find((m) => m.what.startsWith("county hazard baseline"))!.reason).toMatch(/^not asked for a state/);
    expect(hz.find((m) => m.what.startsWith("live events"))!.reason).toMatch(/^not asked for a state/);
  });

  it("a box lists the counties FEMA's index returns for it and keeps only records inside it", async () => {
    const { f, reply } = run({ bbox: [-97.8, 30.2, -97.6, 30.35], topics: ["institutions"] });
    const r = await reply;
    expect(f.calls).toContain("/api/hazards?op=nri&bbox=-97.8,30.2,-97.6,30.35");
    expect(f.calls).toContain("/api/companies?op=near&bbox=-97.8,30.2,-97.6,30.35");
    expect(topicsOf(r).identity.items.filter((i) => i.fact === "county touching the box").map((i) => i.code)).toEqual(["35049", "35001"]);
    const inst = topicsOf(r).institutions.items;
    expect(inst.filter((i) => i.fact === "hospital").map((i) => i.value)).toEqual(["DELL SETON MEDICAL CENTER"]);
    expect(inst.find((i) => i.fact === "hospital")!.note).toBe("general acute care; open; CMS overall star rating 4; inside the box");
  });

  it("collections only with about, ranked by catalog_search, each linking to its card", async () => {
    const { f, reply } = run({ lon: -97.74, lat: 30.27, topics: ["collections"], about: "dams near the river" });
    const r = await reply;
    expect(f.calls).toContain("/api/catalog?op=search&q=dams%20near%20the%20river&limit=3");
    expect(topicsOf(r).collections.items[0]).toMatchObject({ value: "Dams (USACE National Inventory of Dams)", code: "nid-dams", link: "http://t/api/catalog?id=nid-dams" });
  });

  it("goes through the MCP server as a normal tool result", async () => {
    const f = router();
    const server = createServer({ fetchJson: f.fetchJson });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const res = await client.callTool({ name: "world_context", arguments: { fips: "48453", topics: ["economy"] } });
    expect(res.isError).toBe(false);
    expect((res.structuredContent as { place: { countyFips: string } }).place.countyFips).toBe("48453");
  });
});

describe("world_context: every claim resolves", () => {
  it("every item carries sourceId, publisher, upstreamUrl, retrievedAt and an eye route link", async () => {
    for (const input of [{ lon: -97.74, lat: 30.27 }, { fips: "48453" }, { bbox: [-97.8, 30.2, -97.6, 30.35] }, { lon: -97.74, lat: 30.27, topics: ["collections"], about: "dams" }]) {
      const r = await run(input).reply;
      const items = allItems(r);
      expect(items.length).toBeGreaterThan(3);
      for (const i of items) {
        expect(i.sourceId, i.fact).toMatch(/\S/);
        expect(i.publisher, i.fact).toMatch(/\S/);
        expect(i.upstreamUrl, i.fact).toMatch(/^https?:\/\//);
        expect(Number.isNaN(Date.parse(i.retrievedAt)), i.fact).toBe(false);
        expect(i.link, i.fact).toMatch(/^http:\/\/t\/api\//);
      }
    }
  });

  it("an item whose route sent no provenance is listed as missing, not shown uncited", async () => {
    const r = await run({ lon: -97.74, lat: 30.27, topics: ["fabric"] }, { "/api/fabric?op=stack": { ...STACK, provenance: [] } }).reply;
    expect(allItems(r)).toEqual([]);
    expect(topicsOf(r).identity.missing!.map((m) => m.reason)).toContain("the route sent no provenance for it, so it is left out");
  });
});

describe("world_context: missing, withheld, partial", () => {
  it("a withheld QCEW cell is null with its reason, never 0", async () => {
    const r = await run({ fips: "48453", topics: ["economy"] }, { "/api/screen?kind=county": screenRow({ "jobs.emp": null, "jobs.avgWeeklyWage": null, "jobs.suppressed": "true", "rent.latest": null }) }).reply;
    const jobs = topicsOf(r).economy.items.find((i) => i.fact.startsWith("covered employment"))!;
    expect(jobs.value).toBeNull();
    expect(jobs.note).toMatch(/withheld by BLS.*null, not 0/);
    expect(topicsOf(r).economy.missing).toContainEqual({ what: "typical asking rent (Zillow ZORI)", reason: "Zillow publishes no rent index for this place" });
  });

  it("a failing, throwing or silent sub-route costs only its own items: partial, not an error", async () => {
    const { reply } = run({ lon: -97.74, lat: 30.27 }, { "/api/hazards?op=nri&fips": { status: 502, body: { error: "FEMA 503", upstream: "FEMA", status: 503 } }, "/api/live": "throw", "/api/civic?op=svi": "hang" }, 50);
    const r = await reply;
    expect(r.status).toBe(200);
    const res = toCallResult(r);
    expect(res.isError).toBe(false);
    const basis = (r.payload.coverageStatus as { status: string; basis: string[] }).basis;
    expect(basis).toContain("hazards: FEMA National Risk Index: HTTP 502: FEMA 503");
    expect(basis).toContain("hazards: live events: fetch failed");
    expect(basis).toContain("vulnerability: CDC/ATSDR SVI 2022: no answer within 0.05 s");
    // What did answer is still there.
    expect(facts(r, "hazards")).toContain("FEMA declaration");
    expect(facts(r, "economy")).toContain("typical home value (Zillow ZHVI)");
  });

  it("when nothing answers it is an upstream failure in the typed envelope", async () => {
    const down: Record<string, Answer> = Object.fromEntries(BASE.map(([k]) => [k, { status: 503, body: { error: "down" } }]));
    const r = await run({ lon: -97.74, lat: 30.27 }, down).reply;
    expect(r.status).toBe(502);
    const res = toCallResult(r);
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ code: "upstream_failure", category: "unavailable", retryable: true });
  });

  it("an unknown county FIPS is not_found, not an empty bundle", async () => {
    const r = await run({ fips: "99999" }, { "/api/screen?kind=county": { data: { rows: [], total: 0 }, provenance: [] } }).reply;
    expect(r.status).toBe(404);
    expect(toCallResult(r).structuredContent).toMatchObject({ code: "not_found", retryable: false });
  });
});

describe("world_context: byte cap", () => {
  it(`stays under ${WORLD_MAX_BYTES} bytes, says how many items it dropped, and marks coverage partial`, async () => {
    const long = "X".repeat(190);
    const many = (n: number) => Array.from({ length: n }, (_, i) => feature(-97.74 + i * 0.001, 30.27, { id: `hifld-hosp:${i}`, name: `${long}${i}`, details: { type: long }, extra: { status: long, embedText: `name: ${long}${i}` } }));
    const r = await run(
      { lon: -97.74, lat: 30.27, max_records: 10 },
      {
        "/api/infra?op=hospitals": { ...HOSPITALS, data: { type: "FeatureCollection", features: many(40) } },
        "/api/infra?op=dams": { ...DAMS, data: { type: "FeatureCollection", features: many(40) } },
        "/api/hazards?op=history": { ...HISTORY, data: { ...HISTORY.data, declarations: Array.from({ length: 40 }, (_, i) => decl(i, long)) } },
      },
    ).reply;
    const size = new TextEncoder().encode(JSON.stringify(r.payload)).length;
    expect(size).toBeLessThanOrEqual(WORLD_MAX_BYTES);
    const t = r.payload.truncated as { droppedItems: number };
    expect(t.droppedItems).toBeGreaterThan(0);
    expect((r.payload.coverageStatus as { basis: string[] }).basis.some((b) => /cut to 24000 bytes/.test(b))).toBe(true);
    // Identity is the last thing cut.
    expect(topicsOf(r).identity.items.length).toBeGreaterThan(3);
  });
});

describe("world_context: privacy", () => {
  it("copies no free text, address, website, owner or private name; names only places, hospitals and non-private dams", async () => {
    const r = await run({ lon: -97.74, lat: 30.27, max_records: 10 }).reply;
    const text = JSON.stringify(r.payload);
    for (const banned of ["William Barret Travis", "capital of Texas", "1500 RED RIVER", "hospital.example", "555-0100", "Jane Doe", "Smith Family", "78725", "address", "website", "representative", "telephone", "wikipedia"]) {
      expect(text, banned).not.toContain(banned);
    }
    const inst = topicsOf(r).institutions.items;
    expect(inst.find((i) => i.code === "nid:TX00001")!.value).toBe("Tom Miller Dam");
    // A private dam is labelled by its id only.
    const priv = inst.find((i) => i.code === "nid:TX09999")!;
    expect(priv.value).toBeNull();
    expect(priv.note).toMatch(/^name withheld \(private owner\); labelled by NID id/);
    expect(inst.find((i) => i.code === "CIK 123")!.value).toBe("SFH");
  });
});

const fabricWith = (nodes: JsonObject[], extra: JsonObject = {}) => ({ ...STACK, data: { ...STACK.data, nodes, ...extra } });
const node = (kind: string, code: string, name = code) => ({ id: `${kind}:${code}`, kind, name, code, facts: {}, source: "census-tigerweb" });

describe("world_context: identity gaps", () => {
  it("a county whose point is offshore (fabric has no county) keeps the screener's county and says why state and CBSA are absent", async () => {
    const offshore = fabricWith([{ id: "timezone:America/Adak", kind: "timezone", name: "America/Adak", code: "America/Adak", facts: {}, source: "nws-api" }], { coverage: "Outside the United States only the country is known here" });
    const r = await run({ fips: "48453", topics: ["economy"] }, { "/api/fabric?op=stack": offshore }).reply;
    const id = topicsOf(r).identity;
    expect(id.items.map((i) => i.fact)).toEqual(["county"]);
    expect(id.missing).toContainEqual({ what: "state and metro area (CBSA)", reason: expect.stringMatching(/no county polygon at the county's representative point \(-97.6911, 30.2395\): it is offshore/) });
    expect(id.coverageStatus).toMatchObject({ status: "partial" });
  });

  it("a county whose point lands in a neighbouring county never shows that county's state or CBSA", async () => {
    const neighbour = fabricWith([node("county", "48491", "Williamson County, TX"), node("cbsa", "12420", "Austin Metro"), node("state", "48", "Texas")]);
    const r = await run({ fips: "48453", topics: ["economy"] }, { "/api/fabric?op=stack": neighbour }).reply;
    const id = topicsOf(r).identity;
    expect(id.items.map((i) => [i.fact, i.code])).toEqual([["county", "48453"]]);
    expect(JSON.stringify(id.items)).not.toContain("Williamson");
    expect(id.missing![0].reason).toMatch(/resolved to county 48491 \(Williamson County, TX\), not 48453/);
  });

  it("a county in no CBSA says so explicitly", async () => {
    const rural = fabricWith([node("county", "48453", "Travis County, TX"), node("state", "48", "Texas")]);
    for (const input of [{ fips: "48453", topics: ["economy"] }, { lon: -97.74, lat: 30.27, topics: ["economy"] }]) {
      const r = await run(input, { "/api/fabric?op=stack": rural }).reply;
      expect(topicsOf(r).identity.missing).toContainEqual({ what: "metro area (CBSA)", reason: expect.stringMatching(/^none: this county is in no metropolitan or micropolitan statistical area/) });
      expect(facts(r, "identity")).not.toContain("metro or micro area (CBSA)");
    }
  });

  it("a point with no county under it records the gap with the fabric's reason", async () => {
    const sea = fabricWith([], { coverage: "Outside the United States only the country is known here" });
    const r = await run({ lon: -173.97, lat: 52.87, topics: ["economy"] }, { "/api/fabric?op=stack": sea }).reply;
    expect(topicsOf(r).identity.missing).toContainEqual({ what: "county, state and metro area (CBSA)", reason: expect.stringMatching(/no county polygon at this point: it is offshore or outside the US \(the fabric says: Outside/) });
  });

  it("does not claim 'no CBSA' when TIGERweb itself failed", async () => {
    const down = fabricWith([node("timezone", "America/Chicago")], { failed: [{ source: "census-tigerweb", error: "TIGERweb 503" }] });
    const r = await run({ lon: -97.74, lat: 30.27, topics: ["economy"] }, { "/api/fabric?op=stack": down }).reply;
    const m = topicsOf(r).identity.missing!;
    expect(m).toContainEqual({ what: "county, state and metro area (CBSA)", reason: "Census TIGERweb failed on this call (/api/fabric failed[]: TIGERweb 503)" });
    expect(m.some((x) => /^none:/.test(x.reason))).toBe(false);
  });
});

describe("world_context: companies are counted only within the bundle", () => {
  it("the committed fixture (pulled: null) gives no count, marks institutions partial and states the universe on each company", async () => {
    const empty = { ...COMPANIES, data: { type: "FeatureCollection", features: [] } };
    const r = await run({ fips: "48453", topics: ["institutions"] }, { "/api/companies": empty }).reply;
    const inst = topicsOf(r).institutions;
    expect(inst.items.some((i) => /compan/i.test(i.fact))).toBe(false);
    expect(inst.missing).toContainEqual({ what: "SEC-registered public companies headquartered in the county", reason: expect.stringMatching(/committed fixture \(pulled: null\), not a full pull/) });
    expect(inst.coverageStatus).toMatchObject({ status: "partial" });

    const one = await run({ bbox: [-97.8, 30.2, -97.6, 30.35], topics: ["institutions"] }, { "/api/companies": { ...COMPANIES, bundle: { companies: 25, geocoded: 25, withFacts: 0 } } }).reply;
    const co = topicsOf(one).institutions.items.find((i) => i.code === "CIK 123")!;
    expect(co.note).toMatch(/within eye's SEC bundle of 25 companies \(a committed fixture, pulled: null\); not every registrant/);
  });

  it("a full pull may say 0, still within the bundle", async () => {
    const full = { ...COMPANIES, pulled: "2026-10-01", bundle: { companies: 6000, geocoded: 5900, withFacts: 5000 }, data: { type: "FeatureCollection", features: [] } };
    const r = await run({ bbox: [-97.8, 30.2, -97.6, 30.35], topics: ["institutions"] }, { "/api/companies": full }).reply;
    expect(topicsOf(r).institutions.items.find((i) => i.fact.startsWith("public companies"))).toMatchObject({ value: 0, note: "within eye's SEC bundle of 6000 companies pulled 2026-10-01; not every registrant" });
  });
});

describe("world_context: the route's own truncated flag", () => {
  it("a capped hospital or dam reply is not shown as every record, and never as 0", async () => {
    const cut = { ...HOSPITALS, truncated: true };
    const none = { ...DAMS, truncated: true, data: { type: "FeatureCollection", features: [] } };
    const r = await run({ lon: -97.74, lat: 30.27, topics: ["institutions"] }, { "/api/infra?op=hospitals": cut, "/api/infra?op=dams": none }).reply;
    const inst = topicsOf(r).institutions;
    expect(inst.coverageStatus!.basis).toContain("hospitals: the route hit its upstream's record limit for this box, so the 1 it returned inside the box are not all of them");
    expect(inst.items.some((i) => i.fact === "dams found")).toBe(false);
    expect(inst.missing).toContainEqual({ what: "dams found", reason: expect.stringMatching(/hit its record limit/) });
  });

  it("a capped reply longer than max_records says 'of at least'", async () => {
    const many = Array.from({ length: 5 }, (_, i) => feature(-97.74 + i * 0.001, 30.27, { id: `nid:TX${i}`, name: `D${i}`, details: { "owner type": "Private" }, extra: {} }));
    const r = await run({ lon: -97.74, lat: 30.27, topics: ["institutions"] }, { "/api/infra?op=dams": { ...DAMS, truncated: true, data: { type: "FeatureCollection", features: many } } }).reply;
    expect(topicsOf(r).institutions.coverageStatus!.basis).toContain("dams: 3 of at least 5 shown (max_records)");
    expect(topicsOf(r).institutions.items.filter((i) => i.fact === "dam")).toHaveLength(3);
  });
});

describe("world_context: auth refusal", () => {
  it("every route answering 401/403 is an auth refusal, not a retryable upstream failure", async () => {
    const refused: Record<string, Answer> = Object.fromEntries(BASE.map(([k], i) => [k, { status: i % 2 ? 401 : 403, body: { error: "non-JSON reply" } }]));
    for (const input of [{ lon: -97.74, lat: 30.27 }, { fips: "48453" }]) {
      const r = await run(input, refused).reply;
      expect(r.status).toBe(403);
      expect(r.payload.refusal).toBe("auth");
      expect(String(r.payload.error)).toMatch(/^auth refusal/);
      expect(toCallResult(r).structuredContent).toMatchObject({ retryable: false, category: "invalid_input" });
      expect(toCallResult(r).structuredContent).not.toMatchObject({ code: "upstream_failure" });
    }
  });
});

describe("world_context: bad input", () => {
  const bad: unknown[] = [
    {},
    { lon: -97.74 },
    { lat: 30.27 },
    { lon: -97.74, lat: 30.27, fips: "48453" },
    { fips: "48453", bbox: [-98, 30, -97, 31] },
    { fips: "484" },
    { fips: "TX" },
    { bbox: [-100, 30, -97, 31] },
    { bbox: [-97, 30, -98, 31] },
    { lon: -97.74, lat: 30.27, max_records: 11 },
    { lon: -97.74, lat: 30.27, max_records: 0 },
    { lon: -97.74, lat: 30.27, topics: ["weather"] },
    { lon: -97.74, lat: 30.27, topics: [] },
    { lon: -97.74, lat: 30.27, topics: ["collections"] },
    { lon: 200, lat: 30.27 },
  ];
  for (const input of bad) {
    it(JSON.stringify(input), async () => {
      const f = router();
      const err = await toolByName("world_context")!.run(input, { fetchJson: f.fetchJson }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(f.calls).toHaveLength(0);
      expect(errorResult(err).structuredContent).toMatchObject({ code: "invalid_arguments", category: "invalid_input", retryable: false });
    });
  }
});
