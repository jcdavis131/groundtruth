"use client";
// Desk mode: a resizable right pane over the globe with Table, Chart, Report
// and Notes tabs. Renders nothing unless lib/desk/store.ts says mode ===
// "desk". The integrator mounts <DeskLayout /> once inside Cockpit (after the
// HUD panels) and puts <DeskToggle /> in the TopBar.

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ClipboardCopy, Landmark, Droplets, Plus, Printer, RefreshCw, Sun, Moon, X } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import { getRenderer } from "@/lib/globe/registry";
import { flyToSelection } from "@/lib/globe/camera";
import { formatLatLon } from "@/lib/globe/geo";
import { shareUrl } from "@/lib/globe/share";
import { LAYERS } from "@/lib/layers";
import type { LayerFeature, LayerId } from "@/lib/layers/types";
import type { Series } from "@/lib/series/types";
import { areaAt } from "@/lib/economy/report";
import { marketReportFromGlobe } from "@/lib/economy/reportClient";
import { reportFromGlobe } from "@/lib/water/reportClient";
import { DESK_TABS, PANE_MAX_FRACTION, PANE_MIN_PX, initDeskFromUrl, syncDeskUrl, useDesk, withDeskParam, type DeskTab } from "@/lib/desk/store";
import { columnsFor, ECONOMY_LAYERS, featureRows, type Row } from "@/lib/desk/table";
import { toChartSeries, type ChartSeries } from "@/lib/desk/chart";
import { fetchSeries, isCountyFips, listPicker, type Fetched, type PickerItem, type PickerSource } from "@/lib/desk/api";
import { notesMarkdown, type ReportCite } from "@/lib/desk/notes";
import DataTable from "./DataTable";
import MultiSeriesChart from "./MultiSeriesChart";
import MarketReportPanel from "./MarketReportPanel";
import WaterReportPanel from "./WaterReportPanel";

const INK = { light: "#16202a", dark: "#cfe8dc" } as const;
const PAPER = { light: "#ffffff", dark: "#071118" } as const;

export default function DeskLayout() {
  const mode = useDesk((s) => s.mode);
  const theme = useDesk((s) => s.theme);
  const tab = useDesk((s) => s.tab);
  const setTab = useDesk((s) => s.setTab);
  const setTheme = useDesk((s) => s.setTheme);
  const storedWidth = useDesk((s) => s.paneWidth);
  const setPaneWidth = useDesk((s) => s.setPaneWidth);
  const [drag, setDrag] = useState<number | null>(null);

  // Mount: URL decides, else the persisted mode. Also keep `mode=desk` in
  // the address bar: lib/globe/share.ts rewrites the query from its own
  // state about a second after any change and does not know about mode.
  useEffect(() => {
    initDeskFromUrl();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useGlobe.subscribe(() => {
      if (useDesk.getState().mode !== "desk") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => syncDeskUrl("desk"), 1300);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Pointer resize: local width while dragging, one store write on release.
  const onHandleDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag(storedWidth);
    },
    [storedWidth],
  );
  const onHandleMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const w = window.innerWidth - e.clientX;
    setDrag(Math.min(Math.max(PANE_MIN_PX, w), Math.floor(window.innerWidth * PANE_MAX_FRACTION)));
  }, []);
  const onHandleUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDrag((w) => {
        if (w != null) setPaneWidth(w);
        return null;
      });
    },
    [setPaneWidth],
  );
  const onHandleKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 80 : 16;
      if (e.key === "ArrowLeft") setPaneWidth(storedWidth + step);
      else if (e.key === "ArrowRight") setPaneWidth(storedWidth - step);
      else if (e.key === "Home") setPaneWidth(window.innerWidth);
      else if (e.key === "End") setPaneWidth(PANE_MIN_PX);
      else return;
      e.preventDefault();
    },
    [setPaneWidth, storedWidth],
  );

  const onTabKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const i = DESK_TABS.findIndex((t) => t.id === tab);
      let next = i;
      if (e.key === "ArrowRight") next = (i + 1) % DESK_TABS.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + DESK_TABS.length) % DESK_TABS.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = DESK_TABS.length - 1;
      else return;
      e.preventDefault();
      setTab(DESK_TABS[next].id);
      (e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${DESK_TABS[next].id}"]`))?.focus();
    },
    [tab, setTab],
  );

  if (mode !== "desk") return null;
  const width = drag ?? storedWidth;
  const maxPct = Math.round(PANE_MAX_FRACTION * 100);

  return (
    <div className="desk-layout pointer-events-none absolute inset-0 z-40" data-dragging={drag != null ? "true" : undefined}>
      <aside className="desk-pane pointer-events-auto absolute bottom-0 right-0 top-[60px] flex flex-col border-l border-border bg-background text-foreground" style={{ width, maxWidth: `${maxPct}vw` }} aria-label="Desk workspace">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the desk pane"
          aria-valuemin={PANE_MIN_PX}
          aria-valuemax={typeof window === "undefined" ? undefined : Math.floor(window.innerWidth * PANE_MAX_FRACTION)}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onKeyDown={onHandleKey}
          className="desk-handle desk-noprint absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-primary/30 focus-visible:bg-primary/40"
          title="Drag to resize (arrow keys when focused)"
        />
        <header className="desk-noprint flex items-center gap-1 border-b border-border px-2 py-1">
          <div role="tablist" aria-label="Desk tabs" onKeyDown={onTabKey} className="flex gap-0.5">
            {DESK_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                data-tab={t.id}
                id={`desk-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`desk-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                title={t.hint}
                className={`rounded px-2 py-1 text-[11px] font-semibold ${tab === t.id ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-accent"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} className="desk-btn" title={theme === "light" ? "Dark desk" : "Light desk"} aria-label="Toggle desk theme">
            {theme === "light" ? <Moon className="size-3" /> : <Sun className="size-3" />}
          </button>
          <button type="button" onClick={() => useDesk.getState().setMode("hud")} className="desk-btn" title="Back to the HUD (D)" aria-label="Leave desk mode">
            <X className="size-3" />
          </button>
        </header>
        <section id={`desk-panel-${tab}`} role="tabpanel" aria-labelledby={`desk-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
          {tab === "table" && <TableTab />}
          {tab === "chart" && <ChartTab theme={theme} />}
          {tab === "report" && <ReportTab />}
          {tab === "notes" && <NotesTab />}
        </section>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- Table

function TableTab() {
  const layers = useGlobe((s) => s.layers);
  const status = useGlobe((s) => s.status);
  const selected = useGlobe((s) => s.selected);
  const [pick, setPick] = useState<LayerId | "all">("all");
  const [nonce, setNonce] = useState(0);
  // Refetch stamps change before the renderer has the new features; recompute a beat later.
  const stamps = ECONOMY_LAYERS.map((l) => `${layers[l] ? 1 : 0}:${status[l]?.fetchedAt ?? 0}:${status[l]?.count ?? 0}`).join("|");
  useEffect(() => {
    const id = setTimeout(() => setNonce((n) => n + 1), 400);
    return () => clearTimeout(id);
  }, [stamps]);

  const enabled = ECONOMY_LAYERS.filter((l) => layers[l]);
  const enabledKey = enabled.join(",");
  const rows = useMemo(() => {
    const out: LayerFeature[] = [];
    for (const l of enabledKey.split(",").filter(Boolean) as LayerId[]) {
      if (pick !== "all" && pick !== l) continue;
      const r = getRenderer(l);
      if (!r) continue;
      for (const f of r.features()) out.push(f);
    }
    return featureRows(out);
    // nonce is the recompute trigger; the renderer registry is not React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, pick, nonce]);
  const columns = useMemo(() => columnsFor(rows), [rows]);

  const onRow = (row: Row) => {
    const f = getRenderer(row.layer)?.getFeature(row.id);
    if (!f) return;
    const sel = { layer: row.layer, id: row.id };
    useGlobe.getState().select(sel, f);
    flyToSelection(sel);
  };

  const chips = (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Layers in the table">
      <button type="button" onClick={() => setPick("all")} aria-pressed={pick === "all"} className={`desk-chip ${pick === "all" ? "desk-chip-on" : ""}`}>
        all
      </button>
      {ECONOMY_LAYERS.map((l) => {
        const def = LAYERS.find((d) => d.id === l);
        if (!def) return null; // layer not in this build
        const on = layers[l];
        return (
          <button
            key={l}
            type="button"
            onClick={() => (on ? setPick(l) : useGlobe.getState().setLayer(l, true))}
            aria-pressed={pick === l}
            className={`desk-chip ${pick === l ? "desk-chip-on" : ""} ${on ? "" : "opacity-60"}`}
            title={on ? `${def.label}: ${status[l]?.count ?? 0} loaded` : `${def.label} is off; click to load`}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: def.color }} aria-hidden />
            {def.label}
            {on && <span className="tabular-nums text-muted-foreground">{status[l]?.count ?? 0}</span>}
          </button>
        );
      })}
      <button type="button" onClick={() => setNonce((n) => n + 1)} className="desk-btn" title="Re-read the layers" aria-label="Refresh table">
        <RefreshCw className="size-3" />
      </button>
    </div>
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      filename="gev-table"
      onRowClick={onRow}
      selectedKey={selected ? `${selected.layer}:${selected.id}` : null}
      toolbar={chips}
      ariaLabel="Loaded features"
      emptyText={enabled.length === 0 ? "No economy layer is on. Click a layer chip to load it." : "The enabled layers hold no features yet."}
    />
  );
}

// ---------------------------------------------------------------- Chart

function ChartTab({ theme }: { theme: "light" | "dark" }) {
  const refs = useDesk((s) => s.series);
  const removeSeries = useDesk((s) => s.removeSeries);
  const [pickerOpen, setPickerOpen] = useState(false);

  // One query per picked series; the cache survives tab switches and re-adds.
  const queries = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ["desk-series", ref.source, ref.id],
      queryFn: () => fetchSeries(ref),
      staleTime: 30 * 60_000,
    })),
  });

  // useQueries hands back a new array each render; the memo keys on the data entries so the chart's paths only rebuild when a series arrives.
  const results: Array<Fetched<Series> | undefined> = queries.map((q) => q.data);
  const resultsKey = results.map((r) => (r ? (r.ok ? `ok:${r.data.id}:${r.data.points.length}` : `err:${r.message}`) : "pending")).join("|");
  const chart: ChartSeries[] = useMemo(
    () =>
      refs.map((ref, i) => {
        const r = results[i];
        if (r?.ok) return { ...toChartSeries(r.data, i, ref.color), label: ref.label || r.data.title };
        return { id: ref.id, label: ref.label, color: ref.color, unit: "", points: [] };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refs, resultsKey],
  );
  const problems = refs.map((ref, i) => ({ ref, r: queries[i]?.data })).filter((x): x is { ref: (typeof refs)[number]; r: Fetched<Series> & { ok: false } } => !!x.r && !x.r.ok);
  const loading = queries.some((q) => q.isPending);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="desk-noprint flex items-center gap-2 border-b border-border px-2 py-1">
        <button type="button" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen} className="desk-btn">
          <Plus className="size-3" /> Add series
        </button>
        {refs.length > 0 && (
          <button type="button" onClick={() => useDesk.getState().clearSeries()} className="desk-btn" title="Remove every series">
            Clear
          </button>
        )}
        <span className="text-[10px] text-muted-foreground">
          {refs.length} series{loading ? " · loading…" : ""} · sources: published series, indicators, county history
        </span>
      </div>
      {pickerOpen && <SeriesPicker onClose={() => setPickerOpen(false)} />}
      {problems.length > 0 && (
        <ul className="px-2 py-1 text-[10px] text-warn" aria-live="polite">
          {problems.map(({ ref, r }) => (
            <li key={ref.id}>
              {ref.label}: {r.missing ? "not available on this deployment yet" : r.message}
            </li>
          ))}
        </ul>
      )}
      <MultiSeriesChart series={chart} title="Series" onRemove={removeSeries} ink={INK[theme]} paper={PAPER[theme]} filename="gev-chart" />
    </div>
  );
}

function SeriesPicker({ onClose }: { onClose: () => void }) {
  const addSeries = useDesk((s) => s.addSeries);
  const have = useDesk((s) => s.series);
  const [source, setSource] = useState<PickerSource>("series");
  const [fips, setFips] = useState("");
  const [q, setQ] = useState("");
  const view = useGlobe((s) => s.view);

  // County under the camera, from the area layers if they are loaded.
  const cameraFips = useMemo(() => {
    const areas: LayerFeature[] = [];
    for (const l of ["realestate", "commerce"] as const) {
      const r = getRenderer(l);
      if (r) for (const f of r.features()) areas.push(f);
    }
    return areaAt(view.lon, view.lat, areas).county?.geoid ?? null;
  }, [view.lon, view.lat]);

  const ready = source !== "history" || isCountyFips(fips);
  const list = useQuery({
    queryKey: ["desk-picker", source, source === "history" ? fips : ""],
    queryFn: () => listPicker(source, { fips }),
    staleTime: 10 * 60_000,
    enabled: ready,
  });
  const result: Fetched<PickerItem[]> | null = ready ? (list.data ?? null) : null;
  const busy = ready && list.isPending;

  const items = useMemo(() => {
    if (!result?.ok) return [];
    const needle = q.trim().toLowerCase();
    const list = needle ? result.data.filter((i) => `${i.label} ${i.id} ${i.hint ?? ""}`.toLowerCase().includes(needle)) : result.data;
    return list.slice(0, 200);
  }, [result, q]);

  return (
    <div className="desk-noprint border-b border-border bg-card px-2 py-2" role="dialog" aria-label="Add a series">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[10px] text-muted-foreground">
          Source{" "}
          <select value={source} onChange={(e) => setSource(e.target.value as PickerSource)} className="h-6 rounded border border-border bg-background px-1 text-[11px] text-foreground">
            <option value="series">Published series</option>
            <option value="indicator">Indicators</option>
            <option value="history">County history</option>
          </select>
        </label>
        {source === "history" && (
          <label className="text-[10px] text-muted-foreground">
            FIPS{" "}
            <input value={fips} onChange={(e) => setFips(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="48453" aria-label="County FIPS" className="h-6 w-16 rounded border border-border bg-background px-1 text-[11px] tabular-nums text-foreground" />
            {cameraFips && cameraFips !== fips && (
              <button type="button" onClick={() => setFips(cameraFips)} className="desk-btn ml-1" title="Use the county under the camera">
                {cameraFips}
              </button>
            )}
          </label>
        )}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search series" className="h-6 min-w-[120px] flex-1 rounded border border-border bg-background px-2 text-[11px] text-foreground" />
        <button type="button" onClick={onClose} className="desk-btn" aria-label="Close picker">
          <X className="size-3" />
        </button>
      </div>
      <div className="mt-1 max-h-48 overflow-y-auto" aria-live="polite">
        {busy && <p className="px-1 py-1 text-[10px] text-muted-foreground">loading…</p>}
        {!busy && result && !result.ok && <p className="px-1 py-1 text-[10px] text-warn">{result.message}</p>}
        {!busy && source === "history" && !isCountyFips(fips) && <p className="px-1 py-1 text-[10px] text-muted-foreground">Enter a five-digit county FIPS{cameraFips ? ` (camera is over ${cameraFips})` : ""}.</p>}
        {!busy && result?.ok && items.length === 0 && <p className="px-1 py-1 text-[10px] text-muted-foreground">Nothing matches.</p>}
        {items.length > 0 && (
          <ul className="divide-y divide-border/50">
            {items.map((it) => {
              const added = have.some((h) => h.id === it.id);
              return (
                <li key={it.id}>
                  <button type="button" disabled={added} onClick={() => addSeries({ id: it.id, label: it.label, source: it.source })} className="grid w-full grid-cols-[1fr_auto] gap-2 px-1 py-0.5 text-left text-[11px] hover:bg-accent disabled:opacity-50">
                    <span className="truncate">
                      {it.label} <span className="text-muted-foreground">· {it.unit || "—"}</span>
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">{added ? "added" : it.hint}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Report

function ReportTab() {
  const marketOpen = useGlobe((s) => s.marketReportOpen);
  const waterOpen = useGlobe((s) => s.waterReportOpen);
  const openMarket = () => {
    const st = useGlobe.getState();
    st.setLayer("realestate", true);
    st.setLayer("commerce", true);
    st.setLayer("trade", true);
    st.setMarketReportOpen(true);
  };
  const openWater = () => {
    const st = useGlobe.getState();
    st.setLayer("water", true);
    st.setLayer("groundwater", true);
    st.setWaterReportOpen(true);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="desk-noprint flex flex-wrap items-center gap-2 border-b border-border px-2 py-1">
        {!marketOpen && (
          <button type="button" onClick={openMarket} className="desk-btn">
            <Landmark className="size-3" /> Open market report
          </button>
        )}
        {!waterOpen && (
          <button type="button" onClick={openWater} className="desk-btn">
            <Droplets className="size-3" /> Open water report
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => window.print()} className="desk-btn desk-btn-primary" title="Print the reports, or save them as a PDF from the print dialog">
          <Printer className="size-3" /> Print / Save as PDF
        </button>
      </div>
      {!marketOpen && !waterOpen && <p className="p-3 text-[11px] text-muted-foreground">Open a report to lay it out here as a document. Both read the layers for the place under the camera.</p>}
      <div className="desk-doc grid grid-cols-1 gap-3 p-2 2xl:grid-cols-2">
        {marketOpen && (
          <div className="desk-section">
            <MarketReportPanel />
          </div>
        )}
        {waterOpen && (
          <div className="desk-section">
            <WaterReportPanel />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Notes

/** Citation shapes for whichever reports are open, built from the same client readers the panels use. */
function openReportCites(): ReportCite[] {
  const st = useGlobe.getState();
  const out: ReportCite[] = [];
  const { lon, lat } = st.view;
  if (st.marketReportOpen) {
    const r = marketReportFromGlobe(lon, lat);
    out.push({
      title: "Market report",
      place: r.area?.name ?? formatLatLon(r.lat, r.lon),
      generatedAt: r.generatedAt,
      sections: [r.home, r.rent, r.jobs, r.trade, r.pulse].map((s) => ({ title: s.title, basis: s.basis, loaded: s.loaded })).concat([{ title: "Affordability", basis: r.affordability.basis, loaded: !!r.affordability.estimate }]),
      caveats: r.caveats,
    });
  }
  if (st.waterReportOpen) {
    const r = reportFromGlobe(lon, lat);
    out.push({
      title: "Community water report",
      place: formatLatLon(r.lat, r.lon),
      generatedAt: r.generatedAt,
      sections: [r.drought, r.reservoirs, r.gauges, r.wells, r.turbidity].map((s) => ({ title: s.title, basis: s.basis, loaded: s.loaded })),
      caveats: r.caveats,
    });
  }
  return out;
}

function NotesTab() {
  const notes = useDesk((s) => s.notes);
  const setNotes = useDesk((s) => s.setNotes);
  const series = useDesk((s) => s.series);
  const copy = () => {
    const md = notesMarkdown({ notes, url: withDeskParam(shareUrl(), "desk"), now: Date.now(), reports: openReportCites(), series });
    navigator.clipboard.writeText(md).then(
      () => useGlobe.getState().pushLog({ level: "info", text: "Notes copied as markdown with the permalink and report sources." }),
      () => useGlobe.getState().pushLog({ level: "warn", text: "Clipboard blocked." }),
    );
  };
  // Keys the cockpit binds (D, comma, Escape) are ignored while typing; the textarea is an input so Cockpit's check covers it.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="desk-noprint flex items-center gap-2 border-b border-border px-2 py-1">
        <button type="button" onClick={copy} className="desk-btn">
          <ClipboardCopy className="size-3" /> Copy as markdown
        </button>
        <span className="text-[10px] text-muted-foreground">includes the permalink and the sources of open reports · saved in this browser</span>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        aria-label="Notes"
        placeholder="What you see, what to check next, who to send it to…"
        className="desk-notes min-h-0 flex-1 resize-none bg-background p-3 text-[12px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
        spellCheck
      />
      <div className="desk-print-only p-3 text-[12px] leading-relaxed whitespace-pre-wrap">{notes}</div>
    </div>
  );
}

/** The tab ids, for the integrator's voice commands ("desk table"). */
export const DESK_TAB_IDS: DeskTab[] = DESK_TABS.map((t) => t.id);
