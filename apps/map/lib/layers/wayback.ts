// Layer: historic imagery. Esri World Imagery as it was published on any of
// its releases since 2014-02-20 (World Imagery Wayback), drawn over the base
// imagery. The release is a setting (the picker under the layer's row, and
// `wb=` in links); none set means the newest.
//
// The fetch asks /api/terrain?op=wayback for the release index (held a day
// there) and passes the release to draw in `meta`; the style builds the tile
// set from it (lib/globe/terrainStyles.ts). Tiles load from Esri directly. A
// release date is when Esri published that version of the basemap, not when
// its pixels were captured, and nothing before 2014 is here.

import type { FetchContext, FetchResult, LayerDefinition } from "./types";
import { proxy } from "./aircraft";
import { resolveRelease, WAYBACK_ATTRIBUTION, type WaybackRelease } from "@/lib/terrain/wayback";

async function fetchWayback(ctx: FetchContext): Promise<FetchResult> {
  const env = await proxy<{ releases: WaybackRelease[] }>("/api/terrain?op=wayback", ctx);
  const list = env.data.releases ?? [];
  const { release, fallback } = resolveRelease(list, ctx.options.waybackRelease);
  const meta: Record<string, unknown> = {
    picture: true,
    count: 0,
    waybackRelease: release?.release ?? null,
    waybackDate: release?.date ?? null,
    waybackFallback: fallback,
    waybackReleases: list.length,
  };
  return {
    collection: { type: "FeatureCollection", features: [] },
    source: "Esri World Imagery Wayback",
    fetchedAt: ctx.now,
    note: release
      ? `Esri World Imagery as published ${release.date} (a release date, not a capture date; pixels can be older)` +
        (fallback ? " · the release in the link is not in Esri's index, so the newest is shown" : "") +
        ` · ${list.length} releases, ${list[list.length - 1].date} to ${list[0].date} · click the ground for the capture date`
      : "Esri's Wayback index listed no release",
    meta,
  };
}

export const waybackLayer: LayerDefinition = {
  id: "wayback",
  label: "Historic imagery (Wayback)",
  description:
    "Esri World Imagery as it was published on a chosen release date, 2014 to now (World Imagery Wayback), over the base imagery: pick a release under the layer's row. A release date is not a capture date: click the ground for the capture date Esri lists there. Releases start in 2014.",
  color: "#94A3B8",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: false,
  attribution: `World Imagery Wayback: ${WAYBACK_ATTRIBUTION}`,
  fetch: fetchWayback,
};
