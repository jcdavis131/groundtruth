// Webhook delivery: POST the events as JSON, signed with HMAC-SHA256 so the
// receiver can prove the payload came from a server holding the secret.
//
//   X-GEV-Signature: sha256=<hex hmac of the raw body>
//   X-GEV-Timestamp: <ISO time the body was signed>
//
// Guard rails: https only; no private, loopback, link-local or metadata
// addresses (SSRF); 10 s timeout; one retry on a network error or 5xx; a
// redirect is followed once and only to another https URL that passes the
// same check. Server only (node:crypto).

import { createHmac, timingSafeEqual } from "node:crypto";
import type { WatchEvent } from "./evaluate";

export interface WebhookOptions {
  url: string;
  secret: string;
  watchlistId: string;
  title: string;
  /** Marks a test delivery so receivers can ignore it. */
  sample?: boolean;
  timeoutMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface WebhookResult {
  ok: boolean;
  status: number;
  attempts: number;
  /** Final URL the request went to (after at most one redirect). */
  deliveredTo: string;
  error?: string;
}

export interface WebhookPayload {
  type: "gev.watch.events";
  watchlistId: string;
  title: string;
  generatedAt: string;
  sample: boolean;
  events: WatchEvent[];
}

// ---------------------------------------------------------------- URL guard

function ipv4Parts(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

/** RFC 1918, loopback, link-local, CGNAT, "this network", benchmark, multicast, reserved, broadcast. */
export function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

/** Expand an IPv6 literal (no brackets) into 8 hextets; null when malformed. */
export function ipv6Hextets(host: string): number[] | null {
  let s = host.toLowerCase();
  if (s.includes("%")) s = s.slice(0, s.indexOf("%"));
  // Trailing dotted quad (::ffff:127.0.0.1) -> two hextets.
  const v4 = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const p = ipv4Parts(v4[1]);
    if (!p) return null;
    s = s.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  return [...head, ...new Array(fill).fill(0), ...tail];
}

export function isPrivateIpv6(h: number[]): boolean {
  const allZero = h.every((x) => x === 0);
  if (allZero) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if (h[0] === 0xff00 || (h[0] & 0xff00) === 0xff00) return true; // multicast
  const mapped = h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff; // ::ffff:a.b.c.d
  const nat64 = h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0); // 64:ff9b::/96
  if (mapped || nat64) return isPrivateIpv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  return false;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".intranet", ".lan", ".corp", ".home", ".localdomain"];

/** Hostname-level check. Does not resolve DNS; a receiver that rebinds to a private address after this check is out of scope. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (host === "metadata.google.internal" || host === "metadata" || host === "instance-data") return true;
  const v4 = ipv4Parts(host);
  if (v4) return isPrivateIpv4(v4);
  if (host.startsWith("[") && host.endsWith("]")) {
    const h6 = ipv6Hextets(host.slice(1, -1));
    return h6 ? isPrivateIpv6(h6) : true;
  }
  if (host.includes(":")) {
    const h6 = ipv6Hextets(host);
    return h6 ? isPrivateIpv6(h6) : true;
  }
  // Bare single-label names only resolve on an intranet.
  if (!host.includes(".")) return true;
  return false;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Accept only public https URLs. Credentials in the URL are refused too. */
export function checkWebhookUrl(raw: string): UrlCheck {
  if (typeof raw !== "string" || raw.length > 2048) return { ok: false, reason: "url must be a string of at most 2048 characters" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "url is not a valid absolute URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "url must use https" };
  if (url.username || url.password) return { ok: false, reason: "url must not carry credentials" };
  if (isPrivateHost(url.hostname)) return { ok: false, reason: `host ${url.hostname} is private, loopback, link-local or otherwise not reachable from the public internet` };
  return { ok: true, url };
}

// ---------------------------------------------------------------- signing

export function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Receiver-side check, exported so a Node consumer can import it verbatim. */
export function verify(body: string, secret: string, header: string | null | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(sign(body, secret));
  const got = Buffer.from(header.trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function buildPayload(events: WatchEvent[], opts: Pick<WebhookOptions, "watchlistId" | "title" | "sample">, generatedAt: string): WebhookPayload {
  return { type: "gev.watch.events", watchlistId: opts.watchlistId, title: opts.title, generatedAt, sample: !!opts.sample, events };
}

/** A representative payload for "Send test". */
export function sampleEvent(now = Date.now()): WatchEvent {
  return {
    itemRef: 0,
    ruleIndex: 0,
    rule: { itemRef: 0, metric: "home.yoyPct", op: ">=", value: 3 },
    kind: "county",
    itemId: "48453",
    name: "Travis County, TX",
    metric: "home.yoyPct",
    value: 3.4,
    previous: 2.9,
    basis: "state",
    firedAt: new Date(now).toISOString(),
    asOf: "2026-07-31",
    message: "Travis County, TX: home.yoyPct 3.40 at or above 3.00 (was 2.90)",
    link: "https://example.invalid/?lat=30.3&lon=-97.8&h=150000&layers=realestate&sel=realestate:county:48453",
  };
}

// ---------------------------------------------------------------- delivery

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

async function post(fetchImpl: typeof fetch, url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { method: "POST", body, headers, redirect: "manual", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deliver events to a webhook. Never throws: the result says what happened.
 * Attempts are bounded at two (one retry after a network error or a 5xx);
 * a redirect counts as an attempt and is followed at most once.
 */
export async function dispatch(events: WatchEvent[], opts: WebhookOptions): Promise<WebhookResult> {
  const check = checkWebhookUrl(opts.url);
  if (!check.ok) return { ok: false, status: 0, attempts: 0, deliveredTo: opts.url, error: check.reason };
  if (!opts.secret || opts.secret.length < 8) return { ok: false, status: 0, attempts: 0, deliveredTo: check.url.href, error: "secret must be at least 8 characters" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 10_000, 1000), 30_000);
  const generatedAt = new Date(now()).toISOString();
  const body = JSON.stringify(buildPayload(events, opts, generatedAt));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "embedding-atlas-watch/0.1 (+https://github.com/jcdavis131/gods-eye-view)",
    "x-gev-signature": sign(body, opts.secret),
    "x-gev-timestamp": generatedAt,
    "x-gev-watchlist": opts.watchlistId,
  };
  let target = check.url.href;
  let attempts = 0;
  let redirected = false;
  let lastError: string | undefined;
  let lastStatus = 0;
  while (attempts < 2) {
    attempts++;
    let res: Response;
    try {
      res = await post(fetchImpl, target, body, headers, timeoutMs);
    } catch (err) {
      lastError = err instanceof Error ? (err.name === "AbortError" ? `timed out after ${timeoutMs} ms` : err.message) : String(err);
      continue;
    }
    lastStatus = res.status;
    if (REDIRECTS.has(res.status)) {
      const loc = res.headers.get("location");
      if (redirected || !loc) return { ok: false, status: res.status, attempts, deliveredTo: target, error: "redirect refused (only one redirect is followed)" };
      let next: string;
      try {
        next = new URL(loc, target).href;
      } catch {
        return { ok: false, status: res.status, attempts, deliveredTo: target, error: "redirect to an invalid URL" };
      }
      const again = checkWebhookUrl(next);
      if (!again.ok) return { ok: false, status: res.status, attempts, deliveredTo: target, error: `redirect refused: ${again.reason}` };
      redirected = true;
      target = again.url.href;
      continue;
    }
    if (res.status >= 500) {
      lastError = `receiver answered ${res.status}`;
      continue;
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, attempts, deliveredTo: target, error: res.status >= 400 ? `receiver answered ${res.status}` : undefined };
  }
  return { ok: false, status: lastStatus, attempts, deliveredTo: target, error: lastError ?? "delivery failed" };
}
