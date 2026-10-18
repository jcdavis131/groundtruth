import { describe, expect, it } from "vitest";
import { formatDistance, truncate, wikiArticlesToFeatures } from "./wikipedia";
import type { WikiArticle } from "@/lib/wiki/types";

const LONG = "x".repeat(500);

function article(p: Partial<WikiArticle>): WikiArticle {
  return { pageid: 1, title: "Austin, Texas", lat: 30.2672, lon: -97.7431, url: "https://en.wikipedia.org/wiki/Austin,_Texas", ...p };
}

describe("wikiArticlesToFeatures", () => {
  it("maps articles to point features with layer props", () => {
    const [f] = wikiArticlesToFeatures([article({ distM: 42, extract: "Capital city." })]);
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-97.7431, 30.2672, 0] });
    expect(f.properties.id).toBe("wp-1");
    expect(f.properties.layer).toBe("wikipedia");
    expect(f.properties.name).toBe("Austin, Texas");
    expect(f.properties.kind).toBe("article");
    expect(f.properties.source).toBe("Wikipedia");
    expect(f.properties.details).toEqual({
      extract: "Capital city.",
      distance: "42 m",
      "wikipedia page": "https://en.wikipedia.org/wiki/Austin,_Texas",
    });
  });

  it("truncates extracts to 320 characters and formats kilometres", () => {
    const [f] = wikiArticlesToFeatures([article({ distM: 12_340, extract: LONG })]);
    const extract = f.properties.details?.extract as string;
    expect(extract.length).toBe(320);
    expect(extract.endsWith("…")).toBe(true);
    expect(f.properties.details?.distance).toBe("12.3 km");
  });

  it("leaves missing extract and distance null and skips unmappable articles", () => {
    const out = wikiArticlesToFeatures([article({}), article({ pageid: 2, lat: NaN })]);
    expect(out).toHaveLength(1);
    expect(out[0].properties.details?.extract).toBeNull();
    expect(out[0].properties.details?.distance).toBeNull();
  });
});

describe("truncate + formatDistance", () => {
  it("keeps short text untouched", () => {
    expect(truncate("short", 320)).toBe("short");
    expect(formatDistance(999)).toBe("999 m");
    expect(formatDistance(1000)).toBe("1.0 km");
  });
});
