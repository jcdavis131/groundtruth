// Soil API: the NRCS SSURGO soil map unit at a point, with its farmland
// classification and the NCCPI crop productivity index of its components,
// through Soil Data Access in two small queries (lib/terrain/soil.ts). CORS
// open, keyless, the shared envelope.
//
//   /api/soil?op=point&lon=-98.45&lat=29.28   map unit (name, symbol, farmland class,
//                                             survey area and the date it was saved)
//                                             + components with NCCPI; the dominant one first
//   /api/soil?op=mapunit&mukey=390497         the components of one map unit, with NCCPI
//
// A soil rating, never a price or a parcel score. A component NRCS did not
// rate says "not rated" (null), never 0; no map unit at a point is an answer
// (data: null), not an error. Answers are cached a day per point (5 decimals)
// and a week per map unit.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError } from "@/lib/server/upstream";
import { badRequest, ok, options, withCors } from "@/lib/server/respond";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { SDA_TABULAR, SOIL_CAVEAT } from "@/lib/terrain/products";
import { isMukey, NCCPI_RULE, nccpiText } from "@/lib/terrain/soil";
import { soilAt, soilComponents } from "@/lib/terrain/sources";

export const maxDuration = 60;
export const OPTIONS = options;

const DAY = 24 * 3600_000;

const NCCPI_CAVEAT = `NCCPI is NRCS's "${NCCPI_RULE}" interpretation, 0 to 1 with NRCS's own class words, shown for the component with the largest share of the map unit; components NRCS did not rate are null ("not rated"), never 0.`;

function numParam(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function opPoint(lon: number, lat: number): Promise<Response> {
  const x = Number(lon.toFixed(5));
  const y = Number(lat.toFixed(5));
  const r = await cached(`soil-point:${x},${y}`, DAY, () => soilAt(x, y));
  const a = r.value;
  const retrievedAt = new Date(Date.now() - r.age).toISOString();
  return ok(a ? { lon: x, lat: y, ...a, nccpi: nccpiText(a.dominant) } : null, {
    meta: { source: "USDA NRCS SSURGO via Soil Data Access", cacheAge: r.age },
    ttlS: 3600,
    provenance: [
      provenance(source("nrcs-ssurgo"), {
        kind: "published",
        seriesId: a ? `mukey ${a.mapUnit.mukey}${a.mapUnit.areaSymbol ? `, survey area ${a.mapUnit.areaSymbol}` : ""}` : "SDA_Get_Mukey_from_intersection_with_WktWgs84",
        upstreamUrl: SDA_TABULAR,
        retrievedAt,
        revision: a?.mapUnit.surveySaved ? `survey area saved ${a.mapUnit.surveySaved}` : undefined,
        notes: ["two Soil Data Access queries: point -> map unit (mapunit, legend, sacatalog), map unit -> components with the NCCPI interpretation (component, cointerp)"],
      }),
    ],
    caveats: a
      ? [SOIL_CAVEAT, NCCPI_CAVEAT, "The farmland classification is NRCS's for the whole map unit, as published."]
      : ["No SSURGO map unit is mapped at this point (open water, outside the survey, or outside the United States)."],
  });
}

async function opMapunit(mukey: string): Promise<Response> {
  const r = await cached(`soil-mapunit:${mukey}`, 7 * DAY, () => soilComponents(mukey));
  const components = r.value;
  return ok(
    { mukey, components, dominant: components[0] ?? null, nccpi: nccpiText(components[0] ?? null) },
    {
      meta: { source: "USDA NRCS SSURGO via Soil Data Access", cacheAge: r.age },
      ttlS: 6 * 3600,
      provenance: [
        provenance(source("nrcs-ssurgo"), { kind: "published", seriesId: `mukey ${mukey}`, upstreamUrl: SDA_TABULAR, retrievedAt: new Date(Date.now() - r.age).toISOString() }),
      ],
      caveats: components.length ? [SOIL_CAVEAT, NCCPI_CAVEAT] : ["SDA returned no components for this map unit key."],
    },
  );
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "point": {
        const lon = numParam(q.get("lon"));
        const lat = numParam(q.get("lat"));
        if (lon == null || lat == null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return badRequest("lon and lat required, e.g. op=point&lon=-98.45&lat=29.28");
        return await opPoint(lon, lat);
      }
      case "mapunit": {
        const mukey = (q.get("mukey") ?? "").trim();
        if (!isMukey(mukey)) return badRequest("mukey required (digits), e.g. op=mapunit&mukey=390497");
        return await opMapunit(mukey);
      }
      default:
        return badRequest("unknown op: point | mapunit");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
