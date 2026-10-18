"use client";
// Dense, generic data table for desk mode: windowed rows, sortable headers
// with units, a sticky header, text filter, CSV download and TSV-to-clipboard
// for spreadsheets. The logic lives in lib/desk/table.ts; this file is layout
// and events only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardCopy, FileDown } from "lucide-react";
import { downloadText } from "@/lib/explore/export";
import { useGlobe } from "@/lib/store/globe";
import { filterRows, fmtCell, nextSort, sortRows, toCsv, toTsv, windowRows, type Column, type Row, type SortState } from "@/lib/desk/table";

interface Props {
  columns: Column[];
  rows: Row[];
  /** File stem for the CSV download; a timestamp is appended. */
  filename?: string;
  rowHeight?: number;
  onRowClick?: (row: Row) => void;
  /** Row key to highlight (the globe selection). */
  selectedKey?: string | null;
  emptyText?: string;
  /** Extra toolbar content on the left (layer chips, for example). */
  toolbar?: React.ReactNode;
  ariaLabel?: string;
}

/** Print every row (up to a cap) instead of the window; browsers fire beforeprint before laying out the page. */
const PRINT_ROW_CAP = 2000;

export default function DataTable({ columns, rows, filename = "table", rowHeight = 24, onRowClick, selectedKey, emptyText = "Nothing loaded.", toolbar, ariaLabel = "Data table" }: Props) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);
  const [printing, setPrinting] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const on = () => setPrinting(true);
    const off = () => setPrinting(false);
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
    };
  }, []);

  const visible = useMemo(() => sortRows(filterRows(rows, query), sort, columns), [rows, query, sort, columns]);
  const win = useMemo(
    () => (printing ? { start: 0, end: Math.min(visible.length, PRINT_ROW_CAP), padTop: 0, padBottom: 0 } : windowRows(visible.length, scrollTop, rowHeight, viewport)),
    [printing, visible.length, scrollTop, rowHeight, viewport],
  );

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop), []);

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const exportCsv = () => downloadText(`${filename}-${stamp()}.csv`, toCsv(columns, visible), "text/csv");
  const copyTsv = () => {
    navigator.clipboard.writeText(toTsv(columns, visible)).then(
      () => useGlobe.getState().pushLog({ level: "info", text: `${visible.length} rows copied as TSV; paste into a spreadsheet.` }),
      () => useGlobe.getState().pushLog({ level: "warn", text: "Clipboard blocked." }),
    );
  };

  return (
    <div className="desk-table flex min-h-0 flex-1 flex-col">
      <div className="desk-noprint flex flex-wrap items-center gap-2 border-b border-border px-2 py-1">
        {toolbar}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows"
          aria-label="Filter rows"
          className="h-6 min-w-[120px] flex-1 rounded border border-border bg-card px-2 text-[11px] text-foreground placeholder:text-muted-foreground"
        />
        <span className="text-[10px] tabular-nums text-muted-foreground" aria-live="polite">
          {visible.length.toLocaleString()} / {rows.length.toLocaleString()} rows
        </span>
        <button type="button" onClick={copyTsv} disabled={visible.length === 0} className="desk-btn" title="Copy as tab-separated text for Excel / Sheets">
          <ClipboardCopy className="size-3" /> TSV
        </button>
        <button type="button" onClick={exportCsv} disabled={visible.length === 0} className="desk-btn" title="Download the filtered rows as CSV">
          <FileDown className="size-3" /> CSV
        </button>
      </div>
      <div ref={scroller} onScroll={onScroll} className="desk-scroll min-h-0 flex-1 overflow-auto" role="region" aria-label={ariaLabel} tabIndex={0}>
        {visible.length === 0 ? (
          <p className="p-3 text-[11px] text-muted-foreground">{rows.length === 0 ? emptyText : "No rows match the filter."}</p>
        ) : (
          <table className="desk-grid w-full border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"} className={`border-b border-border px-2 py-1 text-left font-semibold text-foreground ${c.kind === "number" ? "text-right" : ""}`}>
                      <button type="button" onClick={() => setSort((s) => nextSort(s, c.key))} className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap hover:text-primary ${c.kind === "number" ? "flex-row-reverse" : ""}`} title={`Sort by ${c.label}`}>
                        <span className="truncate">{c.label}</span>
                        {c.unit && <span className="font-normal text-muted-foreground">({c.unit})</span>}
                        {active && (sort!.dir === "asc" ? <ArrowUp className="size-3 shrink-0" aria-hidden /> : <ArrowDown className="size-3 shrink-0" aria-hidden />)}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {win.padTop > 0 && (
                <tr aria-hidden style={{ height: win.padTop }}>
                  <td colSpan={columns.length} />
                </tr>
              )}
              {visible.slice(win.start, win.end).map((r) => {
                const selected = selectedKey === r.key;
                return (
                  <tr
                    key={r.key}
                    style={{ height: rowHeight }}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(r)) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-selected={onRowClick ? selected : undefined}
                    className={`${onRowClick ? "cursor-pointer" : ""} ${selected ? "bg-accent" : "odd:bg-muted/40 hover:bg-accent/60"}`}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={`max-w-[240px] truncate whitespace-nowrap border-b border-border/50 px-2 ${c.kind === "number" ? "text-right tabular-nums" : ""}`} title={r.cells[c.key] == null ? undefined : String(r.cells[c.key])}>
                        {fmtCell(r.cells[c.key] ?? null, c.kind)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {win.padBottom > 0 && (
                <tr aria-hidden style={{ height: win.padBottom }}>
                  <td colSpan={columns.length} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
