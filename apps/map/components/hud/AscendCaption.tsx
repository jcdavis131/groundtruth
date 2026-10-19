"use client";
// The Ascend card: a Powers of Ten flight up through the constructs stack.
// One stratum at a time, smallest to largest, the camera framing each and
// this card naming it with values computed from what is loaded now:
// "SUBBASIN · Aransas · 1,234 km² · 14 gauges · 2 warnings". A scale of ticks
// shows where in the stack the flight is. A tap or any key stops the flight
// (the camera stays where it is); with reduced motion there is no flight and
// no autoplay, only Previous / Next.

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Square } from "lucide-react";
import { useNow } from "@/lib/hooks/useNow";
import { DOMAINS } from "@/lib/fabric/catalog";
import { ASCEND_DWELL_S, ASCEND_FLY_S, captionKind } from "@/lib/fabric/strata";
import { captionFor, constructFeature, useAscend } from "@/lib/fabric/strataClient";
import type { ConstructExtra } from "@/lib/fabric/types";

const STEP_MS = (ASCEND_FLY_S + ASCEND_DWELL_S) * 1000;

export default function AscendCaption() {
  const a = useAscend();
  const now = useNow(250);

  // Autoplay: next stratum once the frame has held; the last one stays up.
  useEffect(() => {
    if (!a.active || a.manual) return;
    const id = setInterval(() => {
      const s = useAscend.getState();
      if (s.active && s.index < s.steps.length - 1 && Date.now() - s.startedAt >= STEP_MS) s.next();
    }, 250);
    return () => clearInterval(id);
  }, [a.active, a.manual]);

  // A tap or any key anywhere but the card stops the flight.
  useEffect(() => {
    if (!a.active || a.manual) return;
    const stop = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-ascend-controls]")) return;
      useAscend.getState().stop();
    };
    // Registered a beat late so the click that started the flight does not end it.
    const t = setTimeout(() => {
      for (const ev of ["pointerdown", "keydown", "wheel"]) window.addEventListener(ev, stop, { passive: true });
    }, 50);
    return () => {
      clearTimeout(t);
      for (const ev of ["pointerdown", "keydown", "wheel"]) window.removeEventListener(ev, stop);
    };
  }, [a.active, a.manual]);

  // Reduced motion: the arrow keys step, Escape closes.
  useEffect(() => {
    if (!a.active || !a.manual) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") useAscend.getState().next();
      else if (e.key === "ArrowLeft") useAscend.getState().prev();
      else if (e.key === "Escape") useAscend.getState().stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a.active, a.manual]);

  if (!a.active) return null;
  const id = a.steps[a.index];
  const node = (constructFeature(id)?.properties.extra as ConstructExtra | undefined)?.node;
  if (!node) return null;
  // Title: "SUBBASIN · Aransas"; the rest of the caption is the line of values beneath it.
  const kind = captionKind(node.kind).toUpperCase();
  const name = node.name;
  const rest = captionFor(node).slice(`${kind} · ${name}`.length).replace(/^ · /, "");
  const last = a.index >= a.steps.length - 1;
  const left = Math.max(0, Math.ceil((STEP_MS - (now - a.startedAt)) / 1000));
  const power = node.areaKm2 && node.areaKm2 > 0 ? Math.floor(Math.log10(node.areaKm2)) : null;
  const btn = "flex h-8 flex-1 items-center justify-center gap-2 border border-border px-3 text-[10px] uppercase tracking-[0.22em] text-foreground/80 hover:bg-accent hover:text-primary disabled:opacity-40";

  return (
    <div
      data-ascend-controls
      role="status"
      aria-live="polite"
      className="pointer-events-auto absolute inset-x-2 top-[calc(max(8px,env(safe-area-inset-top))_+_102px)] z-30 md:inset-x-auto md:bottom-[104px] md:left-1/2 md:top-auto md:w-[480px] md:-translate-x-1/2"
    >
      <div className="hud-panel hud-panel-lit hud-enter" key={id}>
        <div className="flex h-9 items-center justify-between border-b border-border px-3">
          <span className="hud-label text-signal">
            Ascend · {a.index + 1}/{a.steps.length}
          </span>
          <span className="text-[9px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground">
            {a.manual ? "step with ← →" : last ? "top of the stack" : `next in ${left}s · tap to stop`}
          </span>
        </div>
        <div className="px-3 pb-2.5 pt-3">
          <div className="flex items-baseline gap-2">
            <span className="size-2 shrink-0 translate-y-[-1px]" style={{ background: DOMAINS[node.domain].color }} aria-hidden />
            <span className="hud-display text-[11px] text-signal" title={captionKind(node.kind)}>
              {kind}
            </span>
            {power != null && (
              <span className="ml-auto text-[10px] tabular-nums text-muted-foreground" title="Order of magnitude of the published area">
                10<sup>{power}</sup> km²
              </span>
            )}
          </div>
          <div className="hud-display mt-1 line-clamp-2 text-[17px] leading-tight text-[var(--bright)]" title={name}>
            {name}
          </div>
          <div className="mt-1 min-h-[15px] text-[11px] leading-snug text-foreground/85 tabular-nums">{rest || "No published area and nothing loaded inside."}</div>
          <div className="ascend-scale mt-2.5" aria-hidden>
            {a.steps.map((s, i) => (
              <span key={s} data-state={i < a.index ? "past" : i === a.index ? "now" : "next"} style={{ height: `${30 + (70 * i) / Math.max(1, a.steps.length - 1)}%` }} />
            ))}
          </div>
        </div>
        <div className="flex gap-2 border-t border-border p-2">
          <button type="button" className={btn} onClick={() => a.prev()} disabled={a.index === 0} aria-label="Previous stratum">
            <ChevronLeft className="size-3" /> Down
          </button>
          <button type="button" className={btn} onClick={() => a.next()} disabled={last} aria-label="Next stratum">
            Up <ChevronRight className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => a.stop()}
            className="flex h-8 items-center justify-center gap-2 border border-border px-3 text-[10px] uppercase tracking-[0.22em] text-foreground/80 hover:bg-accent hover:text-alert"
            aria-label="Stop the ascent"
            title="Stop the ascent"
          >
            <Square className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
