import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { argsSummary, createServer, describeServer, listDocs, PROMPTS, toolManifest, toolTable } from "./server";
import { TOOLS, type FetchJson } from "./tools";

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
});
