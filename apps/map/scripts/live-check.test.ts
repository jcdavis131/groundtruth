import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EXPECTED_TOOL_NAMES } from "../lib/mcp/expectedTools.mjs";
import { cookieHeaderFor, diffShape, liveCheck, shapeOf } from "./live-check.mjs";

// A stubbed preview: a node http server that answers the four things the check
// asks for. Every knob below breaks exactly one of them.
interface Knobs {
  tools?: string[];
  alwaysLoad?: string[];
  h1?: boolean;
  instructions?: string | null;
  worldStatus?: string;
  worldItems?: number;
  requireCookie?: string;
  requireBypass?: string;
}

const WORLD = (items: number, status: string) => ({
  schemaVersion: "world/2",
  topics: {
    identity: { items: Array.from({ length: items }, (_, i) => ({ fact: `f${i}` })) },
    hazards: { items: [{ fact: "h" }], missing: [{ code: "not_published" }] },
  },
  coverageStatus: { status, basis: ["x"] },
});

function stub(k: Knobs = {}) {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    if (k.requireCookie && !String(req.headers.cookie ?? "").includes(k.requireCookie)) { res.writeHead(401).end("no"); return; }
    if (k.requireBypass && req.headers["x-vercel-protection-bypass"] !== k.requireBypass) { res.writeHead(401).end("no"); return; }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" }).end(k.h1 === false ? "<html><body><p>hi</p></body></html>" : "<html><body><h1><button>Embedding Atlas</button></h1></body></html>");
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const m = JSON.parse(body || "{}");
      const ok = (result: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
      if (m.method === "initialize") {
        const r: Record<string, unknown> = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "eye", version: "1" } };
        if (k.instructions !== null) r.instructions = k.instructions ?? "eye is a read-only map.";
        ok(r);
      } else if (m.method === "tools/list") {
        const names = k.tools ?? [...EXPECTED_TOOL_NAMES];
        ok({ tools: names.map((n) => ({ name: n, inputSchema: { type: "object" }, ...((k.alwaysLoad ?? ["world_context"]).includes(n) ? { _meta: { "anthropic/alwaysLoad": true } } : {}) })) });
      } else if (m.method === "tools/call") {
        const reply = WORLD(k.worldItems ?? 3, k.worldStatus ?? "partial");
        ok({ content: [{ type: "text", text: JSON.stringify(reply) }], structuredContent: reply });
      } else res.writeHead(400).end("{}");
    });
  });
  return new Promise<{ origin: string; seen: http.IncomingHttpHeaders[]; close: () => Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise((r) => server.close(() => r())) })),
  );
}

const baseline = shapeOf(WORLD(3, "partial"));
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });
async function run(k: Knobs = {}, extra: Record<string, unknown> = {}) {
  const s = await stub(k);
  closers.push(s.close);
  const out = await liveCheck({ origin: s.origin, baseline, log: () => {}, ...extra });
  return { ...out, seen: s.seen };
}

describe("live-check against a stubbed preview", () => {
  it("passes on the full tool set and prints an assertion count", async () => {
    const r = await run();
    expect(r.failures).toEqual([]);
    expect(r.assertions.length).toBeGreaterThanOrEqual(8);
    expect(r.exitCode).toBe(0);
  });

  it("fails when one tool name is missing, and names it", async () => {
    const r = await run({ tools: EXPECTED_TOOL_NAMES.filter((n) => n !== "place_fabric") });
    expect(r.exitCode).toBe(1);
    expect(r.failures.join("\n")).toContain("place_fabric");
  });

  it("fails on an unexpected extra tool", async () => {
    const r = await run({ tools: [...EXPECTED_TOOL_NAMES, "surprise_tool"] });
    expect(r.exitCode).toBe(1);
    expect(r.failures.join("\n")).toContain("surprise_tool");
  });

  it("fails when alwaysLoad is on another tool or missing from world_context", async () => {
    expect((await run({ alwaysLoad: ["world_context", "pulse"] })).exitCode).toBe(1);
    expect((await run({ alwaysLoad: [] })).exitCode).toBe(1);
  });

  it("fails without the front-door h1 and without initialize instructions", async () => {
    expect((await run({ h1: false })).failures.join("\n")).toMatch(/h1/);
    expect((await run({ instructions: null })).failures.join("\n")).toMatch(/instructions/);
  });

  it("fails when the world_context shape moves from the baseline", async () => {
    expect((await run({ worldItems: 2 })).failures.join("\n")).toMatch(/identity/);
    expect((await run({ worldStatus: "complete" })).failures.join("\n")).toMatch(/coverageStatus/);
  });

  it("sends the cookie jar and the bypass header when given, and fails on a 401 without them", async () => {
    const jar = ".127.0.0.1\tTRUE\t/\tFALSE\t0\t_vercel_jwt\tabc123\n";
    const ok = await run({ requireCookie: "_vercel_jwt=abc123" }, { cookieHeader: cookieHeaderFor(jar, "127.0.0.1") });
    expect(ok.exitCode).toBe(0);
    expect((await run({ requireCookie: "_vercel_jwt=abc123" })).exitCode).toBe(1);
    const b = await run({ requireBypass: "s3" }, { bypassSecret: "s3" });
    expect(b.exitCode).toBe(0);
  });
});

describe("helpers", () => {
  it("reads a Netscape cookie jar for one host, HttpOnly lines included, skipping comments and other hosts", () => {
    const jar = ["# Netscape HTTP Cookie File", "#HttpOnly_.app.vercel.app\tTRUE\t/\tTRUE\t0\t_vercel_jwt\tj1", "other.com\tFALSE\t/\tFALSE\t0\tx\ty", "app.vercel.app\tFALSE\t/\tTRUE\t0\t_vercel_share\ts1"].join("\n");
    expect(cookieHeaderFor(jar, "app.vercel.app")).toBe("_vercel_jwt=j1; _vercel_share=s1");
  });
  it("diffShape names the topic whose item count moved", () => {
    expect(diffShape(baseline, shapeOf(WORLD(2, "partial")))).toEqual([expect.stringContaining("identity")]);
    expect(diffShape(baseline, baseline)).toEqual([]);
  });
});
