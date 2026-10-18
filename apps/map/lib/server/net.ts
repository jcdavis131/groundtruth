// Network resilience for the hazards, land and space routes. Server only.
//
// Measured on the machine these layers were built on (2026-09-25): its IPv6
// path to CloudFront-fronted hosts resets connections intermittently (8 of 13
// tries to USGS 3DEP; epqs.nationalmap.gov and earthquake.usgs.gov both reset
// under Node's fetch) while IPv4 was clean every time. Node tries IPv6 first
// when DNS lists it first, and a reset after connect is not something happy
// eyeballs falls back from. So these routes ask for IPv4-first resolution and
// retry a network failure; neither changes what any upstream sends.

import dns from "node:dns";
import { UpstreamError } from "./upstream";

let preferred = false;

/** Resolve IPv4 addresses first for this server process (idempotent). */
export function preferIpv4(): void {
  if (preferred) return;
  preferred = true;
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    /* older runtimes: keep the default order */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Network resets, our own timeouts and 5xx are worth another try; 4xx and 429 are not. */
export function retryable(err: unknown): boolean {
  if (err instanceof UpstreamError) return err.status >= 500;
  return true;
}

/** Run `fn` up to `tries` times, pausing 700 ms, 1.4 s, … between attempts on a retryable failure. */
export async function retrying<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!retryable(err) || i === tries - 1) break;
      await sleep(700 * (i + 1));
    }
  }
  throw last;
}
