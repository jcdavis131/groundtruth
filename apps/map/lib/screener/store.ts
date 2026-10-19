"use client";
// UI state for the screener panel: what kind of entity, the query text, the
// last result and which row is highlighted. runScreen() talks to /api/screen;
// nothing else in the store touches the network.

import { create } from "zustand";
import type { Provenance } from "@/lib/provenance/types";
import type { EntityKind, FieldMeta } from "./fields";
import type { FieldStats, ScreenRow } from "./engine";
import type { QueryError, SortKey } from "./query";

export interface ScreenerState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;

  kind: EntityKind;
  setKind: (kind: EntityKind) => void;
  queryText: string;
  setQueryText: (text: string) => void;

  rows: ScreenRow[];
  total: number;
  fields: FieldMeta[];
  fieldsUsed: string[];
  stats: Record<string, FieldStats>;
  provenance: Provenance[];
  caveats: string[];
  /** ISO time the server assembled the last result. */
  generatedAt: string | null;
  /** Kind and query text the current rows answer, so a changed input is visibly stale. */
  ranKind: EntityKind | null;
  ranQuery: string | null;

  /** Client-side table order; null keeps the server order. */
  sort: SortKey | null;
  setSort: (sort: SortKey | null) => void;
  selectedId: string | null;
  selectRow: (id: string | null) => void;

  loading: boolean;
  error: string | null;
  errors: QueryError[];

  /** Run the current kind + query against /api/screen (or the given ones) and replace the rows. */
  runScreen: (override?: { kind?: EntityKind; queryText?: string }) => Promise<void>;
  reset: () => void;
}

interface ScreenBody {
  data: { rows: ScreenRow[]; total: number; fieldsUsed: string[]; stats: Record<string, FieldStats>; kind: EntityKind; query: string };
  fields: FieldMeta[];
  provenance: Provenance[];
  generatedAt: string;
  caveats?: string[];
  error?: string;
  errors?: QueryError[];
}

let inflight: AbortController | null = null;

export const useScreener = create<ScreenerState>()((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),

  kind: "county",
  setKind: (kind) => set({ kind }),
  queryText: "",
  setQueryText: (queryText) => set({ queryText }),

  rows: [],
  total: 0,
  fields: [],
  fieldsUsed: [],
  stats: {},
  provenance: [],
  caveats: [],
  generatedAt: null,
  ranKind: null,
  ranQuery: null,

  sort: null,
  setSort: (sort) => set({ sort }),
  selectedId: null,
  selectRow: (selectedId) => set({ selectedId }),

  loading: false,
  error: null,
  errors: [],

  runScreen: async (override) => {
    const kind = override?.kind ?? get().kind;
    const queryText = override?.queryText ?? get().queryText;
    if (override) set({ kind, queryText });
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    set({ loading: true, error: null, errors: [] });
    try {
      const res = await fetch(`/api/screen?kind=${kind}&q=${encodeURIComponent(queryText)}`, { signal: ctrl.signal });
      const body = (await res.json()) as ScreenBody;
      if (ctrl.signal.aborted) return;
      if (!res.ok) {
        set({ loading: false, error: body.error ?? `${res.status} from /api/screen`, errors: body.errors ?? [] });
        return;
      }
      set({
        loading: false,
        rows: body.data.rows,
        total: body.data.total,
        fields: body.fields,
        fieldsUsed: body.data.fieldsUsed,
        stats: body.data.stats,
        provenance: body.provenance,
        caveats: body.caveats ?? [],
        generatedAt: body.generatedAt,
        ranKind: kind,
        ranQuery: queryText,
        sort: null,
        selectedId: null,
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      set({ loading: false, error: err instanceof Error ? err.message : "screen failed" });
    } finally {
      if (inflight === ctrl) inflight = null;
    }
  },

  reset: () => set({ rows: [], total: 0, fieldsUsed: [], stats: {}, provenance: [], caveats: [], generatedAt: null, ranKind: null, ranQuery: null, sort: null, selectedId: null, error: null, errors: [] }),
}));

/** Permalink parameter: `?screen=<kind>:<urlencoded query>`. */
export function parseScreenParam(v: string | null): { kind: EntityKind; queryText: string } | null {
  if (!v) return null;
  const i = v.indexOf(":");
  const kind = i < 0 ? v : v.slice(0, i);
  if (!["county", "state", "port", "crossing", "country"].includes(kind)) return null;
  let queryText = i < 0 ? "" : v.slice(i + 1);
  try {
    queryText = decodeURIComponent(queryText);
  } catch {
    // Leave a malformed escape as typed; the server reports the syntax error.
  }
  return { kind: kind as EntityKind, queryText };
}

export function formatScreenParam(kind: EntityKind, queryText: string): string {
  return `${kind}:${encodeURIComponent(queryText)}`;
}
