import { describe, expect, it } from "vitest";
import { enrichFabricWithWiki, wikiTitleForNode, type WikiDeps } from "./wiki";
import type { ConstructNode, Fabric } from "./types";

function node(kind: ConstructNode["kind"], name: string, id = `${kind}:x`): ConstructNode {
  return { id, kind, domain: "civic", name, facts: {}, links: [], source: "census-tigerweb" };
}

function fabricOf(nodes: ConstructNode[]): Fabric {
  return { point: { lon: -97.7431, lat: 30.2672 }, nodes, edges: [], answered: ["census-tigerweb"], failed: [], coverage: "US" };
}

describe("wikiTitleForNode", () => {
  it("builds place, county, state and country titles", () => {
    expect(wikiTitleForNode(node("place", "Austin"), "Texas")).toBe("Austin, Texas");
    expect(wikiTitleForNode(node("place", "Austin city"), "Texas")).toBe("Austin, Texas");
    expect(wikiTitleForNode(node("place", "Austin"), null)).toBe("Austin");
    expect(wikiTitleForNode(node("county", "Travis, TX"), "Texas")).toBe("Travis County, Texas");
    expect(wikiTitleForNode(node("county", "Travis County, TX"), "Texas")).toBe("Travis County, Texas");
    expect(wikiTitleForNode(node("state", "Texas"), "Texas")).toBe("Texas");
    expect(wikiTitleForNode(node("country", "United States of America"), null)).toBe("United States of America");
  });

  it("returns null for counties without a state name and for other kinds", () => {
    expect(wikiTitleForNode(node("county", "Travis, TX"), null)).toBeNull();
    expect(wikiTitleForNode(node("tract", "Census Tract 11.01"), "Texas")).toBeNull();
    expect(wikiTitleForNode(node("huc8", "Austin-Travis Lakes"), "Texas")).toBeNull();
    expect(wikiTitleForNode(node("school", "Austin Independent School District"), "Texas")).toBeNull();
  });
});

const STUB_NEARBY = [{ pageid: 1, title: "Austin, Texas", lat: 30.2672, lon: -97.7431, distM: 5, url: "https://en.wikipedia.org/wiki/Austin,_Texas" }];

function stubDeps(over: Partial<WikiDeps> = {}): WikiDeps {
  return {
    summary: async (title: string) => ({ title, extract: `${title} extract.`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` }),
    nearby: async () => STUB_NEARBY,
    ...over,
  };
}

describe("enrichFabricWithWiki", () => {
  it("adds a Wikipedia link and fact, sets wikiNearby, and never mutates the original nodes", async () => {
    const place = node("place", "Austin", "place:4805000");
    const county = node("county", "Travis, TX", "county:48453");
    const state = node("state", "Texas", "state:48");
    const tract = node("tract", "Census Tract 11.01", "tract:1");
    const fabric = fabricOf([place, county, state, tract]);
    const out = await enrichFabricWithWiki(fabric, -97.7431, 30.2672, stubDeps());
    const outPlace = out.nodes.find((n) => n.id === "place:4805000")!;
    expect(outPlace.links).toContainEqual({ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Austin%2C_Texas" });
    expect(outPlace.facts.wikipedia).toBe("Austin, Texas extract.");
    expect(outPlace).not.toBe(place);
    // Copy-on-write: the original node object is untouched.
    expect(place.links).toEqual([]);
    expect(place.facts).toEqual({});
    // Kinds without a title are left alone (same object).
    expect(out.nodes.find((n) => n.id === "tract:1")).toBe(tract);
    expect(out.wikiNearby).toEqual([{ title: "Austin, Texas", distM: 5, url: STUB_NEARBY[0].url }]);
    expect(out.answered).toContain("wikipedia");
    expect(out.failed).toEqual([]);
  });

  it("treats a missing article as silent (no link, no failure)", async () => {
    const fabric = fabricOf([node("state", "Texas", "state:48")]);
    const out = await enrichFabricWithWiki(fabric, -97.7431, 30.2672, stubDeps({ summary: async () => null }));
    expect(out.nodes[0].links).toEqual([]);
    expect(out.failed).toEqual([]);
    expect(out.answered).toContain("wikipedia");
  });

  it("lists wikipedia in failed and returns the original nodes when the whole enrichment throws", async () => {
    const place = node("place", "Austin", "place:4805000");
    const fabric = fabricOf([place]);
    const boom: WikiDeps = {
      summary: async () => {
        throw new Error("summary down");
      },
      nearby: async () => {
        throw new Error("nearby down");
      },
    };
    const out = await enrichFabricWithWiki(fabric, -97.7431, 30.2672, boom);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].source).toBe("wikipedia");
    expect(out.failed[0].error).toContain("nearby down");
    expect(out.nodes[0]).toBe(place);
    expect(out.wikiNearby).toBeUndefined();
    expect(out.answered).not.toContain("wikipedia");
  });
});
