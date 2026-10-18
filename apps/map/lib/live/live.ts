// Live: where the world is doing something unusual right now.
//
// Two keyless live feeds, each already an agency's judgement of what matters:
//   NWS active alerts   warnings and watches the National Weather Service
//                       rates Severe or Extreme, with the area they cover
//   USGS earthquakes    every event of M4.5 or more in the past day
//
// An NWS warning is a construct of its own, one that is born and dies: a
// polygon drawn around the people and places a forecaster judged at risk,
// valid until it expires. The alerts layer draws them as short-lived
// constructs and joins them to the physical layers; Teleport flies to them,
// strongest first.
//
// This module is pure: it parses the feeds and ranks the items. The ranking
// uses only the fields the agencies publish (severity, urgency, certainty,
// magnitude); it is an ordering for a tour, not a risk score, and is never
// shown as a number.

import { geojsonRings, ringCentroid, ringsArea, ringsBbox, type BBox } from "@/lib/fabric/geo";

/**
 * The NWS severities the live feed asks for (lib/live/fetch.ts ALERTS_URL).
 * The Hazard alerts layer leaves exactly these to Live warnings while that
 * layer is on and draws every other NWS alert itself.
 */
export const LIVE_SEVERITIES = ["Extreme", "Severe"] as const;

/** The id the Live warnings layer gives an NWS alert (lib/layers/alerts.ts alertFeature). */
export function liveAlertId(nwsId: string): string {
  return `nws-alert:${nwsId}`;
}

/**
 * Whether the Live warnings layer draws this alert: it needs an outline with
 * a centre to stand on (the same test alertFeature makes before it builds one).
 */
export function liveDraws(a: Pick<AlertItem, "rings">): boolean {
  return !!a.rings && ringCentroid(a.rings) != null;
}

/**
 * The NWS ids of the alerts one live feed answer draws, or null when its NWS
 * request failed: then which alerts it would draw is unknown, not none.
 */
export function liveDrawnIds(feed: { alerts: Array<Pick<AlertItem, "id" | "rings">>; failed: Array<{ source: string }> }): Set<string> | null {
  if (feed.failed.some((f) => f.source === "nws-api")) return null;
  return new Set(feed.alerts.filter(liveDraws).map((a) => a.id));
}

export type HazardFamily ="tornado" | "flood" | "storm" | "wind" | "fire" | "winter" | "heat" | "marine" | "coastal" | "other";

export const FAMILIES: Record<HazardFamily, { label: string; color: string }> = {
  tornado: { label: "Tornado", color: "#F43F5E" },
  flood: { label: "Flood", color: "#3B82F6" },
  storm: { label: "Storm", color: "#EAB308" },
  wind: { label: "Wind", color: "#14B8A6" },
  fire: { label: "Fire weather", color: "#F97316" },
  winter: { label: "Winter", color: "#A5B4FC" },
  heat: { label: "Heat", color: "#EF4444" },
  marine: { label: "Marine", color: "#22D3EE" },
  coastal: { label: "Coastal", color: "#0EA5E9" },
  other: { label: "Other", color: "#E879F9" },
};

/** Which family an NWS event name belongs to, by its words. */
export function hazardFamily(event: string): HazardFamily {
  const e = event.toLowerCase();
  if (/tornado/.test(e)) return "tornado";
  if (/coastal|surf|rip current|storm surge|tsunami|lakeshore/.test(e)) return "coastal";
  if (/flood|hydrologic/.test(e)) return "flood";
  if (/marine|gale|small craft|hurricane force wind|special marine|sea/.test(e)) return "marine";
  // Winter before storm: a winter storm or an ice storm is winter weather.
  if (/winter|snow|blizzard|ice|freeze|frost|cold|chill/.test(e)) return "winter";
  if (/hurricane|tropical|thunderstorm|storm/.test(e)) return "storm";
  if (/fire|red flag/.test(e)) return "fire";
  if (/wind|dust/.test(e)) return "wind";
  if (/heat/.test(e)) return "heat";
  return "other";
}

export interface AlertItem {
  id: string;
  event: string;
  family: HazardFamily;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string;
  areaDesc: string;
  sender: string;
  onset: string | null;
  expires: string | null;
  ends: string | null;
  /** The polygon the forecaster drew, or the zones it names; null until a zone lookup fills it. */
  rings: number[][][] | null;
  /** How the outline was obtained. */
  outline: "polygon" | "zones" | null;
  zones: string[];
  url: string;
}

interface NwsAlertFeature {
  id?: string;
  geometry?: { type: string; coordinates: unknown } | null;
  properties?: {
    id?: string;
    event?: string;
    severity?: string;
    urgency?: string;
    certainty?: string;
    headline?: string | null;
    areaDesc?: string;
    senderName?: string;
    onset?: string | null;
    effective?: string | null;
    expires?: string | null;
    ends?: string | null;
    status?: string;
    messageType?: string;
    affectedZones?: string[];
    "@id"?: string;
  };
}

export interface NwsAlertCollection {
  features?: NwsAlertFeature[];
}

/** The alerts that are actual, not cancelled, with their drawn polygon when they have one. */
export function parseAlerts(res: NwsAlertCollection): AlertItem[] {
  const out: AlertItem[] = [];
  for (const f of res.features ?? []) {
    const p = f.properties;
    if (!p?.event || (p.status && p.status !== "Actual") || p.messageType === "Cancel") continue;
    const rings = f.geometry ? geojsonRings(f.geometry) : [];
    const id = p.id ?? f.id ?? "";
    if (!id) continue;
    out.push({
      id,
      event: p.event,
      family: hazardFamily(p.event),
      severity: p.severity ?? "Unknown",
      urgency: p.urgency ?? "Unknown",
      certainty: p.certainty ?? "Unknown",
      headline: p.headline ?? p.event,
      areaDesc: p.areaDesc ?? "",
      sender: p.senderName ?? "NWS",
      onset: p.onset ?? p.effective ?? null,
      expires: p.expires ?? null,
      ends: p.ends ?? null,
      rings: rings.length ? rings : null,
      outline: rings.length ? "polygon" : null,
      zones: p.affectedZones ?? [],
      url: f.id ?? p["@id"] ?? `https://api.weather.gov/alerts/${encodeURIComponent(id)}`,
    });
  }
  return out;
}

/**
 * Thin a ring to points at least `tol` degrees apart (zone outlines carry
 * thousands of vertices; a warning on a globe needs a few hundred).
 */
export function thinRing(ring: number[][], tol = 0.01): number[][] {
  if (ring.length <= 8) return ring;
  const out: number[][] = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.abs(ring[i][0] - last[0]) >= tol || Math.abs(ring[i][1] - last[1]) >= tol) out.push(ring[i]);
  }
  out.push(ring[ring.length - 1]);
  return out.length >= 4 ? out : ring;
}

export interface QuakeItem {
  id: string;
  mag: number;
  place: string;
  time: number;
  lon: number;
  lat: number;
  depthKm: number;
  tsunami: boolean;
  alert: string | null;
  url: string;
}

interface UsgsQuakeCollection {
  features?: Array<{
    id?: string;
    geometry?: { coordinates?: number[] };
    properties?: { mag?: number | null; place?: string | null; time?: number; tsunami?: number; alert?: string | null; url?: string };
  }>;
}

export function parseQuakes(res: UsgsQuakeCollection): QuakeItem[] {
  const out: QuakeItem[] = [];
  for (const f of res.features ?? []) {
    const c = f.geometry?.coordinates;
    const p = f.properties;
    if (!f.id || !c || c.length < 2 || p?.mag == null || !Number.isFinite(p.mag)) continue;
    out.push({
      id: f.id,
      mag: p.mag,
      place: p.place ?? "unknown location",
      time: p.time ?? 0,
      lon: c[0],
      lat: c[1],
      depthKm: c[2] ?? 0,
      tsunami: p.tsunami === 1,
      alert: p.alert ?? null,
      url: p.url ?? `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`,
    });
  }
  return out;
}

const SEVERITY: Record<string, number> = { Extreme: 3, Severe: 2, Moderate: 1, Minor: 0.5 };
const URGENCY: Record<string, number> = { Immediate: 1.5, Expected: 1.2, Future: 1, Past: 0.3 };
const CERTAINTY: Record<string, number> = { Observed: 1.3, Likely: 1.1, Possible: 0.9, Unlikely: 0.5 };
const PAGER: Record<string, number> = { red: 4, orange: 3, yellow: 2, green: 1 };

/** Tour order for an alert: severity, then urgency, then certainty, as NWS rates them (and in force now before later; see liveItems). */
export function alertRank(a: Pick<AlertItem, "severity" | "urgency" | "certainty">): number {
  return (SEVERITY[a.severity] ?? 0.5) * (URGENCY[a.urgency] ?? 1) * (CERTAINTY[a.certainty] ?? 1);
}

/** Tour order for a quake, on the same scale: M4.5 ≈ a possible severe watch, M7 ≈ an observed extreme warning; a PAGER alert or tsunami lifts it. */
export function quakeRank(q: Pick<QuakeItem, "mag" | "alert" | "tsunami">): number {
  return Math.max(0.5, (q.mag - 3.5) * 1.3) + (q.alert ? (PAGER[q.alert] ?? 0) : 0) + (q.tsunami ? 1 : 0);
}

export interface LiveItem {
  kind: "alert" | "quake";
  id: string;
  title: string;
  subtitle: string;
  lon: number;
  lat: number;
  /** Extent to frame when flying there; null for a point. */
  bbox: BBox | null;
  /** Wall-clock ms the thing started; for a warning, its onset. */
  time: number | null;
  /** Wall-clock ms it stops being current (a warning's expiry). */
  until: number | null;
  family: HazardFamily | "quake";
  color: string;
  url: string;
  rank: number;
}

/** A warning whose onset is further off than this ranks behind ones in force now. */
const SOON_MS = 6 * 3600_000;

export function liveItems(alerts: AlertItem[], quakes: QuakeItem[], now = Date.now()): LiveItem[] {
  const items: LiveItem[] = [];
  for (const a of alerts) {
    if (!a.rings) continue;
    const c = ringCentroid(a.rings);
    if (!c) continue;
    const t = a.onset ? Date.parse(a.onset) : NaN;
    const until = Date.parse(a.ends ?? a.expires ?? "");
    const later = Number.isFinite(t) && t - now > SOON_MS;
    items.push({
      kind: "alert",
      id: `nws-alert:${a.id}`,
      title: a.event,
      subtitle: a.areaDesc.split(";").slice(0, 3).join(";") + (a.areaDesc.split(";").length > 3 ? "…" : ""),
      lon: c[0],
      lat: c[1],
      bbox: ringsBbox(a.rings),
      time: Number.isFinite(t) ? t : null,
      until: Number.isFinite(until) ? until : null,
      family: a.family,
      color: FAMILIES[a.family].color,
      url: a.url,
      // Happening now before happening later.
      rank: alertRank(a) * (later ? 0.6 : 1),
    });
  }
  for (const q of quakes)
    items.push({
      kind: "quake",
      id: q.id,
      title: `M${q.mag.toFixed(1)} earthquake`,
      subtitle: q.place,
      lon: q.lon,
      lat: q.lat,
      bbox: null,
      time: q.time || null,
      until: null,
      family: "quake",
      color: "#FF6B3D",
      url: q.url,
      rank: quakeRank(q),
    });
  // Strongest first; newer first among equals.
  return items.sort((a, b) => b.rank - a.rank || (b.time ?? 0) - (a.time ?? 0));
}

/** Area of a warning's outline, km², computed from it. */
export function alertAreaKm2(a: Pick<AlertItem, "rings">): number | null {
  return a.rings ? Math.round(ringsArea(a.rings)) : null;
}
