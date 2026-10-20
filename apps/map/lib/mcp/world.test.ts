import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { errorResult, toCallResult, createServer } from "./server";
import { ABSENCE_CODES, codeForRouteEntry, ROUTE_REASON_CODE, type AbsenceCode } from "./absence";
import { WORLD_OUTPUT_SCHEMA, WORLD_SCHEMA_VERSION } from "./worldSchema";
import { RECORD_HOSTS } from "./worldHosts";
import { ERROR_MAX_CHARS, toolByName, type FetchJson, type JsonObject, type ToolReply } from "./tools";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BOUNDARY_CHANGED_SINCE_2010, femaCodes } from "../hazards/history";
import { countyByFips, countyPoint } from "../places/registry";
import { RELEASE_CALENDAR } from "../releases/calendar";
import { MISSING_NAMES, REASONS, ringsContain, ringsTouchBox, SCHEDULE_BLOCKED_NOTE, waterBox, WORLD_MAX_BYTES, worldContext, type WorldItem, type WorldSection } from "./world";

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
  provenance: [prov("fema-nri", "Federal Emergency Management Agency", "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0")],
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
  provenance: [prov("hifld-hospitals", "Homeland Infrastructure Foundation-Level Data", "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Hospitals_RAPT/FeatureServer/6"), prov("cms-provider-data", "Centers for Medicare & Medicaid Services", "https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0")],
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

// /api/water?op=pfas&polygons=1 for the cell holding -97.74,30.27: one service area holds the point, one does not.
const WATER = {
  bbox: [-97.74, 30.26, -97.72, 30.28],
  coverage: [
    { id: "service-areas", state: "covered", count: 2 },
    { id: "estimated-locations", state: "covered", count: 0 },
    { id: "results", state: "covered", count: 2 },
  ],
  data: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: sq(-97.8, 30.2, -97.7, 30.3) },
        properties: { id: "pfas:TX2270001", details: { "water system (as EPA lists it)": "CITY OF EXAMPLE", "population served": 1000000 }, extra: { state: "detected", pwsid: "TX2270001", modelled: false, placement: "service-area", results: [{ contaminant: "PFOA", maxNgL: 4.1, detections: 2, results: 8 }, { contaminant: "4:2 FTS", maxNgL: null, detections: 0, results: 8 }] } },
      },
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: sq(-97.735, 30.275, -97.725, 30.279) },
        properties: { id: "pfas:TX2270999", details: { "population served": 40 }, extra: { state: "not-detected", pwsid: "TX2270999", modelled: true, placement: "service-area", results: [{ contaminant: "PFOA", maxNgL: null, detections: 0, results: 2 }] } },
      },
    ],
  },
  provenance: [prov("epa-cws-boundaries", "U.S. EPA", "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0"), prov("epa-ucmr5-pat", "U.S. EPA", "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/PFAS_Analytic_Tools_Layers/FeatureServer/1")],
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
  ["/api/water?op=pfas", WATER],
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
  return { f, reply: worldContext(parsed, { fetchJson: f.fetchJson, countyPoint }, { stepMs }) };
};

const topicsOf = (r: ToolReply) => r.payload.topics as Record<string, WorldSection>;
const allItems = (r: ToolReply): WorldItem[] => Object.values(topicsOf(r)).flatMap((s) => s.items);
const facts = (r: ToolReply, t: string) => topicsOf(r)[t].items.map((i) => i.fact);

/** The published outputSchema, run by the MCP SDK's own validator (the one a client would use). */
const validateWorld = new AjvJsonSchemaValidator().getValidator(WORLD_OUTPUT_SCHEMA as never);

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
        "/api/water?op=pfas&bbox=-97.74,30.26,-97.72,30.28&polygons=1",
      ].sort(),
    );
    expect(r.payload.place).toMatchObject({ kind: "point", name: "Travis County, TX", countyFips: "48453", stateFips: "48", point: { lon: -97.74, lat: 30.27 } });
    expect(Object.keys(topicsOf(r))).toEqual(["identity", "fabric", "hazards", "economy", "vulnerability", "institutions", "water", "freshness"]);
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
    expect(topicsOf(r).hazards.coverageStatus!.basis.map((b) => b.text)).toContain("FEMA declarations: the latest 3 distinct shown, any date (FEMA files 4 rows for this county; a disaster can have one row per designated area)");
    expect(r.payload.coverageStatus).toMatchObject({ status: "partial" });
  });

  it("a county FIPS resolves through the screener, reads county-wide constructs at its point, and says the fabric is per point", async () => {
    const { f, reply } = run({ fips: "48453" });
    const r = await reply;
    expect(f.calls[0]).toBe('/api/screen?kind=county&q=geoid%20%3D%3D%20%2248453%22%20LIMIT%201');
    // Census's internal point from the county table (-97.6913, 30.2395), not the screener's anchor (-97.6910527, 30.2395263).
    expect(f.calls).toContain("/api/fabric?op=stack&lon=-97.6913&lat=30.2395");
    expect(r.payload.place).toMatchObject({ kind: "county", name: "Travis County, TX", countyFips: "48453", usps: "TX" });
    expect(facts(r, "identity").sort()).toEqual(["county", "metro or micro area (CBSA)", "state"]);
    expect(topicsOf(r).identity.items.find((i) => i.fact === "county")).toMatchObject({ code: "48453", sourceId: "census-tigerweb" });
    expect(topicsOf(r).fabric.items).toEqual([]);
    expect(topicsOf(r).fabric.missing![0].reason).toMatch(/per point; call world_context with lon\/lat \(the county's point is -97.6913, 30.2395\)/);
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
    expect(inst.find((i) => i.fact === "hospital")!.note).toBe("general acute care; open; inside the box");
    // CMS's rating is CMS's own item, cited to CMS, with CMS's row for the CCN.
    expect(inst.find((i) => i.fact === "CMS overall hospital star rating")).toMatchObject({ value: 4, code: "450124", sourceId: "cms-provider-data", upstreamRecordUrl: expect.stringMatching(/^https:\/\/data\.cms\.gov\/provider-data\/api\/1\/datastore\/query\/xubh-q36u\/0\?.*=450124&/) });
  });

  it("collections only with about, ranked by catalog_search, each linking to its card", async () => {
    const { f, reply } = run({ lon: -97.74, lat: 30.27, topics: ["collections"], about: "dams near the river" });
    const r = await reply;
    expect(f.calls).toContain("/api/catalog?op=search&q=dams%20near%20the%20river&limit=3");
    // Cited to the catalogue's own provenance on the search route it came from; the card is named in the note.
    expect(topicsOf(r).collections.items[0]).toMatchObject({ value: "Dams (USACE National Inventory of Dams)", code: "nid-dams", sourceId: "eye-catalog", publisher: "Embedding Atlas", link: "http://t/api/catalog?op=search&q=dams%20near%20the%20river&limit=3", note: expect.stringMatching(/card: \/api\/catalog\?id=nid-dams/), kind: "about-eye" });
    // A catalogue item is eye's own claim: no publisher record, and it says so.
    expect(topicsOf(r).collections.items[0].upstreamRecordUrl).toBeUndefined();
    expect(topicsOf(r).collections.items[0].note).toMatch(/no record-level URL: a claim about eye's own catalogue/);
    // A search route that sends no provenance gives no collection item, only the reason.
    const bare = await run({ lon: -97.74, lat: 30.27, topics: ["collections"], about: "dams near the river" }, { "/api/catalog?op=search": { ...CATALOG, provenance: [] } }).reply;
    expect(topicsOf(bare).collections.items).toEqual([]);
    expect(topicsOf(bare).collections.missing).toContainEqual(expect.objectContaining({ what: "collections", reason: "eye-catalog: the route sent no provenance for it, so nothing from it is shown" }));
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
  it("every item carries sourceId, publisher, upstreamUrl, retrievedAt, an eye route link, and a record-level URL or says it has none", async () => {
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
        // exactly one of: the publisher's record URL, or a note saying there is none and why
        if (i.upstreamRecordUrl) {
          expect(i.upstreamRecordUrl, i.fact).toMatch(/^https:\/\//);
          expect(String(i.note ?? ""), i.fact).not.toMatch(/no record-level URL/);
        } else expect(i.note, i.fact).toMatch(/no record-level URL: \S/);
      }
    }
  });

  it("a point read's record URL uses the point the fabric snapped to and read at, not the point asked", async () => {
    // The route snaps -97.7431, 30.2672 to the 0.001 grid and reads EPQS, NFHL and NWS at -97.743, 30.267.
    const snapped = { ...STACK, data: { ...STACK.data, point: { lon: -97.743, lat: 30.267, elevationM: 159.9 } } };
    const r = await run({ lon: -97.7431, lat: 30.2672, topics: ["fabric"] }, { "/api/fabric?op=stack": snapped }).reply;
    const items = allItems(r);
    const elev = items.find((i) => i.fact === "elevation")!;
    const flood = items.find((i) => i.fact === "FEMA flood zone")!;
    expect(elev.link).toContain("lon=-97.7431");
    expect(elev.upstreamRecordUrl).toBe("https://epqs.nationalmap.gov/v1/json?x=-97.743&y=30.267&units=Meters&wkid=4326");
    expect(flood.upstreamRecordUrl).toContain("/NFHL/MapServer/28/query?geometry=-97.743,30.267&");
    for (const i of items.filter((x) => x.sourceId === "nws-api" && x.upstreamRecordUrl)) expect(i.upstreamRecordUrl).toBe("https://api.weather.gov/points/30.2670,-97.7430");
    for (const i of [elev, flood]) {
      expect(i.upstreamRecordUrl).not.toContain("97.7431");
      expect(i.upstreamRecordUrl).not.toContain("30.2672");
    }
    // a reply that states no point gets no point record, rather than one built from the query
    const pointless = { ...STACK, data: { ...STACK.data, point: { elevationM: 159.9 } } };
    const r2 = await run({ lon: -97.7431, lat: 30.2672, topics: ["fabric"] }, { "/api/fabric?op=stack": pointless }).reply;
    const e2 = allItems(r2).find((i) => i.fact === "elevation")!;
    expect(e2.upstreamRecordUrl).toBeUndefined();
    expect(e2.note).toMatch(/no record-level URL: the fabric reply does not state the point it was read at/);
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
    expect(topicsOf(r).economy.missing).toContainEqual({ what: "typical asking rent (Zillow ZORI)", code: "not_in_release", reason: "Zillow publishes no rent index for this place", action: "abstain" });
    // BLS's own suppression flag is the only source of `withheld`; the item says so, and the schema reads it
    expect(jobs.absence).toBe("withheld");
    expect(validateWorld(r.payload).errorMessage).toBeUndefined();
  });

  it("a failing, throwing or silent sub-route costs only its own items: partial, not an error", async () => {
    const { reply } = run({ lon: -97.74, lat: 30.27 }, { "/api/hazards?op=nri&fips": { status: 502, body: { error: "FEMA 503", upstream: "FEMA", status: 503 } }, "/api/live": "throw", "/api/civic?op=svi": "hang" }, 50);
    const r = await reply;
    expect(r.status).toBe(200);
    const res = toCallResult(r);
    expect(res.isError).toBe(false);
    const basis = (r.payload.coverageStatus as { status: string; basis: { code: string; text: string }[] }).basis;
    expect(basis).toContainEqual({ code: "failed", text: "hazards: FEMA National Risk Index: HTTP 502: FEMA 503" });
    expect(basis).toContainEqual({ code: "failed", text: "hazards: live events: fetch failed" });
    // a deadline is a timeout: retryable like a failure, but it says so
    expect(basis).toContainEqual({ code: "timeout", text: "vulnerability: CDC/ATSDR SVI 2022: no answer within 0.05 s" });
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
    expect((r.payload.coverageStatus as { basis: { code: string; text: string }[] }).basis.some((b) => b.code === "cut_by_byte_cap" && b.text.includes(`cut to ${WORLD_MAX_BYTES} bytes`))).toBe(true);
    // Identity is the last thing cut.
    expect(topicsOf(r).identity.items.length).toBeGreaterThan(3);
    // and the cut reply is valid as sent; tamper: the same reply with the cut list's coverageStatus removed is not, and the error names it
    expect(validateWorld(r.payload).errorMessage).toBeUndefined();
    const bad = structuredClone(r.payload);
    delete bad.coverageStatus;
    const v = validateWorld(bad);
    expect(v.valid, "a truncated reply without coverageStatus").toBe(false);
    expect(v.errorMessage).toContain("coverageStatus");
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
    // and its record link asks NID for the stated fields only, so it does not show the name either
    const fieldsOf = (u: string | undefined) => decodeURIComponent(/[?&]outFields=([^&]*)/.exec(u ?? "")?.[1] ?? "").split(",");
    expect(fieldsOf(priv.upstreamRecordUrl)).not.toContain("NAME");
    expect(fieldsOf(priv.upstreamRecordUrl)).not.toContain("*");
    expect(fieldsOf(priv.upstreamRecordUrl)).toContain("NIDID");
    expect(fieldsOf(inst.find((i) => i.code === "nid:TX00001")!.upstreamRecordUrl)).toContain("NAME");
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
    expect(id.missing).toContainEqual({ what: "state and metro area (CBSA)", code: "not_in_release", action: "abstain", reason: expect.stringMatching(/no county polygon at the county's Census internal point \(-97.6913, 30.2395\): it is offshore/) });
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
      expect(topicsOf(r).identity.missing).toContainEqual(expect.objectContaining({ what: "metro area (CBSA)", reason: expect.stringMatching(/^none: this county is in no metropolitan or micropolitan statistical area/) }));
      expect(facts(r, "identity")).not.toContain("metro or micro area (CBSA)");
    }
  });

  it("a point with no county under it records the gap with the fabric's reason", async () => {
    const sea = fabricWith([], { coverage: "Outside the United States only the country is known here" });
    const r = await run({ lon: -173.97, lat: 52.87, topics: ["economy"] }, { "/api/fabric?op=stack": sea }).reply;
    expect(topicsOf(r).identity.missing).toContainEqual(expect.objectContaining({ what: "county, state and metro area (CBSA)", reason: expect.stringMatching(/no county polygon at this point: it is offshore or outside the US \(the fabric says: Outside/) }));
  });

  it("does not claim 'no CBSA' when TIGERweb itself failed", async () => {
    const down = fabricWith([node("timezone", "America/Chicago")], { failed: [{ source: "census-tigerweb", error: "TIGERweb 503" }] });
    const r = await run({ lon: -97.74, lat: 30.27, topics: ["economy"] }, { "/api/fabric?op=stack": down }).reply;
    const m = topicsOf(r).identity.missing!;
    expect(m).toContainEqual(expect.objectContaining({ what: "county, state and metro area (CBSA)", reason: "Census TIGERweb failed on this call (/api/fabric failed[]: TIGERweb 503)" }));
    expect(m.some((x) => /^none:/.test(x.reason))).toBe(false);
  });
});

describe("world_context: companies are counted only within the bundle", () => {
  it("the committed fixture (pulled: null) gives no count, marks institutions partial and states the universe on each company", async () => {
    const empty = { ...COMPANIES, data: { type: "FeatureCollection", features: [] } };
    const r = await run({ fips: "48453", topics: ["institutions"] }, { "/api/companies": empty }).reply;
    const inst = topicsOf(r).institutions;
    expect(inst.items.some((i) => /compan/i.test(i.fact))).toBe(false);
    expect(inst.missing).toContainEqual({ what: "SEC-registered public companies headquartered in the county", code: "not_loaded", action: "narrow", reason: expect.stringMatching(/committed fixture \(pulled: null\), not a full pull/) });
    expect(inst.coverageStatus).toMatchObject({ status: "partial" });

    const one = await run({ bbox: [-97.8, 30.2, -97.6, 30.35], topics: ["institutions"] }, { "/api/companies": { ...COMPANIES, bundle: { companies: 25, geocoded: 25, withFacts: 0 } } }).reply;
    const co = topicsOf(one).institutions.items.find((i) => i.code === "CIK 123")!;
    expect(co.note).toMatch(/within eye's SEC bundle of 25 companies \(a committed fixture, pulled: null\); not every registrant/);
  });

  it("a full pull may say 0, still within the bundle", async () => {
    const full = { ...COMPANIES, pulled: "2026-10-01", bundle: { companies: 6000, geocoded: 5900, withFacts: 5000 }, data: { type: "FeatureCollection", features: [] } };
    const r = await run({ bbox: [-97.8, 30.2, -97.6, 30.35], topics: ["institutions"] }, { "/api/companies": full }).reply;
    expect(topicsOf(r).institutions.items.find((i) => i.fact.startsWith("public companies"))).toMatchObject({ value: 0, note: "within eye's SEC bundle of 6000 companies pulled 2026-10-01; not every registrant; no record-level URL: a count within eye's SEC bundle; SEC has no URL for it" });
  });
});

describe("world_context: the route's own truncated flag", () => {
  it("a capped hospital or dam reply is not shown as every record, and never as 0", async () => {
    const cut = { ...HOSPITALS, truncated: true };
    const none = { ...DAMS, truncated: true, data: { type: "FeatureCollection", features: [] } };
    const r = await run({ lon: -97.74, lat: 30.27, topics: ["institutions"] }, { "/api/infra?op=hospitals": cut, "/api/infra?op=dams": none }).reply;
    const inst = topicsOf(r).institutions;
    expect(inst.coverageStatus!.basis).toContainEqual({ code: "cut_by_route_limit", text: "hospitals: the route hit its upstream's record limit for this box, so the 1 it returned inside the box are not all of them" });
    expect(inst.items.some((i) => i.fact === "dams found")).toBe(false);
    expect(inst.missing).toContainEqual({ what: "dams found", code: "cut_by_route_limit", action: "narrow", reason: expect.stringMatching(/hit its record limit/) });
  });

  it("a capped reply longer than max_records says 'of at least'", async () => {
    const many = Array.from({ length: 5 }, (_, i) => feature(-97.74 + i * 0.001, 30.27, { id: `nid:TX${i}`, name: `D${i}`, details: { "owner type": "Private" }, extra: {} }));
    const r = await run({ lon: -97.74, lat: 30.27, topics: ["institutions"] }, { "/api/infra?op=dams": { ...DAMS, truncated: true, data: { type: "FeatureCollection", features: many } } }).reply;
    expect(topicsOf(r).institutions.coverageStatus!.basis).toContainEqual({ code: "cut_by_max_records", text: "dams: 3 of at least 5 shown (max_records)" });
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

const runRecorded = (rec: Recorded) => worldContext(toolByName("world_context")!.inputSchema.parse(rec.input) as never, { fetchJson: replay(rec), countyPoint });

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
  [/^CMS overall hospital star rating$/, "cms-provider-data"],
  [/^community water system serving the point/, "epa-cws-boundaries"],
  [/^UCMR 5 /, "epa-ucmr5-pat"],
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
      expect(urls.has(it.upstreamUrl), `${where}: upstreamUrl ${it.upstreamUrl} is one of ${[...urls].join(" | ")}`).toBe(true);
      // an event's record is the event itself, as the live list gives it
      if (/^(NWS alert|earthquake)$/.test(it.fact)) expect(((d.items as JsonObject[]) ?? []).some((x) => x.title === it.value && x.url === it.upstreamRecordUrl), `${where}: record is the event's own URL`).toBe(true);
    }
    // (2) that route does not list the source as missing or failed
    expect(namedMissing(route.body).has(it.sourceId), `${where}: listed missing by ${it.link}`).toBe(false);
    // (3) a 0 only where the route itself says the answer is complete
    if (it.value === 0) expect(zeroIsComplete(it.fact, route.body), `${where}: a 0 the route does not vouch for`).toBeNull();
    // (4) a record-level URL is on the cited publisher's own host and names this record; an item without one says so
    if (it.upstreamRecordUrl) checkRecordUrl(where, it, r, rec);
    else expect(it.note, `${where}: says it has no record-level URL`).toMatch(/no record-level URL: \S/);
    // (5) about-eye is exactly the catalogue's own claims
    expect(it.kind === "about-eye", `${where}: about-eye iff cited to eye's catalogue`).toBe(it.sourceId === "eye-catalog");
    if (it.kind === "about-eye") expect(it.upstreamRecordUrl, `${where}: eye's own claim has no publisher record`).toBeUndefined();
  }
}

/**
 * The point a fabric item was read at: the snapped point in the reply its own link recorded
 * (the route snaps to 0.001 and reads every upstream there), never the point the link asked for.
 */
function readPoint(where: string, it: WorldItem, rec: Recorded): [number, number] {
  const body = rec.routes[routeOf(it.link)]?.body as JsonObject | undefined;
  const p = ((body?.data as JsonObject | undefined)?.point ?? {}) as JsonObject;
  expect(typeof p.lon === "number" && typeof p.lat === "number", `${where}: the recorded reply states the point it read at`).toBe(true);
  return [p.lon as number, p.lat as number];
}

/** TIGERweb tigerWMS_Current layer per fact, written here from the TIGERweb service directory, not from world.ts. */
const TIGER_FACT_LAYERS: Record<string, number[]> = {
  county: [82],
  "county touching the box": [82],
  state: [80],
  "census tract": [8],
  "ZIP code area (ZCTA)": [2],
  "city or town": [28],
  "congressional district": [54],
  "school district": [14, 16, 18],
  "metro or micro area (CBSA)": [91, 93],
};

/** What a record URL must contain to be this record's: its id, written here from the item, not from world.ts. */
function recordIds(where: string, it: WorldItem, r: ToolReply, rec: Recorded): Array<string | RegExp> {
  const place = r.payload.place as { kind: string; countyFips: string | null; stateFips: string | null };
  const cf = place.countyFips ?? "?";
  const code = it.code ?? "";
  switch (it.sourceId) {
    case "census-tigerweb": {
      const layers = TIGER_FACT_LAYERS[it.fact];
      expect(layers, `${where}: a TIGERweb layer for this fact`).toBeDefined();
      return [`GEOID%3D'${code}'`, new RegExp(`/tigerWMS_Current/MapServer/(${layers.join("|")})/query\\?`)];
    }
    case "nws-api":
    case "usgs-epqs":
    case "fema-nfhl": {
      if (it.fact === "NFIP community") return [`CID%3D'${code}'`];
      const [lon, lat] = readPoint(where, it, rec);
      if (it.sourceId === "nws-api") return [`/points/${lat.toFixed(4)},${lon.toFixed(4)}`];
      return it.sourceId === "usgs-epqs" ? [`x=${lon}&y=${lat}&`] : [`geometry=${lon},${lat}&`, "/NFHL/MapServer/28/query?"];
    }
    case "usgs-wbd":
      return [`huc12%3D'${code}'`];
    case "epa-ecoregions":
      return [`US_L3CODE%3D'${code}'`];
    case "fema-nri":
    case "cdc-svi":
      return [`'${cf}'`];
    case "fema-openfema":
      return it.fact === "FEMA declaration" ? [`disasterNumber%20eq%20${code.replace(/^[A-Z]+-/, "")}`] : [`fipsStateCode%20eq%20'${cf.slice(0, 2)}'`, `fipsCountyCode%20eq%20'${cf.slice(2)}'`];
    case "usdm": {
      const [y, m, d] = String(it.period).split("-");
      // one map date, and statisticsType=2: per-class shares as the item states them (1 is cumulative)
      return [`aoi=${cf}&`, `startdate=${Number(m)}/${Number(d)}/${y}&`, `enddate=${Number(m)}/${Number(d)}/${y}&`, /[?&]statisticsType=2$/];
    }
    case "bls-qcew": {
      const [y, q2] = String(it.period).split(" Q");
      return [`/${y}/${q2}/area/${place.kind === "state" ? `${place.stateFips}000` : cf}.csv`];
    }
    case "hifld-hospitals":
      return [`ID%3D'${code.replace(/^hifld-hosp:/, "")}'`];
    case "cms-provider-data":
      return [`=${code}&`];
    case "usace-nid":
      return [`NIDID%3D'${code.replace(/^nid:/, "")}'`];
    case "sec-edgar":
      return [`CIK${code.replace(/^CIK /, "").padStart(10, "0")}.json`];
    case "epa-cws-boundaries":
      return [`PWSID%3D'${code}'`];
    case "epa-ucmr5-pat": {
      const c = it.fact.replace(/^UCMR 5 highest single result: /, "");
      return [`F_PWS_ID%3D'${code}'`, ...(c !== it.fact ? [`Contaminant%3D'${encodeURIComponent(c)}'`] : [])];
    }
    default:
      return [];
  }
}

function checkRecordUrl(where: string, it: WorldItem, r: ToolReply, rec: Recorded): void {
  const host = RECORD_HOSTS[it.sourceId];
  expect(host, `${where}: a source with a known record host`).toBeDefined();
  expect(it.upstreamRecordUrl, `${where}: on the publisher's host`).toMatch(host);
  if (/^(NWS alert|earthquake)$/.test(it.fact)) return; // the event's own URL, checked against the live list in (1b)
  const ids = recordIds(where, it, r, rec);
  expect(ids.length, `${where}: an id rule`).toBeGreaterThan(0);
  for (const id of ids) {
    if (typeof id === "string") expect(it.upstreamRecordUrl, `${where}: names ${id}`).toContain(id);
    else expect(it.upstreamRecordUrl, `${where}: matches ${id}`).toMatch(id);
  }
  // a dam labelled by its id: the record link does not fetch the name the reply withholds
  if (it.sourceId === "usace-nid" && it.value == null) {
    const fields = decodeURIComponent(/[?&]outFields=([^&]*)/.exec(it.upstreamRecordUrl!)?.[1] ?? "*").split(",");
    expect(fields, `${where}: an explicit field list`).not.toContain("*");
    expect(fields, `${where}: no NAME for a dam labelled by id`).not.toContain("NAME");
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
    expect(recorded.map(([k]) => k)).toEqual(["austin_pt", "chugach_02063", "collegeville_pa_pt", "ct_09110", "denver_about", "mobile_01097", "nola_smallbox", "ocean_atlantic", "petroleum_30069", "pr_72127", "volusia_alert_pt", "zero_declarations"]);
  });

  it("between them the fixtures cite, and so the mutations drop, every source in the fact table", async () => {
    const dropped = new Set<string>();
    for (const [, rec] of recorded) for (const ids of citedPairs(await runRecorded(rec)).values()) for (const id of ids) dropped.add(id);
    const wanted = new Set(FACT_SOURCE.map(([, id]) => id).filter((x): x is string => !!x));
    expect([...wanted].filter((id) => !dropped.has(id)).sort()).toEqual([]);
    // and the item kinds the earlier rounds could not see
    const all = (await Promise.all(recorded.map(([, rec]) => runRecorded(rec)))).flatMap(allItems);
    for (const fact of ["NWS alert", "FEMA declarations listed", "collection", "public company (by ticker; names are not copied)", "FEMA flood zone", "CMS overall hospital star rating", "community water system serving the point (EPA service area)", "UCMR 5 PFAS status of the system", "UCMR 5 highest single result: PFOA"]) expect(all.map((i) => i.fact), fact).toContain(fact);
    // and, between them, a record-level URL from every source in RECORD_HOSTS (a quake needs one in the past day, which no fixture has)
    const withRecord = new Set(all.filter((i) => i.upstreamRecordUrl).map((i) => i.sourceId));
    expect(Object.keys(RECORD_HOSTS).filter((id) => !withRecord.has(id) && id !== "usgs-earthquakes")).toEqual([]);
  });

  for (const [label, rec] of recorded) {
    it(`${label}: every item is cited by the route it links to, which does not list it missing`, async () => {
      const r = await runRecorded(rec);
      expect(allItems(r).length).toBeGreaterThan(0);
      checkInvariant(label, rec, r);
      // where the recorded fabric reply states its point, the point reads link to their record (never the no-record branch)
      for (const it of allItems(r).filter((i) => i.fact === "elevation" || i.fact === "FEMA flood zone")) {
        const p = (((rec.routes[routeOf(it.link)]?.body as JsonObject)?.data as JsonObject)?.point ?? {}) as JsonObject;
        if (typeof p.lon === "number") expect(it.upstreamRecordUrl, `${label}: ${it.fact} has a record URL`).toBeDefined();
      }
      expect(new TextEncoder().encode(JSON.stringify(toCallResult(r).structuredContent)).length).toBeLessThanOrEqual(WORLD_MAX_BYTES);
      // with codes added, the recorded default reply still fits whole, and is valid against the published schema
      expect(r.payload.truncated, `${label}: no item dropped by the byte cap`).toBeUndefined();
      expect(validateWorld(toCallResult(r).structuredContent).errorMessage, label).toBeUndefined();
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
          // the route listed it with reason source:failed, so that is the code (no guess about the publisher)
          const own = missing.filter((m) => m.reason.startsWith(`${id}: `));
          expect(own.length, `${where}: the entry the source's own item became`).toBeGreaterThan(0);
          for (const m of own) expect(m.code, `${where}: ${m.reason}`).toBe("failed");
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
    expect(topicsOf(r).hazards.missing).toContainEqual(expect.objectContaining({ what: "FEMA declarations", reason: expect.stringMatching(/FEMA lists Connecticut under its 8 legacy counties \(09001-09015\), not the planning regions \(09110-09190\).*\(join:legacy_ct_counties\)/) }));
    expect(JSON.stringify(topicsOf(r).hazards.missing)).not.toMatch(/"reason":"join:/);
  });

  it("PR 72127: FEMA's non-rating words are missing entries, and CAG's reason is in plain words", async () => {
    const rec = recorded.find(([k]) => k === "pr_72127")![1];
    const r = await runRecorded(rec);
    expect(JSON.stringify(allItems(r))).not.toMatch(/Insufficient Data|Data Unavailable/);
    expect(topicsOf(r).hazards.missing).toContainEqual(expect.objectContaining({ what: "FEMA NRI overall risk rating", reason: expect.stringMatching(/"Insufficient Data" here, which is not a rating/) }));
    expect(topicsOf(r).vulnerability.missing).toContainEqual(expect.objectContaining({ what: "FEMA NRI social vulnerability", reason: expect.stringMatching(/"Data Unavailable"/) }));
    // FEMA's non-rating words arrive in the row's value ("Insufficient Data", "Data Unavailable"), not in a route
    // missing entry, so they are not_in_release (the row has no rating) and never not_published or withheld.
    for (const m of [...(topicsOf(r).hazards.missing ?? []), ...(topicsOf(r).vulnerability.missing ?? [])].filter((x) => /"(Insufficient Data|Data Unavailable)"/.test(x.reason))) {
      expect(m.code, m.what).toBe("not_in_release");
    }
    expect(topicsOf(r).hazards.missing).toContainEqual(expect.objectContaining({ what: "NOAA Climate at a Glance (tavg)", reason: "NOAA Climate at a Glance (tavg) does not publish Puerto Rico (source:not_published_for_puerto_rico)" }));
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
    expect(topicsOf(r).hazards.missing).toContainEqual(expect.objectContaining({ what: "FEMA declarations", reason: expect.stringMatching(/^fema-openfema: the route lists it as missing: FEMA lists Connecticut/) }));
    // Only provenance absent (FEMA not named missing): still missing, never a 0.
    const bare = { ...HISTORY, data: { ...HISTORY.data, declarations: [] }, provenance: HISTORY.provenance.filter((p) => p.source.id === "usdm") };
    const r2 = await run({ fips: "48453", topics: ["hazards"] }, { "/api/hazards?op=history": bare }).reply;
    expect(allItems(r2).some((i) => i.value === 0 && /FEMA/.test(i.fact))).toBe(false);
    expect(topicsOf(r2).hazards.missing).toContainEqual(expect.objectContaining({ what: "FEMA declarations", reason: "fema-openfema: the route sent no provenance for it, so nothing from it is shown" }));
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
    expect(hz.find((i) => i.fact.startsWith("Severe or Extreme NWS alerts"))).toMatchObject({ value: 1, sourceId: "nws-api", note: expect.stringMatching(/0.25 degrees around the county's Census internal point .*not the whole county/) });
    expect(hz.find((i) => i.fact.startsWith("M4.5+ earthquakes"))).toMatchObject({ value: 1, sourceId: "usgs-earthquakes" });
    const r2 = await run({ lon: -97.74, lat: 30.27, topics: ["hazards"] }, { "/api/live": { ...LIVE, data: { ...LIVE.data, unmapped: 2 } } }).reply;
    expect(topicsOf(r2).hazards.items.some((i) => i.fact.startsWith("Severe or Extreme NWS alerts"))).toBe(false);
    expect(topicsOf(r2).hazards.missing).toContainEqual(expect.objectContaining({ what: "count of Severe or Extreme NWS alerts touching the box now", reason: expect.stringMatching(/^2 alerts in the national list could not be outlined/) }));
  });

  it("an error reply stays under the cap with its envelope fields", async () => {
    const long = "Y".repeat(400);
    const down: Record<string, Answer> = Object.fromEntries(BASE.map(([k]) => [k, { status: 503, body: { error: long } }]));
    const r = await run({ lon: -97.74, lat: 30.27, max_records: 10 }, down).reply;
    const sc = toCallResult(r).structuredContent;
    expect(sc).toMatchObject({ code: "upstream_failure" });
    expect(new TextEncoder().encode(JSON.stringify(sc)).length).toBeLessThanOrEqual(WORLD_MAX_BYTES);
    // Claude Code shows the model a path, not the text, once a result passes 50,000 characters; an error is read in place.
    expect((toCallResult(r).content as { text: string }[])[0].text.length).toBeLessThanOrEqual(ERROR_MAX_CHARS);
    expect(JSON.stringify(sc).length).toBeLessThanOrEqual(ERROR_MAX_CHARS);
    expect(sc).toMatchObject({ code: "upstream_failure", category: "unavailable", retryable: true, remediation: expect.any(String) });
    // missing lists are what survives the trim: the reply still says what is missing
    expect(Object.values((sc as { topics: Record<string, { missing?: unknown[] }> }).topics).some((t) => (t.missing?.length ?? 0) >= 1)).toBe(true);
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
    expect(topicsOf(r2).hazards.missing).toContainEqual(expect.objectContaining({ what: "FEMA declarations", reason: expect.stringMatching(/did not report reading zero rows/) }));
  });

  it("each disaster once (Kusilvak's DR-4893 has one row per designated area); the list says latest, any date; a legacy row is marked", async () => {
    const k = (n: number, area: string, filedUnder?: string) => ({ ...decl(n), disasterNumber: n, designatedArea: area, ...(filedUnder ? { filedUnder } : {}) });
    const h = { ...HISTORY, data: { ...HISTORY.data, declarations: [k(4893, "Kusilvak (Census Area)"), k(4893, "St. Marys City School District", "02270"), k(4533, "Kusilvak", "02270"), k(3446, "x")], declarationRows: 14 } };
    const r = await run({ fips: "48453", topics: ["hazards"] }, { "/api/hazards?op=history": h }).reply;
    const ds = topicsOf(r).hazards.items.filter((i) => i.fact === "FEMA declaration");
    expect(ds.map((i) => i.code)).toEqual(["DR-4893", "DR-4533", "DR-3446"]);
    expect(ds[1].note).toMatch(/filed by FEMA under the former county code 02270/);
    expect(topicsOf(r).hazards.coverageStatus!.basis.map((b) => b.text)).toContain("FEMA declarations: the latest 3 distinct shown, any date (FEMA files 14 rows for this county; a disaster can have one row per designated area)");
  });

  it("Hoonah-Angoon: rows FEMA files under another code for an area lying here say the count may be short, and the declarations stay cited", async () => {
    const detail = "Chatham Regional Educational Attendance Area (EM-3446, DR-4585), filed under 02280: FEMA files this area under 02280, Wrangell-Petersburg, though it lies in Hoonah-Angoon. Not attached here, so this county's declarations may be short by 2.";
    const h = { ...HISTORY, data: { ...HISTORY.data, fips: "02105", declarations: [{ ...decl(1), disasterNumber: 4533 }], declarationRows: 1, missing: [{ source: "FEMA legacy-code rows", reason: "join:filed_under_other_code", detail }] } };
    const r = await run({ fips: "48453", topics: ["hazards"] }, { "/api/hazards?op=history": h }).reply;
    expect(topicsOf(r).hazards.items.filter((i) => i.fact === "FEMA declaration").map((i) => i.code)).toEqual(["DR-4533"]);
    const m = topicsOf(r).hazards.missing!.find((x) => x.what === "FEMA legacy-code rows")!;
    expect(m.reason).toMatch(/this county's FEMA count may be short \(join:filed_under_other_code\): Chatham Regional Educational Attendance Area \(EM-3446, DR-4585\)/);
  });

  it("USDM's this-week call failing is a missing entry in plain words, not 'not in the reply'; the weekly index's citation is untouched", async () => {
    const h = { ...HISTORY, data: { ...HISTORY.data, droughtNow: null, missing: [{ source: "USDM this week", reason: "source:failed", detail: "usdm 503" }] } };
    const r = await run({ fips: "48453", topics: ["hazards"] }, { "/api/hazards?op=history": h }).reply;
    const hz = topicsOf(r).hazards;
    expect(hz.items.some((i) => i.fact.startsWith("U.S. Drought Monitor this week"))).toBe(false);
    expect(hz.missing).toContainEqual({ what: "U.S. Drought Monitor this week", code: "failed", action: "retry", reason: "USDM failed on this call (source:failed): usdm 503" });
    expect(hz.missing!.some((x) => x.what === "USDM this week")).toBe(false);
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

describe("world_context: a county is centred on Census's internal point", () => {
  // Ten counties across the table: Mobile (the eval's 11 km case), a CT planning region, Alaska, Puerto Rico, Hawaii.
  const SAMPLE = ["01097", "09110", "30069", "02063", "72127", "48453", "15003", "06037", "42091", "36061"];

  it("for 10 counties, place.point equals the county table's point and the boxes centre on it, never on the screener's anchor", async () => {
    for (const fips of SAMPLE) {
      const c = countyByFips(fips)!;
      expect(c, fips).toBeTruthy();
      // The screener answers with an anchor 0.1 degrees away: the tool must not use it.
      const screen = screenRow({ geoid: fips });
      (screen.data.rows[0] as { geo: number[] }).geo = [c.lon + 0.1, c.lat + 0.1];
      const { f, reply } = run({ fips, topics: ["hazards", "institutions", "water"] }, { "/api/screen?kind=county": screen });
      const r = await reply;
      const pt = (r.payload.place as { point: JsonObject }).point;
      expect([pt.lon, pt.lat], fips).toEqual([Math.round(c.lon * 1e4) / 1e4, Math.round(c.lat * 1e4) / 1e4]);
      expect(pt, fips).toMatchObject({ sourceId: "census-tigerweb", publisher: "U.S. Census Bureau", upstreamRecordUrl: expect.stringContaining(`GEOID%3D'${fips}'`) });
      expect(pt.upstreamRecordUrl, fips).toMatch(/^https:\/\/tigerweb\.geo\.census\.gov\/arcgis\/rest\/services\/Generalized_ACS2023\/State_County\/MapServer\/13\/query\?.*INTPTLAT,INTPTLON/);
      expect(f.calls, fips).toContain(`/api/fabric?op=stack&lon=${pt.lon}&lat=${pt.lat}`);
      const box = (r.payload.place as { searchBox: number[] }).searchBox;
      expect([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2].map((x) => Math.round(x * 1e3) / 1e3), fips).toEqual([Math.round(c.lon * 1e3) / 1e3, Math.round(c.lat * 1e3) / 1e3]);
      expect(f.calls.find((x) => x.startsWith("/api/infra?op=hospitals")), fips).toBe(`/api/infra?op=hospitals&bbox=${box.join(",")}`);
      expect(f.calls, fips).toContain(`/api/water?op=pfas&bbox=${waterBox(pt.lon as number, pt.lat as number).join(",")}&polygons=1`);
    }
  });

  it("in every recorded county fixture, Census TIGERweb puts the point inside that county", async () => {
    const counties = recorded.filter(([, rec]) => typeof rec.input.fips === "string" && String(rec.input.fips).length === 5);
    expect(counties.length).toBeGreaterThanOrEqual(5);
    for (const [label, rec] of counties) {
      const r = await runRecorded(rec);
      const pt = (r.payload.place as { point: { lon: number; lat: number } }).point;
      const stack = rec.routes[`/api/fabric?op=stack&lon=${pt.lon}&lat=${pt.lat}`];
      expect(stack, `${label}: the fabric was recorded at the Census point`).toBeDefined();
      const county = ((stack.body.data as JsonObject).nodes as JsonObject[]).find((n) => n.kind === "county");
      expect(county?.code, label).toBe(rec.input.fips);
    }
  });

  it("without the county table the county has no point, says why, and no box is searched", async () => {
    const f = router();
    const r = await worldContext(toolByName("world_context")!.inputSchema.parse({ fips: "48453", topics: ["institutions"] }) as never, { fetchJson: f.fetchJson });
    expect((r.payload.place as JsonObject).point).toBeNull();
    expect(topicsOf(r).identity.missing).toContainEqual(expect.objectContaining({ what: "the county's point", reason: expect.stringMatching(/without eye's county table/) }));
    expect(f.calls.some((c) => c.startsWith("/api/infra"))).toBe(false);
  });
});

describe("world_context: water", () => {
  it("names the system whose EPA service area holds the point, by PWSID, with its UCMR 5 status and detections, each with EPA's record", async () => {
    const r = await run({ lon: -97.74, lat: 30.27, topics: ["water"] }).reply;
    const w = topicsOf(r).water.items;
    expect(w.map((i) => [i.fact, i.value])).toEqual([
      ["community water system serving the point (EPA service area)", "TX2270001"],
      ["UCMR 5 PFAS status of the system", "detected"],
      ["UCMR 5 highest single result: PFOA", 4.1],
    ]);
    // The system next door (its polygon does not hold the point) is not named.
    expect(JSON.stringify(w)).not.toContain("TX2270999");
    // Water system names are never copied.
    expect(JSON.stringify(r.payload)).not.toContain("CITY OF EXAMPLE");
    expect(w[0].upstreamRecordUrl).toBe("https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query?where=PWSID%3D'TX2270001'&outFields=PWSID,Population_Served_Count&returnGeometry=false&f=json");
    expect(w[2].upstreamRecordUrl).toMatch(/PFAS_Analytic_Tools_Layers\/FeatureServer\/1\/query\?where=F_PWS_ID%3D'TX2270001'%20AND%20UCMR_Cycle%3D'UCMR%205%20\(2023-2025\)'%20AND%20Contaminant%3D'PFOA'/);
    expect(w[1].note).toMatch(/^1 of 2 PFAS at or above/);
  });

  const water = (over: JsonObject): Record<string, Answer> => ({ "/api/water?op=pfas": { ...WATER, ...over } });

  it("a failed, cut or empty answer is a missing entry with its reason, never a 0 or 'not detected'", async () => {
    const cases: Array<[string, Record<string, Answer>, RegExp]> = [
      ["route failed", { "/api/water?op=pfas": { status: 502, body: { error: "EPA 503" } } }, /^HTTP 502: EPA 503$/],
      ["service areas failed", water({ provenance: WATER.provenance.filter((p) => p.source.id !== "epa-cws-boundaries"), coverage: [{ id: "service-areas", state: "error", count: null }] }), /epa-cws-boundaries: the route sent no provenance/],
      ["layer error with provenance", water({ coverage: [{ id: "service-areas", state: "error", count: null }] }), /did not answer this time .*unknown, not none/],
      ["cut at the record limit", water({ coverage: [{ id: "service-areas", state: "partial", count: 2000 }], data: { type: "FeatureCollection", features: [] } }), /hit its record limit/],
      ["no area holds the point", water({ data: { type: "FeatureCollection", features: [WATER.data.features[1]] } }), /no EPA community water system service area contains the point: .*this is not a 0/],
    ];
    for (const [label, over, reason] of cases) {
      const r = await run({ lon: -97.74, lat: 30.27, topics: ["water"] }, over).reply;
      const s = topicsOf(r).water;
      expect(s.items, label).toEqual([]);
      expect(s.missing!.find((m) => m.what === "community water system serving the point")?.reason, label).toMatch(reason);
      expect(s.coverageStatus, label).toMatchObject({ status: "partial" });
    }
    // Results unknown for the system: the system is named, its PFAS are a missing entry, never "not detected".
    const f0 = WATER.data.features[0];
    const unknown = { ...f0, properties: { ...f0.properties, extra: { ...f0.properties.extra, state: "unknown", results: [] } } };
    const r = await run({ lon: -97.74, lat: 30.27, topics: ["water"] }, water({ data: { type: "FeatureCollection", features: [unknown] } })).reply;
    expect(topicsOf(r).water.items.map((i) => i.fact)).toEqual(["community water system serving the point (EPA service area)"]);
    expect(topicsOf(r).water.missing).toContainEqual(expect.objectContaining({ what: "UCMR 5 PFAS results for TX2270001", reason: expect.stringMatching(/unknown, never 'not detected'/) }));
    // UCMR 5 results without EPA's results provenance: no status, a missing entry.
    const noPat = await run({ lon: -97.74, lat: 30.27, topics: ["water"] }, water({ provenance: WATER.provenance.filter((p) => p.source.id !== "epa-ucmr5-pat") })).reply;
    expect(topicsOf(noPat).water.items.map((i) => i.fact)).toEqual(["community water system serving the point (EPA service area)"]);
    expect(topicsOf(noPat).water.missing!.map((m) => m.reason)).toContain("epa-ucmr5-pat: the route sent no provenance for it, so nothing from it is shown");
  });

  it("a state asks no water route and says why", async () => {
    const { f, reply } = run({ fips: "48000", topics: ["water"] });
    const r = await reply;
    expect(f.calls.some((c) => c.startsWith("/api/water"))).toBe(false);
    expect(topicsOf(r).water.missing![0].reason).toMatch(/a state has no single water system/);
  });

  it("Collegeville PA (recorded): the Collegeville-Trappe system by PWSID, PFOA 235 ng/L, every row cited to EPA's own record", async () => {
    const rec = recorded.find(([k]) => k === "collegeville_pa_pt")![1];
    const r = await runRecorded(rec);
    const w = topicsOf(r).water.items;
    expect(w[0]).toMatchObject({ fact: "community water system serving the point (EPA service area)", value: "PA1460022", sourceId: "epa-cws-boundaries" });
    expect(w.find((i) => i.fact === "UCMR 5 highest single result: PFOA")).toMatchObject({ value: 235, unit: "ng/L", sourceId: "epa-ucmr5-pat" });
    expect(w.every((i) => /^https:\/\/services\.arcgis\.com\/cJ9YHowT8TU7DUyn\//.test(i.upstreamRecordUrl ?? ""))).toBe(true);
    expect(JSON.stringify(r.payload)).not.toMatch(/COLLEGEVILLE TRAPPE/);
  });

  it("ringsContain: inside, outside, a hole, a multipolygon", () => {
    expect(ringsContain(sq(0, 0, 1, 1), 0.5, 0.5)).toBe(true);
    expect(ringsContain(sq(0, 0, 1, 1), 1.5, 0.5)).toBe(false);
    expect(ringsContain([sq(0, 0, 1, 1)[0], sq(0.25, 0.25, 0.75, 0.75)[0]], 0.5, 0.5)).toBe(false);
    expect(ringsContain([sq(5, 5, 6, 6), sq(0, 0, 1, 1)], 0.5, 0.5)).toBe(true);
  });
});

describe("world_context: release items cite a schedule an agent can fetch, or say it cannot", () => {
  // Every schedule page the calendar can send, filed by hand: curl -A groundtruth-eval/0.1, 2026-10-18.
  // A new page fails here until someone checks it and files it.
  const ANSWERED_200 = [
    "https://data.bts.gov/Research-and-Statistics/Border-Crossing-Entry-Data/keg4-3bc2",
    "https://data.bts.gov/Research-and-Statistics/Supply-Chain-Indicators/y5ut-ibwt",
    "https://datatopics.worldbank.org/world-development-indicators/",
    "https://droughtmonitor.unl.edu/About/WhatistheUSDM.aspx",
    "https://wits.worldbank.org/",
    "https://www.bea.gov/news/schedule",
    "https://www.census.gov/construction/nrc/index.html",
    "https://www.census.gov/construction/nrs/index.html",
    "https://www.census.gov/retail/release_schedule.html",
    "https://www.eia.gov/petroleum/data.php",
    "https://www.freddiemac.com/pmms",
  ];
  const ANSWERED_403 = [
    "https://www.bls.gov/schedule/news_release/cewqtr.htm",
    "https://www.bls.gov/schedule/news_release/empsit.htm",
    "https://www.bts.gov/ports",
    "https://www.spglobal.com/spdji/en/index-family/indicators/sp-corelogic-case-shiller/",
    "https://www.zillow.com/research/data/",
  ];
  // Neither 200 nor 403 from this box: a TLS failure (USGS) and a 404 (BEA's motor-vehicles page). No note claims a block for them.
  const OTHER = ["https://waterdata.usgs.gov/nwis", "https://www.bea.gov/data/consumer-spending/motor-vehicles"];

  it("every scheduleUrl on the calendar has been checked and filed", () => {
    const urls = [...new Set(RELEASE_CALENDAR.map((e) => e.scheduleUrl).filter((u): u is string => !!u))].sort();
    expect(urls.filter((u) => ![...ANSWERED_200, ...ANSWERED_403, ...OTHER].includes(u))).toEqual([]);
  });

  it("a release whose schedule page answered 403 keeps it and says the page blocks automated clients; the others do not", async () => {
    const all = [...ANSWERED_403, ...ANSWERED_200, ...OTHER];
    const releases = all.map((u, i) => ({ id: `r${i}`, sourceId: "bls-qcew", title: `R${String(i).padStart(2, "0")}`, window: { nominal: `2026-11-${String(i + 1).padStart(2, "0")}` }, scheduleUrl: u }));
    const seen: WorldItem[] = [];
    for (const part of [releases.slice(0, 9), releases.slice(9)]) {
      const r = await run({ fips: "48453", topics: ["economy", "freshness"], max_records: 10 }, { "/api/releases?op=calendar": { ...CALENDAR, data: { ...CALENDAR.data, releases: part } } }).reply;
      seen.push(...topicsOf(r).freshness.items);
    }
    expect(seen.map((i) => i.upstreamUrl).sort()).toEqual([...all].sort());
    for (const it of seen) expect(String(it.note).includes(SCHEDULE_BLOCKED_NOTE), it.upstreamUrl).toBe(ANSWERED_403.includes(it.upstreamUrl));
  });
});

// ---- typed absence --------------------------------------------------------------

describe("world_context: typed absence", () => {
  it("every REASONS key and every MISSING_NAMES entry maps to a code (an unmapped key fails here by name)", () => {
    for (const k of Object.keys(REASONS)) expect(ROUTE_REASON_CODE[k], `REASONS key ${k} has a code`).toBeDefined();
    for (const [name, id] of Object.entries(MISSING_NAMES)) {
      expect(id, name).toMatch(/^[a-z0-9-]+$/);
      // a route listing this name as failed is a failure, whichever source it names
      expect(codeForRouteEntry({ source: name, reason: "source:failed" }), `MISSING_NAMES entry ${name}`).toBe("failed");
      expect(codeForRouteEntry({ source: name }), `MISSING_NAMES entry ${name} with no reason`).toBe("failed");
    }
  });

  const variants: Array<[string, string | null, (id: string) => AbsenceCode]> = [
    ["the route lists it failed", "source:failed", () => "failed"],
    ["the route lists it with no reason", "", () => "failed"],
    ["the route lists it not in the release", "source:not_in_release", () => "not_in_release"],
    ["the route lists Puerto Rico as not published", "source:not_published_for_puerto_rico", () => "not_published"],
    ["the route lists a legacy Connecticut county", "join:legacy_ct_counties", () => "join_gap"],
    ["the route lists rows filed under another code", "join:filed_under_other_code", () => "filed_under_other_code"],
    ["the route sent no provenance and does not list it", null, (id) => (id === "eye-catalog" ? "about_eye" : "no_citation")],
  ];

  for (const [what, reason, want] of variants) {
    it(`${what}: the entry its item became carries the matching code`, async () => {
      let checked = 0;
      for (const [label, rec] of recorded) {
        for (const [p, ids] of citedPairs(await runRecorded(rec))) {
          for (const id of ids) {
            const body = structuredClone(rec.routes[p].body);
            body.provenance = ((body.provenance as JsonObject[]) ?? []).filter((x) => (x.source as JsonObject)?.id !== id);
            if (reason !== null) {
              const data = (body.data ??= {}) as JsonObject;
              data.missing = [...((data.missing as unknown[]) ?? []), reason ? { source: id, reason } : { source: id }];
            }
            const r = await runRecorded({ ...rec, routes: { ...rec.routes, [p]: { ...rec.routes[p], body } } });
            const own = Object.values(topicsOf(r))
              .flatMap((sec) => sec.missing ?? [])
              .filter((m) => m.reason.startsWith(`${id}: `));
            expect(own.length, `${label}: ${id} from ${p}`).toBeGreaterThan(0);
            for (const m of own) expect(m.code, `${label}: ${id} from ${p}: ${m.reason}`).toBe(want(id));
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(30);
    });
  }

  it("every missing entry in a recorded reply has the action its code carries, and a code from the closed list", async () => {
    for (const [label, rec] of recorded) {
      const r = await runRecorded(rec);
      for (const sec of Object.values(topicsOf(r))) {
        for (const m of sec.missing ?? []) {
          expect(Object.keys(ABSENCE_CODES), `${label}: ${m.what}`).toContain(m.code);
          expect(m.action, `${label}: ${m.what}`).toBe(ABSENCE_CODES[m.code].action);
        }
      }
    }
  });

  it("a Connecticut region's gap is a join gap the agent can narrow around; no recorded reply claims withheld from a missing entry", async () => {
    const ct = await runRecorded(recorded.find(([k]) => k === "ct_09110")![1]);
    const ctMissing = Object.values(topicsOf(ct)).flatMap((sec) => sec.missing ?? []);
    expect(ctMissing.some((m) => m.code === "join_gap" && m.action === "narrow")).toBe(true);
    for (const [label, rec] of recorded) {
      const r = await runRecorded(rec);
      expect(Object.values(topicsOf(r)).flatMap((sec) => sec.missing ?? []).every((m) => m.code !== "withheld"), label).toBe(true);
    }
  });
});

// ---- the published outputSchema ---------------------------------------------------

type Loose = Record<string, unknown> & { topics: Record<string, { items: Array<Record<string, unknown>>; missing?: Array<Record<string, unknown>>; coverageStatus?: { basis: unknown[] } & Record<string, unknown> }> };

describe("world_context: outputSchema", () => {
  const austin = async (): Promise<Loose> => structuredClone((await runRecorded(recorded.find(([k]) => k === "austin_pt")![1])).payload) as Loose;

  it("is world/2, and every recorded reply validates against it as the structuredContent a client gets", async () => {
    expect(WORLD_OUTPUT_SCHEMA.properties.schemaVersion.const).toBe(WORLD_SCHEMA_VERSION);
    expect(WORLD_SCHEMA_VERSION).toBe("world/2");
    for (const [label, rec] of recorded) {
      const r = await runRecorded(rec);
      expect(r.payload.schemaVersion, label).toBe("world/2");
      const v = validateWorld(toCallResult(r).structuredContent);
      expect(v.errorMessage, label).toBeUndefined();
      expect(v.valid, label).toBe(true);
    }
  });

  it("carries a host rule for every source in RECORD_HOSTS", () => {
    const text = JSON.stringify(WORLD_OUTPUT_SCHEMA);
    for (const id of Object.keys(RECORD_HOSTS)) expect(text, id).toContain(JSON.stringify(id));
  });

  it("tamper: a null value without a note fails, and the error names note", async () => {
    const p = await austin();
    const first = p.topics.identity.items[0];
    first.value = null;
    delete first.note;
    const v = validateWorld(p);
    expect(v.valid).toBe(false);
    expect(v.errorMessage).toContain("note");
    // with a note it is valid again
    first.note = "withheld by the publisher: null, not 0; no record-level URL: test";
    delete first.upstreamRecordUrl;
    expect(validateWorld(p).errorMessage).toBeUndefined();
  });

  /** The first recorded reply with a section that lists missing entries (and so has a coverageStatus). */
  const withMissing = async (): Promise<Loose> => {
    for (const [, rec] of recorded) {
      const p = structuredClone((await runRecorded(rec)).payload) as Loose;
      if (Object.values(p.topics).some((x) => x.missing?.length && x.coverageStatus)) return p;
    }
    throw new Error("no recorded reply lists a missing entry");
  };

  it("tamper: a section with missing entries but no coverageStatus fails, and the error names coverageStatus", async () => {
    const p = await withMissing();
    const sec = Object.values(p.topics).find((x) => x.missing?.length && x.coverageStatus)!;
    expect(sec).toBeDefined();
    delete sec.coverageStatus;
    const v = validateWorld(p);
    expect(v.valid).toBe(false);
    expect(v.errorMessage).toContain("coverageStatus");
  });

  it("tamper: a missing entry without code, a basis line that is a bare string, status complete and an unknown kind all fail", async () => {
    const a = await withMissing();
    const sec = Object.values(a.topics).find((x) => x.missing?.length)!;
    delete sec.missing![0].code;
    expect(validateWorld(a).errorMessage).toContain("code");

    const b = await withMissing();
    const withCs = Object.values(b.topics).find((x) => x.coverageStatus)!;
    withCs.coverageStatus!.basis[0] = "a bare string";
    expect(validateWorld(b).valid).toBe(false);

    const c = await austin();
    (c.coverageStatus as { status: string }).status = "complete";
    expect(validateWorld(c).valid, "no 'complete' (that reversal is Cam's call)").toBe(false);

    const d = await austin();
    d.topics.identity.items[0].kind = "about-world";
    expect(validateWorld(d).valid).toBe(false);
  });

  it("tamper: shared ArcGIS hosts are told apart by org id, so a fema-nri item cannot cite EPA's or HIFLD's layer", async () => {
    const EPA = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query?where=x&f=json";
    const NRI = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query?where=x&f=json";
    const HIFLD = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Hospitals_RAPT/FeatureServer/6/query?where=x&f=json";
    const ORG_XG = "XG15cJAlne2vxtgt";
    const ORG_CJ = "cJ9YHowT8TU7DUyn";
    // [source id, a URL on the right org, a URL on the wrong org]
    const cases: Array<[string, string, string]> = [
      ["fema-nri", NRI, EPA],
      ["hifld-hospitals", HIFLD, EPA],
      ["epa-cws-boundaries", EPA, NRI],
      ["epa-ucmr5-pat", EPA.replace("Water_System_Boundaries", "PFAS_Analytic_Tools_Layers"), NRI],
    ];
    for (const [id, good, bad] of cases) {
      const base = await austin();
      const item = { fact: "x", value: 1, sourceId: id, publisher: "p", upstreamUrl: "https://services.arcgis.com/", retrievedAt: "2026-10-18T12:00:00.000Z", link: "http://t/x", upstreamRecordUrl: good };
      base.topics.identity.items = [item];
      expect(validateWorld(base).errorMessage, `${id} on its own org`).toBeUndefined();
      item.upstreamRecordUrl = bad;
      const v = validateWorld(base);
      expect(v.valid, `${id} citing the other org's layer`).toBe(false);
      expect(v.errorMessage).toContain("upstreamRecordUrl");
    }
    expect(ORG_XG).not.toBe(ORG_CJ);
  });

  it("tamper: a record URL on another publisher's host, a retrievedAt without Z, an item with no link, and a missing record URL not said in the note all fail", async () => {
    const a = await austin();
    const rec = Object.values(a.topics)
      .flatMap((x) => x.items)
      .find((i) => i.sourceId === "census-tigerweb" && i.upstreamRecordUrl)!;
    rec.upstreamRecordUrl = "https://evil.example/tigerweb";
    const v = validateWorld(a);
    expect(v.valid).toBe(false);
    expect(v.errorMessage).toContain("upstreamRecordUrl");

    const b = await austin();
    b.topics.identity.items[0].retrievedAt = "2026-10-18T12:00:00+02:00";
    expect(validateWorld(b).valid).toBe(false);

    const c = await austin();
    delete c.topics.identity.items[0].link;
    expect(validateWorld(c).valid).toBe(false);

    const d = await austin();
    const noRecord = Object.values(d.topics)
      .flatMap((x) => x.items)
      .find((i) => !i.upstreamRecordUrl)!;
    noRecord.note = "something else";
    expect(validateWorld(d).valid, "an item with no record URL must say so in its note").toBe(false);
  });

  it("the typed error envelope validates too: the SDK client checks structuredContent even when isError is true", async () => {
    const notFound = await run({ fips: "99999" }, { "/api/screen?kind=county": { data: { rows: [], total: 0 }, provenance: [] } }).reply;
    expect(notFound.status).toBe(404);
    expect(validateWorld(toCallResult(notFound).structuredContent).errorMessage).toBeUndefined();
    const down: Record<string, Answer> = Object.fromEntries(BASE.map(([k]) => [k, { status: 503, body: { error: "down" } }]));
    const nothing = await run({ lon: -97.74, lat: 30.27 }, down).reply;
    expect(nothing.status).toBe(502);
    expect(validateWorld(toCallResult(nothing).structuredContent).errorMessage).toBeUndefined();
    // and a client that has listed the tools gets the envelope back as a result, not a thrown McpError
    const f = router({ "/api/screen?kind=county": { data: { rows: [], total: 0 }, provenance: [] } });
    const server = createServer({ fetchJson: f.fetchJson });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    await client.listTools();
    const res = await client.callTool({ name: "world_context", arguments: { fips: "99999" } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ code: "not_found", retryable: false });
    // an error envelope is not a licence: a reply with an error key but no envelope fields is invalid
    expect(validateWorld({ error: "x" }).valid).toBe(false);
  });

  it("a client that has listed the tools validates the reply against the published schema and still gets it", async () => {
    const f = router();
    const server = createServer({ fetchJson: f.fetchJson });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await server.connect(st);
    await client.connect(ct);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "world_context")!.outputSchema).toEqual(JSON.parse(JSON.stringify(WORLD_OUTPUT_SCHEMA)));
    const res = await client.callTool({ name: "world_context", arguments: { lon: -97.74, lat: 30.27 } });
    expect(res.isError).toBe(false);
    expect((res.structuredContent as { schemaVersion: string }).schemaVersion).toBe("world/2");
  });
});
