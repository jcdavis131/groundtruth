"use client";
// Phone bottom sheet. Every open panel renders inside it, stacked, in one
// scroll container. Three heights: peek (the header row and the first line of
// the top panel, so the globe stays in view while a construct is framed),
// half, and tall. The handle row drags: the sheet follows the finger and
// snaps to the nearest height on release; dragged well below peek it closes
// everything. A tap toggles half and tall; the X closes everything. Panels
// keep their own markup; app/globals.css relaxes their desktop widths and
// inner max-heights under `.mobile-sheet`.

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { closeAllPanels, sheetStops, snapSheet, useMobile, useOpenPanels } from "@/lib/mobile/store";
import StartHere from "./StartHere";

const TITLES: Record<string, string> = {
  layers: "Layers",
  strata: "Strata",
  water: "Water report",
  market: "Market report",
  indicators: "Signals",
  releases: "Releases",
  watch: "Watchlist",
  screener: "Screener",
  info: "Selected",
};

export default function MobileSheet({ children }: { children: ReactNode }) {
  const open = useOpenPanels();
  const sheet = useMobile((s) => s.sheet);
  const toggleSheet = useMobile((s) => s.toggleSheet);
  const setSheet = useMobile((s) => s.setSheet);
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; id: number; h: number; moved: boolean } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  // A drag ends with a click on the handle button; that click is not a tap.
  const dragged = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const h = ref.current?.getBoundingClientRect().height ?? sheetStops(window.innerHeight)[sheet];
    drag.current = { y: e.clientY, id: e.pointerId, h, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    setDragH(Math.max(56, Math.min(window.innerHeight - 150, d.h - dy)));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    setDragH(null);
    if (!d.moved) return;
    dragged.current = true;
    setTimeout(() => (dragged.current = false), 0);
    const next = snapSheet(d.h - (e.clientY - d.y), window.innerHeight);
    if (next) setSheet(next);
    else closeAllPanels();
  };
  if (open.length === 0) return null;
  return (
    <section
      ref={ref}
      data-hud-occluder
      className={`mobile-sheet pointer-events-auto flex min-h-0 flex-col mobile-sheet-${sheet} ${dragH != null ? "mobile-sheet-dragging" : ""}`}
      style={dragH != null ? { maxHeight: dragH, height: dragH } : undefined}
      aria-label="Open panels"
    >
      <div
        className="hud-panel flex touch-none items-center gap-2 px-2 py-1"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDragH(null);
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (dragged.current) return;
            if (sheet === "peek") setSheet("half");
            else toggleSheet();
          }}
          className="flex h-8 flex-1 items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground"
          aria-label={sheet === "tall" ? "Shrink panel" : "Expand panel"}
        >
          <span className="mobile-sheet-grip" aria-hidden />
          {sheet === "tall" ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          <span className="truncate">{open.map((id) => TITLES[id] ?? id).join(" · ")}</span>
        </button>
        <button
          type="button"
          onClick={closeAllPanels}
          className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Close all panels"
        >
          <X className="size-4" />
        </button>
      </div>
      {/* The panel the visitor asked for comes first; the lens's start-here
          card follows it, folded, so it never pushes that panel off screen. */}
      <div className="mobile-sheet-body flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pt-2">
        {children}
        <StartHere collapsible />
      </div>
    </section>
  );
}
