// Indicators API: named signals with thresholds, built from series the app
// already relays. CORS open and edge-cached like /api/economy.
//
//   /api/indicators?op=list                         registry metadata (no fetches)
//   /api/indicators?op=latest[&ids=a,b][&category=] every indicator evaluated:
//                                                   latest, change, yoy, status,
//                                                   triggered thresholds, sparkline
//   /api/indicators?op=history&id=<id>[&from=&to=&limit=][&format=csv]
//                                                   the series behind one indicator,
//                                                   live upstream merged with what the
//                                                   snapshot store has recorded
//
// Responses are Enveloped<T>: { data, provenance[], generatedAt, caveats? }.
// Unknown ids and categories are a 400 with the list of valid values.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/server/upstream";
import { defaultStore } from "@/lib/series/store";
import type { Provenance } from "@/lib/provenance/types";
import { envelope, historyCsv, parseCategory, parseHistoryParams, parseIds } from "@/lib/indicators/api";
import { INDICATORS } from "@/lib/indicators/registry";
import { getIndicatorHistory, getIndicators } from "@/lib/indicators/service";
import { INDICATOR_CATEGORIES, indicatorMeta } from "@/lib/indicators/types";

export const maxDuration = 60;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function headers(ttlS: number, extra: Record<string, string> = {}) {
  return { ...CORS, "cache-control": `public, max-age=0, s-maxage=${ttlS}, stale-while-revalidate=${ttlS}`, ...extra };
}

function respond(body: unknown, ttlS: number) {
  return NextResponse.json(body, { headers: headers(ttlS) });
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** The store is optional: a read-only filesystem (serverless) must not break the response. */
function storeOrNull() {
  try {
    return process.env.GEV_INDICATORS_NO_STORE === "1" ? undefined : defaultStore();
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "list": {
        const cat = parseCategory(q.get("category"));
        if (!cat.ok) return bad(cat.error);
        const list = INDICATORS.filter((i) => !cat.value || i.category === cat.value).map(indicatorMeta);
        return respond(envelope({ indicators: list, categories: INDICATOR_CATEGORIES }, []), 3600);
      }
      case "latest": {
        const ids = parseIds(q.get("ids"));
        if (!ids.ok) return bad(ids.error);
        const cat = parseCategory(q.get("category"));
        if (!cat.ok) return bad(cat.error);
        const { items, generatedAt } = await getIndicators({ ids: ids.value, category: cat.value, store: storeOrNull() });
        const prov = items.map((i) => i.provenance).filter((p): p is Provenance => !!p);
        const failed = items.filter((i) => i.error).map((i) => `${i.meta.id}: ${i.error}`);
        const caveats = [
          "Thresholds marked (convention) are dashboard conventions, not official levels; every rule prints its citation.",
          ...(failed.length ? [`Upstream did not answer for ${failed.length} indicator(s): ${failed.join("; ")}`] : []),
        ];
        return respond(envelope({ items }, prov, caveats, generatedAt), 900);
      }
      case "history": {
        const p = parseHistoryParams({ id: q.get("id"), from: q.get("from"), to: q.get("to"), limit: q.get("limit"), format: q.get("format") });
        if (!p.ok) return bad(p.error);
        const series = await getIndicatorHistory(p.value.id, { from: p.value.from, to: p.value.to, limit: p.value.limit, store: storeOrNull() });
        if (!series) return NextResponse.json({ error: `no data for ${p.value.id}: upstream did not answer and nothing is recorded` }, { status: 502, headers: CORS });
        if (p.value.format === "csv") {
          return new Response(historyCsv(series), {
            headers: headers(3600, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="indicator-${p.value.id}.csv"` }),
          });
        }
        return respond(envelope(series, [series.provenance]), 3600);
      }
      default:
        return bad("unknown op: list | latest | history");
    }
  } catch (err) {
    const res = jsonError(err);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }
}
