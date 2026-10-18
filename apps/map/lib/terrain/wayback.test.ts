// Esri's Wayback release index, from a trimmed copy of waybackconfig.json
// captured 2026-10-12 (five real entries of 197, unmodified).
import { describe, expect, it } from "vitest";
import config from "./fixtures/wayback-config-trimmed.json";
import meta2014 from "./fixtures/wayback-meta-2014r01-5-sf.json";
import meta2026 from "./fixtures/wayback-meta-2026r09-4-sf.json";
import { captureText, metadataLayerFor, neighbourLayer, parseCaptures, parseReleaseId, parseWaybackConfig, releasesByYear, resolveRelease, srcDate, waybackMetadataUrls, waybackTiles, WAYBACK_HOST, zoomForHeight } from "./wayback";

describe("the Wayback release index", () => {
  it("reads each release's date from its title, newest first", () => {
    expect(parseWaybackConfig(config)).toEqual([
      { release: 63116, date: "2026-09-24" },
      { release: 26334, date: "2026-08-05" },
      { release: 23001, date: "2020-01-08" },
      { release: 4230, date: "2014-03-26" },
      { release: 10, date: "2014-02-20" },
    ]);
  });

  it("drops an entry whose title carries no date or whose key is not a release number, never guessing", () => {
    const c = config as unknown as Record<string, { itemTitle: string }>;
    const edited = { ...c, "26334": { ...c["26334"], itemTitle: "World Imagery" }, latest: c["63116"] };
    expect(parseWaybackConfig(edited).map((r) => r.release)).toEqual([63116, 23001, 4230, 10]);
    expect(parseWaybackConfig(null)).toEqual([]);
    expect(parseWaybackConfig([])).toEqual([]);
  });

  it("draws the release asked for, or the newest, saying when a link's release is not listed", () => {
    const list = parseWaybackConfig(config);
    expect(resolveRelease(list, null)).toEqual({ release: { release: 63116, date: "2026-09-24" }, fallback: false });
    expect(resolveRelease(list, 23001)).toEqual({ release: { release: 23001, date: "2020-01-08" }, fallback: false });
    expect(resolveRelease(list, 999)).toEqual({ release: { release: 63116, date: "2026-09-24" }, fallback: true });
    expect(resolveRelease([], 23001)).toEqual({ release: null, fallback: false });
    expect(parseReleaseId("63116")).toBe(63116);
    expect(parseReleaseId("6311.6")).toBeNull();
  });

  it("groups the picker by year and builds Esri's own tile path", () => {
    expect(releasesByYear(parseWaybackConfig(config)).map((g) => [g.year, g.releases.length])).toEqual([["2026", 2], ["2020", 1], ["2014", 2]]);
    expect(waybackTiles(63116)).toBe(`https://${WAYBACK_HOST}/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/63116/{z}/{y}/{x}`);
  });
});

describe("capture dates", () => {
  it("reads each release's metadata service from the index, and only Esri's own", () => {
    const urls = waybackMetadataUrls(config);
    expect(urls.get(10)).toBe("https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2014_r01/MapServer");
    expect(urls.get(63116)).toBe("https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r09/MapServer");
    const c = config as unknown as Record<string, { metadataLayerUrl: string }>;
    const evil = { ...c, "10": { ...c["10"], metadataLayerUrl: "https://example.com/arcgis/rest/services/World_Imagery_Metadata_2014_r01/MapServer" } };
    expect(waybackMetadataUrls(evil).has(10)).toBe(false);
    expect(waybackMetadataUrls(evil).has(63116)).toBe(true);
  });

  it("returns every row, dates parsed and a blank name null (2014-02-20 release at San Francisco, layer 5)", () => {
    const rows = (meta2014.features as Array<{ attributes: Record<string, unknown> }>).map((f) => f.attributes);
    const cs = parseCaptures(rows);
    expect(cs.map((x) => x.date)).toEqual(["2010-10-26", "2010-11-02"]);
    expect(cs.map((x) => x.drawOrder)).toEqual([90, 90]);
    expect(cs[0].name).toBeNull();
    expect(cs[1].name).toBe("US-CA-SanFran-Oakland");
    expect(cs[0]).toMatchObject({ resolutionM: 0.3, provider: "Microsoft", sourceCode: "UC-G", levels: [18, 18] });
    expect(captureText(cs)).toBe("captured 2010-10-26 and 2010-11-02 · 0.3 m · Microsoft (UC-G)");
    expect(captureText([])).toBe("Esri lists no capture date here");
    expect(srcDate(20101399)).toBeNull();
    expect(srcDate(null)).toBeNull();
  });

  it("maps a zoom to its band and tries a neighbour only when the rows' bands miss it", () => {
    expect(metadataLayerFor(18)).toBe(5);
    expect(metadataLayerFor(19)).toBe(4);
    expect(metadataLayerFor(3)).toBe(13);
    expect(metadataLayerFor(23)).toBe(0);
    const rows = (meta2026.features as Array<{ attributes: Record<string, unknown> }>).map((f) => f.attributes);
    const cs = parseCaptures(rows);
    expect(cs[0]).toMatchObject({ date: "2026-05-26", provider: "Vantor", name: "Vivid Advanced", levels: [12, 19] });
    expect(neighbourLayer(cs, 19, 4)).toBeNull();
    expect(neighbourLayer(cs, 20, 3)).toBe(2);
    expect(neighbourLayer(cs, 11, 12)).toBe(13);
    expect(neighbourLayer([], 19, 4)).toBeNull();
  });

  it("estimates the drawn zoom from camera height, coarser when higher", () => {
    expect(zoomForHeight(500, 37.77)).toBeGreaterThan(zoomForHeight(5_000, 37.77));
    expect(zoomForHeight(1, 0)).toBeLessThanOrEqual(23);
    expect(zoomForHeight(2e7, 0)).toBeGreaterThanOrEqual(0);
  });
});
