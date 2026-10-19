// A table. A plain, semantic, twenty-row table.
//
// Not components/hud/DataTable.tsx, which is virtualised, driven by a
// ResizeObserver, keyed on the globe's Row/LayerId model and calls
// useGlobe.getState().pushLog on selection. None of that survives a server
// render and none of it is wanted on a page whose whole promise is that it
// ships no application JavaScript. The .desk-grid class is here for the
// existing line-height and print rules in app/globals.css, which already
// repeat the header on every printed page and keep rows from breaking.
//
// A cell is either a string or a link, because on the state and metro pages
// the table IS the internal link graph — the analyst's reason to visit and
// the crawler's path to the next place are the same rows.

import Link from "next/link";

export interface FactColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export type FactCell = string | { text: string; href?: string; sub?: string; title?: string };

export interface FactRow {
  key: string;
  /** One entry per column, in column order. */
  cells: FactCell[];
}

export interface FactTableProps {
  columns: FactColumn[];
  rows: FactRow[];
  /** Says what the table is and where the rows came from. Always rendered. */
  caption: string;
}

function align(c: FactColumn): string {
  return c.align === "right" ? "text-right tabular-nums" : "text-left";
}

function Cell({ cell }: { cell: FactCell }) {
  if (typeof cell === "string") return <>{cell}</>;
  return (
    <>
      {cell.href ? (
        <Link href={cell.href} className="text-primary underline" title={cell.title}>
          {cell.text}
        </Link>
      ) : (
        <span title={cell.title}>{cell.text}</span>
      )}
      {cell.sub ? <span className="text-muted-foreground"> {cell.sub}</span> : null}
    </>
  );
}

export default function FactTable({ columns, rows, caption }: FactTableProps) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="desk-grid w-full border-collapse text-[14px]">
        <caption className="caption-bottom pt-2 text-left text-[13px] leading-relaxed text-muted-foreground">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-2 py-1.5 font-semibold text-muted-foreground ${align(c)}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/60">
              {columns.map((c, i) => (
                <td key={c.key} className={`px-2 py-1.5 align-top ${align(c)}`}>
                  <Cell cell={r.cells[i] ?? ""} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
