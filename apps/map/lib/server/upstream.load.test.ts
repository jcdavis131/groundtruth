// What the publisher gate (polite() in ./upstream) does when 50 callers arrive at once, against a recorded
// fetch: every call that would have reached a publisher is logged with the host and the (fake) clock.
//
// Why the gate and not world_context: world_context calls no publisher itself. lib/mcp/world.ts asks this
// app's own routes (/api/fabric, /api/live, /api/hazards, ...) and those reach publishers only through
// cached() (./cache) and polite() (./upstream), so a publisher call can be bounded, and counted, only here.
//
// The gate is per server process. These tests show what one process does; they say nothing about how many
// instances a host runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { envelopeForStatus } from "../mcp/errors";
import { cached } from "./cache";
import { jsonError, polite, upstreamJson, UpstreamError } from "./upstream";

interface Start {
  host: string;
  gate: string;
  at: number;
}

/** The recorded fetch: one entry per call that reached the "publisher". */
const log: Start[] = [];
let answer: () => Response = () => reply(200, {});

/** Enough of a Response for upstream(): no streams, so fake timers cannot stall a body read. */
function reply(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) as unknown } as unknown as Response;
}

const startsOf = (host: string) => log.filter((s) => s.host === host);

/** The most calls started inside any window of `windowMs` (half open), from their start times. */
function maxStartsInAWindow(times: number[], windowMs: number): number {
  const t = [...times].sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < t.length; hi++) {
    while (t[hi] - t[lo] >= windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

/** One line per host for the CI log: how many calls, how many in the busiest second, the first start times. */
function summary(host: string): string {
  const at = startsOf(host).map((s) => s.at);
  const t0 = Math.min(...at);
  return `upstream.load host=${host} calls=${at.length} busiest-second=${maxStartsInAWindow(at, 1000)} first-starts-ms=[${at
    .slice(0, 8)
    .map((a) => a - t0)
    .join(",")}]`;
}

describe("50 concurrent callers at the publisher gate, against a recorded fetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    log.length = 0;
    answer = () => reply(200, {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = new URL(String(input));
        log.push({ host: url.hostname, gate: url.searchParams.get("g") ?? "", at: Date.now() });
        return answer();
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** 50 callers, each with its own URL, spread over five gates (all 100 ms) that talk to one host. */
  async function fiftyOverFiveGates(host: string) {
    const calls = Array.from({ length: 50 }, (_, i) => polite(`${host}-gate-${i % 5}`, 100, 30_000, () => upstreamJson("pub", `https://${host}/q?g=${i % 5}&i=${i}`)));
    const done = Promise.allSettled(calls);
    await vi.advanceTimersByTimeAsync(60_000);
    return done;
  }

  it("callers asking for one thing share one publisher call", async () => {
    const host = "b-shared.example";
    const calls = Array.from({ length: 50 }, () => cached("upstream.load:b", 60_000, () => polite("b-gate", 100, 30_000, () => upstreamJson<{ n: number }>("pub", `https://${host}/q`))));
    const done = Promise.all(calls);
    await vi.advanceTimersByTimeAsync(1_000);
    const got = await done;
    console.log(summary(host));
    expect(startsOf(host)).toHaveLength(1);
    expect(got).toHaveLength(50);
    expect(new Set(got.map((g) => JSON.stringify(g.value))).size).toBe(1);
  });

  it("after a publisher answers 429, the callers queued behind it are not sent to it", async () => {
    const host = "a-429.example";
    answer = () => reply(429, "Too Many Requests");
    const calls = Array.from({ length: 50 }, (_, i) => polite("a-429-gate", 100, 30_000, () => upstreamJson("pub", `https://${host}/q?i=${i}`)));
    const done = Promise.allSettled(calls);
    await vi.advanceTimersByTimeAsync(10_000);
    const settled = await done;
    console.log(summary(host));
    expect(startsOf(host), `the publisher said 429 on its first call and was still asked ${startsOf(host).length} times`).toHaveLength(1);
    // Every caller gets the typed rate-limit error, not a hang and not a second 429 from the publisher.
    for (const s of settled) {
      expect(s.status).toBe("rejected");
      const reason = s.status === "rejected" ? (s.reason as unknown) : null;
      expect(reason).toBeInstanceOf(UpstreamError);
      expect((reason as UpstreamError).status).toBe(429);
    }
    // The gate reopens once its back-off (30 s here) has passed.
    await vi.advanceTimersByTimeAsync(30_001);
    answer = () => reply(200, { ok: true });
    const again = polite("a-429-gate", 100, 30_000, () => upstreamJson("pub", `https://${host}/q?again=1`));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(again).resolves.toEqual({ ok: true });
    expect(startsOf(host)).toHaveLength(2);
  });

  it("each gate starts its calls no closer than its own interval", async () => {
    const host = "c-gates.example";
    const settled = await fiftyOverFiveGates(host);
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
    expect(startsOf(host)).toHaveLength(50);
    for (const g of ["0", "1", "2", "3", "4"]) {
      const at = startsOf(host)
        .filter((s) => s.gate === g)
        .map((s) => s.at)
        .sort((a, b) => a - b);
      expect(at).toHaveLength(10);
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1], `gate ${g}, calls ${i - 1} and ${i}`).toBeGreaterThanOrEqual(100);
    }
  });

  // The gap, as it stands on 2026-10-20: a gate paces itself, not the host, so five gates on one host start
  // all 50 calls inside one second. docs/MCP.md states this number; this test is what holds the doc to it.
  it("records the burst docs/MCP.md states: five gates on one host start 50 calls in one second", async () => {
    const host = "d-burst.example";
    await fiftyOverFiveGates(host);
    console.log(summary(host));
    expect(maxStartsInAWindow(startsOf(host).map((s) => s.at), 1000)).toBe(50);
  });

  // The promise the chart cell makes: <= 1 call started per host per 1000 ms. Not held, so this is written
  // as the expected failure: CI stays green while the gap is open and goes red the day a host budget lands,
  // which is when this becomes a plain it() and the test above and the doc paragraph change with it.
  it.fails("a host sees at most one call started per 1000 ms, whichever gates they come through", async () => {
    const host = "e-spec.example";
    await fiftyOverFiveGates(host);
    expect(maxStartsInAWindow(startsOf(host).map((s) => s.at), 1000)).toBeLessThanOrEqual(1);
  });
});

describe("what a caller sees when the gate turns it away", () => {
  it("a 429 from a publisher reaches an MCP client as rate_limited, retryable", async () => {
    const res = jsonError(new UpstreamError("pub", 429, "pub 429: Too Many Requests"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(502);
    expect(body).toMatchObject({ upstream: "pub", status: 429 });
    const env = envelopeForStatus(res.status, body, false);
    expect(env).toMatchObject({ code: "rate_limited", retryable: true });
  });
});
