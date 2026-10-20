// The one place cite-check touches the network: a per-host 1 request/s gate, a 25 s timeout, the accepted
// User-Agent per host, and a refusal to fetch anything outside the host table. Clock and fetch are injected so a
// test can drive it with a fake clock.

import { createHash } from "node:crypto";
import { RECORD_HOSTS, userAgentFor } from "./hosts";
import type { PublisherReply } from "./types";

export const MIN_GAP_MS = 1000;
export const TIMEOUT_MS = 25_000;
export const MAX_REQUESTS = 400;
const MAX_HOPS = 3;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export type FetchLike = (url: string, init: { headers: Record<string, string>; redirect: "manual"; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function inTable(url: string): boolean {
  return Object.values(RECORD_HOSTS).some((re) => re.test(url));
}

/** Waits so that no host sees two requests closer than minGapMs. Calls for different hosts do not wait for each other. */
export function createGate(clock: Clock, minGapMs = MIN_GAP_MS): (host: string) => Promise<void> {
  const next = new Map<string, number>();
  return async (host) => {
    const at = Math.max(clock.now(), next.get(host) ?? 0);
    next.set(host, at + minGapMs); // reserve the slot before waiting, so concurrent callers queue behind it
    const wait = at - clock.now();
    if (wait > 0) await clock.sleep(wait);
  };
}

export interface FetchDeps {
  fetchImpl: FetchLike;
  clock: Clock;
  gate: (host: string) => Promise<void>;
  timeoutMs?: number;
}

/**
 * GET one publisher URL. Throws, before any request, for a URL outside the host table. Never throws for a network
 * failure: that is status 0 with the error text. A redirect is followed (up to 3 hops) only to another URL in the table.
 */
export async function fetchPublisher(url: string, deps: FetchDeps): Promise<PublisherReply> {
  if (!inTable(url)) throw new Error(`refusing to fetch ${url}: not in the host table`);
  let target = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await deps.gate(new URL(target).host);
    try {
      const res = await deps.fetchImpl(target, {
        headers: { "user-agent": userAgentFor(target), accept: "application/json, text/csv, */*" },
        redirect: "manual",
        signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS) : undefined,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        const to = loc ? new URL(loc, target).href : "";
        if (!to || !inTable(to)) return { status: res.status, body: "", fetchedAt: new Date(deps.clock.now()).toISOString(), error: `redirect to ${to || "nowhere"}, outside the host table` };
        target = to;
        continue;
      }
      const body = await res.text();
      return { status: res.status, body, fetchedAt: new Date(deps.clock.now()).toISOString(), sha256: sha256Hex(body) };
    } catch (err) {
      return { status: 0, body: "", fetchedAt: new Date(deps.clock.now()).toISOString(), error: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160) };
    }
  }
  return { status: 0, body: "", fetchedAt: new Date(deps.clock.now()).toISOString(), error: "too many redirects" };
}
