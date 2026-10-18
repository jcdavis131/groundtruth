// Layer: events. GDELT 2.0 conflict events of the last three hours, folded
// into the cities GDELT coded them at: how many verbal and material conflict
// events its machine coding found in the news for each place, by CAMEO class,
// with the publishing sites' domains. City-level locations only, no actor
// names, no article links (lib/events/gdelt.ts has the rules and GDELT's
// terms). Events coded from reports, not verified incidents.
//
//   GDELT 2.0   15-minute event export files, through /api/events

import type { FeatureCollection } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";

export const EVENT_HOURS = 3;

async function fetchEvents(ctx: FetchContext): Promise<FetchResult> {
  const env = await proxy<FeatureCollection>(`/api/events?op=conflict&hours=${EVENT_HOURS}`, ctx);
  const meta = env as unknown as { events?: number; window?: { from?: string; to?: string; files?: number; asked?: number }; leftOff?: { notCityLevel?: number } };
  const features = env.data.features as unknown as LayerFeature[];
  const w = meta.window;
  return {
    collection: { type: "FeatureCollection", features },
    source: "GDELT 2.0",
    fetchedAt: ctx.now,
    note:
      `${meta.events ?? 0} conflict events coded from news at ${features.length} cities, last ${EVENT_HOURS} h` +
      (w && w.files != null && w.asked != null && w.files < w.asked ? ` (${w.files} of ${w.asked} files answered)` : "") +
      ` · ${meta.leftOff?.notCityLevel ?? 0} placed only at a country or state, not drawn · machine-coded from reports, not verified · no actors, no links`,
    meta: { count: features.length },
  };
}

export const eventsLayer: LayerDefinition = {
  id: "events",
  label: "News events (GDELT)",
  description:
    "Conflict events GDELT coded automatically from the world's news in the last three hours, counted at the city each was placed in, by CAMEO class (protest, threaten, assault, fight…), with the sites that reported them. City-level only, no actor names, no article links; counts of reports, not verified incidents.",
  color: "#F97316",
  updateIntervalMs: 15 * 60_000,
  defaultEnabled: false,
  attribution: "The GDELT Project (https://www.gdeltproject.org/)",
  fetch: fetchEvents,
};
