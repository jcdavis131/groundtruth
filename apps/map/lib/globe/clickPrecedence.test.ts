import { describe, expect, it } from "vitest";
import { clickAnswer } from "./clickPrecedence";

describe("what a left click answers", () => {
  it("with Parcels on, a click on a zoning district's fill or outline below 5 km is the parcel's", () => {
    expect(clickAnswer("zoning", { parcels: true, zoning: true }, 3_000)).toBe("parcel");
    expect(clickAnswer("zoning", { parcels: true, zoning: true }, 5_000)).toBe("parcel");
  });

  it("above 5 km the same click is zoning's, up to 15 km", () => {
    expect(clickAnswer("zoning", { parcels: true, zoning: true }, 5_001)).toBe("zoning");
    expect(clickAnswer(null, { parcels: true, zoning: true }, 12_000)).toBe("zoning");
    expect(clickAnswer(null, { parcels: true, zoning: true }, 16_000)).toBe("none");
  });

  it("with Parcels off, zoning answers the click on its district or the ground below 15 km", () => {
    expect(clickAnswer("zoning", { zoning: true }, 3_000)).toBe("zoning");
    expect(clickAnswer(null, { zoning: true }, 3_000)).toBe("zoning");
    expect(clickAnswer(null, { parcels: false, zoning: true }, 14_000)).toBe("zoning");
  });

  it("any other layer's object picked is that object, with Parcels and Zoning on and low", () => {
    for (const layer of ["aircraft", "ships", "cameras", "transmission", "permits"] as const) {
      expect(clickAnswer(layer, { parcels: true, zoning: true, soils: true, [layer]: true }, 1_000), layer).toBe("feature");
    }
  });

  it("the bare ground and a lot line are the parcel's below 5 km, before a ground picture", () => {
    expect(clickAnswer(null, { parcels: true }, 1_000)).toBe("parcel");
    expect(clickAnswer("parcels", { parcels: true }, 1_000)).toBe("parcel");
    expect(clickAnswer(null, { parcels: true, soils: true }, 3_000)).toBe("parcel");
    expect(clickAnswer(null, { zoning: true, soils: true }, 3_000)).toBe("zoning");
  });

  it("without Parcels or Zoning, a ground picture answers the ground, and nothing else clears", () => {
    expect(clickAnswer(null, { soils: true }, 3_000)).toBe("ground");
    expect(clickAnswer(null, { parcels: true, soils: true }, 20_000)).toBe("ground");
    expect(clickAnswer(null, { aircraft: true }, 3_000)).toBe("none");
    expect(clickAnswer("parcels", { parcels: true }, 6_000)).toBe("none");
  });
});
