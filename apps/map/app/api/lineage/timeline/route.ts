// GET /api/lineage/timeline (SPEC C4, part of the #9 family for C2.4):
// { years: [{ year, methods: [ids] }] }.
import type { NextRequest } from "next/server";
import { TimelineQuerySchema } from "@/lib/lineage/api-schemas";
import { okJson, parseQuery } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const parsed = parseQuery(req.nextUrl.searchParams, TimelineQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { year_start, year_end, limit } = parsed.data;
  const index = loadLineage();
  const byYear = new Map<number, string[]>();
  for (const m of index.methodsById.values()) {
    if (year_start !== undefined && m.year < year_start) continue;
    if (year_end !== undefined && m.year > year_end) continue;
    const list = byYear.get(m.year) ?? [];
    list.push(m.id);
    byYear.set(m.year, list);
  }
  const years = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, methods]) => ({ year, methods: methods.sort() }));
  // `limit` caps the total method entries across years.
  let remaining = limit;
  const capped = years
    .map((y) => {
      const take = y.methods.slice(0, remaining);
      remaining -= take.length;
      return { year: y.year, methods: take };
    })
    .filter((y) => y.methods.length > 0);
  return okJson({ years: capped }, true);
}
