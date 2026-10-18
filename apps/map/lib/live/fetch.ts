// Server side of the live feed: the live NWS alerts rated Severe or Extreme, the
// outlines of the zones named by alerts that carry no polygon of their own,
// and the past day's M4.5+ earthquakes. Either feed failing leaves the other
// standing; the route lists what failed.

import { cacheDelete, cached, type Cached, type CachedOptions } from "@/lib/server/cache";
import { polite, upstreamJson } from "@/lib/server/upstream";
import { geojsonRings, roundRings } from "@/lib/fabric/geo";
import { alertRank, LIVE_SEVERITIES, parseAlerts, parseQuakes, liveItems, thinRing, type AlertItem, type NwsAlertCollection, type LiveItem, type QuakeItem } from "./live";

export const ALERTS_URL = `https://api.weather.gov/alerts/active?status=actual&severity=${LIVE_SEVERITIES.join(",")}`;
export const QUAKES_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
/** How long one answer of the live feed is kept, seconds. */
export const LIVE_TTL_S = 300;
const LIVE_KEY = "live";
/** Most distinct zone outlines one refresh looks up (each is one small NWS call, cached a week). */
const MAX_ZONES = 160;
const ZONE_TTL_MS = 7 * 24 * 3600_000;

export interface LiveFeed {
  alerts: AlertItem[];
  quakes: QuakeItem[];
  items: LiveItem[];
  failed: Array<{ source: "nws-api" | "usgs-earthquakes"; error: string }>;
  /** Alerts left without an outline (zone lookups over the cap, or zones without geometry). */
  unmapped: number;
}

async function zoneRings(url: string): Promise<number[][][] | null> {
  if (!/^https:\/\/api\.weather\.gov\/zones\/[a-z]+\/[A-Z0-9]+$/.test(url)) return null;
  const r = await cached(`nws-zone:${url}`, ZONE_TTL_MS, async () => {
    const z = await polite("nws-zones", 40, 30_000, () => upstreamJson<{ geometry?: { type: string; coordinates: unknown } | null }>("nws-api", url, { timeoutMs: 12_000, headers: { accept: "application/geo+json" } }));
    if (!z.geometry) return null;
    return roundRings(geojsonRings(z.geometry).map((ring) => thinRing(ring, 0.02)), 3);
  });
  return r.value;
}

export async function fetchLive(): Promise<LiveFeed> {
  const failed: LiveFeed["failed"] = [];
  const [alerts, quakes] = await Promise.all([
    upstreamJson<NwsAlertCollection>("nws-api", ALERTS_URL, { timeoutMs: 15_000, headers: { accept: "application/geo+json" } })
      .then(parseAlerts)
      .catch((err: unknown) => {
        failed.push({ source: "nws-api", error: err instanceof Error ? err.message : String(err) });
        return [] as AlertItem[];
      }),
    upstreamJson<Parameters<typeof parseQuakes>[0]>("usgs-earthquakes", QUAKES_URL, { timeoutMs: 15_000 })
      .then(parseQuakes)
      .catch((err: unknown) => {
        failed.push({ source: "usgs-earthquakes", error: err instanceof Error ? err.message : String(err) });
        return [] as QuakeItem[];
      }),
  ]);
  // Alerts issued by zone: draw the zones they name. Strongest alerts claim
  // the lookup budget first; a zone named by several alerts is fetched once.
  const byZone = alerts.filter((a) => !a.rings && a.zones.length).sort((a, b) => alertRank(b) - alertRank(a));
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const a of byZone) {
    const fresh = a.zones.filter((z) => !seen.has(z));
    if (wanted.length + fresh.length > MAX_ZONES) continue;
    for (const z of fresh) {
      seen.add(z);
      wanted.push(z);
    }
  }
  const outlines = new Map(await Promise.all(wanted.map(async (z) => [z, await zoneRings(z).catch(() => null)] as const)));
  for (const a of byZone) {
    if (!a.zones.every((z) => outlines.has(z))) continue;
    const rings = a.zones.flatMap((z) => outlines.get(z) ?? []);
    if (rings.length) {
      a.rings = rings;
      a.outline = "zones";
    }
  }
  for (const a of alerts) if (a.rings && a.outline === "polygon") a.rings = roundRings(a.rings.map((r) => thinRing(r, 0.002)), 3);
  return { alerts, quakes, items: liveItems(alerts, quakes), failed, unmapped: alerts.filter((a) => !a.rings).length };
}

/**
 * The live feed through the one shared cache entry that /api/live serves and
 * /api/hazards reads (to mark the alerts Live warnings outlines). Every caller
 * goes through here: whichever starts the fetch sets the stored TTL, so they
 * all pass the same one. A degraded answer (a feed failed) is dropped once
 * read, so the next caller retries rather than inheriting the outage.
 */
export async function liveFeed(opts: CachedOptions = {}): Promise<Cached<LiveFeed>> {
  const r = await cached(LIVE_KEY, LIVE_TTL_S * 1000, fetchLive, opts);
  if (r.value.failed.length) cacheDelete(LIVE_KEY);
  return r;
}
