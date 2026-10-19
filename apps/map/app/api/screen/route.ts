// Screener API: rank and filter every county, state, port, land border
// crossing or country by the published metrics the economy layers carry.
// CORS open and edge-cached like /api/economy, so a notebook can screen the
// whole country in one call.
//
//   GET  /api/screen?kind=county&q=home.yoyPct>5 AND jobs.yoy.emp<0 SORT momentum DESC LIMIT 50
//   GET  /api/screen?kind=port&q=teu.yoyPct<0 SORT teu DESC&format=csv
//   GET  /api/screen?kind=country&q=SORT balance DESC LIMIT 20&pct=1&cols=name,balance,gdp
//   POST /api/screen  { "kind": "county", "query": { "where": [...], "sort": [...], "limit": 50 } }
//   GET  /api/screen?kind=county&fields=1      the field registry for a kind, nothing else
//
// The compact query syntax and the field table are in docs/SCREENER.md.
// Entity sets are assembled in lib/screener/sets.ts from the same cached
// upstream tables the economy route uses (counties without polygons:
// TIGERweb internal points).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/server/upstream";
import type { Enveloped } from "@/lib/provenance/types";
import { ENTITY_KINDS, fieldMeta, isEntityKind, type EntityKind, type FieldMeta } from "@/lib/screener/fields";
import { compileQuery, formatQuery, MAX_QUERY_CHARS, queryFromJson, validateQuery, type ParseResult, type Query, type QueryError } from "@/lib/screener/query";
import { screen, type ScreenResult } from "@/lib/screener/engine";
import { screenCsv } from "@/lib/screener/csv";
import { entitySet } from "@/lib/screener/sets";

export const maxDuration = 60;

const TTL_S = 3600;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/** Response body: the screen result plus the field registry so a client can render headers. */
export type ScreenResponse = Enveloped<ScreenResult & { kind: EntityKind; count: number; query: string }> & { fields: FieldMeta[] };

// ---------------------------------------------------------------- responses

function bad(message: string, errors?: QueryError[], status = 400) {
  return NextResponse.json({ error: message, errors }, { status, headers: CORS });
}

function csvName(kind: EntityKind): string {
  return `gev-screen-${kind}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
}

interface Request_ {
  kind: EntityKind;
  query: Query;
  queryText: string;
  format: "json" | "csv";
  percentiles: boolean;
  columns?: string[];
}

function parseColumns(raw: string | null | undefined, kind: EntityKind): string[] | undefined {
  if (!raw) return undefined;
  const known = new Set(fieldMeta(kind).map((f) => f.key));
  const cols = raw.split(",").map((s) => s.trim()).filter((s) => known.has(s));
  return cols.length ? cols : undefined;
}

async function run(r: Request_) {
  const set = await entitySet(r.kind);
  const result = screen(set.features, r.query, { kind: r.kind, columns: r.columns, percentiles: r.percentiles });
  const fields = fieldMeta(r.kind);
  const headers = { ...CORS, "cache-control": `public, max-age=0, s-maxage=${TTL_S}, stale-while-revalidate=${TTL_S}` };
  if (r.format === "csv") {
    const text = screenCsv(result.rows, fields, set.provenance, { columns: r.columns, percentiles: r.percentiles, retrievedAt: set.assembledAt, query: r.queryText });
    return new Response(text, { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${csvName(r.kind)}"` } });
  }
  const body: ScreenResponse = {
    data: { ...result, kind: r.kind, count: result.rows.length, query: r.queryText },
    fields,
    provenance: set.provenance,
    generatedAt: new Date().toISOString(),
    caveats: [...set.caveats, "Empty values are gaps in the upstream, never imputed; estimates carry their formula in `fields` and `provenance`."],
  };
  return NextResponse.json(body, { headers });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") ?? "";
  if (!isEntityKind(kind)) return bad(`kind must be one of ${ENTITY_KINDS.join(" | ")}`);
  if (q.get("fields") === "1") return NextResponse.json({ kind, fields: fieldMeta(kind) }, { headers: { ...CORS, "cache-control": `public, max-age=0, s-maxage=${TTL_S}` } });
  const text = q.get("q") ?? "";
  if (text.length > MAX_QUERY_CHARS) return bad(`q longer than ${MAX_QUERY_CHARS} characters`, undefined, 413);
  const compiled = compileQuery(text, fieldMeta(kind));
  if (!compiled.ok) return bad("invalid query", compiled.errors);
  try {
    return await run({
      kind,
      query: compiled.query,
      queryText: text,
      format: q.get("format") === "csv" ? "csv" : "json",
      percentiles: q.get("pct") === "1",
      columns: parseColumns(q.get("cols"), kind),
    });
  } catch (err) {
    const res = jsonError(err);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 4 * MAX_QUERY_CHARS) return bad("body too large", undefined, 413);
  let body: { kind?: unknown; query?: unknown; format?: unknown; percentiles?: unknown; columns?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return bad("body must be JSON: { kind, query }");
  }
  const kind = body.kind;
  if (!isEntityKind(kind)) return bad(`kind must be one of ${ENTITY_KINDS.join(" | ")}`);
  const fields = fieldMeta(kind);
  let compiled: ParseResult;
  let queryText: string;
  if (typeof body.query === "string") {
    if (body.query.length > MAX_QUERY_CHARS) return bad(`query longer than ${MAX_QUERY_CHARS} characters`, undefined, 413);
    compiled = compileQuery(body.query, fields);
    queryText = body.query;
  } else {
    const shaped = queryFromJson(body.query ?? {});
    compiled = shaped.ok ? validateQuery(shaped.query, fields) : shaped;
    queryText = compiled.ok ? formatQuery(compiled.query) : "";
  }
  if (!compiled.ok) return bad("invalid query", compiled.errors);
  try {
    return await run({
      kind,
      query: compiled.query,
      queryText,
      format: body.format === "csv" ? "csv" : "json",
      percentiles: body.percentiles === true,
      columns: parseColumns(Array.isArray(body.columns) ? body.columns.map(String).join(",") : typeof body.columns === "string" ? body.columns : null, kind),
    });
  } catch (err) {
    const res = jsonError(err);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }
}
