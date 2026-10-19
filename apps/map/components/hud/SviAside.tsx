"use client";
// The Social vulnerability click answer: CDC/ATSDR SVI 2022 for the clicked
// county or tract (/api/civic?op=svi&level=place), and directly under it, in
// its own titled block, FEMA's National Risk Index social vulnerability for
// the same FIPS (/api/hazards?op=nri&fips=). Each number keeps its native form
// (CDC's 0-1 percentile; FEMA's 0-100 score and rating word); nothing is
// converted, averaged or ranked against the other (lib/civic/svi.ts
// sviPairBlocks). Both are asked when the dossier opens (a click, never a pan),
// each held a week server-side; one failing leaves the other.

import { useEffect, useState } from "react";
import { nriRow, type NriRow } from "@/lib/hazards/nri";
import { sviMeasureLines, sviPairBlocks, type SviPlace } from "@/lib/civic/svi";

type Side<T> = { value?: T | null; error?: string };

async function ask<T>(url: string, pick: (j: Record<string, unknown>) => T): Promise<T | null> {
  const r = await fetch(url);
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${r.status}`);
  return pick(j);
}

export default function SviAside({ fips, level }: { fips: string; level: "county" | "tract" }) {
  const [svi, setSvi] = useState<Side<SviPlace>>({});
  const [nri, setNri] = useState<Side<NriRow>>({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    ask(`/api/civic?op=svi&level=place&fips=${fips}`, (j) => j.data as SviPlace)
      .then((value) => live && setSvi({ value }))
      .catch((e: Error) => live && setSvi({ error: e.message }));
    ask(`/api/hazards?op=nri&fips=${fips}`, (j) => nriRow(((j.data as { row?: Record<string, unknown> }) ?? {}).row ?? {}))
      .then((value) => live && setNri({ value }))
      .catch((e: Error) => live && setNri({ error: e.message }));
    return () => {
      live = false;
    };
  }, [fips]);

  const loading = svi.value === undefined && !svi.error;
  const [cdc, fema] = sviPairBlocks(svi.value ?? null, nri.value ?? null, level);
  const blocks = [
    { b: cdc, side: svi, wait: "asking CDC/ATSDR…", fail: "CDC/ATSDR did not answer" },
    { b: fema, side: nri, wait: "asking FEMA's National Risk Index…", fail: "FEMA's National Risk Index did not answer" },
  ];
  return (
    <div className="border-t border-border px-3 py-2">
      {blocks.map(({ b, side, wait, fail }) => (
        <section key={b.title} className="mb-2 last:mb-0" aria-label={b.title}>
          <div className="hud-label">{b.title}</div>
          <div className="text-[9px] text-muted-foreground">{b.basis}</div>
          {side.value === undefined && !side.error && <div className="mt-1 text-[10px] text-muted-foreground">{wait}</div>}
          {side.error && <div className="mt-1 text-[10px] text-alert">{fail}: {side.error.slice(0, 80)} (unknown, not missing)</div>}
          {side.value !== undefined && !side.error && (
            <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-2 gap-y-0.5 text-[10px]">
              {b.lines.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className={/^not /.test(v) ? "text-muted-foreground/70" : "tabular-nums"}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-1 text-[9px] leading-snug text-muted-foreground">{b.note}</p>
        </section>
      ))}
      {!loading && svi.value && (
        <>
          <button type="button" className="mt-1 flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <span className="hud-label">CDC&apos;s 16 estimates here (ACS 2018-2022)</span>
            <span className="text-[11px] text-muted-foreground" aria-hidden>
              {open ? "▾" : "▸"}
            </span>
          </button>
          {open && (
            <dl className="mt-1 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[10px]">
              {sviMeasureLines(svi.value).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className={v === "not published" ? "text-muted-foreground/70" : "tabular-nums"}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </div>
  );
}
