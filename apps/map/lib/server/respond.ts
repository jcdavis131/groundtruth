// Response helpers shared by the API routes. One place for the envelope
// (`data` + `provenance` + `generatedAt` + caveats), the CORS headers, the
// edge cache-control line and the `format=csv` branch, so a new route gets
// the same behaviour as /api/economy and /api/water by calling three
// functions instead of copying forty lines.
//
// The envelope spreads `meta` at the top level next to `data` (as the two
// existing routes always did) so nothing a script reads today moves.

import { NextResponse } from "next/server";
import { citation, type Provenance } from "@/lib/provenance/types";
import { csvComments, toCsv, type CsvRow } from "./csv";

export { csvCell, csvColumns, csvComments, toCsv, type CsvRow } from "./csv";

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export type ResponseFormat = "json" | "csv";

/** `public, max-age=0, s-maxage=<ttl>, stale-while-revalidate=<ttl>`: browsers revalidate, the edge absorbs repeats. */
export function cacheControl(ttlS: number): string {
  const t = Math.max(0, Math.floor(ttlS));
  return t === 0 ? "no-store" : `public, max-age=0, s-maxage=${t}, stale-while-revalidate=${t}`;
}

export interface OkOptions {
  /** Every upstream the payload was read or computed from. */
  provenance?: Provenance[];
  caveats?: string[];
  /** Edge cache seconds; omit or 0 for no-store. */
  ttlS?: number;
  /** Route-specific top-level fields (`source`, `bbox`, `cacheAge`, ...). Spread beside `data`, so keep them out of the reserved names. */
  meta?: Record<string, unknown>;
  status?: number;
  /** Override the assembly time (tests). */
  generatedAt?: string;
}

/**
 * The JSON envelope: `{ ...meta, data, provenance, generatedAt, caveats? }`
 * with CORS open and the edge cache line for `ttlS`.
 */
export function ok<T>(data: T, opts: OkOptions = {}): NextResponse {
  const body: Record<string, unknown> = { ...(opts.meta ?? {}), data, provenance: opts.provenance ?? [], generatedAt: opts.generatedAt ?? new Date().toISOString() };
  if (opts.caveats?.length) body.caveats = opts.caveats;
  return NextResponse.json(body, {
    status: opts.status ?? 200,
    headers: { ...CORS, "cache-control": cacheControl(opts.ttlS ?? 0) },
  });
}

export interface CsvOptions {
  columns?: string[];
  /** Download name, e.g. "economy-areas.csv"; sent inline so a browser still shows it. */
  filename?: string;
  provenance?: Provenance[];
  caveats?: string[];
  ttlS?: number;
  generatedAt?: string;
  /** Skip the `#` footer (a consumer that cannot strip comments). */
  footer?: boolean;
}

/** The `#` footer lines a CSV carries: one citation per source, the assembly time, caveats. */
export function csvFooterLines(opts: Pick<CsvOptions, "provenance" | "caveats" | "generatedAt">): string[] {
  const lines: string[] = [];
  lines.push(`generated_at: ${opts.generatedAt ?? new Date().toISOString()}`);
  for (const p of opts.provenance ?? []) lines.push(`source: ${citation(p)}`);
  for (const c of opts.caveats ?? []) lines.push(`caveat: ${c}`);
  lines.push("read with pandas: pd.read_csv(url, comment='#')");
  return lines;
}

/** Render rows plus the footer to the text a CSV response carries. */
export function csvDocument(rows: CsvRow[], opts: CsvOptions = {}): string {
  const body = toCsv(rows, opts.columns);
  if (opts.footer === false) return body + "\r\n";
  return body + "\r\n" + csvComments(csvFooterLines(opts)) + "\r\n";
}

/**
 * `text/csv` with a Content-Disposition and the provenance as `#` comment
 * lines after the data (header first, so `pd.read_csv(url, comment="#")` and
 * `csv.DictReader` both work).
 */
export function csv(rows: CsvRow[], opts: CsvOptions = {}): Response {
  const filename = (opts.filename ?? "data.csv").replace(/[^\w.\-]+/g, "_");
  return new Response(csvDocument(rows, opts), {
    status: 200,
    headers: {
      ...CORS,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": cacheControl(opts.ttlS ?? 0),
    },
  });
}

/** 400 with `{ error, details? }`; the message should say what a valid call looks like. */
export function badRequest(message: string, details?: unknown): NextResponse {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status: 400, headers: CORS });
}

/** 404 with the same shape as badRequest, for ids that are well-formed but unknown. */
export function notFound(message: string, details?: unknown): NextResponse {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status: 404, headers: CORS });
}

/** OPTIONS preflight: 204 with the CORS headers. Export as `export const OPTIONS = options;`. */
export function options(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

type FormatSource = Request | URL | URLSearchParams | string | null | undefined;

function paramsOf(src: FormatSource): { params: URLSearchParams; accept: string } {
  if (!src) return { params: new URLSearchParams(), accept: "" };
  if (typeof src === "string") return { params: new URL(src, "http://localhost").searchParams, accept: "" };
  if (src instanceof URLSearchParams) return { params: src, accept: "" };
  if (src instanceof URL) return { params: src.searchParams, accept: "" };
  return { params: new URL(src.url).searchParams, accept: src.headers.get("accept") ?? "" };
}

/**
 * `?format=csv` wins; otherwise an `Accept: text/csv` header; otherwise JSON.
 * Unknown values fall back to JSON rather than 400 so a typo still answers.
 */
export function parseFormat(src: FormatSource): ResponseFormat {
  const { params, accept } = paramsOf(src);
  const f = (params.get("format") ?? "").trim().toLowerCase();
  if (f === "csv") return "csv";
  if (f === "json") return "json";
  if (/\btext\/csv\b/i.test(accept) && !/\bapplication\/json\b/i.test(accept)) return "csv";
  return "json";
}

export function wantsCsv(src: FormatSource): boolean {
  return parseFormat(src) === "csv";
}

/** Copy the CORS headers onto a response built elsewhere (jsonError). */
export function withCors<R extends Response>(res: R): R {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}
