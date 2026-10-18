// One request runner for the city and federal services behind the zoning and
// permits routes (Socrata portals, ArcGIS Online and ArcGIS Server, EPA ECHO,
// the Corps' ORM API). Server only.
//
// Politeness is per host, not per dataset: data.cityofchicago.org serves
// zoning, permits and licences, so all three share one gate. ArcGIS Online
// is one host for many cities, so its gate is the organisation (the first
// path segment), which is who pays for the traffic. Socrata portals get one
// request a second, ArcGIS two, ECHO and the Corps one every two seconds.
// After a 429 or a 503 a host is left alone for ten minutes: callers fail
// fast with the last error instead of piling on.

import { arcgisQuery, truncated } from "@/lib/server/arcgis";
import { polite, UpstreamError, upstreamJson } from "@/lib/server/upstream";
import { retrying } from "@/lib/server/net";

export interface GateRule {
  gate: string;
  minIntervalMs: number;
}

/** Gate name and spacing for a URL's host. */
export function gateOf(url: string): GateRule {
  const u = new URL(url);
  const host = u.host.toLowerCase();
  if (host === "services.arcgis.com" || /^services\d+\.arcgis\.com$/.test(host)) {
    const org = u.pathname.split("/").filter(Boolean)[0] ?? "";
    return { gate: `${host}/${org}`, minIntervalMs: 500 };
  }
  if (host.endsWith("epa.gov") || host.endsWith("army.mil")) return { gate: host, minIntervalMs: 2000 };
  if (u.pathname.includes("/rest/services/")) return { gate: host, minIntervalMs: 500 };
  // Socrata portals and CKAN.
  return { gate: host, minIntervalMs: 1000 };
}

const COOL_MS = 10 * 60_000;
const cooling = new Map<string, { until: number; error: Error }>();

/** Run `fn` through the host's gate; a 429 or 503 closes the host for COOL_MS. */
export async function civicGate<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const { gate, minIntervalMs } = gateOf(url);
  const cool = cooling.get(gate);
  if (cool && cool.until > Date.now()) throw cool.error;
  try {
    return await polite(gate, minIntervalMs, COOL_MS, fn);
  } catch (err) {
    if (err instanceof UpstreamError && (err.status === 429 || err.status === 503)) {
      cooling.set(gate, { until: Date.now() + COOL_MS, error: err });
    }
    throw err;
  }
}

/** Test hook: forget every cool-down. */
export function resetCivicCooling(): void {
  cooling.clear();
}

export interface RowsResult {
  features: Array<{ id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>;
  /** ArcGIS said it cut the answer at its record limit. */
  truncated: boolean;
}

/** GET JSON through the host's gate, retrying resets and 5xx once (4xx and 429 never). */
export function civicJson<T>(name: string, url: string, timeoutMs = 20_000): Promise<T> {
  return retrying(() => civicGate(url, () => upstreamJson<T>(name, url, { timeoutMs })), 2);
}

/**
 * An ArcGIS layer query (as GeoJSON) or a Socrata URL (JSON rows or GeoJSON),
 * as one list of features. Socrata JSON rows become features with no geometry.
 */
export async function runRows(
  name: string,
  req: { kind: "arcgis"; layer: string; params: Record<string, string> } | { kind: "socrata"; url: string },
  timeoutMs = 20_000,
): Promise<RowsResult> {
  if (req.kind === "arcgis") {
    const { gate, minIntervalMs } = gateOf(req.layer);
    const cool = cooling.get(gate);
    if (cool && cool.until > Date.now()) throw cool.error;
    try {
      const fc = await arcgisQuery(name, req.layer, req.params, { gate, minIntervalMs, timeoutMs, tries: 2 });
      return { features: fc.features, truncated: truncated(fc) };
    } catch (err) {
      if (err instanceof UpstreamError && (err.status === 429 || err.status === 503)) cooling.set(gate, { until: Date.now() + COOL_MS, error: err });
      throw err;
    }
  }
  const j = await civicJson<unknown>(name, req.url, timeoutMs);
  if (Array.isArray(j)) return { features: j.map((row) => ({ geometry: null, properties: row as Record<string, unknown> })), truncated: false };
  const fc = j as { type?: string; features?: RowsResult["features"]; error?: unknown; message?: string };
  if (fc.type === "FeatureCollection" && Array.isArray(fc.features)) return { features: fc.features, truncated: false };
  throw new UpstreamError(name, 502, `${name}: unexpected answer${fc.message ? `: ${String(fc.message).slice(0, 120)}` : ""}`);
}
