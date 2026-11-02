// The flow layers' freshness note: the daily-refresh copy and the 28 h stale
// threshold (lib/layers/flows.ts says why 28 h).
import { describe, expect, it } from "vitest";
import type { FlowGrid } from "@/lib/globe/flowField";
import { STALE_MS, bundleAgeNote, oceanFlowLayer, windFlowLayer } from "./flows";
import type { FetchContext } from "./types";

const ASOF = "2026-11-01T20:15:00Z";
const after = (h: number, m = 0) => Date.parse(ASOF) + h * 3_600_000 + m * 60_000;
const bundle = { asof: ASOF } as FlowGrid;

describe("flow layers' freshness", () => {
  it("say they refresh daily and flag stale only past 28 h", () => {
    expect(STALE_MS).toBe(28 * 3_600_000);
    expect(bundleAgeNote(bundle, after(1))).toEqual({
      note: "as of 01 Nov 2026 20:15 UTC · refreshes daily",
      stale: false,
    });
  });

  it("do not flag a bundle at the end of a normal day, or one whose refresh runs 3 h late", () => {
    expect(bundleAgeNote(bundle, after(24, 40)).stale).toBe(false);
    expect(bundleAgeNote(bundle, after(27, 40)).stale).toBe(false);
    expect(bundleAgeNote(bundle, after(28)).stale).toBe(false);
  });

  it("flag a missed daily refresh from 28 h until the next run, 12 h later, lands", () => {
    expect(bundleAgeNote(bundle, after(28, 1))).toEqual({
      note: "STALE — as of 01 Nov 2026 20:15 UTC · refreshes daily",
      stale: true,
    });
    expect(bundleAgeNote(bundle, after(36, 40)).stale).toBe(true);
  });

  it("flag a bundle with no readable as-of", () => {
    expect(bundleAgeNote({ asof: "unknown" } as FlowGrid, after(1)).stale).toBe(true);
  });

  it("carry the note on the fetch result and re-read the built-in bundle every 6 h", async () => {
    const ctx: FetchContext = {
      keys: {},
      view: { lon: 0, lat: 0, height: 20_000_000, heading: 0, pitch: -90 },
      now: Date.now(),
      options: {},
    };
    for (const layer of [windFlowLayer, oceanFlowLayer]) {
      expect((await layer.fetch(ctx)).note).toMatch(/· refreshes daily$/);
      expect(layer.updateIntervalMs).toBe(6 * 3_600_000);
    }
  });
});
