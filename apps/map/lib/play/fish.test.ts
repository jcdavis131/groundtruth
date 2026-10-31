import { afterEach, describe, expect, it, vi } from "vitest";
import { FishError, openWater, reelIn, toHaul } from "./fish";

const envelope = {
  data: {
    fips: "48453",
    modelVersion: "county-sim-v1",
    vintage: "2026-10-01",
    k: 2,
    neighbours: [
      { fips: "48201", name: "Harris County", state: "TX", distance: 0.5, similarity: 1 / 1.5 },
      { fips: "04013", name: "Maricopa County", state: "AZ", distance: 1.0, similarity: 0.5 },
    ],
    distance: "Euclidean on standardized [12m, 5y, 10y ZHVI change, 12m rent change]",
    modelCard: "https://example.test/card.md",
  },
  caveats: ["v1 uses home values + rents only: similar housing trajectories, not similar places in full."],
};

describe("toHaul", () => {
  it("maps the similar envelope onto the panel's haul", () => {
    const haul = toHaul(envelope);
    expect(haul.fips).toBe("48453");
    expect(haul.modelVersion).toBe("county-sim-v1");
    expect(haul.vintage).toBe("2026-10-01");
    expect(haul.modelCard).toContain("card.md");
    expect(haul.caveat).toContain("housing trajectories");
    expect(haul.items).toHaveLength(2);
    expect(haul.items[0]).toMatchObject({ fips: "48201", name: "Harris County", state: "TX" });
    expect(haul.items[0].similarity).toBeCloseTo(2 / 3, 5);
  });

  it("falls back to the v1 caveat when the reply carries none", () => {
    const haul = toHaul({ data: envelope.data });
    expect(haul.caveat).toContain("housing trajectories");
  });
});

describe("openWater", () => {
  it("says plainly there is no bite", () => {
    expect(openWater().message).toContain("open water");
  });
});

describe("reelIn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the haul on a good reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(envelope) }));
    const haul = await reelIn("48453", 2);
    expect(haul.items).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("op=similar&fips=48453&k=2"));
  });

  it("reports an empty hook when the county is not in the embedding", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(reelIn("99999")).rejects.toThrow(FishError);
    await expect(reelIn("99999")).rejects.toThrow(/not in the similarity embedding/);
  });

  it("reports a snapped line when the service does not answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(reelIn("48453")).rejects.toThrow(/did not answer/);
  });

  it("never invents neighbours from a malformed reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) }));
    await expect(reelIn("48453")).rejects.toThrow(FishError);
  });
});
