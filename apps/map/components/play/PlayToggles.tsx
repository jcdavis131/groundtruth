"use client";
// The two play-mode buttons for the TopBar action group, plus their keys:
// C for Command, F for Fisherman (not while typing). The integrator places
// this beside the Measure button. Escape leaves a mode; that lives in
// Cockpit's key handler next to the measure Escape.

import { useEffect } from "react";
import { Fish, Swords } from "lucide-react";
import { usePlay, type PlayMode } from "@/lib/play/store";

export default function PlayToggles() {
  const mode = usePlay((s) => s.mode);
  const setMode = usePlay((s) => s.setMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k !== "c" && k !== "f") return;
      e.preventDefault();
      const want: PlayMode = k === "c" ? "command" : "fisherman";
      const cur = usePlay.getState().mode;
      usePlay.getState().setMode(cur === want ? "off" : want);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (want: PlayMode) => setMode(mode === want ? "off" : want);
  const btn = "hud-btn";
  return (
    <>
      <button
        type="button"
        onClick={() => toggle("command")}
        aria-pressed={mode === "command"}
        className={`${btn} hidden md:inline-flex`}
        title="Command mode: fog-of-war exploration — click to march the probe and claim counties (C)"
      >
        <Swords className="size-3.5" />
        <span className="sr-only">Command mode</span>
      </button>
      <button
        type="button"
        onClick={() => toggle("fisherman")}
        aria-pressed={mode === "fisherman"}
        className={`${btn} hidden md:inline-flex`}
        title="Fisherman mode: cast a line and reel in the county's nearest housing-trajectory twins (F)"
      >
        <Fish className="size-3.5" />
        <span className="sr-only">Fisherman mode</span>
      </button>
    </>
  );
}
