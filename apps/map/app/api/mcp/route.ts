// MCP over Streamable HTTP, stateless: every POST builds a fresh McpServer,
// answers the JSON-RPC message(s) in the body as plain JSON and forgets. No
// session id, no SSE stream, no auth; the tools only read this app's own
// keyless /api routes, so the endpoint inherits their caches and rate gates.
//
//   POST /api/mcp     JSON-RPC 2.0 (initialize, tools/list, tools/call, ...)
//   GET  /api/mcp     JSON description of the server and its tool manifest
//   OPTIONS           CORS preflight
//
// The tools call the API at GEV_BASE_URL when set (a stdio server or a
// separately hosted API), otherwise this request's own origin.
//
// On a protected Vercel preview those same-origin sub-requests get a 401,
// because they carry none of the visitor's credentials. When the project has
// "Protection Bypass for Automation" on, Vercel sets
// VERCEL_AUTOMATION_BYPASS_SECRET and the sub-requests send it as
// x-vercel-protection-bypass, but only to this request's own origin (see
// ProtectionBypass in lib/mcp/tools.ts). Unset (production, local): no header.
// No visitor cookie or share token is ever forwarded.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import path from "node:path";
import { createServer, describeServer } from "@/lib/mcp/server";
import { httpFetchJson, type ProtectionBypass } from "@/lib/mcp/tools";
import { countyPoint } from "@/lib/places/registry";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** JSON-RPC bodies are small; a megabyte is far more than any tools/call needs. */
export const MAX_BODY_BYTES = 1_048_576;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-protocol-version, mcp-session-id",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

function rpcError(status: number, code: number, message: string, id: string | number | null = null): Response {
  return withCors(Response.json({ jsonrpc: "2.0", error: { code, message }, id }, { status }));
}

function baseUrl(req: Request): string {
  const env = process.env.GEV_BASE_URL?.trim();
  return env ? env.replace(/\/+$/, "") : new URL(req.url).origin;
}

/** The same-origin protection bypass, or undefined when the secret is unset. Read per request so tests can stub it. */
function protectionBypass(req: Request): ProtectionBypass | undefined {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  return secret ? { secret, requestOrigin: new URL(req.url).origin } : undefined;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const endpoint = new URL(req.url).origin + "/api/mcp";
  return withCors(
    Response.json(describeServer(endpoint), {
      headers: { "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600" },
    }),
  );
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(ct.trim())) return rpcError(415, -32000, "Content-Type must be application/json");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return rpcError(413, -32000, `body larger than ${MAX_BODY_BYTES} bytes`);
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return rpcError(413, -32000, `body larger than ${MAX_BODY_BYTES} bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return rpcError(400, -32700, "Parse error: invalid JSON");
  }

  const server = createServer({
    fetchJson: httpFetchJson(baseUrl(req), fetch, undefined, protectionBypass(req)),
    countyPoint,
    docsDir: path.join(process.cwd(), "docs"),
    openapiPath: path.join(process.cwd(), "public", "openapi.json"),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    // The SDK insists the client accepts both JSON and SSE. We only ever answer
    // JSON, so curl and other minimal clients that send */* are let through.
    const headers = new Headers(req.headers);
    const accept = headers.get("accept") ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) headers.set("accept", "application/json, text/event-stream");
    const res = await transport.handleRequest(new Request(req.url, { method: "POST", headers, body: text }), { parsedBody: parsed });
    return withCors(res);
  } catch (err) {
    return rpcError(500, -32603, err instanceof Error ? err.message : "internal error");
  } finally {
    // JSON mode: the response body is complete once handleRequest resolves.
    void transport.close();
    void server.close();
  }
}
