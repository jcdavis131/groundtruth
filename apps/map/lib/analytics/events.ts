// What eye measures, in one place: the north star is weekly searches that open a cited record.
// Vercel Web Analytics carries page paths (query string and fragment stripped by stripUrl) and
// three custom events. Every property value is drawn from a fixed list or a count bucket built
// here; nothing typed by a viewer, no coordinates and no record ids ever reach a payload. Off
// until Web Analytics is enabled for the project in the Vercel dashboard: until then the
// /_vercel/insights script is not served and track() has nowhere to send.

import { track } from "@vercel/analytics";
import type { BeforeSendEvent } from "@vercel/analytics";
import { LAYER_IDS, type LayerId } from "@/lib/layers/types";

/** Result-count buckets for a search: never the exact count. */
export const RESULT_BUCKETS = ["0", "1-3", "4-8", "9+"] as const;
export type ResultBucket = (typeof RESULT_BUCKETS)[number];

/** The palette's result groups, in display order (components/hud/SearchCommand.tsx). */
export const SEARCH_GROUPS = ["objects", "meaning", "catalog", "plss", "place"] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

/** A result_open group: the layer a record belongs to, or the palette group for rows that are not layer records. */
export const RESULT_GROUPS = [...LAYER_IDS, "catalog", "plss", "place", "other"] as const;
export type ResultGroup = LayerId | "catalog" | "plss" | "place" | "other";

/** How a record's dossier was reached. */
export const RECORD_VIA = ["search", "map", "catalog"] as const;
export type RecordVia = (typeof RECORD_VIA)[number];

export interface EventProps {
  search: { results: ResultBucket; kind: string };
  result_open: { group: ResultGroup; source: "palette" };
  record_open: { layer: LayerId; via: RecordVia };
}
export type EventName = keyof EventProps;

/** The only keys each event may carry. */
export const ALLOWED_KEYS: { [K in EventName]: readonly (keyof EventProps[K])[] } = {
  search: ["results", "kind"],
  result_open: ["group", "source"],
  record_open: ["layer", "via"],
};

const LAYER_SET: ReadonlySet<string> = new Set(LAYER_IDS);

export function isLayerId(x: unknown): x is LayerId {
  return typeof x === "string" && LAYER_SET.has(x);
}

export function resultBucket(n: number): ResultBucket {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n <= 3) return "1-3";
  if (n <= 8) return "4-8";
  return "9+";
}

/** The groups present, in fixed order, joined by "+"; "none" when nothing came back. */
export function searchKind(counts: Partial<Record<SearchGroup, number>>): string {
  const present = SEARCH_GROUPS.filter((g) => (counts[g] ?? 0) > 0);
  return present.length ? present.join("+") : "none";
}

/** Every value searchKind can return: "none" and each non-empty ordered subset of SEARCH_GROUPS. */
export function allSearchKinds(): string[] {
  const out = ["none"];
  for (let mask = 1; mask < 1 << SEARCH_GROUPS.length; mask++) {
    out.push(SEARCH_GROUPS.filter((_, i) => mask & (1 << i)).join("+"));
  }
  return out;
}

/** Shortest query the palette searches (SearchCommand's searchFeatures); shorter is not a search. */
export const MIN_QUERY = 2;

/**
 * Props for one palette search, from the query and how many rows each group showed. The query
 * decides only whether this was a search at all; it is not read further and never sent.
 */
export function searchProps(query: string, counts: Partial<Record<SearchGroup, number>>): EventProps["search"] | null {
  if (query.trim().length < MIN_QUERY) return null;
  const total = SEARCH_GROUPS.reduce((n, g) => n + Math.max(0, counts[g] ?? 0), 0);
  return { results: resultBucket(total), kind: searchKind(counts) };
}

/** Props for opening a palette row: a layer id from the code's own list, else the row's group. */
export function resultOpenProps(group: string): EventProps["result_open"] {
  const g: ResultGroup = isLayerId(group) || group === "catalog" || group === "plss" || group === "place" ? group : "other";
  return { group: g, source: "palette" };
}

/** Props for opening a record's dossier; null (nothing sent) unless the layer is one eye defines. */
export function recordOpenProps(layer: unknown, via: RecordVia): EventProps["record_open"] | null {
  if (!isLayerId(layer) || !(RECORD_VIA as readonly string[]).includes(via)) return null;
  return { layer, via };
}

/** True when props carry only the event's allowed keys, each a string from its fixed list. */
export function propsAllowed<K extends EventName>(name: K, props: EventProps[K]): boolean {
  const keys = Object.keys(props);
  const allowed = ALLOWED_KEYS[name] as readonly string[];
  if (!keys.every((k) => allowed.includes(k))) return false;
  const p = props as unknown as Record<string, unknown>;
  switch (name) {
    case "search":
      return (RESULT_BUCKETS as readonly unknown[]).includes(p.results) && allSearchKinds().includes(p.kind as string);
    case "result_open":
      return (RESULT_GROUPS as readonly unknown[]).includes(p.group) && p.source === "palette";
    case "record_open":
      return isLayerId(p.layer) && (RECORD_VIA as readonly unknown[]).includes(p.via);
    default:
      return false;
  }
}

/** The one door to track(): anything off the fixed lists is dropped, never sent. */
export function send<K extends EventName>(name: K, props: EventProps[K] | null): void {
  if (!props || !propsAllowed(name, props)) return;
  try {
    track(name, { ...props });
  } catch {
    // Analytics must never break the globe.
  }
}

export function trackSearch(query: string, counts: Partial<Record<SearchGroup, number>>): void {
  send("search", searchProps(query, counts));
}

export function trackResultOpen(group: string): void {
  send("result_open", resultOpenProps(group));
}

export function trackRecordOpen(layer: unknown, via: RecordVia): void {
  send("record_open", recordOpenProps(layer, via));
}

/** beforeSend: pageviews and events carry the path only (eye keeps layers, bbox and more in the query string). */
export function stripUrl<E extends BeforeSendEvent>(event: E): E {
  try {
    const u = new URL(event.url);
    u.search = "";
    u.hash = "";
    return { ...event, url: u.toString() };
  } catch {
    const path = event.url.split(/[?#]/)[0];
    return { ...event, url: path };
  }
}
