"use client";
// Guided tour: walks the Explore presets on a timer with a caption. Any
// pointer, wheel or key pauses it; the caption offers resume, next, stop.

import { useEffect, useState } from "react";
import { Pause, Play, SkipForward, Square } from "lucide-react";
import { PRESETS, presetTarget } from "@/lib/explore/presets";
import { applyShare } from "@/lib/globe/share";
import { useGlobe } from "@/lib/store/globe";
import { useTeleport } from "@/lib/live/teleportStore";

const MIN_DWELL_S = 15;

export default function TourCaption() {
  const tour = useGlobe((s) => s.tour);
  const setTour = useGlobe((s) => s.setTour);
  const [left, setLeft] = useState(0);
  const preset = PRESETS[tour.index] ?? PRESETS[0];

  // Fly on every step.
  useEffect(() => {
    if (!tour.active) return;
    // One thing drives the camera at a time.
    if (useTeleport.getState().active) useTeleport.getState().stop();
    let stale = false;
    // Moving presets (the largest fire) resolve first; a step skipped meanwhile is not applied.
    void presetTarget(preset).then((s) => {
      if (!stale) applyShare(s);
    });
    useGlobe.getState().pushLog({ level: "info", text: `Tour ${tour.index + 1}/${PRESETS.length}: ${preset.title}` });
    return () => {
      stale = true;
    };
  }, [tour.active, tour.index, preset]);

  // Countdown + advance.
  useEffect(() => {
    if (!tour.active || tour.paused) return;
    const dwell = Math.max(MIN_DWELL_S, preset.dwellS ?? 30);
    const id = setInterval(() => {
      const elapsed = (Date.now() - tour.startedAt) / 1000;
      setLeft(Math.max(0, Math.ceil(dwell - elapsed)));
      if (elapsed >= dwell) {
        const next = tour.index + 1;
        if (next >= PRESETS.length) useGlobe.getState().setTour({ active: false, paused: false });
        else useGlobe.getState().setTour({ index: next, startedAt: Date.now() });
      }
    }, 500);
    return () => clearInterval(id);
  }, [tour.active, tour.paused, tour.index, tour.startedAt, preset.dwellS]);

  // Any input pauses.
  useEffect(() => {
    if (!tour.active || tour.paused) return;
    const pause = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-tour-controls]")) return;
      useGlobe.getState().setTour({ paused: true });
    };
    for (const ev of ["pointerdown", "wheel", "keydown"]) window.addEventListener(ev, pause, { passive: true });
    return () => {
      for (const ev of ["pointerdown", "wheel", "keydown"]) window.removeEventListener(ev, pause);
    };
  }, [tour.active, tour.paused]);

  if (!tour.active) return null;

  const next = () => {
    const n = tour.index + 1;
    if (n >= PRESETS.length) setTour({ active: false, paused: false });
    else setTour({ index: n, startedAt: Date.now(), paused: false });
  };

  return (
    <div
      data-tour-controls
      className="pointer-events-auto absolute inset-x-2 top-[calc(max(8px,env(safe-area-inset-top))_+_102px)] z-30 md:inset-x-auto md:bottom-[104px] md:left-1/2 md:top-auto md:w-[440px] md:-translate-x-1/2"
    >
      <div className="hud-panel hud-panel-lit hud-enter">
        <div className="flex h-9 items-center justify-between border-b border-border px-3">
          <span className="hud-label text-signal">
            Tour · {tour.index + 1}/{PRESETS.length}
          </span>
          <span className="text-[9px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground">{tour.paused ? "paused" : `next in ${left}s`}</span>
        </div>
        <div className="px-3 py-2.5">
          <div className="hud-display text-[15px] text-[var(--bright)]">{preset.title}</div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{preset.region}</div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-foreground/85 md:line-clamp-none">{preset.blurb}</p>
        </div>
        <div className="flex gap-2 border-t border-border p-2">
          <button
            type="button"
            onClick={() => setTour({ paused: !tour.paused, startedAt: tour.paused ? Date.now() : tour.startedAt })}
            className="flex flex-1 items-center justify-center gap-2 border border-border h-8 px-3 text-[10px] uppercase tracking-[0.22em] text-foreground/80 hover:bg-accent hover:text-primary"
          >
            {tour.paused ? <Play className="size-3" /> : <Pause className="size-3" />}
            {tour.paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={next}
            className="flex flex-1 items-center justify-center gap-2 border border-border h-8 px-3 text-[10px] uppercase tracking-[0.22em] text-foreground/80 hover:bg-accent hover:text-primary"
          >
            <SkipForward className="size-3" /> Next
          </button>
          <button
            type="button"
            onClick={() => setTour({ active: false, paused: false })}
            className="flex items-center justify-center gap-2 border border-border h-8 px-3 text-[10px] uppercase tracking-[0.22em] text-foreground/80 hover:bg-accent hover:text-alert"
            title="Stop the tour"
            aria-label="Stop the tour"
          >
            <Square className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
