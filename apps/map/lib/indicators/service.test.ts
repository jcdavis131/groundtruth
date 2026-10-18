import { describe, expect, it } from "vitest";
import { getIndicatorHistory, getIndicators, selectIndicators, sortByStatus } from "./service";
import type { Indicator } from "./types";
import { memoryStore } from "@/lib/series/store";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { Series } from "@/lib/series/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 11);

function fake(id: string, values: number[], extra: Partial<Indicator> = {}): Indicator {
  const ind: Indicator = {
    id,
    title: id,
    category: "macro",
    unit: "x",
    whyItMatters: "Test.",
    source: "fred",
    seriesId: id.toUpperCase(),
    cadence: "daily",
    thresholds: [{ level: "alert", op: ">=", value: 100, label: "high" }],
    fetch: async (ctx): Promise<Series> => ({
      id: `indicator:${ctx.indicator.id}`,
      title: ctx.indicator.title,
      unit: ctx.indicator.unit,
      frequency: "daily",
      provenance: provenance(source("fred"), { kind: "published", seriesId: ctx.indicator.seriesId, retrievedAt: new Date(ctx.now).toISOString() }),
      points: values.map((v, i) => ({ t: ctx.now - (values.length - 1 - i) * DAY, v })),
    }),
    ...extra,
  };
  return ind;
}

const failing = fake("svc-fails", [], {
  fetch: async () => {
    throw new Error("upstream 503");
  },
});

describe("getIndicators", () => {
  it("isolates a failing fetch and evaluates the rest", async () => {
    const registry = [fake("svc-ok", [1, 2, 150]), failing, fake("svc-fine", [5, 6])];
    const { items, generatedAt } = await getIndicators({ registry, now: NOW, noCache: true });
    expect(generatedAt).toBe(new Date(NOW).toISOString());
    expect(items.map((i) => i.meta.id)).toEqual(["svc-ok", "svc-fails", "svc-fine"]);
    expect(items[0].evaluation.status).toBe("alert");
    expect(items[0].provenance?.source.id).toBe("fred");
    expect(items[0].error).toBeUndefined();
    expect(items[1].evaluation.status).toBe("no data");
    expect(items[1].error).toBe("upstream 503");
    expect(items[1].provenance).toBeUndefined();
    expect(items[2].evaluation.latest).toBe(6);
    expect("fetch" in items[0].meta).toBe(false);
  });
  it("filters by ids and category", async () => {
    const registry = [fake("svc-a", [1]), fake("svc-b", [1], { category: "water" }), fake("svc-c", [1])];
    expect(selectIndicators({ registry, ids: ["svc-c", "svc-a"] }).map((i) => i.id)).toEqual(["svc-a", "svc-c"]);
    expect(selectIndicators({ registry, category: "water" }).map((i) => i.id)).toEqual(["svc-b"]);
    expect(selectIndicators({ registry, ids: ["svc-b"], category: "macro" })).toEqual([]);
    const { items } = await getIndicators({ registry, ids: ["svc-b"], now: NOW, noCache: true });
    expect(items).toHaveLength(1);
  });
  it("appends the latest point to the store under indicator:<id> and survives a broken store", async () => {
    const store = memoryStore();
    const registry = [fake("svc-store", [7, 8, 9])];
    await getIndicators({ registry, store, now: NOW, noCache: true });
    const s = await store.get("indicator:svc-store");
    expect(s?.points).toEqual([{ t: NOW, v: 9 }]);
    expect(s?.provenance.source.id).toBe("fred");
    expect((s as unknown as { points?: unknown }).points).toBeDefined();
    const broken = { ...store, append: async () => { throw new Error("disk full"); } };
    const { items } = await getIndicators({ registry, store: broken, now: NOW, noCache: true });
    expect(items[0].error).toBeUndefined();
    expect(items[0].evaluation.latest).toBe(9);
  });
  it("uses the process cache between calls unless noCache", async () => {
    let calls = 0;
    const counting = fake("svc-cached-" + Math.random().toString(36).slice(2), [1], {
      fetch: async (ctx) => {
        calls++;
        return fake("x", [1]).fetch(ctx);
      },
    });
    await getIndicators({ registry: [counting], now: NOW });
    await getIndicators({ registry: [counting], now: NOW });
    expect(calls).toBe(1);
    await getIndicators({ registry: [counting], now: NOW, noCache: true });
    expect(calls).toBe(2);
  });
});

describe("sortByStatus", () => {
  it("puts alerts first, keeps registry order within a status", async () => {
    const registry = [fake("svc-s1", [1]), fake("svc-s2", [200]), failing, fake("svc-s4", [300])];
    const { items } = await getIndicators({ registry, now: NOW, noCache: true });
    expect(sortByStatus(items).map((i) => i.meta.id)).toEqual(["svc-s2", "svc-s4", "svc-s1", "svc-fails"]);
  });
});

describe("getIndicatorHistory", () => {
  it("merges live points with stored ones and applies the query", async () => {
    const store = memoryStore();
    const live = fake("svc-hist", [10, 11, 12]);
    const s = await live.fetch({ now: NOW, indicator: live });
    await store.append(s, [{ t: NOW - 10 * DAY, v: 3 }]);
    const h = await getIndicatorHistory("svc-hist", { registry: [live], store, now: NOW, noCache: true });
    expect(h?.points.map((p) => p.v)).toEqual([3, 10, 11, 12]);
    const limited = await getIndicatorHistory("svc-hist", { registry: [live], store, now: NOW, noCache: true, limit: 2 });
    expect(limited?.points.map((p) => p.v)).toEqual([11, 12]);
    const ranged = await getIndicatorHistory("svc-hist", { registry: [live], store, now: NOW, noCache: true, from: NOW - 1 * DAY, to: NOW - 1 * DAY });
    expect(ranged?.points.map((p) => p.v)).toEqual([11]);
  });
  it("falls back to the store when upstream fails, null when neither exists", async () => {
    const store = memoryStore();
    expect(await getIndicatorHistory("svc-fails", { registry: [failing], store, now: NOW, noCache: true })).toBeNull();
    const s = await fake("svc-fails", [1]).fetch({ now: NOW, indicator: failing });
    await store.append(s, [{ t: NOW - DAY, v: 42 }]);
    const h = await getIndicatorHistory("svc-fails", { registry: [failing], store, now: NOW, noCache: true });
    expect(h?.points).toEqual([{ t: NOW - DAY, v: 42 }]);
    expect(await getIndicatorHistory("unknown", { registry: [failing], now: NOW })).toBeNull();
  });
});
