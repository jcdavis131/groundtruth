// Layer: On this day (Wikipedia). Dated events, births, deaths and selected
// entries for the mission-clock day, from the Wikimedia On this day feed
// (keyless), drawn at the first linked article that has a real place.
//
// An item whose pages carry no coordinates is not drawn and is counted in
// the note as having no mapped place — never placed by guess. Under the
// time machine only items from the playback year or earlier are shown.

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import { truncate } from "./wikipedia";
import type { WikiDayItem } from "@/lib/wiki/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function wikiDayToFeatures(
  items: WikiDayItem[],
  playbackYear: number | null,
): { features: LayerFeature<Point>[]; skipped: number } {
  const features: LayerFeature<Point>[] = [];
  let skipped = 0;
  for (const item of items ?? []) {
    if (playbackYear != null && item.year > playbackYear) continue;
    const page = (item.pages ?? []).find((p) => p.lat != null && p.lon != null && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (!page) {
      skipped++;
      continue;
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [page.lon!, page.lat!, 0] },
      properties: {
        id: `wd-${item.type}-${item.year}-${slugify(page.title)}`,
        layer: "wikiday",
        name: page.title,
        kind: item.type,
        altitude: 0,
        source: "Wikipedia",
        details: {
          year: item.year,
          event: item.text,
          "wikipedia page": page.url,
          extract: page.extract ? truncate(page.extract, 320) : null,
        },
      },
    });
  }
  return { features, skipped };
}

async function fetchWikiDay(ctx: FetchContext): Promise<FetchResult> {
  const when = new Date(ctx.missionTime ?? ctx.now);
  const mm = when.getUTCMonth() + 1;
  const dd = when.getUTCDate();
  const env = await proxy<WikiDayItem[]>(`/api/wikipedia?op=onthisday&mm=${mm}&dd=${dd}`, ctx);
  const playbackYear = ctx.playbackYear ?? null;
  const { features, skipped } = wikiDayToFeatures(env.data ?? [], playbackYear);
  let note =
    `${features.length} dated events with a mapped place for ${MONTHS[mm - 1]} ${dd}` +
    ` · ${skipped} more on this day have no mapped place and are not drawn`;
  if (playbackYear != null) note += ` · only events in or before ${playbackYear} are shown`;
  return {
    collection: { type: "FeatureCollection", features },
    source: env.source,
    fetchedAt: Date.now(),
    note,
    meta: { count: features.length, skipped },
  };
}

export const wikidayLayer: LayerDefinition = {
  id: "wikiday",
  label: "On this day (Wikipedia)",
  description:
    "Events, births, deaths and selected entries Wikipedia lists for this calendar day, drawn at the first linked article with a real place. Items with no mapped place are counted in the note, not drawn.",
  color: "#A78BFA",
  updateIntervalMs: 3_600_000,
  defaultEnabled: false,
  timeDependent: true,
  attribution: "Wikipedia On this day (CC BY-SA)",
  fetch: fetchWikiDay,
};
