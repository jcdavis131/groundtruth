import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("POST /api/mcp sub-requests and the preview protection bypass", () => {
  // Dummy values, shaped like no real token, so guard.mjs's secret rule stays quiet.
  const SECRET = "bypass-test-value-0002";
  const BRANCH_HOST = "groundtruth-map-git-x.vercel.app";
  const DEPLOY_HOST = "groundtruth-map-abc123.vercel.app";
  const OWN = "https://" + BRANCH_HOST;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** A preview deployment with the secret set, as Vercel would expose it. */
  function preview(env: Record<string, string> = {}) {
    vi.stubEnv("GEV_BASE_URL", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", DEPLOY_HOST);
    vi.stubEnv("VERCEL_BRANCH_URL", BRANCH_HOST);
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", SECRET);
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  }

  /** Stub the global fetch the route's sub-requests use, recording each call's url, headers and redirect mode. */
  function stubFetch() {
    const calls: { url: string; headers: Record<string, string>; redirect: RequestRedirect | undefined }[] = [];
    vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, redirect: init?.redirect });
      return new Response('{"rows":[]}', { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch);
    return calls;
  }

  const TOOL_CALL = { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "sectors", arguments: { fips: "48453" } } };

  /** POST the tool call to `origin`'s /api/mcp; the origin stands in for the Host the request arrived with. */
  function callAt(origin: string, headers: Record<string, string> = {}) {
    return POST(new Request(origin + "/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(TOOL_CALL) }));
  }

  it("sends the bypass on a preview whose request origin is its own VERCEL_BRANCH_URL", async () => {
    preview();
    const calls = stubFetch();
    const res = await callAt(OWN);
    expect(res.status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(new URL(c.url).origin).toBe(OWN);
      expect(c.headers["x-vercel-protection-bypass"]).toBe(SECRET);
      expect(c.redirect).toBe("manual");
      expect(c.headers).not.toHaveProperty("cookie");
    }
    expect(await res.text()).not.toContain(SECRET);
  });

  it("sends the bypass on a preview whose request origin is its own VERCEL_URL", async () => {
    preview();
    const calls = stubFetch();
    await callAt("https://" + DEPLOY_HOST);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.headers["x-vercel-protection-bypass"]).toBe(SECRET);
      expect(c.redirect).toBe("manual");
    }
  });

  it("never sends it on production, even with the secret set", async () => {
    preview({ VERCEL_ENV: "production" });
    const calls = stubFetch();
    const res = await callAt(OWN);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(Object.keys(c.headers)).toEqual(["accept"]);
    expect(await res.text()).not.toContain(SECRET);
  });

  it("never sends it when VERCEL_ENV is unset or development", async () => {
    for (const env of ["", "development"]) {
      preview({ VERCEL_ENV: env });
      const calls = stubFetch();
      await callAt(OWN);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(Object.keys(c.headers)).toEqual(["accept"]);
    }
  });

  it("never sends it on a preview when the request's Host is not the deployment's own", async () => {
    preview();
    const calls = stubFetch();
    const res = await callAt("https://evil.example");
    // http on the right host is another origin too.
    await callAt("http://" + BRANCH_HOST);
    await callAt("https://" + BRANCH_HOST + ".evil.example");
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.headers).not.toHaveProperty("x-vercel-protection-bypass");
    expect(await res.text()).not.toContain(SECRET);
  });

  it("never sends it on a preview that has neither VERCEL_URL nor VERCEL_BRANCH_URL", async () => {
    preview({ VERCEL_URL: "", VERCEL_BRANCH_URL: "" });
    const calls = stubFetch();
    await callAt(OWN);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.headers).not.toHaveProperty("x-vercel-protection-bypass");
  });

  it("sends nothing extra when the secret is unset", async () => {
    preview({ VERCEL_AUTOMATION_BYPASS_SECRET: "" });
    const calls = stubFetch();
    await callAt(OWN);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(Object.keys(c.headers)).toEqual(["accept"]);
  });

  it("never sends it to a GEV_BASE_URL on another host", async () => {
    preview({ GEV_BASE_URL: "https://eye.jcamd.com" });
    const calls = stubFetch();
    const res = await callAt(OWN);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(new URL(c.url).origin).toBe("https://eye.jcamd.com");
      expect(c.headers).not.toHaveProperty("x-vercel-protection-bypass");
    }
    expect(await res.text()).not.toContain(SECRET);
  });

  it("never forwards the visitor's cookie or share token", async () => {
    preview({ VERCEL_AUTOMATION_BYPASS_SECRET: "" });
    const calls = stubFetch();
    await post(
      { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "sectors", arguments: { fips: "48453" } } },
      { cookie: "_vercel_jwt=visitor-cookie", "x-vercel-protection-bypass": "visitor-token", authorization: "Bearer visitor" },
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(Object.keys(c.headers)).toEqual(["accept"]);
  });
});
