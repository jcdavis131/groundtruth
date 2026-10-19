// The ?perf=1 gate: without the flag the overlay is not in the page at all.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseShare, shareQuery } from "@/lib/globe/share";
import { perfViewQuery } from "@/lib/perf/link";
import PerfOverlay from "./PerfOverlay";

describe("PerfOverlay", () => {
  it("renders nothing when the flag is off", () => {
    expect(renderToStaticMarkup(<PerfOverlay enabled={false} />)).toBe("");
  });

  it("renders nothing without a URL flag (the server render)", () => {
    expect(renderToStaticMarkup(<PerfOverlay />)).toBe("");
  });
});

describe("perf deep links", () => {
  it("spell a test view out as an ordinary share link that keeps perf and view", () => {
    const q = perfViewQuery("austin");
    const s = parseShare(q);
    expect(s.perf).toBe(true);
    expect(s.perfView).toBe("austin");
    expect(s.layers).toEqual(["schools", "dams", "hospitals"]);
    expect(s.lat).toBeCloseTo(30.2672, 4);
    expect(s.h).toBe(18_000);
  });

  it("leave a link without perf=1 untouched", () => {
    const s = parseShare("?lat=30&lon=-97&view=austin");
    expect(s.perf).toBeUndefined();
    expect(s.perfView).toBeUndefined();
    expect(shareQuery(s)).not.toContain("perf");
    expect(shareQuery(s)).not.toContain("view");
  });
});
