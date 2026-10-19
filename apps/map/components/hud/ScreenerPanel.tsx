"use client";
// Screener: rank and filter every county, state, port, border crossing or
// country by published metrics, then fly to a row. The server does the
// screen (/api/screen); this panel only renders, re-sorts locally and
// exports what it was given. Opened from the top bar or by ?screen=kind:q.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileDown, Link2, ListFilter, Play, Table2, X } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import { flyTo } from "@/lib/globe/camera";
import { getRenderer } from "@/lib/globe/registry";
import { downloadText } from "@/lib/explore/export";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/economy/features";
import { ENTITY_HEIGHT, ENTITY_KINDS, ENTITY_LAYERS, type EntityKind, type FieldMeta, type FieldValue } from "@/lib/screener/fields";
import { sortRows, type ScreenRow } from "@/lib/screener/engine";
import { screenCsv } from "@/lib/screener/csv";
import { formatScreenParam, parseScreenParam, useScreener } from "@/lib/screener/store";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ScreenPreset {
  label: string;
  kind: EntityKind;
  query: string;
}

/** Six starting points; each is plain query text the user can edit. */
export const SCREEN_PRESETS: ScreenPreset[] = [
  { label: "Rents rising, jobs falling", kind: "county", query: "rent.yoyPct > 0 AND jobs.yoy.emp < 0 SORT rent.yoyPct DESC LIMIT 50" },
  { label: "Cheapest price-to-rent", kind: "county", query: "priceToRent > 0 SORT priceToRent ASC LIMIT 50" },
  { label: "Hottest momentum", kind: "county", query: "jobs.emp >= 20000 SORT momentum DESC LIMIT 50" },
  { label: "Busiest crossings by trucks", kind: "crossing", query: "trucks > 0 SORT trucks DESC LIMIT 50" },
  { label: "Ports losing TEU", kind: "port", query: "teu.yoyPct < 0 SORT teu DESC LIMIT 50" },
  { label: "Trade surplus countries", kind: "country", query: "balance > 0 SORT balance DESC LIMIT 50" },
];

const KIND_LABEL: Record<EntityKind, string> = { county: "Counties", state: "States", port: "Ports", crossing: "Border crossings", country: "Countries" };

function fmtCell(v: FieldValue, f: FieldMeta | undefined): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (!f) return fmtNum(v, 2);
  if (f.unit === "%") return fmtPct(v);
  if (f.unit.startsWith("USD")) return fmtUsd(v);
  if (Math.abs(v) < 100 && !Number.isInteger(v)) return v.toFixed(2);
  return fmtNum(v);
}

/** Fly to the row and select the matching feature on whichever of its layers is loaded. */
function goToRow(row: ScreenRow) {
  const g = useGlobe.getState();
  flyTo(row.geo[0], row.geo[1], { height: ENTITY_HEIGHT[row.kind] });
  for (const layer of ENTITY_LAYERS[row.kind]) {
    if (!g.layers[layer]) continue;
    const f = getRenderer(layer)?.getFeature(row.id);
    if (f) {
      g.select({ layer, id: row.id }, f);
      return;
    }
  }
  g.pushLog({ level: "info", text: `${row.name}: turn on ${ENTITY_LAYERS[row.kind].join(" or ")} to select it on the globe.` });
}

export default function ScreenerPanel() {
  const s = useScreener();
  const [allColumns, setAllColumns] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ?screen=kind:query opens the panel with that screen already run.
  useEffect(() => {
    const p = parseScreenParam(new URLSearchParams(window.location.search).get("screen"));
    if (!p) return;
    useScreener.getState().setOpen(true);
    void useScreener.getState().runScreen(p);
  }, []);

  const byKey = useMemo(() => new Map(s.fields.map((f) => [f.key, f])), [s.fields]);
  const columns = useMemo(() => {
    if (!s.fields.length) return [];
    if (allColumns) return s.fields.map((f) => f.key);
    const keys = s.fields.filter((f) => f.headline).map((f) => f.key);
    for (const k of s.fieldsUsed) if (!keys.includes(k) && byKey.has(k)) keys.push(k);
    return keys;
  }, [s.fields, s.fieldsUsed, allColumns, byKey]);
  const rows = useMemo(() => (s.sort ? sortRows(s.rows, [s.sort]) : s.rows), [s.rows, s.sort]);
  const stale = s.ranKind !== null && (s.ranKind !== s.kind || s.ranQuery !== s.queryText);

  if (!s.open) return null;

  const run = () => void s.runScreen();
  const clickHeader = (key: string) => {
    if (s.sort?.field === key) s.setSort(s.sort.dir === "desc" ? { field: key, dir: "asc" } : null);
    else s.setSort({ field: key, dir: byKey.get(key)?.kind === "string" ? "asc" : "desc" });
  };
  const exportCsv = () => {
    if (!rows.length) {
      useGlobe.getState().pushLog({ level: "warn", text: "Nothing to export; run a screen first." });
      return;
    }
    const text = screenCsv(rows, s.fields, s.provenance, { retrievedAt: s.generatedAt ?? undefined, query: s.ranQuery ?? undefined });
    downloadText(`gev-screen-${s.ranKind}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`, text, "text/csv");
  };
  const copyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("screen", formatScreenParam(s.kind, s.queryText));
    navigator.clipboard.writeText(url.toString()).then(
      () => useGlobe.getState().pushLog({ level: "info", text: "Screen link copied." }),
      () => useGlobe.getState().pushLog({ level: "warn", text: "Clipboard blocked." }),
    );
  };
  const insertField = (key: string) => {
    const el = inputRef.current;
    const cur = s.queryText;
    const at = el?.selectionStart ?? cur.length;
    const next = `${cur.slice(0, at)}${cur.length && at > 0 && cur[at - 1] !== " " ? " " : ""}${key}${cur.slice(at)}`;
    s.setQueryText(next);
    requestAnimationFrame(() => el?.focus());
  };

  return (
    <div className="hud-panel pointer-events-auto flex max-h-[min(70vh,760px)] w-[min(760px,calc(100vw-24px))] flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: "#F472B6" }}>
            <Table2 className="mr-1 inline size-3" />
            Screener
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">
            {s.ranKind ? `${KIND_LABEL[s.ranKind]} · ${s.total.toLocaleString()} match${s.total === 1 ? "" : "es"}` : "rank and filter by published metrics"}
          </div>
          <div className="text-[9px] text-muted-foreground">
            {s.ranKind ? `showing ${rows.length} · ${s.generatedAt ? `assembled ${s.generatedAt.slice(0, 16).replace("T", " ")}Z` : ""}` : "counties, states, ports, crossings, countries · click a row to fly there"}
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button type="button" onClick={exportCsv} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Export CSV" title="Export CSV with provenance footer">
            <FileDown className="size-3.5" />
          </button>
          <button type="button" onClick={copyLink} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Copy link to this screen" title="Copy link to this screen">
            <Link2 className="size-3.5" />
          </button>
          <button type="button" onClick={() => s.setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2">
        <select
          value={s.kind}
          onChange={(e) => s.setKind(e.target.value as EntityKind)}
          className="h-7 rounded border border-border bg-transparent px-1.5 text-[11px] text-foreground"
          aria-label="Entity kind"
        >
          {ENTITY_KINDS.map((k) => (
            <option key={k} value={k} className="bg-background">
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input
          ref={inputRef}
          value={s.queryText}
          onChange={(e) => s.setQueryText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder="home.yoyPct > 5 AND jobs.yoy.emp < 0 SORT momentum DESC LIMIT 50"
          spellCheck={false}
          className="h-7 min-w-[200px] flex-1 rounded border border-border bg-transparent px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60"
          aria-label="Screen query"
        />
        <Popover>
          <PopoverTrigger className="flex h-7 items-center gap-1 rounded border border-border px-2 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Fields" title="Fields available for this kind">
            <ListFilter className="size-3" /> fields
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[50vh] w-[360px] overflow-y-auto bg-background/95 p-2 text-[10px]">
            <FieldList kind={s.kind} loaded={s.ranKind === s.kind ? s.fields : null} onPick={insertField} />
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={run}
          disabled={s.loading}
          className="flex h-7 items-center gap-1 rounded border border-primary/60 px-2 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-50"
          title="Run (Enter)"
        >
          <Play className="size-3" /> {s.loading ? "running…" : "run"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border/60 px-3 py-1.5">
        {SCREEN_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => void s.runScreen({ kind: p.kind, queryText: p.query })}
            className="rounded border border-border/70 px-1.5 py-0.5 text-[9px] text-muted-foreground hover:border-primary/60 hover:text-foreground"
            title={`${KIND_LABEL[p.kind]}: ${p.query}`}
          >
            {p.label}
          </button>
        ))}
        {s.fields.length > 0 && (
          <label className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
            <input type="checkbox" checked={allColumns} onChange={(e) => setAllColumns(e.target.checked)} /> all columns
          </label>
        )}
      </div>

      {s.error && (
        <div className="border-b border-border/60 px-3 py-2 text-[10px] leading-snug text-alert">
          {s.error}
          {s.errors.map((e, i) => (
            <div key={i} className="text-warn">
              · {e.message}
              {e.position != null ? ` (at character ${e.position + 1})` : ""}
            </div>
          ))}
        </div>
      )}
      {stale && !s.loading && <div className="px-3 py-1 text-[9px] text-warn">Query changed since the last run; press Enter or run.</div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {s.loading && <div className="px-3 py-4 text-[11px] text-muted-foreground">screening every {KIND_LABEL[s.kind].toLowerCase()}…</div>}
        {!s.loading && s.ranKind && rows.length === 0 && !s.error && <div className="px-3 py-4 text-[11px] text-muted-foreground">No {KIND_LABEL[s.ranKind].toLowerCase()} match. Loosen a condition or check the fields list.</div>}
        {!s.loading && rows.length > 0 && (
          <table className="w-full border-collapse text-[10px] leading-tight">
            <thead className="sticky top-0 z-10 bg-[rgba(6,14,18,0.96)]">
              <tr>
                <th className="px-2 py-1 text-left font-normal text-muted-foreground">#</th>
                {columns.map((k) => {
                  const f = byKey.get(k);
                  const active = s.sort?.field === k;
                  return (
                    <th key={k} className="whitespace-nowrap px-2 py-1 text-left font-normal">
                      <button type="button" onClick={() => clickHeader(k)} className={`inline-flex items-center gap-0.5 ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`} title={f ? `${f.label}${f.unit ? ` (${f.unit})` : ""}${f.kind === "estimate" ? ` · estimate: ${f.method}` : ""}` : k}>
                        {k}
                        {f?.kind === "estimate" && <span className="text-warn">*</span>}
                        {active && (s.sort!.dir === "desc" ? <ArrowDown className="size-2.5" /> : <ArrowUp className="size-2.5" />)}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  onClick={() => {
                    s.selectRow(r.id);
                    goToRow(r);
                  }}
                  className={`cursor-pointer border-t border-border/40 hover:bg-accent ${s.selectedId === r.id ? "bg-primary/10" : ""}`}
                  title={`${r.name} · fly to ${r.geo[1].toFixed(3)}, ${r.geo[0].toFixed(3)}`}
                >
                  <td className="px-2 py-0.5 tabular-nums text-muted-foreground">{i + 1}</td>
                  {columns.map((k) => {
                    const f = byKey.get(k);
                    const v = r.values[k];
                    return (
                      <td key={k} className={`whitespace-nowrap px-2 py-0.5 ${typeof v === "number" ? "text-right tabular-nums" : ""} ${v == null ? "text-muted-foreground/50" : ""}`}>
                        {fmtCell(v ?? null, f)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-border/60 px-3 py-1.5 text-[9px] leading-snug text-muted-foreground/80">
        {s.caveats.length > 0 ? s.caveats.map((c) => <p key={c}>· {c}</p>) : <p>· Syntax: field op value, AND / OR, parentheses, BETWEEN, IN (…), CONTAINS, SORT field DESC, LIMIT n. Fields marked * are estimates with their formula in the header tooltip.</p>}
      </div>
    </div>
  );
}

function FieldList({ kind, loaded, onPick }: { kind: EntityKind; loaded: FieldMeta[] | null; onPick: (key: string) => void }) {
  // The registry for a kind the panel has not screened yet comes from the route's fields=1 op.
  const [fetched, setFetched] = useState<{ kind: EntityKind; fields: FieldMeta[] } | null>(null);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    fetch(`/api/screen?kind=${kind}&fields=1`)
      .then((r) => r.json())
      .then((j: { fields?: FieldMeta[] }) => {
        if (live && j.fields) setFetched({ kind, fields: j.fields });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [kind, loaded]);
  const fields = loaded ?? (fetched?.kind === kind ? fetched.fields : []);
  if (!fields.length) return <div className="text-muted-foreground">loading fields…</div>;
  return (
    <ul className="space-y-0.5">
      {fields.map((f) => (
        <li key={f.key}>
          <button type="button" onClick={() => onPick(f.key)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 text-left hover:bg-accent" title={f.kind === "estimate" ? `estimate: ${f.method}` : `${f.source} · ${f.kind}`}>
            <span className="truncate">
              <span className="font-mono text-foreground">{f.key}</span>
              <span className="text-muted-foreground"> · {f.label}</span>
              {f.kind === "estimate" && <span className="text-warn"> *</span>}
            </span>
            <span className="text-muted-foreground">{f.unit}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
