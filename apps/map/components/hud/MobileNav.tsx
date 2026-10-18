"use client";
// Phone bottom bar: a Lens chip, then a horizontally scrollable strip of panel
// toggles in the order the active lens prefers. Each chip is a 48 px touch
// target; the active ones light up. The strip snaps so a flick lands on
// whole chips.

import { Activity, Aperture, Bell, CalendarDays, Compass, Droplets, Landmark, Layers, Layers3, Link2, Ruler, Sun, Table2, Zap } from "lucide-react";
import type { ComponentType } from "react";
import { useGlobe } from "@/lib/store/globe";
import { useIndicators } from "@/lib/indicators/store";
import { useReleases } from "@/lib/releases/store";
import { useWatchlists } from "@/lib/watch/store";
import { useScreener } from "@/lib/screener/store";
import { useMobile } from "@/lib/mobile/store";
import { useLens } from "@/lib/personas/store";
import { PERSONA_BY_ID, type PanelId } from "@/lib/personas/registry";
import { togglePanel } from "@/lib/personas/actions";
import { useTeleport } from "@/lib/live/teleportStore";
import { useStrata } from "@/lib/fabric/strataStore";
import { measureOpen } from "@/lib/globe/measure";

interface Chip {
  id: PanelId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const CHIPS: Chip[] = [
  { id: "layers", label: "Layers", icon: Layers },
  { id: "strata", label: "Strata", icon: Layers3 },
  { id: "water", label: "Water", icon: Droplets },
  { id: "market", label: "Market", icon: Landmark },
  { id: "space", label: "Space", icon: Sun },
  { id: "measure", label: "Measure", icon: Ruler },
  { id: "signals", label: "Signals", icon: Activity },
  { id: "screen", label: "Screen", icon: Table2 },
  { id: "releases", label: "Releases", icon: CalendarDays },
  { id: "watch", label: "Watch", icon: Bell },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "teleport", label: "Teleport", icon: Zap },
  { id: "share", label: "Share", icon: Link2 },
];

/** Chips in the lens's order, then any it did not mention. */
export function orderChips(order: PanelId[] | undefined): Chip[] {
  if (!order) return CHIPS;
  const byId = new Map(CHIPS.map((c) => [c.id, c]));
  const out: Chip[] = [];
  for (const id of order) {
    const c = byId.get(id);
    if (c) out.push(c);
  }
  for (const c of CHIPS) if (!out.includes(c)) out.push(c);
  return out;
}

export default function MobileNav() {
  const layersOpen = useMobile((s) => s.layersOpen);
  const constructsOn = useGlobe((s) => s.layers.constructs);
  const railOpen = useStrata((s) => s.railOpen);
  const waterOpen = useGlobe((s) => s.waterReportOpen);
  const marketOpen = useGlobe((s) => s.marketReportOpen);
  const spaceOpen = useGlobe((s) => s.spaceWeatherOpen);
  const measuring = useGlobe((s) => measureOpen(s.measure));
  const indOpen = useIndicators((s) => s.open);
  const screenOpen = useScreener((s) => s.open);
  const relOpen = useReleases((s) => s.releasesOpen);
  const watchOpen = useWatchlists((s) => s.open);
  const teleporting = useTeleport((s) => s.active);
  const personaId = useLens((s) => s.personaId);
  const setPickerOpen = useLens((s) => s.setPickerOpen);
  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  const active: Record<PanelId, boolean> = {
    layers: layersOpen,
    strata: constructsOn && railOpen,
    water: waterOpen,
    market: marketOpen,
    space: spaceOpen,
    measure: measuring,
    signals: indOpen,
    screen: screenOpen,
    releases: relOpen,
    watch: watchOpen,
    explore: false,
    teleport: teleporting,
    share: false,
  };
  const chips = orderChips(persona?.nav);
  return (
    <nav className="hud-panel pointer-events-auto mobile-nav flex" aria-label="Panels">
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex min-h-[52px] min-w-[68px] shrink-0 flex-col items-center justify-center gap-1 border-r border-border px-2 text-[8.5px] uppercase tracking-[0.16em]"
        style={{ color: persona?.color ?? "var(--primary)" }}
        aria-label={persona ? `Lens: ${persona.title}. Change lens` : "Choose a lens"}
      >
        <Aperture className="size-4" />
        {persona ? persona.short : "Lens"}
      </button>
      <div className="flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain px-1">
        {chips.map((c) => {
          const Icon = c.icon;
          const on = active[c.id];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => togglePanel(c.id)}
              aria-pressed={on}
              className={`relative flex min-h-[52px] min-w-[68px] shrink-0 snap-start flex-col items-center justify-center gap-1 px-2 text-[8.5px] uppercase tracking-[0.16em] ${
                on ? "text-primary" : "text-foreground/70"
              }`}
            >
              <Icon className="size-4" />
              {c.label}
              {on && <span className="absolute inset-x-4 top-0 h-px bg-primary" aria-hidden />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
