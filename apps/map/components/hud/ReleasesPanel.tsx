"use client";
// Releases panel: what is coming out in the next 30 days, which release of
// each table is loaded, and what moved since the previous one. Reads
// /api/releases; nothing here is computed in the browser beyond formatting.
// Open/closed state and the pinned vintage live in lib/releases/store.ts.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Copy, ExternalLink, FileDown, Pin, PinOff, X } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import { useReleases, isValidVintage, vintageClockMs, type MoverTableId } from "@/lib/releases/store";
import type { VintageRecord } from "@/lib/releases/vintage";
import type { MoverRow, MoversResult } from "@/lib/releases/movers";
import type { Enveloped, Provenance } from "@/lib/provenance/types";
import { citation } from "@/lib/provenance/types";
import { flyTo, flyToSelection } from "@/lib/globe/camera";
import { getRenderer } from "@/lib/globe/registry";
import { setMissionTime } from "@/lib/globe/clock";
import { downloadText } from "@/lib/explore/export";
import { fmtNum, fmtPct } from "@/lib/economy/features";
import { geocode } from "./SearchCommand";

interface CalendarItem {
  id: string;
  sourceId: string;
  seriesId?: string;
  title: string;
  cadence: string;
  rule: string;
  precision: "official" | "approximate";
  window: { earliest: string; latest: string; nominal: string };
  scheduleUrl?: string;
  covers?: string;
  notes?: string;
}
type CalendarData = Enveloped<{ from: string; to: string; count: number; releases: CalendarItem[] }>;
type VintagesData = Enveloped<{ count: number; vintages: VintageRecord[]; failed: string[] }>;
type MoversData = Enveloped<Omit<MoversResult, "provenance">>;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${url}`);
  return j;
}

const TABLES: Array<{ id: MoverTableId; label: string; metrics: Array<[string, string]> }> = [
  { id: "zillow", label: "Home values", metrics: [["zhviCounty", "ZHVI"], ["zoriCounty", "ZORI rent"]] },
  { id: "qcew", label: "Jobs & wages", metrics: [["emp", "jobs yoy"], ["avgWeeklyWage", "wage yoy"], ["estabs", "employers yoy"]] },
  { id: "border", label: "Border", metrics: [["Trucks", "trucks"], ["Personal Vehicles", "cars"], ["Pedestrians", "pedestrians"]] },
  { id: "ports", label: "Ports", metrics: [["container", "TEU"], ["tonnage", "tons"]] },
];

function log(level: "info" | "warn", text: string) {
  useGlobe.getState().pushLog({ level, text });
}

function copy(text: string, ok: string) {
  navigator.clipboard.writeText(text).then(
    () => log("info", ok),
    () => log("warn", `Clipboard blocked. ${text.slice(0, 200)}`),
  );
}

/** Fly to a mover: its own coordinates, a loaded county feature, or a geocode of its name. */
async function goTo(table: MoverTableId, row: MoverRow) {
  if (row.lon != null && row.lat != null) {
    flyTo(row.lon, row.lat, { height: table === "ports" ? 60_000 : 40_000 });
    return;
  }
  for (const layer of ["realestate", "commerce"] as const) {
    const r = getRenderer(layer);
    if (r?.getFeature(row.id)) {
      flyToSelection({ layer, id: row.id });
      return;
    }
  }
  try {
    const hits = await geocode(`${row.name}, United States`);
    const hit = hits[0];
    if (!hit) throw new Error("no hit");
    flyTo(hit.lon, hit.lat, { height: 150_000 });
  } catch {
    log("warn", `Could not place ${row.name}; turn on Home values or Jobs & wages over it and try again.`);
  }
}

function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function Badge({ precision }: { precision: "official" | "approximate" }) {
  return (
    <span
      className="rounded border px-1 text-[8px] uppercase tracking-wide"
      style={precision === "official" ? { borderColor: "var(--primary)", color: "var(--primary)" } : { borderColor: "var(--warn)", color: "var(--warn)" }}
      title={precision === "official" ? "Follows a schedule the publisher posts" : "Inferred from the publisher's usual cadence; the window is the honest answer"}
    >
      {precision === "official" ? "official" : "approx"}
    </span>
  );
}

function CalendarTab() {
  const q = useQuery({ queryKey: ["releases-calendar"], queryFn: () => getJson<CalendarData>("/api/releases?op=calendar"), staleTime: 3600_000 });
  if (q.isLoading) return <p className="px-3 py-2 text-[10px] text-muted-foreground">reading the calendar…</p>;
  if (q.error || !q.data) return <p className="px-3 py-2 text-[10px] text-alert">{q.error instanceof Error ? q.error.message : "calendar unavailable"}</p>;
  const groups = new Map<string, CalendarItem[]>();
  for (const it of q.data.data.releases) {
    const k = it.window.earliest;
    const g = groups.get(k);
    if (g) g.push(it);
    else groups.set(k, [it]);
  }
  return (
    <div className="text-[10px]">
      <p className="px-3 py-1 text-[9px] text-muted-foreground">
        {q.data.data.from} to {q.data.data.to} · {q.data.data.count} windows · grouped by earliest day
      </p>
      {[...groups.entries()].map(([day, items]) => (
        <section key={day} className="border-t border-border/60 px-3 py-1.5">
          <div className="hud-label">{dayLabel(day)}</div>
          <ul className="mt-0.5 space-y-0.5">
            {items.map((it) => (
              <li key={`${it.id}:${it.window.nominal}`} className="grid grid-cols-[1fr_auto] items-start gap-2 leading-tight">
                <span className="min-w-0">
                  <span className="text-foreground/90">{it.title}</span>
                  <span className="text-muted-foreground">
                    {it.window.earliest === it.window.latest ? "" : ` · window to ${dayLabel(it.window.latest)}`}
                    {it.covers ? ` · covers ${it.covers}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Badge precision={it.precision} />
                  {it.scheduleUrl && (
                    <a href={it.scheduleUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Publisher's schedule page" aria-label="Schedule page">
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {q.data.caveats?.map((c) => (
        <p key={c} className="border-t border-border/60 px-3 py-1 text-[9px] leading-snug text-muted-foreground/80">
          {c}
        </p>
      ))}
    </div>
  );
}

function VintagePin() {
  const vintage = useReleases((s) => s.vintage);
  const setVintage = useReleases((s) => s.setVintage);
  const [draft, setDraft] = useState(vintage ?? "");
  const pin = () => {
    if (!isValidVintage(draft)) {
      log("warn", "Vintage must be a real date written YYYY-MM-DD.");
      return;
    }
    setVintage(draft);
    setMissionTime(vintageClockMs(draft));
    log("info", `Vintage pinned to ${draft}. The clock sits on that day and the link carries v=${draft}; history-aware layers will read that release.`);
  };
  return (
    <div className="flex items-center gap-1 border-t border-border/60 px-3 py-1.5 text-[10px]">
      <span className="hud-label">vintage</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="YYYY-MM-DD"
        className="w-24 rounded border border-border bg-transparent px-1 py-0.5 font-mono text-[10px] text-foreground"
        aria-label="Vintage date"
      />
      <button type="button" onClick={pin} className="rounded border border-border px-1.5 py-0.5 hover:bg-accent" title="Pin the data vintage and the clock to this day">
        <Pin className="mr-0.5 inline size-3" />
        pin
      </button>
      {vintage && (
        <button
          type="button"
          onClick={() => {
            setVintage(null);
            setDraft("");
            log("info", "Vintage cleared; the link no longer carries v=.");
          }}
          className="rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-accent"
          title="Clear the vintage"
        >
          <PinOff className="mr-0.5 inline size-3" />
          clear
        </button>
      )}
      <span className="ml-auto text-[9px] text-muted-foreground">{vintage ? `VINTAGE ${vintage}` : "latest"}</span>
    </div>
  );
}

function VintagesTab() {
  const q = useQuery({ queryKey: ["releases-vintages"], queryFn: () => getJson<VintagesData>("/api/releases?op=vintages"), staleTime: 1800_000 });
  return (
    <div className="text-[10px]">
      <VintagePin />
      {q.isLoading && <p className="px-3 py-2 text-muted-foreground">reading every table (first call can take a while)…</p>}
      {q.error && <p className="px-3 py-2 text-alert">{q.error instanceof Error ? q.error.message : "vintages unavailable"}</p>}
      {q.data && (
        <ul>
          {q.data.data.vintages.map((v) => (
            <li key={v.id} className="border-t border-border/60 px-3 py-1.5 leading-tight">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <span className="text-foreground/90">{v.title}</span>
                {v.precision && <Badge precision={v.precision} />}
              </div>
              <div className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 text-muted-foreground">
                <span>period</span>
                <span className="tabular-nums text-foreground/80">{v.period ?? "unknown"}{v.maybeStale ? <span className="ml-1 text-warn">newer release likely</span> : null}</span>
                <span>released</span>
                <span className="tabular-nums">
                  {v.releasedAt ?? (v.releaseWindow ? (v.releaseWindow.earliest === v.releaseWindow.latest ? v.releaseWindow.earliest : `${v.releaseWindow.earliest} to ${v.releaseWindow.latest}`) : "unknown")}
                  {v.basis === "rule" ? " (inferred)" : ""}
                </span>
                <span>retrieved</span>
                <span className="tabular-nums">{v.retrievedAt.slice(0, 16).replace("T", " ")}Z</span>
                {v.nextWindow && (
                  <>
                    <span>next</span>
                    <span className="tabular-nums">{v.nextWindow.earliest === v.nextWindow.latest ? v.nextWindow.earliest : `${v.nextWindow.earliest} to ${v.nextWindow.latest}`}</span>
                  </>
                )}
              </div>
            </li>
          ))}
          {q.data.data.failed.length > 0 && <li className="border-t border-border/60 px-3 py-1 text-[9px] text-warn">did not answer: {q.data.data.failed.join(", ")}</li>}
        </ul>
      )}
    </div>
  );
}

function MoverList({ table, rows, unit, color }: { table: MoverTableId; rows: MoverRow[]; unit: string; color: string }) {
  if (!rows.length) return <p className="px-3 py-1 text-[9px] text-muted-foreground">nothing to rank</p>;
  return (
    <ul className="space-y-0.5 px-3">
      {rows.map((r, i) => (
        <li key={r.id}>
          <button type="button" onClick={() => void goTo(table, r)} className="grid w-full grid-cols-[1.2em_1fr_auto_auto] items-baseline gap-1.5 text-left text-[10px] leading-tight hover:bg-accent" title={`${r.name}: ${r.before ?? "?"} → ${r.after ?? "?"} ${unit}. Fly there`}>
            <span className="text-muted-foreground">{i + 1}</span>
            <span className="truncate text-foreground/90">{r.name}</span>
            <span className="tabular-nums text-muted-foreground">{r.after != null ? fmtNum(r.after) : ""}</span>
            <span className="tabular-nums" style={{ color }}>
              {fmtPct(r.changePct)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MoversTab() {
  const table = useReleases((s) => s.moverTable);
  const setTable = useReleases((s) => s.setMoverTable);
  const spec = TABLES.find((t) => t.id === table) ?? TABLES[0];
  const [metric, setMetric] = useState<string>(spec.metrics[0][0]);
  const effMetric = spec.metrics.some((m) => m[0] === metric) ? metric : spec.metrics[0][0];
  const n = 10;
  const url = `/api/releases?op=movers&table=${table}&metric=${encodeURIComponent(effMetric)}&n=${n}`;
  const q = useQuery({ queryKey: ["releases-movers", table, effMetric, n], queryFn: () => getJson<MoversData>(url), staleTime: 1800_000 });
  const prov: Provenance | undefined = q.data?.provenance[0];
  return (
    <div className="text-[10px]">
      <div className="flex flex-wrap items-center gap-1 border-t border-border/60 px-3 py-1.5">
        {TABLES.map((t) => (
          <button key={t.id} type="button" onClick={() => setTable(t.id)} className={`rounded border px-1.5 py-0.5 ${t.id === table ? "border-primary text-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
            {t.label}
          </button>
        ))}
        <span className="mx-1 text-muted-foreground">·</span>
        {spec.metrics.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setMetric(id)} className={`rounded border px-1.5 py-0.5 ${id === effMetric ? "border-primary text-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
            {label}
          </button>
        ))}
      </div>
      {q.isLoading && <p className="px-3 py-2 text-muted-foreground">ranking…</p>}
      {q.error && <p className="px-3 py-2 text-alert">{q.error instanceof Error ? q.error.message : "movers unavailable"}</p>}
      {q.data && (
        <>
          <p className="px-3 py-1 text-[9px] text-muted-foreground">
            {q.data.data.previousPeriod ?? "?"} → {q.data.data.period} · {q.data.data.compared} compared, {q.data.data.skipped} skipped · {q.data.data.unit}
            {q.data.data.signFlips ? ` · yoy sign flips: ${q.data.data.signFlips.toPositive} to +, ${q.data.data.signFlips.toNegative} to −` : ""}
          </p>
          <div className="hud-label px-3 pt-1">up</div>
          <MoverList table={table} rows={q.data.data.up} unit={q.data.data.unit} color="var(--primary)" />
          <div className="hud-label px-3 pt-1.5">down</div>
          <MoverList table={table} rows={q.data.data.down} unit={q.data.data.unit} color="#60A5FA" />
          <div className="flex items-center gap-1 border-t border-border/60 px-3 py-1.5">
            <button
              type="button"
              onClick={() => prov && copy(citation(prov), "Citation copied.")}
              className="rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Copy a citation line for these values"
            >
              <Copy className="mr-0.5 inline size-3" />
              Copy citation
            </button>
            <button
              type="button"
              onClick={() => fetch(`${url}&format=csv`).then((r) => r.text()).then((t) => downloadText(`movers-${table}-${effMetric}.csv`, t, "text/csv"))}
              className="rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Download these rows as CSV"
            >
              <FileDown className="mr-0.5 inline size-3" />
              CSV
            </button>
          </div>
          {q.data.caveats?.map((c) => (
            <p key={c} className="px-3 pb-1 text-[9px] leading-snug text-muted-foreground/80">
              {c}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

const TABS: Array<{ id: "calendar" | "vintages" | "movers"; label: string }> = [
  { id: "calendar", label: "Calendar" },
  { id: "vintages", label: "Vintages" },
  { id: "movers", label: "Movers" },
];

export default function ReleasesPanel() {
  const open = useReleases((s) => s.releasesOpen);
  const setOpen = useReleases((s) => s.setReleasesOpen);
  const tab = useReleases((s) => s.tab);
  const setTab = useReleases((s) => s.setTab);
  const vintage = useReleases((s) => s.vintage);
  if (!open) return null;
  return (
    <div className="hud-panel pointer-events-auto flex max-h-[min(62vh,720px)] flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: "#F5B849" }}>
            <CalendarDays className="mr-1 inline size-3" />
            Releases
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">{vintage ? `VINTAGE ${vintage}` : "latest releases"}</div>
          <div className="text-[9px] text-muted-foreground">what is due, what is loaded, what moved · published values, arithmetic shown</div>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close releases panel" title="Close">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex gap-1 border-b border-border px-3 py-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`rounded px-2 py-0.5 text-[10px] ${tab === t.id ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 overflow-y-auto">
        {tab === "calendar" && <CalendarTab />}
        {tab === "vintages" && <VintagesTab />}
        {tab === "movers" && <MoversTab />}
      </div>
    </div>
  );
}
