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
// VERCEL_AUTOMATION_BYPASS_SECRET on every environment, production included.
// The code sends it as x-vercel-protection-bypass only when all hold:
// VERCEL_ENV is "preview"; this request's origin is https://VERCEL_URL or
// https://VERCEL_BRANCH_URL (so a spoofed Host can't name "own origin"); the
// sub-request goes to that same origin; and the redirect is not followed (see
// ProtectionBypass and httpFetchJson in lib/mcp/tools.ts). Production, local
// and stdio send no header. No visitor cookie or share token is ever forwarded.

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

/** https://<host> for a Vercel-provided host name, or null when unset or unparsable. */
function deploymentOrigin(host: string | undefined): string | null {
  const h = host?.trim();
  if (!h) return null;
  try {
    return new URL("https://" + h).origin;
  } catch {
    return null;
  }
}

/**
 * The same-origin protection bypass, or undefined. Only on a preview
 * (VERCEL_ENV === "preview"), only with the secret set, and only when this
 * request's origin is the deployment's own https://VERCEL_URL or
 * https://VERCEL_BRANCH_URL; requestOrigin is that pinned origin, never one
 * taken from the Host header alone. Read per request so tests can stub it.
 */
function protectionBypass(req: Request): ProtectionBypass | undefined {
  if (process.env.VERCEL_ENV !== "preview") return undefined;
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!secret) return undefined;
  let incoming: string;
  try {
    incoming = new URL(req.url).origin;
  } catch {
    return undefined;
  }
  const own = [deploymentOrigin(process.env.VERCEL_URL), deploymentOrigin(process.env.VERCEL_BRANCH_URL)];
  const pinned = own.find((o) => o !== null && o === incoming);
  return pinned ? { secret, requestOrigin: pinned } : undefined;
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
