// Time series contract. A series is a named sequence of (time, value)
// observations with provenance. Snapshots of live feeds, backfilled indices,
// upstream histories and indicator traces all flow through this one shape so
// the API, the charts, the screener and the alerts can share code.

import type { Provenance } from "@/lib/provenance/types";

/** Observation. `t` is epoch ms (UTC). `v` is null when the upstream withheld or the feed was down. */
export interface Point {
  t: number;
  v: number | null;
}

export type Frequency = "irregular" | "5min" | "hourly" | "daily" | "weekly" | "monthly" | "quarterly" | "annual";

export interface SeriesMeta {
  /** Stable id, namespaced with ':' e.g. "snapshot:port-vessels:USLAX", "zhvi:county:48453", "fred:MORTGAGE30US", "indicator:mississippi-memphis-stage". */
  id: string;
  title: string;
  unit: string;
  frequency: Frequency;
  /** Optional geography the series describes. */
  geo?: { kind: "county" | "state" | "country" | "port" | "crossing" | "gauge" | "point" | "us" | "world"; id: string; name?: string; lon?: number; lat?: number };
  provenance: Provenance;
  /** Free tags for discovery and screening ("housing", "freight", "water"). */
  tags?: string[];
}

export interface Series extends SeriesMeta {
  points: Point[];
}

export interface SeriesQuery {
  /** Epoch ms inclusive bounds. */
  from?: number;
  to?: number;
  /** Cap on points returned, newest kept. */
  limit?: number;
}

/**
 * Storage for series. Implementations: in-memory (tests, dev), filesystem
 * (JSON files under a directory, used by the snapshot cron and by local dev),
 * and any remote KV/DB adapter that fits the same interface.
 */
export interface SeriesStore {
  /** Upsert points (merged by `t`, later writes win) and metadata. */
  append(meta: SeriesMeta, points: Point[]): Promise<void>;
  /** Read a series, or null if unknown. */
  get(id: string, q?: SeriesQuery): Promise<Series | null>;
  /** Metadata for every series whose id starts with `prefix` (all when omitted). */
  list(prefix?: string): Promise<SeriesMeta[]>;
  /** Remove a series. */
  remove(id: string): Promise<void>;
}
