"use client";
// Browser-side watchlists. Persisted to localStorage (key "gev:watchlists");
// nothing leaves the browser until the person copies a feed URL or clicks
// Publish. The globe store is read, never written, from here.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useGlobe } from "@/lib/store/globe";
import { newWatchlist, validateWatchlist, type Rule, type WatchItem, type Watchlist } from "./model";
import { selectionToItem } from "./selection";

export interface WatchlistsState {
  watchlists: Watchlist[];
  activeId: string | null;
  open: boolean;
  /** Webhook receiver per list (kept out of the token; local only). */
  webhooks: Record<string, string>;

  setOpen: (open: boolean) => void;
  setActive: (id: string | null) => void;
  create: (title?: string) => Watchlist;
  remove: (id: string) => void;
  rename: (id: string, title: string) => void;
  addItem: (item: WatchItem) => { ok: boolean; reason?: string };
  removeItem: (index: number) => void;
  addRule: (rule: Rule) => void;
  updateRule: (index: number, patch: Partial<Rule>) => void;
  removeRule: (index: number) => void;
  setWebhook: (id: string, url: string) => void;
  /** Replace or add a list from JSON text (export/import round trip). */
  importJson: (text: string) => { ok: boolean; reason?: string; id?: string };
  /** Add whatever is selected on the globe to the active list. */
  addSelection: () => { ok: boolean; reason?: string };
}

function bump(w: Watchlist, patch: Partial<Watchlist>): Watchlist {
  return { ...w, ...patch, version: w.version + 1 };
}

export const useWatchlists = create<WatchlistsState>()(
  persist(
    (set, get) => {
      const active = () => {
        const s = get();
        return s.watchlists.find((w) => w.id === s.activeId) ?? null;
      };
      const update = (id: string, fn: (w: Watchlist) => Watchlist) => set((s) => ({ watchlists: s.watchlists.map((w) => (w.id === id ? fn(w) : w)) }));
      return {
        watchlists: [],
        activeId: null,
        open: false,
        webhooks: {},

        setOpen: (open) => set({ open }),
        setActive: (activeId) => set({ activeId }),
        create: (title) => {
          const w = newWatchlist(title);
          set((s) => ({ watchlists: [...s.watchlists, w], activeId: w.id }));
          return w;
        },
        remove: (id) =>
          set((s) => {
            const watchlists = s.watchlists.filter((w) => w.id !== id);
            const webhooks = { ...s.webhooks };
            delete webhooks[id];
            return { watchlists, webhooks, activeId: s.activeId === id ? (watchlists[0]?.id ?? null) : s.activeId };
          }),
        rename: (id, title) => update(id, (w) => bump(w, { title: title.trim().slice(0, 120) || w.title })),
        addItem: (item) => {
          const w = active();
          if (!w) return { ok: false, reason: "no active watchlist" };
          if (w.items.length >= 50) return { ok: false, reason: "a watchlist holds at most 50 items" };
          if (w.items.some((it) => it.kind === item.kind && it.id === item.id)) return { ok: false, reason: `${item.name ?? item.id} is already on the list` };
          update(w.id, (cur) => bump(cur, { items: [...cur.items, item] }));
          return { ok: true };
        },
        removeItem: (index) => {
          const w = active();
          if (!w) return;
          update(w.id, (cur) =>
            bump(cur, {
              items: cur.items.filter((_, i) => i !== index),
              // Rules pointing at the removed item go; later indices shift down.
              rules: cur.rules
                .filter((r) => r.itemRef !== index)
                .map((r) => (typeof r.itemRef === "number" && r.itemRef > index ? { ...r, itemRef: r.itemRef - 1 } : r)),
            }),
          );
        },
        addRule: (rule) => {
          const w = active();
          if (!w || w.rules.length >= 100) return;
          update(w.id, (cur) => bump(cur, { rules: [...cur.rules, rule] }));
        },
        updateRule: (index, patch) => {
          const w = active();
          if (!w) return;
          update(w.id, (cur) => bump(cur, { rules: cur.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
        },
        removeRule: (index) => {
          const w = active();
          if (!w) return;
          update(w.id, (cur) => bump(cur, { rules: cur.rules.filter((_, i) => i !== index) }));
        },
        setWebhook: (id, url) => set((s) => ({ webhooks: { ...s.webhooks, [id]: url.trim() } })),
        importJson: (text) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            return { ok: false, reason: "not JSON" };
          }
          const v = validateWatchlist(parsed);
          if (!v.ok) return { ok: false, reason: v.errors.join("; ") };
          set((s) => {
            const exists = s.watchlists.some((w) => w.id === v.value.id);
            return { watchlists: exists ? s.watchlists.map((w) => (w.id === v.value.id ? v.value : w)) : [...s.watchlists, v.value], activeId: v.value.id };
          });
          return { ok: true, id: v.value.id };
        },
        addSelection: () => {
          const g = useGlobe.getState();
          if (!g.selected) return { ok: false, reason: "nothing is selected on the globe" };
          const m = selectionToItem(g.selected, g.selectedFeature);
          if (!m.ok) return { ok: false, reason: m.reason };
          if (!active()) get().create();
          return get().addItem(m.item);
        },
      };
    },
    {
      name: "gev:watchlists",
      version: 1,
      partialize: (s) => ({ watchlists: s.watchlists, activeId: s.activeId, webhooks: s.webhooks }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WatchlistsState>;
        // Re-validate what localStorage holds; a stale or hand-edited entry is dropped, not crashed on.
        const watchlists = (Array.isArray(p.watchlists) ? p.watchlists : []).map((w) => validateWatchlist(w)).flatMap((v) => (v.ok ? [v.value] : []));
        const activeId = watchlists.some((w) => w.id === p.activeId) ? (p.activeId ?? null) : (watchlists[0]?.id ?? null);
        return { ...current, watchlists, activeId, webhooks: p.webhooks && typeof p.webhooks === "object" ? p.webhooks : {} };
      },
    },
  ),
);

/** Log a line in the cockpit's signal log. */
export function watchLog(level: "info" | "warn" | "alert", text: string) {
  useGlobe.getState().pushLog({ level, text });
}
