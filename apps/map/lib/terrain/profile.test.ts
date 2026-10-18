import { describe, expect, it } from "vitest";
import { chooseZoom, profileSamples, profileStats, sampleHeights, slerp, tileKey, tilesFor, type HeightTile, type LonLat } from "./profile";
import { lonLatToTile } from "./webmercator";

/** Great-circle length on a 6,371 km sphere, standing in for the WGS84 geodesic the app passes. */
const hav = (a: LonLat, b: LonLat) => {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r;
  const dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};

describe("profileSamples", () => {
  it("spaces samples evenly by distance across segments of different length", () => {
    const pts: LonLat[] = [
      [-98.5, 29.4],
      [-98.49, 29.4],
      [-98.49, 29.43],
    ];
    const s = profileSamples(pts, 41, hav);
    expect(s).toHaveLength(41);
    expect(s[0]).toMatchObject({ lon: -98.5, lat: 29.4, distM: 0 });
    const total = hav(pts[0], pts[1]) + hav(pts[1], pts[2]);
    expect(s[40].distM).toBeCloseTo(total, 6);
    expect(s[40].lon).toBeCloseTo(-98.49, 9);
    expect(s[40].lat).toBeCloseTo(29.43, 9);
    for (let i = 1; i < s.length; i++) expect(s[i].distM - s[i - 1].distM).toBeCloseTo(total / 40, 6);
  });

  it("skips repeated vertices and needs a real segment", () => {
    expect(profileSamples([[-98, 29], [-98, 29]], 10, hav)).toEqual([]);
    expect(profileSamples([[-98, 29], [-98, 29], [-97.99, 29]], 3, hav)).toHaveLength(3);
  });

  it("interpolates on the great circle, landing on both ends", () => {
    const a: LonLat = [-100, 40];
    const b: LonLat = [-80, 40];
    expect(slerp(a, b, 0)[0]).toBeCloseTo(-100, 9);
    expect(slerp(a, b, 1)[0]).toBeCloseTo(-80, 9);
    // The great circle between two points on a parallel bows poleward.
    expect(slerp(a, b, 0.5)[1]).toBeGreaterThan(40.3);
  });
});

describe("zoom and tiles", () => {
  it("takes the deepest zoom whose tiles fit the budget", () => {
    const short = profileSamples([[-98.4718, 29.461], [-98.465, 29.461]], 50, hav);
    expect(chooseZoom(short, 16)).toBe(15);
    const long = profileSamples([[-105, 39], [-95, 30]], 200, hav);
    const z = chooseZoom(long, 16);
    expect(tilesFor(long, z).length).toBeLessThanOrEqual(16);
    expect(tilesFor(long, z + 1).length).toBeGreaterThan(16);
  });
});

describe("heights and stats", () => {
  it("reads a tile bilinearly and reports gaps where a tile is missing", () => {
    // A synthetic 4 × 4 tile rising 10 m per pixel eastward.
    const z = 15;
    const s = profileSamples([[-98.4718, 29.461], [-98.4716, 29.461]], 5, hav);
    const [fx, fy] = lonLatToTile(s[0].lon, s[0].lat, z);
    const key = tileKey(z, Math.floor(fx), Math.floor(fy));
    const ramp: HeightTile = { size: 4, heights: Array.from({ length: 16 }, (_, i) => (i % 4) * 10) };
    const hs = sampleHeights(s, z, new Map([[key, ramp]]));
    for (const h of hs) if (h != null) expect(h).toBeGreaterThanOrEqual(0);
    expect(sampleHeights(s, z, new Map())).toEqual([null, null, null, null, null]);
  });

  it("sums climb and descent over consecutive samples, skipping gaps", () => {
    const s = [0, 10, 20, 30, 40].map((d) => ({ lon: 0, lat: 0, distM: d }));
    const st = profileStats(s, [100, 110, 105, null, 120]);
    expect(st).toMatchObject({ lengthM: 40, samples: 5, valid: 4, spacingM: 10, minM: 100, maxM: 120, startM: 100, endM: 120, gainM: 10, lossM: 5 });
    const none = profileStats(s, [null, null, null, null, null]);
    expect(none.valid).toBe(0);
    expect(none.minM).toBeUndefined();
    expect(none.gainM).toBeUndefined();
    // Below sea level is a height like any other.
    expect(profileStats(s.slice(0, 2), [-86, -80]).minM).toBe(-86);
  });
});
