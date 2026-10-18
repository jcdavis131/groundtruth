import { describe, expect, it } from "vitest";
import { wikiDayToFeatures } from "./wikiday";
import type { WikiDayItem } from "@/lib/wiki/types";

function item(p: Partial<WikiDayItem>): WikiDayItem {
  return { year: 1963, text: "Something happened.", type: "event", pages: [], ...p };
}

const MAPPED = { title: "Dealey Plaza", url: "https://en.wikipedia.org/wiki/Dealey_Plaza", extract: "A plaza.", lat: 32.7786, lon: -96.8083 };
const UNMAPPED = { title: "No Place", url: "https://en.wikipedia.org/wiki/No_Place" };

describe("wikiDayToFeatures", () => {
  it("draws an item at its first page with coordinates", () => {
    const { features, skipped } = wikiDayToFeatures([item({ pages: [UNMAPPED, MAPPED] })], null);
    expect(skipped).toBe(0);
    expect(features).toHaveLength(1);
    expect(features[0].geometry).toEqual({ type: "Point", coordinates: [-96.8083, 32.7786, 0] });
    expect(features[0].properties.id).toBe("wd-event-1963-dealey-plaza");
    expect(features[0].properties.layer).toBe("wikiday");
    expect(features[0].properties.kind).toBe("event");
    expect(features[0].properties.details?.year).toBe(1963);
    expect(features[0].properties.details?.event).toBe("Something happened.");
    expect(features[0].properties.details?.["wikipedia page"]).toBe(MAPPED.url);
  });

  it("counts items with no mapped page as skipped, not drawn", () => {
    const { features, skipped } = wikiDayToFeatures([item({ pages: [UNMAPPED] }), item({ pages: [] })], null);
    expect(features).toEqual([]);
    expect(skipped).toBe(2);
  });

  it("filters items after the playback year without counting them as skipped", () => {
    const old = item({ year: 1900, pages: [MAPPED] });
    const future = item({ year: 2000, text: "Later.", pages: [MAPPED] });
    const { features, skipped } = wikiDayToFeatures([old, future], 1950);
    expect(features).toHaveLength(1);
    expect(features[0].properties.details?.year).toBe(1900);
    expect(skipped).toBe(0);
    // No playback year: everything with a place is drawn.
    expect(wikiDayToFeatures([old, future], null).features).toHaveLength(2);
  });
});
