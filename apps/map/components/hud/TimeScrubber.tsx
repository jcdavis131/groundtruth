"use client";
// Time machine scrubber: spin the world back and watch history play out.
// Drives the existing mission clock (setMissionTime / setMultiplier /
// setAnimate / goLive); the playback year fans out to the time-aware energy
// layers through the store (see LayerHost's playbackKey).

import { History, Pause, Play, Radio } from "lucide-react";
import { useState } from "react";
import { gasPrices } from "@/lib/gas/gas";
import { globalGenerationBundle, usElectricityBundle } from "@/lib/energy/energy";
import { goLive, setAnimate, setMissionTime, setMultiplier } from "@/lib/globe/clock";
import {
  PLAYBACK_MIN_YEAR,
  PLAYBACK_SPEEDS,
  TIME_AWARE_LAYER_IDS,
  missionTimeForYear,
  multiplierForYearsPerSecond,
  playbackMaxYear,
} from "@/lib/globe/timeMachine";
import { useGlobe } from "@/lib/store/globe";

/** What each layer can actually show during playback, from the bundles. */
function layerNotes(): string[] {
  const notes: string[] = [];
  try {
    const us = usElectricityBundle();
    const years = Object.values(us.states).flatMap((s) => s.history_residential.map(([y]) => y));
    notes.push(`US electricity ${Math.min(...years)}–${Math.max(...years)} · EIA SEDS`);
  } catch { /* bundle unavailable */ }
  try {
    const g = gasPrices();
    const first = g.national.history[0]?.[0] ?? "?";
    const last = g.national.history[g.national.history.length - 1]?.[0] ?? "?";
    notes.push(`Gas weekly ${first} → ${last} · EIA (states from 2000)`);
  } catch { /* bundle unavailable */ }
  try {
    const gen = globalGenerationBundle();
    notes.push(`Global generation ${gen.history_years[0]}–${gen.history_years[1]} · Ember`);
  } catch { /* bundle unavailable */ }
  notes.push("ERCOT hidden during playback (live-only) · data centers static");
  return notes;
}

const NOTES = layerNotes();

export interface TimeScrubberViewProps {
  engaged: boolean;
  animate: boolean;
  /** Playback year shown in the big readout. */
  year: number;
  minYear: number;
  maxYear: number;
  speed: number;
  notes: string[];
  onEngage: () => void;
  onTogglePlay: () => void;
  onScrub: (year: number) => void;
  onSpeed: (yps: number) => void;
  onLive: () => void;
}

/** Pure presentational panel: props in, markup out. Tested directly. */
export function TimeScrubberView(p: TimeScrubberViewProps) {
  if (!p.engaged) {
    return (
      <div data-hud-occluder className="pointer-events-auto">
        <button
          type="button"
          onClick={p.onEngage}
          className="hud-panel flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-foreground/80 hover:text-primary"
          title="Spin the world back: play energy history on the globe"
        >
          <History className="size-4" />
          Time machine
        </button>
      </div>
    );
  }

  return (
    <div data-hud-occluder className="pointer-events-auto">
      <div className="hud-panel px-3 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={p.onTogglePlay}
            className="border border-border p-1.5 text-foreground/80 hover:text-primary"
            title={p.animate ? "Pause history" : "Play history"}
          >
            {p.animate ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <div className="min-w-[86px] text-center">
            <div className="font-mono text-2xl font-semibold leading-none tabular-nums">{p.year}</div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.22em] text-foreground/50">
              {p.animate ? "playing" : "paused"}
            </div>
          </div>
          <input
            type="range"
            min={p.minYear}
            max={p.maxYear}
            step={1}
            value={p.year}
            onChange={(e) => p.onScrub(Number(e.target.value))}
            className="min-w-0 flex-1"
            title={`Playback year (${p.minYear}–${p.maxYear})`}
            aria-label="Playback year"
          />
          <select
            value={p.speed}
            onChange={(e) => p.onSpeed(Number(e.target.value))}
            className="border border-border bg-transparent px-1 py-1 font-mono text-[11px]"
            title="Playback speed, years per second"
            aria-label="Playback speed"
          >
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s} yr/s
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={p.onLive}
            className="flex items-center gap-1.5 border border-signal/60 bg-signal/10 px-2 py-1 text-[10px] uppercase tracking-widest text-signal"
            title="Back to the live clock"
          >
            <Radio className="size-3" />
            Live
          </button>
        </div>
        <div className="mt-1.5 border-t border-border/60 pt-1.5 text-[10px] leading-relaxed text-foreground/55">
          {p.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TimeScrubber() {
  const timeMachine = useGlobe((s) => s.clock.timeMachine);
  const animate = useGlobe((s) => s.clock.animate);
  const playbackYear = useGlobe((s) => s.playbackYear);
  const [speed, setSpeed] = useState<number>(5);
  const maxYear = playbackMaxYear();
  const year = playbackYear ?? maxYear;

  const engage = (startYear: number, playing: boolean) => {
    const st = useGlobe.getState();
    // Make the feature visible on first touch: if none of the history
    // layers are on, switch all three on.
    if (!(TIME_AWARE_LAYER_IDS as readonly string[]).some((id) => st.layers[id as keyof typeof st.layers])) {
      for (const id of TIME_AWARE_LAYER_IDS) st.setLayer(id as keyof typeof st.layers, true);
    }
    st.setClock({ timeMachine: true });
    st.setPlaybackYear(startYear);
    setMissionTime(missionTimeForYear(startYear));
    setMultiplier(multiplierForYearsPerSecond(speed));
    setAnimate(playing);
  };

  const onPlay = () => {
    if (!timeMachine) engage(PLAYBACK_MIN_YEAR, true);
    else {
      setMultiplier(multiplierForYearsPerSecond(speed));
      setAnimate(true);
    }
  };

  const onScrub = (y: number) => {
    const st = useGlobe.getState();
    if (!st.clock.timeMachine) {
      st.setClock({ timeMachine: true });
      st.setPlaybackYear(y);
    } else {
      st.setPlaybackYear(y);
    }
    setMissionTime(missionTimeForYear(y));
    setAnimate(false);
  };

  const onSpeed = (yps: number) => {
    setSpeed(yps);
    if (timeMachine && animate) setMultiplier(multiplierForYearsPerSecond(yps));
  };

  return (
    <TimeScrubberView
      engaged={timeMachine}
      animate={animate}
      year={year}
      minYear={PLAYBACK_MIN_YEAR}
      maxYear={maxYear}
      speed={speed}
      notes={NOTES}
      onEngage={() => engage(PLAYBACK_MIN_YEAR, false)}
      onTogglePlay={() => (animate ? setAnimate(false) : onPlay())}
      onScrub={onScrub}
      onSpeed={onSpeed}
      onLive={() => goLive()}
    />
  );
}
