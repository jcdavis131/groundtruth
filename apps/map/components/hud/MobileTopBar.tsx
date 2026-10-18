"use client";
// Phone header: one row with the brand (the page's h1), the online dot, the
// clock state and settings, then the search field and the catalogue link.
// Everything else lives in MobileNav at the bottom of the screen.

import { Settings2 } from "lucide-react";
import { SiteSearch, CatalogLink } from "./FrontDoor";
import { useGlobe } from "@/lib/store/globe";
import { useReleases } from "@/lib/releases/store";
import { isLive } from "@/lib/globe/clock";
import VoiceControl from "./VoiceControl";
import ThemeToggle from "./ThemeToggle";
import { useLens } from "@/lib/personas/store";
import { PERSONA_BY_ID } from "@/lib/personas/registry";

export default function MobileTopBar() {
  const ready = useGlobe((s) => s.ready);
  const clock = useGlobe((s) => s.clock);
  const setSettingsOpen = useGlobe((s) => s.setSettingsOpen);
  const vintage = useReleases((s) => s.vintage);
  const personaId = useLens((s) => s.personaId);
  const setPickerOpen = useLens((s) => s.setPickerOpen);
  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  const live = isLive(clock.offsetMs);
  return (
    <header
      data-hud-occluder
      className="pointer-events-none absolute inset-x-0 top-0 z-30 p-2"
      style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}
    >
      {/* Symmetric about the axis: status on the left, the name centred, actions on the right. */}
      <div className="hud-panel pointer-events-auto grid h-11 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={ready ? "hud-lamp shrink-0" : "hud-lamp hud-lamp-off blink shrink-0"} role="img" aria-label={ready ? "Globe online" : "Globe starting"} />
          <span className={`shrink-0 text-[9px] uppercase tracking-[0.2em] ${live ? "text-signal" : "text-warn"}`}>
            {live ? "Live" : clock.offsetMs < 0 ? "Replay" : "Fwd"}
          </span>
          {vintage && <span className="truncate text-[9px] tracking-[0.12em] text-warn">V {vintage}</span>}
        </div>
        <h1 className="min-w-0">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex min-w-0 flex-col items-center"
            aria-label={persona ? `Embedding Atlas. Lens: ${persona.title}. Change lens` : "Embedding Atlas. Choose a lens"}
          >
            <span className="hud-display truncate text-[12px] leading-none tracking-[0.28em] text-[var(--bright)]" style={{ marginRight: "-0.28em" }}>
              Embedding Atlas
            </span>
            {persona && (
              <span className="mt-1 truncate text-[8px] uppercase leading-none tracking-[0.22em]" style={{ color: persona.color }}>
                {persona.short}
              </span>
            )}
          </button>
        </h1>
        <div className="flex shrink-0 items-center justify-end">
          <VoiceControl compact />
          <ThemeToggle className="flex" />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="-mr-2 flex size-9 items-center justify-center text-foreground/80 hover:text-primary"
            aria-label="Settings and keys"
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </div>
      {/* Search is the one action the library exists for: a full-width field
          at a 44 px target, and the catalogue a tap away. */}
      <div className="pointer-events-auto mt-1.5 flex items-center gap-1.5">
        <SiteSearch className="flex-1" />
        <CatalogLink className="hud-panel" />
      </div>
    </header>
  );
}
