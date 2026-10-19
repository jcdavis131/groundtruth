// Helpers for talking to upstream public APIs from route handlers.
import { NextResponse } from "next/server";
import { USER_AGENT } from "./ua";

// Defined in ./ua (no next/* import) so plain-Node runners can share it.
export { USER_AGENT };

export class UpstreamError extends Error {
  constructor(
    public readonly upstream: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** fetch() with a timeout, a polite User-Agent and no Next.js data cache. */
export async function upstream(
  name: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 20_000, headers, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...(headers ?? {}) },
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      // Upstreams often answer with an HTML error page; keep only readable text.
      const body = raw
        .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      throw new UpstreamError(name, res.status, `${name} ${res.status}${body ? ": " + body : ""}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per-upstream politeness gate: at most one request every `minIntervalMs`,
 * callers queue behind each other. After a 429 (or any status in
 * `backoffOn`, e.g. a 503 from a county server) the gate closes for
 * `backoffMs` and callers fail fast with the last error instead of piling on.
 */
const gates = new Map<string, { next: number; blockedUntil: number; lastError?: Error }>();

export async function polite<T>(
  upstreamName: string,
  minIntervalMs: number,
  backoffMs: number,
  fn: () => Promise<T>,
  backoffOn: readonly number[] = [429],
): Promise<T> {
  let g = gates.get(upstreamName);
  if (!g) {
    g = { next: 0, blockedUntil: 0 };
    gates.set(upstreamName, g);
  }
  const now = Date.now();
  if (g.blockedUntil > now) {
    throw g.lastError ?? new UpstreamError(upstreamName, 429, `${upstreamName} cooling down after 429`);
  }
  const slot = Math.max(now, g.next);
  g.next = slot + minIntervalMs;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UpstreamError && backoffOn.includes(err.status)) {
      g.blockedUntil = Date.now() + backoffMs;
      g.lastError = err;
    }
    throw err;
  }
}

export async function upstreamJson<T = unknown>(
  name: string,
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const res = await upstream(name, url, init);
  return (await res.json()) as T;
}

/** Read an optional operator key forwarded by the browser. */
export function keyFrom(req: Request, id: string): string | undefined {
  const v = req.headers.get(`x-gev-${id.toLowerCase().replace(/_/g, "-")}`);
  return v && v.trim() ? v.trim() : undefined;
}

export function jsonError(err: unknown, fallback = "upstream failure") {
  if (err instanceof UpstreamError) {
    return NextResponse.json(
      { error: err.message, upstream: err.upstream, status: err.status },
      { status: 502 },
    );
  }
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status: 502 });
}

export function num(v: string | null, fallback: number, min?: number, max?: number): number {
  const n = v == null ? NaN : Number(v);
  let out = Number.isFinite(n) ? n : fallback;
  if (min != null) out = Math.max(min, out);
  if (max != null) out = Math.min(max, out);
  return out;
}

/** Standard JSON response for a proxied upstream payload. */
export function proxied(data: unknown, meta: Record<string, unknown> = {}) {
  return NextResponse.json({ ...meta, data });
}
