// UI state for the indicators panel: open/closed, category filter, the last
// response. Kept apart from lib/store/globe.ts so this workstream owns it.
// No React import: the store is plain zustand and is exercised in vitest
// with a stubbed fetch.

import { create } from "zustand";
import type { Enveloped } from "@/lib/provenance/types";
import type { IndicatorResult } from "./service";
import type { IndicatorCategory } from "./types";

export type CategoryFilter = IndicatorCategory | "all";

export interface IndicatorsState {
  open: boolean;
  category: CategoryFilter;
  data: IndicatorResult[] | null;
  generatedAt: string | null;
  caveats: string[];
  loading: boolean;
  error: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setCategory: (c: CategoryFilter) => void;
  /** Fetch every indicator from /api/indicators?op=latest; errors land in `error`, data is kept. */
  refresh: () => Promise<void>;
}

export type LatestResponse = Enveloped<{ items: IndicatorResult[] }>;

/** URL the store fetches; exported so the panel and tests agree on it. */
export const LATEST_URL = "/api/indicators?op=latest";

export const useIndicators = create<IndicatorsState>()((set) => ({
  open: false,
  category: "all",
  data: null,
  generatedAt: null,
  caveats: [],
  loading: false,
  error: null,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setCategory: (category) => set({ category }),
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const r = await fetch(LATEST_URL);
      const j = (await r.json()) as Partial<LatestResponse> & { error?: string };
      if (!r.ok || !j.data) throw new Error(j.error ?? `indicators ${r.status}`);
      set({ data: j.data.items, generatedAt: j.generatedAt ?? null, caveats: j.caveats ?? [], loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "indicators failed" });
    }
  },
}));

/** Items the current filter shows, in the order the API returned them. */
export function visibleItems(data: IndicatorResult[] | null, category: CategoryFilter): IndicatorResult[] {
  if (!data) return [];
  return category === "all" ? data : data.filter((i) => i.meta.category === category);
}
