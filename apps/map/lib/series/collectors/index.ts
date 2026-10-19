// Collector registry. Add a collector by importing it here; the snapshot
// script, the guarded API op and `op=collectors` all read this list.

import type { Collector, CollectorDescription } from "./types";
import { portVesselsCollector } from "./portVessels";
import { cargoFlightsCollector } from "./cargoFlights";
import { gaugesCollector } from "./gauges";
import { reservoirsCollector } from "./reservoirs";
import { quakesCollector } from "./quakes";

export const COLLECTORS: readonly Collector[] = [portVesselsCollector, cargoFlightsCollector, gaugesCollector, reservoirsCollector, quakesCollector];

const BY_ID: ReadonlyMap<string, Collector> = new Map(COLLECTORS.map((c) => [c.id, c]));

/** Look a collector up by its id, or undefined. */
export function byId(id: string): Collector | undefined {
  return BY_ID.get(id);
}

/** Static descriptions for the API and the docs. */
export function describeCollectors(): CollectorDescription[] {
  return COLLECTORS.map((c) => c.describe());
}

export type { Collector, CollectorContext, CollectorDescription, CollectorOutput, FetchJson, WebSocketLike } from "./types";
