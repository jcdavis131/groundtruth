"use client";
// Bridges data layers to the globe: one tanstack-query per enabled layer,
// one LayerRenderer per layer. Nothing here knows how a layer is fetched or
// drawn; it only moves GeoJSON from fetch() into the renderer and reports
// status to the HUD.

import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LAYERS } from "@/lib/layers";
import { viewKey, type FetchResult, type LayerDefinition } from "@/lib/layers/types";
import { getViewer } from "@/lib/globe/cesium";
import { LayerRenderer } from "@/lib/globe/renderer";
import { getRenderer, registerRenderer, unregisterRenderer } from "@/lib/globe/registry";
import type { LayerRendererLike } from "@/lib/globe/rendererTypes";
import { PLAYBACK_HIDDEN_LAYER_IDS, TIME_AWARE_LAYER_IDS } from "@/lib/globe/timeMachine";
import { STYLES } from "@/lib/globe/styles";
import { satWorker } from "@/lib/globe/satWorker";
import { useGlobe } from "@/lib/store/globe";
import { useSettings, type Prefs } from "@/lib/store/settings";
import { useNow } from "@/lib/hooks/useNow";
import { useStrata } from "@/lib/fabric/strataStore";
import EmergenceBridge from "./EmergenceBridge";
import TraceOverlay from "./TraceOverlay";
import NldiOverlay from "./NldiOverlay";
import UpstreamOverlay from "./UpstreamOverlay";
import StrataOverlay from "./StrataOverlay";

/** Which preferences each layer's fetch() depends on (changes trigger a refetch). */
const OPTION_KEYS: Partial<Record<LayerDefinition["id"], Array<keyof Prefs>>> = {
  aircraft: ["aircraftSource"],
  satellites: ["satelliteGroups"],
  field: ["fieldPov"],
  sealevel: ["seaLevelFt"],
  wayback: ["waybackRelease"],
  topo: ["topoYear"],
  riskindex: ["nriHazard"],
  historic: ["nhlOnly"],
  naip: ["naipYear"],
  health: ["placesMeasure"],
  vulnerability: ["sviTheme"],
  broadband: ["broadbandMeasure"],
  housing: ["housingMeasure", "housingParts"],
  wildfirerisk: ["wrcMeasure", "wrcScope"],
  hospitals: ["hospitalStatus"],
};

export default function LayerHost() {
  const ready = useGlobe((s) => s.ready);
  if (!ready) return null;
  return (
    <>
      {LAYERS.map((def) => (
        <LayerBridge key={def.id} def={def} />
      ))}
      <EmergenceBridge />
      <TraceOverlay />
      <NldiOverlay />
      <UpstreamOverlay />
      <StrataOverlay />
    </>
  );
}

/**
 * The camera reports its target several times a second while flying. View-
 * dependent layers must not refetch on every intermediate frame (adsb.lol
 * rate-limits at a handful of requests per second), so the view used for
 * query keys only updates once the camera has been still for a moment.
 */
function useSettledView(delayMs = 700, followCadenceMs = 5000) {
  const live = useGlobe((s) => s.view);
  const following = useGlobe((s) => s.following);
  const [settled, setSettled] = useState(live);
  // Free camera: settle once it has been still for a moment.
  useEffect(() => {
    if (following) return;
    const id = setTimeout(() => setSettled(live), delayMs);
    return () => clearTimeout(id);
  }, [live, delayMs, following]);
  // Following a moving target the camera never stops, so sample the live
  // view on a fixed cadence instead; otherwise a long chase would keep
  // polling around the place the chase started.
  useEffect(() => {
    if (!following) return;
    const id = setInterval(() => setSettled(useGlobe.getState().view), followCadenceMs);
    return () => clearInterval(id);
  }, [following, followCadenceMs]);
  return settled;
}

function LayerBridge({ def }: { def: LayerDefinition }) {
  const enabled = useGlobe((s) => s.layers[def.id]);
  // The constructs stack can be pinned to a point (lib/fabric/strataStore.ts);
  // its view key reads the pin, so a pin change must re-render the bridge.
  useStrata((s) => (def.id === "constructs" ? s.pin : null));
  const view = useSettledView();
  const setStatus = useGlobe((s) => s.setStatus);
  const pushLog = useGlobe((s) => s.pushLog);
  const keys = useSettings((s) => s.keys);
  const prefs = useSettings((s) => s.prefs);
  const labels = prefs.labels;
  const clockOffset = useGlobe((s) => s.clock.offsetMs);
  const timeMachine = useGlobe((s) => s.clock.timeMachine);
  const playbackYear = useGlobe((s) => s.playbackYear);
  // Time-aware layers (energy history) re-fetch when the playback year
  // changes; other layers keep their keys untouched.
  const playbackKey = (TIME_AWARE_LAYER_IDS as readonly string[]).includes(def.id) && timeMachine
    ? playbackYear
    : null;
  // Time-dependent layers (satellite scenes) re-fetch when the mission clock
  // crosses into another UTC day; a coarse minute tick is plenty for that.
  const minute = useNow(60_000);
  const missionDay = def.timeDependent ? Math.floor((minute + clockOffset) / 86_400_000) : 0;

  const rendererRef = useRef<LayerRendererLike | null>(null);

  useEffect(() => {
    const viewer = getViewer();
    if (!viewer) return;
    // Particle-flow layers bring their own canvas renderer; everything else
    // goes through the GeoJSON LayerRenderer (which needs a STYLES entry).
    const r = def.createRenderer
      ? def.createRenderer(viewer)
      : (() => {
          const style = STYLES[def.id];
          if (!style) return null;
          return new LayerRenderer(viewer, def.id, style);
        })();
    if (!r) return;
    r.show = useGlobe.getState().layers[def.id];
    r.setLabelsEnabled(useSettings.getState().prefs.labels);
    r.setTileAlpha(useSettings.getState().prefs.tileAlpha?.[def.id] ?? null);
    // Pictures (tiled imagery) report failing tiles through the same status line as a failed fetch.
    r.onTileHealth = (h) => {
      const g = useGlobe.getState();
      if (h.failing) {
        g.setStatus(def.id, { error: h.message });
        g.pushLog({ level: "warn", text: `${def.label}: ${h.message}`, layer: def.id });
      } else if (g.status[def.id]?.error?.startsWith("tiles failing")) {
        g.setStatus(def.id, { error: undefined });
      }
    };
    registerRenderer(def.id, r);
    rendererRef.current = r;
    return () => {
      unregisterRenderer(def.id);
      r.destroy();
      rendererRef.current = null;
    };
    // The whole `def` object is the dep (not def.id/def.createRenderer): it is
    // a stable module-level reference, so this never re-fires spuriously.
    // The tile-health callback reads the layer label from it.
  }, [def]);

  useEffect(() => {
    if (!rendererRef.current) return;
    // ERCOT is live-only: hidden while the time machine is engaged.
    const hidden = timeMachine && (PLAYBACK_HIDDEN_LAYER_IDS as readonly string[]).includes(def.id);
    rendererRef.current.show = enabled && !hidden;
    // The satellite propagation worker only needs to run while the layer shows.
    if (def.id === "satellites") satWorker.setEnabled(enabled);
  }, [enabled, def.id, timeMachine]);

  useEffect(() => {
    rendererRef.current?.setLabelsEnabled(labels);
  }, [labels]);

  const tileAlpha = prefs.tileAlpha?.[def.id];
  useEffect(() => {
    rendererRef.current?.setTileAlpha(tileAlpha ?? null);
  }, [tileAlpha]);

  // The state of the layers this one's refine() reads: on/off, their last
  // answer and whether it failed (hazards steps aside for Earthquakes and Live
  // warnings only while they are drawing the same events). A change re-runs
  // refine on the data in hand; it is not a refetch.
  const depsKey = useGlobe((s) => (def.dependsOn ?? []).map((id) => `${s.layers[id] ? 1 : 0}:${s.status[id]?.fetchedAt ?? 0}:${s.status[id]?.error ? 1 : 0}`).join("|"));

  const vk = def.viewDependent ? (def.viewKey?.(view) ?? viewKey(view)) : "static";
  const optionsKey = useMemo(() => {
    const ks = OPTION_KEYS[def.id] ?? [];
    return JSON.stringify(ks.map((k) => prefs[k]));
  }, [def.id, prefs]);

  // TanStack re-reads queryFn on every render, so the closure always carries
  // the latest settled view, keys and prefs without touching refs in render.
  const query = useQuery({
    queryKey: ["layer", def.id, vk, optionsKey, missionDay, playbackKey],
    // Each answer carries the view key it was fetched for, so one kept on screen while
    // the next view loads (keepPreviousData) still says which view it describes, and the
    // view itself: an interval refetch under the same key asks with the latest view.
    queryFn: ({ signal }): Promise<FetchResult> =>
      def
        .fetch({
          keys,
          view,
          now: Date.now(),
          missionTime: Date.now() + useGlobe.getState().clock.offsetMs,
          playbackYear: playbackKey,
          signal,
          options: { ...prefs } as unknown as Record<string, unknown>,
        })
        .then((r) => ({ ...r, viewKey: vk, fetchView: view })),
    enabled,
    refetchInterval: def.updateIntervalMs,
    staleTime: Math.max(1000, def.updateIntervalMs / 2),
    placeholderData: keepPreviousData,
  });

  const { data: fetched, error, isFetching } = query;

  // What is drawn: the fetched result, refined by the layers it depends on.
  // The renderer is updated before the status below, so a layer refining on
  // this one's status finds these features in the renderer when it re-runs.
  const data = useMemo(() => {
    if (!fetched || !def.refine) return fetched;
    const deps = def.dependsOn ?? [];
    const s = useGlobe.getState();
    const refined = def.refine(fetched, {
      layersOn: Object.fromEntries(deps.map((id) => [id, !!s.layers[id]])),
      answering: Object.fromEntries(deps.map((id) => [id, s.status[id]?.fetchedAt != null && !s.status[id]?.error])),
      // What the layer's renderer holds; whether it is shown is layersOn (the
      // store flips before the renderer's own effect catches up).
      holds: (layer, id) => deps.includes(layer) && !!getRenderer(layer)?.getFeature(id),
    });
    return { ...refined, viewKey: fetched.viewKey, fetchView: fetched.fetchView, settling: fetched.settling };
    // depsKey is what the store reads above: re-run when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched, def, depsKey]);

  useEffect(() => {
    if (!data) return;
    rendererRef.current?.update(data.collection, data.meta);
    const live = data.collection.features.filter((f) => !f.properties.simulated).length;
    const metaCount = typeof data.meta?.count === "number" ? (data.meta.count as number) : undefined;
    setStatus(def.id, {
      count: metaCount ?? (def.simulated ? data.collection.features.length : live),
      source: data.source,
      fetchedAt: data.fetchedAt,
      note: data.note,
      error: undefined,
      loading: false,
      picture: data.meta?.picture === true,
      viewKey: data.viewKey,
      fetchView: data.fetchView,
      settling: data.settling === true,
    });
  }, [data, def.id, def.simulated, setStatus]);

  useEffect(() => {
    if (!error) return;
    const text = error instanceof Error ? error.message : String(error);
    setStatus(def.id, { error: text, loading: false });
    pushLog({ level: "warn", text: `${def.label}: ${text}`, layer: def.id });
  }, [error, def.id, def.label, setStatus, pushLog]);

  useEffect(() => {
    setStatus(def.id, { loading: isFetching });
  }, [isFetching, def.id, setStatus]);

  return null;
}
