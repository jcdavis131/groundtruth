// Zoning API: the district a city's own zoning GIS puts a point in, and the
// district outlines around a view, for the ten largest-city services wired in
// lib/zoning. CORS open, edge-cached, with the shared envelope
// (lib/server/respond.ts).
//
//   /api/zoning?op=point&lon=..&lat=..    the district at a point: code, the city's own
//                                         description and category, overlays, ordinance,
//                                         effective date, code link. The city comes from
//                                         the Census incorporated place under the point.
//                                         States: district | right-of-way | no-district |
//                                         no-ordinance (Houston) | not-covered.
//   /api/zoning?op=districts&bbox=w,s,e,n district outlines (code and colour family only)
//                                         from every covered city the box meets, box at
//                                         most 0.04 degrees, snapped to 0.0025.
//   /api/zoning?op=coverage               which cities answer points, which draw outlines,
//                                         and why the rest do not.
//
// Zoning maps change by ordinance, a few times a month at most, so answers are
// held for a day and the edge keeps them for an hour.

import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/upstream";
import { badRequest, ok, options, withCors } from "@/lib/server/respond";
import { preferIpv4 } from "@/lib/server/net";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { zoningAt, zoningOutlines, TIGER_PLACES } from "@/lib/zoning/sources";
import { coveredCityNames, ZONING_CITIES, ZONING_CITY_IDS, type Bbox } from "@/lib/zoning/features";
import { numParam, parseBbox } from "@/lib/civic/bbox";
import { CHICAGO_DISCLAIMER } from "@/lib/civic/terms";

export const maxDuration = 60;
export const OPTIONS = options;

preferIpv4();

/** Always said: what a zoning answer from a GIS layer is and is not. */
const ZONING_CAVEAT = "Zoning as each city's GIS publishes it. The adopted zoning map and code govern; this is not a zoning verification letter or a permit.";

async function opPoint(lon: number, lat: number) {
  const a = await zoningAt(lon, lat);
  const r = a.record;
  const caveats = [ZONING_CAVEAT];
  if (r.state === "no-district") caveats.push("No district polygon at the point is not a finding that the land is unzoned: streets, water and gaps in a city's layer have none.");
  if (r.state === "not-covered") caveats.push(`Only ${coveredCityNames()} and Houston (which has no zoning) are wired; everywhere else is not covered, which says nothing about whether zoning applies.`);
  if (r.city === "chicago") caveats.push(CHICAGO_DISCLAIMER);
  if (a.overlaysUnknown) {
    caveats.push("New York's tax-lot lookup and DCP's overlay layers did not answer this time, so the overlays, special districts and limited-height district at this point are unknown (not absent); ask again shortly.");
  } else if (a.lotGap) {
    caveats.push(
      `New York's overlays usually come from the Zoning Tax Lot Database row of the lot under the point; here ${a.lotGap}, so they come from DCP's special purpose district, commercial overlay and limited-height layers at the point.${a.partial ? " Ask again shortly for the lot." : ""}`,
    );
  }
  return ok(r, {
    meta: { source: r.publisher ? `${r.publisher} zoning` : "Census TIGERweb (place only)", state: r.state, partial: a.partial, overlaysUnknown: a.overlaysUnknown, cacheAge: a.age },
    provenance: a.provenance,
    caveats,
    ttlS: a.partial ? 300 : 3600,
  });
}

async function opDistricts(b: Bbox) {
  const a = await zoningOutlines(b);
  const caveats = [
    ZONING_CAVEAT,
    "Only the returned `bbox` was loaded; outside it nothing is loaded. Outlines are generalised on each city's server to about 3 m and carry the district code only: ask op=point for the overlays, ordinance and code link.",
  ];
  if (a.pointOnly.length) caveats.push(`Not drawn as outlines here: ${a.pointOnly.map((p) => `${p.name} (${p.reason})`).join("; ")}.`);
  if (a.failed.length) caveats.push(`Did not answer: ${a.failed.map((f) => f.name).join(", ")}; their districts are missing from this answer, not absent.`);
  if (a.sources.some((s) => s.truncated)) caveats.push("A city's record limit was hit; ask for a smaller box for every district.");
  if (a.sources.some((s) => s.city === "chicago")) caveats.push(CHICAGO_DISCLAIMER);
  return ok(
    { type: "FeatureCollection", features: a.features },
    {
      meta: {
        source: "city zoning services",
        bbox: b,
        sources: a.sources,
        failed: a.failed,
        pointOnly: a.pointOnly,
        truncated: a.sources.some((s) => s.truncated),
        cacheAge: a.age,
      },
      provenance: a.provenance,
      caveats,
      ttlS: a.failed.length ? 300 : 3600,
    },
  );
}

function opCoverage() {
  const cities = ZONING_CITY_IDS.map((id) => {
    const c = ZONING_CITIES[id];
    return {
      id,
      name: c.name,
      state: c.state,
      placeGeoid: c.placeGeoid,
      point: c.source != null,
      outlines: c.polygons,
      zoning: id === "houston" ? "no zoning ordinance" : "zoning ordinance",
      publisher: c.publisher,
      source: c.source ? source(c.source) : null,
      note: c.note ?? null,
    };
  });
  return ok(cities, {
    meta: { source: "Embedding Atlas zoning adapters" },
    provenance: [
      provenance(source("census-tigerweb"), {
        kind: "published",
        seriesId: "tigerWMS_Current layer 28 (incorporated places), which picks the city for a point",
        upstreamUrl: TIGER_PLACES,
        retrievedAt: new Date().toISOString(),
      }),
    ],
    caveats: [ZONING_CAVEAT],
    ttlS: 86_400,
  });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "point": {
        const lon = numParam(q.get("lon"));
        const lat = numParam(q.get("lat"));
        if (lon == null || lat == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return badRequest("lon and lat required, e.g. lon=-122.3325&lat=47.6067");
        return await opPoint(lon, lat);
      }
      case "districts": {
        const b = parseBbox(q.get("bbox"), 0.04, 0.0025);
        if (!b) return badRequest("bbox=w,s,e,n required, west < east and south < north, e.g. bbox=-122.35,47.60,-122.32,47.62");
        return await opDistricts(b);
      }
      case "coverage":
        return opCoverage();
      default:
        return badRequest("unknown op: point | districts | coverage");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
