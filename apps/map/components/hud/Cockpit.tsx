"use client";
// Full-screen cockpit: the globe underneath, HUD chrome on top.

import dynamic from "next/dynamic";
import { useEffect } from "react";
import LayerHost from "@/components/globe/LayerHost";
import HudFrame from "./HudFrame";
import TopBar from "./TopBar";
import LayerPanel from "./LayerPanel";
import InfoPanel from "./InfoPanel";
import WaterReportPanel from "./WaterReportPanel";
import MarketReportPanel from "./MarketReportPanel";
import SpaceWeatherPanel from "./SpaceWeatherPanel";
import MeasurePanel from "./MeasurePanel";
import AreaPanel from "./AreaPanel";
import WhatsHerePanel from "./WhatsHerePanel";
import IndicatorsPanel from "./IndicatorsPanel";
import ReleasesPanel from "./ReleasesPanel";
import WatchlistPanel from "./WatchlistPanel";
import InsightsPanel from "./InsightsPanel";
import ScreenerPanel from "./ScreenerPanel";
import DeskLayout from "./DeskLayout";
import MobileTopBar from "./MobileTopBar";
import MobileNav from "./MobileNav";
import MobileSheet from "./MobileSheet";
import PersonaPicker from "./PersonaPicker";
import StartHere from "./StartHere";
import { useLens } from "@/lib/personas/store";
import { useIsMobile } from "@/lib/hooks/useIsMobile";
import { useMobile } from "@/lib/mobile/store";
import ExploreDialog from "./ExploreDialog";
import TourCaption from "./TourCaption";
import TeleportCaption from "./TeleportCaption";
import StrataRail from "./StrataRail";
import AscendCaption from "./AscendCaption";
import { useStrata } from "@/lib/fabric/strataStore";
import { applyShare, parseShare, startUrlSync } from "@/lib/globe/share";
import Timeline from "./Timeline";
import TimeScrubber from "./TimeScrubber";
import TimeMachineTicker from "@/components/globe/TimeMachineTicker";
import SettingsDialog from "./SettingsDialog";
import SearchCommand from "./SearchCommand";
import TitleCard from "./TitleCard";
import { useGlobe } from "@/lib/store/globe";
import { LAYERS } from "@/lib/layers";

const CesiumGlobe = dynamic(() => import("@/components/globe/CesiumGlobe"), {
  ssr: false,
  // The title card (below) is the loading frame; this just holds the black.
  loading: () => <div className="absolute inset-0 bg-background" />,
});

export default function Cockpit({ initialMobile = false }: { initialMobile?: boolean } = {}) {
  const mobile = useIsMobile(initialMobile);
  const layersOpen = useMobile((s) => s.layersOpen);
  const setLayer = useGlobe((s) => s.setLayer);
  const setSearchOpen = useGlobe((s) => s.setSearchOpen);
  const setSettingsOpen = useGlobe((s) => s.setSettingsOpen);
  const ready = useGlobe((s) => s.ready);
  const embed = useGlobe((s) => s.embed);

  // Default layers on at first boot, unless the link names its own set.
  useEffect(() => {
    const share = parseShare(window.location.search);
    if (share.embed) useGlobe.getState().setEmbed(true);
    // Anchor the constructs stack before its layer first asks for it.
    if (share.pin) useStrata.getState().setPin(share.pin);
    if (share.layers) {
      for (const l of LAYERS) setLayer(l.id, share.layers.includes(l.id));
    } else {
      for (const l of LAYERS) if (l.defaultEnabled) setLayer(l.id, true);
    }
  }, [setLayer]);

  // Once the globe is up: apply the rest of the link (clock, report,
  // selection; the camera already flew there in CesiumGlobe's opening move)
  // and start mirroring the cockpit back into the address bar.
  useEffect(() => {
    if (!ready) return;
    const share = parseShare(window.location.search);
    applyShare(share, { fly: false });
    // First visit with a bare URL: ask who is looking. A shared link (layers,
    // selection, lens, embed) is never interrupted.
    const bare = !share.lens && !share.layers && !share.sel && !share.report && !share.market && !share.space && !share.shape && !share.embed;
    // Let the title card clear the frame before the question is asked.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ask = window.setTimeout(
      () => {
        if (bare && useLens.getState().personaId == null) useLens.getState().setPickerOpen(true);
      },
      reduced ? 0 : 1600,
    );
    const stopSync = startUrlSync();
    return () => {
      window.clearTimeout(ask);
      stopSync();
    };
  }, [ready]);

  // Console API for inspection: window.atlas.{globe,settings,run,say,flyTo,layers,features}
  // (also exposed as window.gev, the old name).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ runCommand, COMMANDS }, { parseIntent }, camera, registry, { useSettings }, cesium, { PRESETS }, exportsMod, share] =
        await Promise.all([
          import("@/lib/voice/commands"),
          import("@/lib/voice/intent"),
          import("@/lib/globe/camera"),
          import("@/lib/globe/registry"),
          import("@/lib/store/settings"),
          import("@/lib/globe/cesium"),
          import("@/lib/explore/presets"),
          import("@/lib/explore/export"),
          import("@/lib/globe/share"),
        ]);
      if (cancelled) return;
      const api = {
        globe: useGlobe,
        settings: useSettings,
        viewer: cesium.getViewer,
        layers: LAYERS,
        commands: COMMANDS.map((c) => c.name),
        run: runCommand,
        say: (text: string) => {
          const i = parseIntent(text);
          return i ? runCommand(i.command, i.args) : Promise.resolve("no intent parsed");
        },
        flyTo: camera.flyTo,
        features: registry.allFeatures,
        presets: PRESETS,
        exports: { gaugesCsv: exportsMod.gaugesCsv, chipsGeoJson: exportsMod.chipsGeoJson, areasCsv: exportsMod.areasCsv, tradeCsv: exportsMod.tradeCsv },
        shareUrl: share.shareUrl,
        applyShare: share.applyShare,
      };
      const w = window as unknown as { atlas: unknown; gev: unknown };
      w.atlas = api;
      // `gev` is the old name of this console API, kept so existing snippets
      // and bookmarklets keep working.
      w.gev = api;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keyboard: ⌘K / Ctrl+K search, comma settings, Escape leaves a measure tool, then deselects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (!typing && e.key === ",") {
        setSettingsOpen(true);
      } else if (e.key === "Escape") {
        const st = useGlobe.getState();
        // First Escape leaves a measure tool (the shape stays); the next one deselects.
        if (st.measure.mode !== "off") st.setMeasure({ mode: "off" });
        else st.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen, setSettingsOpen]);

  return (
    <main className="relative h-full w-full select-none overflow-hidden bg-background">
      {!embed && (
        <a
          href="#hud-layers"
          className="sr-only focus:not-sr-only focus:absolute focus:left-1/2 focus:top-16 focus:z-50 focus:-translate-x-1/2 focus:bg-popover focus:px-3 focus:py-2 focus:text-[11px] focus:uppercase focus:tracking-[0.22em] focus:text-foreground"
        >
          Skip to the layer controls
        </a>
      )}
      <CesiumGlobe />
      <LayerHost />
      <TimeMachineTicker />
      <HudFrame />
      {!embed && <TitleCard />}
      {embed ? (
        <EmbedBadge />
      ) : mobile ? (
        <>
          <MobileTopBar />
          {/* Bottom stack: sheet with every open panel, compact timeline, nav strip. Nothing overlaps. */}
          <div
            data-hud-occluder
            className="mobile-stack pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col gap-2 px-2"
            style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
          >
            <MobileSheet>
              {layersOpen && <LayerPanel embedded />}
              <StrataRail />
              <MeasurePanel />
              <AreaPanel />
              <WhatsHerePanel />
              <WaterReportPanel />
              <MarketReportPanel />
              <SpaceWeatherPanel />
              <IndicatorsPanel />
              <ReleasesPanel />
              <WatchlistPanel />
              <InsightsPanel />
              <ScreenerPanel />
              <InfoPanel />
            </MobileSheet>
            <Timeline compact />
            <TimeScrubber />
            <MobileNav />
          </div>
          <TourCaption />
          <TeleportCaption />
          <AscendCaption />
          <SettingsDialog />
          <SearchCommand />
          <ExploreDialog />
          <PersonaPicker />
        </>
      ) : (
        <>
          <TopBar />
          <LayerPanel />
          {/* The right column mirrors the layer column: same width, same top, same
              gutter, and it scrolls as one when a dossier runs past the frame.
              p-px and the 1 px offsets leave room for the panels' corner brackets. */}
          <div
            data-hud-occluder
            className="desk-hud-only pointer-events-none absolute right-[11px] top-[71px] z-30 flex max-h-[calc(100vh-190px)] w-[calc(var(--col-w)+2px)] max-w-[calc(100vw-22px)] flex-col gap-2 overflow-y-auto p-px [scrollbar-width:thin] xl:max-h-[calc(100vh-82px)]"
          >
            <StrataRail />
            <StartHere />
            <MeasurePanel />
            <AreaPanel />
            <WhatsHerePanel />
            <WaterReportPanel />
            <MarketReportPanel />
            <SpaceWeatherPanel />
            <IndicatorsPanel />
            <ReleasesPanel />
            <WatchlistPanel />
            <InsightsPanel />
            <InfoPanel />
          </div>
          <div data-hud-occluder className="pointer-events-none absolute bottom-16 right-3 z-30 max-w-[calc(100vw-24px)]">
            <ScreenerPanel />
          </div>
          <div className="absolute bottom-3 left-3 z-30 w-[320px] max-w-[calc(100vw-24px)]">
            <TimeScrubber />
          </div>
          <Timeline />
          <TourCaption />
          <TeleportCaption />
          <AscendCaption />
          <SettingsDialog />
          <SearchCommand />
          <ExploreDialog />
          <PersonaPicker />
          <DeskLayout />
        </>
      )}
    </main>
  );
}

/** Minimal chrome for ?embed=1: brand and a way out. Cesium's own credits stay. */
function EmbedBadge() {
  return (
    <a
      href={typeof window === "undefined" ? "/" : window.location.href.replace(/([?&])embed=1&?/, "$1").replace(/[?&]$/, "")}
      target="_blank"
      rel="noreferrer"
      className="hud-panel pointer-events-auto absolute left-3 top-3 z-30 flex items-center gap-2.5 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-foreground hover:text-primary"
      title="Open the full cockpit"
    >
      <span className="hud-lamp" aria-hidden />
      Embedding Atlas
      <span className="text-muted-foreground">· open full view</span>
    </a>
  );
}
