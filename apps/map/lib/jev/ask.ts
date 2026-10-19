// Asking Jev: one world_context call over this site's own MCP endpoint
// (POST /api/mcp, tools/call), the same code path agents use. The only thing
// sent is the picked place: a county or state FIPS, or a point. No new route,
// no new data, no model, no key.

import { JEV_TOPICS, type JevBundle } from "./format";

export type JevTarget = { kind: "point"; lon: number; lat: number } | { kind: "county" | "state"; fips: string };

/** world_context runs two phases of up to 25 s under the route's 60 s limit. */
export const JEV_TIMEOUT_MS = 62_000;

/** The tool arguments for a target: exactly one of fips or lon+lat, and the panel's topics. */
export function jevArguments(t: JevTarget): Record<string, unknown> {
  const where = t.kind === "point" ? { lon: Math.round(t.lon * 1e4) / 1e4, lat: Math.round(t.lat * 1e4) / 1e4 } : { fips: t.fips };
  return { ...where, topics: [...JEV_TOPICS] };
}

export function jevRequest(t: JevTarget): { jsonrpc: "2.0"; id: number; method: "tools/call"; params: { name: "world_context"; arguments: Record<string, unknown> } } {
  return { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "world_context", arguments: jevArguments(t) } };
}

export type JevAnswerResult = { ok: true; bundle: JevBundle } | { ok: false; error: string };

/** Read a JSON-RPC reply from /api/mcp: the tool's payload, or why there is none. */
export function readReply(body: unknown): JevAnswerResult {
  const o = (body && typeof body === "object" ? body : {}) as { result?: { structuredContent?: unknown; content?: { type?: string; text?: string }[]; isError?: boolean }; error?: { message?: string } };
  if (o.error) return { ok: false, error: o.error.message ?? "the server refused the call" };
  const r = o.result;
  if (!r) return { ok: false, error: "the server sent no result" };
  let payload = r.structuredContent as JevBundle | undefined;
  if (!payload) {
    const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    try {
      payload = JSON.parse(text) as JevBundle;
    } catch {
      return { ok: false, error: "the reply was not readable" };
    }
  }
  if (r.isError) return { ok: false, error: typeof payload?.error === "string" ? payload.error : "world_context could not answer for this place" };
  return { ok: true, bundle: payload };
}

export async function askJev(t: JevTarget, signal?: AbortSignal): Promise<JevAnswerResult> {
  const res = await fetch("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(jevRequest(t)),
    signal,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `HTTP ${res.status}: the reply was not JSON` };
  }
  return readReply(body);
}

/** A ⌘K place hit (Nominatim, via /api/geocode) Jev can be asked about. */
export interface PlacePick {
  lon: number;
  lat: number;
  type: string;
}

/**
 * The target for a ⌘K place hit. A county or a state is asked by its FIPS,
 * read from the place fabric (/api/fabric?op=stack, Census TIGERweb) at the
 * hit's point, so Jev centres a county on Census's internal point. Anything
 * else (a city, a town), or a hit the fabric cannot place, is asked as a point.
 */
export async function targetForPick(h: PlacePick, signal?: AbortSignal): Promise<JevTarget> {
  const point: JevTarget = { kind: "point", lon: h.lon, lat: h.lat };
  if (h.type !== "county" && h.type !== "state") return point;
  try {
    const res = await fetch(`/api/fabric?op=stack&lon=${h.lon.toFixed(4)}&lat=${h.lat.toFixed(4)}`, { signal });
    if (!res.ok) return point;
    const json = (await res.json()) as { data?: { nodes?: { kind?: string; code?: string }[] } };
    return fipsTarget(h.type, json.data?.nodes ?? []) ?? point;
  } catch {
    return point;
  }
}

export function fipsTarget(type: string, nodes: { kind?: string; code?: string }[]): JevTarget | null {
  const code = nodes.find((n) => n.kind === type)?.code;
  if (type === "county" && code && /^\d{5}$/.test(code)) return { kind: "county", fips: code };
  if (type === "state" && code && /^\d{2}$/.test(code)) return { kind: "state", fips: code };
  return null;
}
