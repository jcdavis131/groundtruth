// Assemble the MCP server: every tool from ./tools, docs/*.md and
// public/openapi.json as resources, and three prompts that chain tools into
// the briefs practitioners actually write. Transport-agnostic: the Next route
// and scripts/mcp-stdio.mjs each create a server and plug their own transport.
//
// Relative imports only (see ./tools.ts for why).

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { envelopeForStatus, envelopeForThrown, InvalidArguments } from "./errors";
import { NOT_DEPLOYED_NOTE, TOOLS, type FetchJson, type ToolDef, type ToolReply } from "./tools";

export const SERVER_NAME = "embedding-atlas-mcp-server";
export const SERVER_VERSION = "0.1.0";

export interface ServerOptions {
  fetchJson: FetchJson;
  /** Directory whose *.md files become gev://docs/<name> resources. Missing dir = no doc resources. */
  docsDir?: string;
  /** Path of the OpenAPI document served as gev://openapi.json. */
  openapiPath?: string;
}

export interface ManifestEntry {
  name: string;
  title: string;
  description: string;
  /** JSON Schema (draft 2020-12) generated from the zod input schema. */
  inputSchema: Record<string, unknown>;
}

/** Plain-JSON list of tools for docs, the GET handler and tests. */
export function toolManifest(tools: ToolDef[] = TOOLS): ManifestEntry[] {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.inputSchema) as Record<string, unknown>,
  }));
}

/** One-line argument summary from a JSON schema: "lon: number, lat: number, min?: string". */
export function argsSummary(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(props)
    .map(([k, p]) => {
      const t = Array.isArray(p.enum) ? (p.enum as string[]).join(" | ") : p.type === "array" ? "number[4]" : String(p.type ?? "any");
      return `${k}${required.has(k) ? "" : "?"}: ${t}`;
    })
    .join(", ");
}

/** Markdown table of the tools, kept in sync with docs/MCP.md by a test. */
export function toolTable(entries: ManifestEntry[] = toolManifest()): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const lines = ["| Tool | Arguments | Returns |", "| --- | --- | --- |"];
  for (const e of entries) lines.push(`| \`${e.name}\` | ${esc(argsSummary(e.inputSchema)) || "(none)"} | ${esc(e.description)} |`);
  return lines.join("\n");
}

// ---- prompts ---------------------------------------------------------------

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  args: { name: string; description: string; required: boolean }[];
  /** Pure text builder so tests can check the prompt without a client. */
  build(args: Record<string, string | undefined>): string;
}

const CITE = "Cite every number with the source, period and upstream URL from its provenance (or meta.source and the route URL when a route has no provenance field). Say 'estimate' wherever the payload does. Do not give investment, lending or relocation advice.";

/** The three prompts. Each names the tools it chains so a client can plan the calls. */
export const PROMPTS: PromptDef[] = [
  {
    name: "county_due_diligence",
    title: "County due diligence",
    description: "Housing, jobs, sector mix, public companies, bank deposits and federal spending for one county, with citations.",
    args: [{ name: "fips", description: "5-digit county FIPS, e.g. 48453", required: true }],
    build: ({ fips }) =>
      [
        `Prepare a county due-diligence brief for FIPS ${fips}.`,
        "1. Call sectors(fips) for the NAICS mix and location quotients; call county_history(fips) for employment, wage, home value and rent trends, and county_history(fips, topic: hazards) for declarations, drought, climate and tornadoes.",
        "2. Call companies_near(fips) for SEC-registered public companies headquartered there, banks(fips) for FDIC deposits and federal_spending(fips) for USAspending totals.",
        "3. Call indicators(category: 'housing') and pulse() for the national backdrop, and release_calendar() to say which of these numbers is about to be revised.",
        "Write: one paragraph on jobs and wages, one on housing (values, rents, affordability estimate and its formula), one on the corporate and public-money footprint, then a short list of what is missing (withheld QCEW cells, null values) and the next release dates.",
        CITE,
      ].join("\n"),
  },
  {
    name: "port_congestion_check",
    title: "Port congestion check",
    description: "Harbour volumes, vessel snapshots and freight indicators for a bounding box, compared with the national pulse.",
    args: [
      { name: "bbox", description: "west,south,east,north in degrees around the port(s), e.g. -118.6,33.5,-117.9,34.0", required: true },
      { name: "port", description: "Optional harbour name to focus on, e.g. Los Angeles", required: false },
    ],
    build: ({ bbox, port }) =>
      [
        `Check for congestion at ${port ? `${port} and other harbours` : "the harbours"} inside bbox [${bbox}].`,
        `1. Call ports(bbox: [${bbox}], min: 'all') for World Port Index harbours and their BTS Port Performance volumes (TEU, tonnage, calls, dwell days).`,
        "2. Call series_list(prefix: 'snapshot:port-vessels:') and series_get for the matching port ids to see vessel counts within 50 km over time (snapshots of a live AIS feed; coverage without a key is partial and the note says so).",
        "3. Call indicators(category: 'freight') and movers(table: 'ports') for the national freight picture, and border_crossings() if the box touches a land border.",
        "Report: current vessel count vs the series median, BTS dwell time vs the prior year, whether freight indicators are in watch or alert, and what would confirm congestion that this data cannot show (no berth occupancy, no queue data).",
        CITE,
      ].join("\n"),
  },
  {
    name: "water_stress_brief",
    title: "Water stress brief",
    description: "Drought, gauges, reservoirs, wells and the stress estimate for a point, with the year of history behind the key gauge.",
    args: [
      { name: "lon", description: "Longitude in degrees, e.g. -98.49", required: true },
      { name: "lat", description: "Latitude in degrees, e.g. 29.42", required: true },
    ],
    build: ({ lon, lat }) =>
      [
        `Write a water stress brief for the point lon ${lon}, lat ${lat}.`,
        `1. Call water_report(lon: ${lon}, lat: ${lat}) for the drought class, nearby gauges, flood categories, reservoirs, wells and the stress estimate with its formula.`,
        "2. Pick the gauge the report leans on most and call gauge_history(site, param) for discharge (00060) or stage (00065) to place today's reading against the last 365 days.",
        "3. Call indicators(category: 'water') for the named water indicators and their thresholds, and market_report for the same point if the reader needs the county context.",
        "Report in this order: drought class and its date, surface water (flow/stage vs the year, flood category), storage (reservoir % full), groundwater (depth to water, aquifer), then the stress estimate, its formula and its caveats. Units as published (ft3/s, ft, degC, FNU, acre-ft).",
        CITE,
      ].join("\n"),
  },
];

// ---- resources -------------------------------------------------------------

const DOC_NAME = /^[A-Za-z0-9][A-Za-z0-9_.\-]*\.md$/;

/** List the markdown files in docsDir (empty when the dir is missing). */
export async function listDocs(docsDir: string | undefined): Promise<string[]> {
  if (!docsDir) return [];
  try {
    const names = await readdir(docsDir);
    return names.filter((n) => DOC_NAME.test(n)).sort();
  } catch {
    return [];
  }
}

function safeDocPath(docsDir: string, name: string): string | null {
  // The template variable comes from the client; only a bare *.md filename is allowed.
  if (!DOC_NAME.test(name) || name.includes("..")) return null;
  return path.join(docsDir, name);
}

// ---- server ----------------------------------------------------------------

// Every isError reply carries the typed envelope from ./errors next to its
// `error` string (see that file for the codes and the credit).

export function toCallResult(reply: ToolReply): CallToolResult {
  if (reply.status < 400) {
    return { content: [{ type: "text", text: JSON.stringify(reply.payload) }], structuredContent: reply.payload, isError: false };
  }
  const notDeployed = typeof reply.payload.note === "string" && reply.payload.note.includes(NOT_DEPLOYED_NOTE);
  // The route's payload first, then the envelope; `error` keeps the route's own string when it sent one.
  const payload = { ...reply.payload, ...envelopeForStatus(reply.status, reply.payload, notDeployed) };
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, isError: true };
}

export function errorResult(err: unknown): CallToolResult {
  const payload = { ...envelopeForThrown(err) };
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, isError: true };
}

/**
 * The SDK checks arguments against inputSchema before our handler runs, and
 * answers a failure (or an unknown tool) with plain text from its private
 * createToolError, so those replies never reached errorResult. Route them
 * through the envelope too. SDK 1.30: every message that arrives here is an
 * McpError InvalidParams ("MCP error -32602: ...") because each tool handler
 * catches its own errors; anything else is classed internal_error. A test
 * pins this, so an SDK that renames the method fails CI instead of silently
 * sending plain text again.
 */
function envelopeSdkErrors(server: McpServer): void {
  const s = server as unknown as { createToolError?: (message: string) => CallToolResult };
  if (typeof s.createToolError !== "function") return;
  s.createToolError = (message: string) => errorResult(/^MCP error -32602\b/.test(message) ? new InvalidArguments(message) : new Error(message));
}

/**
 * Build a McpServer with every tool, prompt and resource registered. One per
 * request in the HTTP route (stateless), one per process on stdio.
 */
export function createServer(opts: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const ctx = { fetchJson: opts.fetchJson };
  envelopeSdkErrors(server);

  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (args: unknown) => {
        try {
          return toCallResult(await t.run(args, ctx));
        } catch (err) {
          return errorResult(err);
        }
      },
    );
  }

  for (const p of PROMPTS) {
    const argsSchema: Record<string, z.ZodString | z.ZodOptional<z.ZodString>> = {};
    for (const a of p.args) argsSchema[a.name] = a.required ? z.string().describe(a.description) : z.string().describe(a.description).optional();
    server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema }, (args) => ({
      description: p.description,
      messages: [{ role: "user", content: { type: "text", text: p.build(args as Record<string, string | undefined>) } }],
    }));
  }

  const docsDir = opts.docsDir;
  server.registerResource(
    "docs",
    new ResourceTemplate("gev://docs/{name}", {
      list: async () => ({
        resources: (await listDocs(docsDir)).map((n) => ({ uri: `gev://docs/${n}`, name: n, mimeType: "text/markdown", description: `docs/${n} from the Embedding Atlas repository` })),
      }),
    }),
    { title: "Project docs", description: "Markdown docs shipped with the app (API guide, provenance contract, MCP notes).", mimeType: "text/markdown" },
    async (uri, vars) => {
      const name = Array.isArray(vars.name) ? vars.name[0] : vars.name;
      const file = docsDir ? safeDocPath(docsDir, String(name)) : null;
      if (!file) throw new Error(`unknown doc: ${String(name)}`);
      const text = await readFile(file, "utf8");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "openapi",
    "gev://openapi.json",
    { title: "OpenAPI document", description: "OpenAPI 3 description of the HTTP routes (public/openapi.json).", mimeType: "application/json" },
    async (uri) => {
      let text: string;
      try {
        text = opts.openapiPath ? await readFile(opts.openapiPath, "utf8") : JSON.stringify({ error: "openapi document not configured" });
      } catch {
        text = JSON.stringify({ error: "public/openapi.json is not present on this server" });
      }
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    },
  );

  return server;
}

/** Small JSON description of the server for the HTTP GET handler and the docs. */
export function describeServer(endpoint: string) {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    transport: "streamable-http (stateless, JSON responses)",
    endpoint,
    usage: `POST JSON-RPC 2.0 to ${endpoint} with Content-Type: application/json (initialize, tools/list, tools/call, prompts/list, prompts/get, resources/list, resources/read). No session, no auth; read-only.`,
    tools: toolManifest(),
    prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description, arguments: p.args })),
    resources: ["gev://openapi.json", "gev://docs/{name}"],
  };
}
