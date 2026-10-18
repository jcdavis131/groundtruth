// ArcGIS REST query helper for route handlers. FEMA, USFWS, USGS PAD-US,
// NIFC WFIGS and TIGERweb all speak the same `/query?f=geojson` dialect, and
// two of them misbehave in known ways: FEMA's NFHL resets TLS connections on
// a fair share of requests, and every ArcGIS server answers errors with a 200
// and an `{ error }` body. This wraps both: the body error becomes an
// UpstreamError with the server's own code, and network resets and 5xx are
// retried a couple of times with a growing pause. 4xx is never retried.

import { polite, UpstreamError, upstreamJson } from "./upstream";
import { retrying } from "./net";

export interface ArcgisFc<P = Record<string, unknown>> {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; id?: number | string; geometry: GeoJSON.Geometry | null; properties: P }>;
  /** Set by the server when the query hit maxRecordCount. */
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
}

export interface ArcgisOptions {
  /** Politeness gate name and minimum spacing between requests. */
  gate: string;
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Total attempts including the first. */
  tries?: number;
  /** How long the gate stays closed after a status in `backoffOn` (default 30 s after a 429). */
  backoffMs?: number;
  backoffOn?: readonly number[];
}

/** GET a layer's /query endpoint as GeoJSON, with retry on resets and 5xx. */
export async function arcgisQuery<P = Record<string, unknown>>(
  name: string,
  layerUrl: string,
  params: Record<string, string>,
  opts: ArcgisOptions,
): Promise<ArcgisFc<P>> {
  const qs = new URLSearchParams({ f: "geojson", ...params });
  const url = `${layerUrl}/query?${qs.toString()}`;
  return retrying(async () => {
    const j = await polite(
      opts.gate,
      opts.minIntervalMs ?? 250,
      opts.backoffMs ?? 30_000,
      () => upstreamJson<ArcgisFc<P> & { error?: { code?: number; message?: string } }>(name, url, { timeoutMs: opts.timeoutMs ?? 20_000 }),
      opts.backoffOn,
    );
    if (j.error) throw new UpstreamError(name, j.error.code ?? 502, `${name}: ${j.error.message ?? "query error"}`);
    return j;
  }, opts.tries ?? 3);
}

/**
 * GET a table's /query endpoint as Esri JSON rows (attributes only), with the
 * same retry and error handling. For tables that do not speak `f=geojson`
 * (some ArcGIS tables answer geoJSON with an error).
 */
export async function arcgisRows<A = Record<string, unknown>>(
  name: string,
  layerUrl: string,
  params: Record<string, string>,
  opts: ArcgisOptions,
): Promise<A[]> {
  return (await arcgisRowsCapped<A>(name, layerUrl, params, opts)).rows;
}

/** arcgisRows, plus whether the server cut the answer at its record limit (statistics queries included). */
export async function arcgisRowsCapped<A = Record<string, unknown>>(
  name: string,
  layerUrl: string,
  params: Record<string, string>,
  opts: ArcgisOptions,
): Promise<{ rows: A[]; exceeded: boolean }> {
  const qs = new URLSearchParams({ f: "json", ...params });
  const url = `${layerUrl}/query?${qs.toString()}`;
  return retrying(async () => {
    const j = await polite(
      opts.gate,
      opts.minIntervalMs ?? 250,
      opts.backoffMs ?? 30_000,
      () =>
        upstreamJson<{ features?: Array<{ attributes?: A }>; exceededTransferLimit?: boolean; error?: { code?: number; message?: string } }>(name, url, {
          timeoutMs: opts.timeoutMs ?? 20_000,
        }),
      opts.backoffOn,
    );
    if (j.error) throw new UpstreamError(name, j.error.code ?? 502, `${name}: ${j.error.message ?? "query error"}`);
    return { rows: (j.features ?? []).map((f) => f.attributes).filter((a): a is A => !!a), exceeded: j.exceededTransferLimit === true };
  }, opts.tries ?? 3);
}

/** Whether a GeoJSON answer was cut at the layer's record limit (ArcGIS puts the flag in two places). */
export function truncated(fc: ArcgisFc<unknown>): boolean {
  return fc.exceededTransferLimit === true || fc.properties?.exceededTransferLimit === true;
}

/** Layer metadata (fields and coded-value domains) as the server publishes it. */
export interface ArcgisLayerInfo {
  name?: string;
  maxRecordCount?: number;
  fields?: Array<{ name: string; alias?: string; domain?: { type: string; codedValues?: Array<{ code: string | number; name: string }> } | null }>;
}

export async function arcgisLayerInfo(name: string, layerUrl: string, gate: string): Promise<ArcgisLayerInfo> {
  return retrying(() => polite(gate, 250, 30_000, () => upstreamJson<ArcgisLayerInfo>(name, `${layerUrl}?f=json`, { timeoutMs: 20_000 })), 2);
}

/** field -> (code -> published label) from a layer's coded-value domains. */
export function codedDomains(info: ArcgisLayerInfo): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const f of info.fields ?? []) {
    const cv = f.domain?.codedValues;
    if (!cv?.length) continue;
    out.set(f.name, new Map(cv.map((c) => [String(c.code), c.name])));
  }
  return out;
}

/** Envelope geometry params for a lon/lat box. */
export function envelope(b: [number, number, number, number]): Record<string, string> {
  const [w, s, e, n] = b;
  return {
    geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
  };
}
