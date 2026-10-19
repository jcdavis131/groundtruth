import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PLACE_EXPORTS } from "../catalog/placeExport";
import { NRI_SOVI_NOTE } from "../hazards/nri";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ERROR_ENVELOPE_SCHEMA, InvalidArguments } from "./errors";
import { errorResult, toCallResult } from "./server";
import { asObject, boundPayload, httpFetchJson, NOT_DEPLOYED_NOTE, qs, relay, SOVI_LINEAGE_NOTE, stripGeometry, toolByName, TOOLS, type FetchJson, type JsonReply } from "./tools";

const validateEnvelope = new AjvJsonSchemaValidator().getValidator(ERROR_ENVELOPE_SCHEMA as never);

/** An isError result's envelope, after checking it against the schema and that text and structuredContent agree. */
function envelopeOf(r: CallToolResult): Record<string, unknown> {
  expect(r.isError).toBe(true);
  const text = JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
  expect(r.structuredContent).toEqual(text);
  const v = validateEnvelope(text);
  expect(v.errorMessage).toBeUndefined();
  return text;
}

/** A fetchJson that records the path and answers what the test asked for. */
function fake(status = 200, body: unknown = { source: "x", data: { ok: true } }): { calls: string[]; fetchJson: FetchJson } {
  const calls: string[] = [];
  return {
    calls,
    fetchJson: async (p) => {
      calls.push(p);
      return { status, body, url: "http://t" + p };
    },
  };
}

async function urlFor(name: string, input: unknown): Promise<string> {
  const f = fake();
  await toolByName(name)!.run(input, { fetchJson: f.fetchJson });
  expect(f.calls).toHaveLength(1);
  return f.calls[0];
}

describe("qs", () => {
  it("keeps order, skips empties, leaves commas and colons readable", () => {
    expect(qs({ op: "gauges", bbox: "-98.6,29.2,-98.2,29.6", param: undefined, x: null, y: "" })).toBe("?op=gauges&bbox=-98.6,29.2,-98.2,29.6");
    expect(qs({ site: "USGS-08180800", q: "a b&c" })).toBe("?site=USGS-08180800&q=a%20b%26c");
    expect(qs({})).toBe("");
  });
});

describe("every tool asks for the exact route URL", () => {
  const cases: [string, unknown, string][] = [
    ["water_report", { lon: -98.49, lat: 29.42 }, "/api/water?op=report&lon=-98.49&lat=29.42"],
    ["market_report", { lon: -97.75, lat: 30.3 }, "/api/economy?op=report&lon=-97.75&lat=30.3"],
    ["areas", { bbox: [-98.5, 29.8, -97, 31] }, "/api/economy?op=areas&bbox=-98.5,29.8,-97,31"],
    ["areas", { level: "state" }, "/api/economy?op=areas&level=state"],
    ["sectors", { fips: "48453" }, "/api/economy?op=sectors&fips=48453"],
    ["sectors", { fips: "48000" }, "/api/economy?op=sectors&fips=48000"],
    ["ports", { bbox: [-96, 28.5, -93.5, 30.5], min: "all" }, "/api/economy?op=ports&bbox=-96,28.5,-93.5,30.5&min=all"],
    ["ports", { bbox: [-96, 28.5, -93.5, 30.5] }, "/api/economy?op=ports&bbox=-96,28.5,-93.5,30.5&min=medium"],
    ["border_crossings", {}, "/api/economy?op=border"],
    ["countries", {}, "/api/economy?op=countries"],
    ["trade_partners", { iso3: "usa" }, "/api/economy?op=partners&iso3=USA"],
    ["pulse", {}, "/api/economy?op=pulse"],
    ["gauges", { bbox: [-98.6, 29.2, -98.2, 29.6] }, "/api/water?op=gauges&bbox=-98.6,29.2,-98.2,29.6"],
    ["gauges", { bbox: [-98.6, 29.2, -98.2, 29.6], param: "63680" }, "/api/water?op=gauges&bbox=-98.6,29.2,-98.2,29.6&param=63680"],
    ["gauge_history", { site: "USGS-07032000", param: "00065" }, "/api/water?op=history&site=USGS-07032000&param=00065"],
    ["series_list", {}, "/api/series?op=list"],
    ["series_list", { prefix: "indicator:" }, "/api/series?op=list&prefix=indicator:"],
    ["series_get", { id: "fred:MORTGAGE30US" }, "/api/series?op=get&id=fred:MORTGAGE30US"],
    ["series_get", { id: "zhvi:county:48453", from: "2020-01-01", to: "2025-12-31", rollup: "daily-mean" }, "/api/series?op=get&id=zhvi:county:48453&from=2020-01-01&to=2025-12-31&rollup=daily-mean"],
    ["screen", { kind: "county", query: "home.yoyPct > 5 AND jobs.yoy.emp < 0 SORT momentum DESC LIMIT 50" }, "/api/screen?kind=county&q=home.yoyPct%20%3E%205%20AND%20jobs.yoy.emp%20%3C%200%20SORT%20momentum%20DESC%20LIMIT%2050"],
    ["screen", { kind: "crossing", fields: true }, "/api/screen?kind=crossing&fields=1"],
    ["screen", { kind: "port", query: "teu.yoyPct<0", fields: false }, "/api/screen?kind=port&q=teu.yoyPct%3C0"],
    ["indicators", {}, "/api/indicators?op=latest"],
    ["indicators", { ids: ["mississippi-memphis-stage", "mortgage-30y"], category: "water" }, "/api/indicators?op=latest&ids=mississippi-memphis-stage,mortgage-30y&category=water"],
    ["indicator_history", { id: "mississippi-memphis-stage" }, "/api/indicators?op=history&id=mississippi-memphis-stage"],
    ["indicator_history", { id: "mississippi-memphis-stage", from: "2025-09-01", limit: 500 }, "/api/indicators?op=history&id=mississippi-memphis-stage&from=2025-09-01&limit=500"],
    ["release_calendar", {}, "/api/releases?op=calendar"],
    ["release_calendar", { from: "2026-09-01", to: "2026-10-15" }, "/api/releases?op=calendar&from=2026-09-01&to=2026-10-15"],
    ["movers", { table: "zillow", metric: "zhviCounty", n: 10 }, "/api/releases?op=movers&table=zillow&metric=zhviCounty&n=10"],
    ["movers", { table: "qcew", metric: "emp", min: 10000 }, "/api/releases?op=movers&table=qcew&metric=emp&min=10000"],
    ["movers", { table: "ports" }, "/api/releases?op=movers&table=ports"],
    ["county_history", { fips: "48453" }, "/api/economy/history?op=county&fips=48453"],
    ["county_history", { fips: "48453", years: 5, lag: 3 }, "/api/economy/history?op=county&fips=48453&years=5&lag=3"],
    ["county_history", { fips: "48453", topic: "hazards" }, "/api/hazards?op=history&fips=48453&declarations=50"],
    ["county_history", { fips: "48453", years: 10, topic: "hazards" }, "/api/hazards?op=history&fips=48453&years=10&declarations=50"],
    ["county_history", { fips: "48453", topic: "economy" }, "/api/economy/history?op=county&fips=48453"],
    ["company", { ticker: "aapl" }, "/api/companies?op=company&ticker=AAPL"],
    ["company", { cik: "320193" }, "/api/companies?op=company&cik=320193"],
    ["companies_near", { fips: "48453" }, "/api/companies?op=county&fips=48453"],
    ["companies_near", { bbox: [-98, 30, -97, 31] }, "/api/companies?op=near&bbox=-98,30,-97,31"],
    ["banks", { fips: "48453" }, "/api/finance?op=banks&fips=48453"],
    ["federal_spending", { fips: "48453" }, "/api/finance?op=spending&fips=48453"],
    ["place_fabric", { lon: -97.74, lat: 30.27 }, "/api/fabric?op=stack&lon=-97.74&lat=30.27"],
    ["place_fabric", { lon: -97.74, lat: 30.27, geometry: true }, "/api/fabric?op=stack&lon=-97.74&lat=30.27&geometry=1"],
    ["place_compare", { lon: -97.4, lat: 27.8, lon2: -97.32, lat2: 27.88 }, "/api/fabric?op=compare&lon=-97.4&lat=27.8&lon2=-97.32&lat2=27.88"],
    ["construct_field", { bbox: [-100, 28, -94, 33], kind: "huc8" }, "/api/fabric?op=field&kind=huc8&bbox=-100,28,-94,33"],
    ["construct_field", { bbox: [-100, 28, -94, 33], pov: "civic", h: 400000 }, "/api/fabric?op=field&pov=civic&h=400000&bbox=-100,28,-94,33"],
    ["downstream", { lon: -97.74, lat: 30.27 }, "/api/fabric?op=downstream&lon=-97.74&lat=30.27"],
    ["upstream", { lon: -97.74, lat: 30.27 }, "/api/fabric?op=upstream&lon=-97.74&lat=30.27"],
    ["flow_normals", { sites: ["08158000", "USGS-08167000"], date: "09-23" }, "/api/water?op=normals&sites=08158000,USGS-08167000&date=09-23"],
    ["water_trace", { lon: -116.2023, lat: 43.615 }, "/api/water?op=reach&lon=-116.2023&lat=43.615"],
    ["water_trace", { comid: 23398863, mode: "gauges", distance: 150 }, "/api/water?op=trace&comid=23398863&mode=gauges&distance=150"],
    ["water_trace", { comid: 23398863, mode: "basin" }, "/api/water?op=trace&comid=23398863&mode=basin"],
    ["risk_index", { bbox: [-99, 29, -98, 30] }, "/api/hazards?op=nri&bbox=-99,29,-98,30"],
    ["risk_index", { bbox: [-98.55, 29.4, -98.45, 29.5], level: "tract" }, "/api/hazards?op=nri&bbox=-98.55,29.4,-98.45,29.5&level=tract"],
    ["broadband_availability", { fips: "48453" }, "/api/civic?op=broadband&level=place&fips=48453"],
    ["live_events", {}, "/api/live"],
    ["catalog_search", { q: "wetland habitat" }, "/api/catalog?op=search&q=wetland%20habitat"],
    ["catalog_search", { q: "dams", limit: 3 }, "/api/catalog?op=search&q=dams&limit=3"],
    ["place_export", { collection: "npl-status" }, "/api/catalog?op=place-export&collection=npl-status"],
    ["place_export", { collection: "fuds-properties" }, "/api/catalog?op=place-export&collection=fuds-properties"],
    ["place_export", { collection: "ust-releases-county" }, "/api/catalog?op=place-export&collection=ust-releases-county"],
    ["openapi", {}, "/api/openapi"],
  ];
  for (const [name, input, url] of cases) {
    it(`${name} ${JSON.stringify(input)} -> ${url}`, async () => {
      expect(await urlFor(name, input)).toBe(url);
    });
  }

  it("covers every registered tool", () => {
    // social_vulnerability asks two routes; its own describe below checks both URLs.
    const named = new Set([...cases.map((c) => c[0]), "social_vulnerability"]);
    for (const t of TOOLS) expect(named.has(t.name), t.name).toBe(true);
  });
});

describe("social_vulnerability", () => {
  const svi = { source: "cdc", data: { level: "county", fips: "48453", row: { rpl: [0.5702, 0.5527, 0.0935, 0.882, 0.7805] } } };
  const nri = { source: "fema", data: { level: "county", fips: "48453", row: { SOVI_SCORE: 14.75826972, SOVI_RATNG: "Very Low" } } };
  const answering = (byPath: (p: string) => JsonReply | null) => {
    const calls: string[] = [];
    const fetchJson: FetchJson = async (p) => {
      calls.push(p);
      return byPath(p) ?? { status: 500, body: { error: "unexpected" }, url: p };
    };
    return { calls, fetchJson };
  };

  it("asks CDC's place row and FEMA's row by FIPS, and returns both verbatim under their own titles", async () => {
    const f = answering((p) => (p.startsWith("/api/civic") ? { status: 200, body: svi, url: p } : { status: 200, body: nri, url: p }));
    const r = await toolByName("social_vulnerability")!.run({ fips: "48453" }, { fetchJson: f.fetchJson });
    expect(f.calls.sort()).toEqual(["/api/civic?op=svi&level=place&fips=48453", "/api/hazards?op=nri&fips=48453"]);
    expect(r.status).toBe(200);
    const cdc = r.payload.cdcSvi as Record<string, unknown>;
    const fema = r.payload.femaNri as Record<string, unknown>;
    expect(cdc.title).toMatch(/^CDC\/ATSDR Social Vulnerability Index 2022/);
    expect(fema.title).toMatch(/^FEMA National Risk Index: social vulnerability \(Census Community Resilience Estimate/);
    expect(cdc.data).toEqual(svi.data);
    expect(fema.data).toEqual(nri.data);
    // Nothing at the top level is computed from both.
    expect(Object.keys(r.payload).sort()).toEqual(["cdcSvi", "femaNri", "fips", "note"]);
    expect(r.payload.note).toContain(SOVI_LINEAGE_NOTE);
  });

  it("keeps CDC's side when FEMA has no row, and says which side is missing", async () => {
    const f = answering((p) => (p.startsWith("/api/civic") ? { status: 200, body: svi, url: p } : { status: 404, body: { error: "not in the index: FEMA's National Risk Index has no county row for FIPS 48453" }, url: p }));
    const r = await toolByName("social_vulnerability")!.run({ fips: "48453" }, { fetchJson: f.fetchJson });
    expect(r.status).toBe(200);
    expect((r.payload.cdcSvi as Record<string, unknown>).data).toEqual(svi.data);
    expect((r.payload.femaNri as Record<string, unknown>).status).toBe(404);
    expect((r.payload.femaNri as Record<string, unknown>).missing).toMatch(/^not in the index/);
  });

  it("quotes FEMA's lineage note exactly as lib/hazards/nri.ts does", () => {
    expect(SOVI_LINEAGE_NOTE).toBe(NRI_SOVI_NOTE);
  });
});

describe("input schemas reject bad input", () => {
  const bad: [string, unknown][] = [
    ["social_vulnerability", { fips: "4845" }],
    ["social_vulnerability", { fips: "484530013" }],
    ["broadband_availability", { fips: "4845" }],
    ["broadband_availability", { fips: "48453001308" }],
    ["water_report", { lon: 200, lat: 0 }],
    ["water_report", { lon: -98 }],
    ["areas", { bbox: [1, 2, 3] }],
    ["areas", { bbox: [3, 2, 1, 4] }], // west > east
    ["areas", { level: "metro" }],
    ["sectors", { fips: "4845" }],
    ["sectors", { fips: "US001" }],
    ["ports", { bbox: [-96, 28.5, -93.5, 30.5], min: "huge" }],
    ["trade_partners", { iso3: "US" }],
    ["gauges", { bbox: [-98.6, 29.2, -98.2, 29.6], param: "6368" }],
    ["gauge_history", { site: "07032000", param: "00065" }],
    ["series_get", { id: "bad id with spaces" }],
    ["series_get", { id: "x", from: "01/02/2020" }],
    ["series_get", { id: "x", rollup: "monthly" }],
    ["screen", { kind: "counties", query: "x" }],
    ["screen", { kind: "county" }], // neither query nor fields
    ["indicators", { category: "sports" }],
    ["indicators", { ids: ["Not Kebab"] }],
    ["indicator_history", { id: "has space" }],
    ["indicator_history", { id: "ok", limit: 0 }],
    ["movers", { table: "counties" }],
    ["movers", { table: "zillow", n: 0 }],
    ["movers", { table: "zillow", n: 1000 }],
    ["movers", { table: "zillow", metric: "zhvi County" }],
    ["county_history", { fips: "48453", years: 0 }],
    ["county_history", { fips: "48453", lag: 13 }],
    ["county_history", { fips: "48453", topic: "hazards", lag: 3 }],
    ["county_history", { fips: "48453", topic: "weather" }],
    ["company", {}],
    ["company", { ticker: "AAPL", cik: "320193" }],
    ["company", { cik: "abc" }],
    ["companies_near", {}],
    ["companies_near", { fips: "48453", bbox: [-98, 30, -97, 31] }],
    ["banks", { fips: "TX" }],
    ["water_trace", { lon: -116.2 }],
    ["water_trace", { comid: 23398863 }],
    ["water_trace", { lon: -116.2, lat: 43.6, comid: 23398863, mode: "down" }],
    ["water_trace", { comid: 23398863, mode: "down", distance: 900 }],
    ["risk_index", { bbox: [-98, 29, -99, 30] }],
    ["risk_index", { bbox: [-99, 29, -98, 30], level: "state" }],
    ["place_export", { collection: "attains-impaired" }],
  ];
  for (const [name, input] of bad) {
    it(`${name} ${JSON.stringify(input)}`, async () => {
      const f = fake();
      const err = await toolByName(name)!.run(input, { fetchJson: f.fetchJson }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(f.calls).toHaveLength(0);
      // The reply a client sees for it: a schema-valid envelope, bad input, not worth a retry.
      expect(envelopeOf(errorResult(err))).toMatchObject({ code: "invalid_arguments", category: "invalid_input", retryable: false });
    });
  }

  it("areas without bbox at county level is an error, not a fetch", async () => {
    const f = fake();
    await expect(toolByName("areas")!.run({}, { fetchJson: f.fetchJson })).rejects.toThrow(/bbox/);
    await expect(toolByName("areas")!.run({}, { fetchJson: f.fetchJson })).rejects.toBeInstanceOf(InvalidArguments);
    expect(f.calls).toHaveLength(0);
  });

  it("place_export offers exactly the committed exports", () => {
    const js = z.toJSONSchema(toolByName("place_export")!.inputSchema) as unknown as { properties: { collection: { enum: string[] } } };
    expect(js.properties.collection.enum).toEqual([...PLACE_EXPORTS]);
  });

  it("schemas are strict-ish: every tool has an object schema that converts to JSON schema", () => {
    for (const t of TOOLS) {
      const js = z.toJSONSchema(t.inputSchema) as { type: string };
      expect(js.type).toBe("object");
    }
  });
});

describe("relay", () => {
  it("returns the route JSON verbatim on 200", async () => {
    const body = { source: "BLS QCEW", fips: "48453", data: { period: "2026-Q1", sectors: [] } };
    const f = fake(200, body);
    const r = await relay({ fetchJson: f.fetchJson }, "/api/economy?op=sectors&fips=48453");
    expect(r.status).toBe(200);
    expect(r.payload).toEqual(body);
  });

  it("adds the not-deployed note when a 404 is the server's HTML page, and keeps the body", async () => {
    const html = { error: "non-JSON reply", text: "<!DOCTYPE html><title>404: This page could not be found.</title>" };
    const f = fake(404, html);
    const r = await relay({ fetchJson: f.fetchJson }, "/api/series?op=list");
    expect(r.status).toBe(404);
    expect(r.payload).toEqual({ ...html, note: NOT_DEPLOYED_NOTE });
    expect(envelopeOf(toCallResult(r))).toMatchObject({ error: "non-JSON reply", code: "route_not_deployed", retryable: false });
  });

  it("treats a route's own JSON 404 as an answer, not a missing route", async () => {
    const f = fake(404, { error: "cik 1234567 is not a company in the SEC issuer universe" });
    const r = await relay({ fetchJson: f.fetchJson }, "/api/companies?op=company&cik=1234567");
    expect(r.status).toBe(404);
    expect(r.payload.note).toBe("route answered HTTP 404");
    expect(envelopeOf(toCallResult(r))).toMatchObject({ code: "not_found", category: "invalid_input", retryable: false });
  });

  it("notes other error statuses", async () => {
    const f = fake(502, { error: "upstream failure", upstream: "usgs-water" });
    const r = await relay({ fetchJson: f.fetchJson }, "/api/water?op=report&lon=0&lat=0");
    expect(r.payload.note).toBe("route answered HTTP 502");
    expect(r.payload.upstream).toBe("usgs-water");
    expect(envelopeOf(toCallResult(r))).toMatchObject({ error: "upstream failure", code: "upstream_failure", category: "unavailable", retryable: true });
  });

  it("wraps non-object bodies so a note can be attached", async () => {
    const f = fake(404, "Not Found");
    const r = await relay({ fetchJson: f.fetchJson }, "/openapi.json");
    expect(r.payload).toEqual({ data: "Not Found", note: NOT_DEPLOYED_NOTE });
    expect(asObject([1, 2])).toEqual({ data: [1, 2] });
  });

  it("strips geometry only when asked and says so", async () => {
    const fc = { source: "x", data: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { id: "48453" } }] } };
    const f = fake(200, fc);
    const dropped = await relay({ fetchJson: f.fetchJson }, "/x", { dropGeometry: true });
    const feats = (dropped.payload.data as { features: { geometry: unknown }[] }).features;
    expect(feats[0].geometry).toBeNull();
    expect(String(dropped.payload.note)).toMatch(/geometry omitted/);
    const kept = await relay({ fetchJson: f.fetchJson }, "/x");
    expect((kept.payload.data as { features: { geometry: unknown }[] }).features[0].geometry).toEqual({ type: "Polygon", coordinates: [] });
    expect(kept.payload.note).toBeUndefined();
  });

  it("areas drops geometry by default and keeps it with geometry: true", async () => {
    const fc = { data: { type: "FeatureCollection", features: [{ geometry: { type: "Polygon" }, properties: {} }] } };
    const f = fake(200, fc);
    const a = await toolByName("areas")!.run({ bbox: [-98, 30, -97, 31] }, { fetchJson: f.fetchJson });
    expect((a.payload.data as { features: { geometry: unknown }[] }).features[0].geometry).toBeNull();
    const b = await toolByName("areas")!.run({ bbox: [-98, 30, -97, 31], geometry: true }, { fetchJson: f.fetchJson });
    expect((b.payload.data as { features: { geometry: unknown }[] }).features[0].geometry).toEqual({ type: "Polygon" });
  });
});

describe("stripGeometry / boundPayload", () => {
  it("leaves payloads without features alone", () => {
    const p = { data: { a: 1 } };
    expect(stripGeometry(p)).toBe(p);
    expect(boundPayload(p, 10)).toBe(p);
  });

  it("halves feature lists until under the budget and reports the counts", () => {
    const features = Array.from({ length: 64 }, (_, i) => ({ properties: { i, pad: "x".repeat(100) } }));
    const out = boundPayload({ data: { type: "FeatureCollection", features } }, 2000);
    const kept = (out.data as { features: unknown[] }).features.length;
    expect(kept).toBeLessThan(64);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(2000 + 200); // note text is added after the size check
    expect(String(out.note)).toMatch(new RegExp(`first ${kept} of 64`));
  });

  it("halves plain data arrays too", () => {
    const out = boundPayload({ data: Array.from({ length: 100 }, (_, i) => ({ i, pad: "y".repeat(50) })) }, 1500);
    expect((out.data as unknown[]).length).toBeLessThan(100);
    expect(String(out.note)).toMatch(/of 100 items/);
  });

  it("appends to an existing note instead of replacing it", () => {
    const fc = { note: "upstream partial.", data: { type: "FeatureCollection", features: [{ geometry: { type: "Point" } }] } };
    expect(stripGeometry(fc).note).toMatch(/^upstream partial\. geometry omitted/);
  });
});

describe("httpFetchJson", () => {
  const mk = (status: number, text: string, seen: string[]) => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push(String(url));
      expect((init?.headers as Record<string, string>).accept).toBe("application/json");
      return new Response(text, { status });
    }) as unknown as typeof fetch;
    return httpFetchJson("http://localhost:3000/", fetchImpl);
  };

  it("joins base and path, parses JSON, reports status and url", async () => {
    const seen: string[] = [];
    const r: JsonReply = await mk(200, '{"a":1}', seen)("/api/economy?op=pulse");
    expect(seen).toEqual(["http://localhost:3000/api/economy?op=pulse"]);
    expect(r).toEqual({ status: 200, body: { a: 1 }, url: "http://localhost:3000/api/economy?op=pulse" });
  });

  it("keeps a non-JSON reply as text with its status", async () => {
    const r = await mk(404, "<html>nope</html>", [])("openapi.json");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "non-JSON reply", text: "<html>nope</html>" });
  });
});

describe("county_history's hazards description (round 8)", () => {
  it("lists NCEI storm events by type, says tornadoes are SPC's, and never invents a 0", () => {
    const d = toolByName("county_history")!.description;
    expect(d).toMatch(/NCEI Storm Events county-coded event counts per year by type since 1996/);
    expect(d).toMatch(/tornadoes are SPC's/);
    expect(d).toMatch(/null, never 0/);
  });
});
