"use client";

import { Switch } from "@/components/ui/switch";
import { LAYERS } from "@/lib/layers";
import { groupLayers, erroringLayers } from "@/lib/layers/groups";
import type { LayerDefinition, LayerId } from "@/lib/layers/types";
import { useGlobe, type LayerStatus } from "@/lib/store/globe";
import { timeAgo } from "@/lib/globe/geo";
import { useLens } from "@/lib/personas/store";
import { PERSONA_BY_ID } from "@/lib/personas/registry";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import FieldControls from "./FieldControls";
import TileControls, { PICTURE_LAYERS } from "./TileControls";
import LayerOptions, { OPTION_LAYERS } from "./LayerOptions";

/** One layer in the pinned list: dot, name, badges, count, switch, status line. */
function LayerRow({
  l,
  on,
  st,
  setLayer,
}: {
  l: LayerDefinition;
  on: boolean;
  st: LayerStatus | undefined;
  setLayer: (id: LayerId, on: boolean) => void;
}) {
  const toggle = (checked: boolean) => setLayer(l.id, checked);
  return (
    <li className="flex min-h-[48px] flex-col justify-center px-3 py-2 md:min-h-0">
      <div className="flex items-center gap-2.5">
        <span
          className="size-1.5 shrink-0 rounded-full"
          aria-hidden
          style={{ background: on ? l.color : "transparent", boxShadow: on ? `0 0 6px ${l.color}` : `inset 0 0 0 1px ${l.color}`, opacity: on ? 1 : 0.6 }}
        />
        <button
          type="button"
          onClick={() => setLayer(l.id, !on)}
          className="hud-display min-w-0 flex-1 text-left text-[13px] leading-tight tracking-[0.1em] md:text-[11.5px]"
          style={{ color: on ? "var(--accent-foreground)" : "var(--muted-foreground)" }}
          title={l.description}
        >
          {l.label}
        </button>
        <span className="min-w-[44px] shrink-0 text-right text-[13px] tabular-nums text-foreground/90 md:text-[11px]">
          {on && st ? (st.picture ? "MAP" : st.count.toLocaleString()) : "—"}
        </span>
        {/* Short-landscape phones keep the pinned panel, so both sizes stay. */}
        <Switch
          size="default"
          checked={on}
          onCheckedChange={toggle}
          aria-label={`Toggle ${l.label}`}
          className="shrink-0 md:hidden"
        />
        <Switch
          size="sm"
          checked={on}
          onCheckedChange={toggle}
          aria-label={`Toggle ${l.label}`}
          className="hidden shrink-0 md:block"
        />
      </div>
      {(on || l.simulated || l.estimate) && (
        <div className="mt-1 flex items-center justify-between gap-2 pl-4 text-[10px] text-muted-foreground md:text-[9px]">
          <span className="flex min-w-0 items-center gap-2">
            {l.simulated && <span className="shrink-0 border border-warn/40 px-1 text-[8px] tracking-[0.18em] text-warn">SIMULATED</span>}
            {l.estimate && (
              <span className="shrink-0 border border-warn/40 px-1 text-[8px] tracking-[0.18em] text-warn" title={l.estimate}>
                ESTIMATE
              </span>
            )}
            {on && (
              <span className="truncate">
                {st?.error ? <span className="text-alert">ERR {st.error.slice(0, 60)}</span> : st?.note ? st.note : l.attribution}
              </span>
            )}
          </span>
          {on && <span className="shrink-0 tabular-nums">{st?.loading ? <span className="skeleton h-3 w-12" aria-label="Syncing" /> : timeAgo(st?.fetchedAt)}</span>}
        </div>
      )}
      {on && l.id === "field" && <FieldControls />}
      {on && PICTURE_LAYERS.has(l.id) && <TileControls id={l.id} />}
      {on && OPTION_LAYERS.has(l.id) && <LayerOptions id={l.id} />}
    </li>
  );
}

/**
 * `embedded`: render as a block inside the mobile sheet instead of pinned to
 * the left edge. Phones get a compact two-column grid that opens on the lens's
 * own feeds, because nineteen full-width rows bury the rest of the sheet.
 *
 * The sheet covers every viewport `useIsMobile` calls a phone, so the pinned
 * list below is the desktop (and short-landscape) layout only.
 */
export default function LayerPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const layers = useGlobe((s) => s.layers);
  const status = useGlobe((s) => s.status);
  const setLayer = useGlobe((s) => s.setLayer);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const on = Object.values(layers).filter(Boolean).length;
  const header = (
    <div className="flex h-10 items-center justify-between border-b border-border px-3">
      <span className="hud-label">Signal layers</span>
      <span className="text-[9px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground">
        <span className="text-foreground">{on}</span> / {LAYERS.length} on
      </span>
    </div>
  );

  if (embedded) {
    return (
      <aside className="pointer-events-auto w-full">
        <div className="hud-panel">
          {header}
          <CompactLayers layers={layers} status={status} setLayer={setLayer} />
        </div>
      </aside>
    );
  }

  return (
    // p-px and the 1 px offsets keep the panel on the 12 px grid while leaving
    // room for its corner brackets inside the scroll box.
    <aside
      data-hud-occluder
      id="hud-layers"
      tabIndex={-1}
      aria-label="Signal layers"
      className="pointer-events-auto absolute left-[11px] top-[71px] z-30 max-h-[calc(100vh-190px)] w-[calc(var(--col-w)+2px)] max-w-[calc(100vw-22px)] overflow-y-auto p-px outline-none [scrollbar-width:thin] xl:max-h-[calc(100vh-82px)]"
    >
      <div className="hud-panel">
        {header}
        <ul className="divide-y divide-border/60">
          {LAYERS.map((l) => (
            <LayerRow key={l.id} l={l} on={!!layers[l.id]} st={status[l.id]} setLayer={setLayer} />
          ))}
        </ul>
      </div>
    </aside>
  );
}

type Layers = ReturnType<typeof useGlobe.getState>["layers"];
type Status = ReturnType<typeof useGlobe.getState>["status"];

/** Phone layout: tiles, the lens's feeds first, the rest behind one disclosure. */
function CompactLayers({
  layers,
  status,
  setLayer,
}: {
  layers: Layers;
  status: Status;
  setLayer: (id: LayerDefinition["id"], on: boolean) => void;
}) {
  const personaId = useLens((s) => s.personaId);
  const [showAll, setShowAll] = useState(false);
  const lens = personaId ? PERSONA_BY_ID[personaId].layers : undefined;
  // Freeze the split while the panel is open so tapping a tile never makes the
  // grid reflow under the finger; it re-splits when the lens changes.
  const groups = useMemo(() => groupLayers(LAYERS, { lens, on: useGlobe.getState().layers }), [lens]);
  const problems = erroringLayers(LAYERS, layers, status);

  return (
    <div className="px-2 py-2">
      <Tiles items={groups.primary} layers={layers} status={status} setLayer={setLayer} />
      {layers.field && <FieldControls />}
      {LAYERS.filter((l) => layers[l.id] && (PICTURE_LAYERS.has(l.id) || OPTION_LAYERS.has(l.id))).map((l) => (
        <div key={l.id} className="mt-2">
          <div className="px-1 text-[9px] uppercase tracking-widest" style={{ color: l.color }}>
            {l.label}
          </div>
          <TileControls id={l.id} />
          <LayerOptions id={l.id} />
        </div>
      ))}
      {groups.more.length > 0 && (
        <>
          {showAll && (
            <>
              <div className="mt-2 px-1 pb-1 text-[9px] uppercase tracking-widest text-muted-foreground">
                Everything else
              </div>
              <Tiles items={groups.more} layers={layers} status={status} setLayer={setLayer} />
            </>
          )}
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-border/70 py-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            aria-expanded={showAll}
          >
            {showAll ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {showAll ? "Fewer layers" : `More layers (${groups.more.length})`}
          </button>
        </>
      )}
      {problems.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
          {problems.slice(0, 3).map(({ layer, error }) => (
            <li key={layer.id} className="truncate text-[9px] text-alert" title={error}>
              {layer.label}: {error}
            </li>
          ))}
          {problems.length > 3 && (
            <li className="text-[9px] text-alert">+{problems.length - 3} more feeds failing</li>
          )}
        </ul>
      )}
    </div>
  );
}

function Tiles({
  items,
  layers,
  status,
  setLayer,
}: {
  items: LayerDefinition[];
  layers: Layers;
  status: Status;
  setLayer: (id: LayerDefinition["id"], on: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map((l) => {
        const on = layers[l.id];
        const st = status[l.id];
        return (
          <button
            key={l.id}
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => setLayer(l.id, !on)}
            title={l.description}
            className="flex min-h-[44px] items-center gap-1.5 rounded border px-2 py-1.5 text-left transition-colors"
            style={{
              borderColor: on ? l.color : "var(--border)",
              background: on ? `color-mix(in srgb, ${l.color} 14%, transparent)` : "transparent",
            }}
          >
            <span className="hud-dot shrink-0" style={{ color: l.color, opacity: on ? 1 : 0.35 }} />
            <span className="min-w-0 flex-1">
              <span
                className="hud-display line-clamp-2 block text-[11px] leading-tight font-semibold tracking-wider"
                style={{ color: on ? l.color : "var(--muted-foreground)" }}
              >
                {l.label}
              </span>
              {(l.simulated || l.estimate) && (
                <span className="block text-[8px] uppercase tracking-widest text-warn">
                  {l.simulated ? "Simulated" : "Estimate"}
                </span>
              )}
            </span>
            <span className="shrink-0 text-right text-[10px] tabular-nums text-foreground/80">
              {!on ? (
                "—"
              ) : st?.error ? (
                <span className="text-alert">ERR</span>
              ) : st?.loading ? (
                <span className="skeleton h-3 w-10" aria-label="Loading" />
              ) : st?.picture ? (
                "MAP"
              ) : (
                (st?.count ?? 0).toLocaleString()
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
