"use client";
// Mission timeline: scrub ±24 h around now, change the clock rate, go live.
// Satellites and launches propagate to any time; live layers (aircraft,
// ships, cameras, earthquakes) hold their last known state and are flagged.

import { ChevronDown, ChevronUp, Pause, Play, Radio } from "lucide-react";
import { useState } from "react";
import { useGlobe } from "@/lib/store/globe";
import { goLive, isLive, setAnimate, setMissionTime, setMultiplier } from "@/lib/globe/clock";
import { fmtUtc } from "./TopBar";
import { useNow } from "@/lib/hooks/useNow";

const RANGE_MS = 24 * 3600 * 1000;
const RATES = [1, 10, 60, 600, 3600];

/**
 * `compact`: the phone variant. One row (live, play, clock, expand) that sits in
 * the bottom stack; the rate buttons and the scrubber unfold on demand.
 */
export default function Timeline({ compact = false }: { compact?: boolean } = {}) {
  const [expanded, setExpanded] = useState(false);
  const clock = useGlobe((s) => s.clock);
  const now = useNow(1000);
  const live = isLive(clock.offsetMs);
  const pct = ((clock.offsetMs + RANGE_MS) / (2 * RANGE_MS)) * 100;
  const mission = now ? now + clock.offsetMs : 0;

  const cycleRate = () => {
    const i = RATES.indexOf(clock.multiplier);
    setMultiplier(RATES[(i + 1) % RATES.length]);
  };

  return (
    <div
      data-hud-occluder
      className={
        compact
          ? "pointer-events-auto w-full"
          : "pointer-events-auto absolute inset-x-3 bottom-3 z-30 md:inset-x-auto md:left-1/2 md:w-[720px] md:max-w-[calc(100vw-24px)] md:-translate-x-1/2 xl:w-[min(720px,calc(100vw_-_2*var(--col-w)_-_72px))]"
      }
    >
      <div className="hud-panel px-3 py-2">
        <div className="flex items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => goLive()}
            className={`flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-widest ${
              live ? "border-signal/60 bg-signal/10 text-signal" : "border-border text-foreground/70 hover:text-primary"
            }`}
            title="Snap the mission clock to now"
          >
            <Radio className="size-3" />
            Live
          </button>
          <button
            type="button"
            onClick={() => setAnimate(!clock.animate)}
            className="border border-border p-1 text-foreground/70 hover:text-primary"
            title={clock.animate ? "Pause clock" : "Run clock"}
          >
            {clock.animate ? <Pause className="size-3" /> : <Play className="size-3" />}
          </button>
          {/* Desktop: all five rates. Phones get the cycler below, and the
              compact bar folds them away until it is expanded. */}
          <div className={`items-center gap-0.5 ${compact && !expanded ? "hidden" : "hidden sm:flex"}`}>
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setMultiplier(r)}
                className={`px-1.5 py-1 text-[10px] tabular-nums ${
                  clock.multiplier === r ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={cycleRate}
            className="px-2 py-1 text-[11px] tabular-nums text-muted-foreground hover:text-foreground sm:hidden"
            title="Cycle time-lapse speed"
          >
            {clock.multiplier}×
          </button>
          <div className="ml-auto text-[11px] tabular-nums text-foreground/90">
            {compact ? fmtUtc(mission).slice(11) : fmtUtc(mission)}
            <span className={`ml-2 text-[9px] tracking-widest ${live ? "text-signal" : "text-warn"}`}>
              {live ? "T+0" : `${clock.offsetMs > 0 ? "+" : "−"}${fmtOffset(Math.abs(clock.offsetMs))}`}
            </span>
          </div>
          {compact && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex size-8 items-center justify-center text-muted-foreground"
              aria-expanded={expanded}
              aria-label={expanded ? "Hide the timeline" : "Show the timeline"}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </button>
          )}
        </div>
        <div className={`relative mt-2 h-6 ${compact && !expanded ? "hidden" : ""}`}>
          {/* ticks */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border" />
          {[-24, -12, -6, 0, 6, 12, 24].map((h) => (
            <div
              key={h}
              className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${((h + 24) / 48) * 100}%` }}
            >
              <div className={`h-2 w-px ${h === 0 ? "bg-foreground/60" : "bg-border"}`} />
              <div className="mt-2 text-[9px] tabular-nums tracking-[0.12em] text-muted-foreground">{h === 0 ? "NOW" : `${h > 0 ? "+" : ""}${h}h`}</div>
            </div>
          ))}
          <input
            type="range"
            min={-RANGE_MS}
            max={RANGE_MS}
            step={60_000}
            value={Math.max(-RANGE_MS, Math.min(RANGE_MS, clock.offsetMs))}
            onChange={(e) => setMissionTime(Date.now() + Number(e.target.value))}
            className="timeline-range absolute inset-x-0 top-1/2 h-4 w-full -translate-y-1/2 cursor-ew-resize appearance-none bg-transparent"
            aria-label="Mission time offset"
          />
          <div
            className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-warn shadow-[0_0_6px_var(--warn)]"
            style={{ left: `${Math.max(0, Math.min(100, pct))}%`, opacity: live ? 0 : 1 }}
          />
        </div>
      </div>
    </div>
  );
}

function fmtOffset(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}
