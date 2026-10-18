"use client";
// "Other measures here": every CDC PLACES measure for the clicked county,
// grouped by CDC's category, asked of /api/civic?op=health&level=place when
// the dossier opens (a click, never a pan: a cold per-location query took
// 13.8 s on 2026-10-16, so the answer is held a week and edge-cached).

import { useEffect, useState } from "react";
import { placeDetails, type PlacesValue } from "@/lib/civic/places";

export default function HealthAside({ fips }: { fips: string }) {
  const [state, setState] = useState<{ values?: PlacesValue[]; error?: string }>({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch(`/api/civic?op=health&level=place&fips=${fips}`)
      .then((r) => r.json().then((j: { data?: { values?: PlacesValue[] }; error?: string }) => (r.ok && j.data ? j.data.values ?? [] : Promise.reject(new Error(j.error ?? `HTTP ${r.status}`)))))
      .then((values) => live && setState({ values }))
      .catch((e: Error) => live && setState({ error: e.message }));
    return () => {
      live = false;
    };
  }, [fips, open]);

  const lines = state.values ? Object.entries(placeDetails(state.values)) : [];
  return (
    <div className="border-t border-border px-3 py-2">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="hud-label">Other measures here (CDC PLACES)</span>
        <span className="text-[11px] text-muted-foreground" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && !state.values && !state.error && <div className="mt-1 text-[10px] text-muted-foreground">asking CDC PLACES for every measure in this county…</div>}
      {open && state.error && <div className="mt-1 text-[10px] text-alert">CDC PLACES did not answer: {state.error.slice(0, 80)}</div>}
      {open && lines.length > 0 && (
        <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-2 gap-y-0.5 text-[10px]">
          {lines.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className={v === "not published" || v.startsWith("this state") ? "text-muted-foreground/70" : ""}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {open && lines.length > 0 && <div className="mt-1 text-[9px] text-muted-foreground">Age-adjusted model-based estimates; not counts of diagnosed people.</div>}
    </div>
  );
}
