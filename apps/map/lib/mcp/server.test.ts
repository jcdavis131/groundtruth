import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { ERROR_CATEGORIES, ERROR_CODES, ERROR_ENVELOPE_SCHEMA } from "./errors";
import { z } from "zod";
import { argsSummary, createServer, describeServer, errorResult, listDocs, PROMPTS, toolManifest, toolTable } from "./server";
import { TOOLS, type FetchJson } from "./tools";

const validateEnvelope = new AjvJsonSchemaValidator().getValidator(ERROR_ENVELOPE_SCHEMA as never);

type Envelope = { error: string; code: string; category: string; retryable: boolean; remediation: string } & Record<string, unknown>;

/** Every isError reply: schema-valid envelope, `error` a string, text and structuredContent the same object. */
function expectErrorEnvelope(r: Awaited<ReturnType<Awaited<ReturnType<typeof connect>>["client"]["callTool"]>>): Envelope {
  expect(r.isError).toBe(true);
  const text = JSON.parse((r.content as { text: string }[])[0].text);
  expect(r.structuredContent).toEqual(text);
  const v = validateEnvelope(text);
  expect(v.errorMessage).toBeUndefined();
  expect(v.valid).toBe(true);
  expect(typeof text.error).toBe("string");
  return text as Envelope;
}

const EXPECTED_TOOL_NAMES = [
  "water_report",
  "market_report",
  "areas",
  "sectors",
  "ports",
  "border_crossings",
  "countries",
  "trade_partners",
  "pulse",
  "gauges",
  "gauge_history",
  "series_list",
  "series_get",
  "screen",
  "indicators",
  "indicator_history",
  "release_calendar",
  "movers",
  "county_history",
  "company",
  "companies_near",
  "banks",
  "federal_spending",
  "place_fabric",
  "place_compare",
  "construct_field",
  "downstream",
  "upstream",
  "flow_normals",
  "water_trace",
  "risk_index",
  "social_vulnerability",
  "broadband_availability",
  "live_events",
  "catalog_search",
  "place_export",
  "openapi",
];

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "gev-mcp-"));
  await writeFile(path.join(dir, "API.md"), "# API\nhello", "utf8");
  await writeFile(path.join(dir, "notes.txt"), "not a doc", "utf8");
  await writeFile(path.join(dir, "openapi.json"), '{"openapi":"3.1.0"}', "utf8");
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function connect(fetchJson: FetchJson) {
  const server = createServer({ fetchJson, docsDir: dir, openapiPath: path.join(dir, "openapi.json") });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await server.connect(st);
  await client.connect(ct);
  return { client, server };
}

describe("toolManifest", () => {
  it("lists every tool by name in a stable order (snapshot of names)", () => {
    expect(toolManifest().map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
    expect(TOOLS.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("carries a JSON schema and a practitioner description for each tool", () => {
    for (const e of toolManifest()) {
      expect(e.inputSchema.type).toBe("object");
      expect(e.description.length).toBeGreaterThan(40);
      expect(e.title.length).toBeGreaterThan(3);
    }
    const wr = toolManifest().find((t) => t.name === "water_report")!;
    expect(wr.inputSchema.required).toEqual(["lon", "lat"]);
    expect((wr.inputSchema.properties as Record<string, { minimum: number }>).lon.minimum).toBe(-180);
  });

  it("summarises arguments and renders a markdown table", () => {
    const ports = toolManifest().find((t) => t.name === "ports")!;
    expect(argsSummary(ports.inputSchema)).toBe("bbox: number[4], min?: large | medium | small | all");
    const table = toolTable();
    expect(table.split("\n")).toHaveLength(2 + EXPECTED_TOOL_NAMES.length);
    expect(table).toContain("| `water_report` | lon: number, lat: number |");
    expect(table).toContain("| `pulse` | (none) |");
  });
});

describe("createServer over an in-memory transport", () => {
  it("registers every tool with read-only annotations", async () => {
    const { client } = await connect(async () => ({ status: 200, body: {}, url: "" }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("calls a tool through to fetchJson and returns text + structuredContent", async () => {
    const calls: string[] = [];
    const { client } = await connect(async (p) => {
      calls.push(p);
      return { status: 200, body: { source: "BLS QCEW", data: { sectors: [{ naics: "31-33", emp: 100 }] } }, url: "" };
    });
    const r = await client.callTool({ name: "sectors", arguments: { fips: "48453" } });
    expect(calls).toEqual(["/api/economy?op=sectors&fips=48453"]);
    expect(r.isError).toBe(false);
    expect(r.structuredContent).toEqual({ source: "BLS QCEW", data: { sectors: [{ naics: "31-33", emp: 100 }] } });
    expect(JSON.parse((r.content as { text: string }[])[0].text)).toEqual(r.structuredContent);
  });

  it("marks 404 replies as errors while keeping the payload and note", async () => {
    const { client } = await connect(async () => ({ status: 404, body: { error: "non-JSON reply", text: "<!DOCTYPE html>" }, url: "" }));
    const r = await client.callTool({ name: "series_list", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.structuredContent as { note: string }).note).toMatch(/not deployed/);
    const e = expectErrorEnvelope(r);
    expect(e.error).toBe("non-JSON reply");
    expect(e).toMatchObject({ code: "route_not_deployed", category: "unavailable", retryable: false });
  });

  it("turns invalid arguments into an isError result, not a transport failure", async () => {
    const calls: string[] = [];
    const { client } = await connect(async (p) => {
      calls.push(p);
      return { status: 200, body: {}, url: "" };
    });
    const r = await client.callTool({ name: "water_report", arguments: { lon: 500, lat: 0 } });
    expect(r.isError).toBe(true);
    expect(calls).toEqual([]);
    expect((r.content as { text: string }[])[0].text).toMatch(/lon/);
    // The SDK checks inputSchema before our handler runs; its message is kept as the `error` string.
    const e = expectErrorEnvelope(r);
    expect(e.error).toMatch(/^MCP error -32602: Input validation error: .*lon/);
    expect(e).toMatchObject({ code: "invalid_arguments", category: "invalid_input", retryable: false });
  });

  it("puts an unknown tool name in the envelope too", async () => {
    const { client } = await connect(async () => ({ status: 200, body: {}, url: "" }));
    const e = expectErrorEnvelope(await client.callTool({ name: "no_such_tool", arguments: {} }));
    expect(e.error).toMatch(/no_such_tool not found/);
    expect(e).toMatchObject({ code: "invalid_arguments", retryable: false });
  });

  it("keeps errorResult's old `error` string for a zod error thrown inside a tool", () => {
    const parsed = z.object({ fips: z.string().regex(/^\d{5}$/, "5-digit county FIPS") }).safeParse({ fips: "4" });
    const r = errorResult(parsed.error);
    const text = JSON.parse((r.content as { text: string }[])[0].text);
    expect(text.error).toBe("invalid arguments: fips: 5-digit county FIPS");
    expect(validateEnvelope(text).valid).toBe(true);
  });

  it("marks a handler's own argument check as invalid_input, retryable false", async () => {
    const calls: string[] = [];
    const { client } = await connect(async (p) => {
      calls.push(p);
      return { status: 200, body: {}, url: "" };
    });
    const r = await client.callTool({ name: "areas", arguments: { level: "county" } });
    expect(calls).toEqual([]);
    const e = expectErrorEnvelope(r);
    expect(e.error).toMatch(/bbox is required/);
    expect(e).toMatchObject({ code: "invalid_arguments", category: "invalid_input", retryable: false });
  });

  it("marks a route's own 400 and 404 as bad input, retryable false", async () => {
    const { client: c400 } = await connect(async () => ({ status: 400, body: { error: "fips must be 5 digits", details: { fips: "4" } }, url: "" }));
    const bad = expectErrorEnvelope(await c400.callTool({ name: "sectors", arguments: { fips: "48453" } }));
    expect(bad).toMatchObject({ error: "fips must be 5 digits", code: "bad_request", category: "invalid_input", retryable: false, details: { fips: "4" } });

    const { client: c404 } = await connect(async () => ({ status: 404, body: { error: "not in the index" }, url: "" }));
    const missing = expectErrorEnvelope(await c404.callTool({ name: "broadband_availability", arguments: { fips: "09110" } }));
    expect(missing).toMatchObject({ error: "not in the index", code: "not_found", category: "invalid_input", retryable: false });
  });

  it("marks an upstream failure as unavailable, retryable true, keeping the route's fields", async () => {
    const { client } = await connect(async () => ({ status: 502, body: { error: "USGS 503: Service Unavailable", upstream: "USGS", status: 503 }, url: "" }));
    const e = expectErrorEnvelope(await client.callTool({ name: "gauge_history", arguments: { site: "USGS-07032000", param: "00060" } }));
    expect(e).toMatchObject({ error: "USGS 503: Service Unavailable", upstream: "USGS", status: 503, code: "upstream_failure", category: "unavailable", retryable: true });
    expect(e.note).toMatch(/HTTP 502/);
  });

  it("splits the other route statuses into retryable and not", async () => {
    const cases: Array<[number, unknown, string, boolean]> = [
      [429, { error: "slow down" }, "rate_limited", true],
      [504, { error: "gateway timeout" }, "timeout", true],
      [502, { error: "This operation was aborted" }, "timeout", true],
      [502, { error: "FEMA 400: bad where clause", upstream: "FEMA", status: 400 }, "upstream_rejected", false],
      [502, { error: "NWS cooling down after 429", upstream: "NWS", status: 429 }, "rate_limited", true],
      [500, { error: "boom" }, "internal_error", false],
      [503, "<html>down</html>", "upstream_failure", true],
    ];
    for (const [status, body, code, retryable] of cases) {
      const { client } = await connect(async () => ({ status, body, url: "" }));
      const e = expectErrorEnvelope(await client.callTool({ name: "pulse", arguments: {} }));
      expect({ status, code: e.code, retryable: e.retryable }).toEqual({ status, code, retryable });
      expect(e.category).toBe(ERROR_CODES[code as keyof typeof ERROR_CODES].category);
    }
  });

  it("names an error when the payload has no error string of its own", async () => {
    // social_vulnerability answers 404 at the top level when neither side has a row; the reasons sit inside each side.
    const { client } = await connect(async () => ({ status: 404, body: { error: "not in the index" }, url: "" }));
    const e = expectErrorEnvelope(await client.callTool({ name: "social_vulnerability", arguments: { fips: "99999" } }));
    expect(e.error).toBe("the route answered HTTP 404");
    expect(e).toMatchObject({ code: "not_found", retryable: false });
    expect((e.cdcSvi as { missing: string }).missing).toMatch(/not in this release/);
  });

  it("classifies a failed fetch: timeout and unreachable are retryable, a bug is not", async () => {
    const cases: Array<[Error, string, boolean]> = [
      [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "timeout", true],
      [new TypeError("fetch failed"), "server_unreachable", true],
      [new Error("cannot read properties of undefined"), "internal_error", false],
    ];
    for (const [err, code, retryable] of cases) {
      const { client } = await connect(async () => {
        throw err;
      });
      const e = expectErrorEnvelope(await client.callTool({ name: "pulse", arguments: {} }));
      expect(e).toMatchObject({ error: err.message, code, retryable });
    }
  });

  it("adds no envelope fields to a reply that is not an error", async () => {
    const { client } = await connect(async () => ({ status: 200, body: { data: [] }, url: "" }));
    const r = await client.callTool({ name: "pulse", arguments: {} });
    expect(r.isError).toBe(false);
    for (const k of ["code", "category", "retryable", "remediation", "error"]) expect(r.structuredContent).not.toHaveProperty(k);
  });

  it("schema: four categories, every code maps to one, remediation is short", () => {
    expect([...ERROR_CATEGORIES]).toEqual(["invalid_input", "unavailable", "timeout", "execution_failure"]);
    expect(ERROR_ENVELOPE_SCHEMA.properties.category.enum).toEqual([...ERROR_CATEGORIES]);
    for (const [code, c] of Object.entries(ERROR_CODES)) {
      expect(ERROR_CATEGORIES, code).toContain(c.category);
      expect(c.remediation.length, code).toBeLessThanOrEqual(200);
    }
    expect(validateEnvelope({ error: "x", code: "invalid_arguments", category: "nope", retryable: false, remediation: "r" }).valid).toBe(false);
    expect(validateEnvelope({ error: "x" }).valid).toBe(false);
  });

  it("says coverage is partial when an export names unknown places, and keeps a route's own coverage array", async () => {
    const { client } = await connect(async () => ({ status: 200, body: { data: { places: ["48453"], nullPlaces: { "09110": "join:no_source_row", "02063": "join:no_source_row" }, nullCells: { "12065": { a: "source:null_in_county_layer" } } } }, url: "" }));
    const r = await client.callTool({ name: "place_export", arguments: { collection: "ust-releases-county" } });
    expect(r.isError).toBe(false);
    const cs = (r.structuredContent as { coverageStatus: { status: string; basis: string[] } }).coverageStatus;
    expect(cs.status).toBe("partial");
    expect(cs.basis).toHaveLength(2);
    expect(cs.basis[0]).toMatch(/^2 places in data\.nullPlaces/);

    const { client: c2 } = await connect(async () => ({ status: 200, body: { coverage: [{ id: "x", state: "covered", count: 3 }], data: { places: ["48453"], nullPlaces: {} } }, url: "" }));
    const r2 = await c2.callTool({ name: "place_export", arguments: { collection: "npl-status" } });
    expect(r2.structuredContent).not.toHaveProperty("coverageStatus");
    expect((r2.structuredContent as { coverage: unknown }).coverage).toEqual([{ id: "x", state: "covered", count: 3 }]);
  });

  it("says coverage is partial when the MCP cuts a list to fit", async () => {
    const big = Array.from({ length: 1000 }, (_, i) => `${i}:${"x".repeat(500)}`);
    const { client } = await connect(async () => ({ status: 200, body: { data: big }, url: "" }));
    const r = await client.callTool({ name: "pulse", arguments: {} });
    const sc = r.structuredContent as { data: unknown[]; note: string; coverageStatus: { status: string; basis: string[] } };
    expect(sc.data.length).toBeLessThan(1000);
    expect(sc.note).toMatch(/truncated to the first/);
    expect(sc.coverageStatus).toEqual({ status: "partial", basis: [expect.stringMatching(/the MCP cut the list/)] });
  });

  it("lists and renders the three prompts, each naming the tools it chains", async () => {
    const { client } = await connect(async () => ({ status: 200, body: {}, url: "" }));
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["county_due_diligence", "port_congestion_check", "water_stress_brief"]);
    const dd = await client.getPrompt({ name: "county_due_diligence", arguments: { fips: "48453" } });
    const text = (dd.messages[0].content as { text: string }).text;
    for (const tool of ["sectors", "county_history", "companies_near", "banks", "federal_spending", "release_calendar"]) expect(text).toContain(tool);
    expect(text).toContain("48453");
    const ws = await client.getPrompt({ name: "water_stress_brief", arguments: { lon: "-98.49", lat: "29.42" } });
    expect((ws.messages[0].content as { text: string }).text).toContain("water_report(lon: -98.49, lat: 29.42)");
    const pc = PROMPTS.find((p) => p.name === "port_congestion_check")!;
    expect(pc.build({ bbox: "-118.6,33.5,-117.9,34.0" })).toContain("ports(bbox: [-118.6,33.5,-117.9,34.0]");
    expect(pc.build({ bbox: "1,2,3,4", port: "Houston" })).toContain("Houston");
  });

  it("exposes docs/*.md and openapi.json as resources and refuses traversal", async () => {
    const { client } = await connect(async () => ({ status: 200, body: {}, url: "" }));
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("gev://openapi.json");
    expect(uris).toContain("gev://docs/API.md");
    expect(uris).not.toContain("gev://docs/notes.txt");
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("gev://docs/{name}");
    const doc = await client.readResource({ uri: "gev://docs/API.md" });
    expect((doc.contents[0] as { text: string }).text).toBe("# API\nhello");
    const api = await client.readResource({ uri: "gev://openapi.json" });
    expect(JSON.parse((api.contents[0] as { text: string }).text)).toEqual({ openapi: "3.1.0" });
    await expect(client.readResource({ uri: "gev://docs/..%2Fopenapi.json" })).rejects.toThrow();
    await expect(client.readResource({ uri: "gev://docs/missing.md" })).rejects.toThrow();
  });

  it("listDocs is empty for a missing directory", async () => {
    expect(await listDocs(path.join(dir, "nope"))).toEqual([]);
    expect(await listDocs(undefined)).toEqual([]);
    expect(await listDocs(dir)).toEqual(["API.md"]);
  });
});

describe("describeServer", () => {
  it("names the endpoint, tools, prompts and resources", () => {
    const d = describeServer("https://eye.example/api/mcp");
    expect(d.endpoint).toBe("https://eye.example/api/mcp");
    expect(d.tools.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
    expect(d.prompts).toHaveLength(3);
    expect(d.resources).toContain("gev://openapi.json");
  });
});

describe("docs/MCP.md stays in sync with the manifest", () => {
  it("contains the generated tool table between the markers", async () => {
    const md = await readFile(path.join(process.cwd(), "docs", "MCP.md"), "utf8");
    const m = md.match(/<!-- tools:start -->\n([\s\S]*?)\n<!-- tools:end -->/);
    expect(m, "docs/MCP.md needs <!-- tools:start --> / <!-- tools:end --> markers").not.toBeNull();
    expect(m![1].trim()).toBe(toolTable());
  });

  it("lists every error code and category the server can send", async () => {
    const md = await readFile(path.join(process.cwd(), "docs", "MCP.md"), "utf8");
    for (const code of Object.keys(ERROR_CODES)) expect(md, code).toContain("`" + code + "`");
    for (const cat of ERROR_CATEGORIES) expect(md, cat).toContain("`" + cat + "`");
  });
});
