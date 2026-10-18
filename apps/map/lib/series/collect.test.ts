import { describe, expect, it } from "vitest";
import { dailyKey, rollupDaily, runCollectors, validateOutputs, SERIES_ID_RE } from "./collect";
import { memoryStore } from "./store";
import type { Collector, CollectorOutput } from "./collectors/types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";

const NOW = Date.UTC(2026, 8, 11, 12);

function output(id: string, v: number | null, t = NOW): CollectorOutput {
  return {
    meta: { id, title: id, unit: "count", frequency: "irregular", provenance: provenance(source("gev-snapshot"), { kind: "snapshot", retrievedAt: new Date(NOW).toISOString() }) },
    points: [{ t, v }],
  };
}

function collector(id: string, collect: Collector["collect"], timeoutMs?: number): Collector {
  return { id, title: id, cadence: "3h", timeoutMs, describe: () => ({ id, title: id, cadence: "3h", seriesPrefix: "snapshot:", sources: ["gev-snapshot"], note: "test" }), collect };
}

describe("runCollectors", () => {
  it("writes outputs and isolates one collector's failure", async () => {
    const store = memoryStore();
    const lines: string[] = [];
    const report = await runCollectors({
      store,
      now: NOW,
      logger: (l) => lines.push(l),
      fetchJson: async () => {
        throw new Error("no network in tests");
      },
      collectors: [
        collector("good", async () => [output("snapshot:a", 1), output("snapshot:b", 2)]),
        collector("bad", async () => {
          throw new Error("upstream 503");
        }),
        collector("uses-fetch", async (ctx) => {
          await ctx.fetchJson("https://example.invalid");
          return [];
        }),
      ],
    });
    expect(report.ran).toEqual(["good"]);
    expect(report.failed).toEqual([
      { id: "bad", error: "upstream 503" },
      { id: "uses-fetch", error: "no network in tests" },
    ]);
    expect(report.seriesWritten).toBe(2);
    expect(report.pointsWritten).toBe(2);
    expect(report.startedAt).toBe(new Date(NOW).toISOString());
    expect((await store.get("snapshot:a"))?.points).toEqual([{ t: NOW, v: 1 }]);
    expect(lines.some((l) => l.startsWith("bad: FAILED"))).toBe(true);
  });
  it("honours only=, reports unknown ids and dry runs", async () => {
    const store = memoryStore();
    const report = await runCollectors({
      store,
      now: NOW,
      only: ["x", "nope"],
      dryRun: true,
      collectors: [collector("x", async () => [output("snapshot:x", 1)]), collector("y", async () => [output("snapshot:y", 1)])],
    });
    expect(report.ran).toEqual(["x"]);
    expect(report.failed).toEqual([{ id: "nope", error: "unknown collector" }]);
    expect(report.dryRun).toBe(true);
    expect(report.pointsWritten).toBe(1);
    expect(await store.list()).toEqual([]);
  });
  it("times a slow collector out and aborts its signal", async () => {
    let aborted = false;
    const report = await runCollectors({
      store: memoryStore(),
      now: NOW,
      collectors: [
        collector(
          "slow",
          (ctx) =>
            new Promise((resolve) => {
              ctx.signal?.addEventListener("abort", () => {
                aborted = true;
                resolve([]);
              });
            }),
          20,
        ),
      ],
    });
    expect(report.failed[0]).toMatchObject({ id: "slow" });
    expect(report.failed[0].error).toMatch(/timeout after 20 ms/);
    expect(aborted).toBe(true);
  });
  it("scales budgets", async () => {
    const report = await runCollectors({
      store: memoryStore(),
      timeoutScale: 0.001,
      collectors: [collector("slow", () => new Promise((r) => setTimeout(() => r([]), 200)), 30_000)],
    });
    expect(report.failed[0].error).toMatch(/timeout after 30 ms/);
  });
  it("drops malformed outputs instead of writing them", async () => {
    const store = memoryStore();
    const lines: string[] = [];
    const report = await runCollectors({
      store,
      now: NOW,
      logger: (l) => lines.push(l),
      collectors: [
        collector("messy", async () => [
          output("snapshot:ok", 1),
          { ...output("snapshot:ok2", 1), points: [{ t: NaN, v: 1 }, { t: NOW, v: Number.POSITIVE_INFINITY }, { t: NOW + 1, v: null }] },
          output("bad id with spaces", 1),
        ]),
      ],
    });
    expect(report.ran).toEqual(["messy"]);
    expect((await store.list()).map((m) => m.id)).toEqual(["snapshot:ok", "snapshot:ok2"]);
    expect((await store.get("snapshot:ok2"))?.points).toEqual([{ t: NOW + 1, v: null }]);
    expect(lines.some((l) => /bad series id/.test(l))).toBe(true);
    expect(lines.some((l) => /dropped 2 malformed/.test(l))).toBe(true);
  });
});

describe("validateOutputs / SERIES_ID_RE", () => {
  it("accepts the ids the collectors produce", () => {
    for (const id of ["snapshot:port-vessels:USLAX", "snapshot:gauge:07032000:00065", "snapshot:reservoir:toledo-bend:percent-full", "snapshot:quakes:world:m2.5", "snapshot:hub-cargo-aircraft:MEM"]) {
      expect(SERIES_ID_RE.test(id)).toBe(true);
    }
    for (const id of ["", "ab", "Snapshot:x", "a b", "a/b", "x".repeat(130), "../etc"]) expect(SERIES_ID_RE.test(id)).toBe(false);
  });
  it("keeps valid outputs untouched", () => {
    const o = [output("snapshot:a", 1)];
    expect(validateOutputs(o)).toEqual(o);
  });
});

describe("dailyKey / rollupDaily", () => {
  const day = (d: number, h: number) => Date.UTC(2026, 8, d, h);
  const pts = [
    { t: day(1, 3), v: 10 },
    { t: day(1, 9), v: 20 },
    { t: day(1, 21), v: 12 },
    { t: day(2, 3), v: null },
    { t: day(3, 3), v: 5 },
    { t: day(3, 1), v: 7 },
  ];
  it("keys by UTC day", () => {
    expect(dailyKey(day(1, 23))).toBe("2026-09-01");
    expect(dailyKey(day(1, 23) + 3_600_000)).toBe("2026-09-02");
  });
  it("mean, max and last per day; all-null days stay null; output sorted and midnight-stamped", () => {
    expect(rollupDaily(pts, "mean")).toEqual([
      { t: day(1, 0), v: 14 },
      { t: day(2, 0), v: null },
      { t: day(3, 0), v: 6 },
    ]);
    expect(rollupDaily(pts, "max").map((p) => p.v)).toEqual([20, null, 7]);
    expect(rollupDaily(pts, "last").map((p) => p.v)).toEqual([12, null, 5]);
    expect(rollupDaily([], "mean")).toEqual([]);
  });
});
