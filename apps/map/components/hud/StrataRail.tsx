"use client";
// The strata rail: the constructs stack as an ordered list in the HUD.
//
// Smallest to largest (flood zone, tract, HUC-12 … state, country), each row
// a point-of-view colour chip, the kind, the name, the published area and the
// number of loaded physical features inside it (the location join), with the
// rivers' condition where gauges inside are rated. Selecting a row focuses
// the construct: the globe draws its outline on the ground and the camera
// frames it. Ascend flies up through the stack; Compare drops a second pin
// and marks which constructs the two places share. On a desktop the rail sits
// at the head of the right column; on a phone it lives in the bottom sheet,
// and its header row (the focused construct) is what the sheet's peek shows.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpToLine, GitCompareArrows, LocateFixed, Unlock, X } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import { useNow } from "@/lib/hooks/useNow";
import { DOMAINS } from "@/lib/fabric/catalog";
import { FLOW_CLASSES, flowClass, ordinal } from "@/lib/fabric/condition";
import { compareFabrics, compareSummary, type CompareRow } from "@/lib/fabric/compare";
import { countPhrase, formatArea, orderStrata, SHORT_KIND, type InsideStats } from "@/lib/fabric/strata";
import { useStrata } from "@/lib/fabric/strataStore";
import { clearFocus, currentFabric, focusConstruct, insideStats, loadedFeatures, useAscend } from "@/lib/fabric/strataClient";
import { ensureNormals } from "@/lib/fabric/normalsClient";
import { joinInside } from "@/lib/fabric/join";
import { formatLatLon } from "@/lib/globe/geo";
import { LAYER_BY_ID } from "@/lib/layers";
import type { LayerId } from "@/lib/layers/types";
import type { ConstructNode } from "@/lib/fabric/types";
import { isMobileViewport } from "@/lib/hooks/useIsMobile";
import { openPanels, useMobile } from "@/lib/mobile/store";

function Vital({ s }: { s: InsideStats | null }) {
  if (!s || s.flowPct == null) return null;
  const cls = flowClass(s.flowPct);
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: FLOW_CLASSES[cls].color }}
      title={`Rivers inside: median ${ordinal(s.flowPct)} percentile for today, ${FLOW_CLASSES[cls].label} (${s.rated} rated gauge${s.rated === 1 ? "" : "s"})`}
      aria-label={`rivers ${FLOW_CLASSES[cls].label}`}
    />
  );
}

/** The focused construct's line of vitals: what is inside, the rivers, the warnings. Only computed values. */
function detailLine(s: InsideStats | null): string {
  if (!s) return "No outline is published for this construct here, so nothing can be joined into it.";
  const parts: string[] = [];
  const top = (Object.entries(s.byLayer) as [LayerId, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [layer, n] of top) parts.push(countPhrase(layer, n, LAYER_BY_ID[layer]?.label));
  if (s.flowPct != null) parts.push(`rivers at the ${ordinal(s.flowPct)} percentile, ${FLOW_CLASSES[flowClass(s.flowPct)].label}`);
  if (s.warnings != null) parts.push(s.warnings ? `${s.warnings} live warning${s.warnings === 1 ? "" : "s"}` : "no live warning");
  return parts.length ? parts.join(" · ") : "Nothing loaded on the globe falls inside it yet; switch on gauges, wells, companies or banks to join them.";
}

export default function StrataRail() {
  const on = useGlobe((s) => s.layers.constructs);
  const st = useGlobe((s) => s.status.constructs);
  const selected = useGlobe((s) => s.selected);
  const railOpen = useStrata((s) => s.railOpen);
  const setRailOpen = useStrata((s) => s.setRailOpen);
  const pin = useStrata((s) => s.pin);
  const setPin = useStrata((s) => s.setPin);
  const cmpPoint = useStrata((s) => s.compare);
  const cmpFabric = useStrata((s) => s.compareFabric);
  const cmpStatus = useStrata((s) => s.compareStatus);
  const cmpError = useStrata((s) => s.compareError);
  const picking = useStrata((s) => s.picking);
  const ascending = useAscend((s) => s.active);
  const tick = useNow(5000);
  const [, bump] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);

  // The stack lives on the constructs layer; re-read it when the layer lands new data.
  const fabric = on ? currentFabric() : null;
  const fetchedAt = st?.fetchedAt ?? 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nodes = useMemo(() => (fabric ? orderStrata(fabric.nodes) : []), [fabric, fetchedAt]);
  const focusId = selected?.layer === "constructs" && selected.id !== "here" ? selected.id : null;
  const focus = nodes.find((n) => n.id === focusId) ?? null;

  const stats = useMemo(() => {
    const feats = loadedFeatures();
    return new Map(nodes.map((n) => [n.id, insideStats(n, feats)] as const));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, tick]);

  // The rivers' condition needs each gauge's daily statistics; ask for the focused construct's.
  useEffect(() => {
    if (!focus?.rings) return;
    let live = true;
    const gauges = (joinInside(focus.rings, loadedFeatures()).get("water") ?? []).filter((f) => /gauge/.test(f.properties.kind ?? ""));
    if (!gauges.length) return;
    void ensureNormals(gauges).then((got) => {
      if (got && live) bump((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [focus]);

  const comparison = useMemo(() => (fabric && cmpFabric ? compareFabrics(fabric, cmpFabric) : null), [fabric, cmpFabric]);
  const cmpByKind = useMemo(() => new Map<string, CompareRow>((comparison?.rows ?? []).map((r) => [r.kind, r])), [comparison]);

  // On a phone, a stack that opens on its own opens the sheet at peek, so the
  // globe (and the strata on it) stays in view; the visitor drags it up.
  useEffect(() => {
    if (!on || !railOpen || !isMobileViewport()) return;
    const open = openPanels();
    if (open.length === 1 && open[0] === "strata") useMobile.getState().setSheet("peek");
  }, [on, railOpen]);

  // Keep the focused row in view as focus moves (Ascend, arrow keys).
  // Only the list scrolls: scrollIntoView would also scroll the phone sheet
  // and push the rail's header (what the sheet's peek shows) out of view.
  useEffect(() => {
    const list = listRef.current;
    if (!focusId || !list) return;
    // The row's <li> (the button's offsetParent is the li itself, which is positioned).
    const row = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"]`)?.closest("li");
    if (!row || list.scrollHeight <= list.clientHeight) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [focusId]);

  if (!on || !railOpen) return null;

  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = focus ? nodes.indexOf(focus) : -1;
    const j = Math.max(0, Math.min(nodes.length - 1, e.key === "ArrowDown" ? i + 1 : i - 1));
    if (nodes[j]) {
      focusConstruct(nodes[j].id);
      listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(nodes[j].id)}"]`)?.focus({ preventScroll: true });
    }
  };

  const iconBtn = "flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40";
  const anchor = pin ?? (fabric ? { lon: fabric.point.lon, lat: fabric.point.lat } : null);

  return (
    <section className="pointer-events-auto w-full" aria-label="Constructs stack">
      <div className={`hud-panel ${focus ? "hud-panel-lit" : ""}`}>
        {/* Row 1: the title, the count and the controls. */}
        <div className="flex h-10 items-center gap-1 border-b border-border pl-3 pr-1">
          <span className="hud-label">Strata</span>
          <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">{nodes.length ? nodes.length : st?.loading ? "…" : "—"}</span>
          <span className="flex-1" />
          <button type="button" className={iconBtn} onClick={() => useAscend.getState().start()} disabled={!nodes.length || ascending} title="Ascend: fly up through the stack, smallest to largest" aria-label="Ascend through the stack">
            <ArrowUpToLine className="size-3.5" />
          </button>
          <button
            type="button"
            className={iconBtn}
            onClick={() => {
              const s = useStrata.getState();
              if (s.compare) void s.setCompare(null);
              else {
                if (!s.pin && fabric) s.setPin({ lon: fabric.point.lon, lat: fabric.point.lat });
                s.setPicking(!s.picking);
              }
            }}
            disabled={!nodes.length}
            aria-pressed={picking || !!cmpPoint}
            data-on={picking || !!cmpPoint}
            title={cmpPoint ? "Clear the comparison" : "Compare: drop a second pin (or long-press / shift-click the globe)"}
            aria-label={cmpPoint ? "Clear the comparison" : "Compare with a second place"}
          >
            <GitCompareArrows className="size-3.5" />
          </button>
          {pin && (
            <button type="button" className={iconBtn} onClick={() => setPin(null)} title="Release the pin: the stack follows the camera again" aria-label="Release the pinned stack">
              <Unlock className="size-3.5" />
            </button>
          )}
          <button type="button" className={`${iconBtn} hidden md:flex`} onClick={() => setRailOpen(false)} aria-label="Close the strata rail">
            <X className="size-3.5" />
          </button>
        </div>

        {/* Row 2: the focused construct (what a phone's peek shows). */}
        <div className="flex min-h-[34px] items-center gap-2 border-b border-border px-3 py-1.5">
          {focus ? (
            <>
              <span className="size-2 shrink-0" style={{ background: DOMAINS[focus.domain].color }} aria-hidden />
              <span className="hud-label shrink-0 text-signal">{SHORT_KIND[focus.kind]}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--bright)]" title={focus.name}>
                {focus.name}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{formatArea(focus.areaKm2)} km²</span>
              <button type="button" className="-mr-2 flex size-7 items-center justify-center text-muted-foreground hover:text-foreground" onClick={clearFocus} aria-label="Clear focus">
                <X className="size-3" />
              </button>
            </>
          ) : picking ? (
            <span className="text-[10px] leading-snug text-signal">Tap the globe to drop pin B. Long-press (phone) or shift-click (desktop) works any time.</span>
          ) : (
            <span className="text-[10px] leading-snug text-muted-foreground">
              {nodes.length ? "Select a stratum to frame it and draw its outline." : st?.loading ? "Reading the stack under the camera…" : st?.error ? `The stack did not load: ${st.error}` : "No construct here."}
            </span>
          )}
        </div>

        {/* Compare: A and B, the one-line verdict and the counts. */}
        {(cmpPoint || picking) && (
          <div className="border-b border-border px-3 py-2 text-[10px] leading-snug">
            <div className="flex items-baseline gap-3">
              <span className="hud-label">Compare</span>
              <span className="grid flex-1 grid-cols-[10px_1fr] gap-x-1.5 tabular-nums text-muted-foreground">
                <span className="text-signal">A</span>
                <span className="truncate">{anchor ? formatLatLon(anchor.lat, anchor.lon) : "—"}</span>
                <span className="text-signal">B</span>
                <span className="truncate">{cmpPoint ? formatLatLon(cmpPoint.lat, cmpPoint.lon) : "tap the globe"}</span>
              </span>
            </div>
            {cmpStatus === "loading" && (
              <div className="mt-1 text-muted-foreground">
                <span className="blink text-signal">reading</span> the stack at B…
              </div>
            )}
            {cmpStatus === "error" && <div className="mt-1 text-alert">{cmpError}</div>}
            {comparison && (
              <>
                <div className="mt-1 text-[11px] text-[var(--bright)]">{compareSummary(comparison) || "—"}</div>
                <div className="mt-0.5 text-muted-foreground">
                  <span className="text-signal">{comparison.shared} shared</span> · {comparison.differs} differ
                  {comparison.meet && <> · both inside {comparison.meet.name}</>}
                </div>
              </>
            )}
          </div>
        )}

        {/* The stack. */}
        {nodes.length > 0 && (
          <>
            <div className="strata-head grid grid-cols-[8px_var(--strata-kind-w)_1fr_44px_30px] items-center gap-x-2 px-3 pb-1 pt-2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              <span />
              <span>Kind</span>
              <span>Name</span>
              <span className="text-right">km²</span>
              <span className="text-right" title="Loaded physical features inside, joined by outline">In</span>
            </div>
            <ol ref={listRef} className="strata-list max-h-[46vh] overflow-y-auto pb-1 [scrollbar-width:thin]" onKeyDown={onKey} aria-label="Constructs, smallest to largest">
              {nodes.map((n) => (
                <StrataRow key={n.id} n={n} s={stats.get(n.id) ?? null} focused={n.id === focusId} cmp={cmpByKind.get(n.kind)} />
              ))}
            </ol>
            {comparison && comparison.rows.some((r) => r.status === "only-b") && (
              <div className="border-t border-border px-3 py-1.5 text-[10px] leading-snug text-muted-foreground">
                Only at B:{" "}
                {comparison.rows
                  .filter((r) => r.status === "only-b")
                  .map((r) => `${SHORT_KIND[r.kind]} ${r.b!.name}`)
                  .join(" · ")}
              </div>
            )}
          </>
        )}

        <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[9px] leading-snug text-muted-foreground">
          <LocateFixed className="size-3 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {anchor ? formatLatLon(anchor.lat, anchor.lon) : "—"} · {pin ? "pinned" : "follows the view"}
          </span>
          <span className="shrink-0">In = loaded now, by outline</span>
        </div>
      </div>
    </section>
  );
}

function StrataRow({ n, s, focused, cmp }: { n: ConstructNode; s: InsideStats | null; focused: boolean; cmp?: CompareRow }) {
  const color = DOMAINS[n.domain].color;
  const shared = cmp?.status === "shared";
  const differs = cmp?.status === "differs";
  return (
    <li className={`strata-row ${focused ? "strata-row-focus" : ""}`}>
      <button
        type="button"
        data-id={n.id}
        onClick={() => focusConstruct(n.id)}
        aria-current={focused ? "true" : undefined}
        className="grid w-full grid-cols-[8px_var(--strata-kind-w)_1fr_44px_30px] items-center gap-x-2 px-3 py-[5px] text-left text-[10.5px] leading-tight"
        title={`${n.name} (${DOMAINS[n.domain].label}: ${DOMAINS[n.domain].question.toLowerCase()})`}
      >
        <span className="size-2" style={{ background: color, boxShadow: shared ? "0 0 0 1px var(--background), 0 0 0 2px var(--signal)" : undefined }} aria-hidden />
        <span className="truncate text-[9px] uppercase tracking-[0.06em]" style={{ color: focused ? "var(--signal)" : color }}>
          {SHORT_KIND[n.kind]}
        </span>
        <span className="min-w-0">
          <span className={`block truncate ${focused ? "text-[var(--bright)]" : "text-foreground/90"}`}>{n.name}</span>
          {differs && <span className="block truncate text-[9.5px] text-muted-foreground">B · {cmp!.b!.name}</span>}
          {shared && <span className="block truncate text-[9.5px] text-signal">shared</span>}
        </span>
        <span className="text-right tabular-nums text-muted-foreground">{formatArea(n.areaKm2)}</span>
        <span className="flex items-center justify-end gap-1 tabular-nums text-foreground/80">
          <Vital s={s} />
          {s ? s.total.toLocaleString("en-US") : "—"}
        </span>
      </button>
      {focused && <div className="px-3 pb-2 pl-[26px] text-[10px] leading-snug text-muted-foreground">{detailLine(s)}</div>}
    </li>
  );
}
