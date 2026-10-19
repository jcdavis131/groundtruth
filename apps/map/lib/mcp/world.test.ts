import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { errorResult, toCallResult, createServer } from "./server";
import { toolByName, type FetchJson, type JsonObject, type ToolReply } from "./tools";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BOUNDARY_CHANGED_SINCE_2010, femaCodes } from "../hazards/history";
import { ringsTouchBox, WORLD_MAX_BYTES, worldContext, type WorldItem, type WorldSection } from "./world";

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

// /api/fabric?op=field&kind=county: TIGERweb outlines for a padded box. Shapes are squares here.
const sq = (w: number, s: number, e: number, n: number) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const unit = (code: string, name: string, rings: unknown) => ({ id: `county:${code}`, kind: "county", name, code, rings });
const FIELD = {
  data: {
    kind: "county",
    bbox: [-97.85, 30.15, -97.55, 30.4],
    units: [
      unit("48491", "Williamson County, TX", sq(-97.9, 30.35, -97.5, 30.9)),
      unit("48209", "Hays County, TX", sq(-98.2, 29.8, -97.75, 30.2)),
      unit("48021", "Bastrop County, TX", sq(-97.55, 30.0, -97.0, 30.5)),
      // Travis wholly contains the box: no edge crosses it, so only the inside test finds it.
      unit("48453", "Travis County, TX", sq(-98.2, 30.0, -97.4, 30.6)),
    ],
    truncated: false,
  },
  provenance: [prov("census-tigerweb", "U.S. Census Bureau")],
};

const decl = (n: number, title = "SEVERE STORMS") => ({ disasterNumber: 4000 + n, declarationType: "DR", declarationDate: `2024-0${(n % 9) + 1}-01`, incidentType: "Severe Storm", declarationTitle: title, designatedArea: "Travis (County)" });

const HISTORY = {
  data: { fips: "48453", declarations: [decl(1), decl(2), decl(3), decl(4)], declarationRows: 4, droughtNow: { mapDate: "2026-10-13", none: 60, d0: 40, d1: 10, d2: 0, d3: 0, d4: 0 }, missing: [] },
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

const CATALOG = { data: { hits: [{ id: "nid-dams", title: "Dams (USACE National Inventory of Dams)", score: 0.62 }], matched: true }, provenance: [{ source: { id: "eye-catalog", publisher: "Embedding Atlas", url: "https://www.arxiviq.com/catalog" }, upstreamUrl: "https://www.arxiviq.com/catalog", retrievedAt: T, kind: "estimate" }], generatedAt: T };

type Answer = JsonObject | { status: number; body: unknown } | "hang" | "throw";

const BASE: Array<[string, Answer]> = [
  ["/api/fabric?op=stack", STACK],
  ["/api/screen?kind=county", screenRow()],
  ["/api/screen?kind=state", STATE_ROW],
  ["/api/hazards?op=nri&fips", NRI],
  ["/api/fabric?op=field", FIELD],
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
        "/api/hazards?op=history&fips=48453&years=10&declarations=15",
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
    expect(topicsOf(r).hazards.coverageStatus!.basis).toContain("FEMA declarations: the latest 3 distinct shown, any date (FEMA files 4 rows for this county; a disaster can have one row per designated area)");
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

  it("a box lists the counties whose outlines touch it and keeps only records inside it", async () => {
    const { f, reply } = run({ bbox: [-97.8, 30.2, -97.6, 30.35], topics: ["institutions"] });
    const r = await reply;
    expect(f.calls).toContain("/api/fabric?op=field&kind=county&bbox=-97.8,30.2,-97.6,30.35");
    expect(f.calls.some((c) => c.startsWith("/api/hazards?op=nri&bbox"))).toBe(false);
    expect(f.calls).toContain("/api/companies?op=near&bbox=-97.8,30.2,-97.6,30.35");
    // Only outlines that touch the box; the county under its centre first; Bastrop (in the padded tile only) dropped.
    expect(topicsOf(r).identity.items.filter((i) => i.fact === "county touching the box").map((i) => i.code)).toEqual(["48453", "48491", "48209"]);
    // With room for every county, Bastrop is still absent: the ring filter drops it, not the cap.
    const wide = await run({ bbox: [-97.8, 30.2, -97.6, 30.35], topics: ["institutions"], max_records: 10 }).reply;
    expect(topicsOf(wide).identity.items.filter((i) => i.fact === "county touching the box").map((i) => i.code)).toEqual(["48453", "48491", "48209"]);
    expect(topicsOf(wide).identity.coverageStatus?.basis ?? []).not.toContain(expect.stringMatching(/counties touching the box: \d+ of/));
    const inst = topicsOf(r).institutions.items;
    expect(inst.filter((i) => i.fact === "hospital").map((i) => i.value)).toEqual(["DELL SETON MEDICAL CENTER"]);
    expect(inst.find((i) => i.fact === "hospital")!.note).toBe("general acute care; open; CMS overall star rating 4; inside the box");
  });

  it("collections only with about, ranked by catalog_search, each linking to its card", async () => {
    const { f, reply } = run({ lon: -97.74, lat: 30.27, topics: ["collections"], about: "dams near the river" });
    const r = await reply;
    expect(f.calls).toContain("/api/catalog?op=search&q=dams%20near%20the%20river&limit=3");
    // Cited to the catalogue's own provenance on the search route it came from; the card is named in the note.
    expect(topicsOf(r).collections.items[0]).toMatchObject({ value: "Dams (USACE National Inventory of Dams)", code: "nid-dams", sourceId: "eye-catalog", publisher: "Embedding Atlas", link: "http://t/api/catalog?op=search&q=dams%20near%20the%20river&limit=3", note: expect.stringMatching(/card: \/api\/catalog\?id=nid-dams/) });
    // A search route that sends no provenance gives no collection item, only the reason.
    const bare = await run({ lon: -97.74, lat: 30.27, topics: ["collections"], about: "dams near the river" }, { "/api/catalog?op=search": { ...CATALOG, provenance: [] } }).reply;
    expect(topicsOf(bare).collections.items).toEqual([]);
    expect(topicsOf(bare).collections.missing).toContainEqual({ what: "collections", reason: "eye-catalog: the route sent no provenance for it, so nothing from it is shown" });
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
    expect(topicsOf(r).identity.missing!.map((m) => m.reason)).toContain("census-tigerweb: the route sent no provenance for it, so nothing from it is shown");
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

// ---- the invariant over recorded replies ---------------------------------------
//
// Every review failure so far was one class of bug: a source that is missing turned into a
// value, or borrowed another source's citation. These replies were recorded from
// www.arxiviq.com (or this branch's preview deployment, for routes this PR changes; the file
// says which) and trimmed to the fields the tool reads. A file with `derivedFrom` is a recorded
// reply with one stated edit, for a shape the live site does not show today.

interface Recorded {
  input: JsonObject;
  routes: Record<string, { status: number; body: JsonObject }>;
}

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "world");
const recorded: Array<[string, Recorded]> = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(FIXTURE_DIR, f), "utf8")) as Recorded]);

function replay(rec: Recorded): FetchJson {
  return async (p) => {
    const r = rec.routes[p];
    if (!r) return { status: 500, body: { error: `not recorded: ${p}` }, url: "http://t" + p };
    return { status: r.status, body: structuredClone(r.body), url: "http://t" + p };
  };
}

const runRecorded = (rec: Recorded) => worldContext(toolByName("world_context")!.inputSchema.parse(rec.input) as never, { fetchJson: replay(rec) });

/**
 * The names lib/hazards/history.ts writes in `missing`, by source id: a second copy, kept here on
 * purpose so the invariant does not share world.ts's table (MISSING_NAMES) with the code it checks.
 */
const ROUTE_MISSING_NAMES: Record<string, string> = {
  FEMA: "fema-openfema",
  USDM: "usdm",
  SPC: "noaa-spc",
  "NCEI Storm Events": "ncei-storm-events",
  "USGS landslide susceptibility": "usgs-landslide-susc",
  "NOAA Climate at a Glance (tavg)": "noaa-cag",
  "NOAA Climate at a Glance (pcp)": "noaa-cag",
};

/** Source ids a route reply names as missing or failed (its own lists), by id. */
function namedMissing(body: JsonObject): Set<string> {
  const d = (body.data ?? {}) as JsonObject;
  const out = new Set<string>();
  for (const m of [...((d.missing as unknown[]) ?? []), ...((d.failed as unknown[]) ?? [])] as JsonObject[]) {
    const n = String(m.source ?? m.id ?? "");
    out.add(ROUTE_MISSING_NAMES[n] ?? n);
  }
  return out;
}

/** The route's own word that an empty answer is complete, for each kind of 0 the tool may state. */
function zeroIsComplete(fact: string, route: JsonObject): string | null {
  const d = (route.data ?? {}) as JsonObject;
  if (fact === "FEMA declarations listed") {
    if (d.declarationRows !== 0) return `declarationRows is ${String(d.declarationRows)}, not 0`;
    const gap = ((d.missing as JsonObject[]) ?? []).find((m) => /^join:|boundary/.test(String(m.reason ?? "")));
    return gap ? `the route reports ${String(gap.reason)} for this county` : null;
  }
  if (/^(hospitals|dams) found$/.test(fact)) return route.truncated === false ? null : `truncated is ${String(route.truncated)}`;
  if (/^public companies/.test(fact)) return route.pulled ? null : "the SEC bundle is the committed fixture (pulled: null)";
  if (/^Severe or Extreme NWS alerts/.test(fact)) return ((d.failed as unknown[]) ?? []).length || Number(d.unmapped ?? 0) > 0 ? "the live list is incomplete" : null;
  if (/^M4\.5\+ earthquakes/.test(fact)) return ((d.failed as unknown[]) ?? []).length ? "the live list is incomplete" : null;
  return `no completeness rule for a 0 in "${fact}"`;
}

/** Source ids a route reply cites: its provenance, or for the release calendar, the sources it schedules. */
function citedBy(p: string, body: JsonObject): Set<string> {
  if (p.startsWith("/api/releases")) return new Set((((body.data as JsonObject)?.releases as JsonObject[]) ?? []).map((x) => String(x.sourceId)));
  return new Set(((body.provenance as JsonObject[]) ?? []).map((x) => String((x.source as JsonObject)?.id)));
}

const routeOf = (link: string) => link.replace(/^http:\/\/t/, "");

/**
 * Which source each fact is about, written here independently of world.ts. An item cited to
 * any other source has borrowed a citation (the FEMA-to-USDM and Zillow-to-TIGERweb bugs);
 * a fact not in this table fails until someone says where it comes from.
 */
const FACT_SOURCE: Array<[RegExp, string | null, RegExp?]> = [
  [/^(county|state|metro or micro area \(CBSA\)|city or town|census tract|ZIP code area \(ZCTA\)|county touching the box|school district|congressional district|tribal land)$/, "census-tigerweb"],
  [/^(time zone|NWS forecast office|NWS alert)$|^Severe or Extreme NWS alerts/, "nws-api"],
  [/^HUC-12 watershed$/, "usgs-wbd"],
  [/^(FEMA flood zone|NFIP community)$/, "fema-nfhl"],
  [/^EPA level III ecoregion$/, "epa-ecoregions"],
  [/^elevation$/, "usgs-epqs"],
  [/^FEMA NRI|^NRI hazards|^population \(as carried in FEMA's NRI row\)$/, "fema-nri"],
  [/^FEMA declaration/, "fema-openfema"],
  [/^U\.S\. Drought Monitor/, "usdm", /DroughtSeverityStatisticsByAreaPercent/], // usdm has two entries; the shares come from this one
  [/^earthquake$|^M4\.5\+ earthquakes/, "usgs-earthquakes"],
  [/\(BLS QCEW/, "bls-qcew"],
  [/\(Zillow ZHVI\)$/, "zillow-zhvi"],
  [/\(Zillow ZORI\)$/, "zillow-zori"],
  [/^CDC\/ATSDR SVI/, "cdc-svi"],
  [/^hospitals? /, "hifld-hospitals"],
  [/^hospital$/, "hifld-hospitals"],
  [/^dams? /, "usace-nid"],
  [/^dam$/, "usace-nid"],
  [/^public compan/, "sec-edgar"],
  [/^collection$/, "eye-catalog"],
  [/^next scheduled release$/, null], // the release's own source, checked against the calendar
];

function checkInvariant(label: string, rec: Recorded, r: ToolReply): void {
  for (const it of allItems(r)) {
    const where = `${label}: ${it.fact} (${it.sourceId})`;
    // (0) the fact is cited to the source it is about, never a neighbour's
    const rule = FACT_SOURCE.find(([re]) => re.test(it.fact));
    expect(rule, `${where}: a fact the invariant knows`).toBeDefined();
    if (rule![1]) expect(it.sourceId, where).toBe(rule![1]);
    if (rule![2]) expect(it.upstreamUrl, where).toMatch(rule![2]);
    const p = routeOf(it.link);
    const route = rec.routes[p];
    expect(route, `${where}: link ${it.link} is a route the tool called`).toBeDefined();
    // (1) the source is cited by the route the item links to
    expect(citedBy(p, route.body).has(it.sourceId), `${where}: cited by ${it.link}`).toBe(true);
    // (1b) its publisher and upstreamUrl come from that source's own provenance entry (an event item
    // may point at the event itself; a release at the calendar's schedule page for it)
    const d = (route.body.data ?? {}) as JsonObject;
    if (p.startsWith("/api/releases")) {
      const rel = ((d.releases as JsonObject[]) ?? []).filter((x) => x.sourceId === it.sourceId && x.title === it.value);
      expect(rel.some((x) => (x.scheduleUrl ?? it.link) === it.upstreamUrl), `${where}: the release's own schedule page`).toBe(true);
    } else {
      const entries = ((route.body.provenance as JsonObject[]) ?? []).filter((x) => (x.source as JsonObject)?.id === it.sourceId);
      const own = entries.filter((x) => (x.source as JsonObject).publisher === it.publisher);
      expect(own.length, `${where}: publisher ${it.publisher} is that source's`).toBeGreaterThan(0);
      const urls = new Set(own.map((x) => String(x.upstreamUrl ?? (x.source as JsonObject).url ?? "")));
      if (/^(NWS alert|earthquake)$/.test(it.fact)) for (const x of (d.items as JsonObject[]) ?? []) if (x.title === it.value && typeof x.url === "string") urls.add(x.url);
      expect(urls.has(it.upstreamUrl), `${where}: upstreamUrl ${it.upstreamUrl} is one of ${[...urls].join(" | ")}`).toBe(true);
    }
    // (2) that route does not list the source as missing or failed
    expect(namedMissing(route.body).has(it.sourceId), `${where}: listed missing by ${it.link}`).toBe(false);
    // (3) a 0 only where the route itself says the answer is complete
    if (it.value === 0) expect(zeroIsComplete(it.fact, route.body), `${where}: a 0 the route does not vouch for`).toBeNull();
  }
}

/** Every (route, source) pair the tool cited in a reply, except the calendar (which cites no provenance of its own). */
function citedPairs(r: ToolReply): Map<string, Set<string>> {
  const pairs = new Map<string, Set<string>>();
  for (const it of allItems(r)) {
    const p = routeOf(it.link);
    if (p.startsWith("/api/releases")) continue;
    (pairs.get(p) ?? pairs.set(p, new Set()).get(p)!).add(it.sourceId);
  }
  return pairs;
}

describe("world_context: invariant over recorded live replies", () => {
  it("has the recorded places", () => {
    expect(recorded.map(([k]) => k)).toEqual(["austin_pt", "chugach_02063", "ct_09110", "denver_about", "mobile_01097", "nola_smallbox", "ocean_atlantic", "petroleum_30069", "pr_72127", "volusia_alert_pt", "zero_declarations"]);
  });

  it("between them the fixtures cite, and so the mutations drop, every source in the fact table", async () => {
    const dropped = new Set<string>();
    for (const [, rec] of recorded) for (const ids of citedPairs(await runRecorded(rec)).values()) for (const id of ids) dropped.add(id);
    const wanted = new Set(FACT_SOURCE.map(([, id]) => id).filter((x): x is string => !!x));
    expect([...wanted].filter((id) => !dropped.has(id)).sort()).toEqual([]);
    // and the item kinds the earlier rounds could not see
    const all = (await Promise.all(recorded.map(([, rec]) => runRecorded(rec)))).flatMap(allItems);
    for (const fact of ["NWS alert", "FEMA declarations listed", "collection", "public company (by ticker; names are not copied)", "FEMA flood zone"]) expect(all.map((i) => i.fact), fact).toContain(fact);
  });

  for (const [label, rec] of recorded) {
    it(`${label}: every item is cited by the route it links to, which does not list it missing`, async () => {
      const r = await runRecorded(rec);
      expect(allItems(r).length).toBeGreaterThan(0);
      checkInvariant(label, rec, r);
      expect(new TextEncoder().encode(JSON.stringify(toCallResult(r).structuredContent)).length).toBeLessThanOrEqual(WORLD_MAX_BYTES);
    });

    it(`${label}: drop each cited source from its route (provenance gone, named missing) and it becomes a missing entry, never a value`, async () => {
      const pairs = citedPairs(await runRecorded(rec));
      expect(pairs.size).toBeGreaterThan(0);
      for (const [p, ids] of pairs) {
        for (const id of ids) {
          const body = structuredClone(rec.routes[p].body);
          body.provenance = ((body.provenance as JsonObject[]) ?? []).filter((x) => (x.source as JsonObject)?.id !== id);
          const data = (body.data ??= {}) as JsonObject;
          data.missing = [...((data.missing as unknown[]) ?? []), { source: id, reason: "source:failed" }];
          const mutated: Recorded = { ...rec, routes: { ...rec.routes, [p]: { ...rec.routes[p], body } } };
          const r = await runRecorded(mutated);
          const where = `${label}: ${id} dropped from ${p}`;
          expect(allItems(r).filter((i) => routeOf(i.link) === p && i.sourceId === id), where).toEqual([]);
          const missing = Object.values(topicsOf(r)).flatMap((s) => s.missing ?? []);
          expect(missing.some((m) => m.reason.includes(id)), `${where}: a missing entry names it`).toBe(true);
          checkInvariant(where, mutated, r);
        }
      }
    });
  }

  it("Chugach 02063 (recorded from this branch's preview): Valdez-Cordova's declarations, marked, never a 0", async () => {
    const rec = recorded.find(([k]) => k === "chugach_02063")![1];
    const r = await runRecorded(rec);
    const ds = topicsOf(r).hazards.items.filter((i) => i.fact === "FEMA declaration");
    expect(ds.map((i) => i.code)).toEqual(expect.arrayContaining(["DR-4533", "EM-3446"]));
    expect(ds.every((i) => /former county code 02261/.test(String(i.note)))).toBe(true);
    expect(allItems(r).some((i) => i.fact === "FEMA declarations listed")).toBe(false);
  });

  it("CT 09110: no FEMA declaration count, and the reason in plain words", async () => {
    const rec = recorded.find(([k]) => k === "ct_09110")![1];
    const r = await runRecorded(rec);
    expect(facts(r, "hazards").some((f) => /FEMA declaration/.test(f))).toBe(false);
    expect(topicsOf(r).hazards.missing).toContainEqual({ what: "FEMA declarations", reason: expect.stringMatching(/FEMA lists Connecticut under its 8 legacy counties \(09001-09015\), not the planning regions \(09110-09190\).*\(join:legacy_ct_counties\)/) });
    expect(JSON.stringify(topicsOf(r).hazards.missing)).not.toMatch(/"reason":"join:/);
  });

  it("PR 72127: FEMA's non-rating words are missing entries, and CAG's reason is in plain words", async () => {
    const rec = recorded.find(([k]) => k === "pr_72127")![1];
    const r = await runRecorded(rec);
    expect(JSON.stringify(allItems(r))).not.toMatch(/Insufficient Data|Data Unavailable/);
    expect(topicsOf(r).hazards.missing).toContainEqual({ what: "FEMA NRI overall risk rating", reason: expect.stringMatching(/"Insufficient Data" here, which is not a rating/) });
    expect(topicsOf(r).vulnerability.missing).toContainEqual({ what: "FEMA NRI social vulnerability", reason: expect.stringMatching(/"Data Unavailable"/) });
    expect(topicsOf(r).hazards.missing).toContainEqual({ what: "NOAA Climate at a Glance (tavg)", reason: "NOAA Climate at a Glance (tavg) does not publish Puerto Rico (source:not_published_for_puerto_rico)" });
  });

  it("NOLA small box: only the parishes whose outlines touch it, Orleans first", async () => {
    const rec = recorded.find(([k]) => k === "nola_smallbox")![1];
    const r = await runRecorded(rec);
    const touching = topicsOf(r).identity.items.filter((i) => i.fact === "county touching the box").map((i) => i.code);
    expect(touching[0]).toBe("22071");
    expect(touching).not.toContain("22007"); // Assumption: in FEMA's 1-degree tile, not near the box
    expect(touching).not.toContain("22057"); // Lafourche
  });
});

describe("world_context: citations never borrow", () => {
  it("an item asks its own source id; with that id absent it is missing, never cited to the route's first source", async () => {
    // The CT shape: declarations empty, FEMA named missing, only USDM provenance present.
    const ct = { ...HISTORY, data: { ...HISTORY.data, declarations: [], missing: [{ source: "FEMA", reason: "join:legacy_ct_counties" }] }, provenance: HISTORY.provenance.filter((p) => p.source.id === "usdm") };
    const r = await run({ fips: "48453", topics: ["hazards"] }, { "/api/hazards?op=history": ct }).reply;
    expect(allItems(r).filter((i) => /FEMA declaration/.test(i.fact))).toEqual([]);
    expect(allItems(r).every((i) => i.sourceId !== "usdm" || i.fact.startsWith("U.S. Drought Monitor"))).toBe(true);
    expect(topicsOf(r).hazards.missing).toContainEqual({ what: "FEMA declarations", reason: expect.stringMatching(/^fema-openfema: the route lists it as missing: FEMA lists Connecticut/) });
    // Only provenance absent (FEMA not named missing): still missing, never a 0.
    const bare = { ...HISTORY, data: { ...HISTORY.data, declarations: [] }, provenance: HISTORY.provenance.filter((p) => p.source.id === "usdm") };
    const r2 = await run({ fips: "48453", topics: ["hazards"] }, { "/api/hazards?op=history": bare }).reply;
    expect(allItems(r2).some((i) => i.value === 0 && /FEMA/.test(i.fact))).toBe(false);
    expect(topicsOf(r2).hazards.missing).toContainEqual({ what: "FEMA declarations", reason: "fema-openfema: the route sent no provenance for it, so nothing from it is shown" });
  });

  it("a legacy Connecticut county FIPS points to the planning regions", async () => {
    const r = await run({ fips: "09003" }, { "/api/screen?kind=county": { data: { rows: [], total: 0 }, provenance: [] } }).reply;
    expect(r.status).toBe(404);
    expect(String(r.payload.error)).toMatch(/legacy counties \(09001-09015\).*planning regions \(09110-09190\)/);
  });

  it("the live counts cite their own feeds, say the county box is not the whole county, and honour unmapped", async () => {
    const quake = { kind: "quake", title: "M 5.0", lon: -97.7, lat: 30.3, time: 1792371480000, url: "https://earthquake.usgs.gov/x" };
    const live = { ...LIVE, data: { ...LIVE.data, items: [...LIVE.data.items, quake] } };
    const r = await run({ fips: "48453", topics: ["hazards"] }, { "/api/live": live }).reply;
    const hz = topicsOf(r).hazards.items;
    expect(hz.find((i) => i.fact.startsWith("Severe or Extreme NWS alerts"))).toMatchObject({ value: 1, sourceId: "nws-api", note: expect.stringMatching(/0.25 degrees around the county's representative point .*not the whole county/) });
    expect(hz.find((i) => i.fact.startsWith("M4.5+ earthquakes"))).toMatchObject({ value: 1, sourceId: "usgs-earthquakes" });
    const r2 = await run({ lon: -97.74, lat: 30.27, topics: ["hazards"] }, { "/api/live": { ...LIVE, data: { ...LIVE.data, unmapped: 2 } } }).reply;
    expect(topicsOf(r2).hazards.items.some((i) => i.fact.startsWith("Severe or Extreme NWS alerts"))).toBe(false);
    expect(topicsOf(r2).hazards.missing).toContainEqual({ what: "count of Severe or Extreme NWS alerts touching the box now", reason: expect.stringMatching(/^2 alerts in the national list could not be outlined/) });
  });

  it("an error reply stays under the cap with its envelope fields", async () => {
    const long = "Y".repeat(400);
    const down: Record<string, Answer> = Object.fromEntries(BASE.map(([k]) => [k, { status: 503, body: { error: long } }]));
    const r = await run({ lon: -97.74, lat: 30.27, max_records: 10 }, down).reply;
    const sc = toCallResult(r).structuredContent;
    expect(sc).toMatchObject({ code: "upstream_failure" });
    expect(new TextEncoder().encode(JSON.stringify(sc)).length).toBeLessThanOrEqual(WORLD_MAX_BYTES);
  });
});

describe("world_context: FEMA zeros, duplicates and the cut order", () => {
  const emptyFema = (missing: JsonObject[]) => ({ ...HISTORY, data: { ...HISTORY.data, declarations: [], declarationRows: 0, missing } });

  it("every county with a boundary change, a Connecticut region or a rename gets a missing entry or a crosswalked list, never a 0", async () => {
    const regions = ["09110", "09120", "09130", "09140", "09150", "09160", "09170", "09180", "09190"];
    const cases: Array<[string, JsonObject[]]> = [
      // The route's own missing list for these (lib/hazards/history.ts): landslide is withheld on a changed boundary.
      ...Object.keys(BOUNDARY_CHANGED_SINCE_2010).map((f): [string, JsonObject[]] => [f, [{ source: "USGS landslide susceptibility", reason: "join:boundary_changed_since_2010" }]]),
      ...regions.map((f): [string, JsonObject[]] => [f, [{ source: "FEMA", reason: "join:legacy_ct_counties" }]]),
    ];
    for (const [fips, missing] of cases) {
      const r = await run({ fips, topics: ["hazards"] }, { "/api/hazards?op=history": emptyFema(missing) }).reply;
      expect(allItems(r).some((i) => i.fact === "FEMA declarations listed"), fips).toBe(false);
      expect(topicsOf(r).hazards.missing!.some((m) => m.what === "FEMA declarations"), fips).toBe(true);
    }
    // The renamed and split counties with no join entry are read with their legacy code, so their list is not empty.
    for (const fips of ["46102", "02158", "02063", "02066", "02198", "02130", "02275", "02195", "51019"]) expect(femaCodes(fips).length, fips).toBeGreaterThan(1);
  });

  it("a 0 needs the route's own declarationRows 0, and says 'at any date'", async () => {
    const r = await run({ fips: "48453", topics: ["hazards"] }, { "/api/hazards?op=history": emptyFema([]) }).reply;
    expect(topicsOf(r).hazards.items.find((i) => i.fact === "FEMA declarations listed")).toMatchObject({ value: 0, note: expect.stringMatching(/at any date/) });
    const noRows = { ...HISTORY, data: { ...HISTORY.data, declarations: [], missing: [] } };
    const r2 = await run({ fips: "48453", topics: ["hazards"] }, { "/api/hazards?op=history": noRows }).reply;
    expect(topicsOf(r2).hazards.items.some((i) => i.fact === "FEMA declarations listed")).toBe(false);
    expect(topicsOf(r2).hazards.missing).toContainEqual({ what: "FEMA declarations", reason: expect.stringMatching(/did not report reading zero rows/) });
  });

  it("each disaster once (Kusilvak's DR-4893 has one row per designated area); the list says latest, any date; a legacy row is marked", async () => {
    const k = (n: number, area: string, filedUnder?: string) => ({ ...decl(n), disasterNumber: n, designatedArea: area, ...(filedUnder ? { filedUnder } : {}) });
    const h = { ...HISTORY, data: { ...HISTORY.data, declarations: [k(4893, "Kusilvak (Census Area)"), k(4893, "St. Marys City School District", "02270"), k(4533, "Kusilvak", "02270"), k(3446, "x")], declarationRows: 14 } };
    const r = await run({ fips: "48453", topics: ["hazards"] }, { "/api/hazards?op=history": h }).reply;
    const ds = topicsOf(r).hazards.items.filter((i) => i.fact === "FEMA declaration");
    expect(ds.map((i) => i.code)).toEqual(["DR-4893", "DR-4533", "DR-3446"]);
    expect(ds[1].note).toMatch(/filed by FEMA under the former county code 02270/);
    expect(topicsOf(r).hazards.coverageStatus!.basis).toContain("FEMA declarations: the latest 3 distinct shown, any date (FEMA files 14 rows for this county; a disaster can have one row per designated area)");
  });

  it("the byte cap cuts list rows (declarations past the first, hospitals) before the drought reading and the live counts", async () => {
    const long = "Z".repeat(190);
    const many = (n: number) => Array.from({ length: n }, (_, i) => feature(-97.74 + i * 0.001, 30.27, { id: `hifld-hosp:${i}`, name: `${long}${i}`, details: { type: long }, extra: { status: long, embedText: `name: ${long}${i}` } }));
    const r = await run(
      { lon: -97.74, lat: 30.27, max_records: 10 },
      {
        "/api/infra?op=hospitals": { ...HOSPITALS, data: { type: "FeatureCollection", features: many(40) } },
        "/api/infra?op=dams": { ...DAMS, data: { type: "FeatureCollection", features: many(40) } },
        "/api/hazards?op=history": { ...HISTORY, data: { ...HISTORY.data, declarations: Array.from({ length: 40 }, (_, i) => decl(i, long)), declarationRows: 40 } },
      },
    ).reply;
    expect((r.payload.truncated as { droppedItems: number }).droppedItems).toBeGreaterThan(0);
    const hz = facts(r, "hazards");
    expect(hz.some((f) => f.startsWith("U.S. Drought Monitor"))).toBe(true);
    expect(hz.some((f) => f.startsWith("Severe or Extreme NWS alerts"))).toBe(true);
    expect(hz.some((f) => f.startsWith("FEMA NRI overall"))).toBe(true);
    expect(facts(r, "economy").length).toBeGreaterThan(3);
  });
});

describe("world_context: ringsTouchBox", () => {
  const box: [number, number, number, number] = [0, 0, 1, 1];
  it("edge crossing, box inside, apart, and a nested multipolygon", () => {
    expect(ringsTouchBox(sq(-1, 0.5, 0.5, 2), box)).toBe(true);
    expect(ringsTouchBox(sq(-5, -5, 5, 5), box)).toBe(true);
    expect(ringsTouchBox(sq(2, 2, 3, 3), box)).toBe(false);
    expect(ringsTouchBox([sq(2, 2, 3, 3), sq(0.2, 0.2, 0.4, 0.4)], box)).toBe(true);
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
