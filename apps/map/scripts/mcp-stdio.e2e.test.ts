import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// scripts/mcp-stdio.mjs, run for real: the process the README tells a client to start. It compiles lib/mcp with the
// typescript that npm ci installed into the gitignored .tmp-mcp, imports the MCP SDK and zod, serves JSON-RPC lines on
// stdin and stdout, and calls the HTTP API at GEV_BASE_URL. Here that API is a local http server answering the routes
// of a recorded world_context reply (lib/mcp/__fixtures__/world/austin_pt.json) byte for byte, so nothing leaves the
// machine. One session over the wire: initialize, the initialized notification, tools/list, then a world_context call
// with the fixture's own input.
//
// What it needs, all from apps/map's package.json and installed by map-ci's npm ci: typescript (devDependency, for the
// tsc compile and the calendar transpile), @modelcontextprotocol/sdk (stdio transport and server) and zod
// (dependencies), @types/node (tsc --types node), Node 22, and write access to apps/map/.tmp-mcp. The first start
// compiles (tens of seconds on a cold runner), so the timeouts are long.
//
// The clock is frozen in the child at the day the fixture was recorded (a --import preload; the script itself is not
// touched). The reply is then the one world.test.ts judges the twelve recorded replies on (no source stale, every item
// whole) in any year this test runs, instead of one that drifts toward `stale` and the byte cap as the fixture ages.
// The mutant stdio-calendar-null (apps/map/scripts/rule-mutate.mjs) swaps the script's cadenceOf for a function that
// answers null while keeping the two lines scripts/mcp-calendar.test.ts reads; only this test kills it.

const APP = path.resolve(__dirname, "..");
const SCRIPT = path.join(APP, "scripts", "mcp-stdio.mjs");
const FIXTURE = path.join(APP, "lib", "mcp", "__fixtures__", "world", "austin_pt.json");
const RECORDED_DAY = "2026-10-19T12:00:00Z";

const FREEZE_CLOCK = `const FIXED = Date.parse(${JSON.stringify(RECORDED_DAY)});
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED);
    else super(...args);
  }
  static now() {
    return FIXED;
  }
};
`;

type Json = Record<string, unknown>;
interface Rpc {
  id?: number;
  result?: Json;
  error?: { code: number; message: string };
}
interface Recorded {
  input: Json;
  routes: Record<string, { status: number; body: unknown }>;
}
interface Item {
  fact: string;
  sourceId: string;
  cadence?: unknown;
  publishedAt?: string | null;
}
interface Section {
  items?: Item[];
  missing?: Array<{ what: string; code: string }>;
}

/** A request target as the URL parser writes it, so a recorded key and the target fetch sends compare equal. */
function target(s: string): string {
  const u = new URL(s, "http://recorded.invalid");
  return u.pathname + u.search;
}

describe("scripts/mcp-stdio.mjs, started as a client starts it, against a recorded place", () => {
  let dir: string;
  let api: Server;
  let child: ChildProcessWithoutNullStreams;
  const requested: string[] = [];
  let recorded: Map<string, { status: number; body: unknown }>;
  const stderr: string[] = [];
  const junk: string[] = [];
  let init: Rpc;
  let list: Rpc;
  let call: Rpc;
  let fixture: Recorded;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gev-mcp-stdio-"));
    fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as Recorded;
    recorded = new Map(Object.entries(fixture.routes).map(([k, v]) => [target(k), v]));
    api = createServer((req, res) => {
      requested.push(req.url ?? "");
      const hit = recorded.get(target(req.url ?? "/"));
      const r = hit ?? { status: 500, body: { error: `not recorded: ${req.url}` } };
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
    await new Promise<void>((ok) => api.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

    const preload = path.join(dir, "freeze-clock.mjs");
    await writeFile(preload, FREEZE_CLOCK);
    child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, SCRIPT], { cwd: APP, env: { ...process.env, GEV_BASE_URL: base } });
    child.stdin.on("error", () => undefined); // a write to a child that has already exited is reported by the rpc below, not here

    const waiting = new Map<number, { ok: (m: Rpc) => void; fail: (e: Error) => void }>();
    let out = "";
    let gone: string | null = null;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      out += d;
      for (let i = out.indexOf("\n"); i >= 0; i = out.indexOf("\n")) {
        const line = out.slice(0, i).trim();
        out = out.slice(i + 1);
        if (!line) continue;
        let m: Rpc | null = null;
        try {
          m = JSON.parse(line) as Rpc;
        } catch {
          junk.push(line.slice(0, 200));
        }
        if (m && typeof m.id === "number") waiting.get(m.id)?.ok(m);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => stderr.push(d));
    // What the child said, for the message of a failure: tsc writes its diagnostics to the inherited stdout.
    const said = () => `stderr:\n${stderr.join("").slice(-3000)}\nstdout, not protocol:\n${junk.join("\n").slice(-3000)}`;
    child.on("exit", (code, signal) => {
      gone = `exited (code ${code}, signal ${signal})`;
      for (const w of waiting.values()) w.fail(new Error(`mcp-stdio.mjs ${gone}. ${said()}`));
    });

    const send = (msg: Json) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
    const rpc = (id: number, method: string, params: Json, ms: number) =>
      new Promise<Rpc>((ok, fail) => {
        const timer = setTimeout(() => fail(new Error(`no reply to ${method} in ${ms} ms. ${said()}`)), ms);
        const settle = { ok, fail };
        waiting.set(id, {
          ok: (m) => {
            clearTimeout(timer);
            settle.ok(m);
          },
          fail: (e) => {
            clearTimeout(timer);
            settle.fail(e);
          },
        });
        if (gone) waiting.get(id)!.fail(new Error(`mcp-stdio.mjs ${gone}. ${said()}`));
        else send({ id, method, params });
      });

    // The first reply waits for the tsc compile of lib/mcp on a cold runner.
    init = await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-stdio-e2e", version: "0" } }, 150_000);
    send({ method: "notifications/initialized" });
    list = await rpc(2, "tools/list", {}, 30_000);
    call = await rpc(3, "tools/call", { name: "world_context", arguments: fixture.input }, 60_000);
  }, 240_000);

  afterAll(async () => {
    child?.kill();
    await new Promise<void>((ok) => (api ? api.close(() => ok()) : ok()));
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const structured = (): { topics: Record<string, Section> } => (call.result as { structuredContent: { topics: Record<string, Section> } }).structuredContent;
  const items = (): Item[] => Object.values(structured().topics).flatMap((s) => s.items ?? []);

  it("answers initialize and tools/list over stdin and stdout, and says on stderr where its API is; stdout carries protocol lines only", () => {
    expect(init.error).toBeUndefined();
    const info = (init.result as { serverInfo: { name: string; version: string } }).serverInfo;
    expect(info.name).toEqual(expect.any(String));
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(list.error).toBeUndefined();
    const tools = (list.result as { tools: Array<{ name: string; outputSchema?: unknown }> }).tools;
    const world = tools.find((t) => t.name === "world_context");
    expect(world, "world_context is listed").toBeDefined();
    expect(world!.outputSchema, "world_context publishes its outputSchema").toEqual(expect.objectContaining({ type: "object" }));
    expect(stderr.join("")).toMatch(/gev mcp: stdio server up, API at http:\/\/127\.0\.0\.1:\d+/);
    expect(junk, "anything on stdout that is not a JSON-RPC line").toEqual([]);
  });

  it("world_context for the recorded place is answered through the HTTP API, not as an error", () => {
    expect(call.error).toBeUndefined();
    expect((call.result as { isError?: boolean }).isError).not.toBe(true);
    expect(Object.keys(structured().topics).length).toBeGreaterThan(2);
    expect(items().length).toBeGreaterThan(20);
    expect(requested.some((u) => u.startsWith("/api/hazards?op=history")), `requests: ${requested.join(" ")}`).toBe(true);
    expect(requested.some((u) => u.startsWith("/api/releases?op=calendar"))).toBe(true);
  });

  // The local server answers a route the recording lacks with a 500 "not recorded", and world_context carries on without
  // that route's items, so the other cases would not notice the child asking for one. This one does.
  it("every request the child made hit a route the recording holds: none was answered as unrecorded", () => {
    expect(requested.length, "the child asked the API at all").toBeGreaterThan(0);
    const unrecorded = requested.filter((u) => !recorded.has(target(u)));
    expect(unrecorded, `routes the recording lacks (all requests: ${requested.join(" ")})`).toEqual([]);
  });

  it("an item carries its publisher's cadence from the release calendar the script hands createServer, and one from a source with no calendar entry carries none", () => {
    const all = items();
    const withCadence = all.filter((i) => "cadence" in i);
    expect(withCadence.length, "items that carry a cadence").toBeGreaterThan(3);
    for (const i of withCadence) expect(i.cadence, `${i.sourceId}: ${i.fact}`).toEqual({ kind: expect.any(String), precision: expect.stringMatching(/^(official|approximate)$/), source: expect.any(String) });
    expect(all.some((i) => !("cadence" in i)), "an item whose source has no calendar entry says nothing about a cadence").toBe(true);
    const drought = all.find((i) => i.fact.startsWith("U.S. Drought Monitor this week"));
    expect(drought, "the Drought Monitor item").toBeDefined();
    expect(drought!.cadence).toEqual({ kind: "weekly", precision: "official", source: "usdm" });
    expect(drought!.publishedAt).toBe("2026-10-13");
  });

  it("on the day the place was recorded no source is stale, which also shows the child's clock is the frozen one", () => {
    const stale = Object.entries(structured().topics).flatMap(([topic, s]) => (s.missing ?? []).filter((m) => m.code === "stale").map((m) => `${topic}: ${m.what}`));
    expect(stale).toEqual([]);
  });
});
