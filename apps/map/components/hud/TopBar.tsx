"use client";

import { Search, Settings2, Crosshair, Home, Droplets, Compass, Link2, Landmark, Menu, Activity, CalendarDays, Bell, Table2, Aperture, Zap, Sun, Moon, Ruler, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { useIndicators } from "@/lib/indicators/store";
import { useReleases } from "@/lib/releases/store";
import { useWatchlists } from "@/lib/watch/store";
import { useScreener } from "@/lib/screener/store";
import DeskToggle from "./DeskToggle";
import ThemeToggle, { applyTheme, currentTheme } from "./ThemeToggle";
import { useLens } from "@/lib/personas/store";
import { PERSONA_BY_ID } from "@/lib/personas/registry";
import { copyShareLink } from "@/lib/globe/share";
import { setMeasureMode } from "@/lib/globe/measure";
import { useNow } from "@/lib/hooks/useNow";
import { useGlobe } from "@/lib/store/globe";
import { formatDistance, formatLatLon } from "@/lib/globe/geo";
import { homeView } from "@/lib/globe/camera";
import { isLive } from "@/lib/globe/clock";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import VoiceControl from "./VoiceControl";
import { useTeleport } from "@/lib/live/teleportStore";
import AboutButton from "./AboutDialog";
import { SiteSearch, CatalogLink } from "./FrontDoor";

export function fmtUtc(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

/** One row in the mobile overflow menu. */
function MenuItem({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded px-3 py-2.5 text-left text-[13px] ${
        active ? "text-primary" : "text-foreground/85"
      } hover:bg-accent hover:text-primary`}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

export default function TopBar() {
  const now = useNow(1000);
  const view = useGlobe((s) => s.view);
  const clock = useGlobe((s) => s.clock);
  const ready = useGlobe((s) => s.ready);
  const setSearchOpen = useGlobe((s) => s.setSearchOpen);
  const setSettingsOpen = useGlobe((s) => s.setSettingsOpen);
  const waterOpen = useGlobe((s) => s.waterReportOpen);
  const marketOpen = useGlobe((s) => s.marketReportOpen);
  const spaceOpen = useGlobe((s) => s.spaceWeatherOpen);
  const measuring = useGlobe((s) => s.measure.mode !== "off");
  const setExploreOpen = useGlobe((s) => s.setExploreOpen);
  const indOpen = useIndicators((s) => s.open);
  const toggleInd = useIndicators((s) => s.toggle);
  const relOpen = useReleases((s) => s.releasesOpen);
  const setRelOpen = useReleases((s) => s.setReleasesOpen);
  const vintage = useReleases((s) => s.vintage);
  const watchOpen = useWatchlists((s) => s.open);
  const setWatchOpen = useWatchlists((s) => s.setOpen);
  const insightsOpen = useGlobe((s) => s.insightsOpen);
  const screenOpen = useScreener((s) => s.open);
  const toggleScreen = useScreener((s) => s.toggle);
  const personaId = useLens((s) => s.personaId);
  const setPickerOpen = useLens((s) => s.setPickerOpen);
  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  const live = isLive(clock.offsetMs);
  const mission = now ? now + clock.offsetMs : 0;

  const teleporting = useTeleport((s) => s.active);

  const [menuOpen, setMenuOpen] = useState(false);
  const toggleWater = () => {
    const st = useGlobe.getState();
    if (!waterOpen) {
      st.setLayer("water", true);
      st.setLayer("groundwater", true);
    }
    st.setWaterReportOpen(!waterOpen);
  };
  const toggleMarket = () => {
    const st = useGlobe.getState();
    if (!marketOpen) {
      st.setLayer("realestate", true);
      st.setLayer("commerce", true);
      st.setLayer("trade", true);
    }
    st.setMarketReportOpen(!marketOpen);
  };
  const toggleSpace = () => useGlobe.getState().setSpaceWeatherOpen(!spaceOpen);
  // Off leaves the tool and keeps the shape (the panel stays with its readout); its close button clears it.
  const toggleMeasure = () => setMeasureMode(measuring ? "off" : "distance");
  const closeMenu = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  const btn = "hud-btn";
  return (
    <header data-hud-occluder className="pointer-events-none absolute inset-x-0 top-0 z-30 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 p-3">
      {/* Composition: a strict three-column grid. The instrument readout sits on
          the vertical axis, directly above the reticle, its divider exactly on
          the centre line; the brand and the travel actions hold the left edge,
          the panel toggles and utilities hold the right. Every block is the
          same height. Below xl the readout folds away and each side takes half. */}

      {/* left: brand, status, where to go */}
      <div className="hud-panel pointer-events-auto col-start-1 flex h-12 min-w-0 items-center justify-self-start overflow-x-auto [scrollbar-width:none]">
        <div className="flex shrink-0 items-center gap-3 pl-4 pr-4">
          <span className={ready ? "hud-lamp" : "hud-lamp hud-lamp-off blink"} role="img" aria-label={ready ? "Globe online" : "Globe starting"} />
          <h1 className="hud-display whitespace-nowrap text-[13px] leading-none tracking-[0.3em] text-[var(--bright)]">Embedding Atlas</h1>
        </div>
        <div className="hud-rule" />
        <div className="flex shrink-0 items-center px-1">
          <button type="button" onClick={() => setPickerOpen(true)} className={btn} title="Lens: who is looking (real estate, economist, trader, water, supply chain, public finance, civic, explorer)">
            <Aperture className="size-3.5" />
            {persona ? (
              <>
                <span className="hidden whitespace-nowrap 2xl:inline" style={{ color: persona.color }}>
                  {persona.title}
                </span>
                <span className="size-1.5 rounded-full 2xl:hidden" style={{ background: persona.color }} aria-hidden />
                <span className="sr-only 2xl:hidden">Lens: {persona.title}</span>
              </>
            ) : (
              <span className="sr-only">Lens</span>
            )}
          </button>
          <button type="button" onClick={() => setExploreOpen(true)} className={btn} title="Curated places, guided tour, exports">
            <Compass className="size-3.5" />
            <span className="sr-only">Explore</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const t = useTeleport.getState();
              if (t.active) t.next();
              else void t.start();
            }}
            className={btn}
            data-on={teleporting}
            title="Teleport: fly to wherever the world is doing something unusual right now (NWS warnings, earthquakes), strongest first"
          >
            <Zap className="size-3.5" />
            <span className="sr-only">Teleport</span>
          </button>
        </div>
        <div className="hud-rule" />
        {/* The one action the library exists for, at a 44 px target, and the
            catalogue beside it. Last in the panel, so on a narrow desktop it is
            what scrolls, not the travel buttons; the right panel keeps its
            search glyph for those widths. */}
        <div className="flex shrink-0 items-center gap-1 px-1">
          <SiteSearch className="w-40 2xl:w-56" />
          <CatalogLink />
        </div>
      </div>

      {/* centre: the instrument readout, symmetric about the axis */}
      <div className="hud-panel pointer-events-auto col-start-2 hidden h-12 items-stretch whitespace-nowrap xl:flex" role="group" aria-label="Mission clock and camera target">
        <div className="flex w-[184px] flex-col items-end justify-center pr-4 text-right">
          <div className="hud-label flex items-center gap-2 text-[9px]">
            {vintage ? (
              <span className="text-warn" title="Data vintage pinned by the permalink (&v=)">
                Vintage {vintage}
              </span>
            ) : (
              <span>Mission clock</span>
            )}
            <span className={live ? "text-signal" : "text-warn"}>{live ? "Live" : clock.offsetMs < 0 ? "Replay" : "Forward"}</span>
          </div>
          <div className="mt-1 text-[13px] leading-none tabular-nums text-[var(--bright)]">{fmtUtc(mission)}</div>
        </div>
        <div className="relative w-px bg-[var(--hairline)]">
          <span className="absolute left-1/2 top-0 h-1.5 w-px -translate-x-1/2 bg-signal" aria-hidden />
        </div>
        <div className="flex w-[184px] flex-col items-start justify-center pl-4">
          <div className="hud-label flex items-center gap-2 text-[9px]">
            <span>Target</span>
            <span className="tabular-nums">alt {formatDistance(view.height)}</span>
          </div>
          <div className="mt-1 text-[13px] leading-none tabular-nums text-[var(--bright)]">{formatLatLon(view.lat, view.lon)}</div>
        </div>
      </div>

      {/* right: panels and utilities */}
      <div className="hud-panel pointer-events-auto col-start-3 flex h-12 min-w-0 max-w-full items-center justify-self-end overflow-x-auto whitespace-nowrap px-1 [scrollbar-width:none]">
        <VoiceControl />
        <button type="button" onClick={() => setSearchOpen(true)} className={`${btn} hidden md:inline-flex`} title="Search flights, ships, satellites, places (Ctrl+K)">
          <Search className="size-3.5" />
          <span className="sr-only">Search</span>
        </button>
        <div className="hud-rule mx-1 my-3" />
        <button type="button" onClick={toggleWater} data-on={waterOpen} className={`${btn} hidden md:inline-flex`} title="Community water report for the current view">
          <Droplets className="size-3.5" />
          <span className="sr-only">Water</span>
        </button>
        <button type="button" onClick={toggleMarket} data-on={marketOpen} className={`${btn} hidden md:inline-flex`} title="Market report for the current view: home values, rents, wages, jobs, trade gateways">
          <Landmark className="size-3.5" />
          <span className="sr-only">Market</span>
        </button>
        <button type="button" onClick={toggleSpace} aria-pressed={spaceOpen} className={`${btn} hidden md:inline-flex`} title="Space weather: Kp index, solar flares, notifications">
          <Sun className="size-3.5" />
          <span className="sr-only">Space weather</span>
        </button>
        <button type="button" onClick={toggleMeasure} aria-pressed={measuring} className={`${btn} hidden md:inline-flex`} title="Measure distance and area, or read the ground elevation at a click (Esc leaves the tool)">
          <Ruler className="size-3.5" />
          <span className="sr-only">Measure</span>
        </button>
        <button type="button" onClick={toggleInd} aria-pressed={indOpen} className={btn} title="Named indicators with thresholds: river stages, freight, housing, energy, labour, trade">
          <Activity className="size-3.5" />
          <span className="sr-only">Signals</span>
        </button>
        <button type="button" onClick={toggleScreen} aria-pressed={screenOpen} className={btn} title="Screener: rank and filter counties, states, ports, crossings, countries">
          <Table2 className="size-3.5" />
          <span className="sr-only">Screen</span>
        </button>
        <button type="button" onClick={() => setRelOpen(!relOpen)} aria-pressed={relOpen} className={btn} title="Release calendar, loaded vintages, movers since the last release">
          <CalendarDays className="size-3.5" />
          <span className="sr-only">Releases</span>
        </button>
        <button type="button" onClick={() => setWatchOpen(!watchOpen)} aria-pressed={watchOpen} className={btn} title="Watchlists with rules, RSS/Atom feeds and webhooks">
          <Bell className="size-3.5" />
          <span className="sr-only">Watch</span>
        </button>
        <button type="button" onClick={() => useGlobe.getState().setInsightsOpen(!insightsOpen)} aria-pressed={insightsOpen} className={btn} title="Insights: the brief engine's latest findings for wherever the map is looking">
          <Sparkles className="size-3.5" />
          <span className="sr-only">Insights</span>
        </button>
        <DeskToggle />
        <div className="hud-rule mx-1 my-3 hidden md:block" />
        <button type="button" onClick={() => void copyShareLink()} className={`${btn} hidden md:inline-flex`} title="Copy a link to exactly this view, layers, clock and selection">
          <Link2 className="size-3.5" />
          <span className="sr-only">Share</span>
        </button>
        <button type="button" onClick={() => homeView()} className={`${btn} hidden md:inline-flex`} title="Home view">
          <Home className="size-3.5" />
          <span className="sr-only">Home view</span>
        </button>
        <button type="button" onClick={() => useGlobe.getState().select(null)} className={`${btn} hidden md:inline-flex`} title="Clear selection (Esc)">
          <Crosshair className="size-3.5" />
          <span className="sr-only">Clear selection</span>
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)} className={`${btn} hidden md:inline-flex`} title="Settings & API keys (,)">
          <Settings2 className="size-3.5" />
          <span className="sr-only">Settings and keys</span>
        </button>
        <ThemeToggle />
        <span className="hidden md:contents">
          <AboutButton />
        </span>
        {/* Mobile overflow: every action that doesn't fit the bar. */}
        <div className="md:hidden">
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger type="button" className="flex items-center px-2 py-2 text-foreground/80 hover:text-primary" aria-label="More actions">
              <Menu className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1">
              <MenuItem icon={Search} label="Search" onClick={closeMenu(() => setSearchOpen(true))} />
              <MenuItem icon={Droplets} label="Water report" onClick={closeMenu(toggleWater)} active={waterOpen} />
              <MenuItem icon={Landmark} label="Market report" onClick={closeMenu(toggleMarket)} active={marketOpen} />
              <MenuItem icon={Sun} label="Space weather" onClick={closeMenu(toggleSpace)} active={spaceOpen} />
              <MenuItem icon={Ruler} label="Measure" onClick={closeMenu(toggleMeasure)} active={measuring} />
              <MenuItem icon={Link2} label="Copy share link" onClick={closeMenu(() => void copyShareLink())} />
              <MenuItem icon={Home} label="Home view" onClick={closeMenu(() => homeView())} />
              <MenuItem icon={Crosshair} label="Clear selection" onClick={closeMenu(() => useGlobe.getState().select(null))} />
              <MenuItem icon={Settings2} label="Settings & keys" onClick={closeMenu(() => setSettingsOpen(true))} />
              <MenuItem
                icon={Moon}
                label="Toggle night-board"
                onClick={closeMenu(() => applyTheme(currentTheme() === "dark" ? "light" : "dark"))}
                active={false}
              />
              <div className="mt-1 border-t border-border/60 pt-1">
                <AboutButton compact />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
}
