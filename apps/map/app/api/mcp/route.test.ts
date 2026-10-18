import { describe, expect, it } from "vitest";
import { GET, MAX_BODY_BYTES, OPTIONS, POST } from "./route";

const URL_ = "http://localhost:3000/api/mcp";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

describe("GET /api/mcp", () => {
  it("describes the server and lists the tool manifest with CORS open", async () => {
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const j = (await res.json()) as { name: string; endpoint: string; tools: { name: string; inputSchema: { type: string } }[]; prompts: unknown[] };
    expect(j.name).toBe("embedding-atlas-mcp-server");
    expect(j.endpoint).toBe(URL_);
    expect(j.tools.map((t) => t.name)).toContain("water_report");
    expect(j.tools[0].inputSchema.type).toBe("object");
    expect(j.prompts).toHaveLength(3);
  });

  it("OPTIONS answers the preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
  });
});

describe("POST /api/mcp", () => {
  it("rejects a non-JSON content type with 415", async () => {
    const res = await post("{}", { "content-type": "text/plain" });
    expect(res.status).toBe(415);
    const j = (await res.json()) as { error: { code: number } };
    expect(j.error.code).toBe(-32000);
  });

  it("rejects bodies over the limit with 413", async () => {
    const res = await post("x".repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    const declared = await post("{}", { "content-length": String(MAX_BODY_BYTES + 5) });
    expect(declared.status).toBe(413);
  });

  it("rejects invalid JSON with a -32700 parse error", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: { code: number } };
    expect(j.error.code).toBe(-32700);
  });

  it("answers initialize and tools/list as plain JSON without a session, even when Accept is */*", async () => {
    const init = await post(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "0" } } },
      { accept: "*/*" },
    );
    expect(init.status).toBe(200);
    expect(init.headers.get("content-type")).toContain("application/json");
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect(init.headers.get("access-control-allow-origin")).toBe("*");
    const ij = (await init.json()) as { result: { serverInfo: { name: string }; capabilities: Record<string, unknown> } };
    expect(ij.result.serverInfo.name).toBe("embedding-atlas-mcp-server");
    expect(ij.result.capabilities).toHaveProperty("tools");
    expect(ij.result.capabilities).toHaveProperty("prompts");
    expect(ij.result.capabilities).toHaveProperty("resources");

    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.status).toBe(200);
    const lj = (await list.json()) as { result: { tools: { name: string }[] } };
    expect(lj.result.tools.map((t) => t.name)).toContain("market_report");
  });

  it("prompts/get renders a prompt in one stateless round trip", async () => {
    const res = await post({ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "water_stress_brief", arguments: { lon: "-98.49", lat: "29.42" } } });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { result: { messages: { content: { text: string } }[] } };
    expect(j.result.messages[0].content.text).toContain("water_report(lon: -98.49, lat: 29.42)");
  });

  it("a notification-only POST is accepted with 202", async () => {
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
  });
});
