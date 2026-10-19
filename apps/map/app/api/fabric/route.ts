// Place fabric API: every construct a point sits inside, from the smallest to
// the largest, with the relations the unit systems define between them.
//
//   /api/fabric?op=stack&lon=-97.74&lat=30.27               attributes only
//   /api/fabric?op=stack&lon=-97.74&lat=30.27&geometry=1    plus generalised outlines (the globe layer asks for these)
//   /api/fabric?op=stack&lon=-97.74&lat=30.27&format=csv    one row per construct
//   /api/fabric?op=field&kind=huc8&bbox=-100,28,-94,33      every unit of one kind in a box, with outlines
//   /api/fabric?op=field&pov=hydrologic&h=400000&bbox=...   the kind that emerges for a point of view at a camera height
//   /api/fabric?op=downstream&lon=-97.74&lat=30.27          the HUC-12 chain from the point toward the sea, one time-boxed leg
//   /api/fabric?op=downstream&from=120902050307             the next leg, from a truncated leg's `next`
//   /api/fabric?op=outlines&huc12=120902050306,...          outlines and centroids for up to 100 HUC-12s
//   /api/fabric?op=upstream&lon=-97.74&lat=30.27            the catchment: every HUC-12 that drains to the point's
//                                                           subwatershed, as the smallest cover of whole WBD units
//   /api/fabric?op=units&codes=1209,120902,1209020503       outlines, names and areas of WBD units of any level
//                                                           (up to 100; geometry=0 for names and areas of up to 500)
//   /api/fabric?op=compare&lon=-97.40&lat=27.80&lon2=-97.32&lat2=27.88
//                                                           two stacks and which constructs they share, differ on,
//                                                           or only one of them has (same county, different district)
//
// Upstreams, all keyless and asked in parallel: Census TIGERweb (state,
// county, place, tract, ZCTA, school, congressional and state legislative
// districts, metro area, urban area, tribal land, census division and
// region), USGS Watershed Boundary Dataset (HUC-2 to HUC-12 with the
// downstream HUC), EPA level III/IV ecoregions, FEMA National Flood Hazard
// Layer (zone, community, FIRM panel), NWS (forecast office, zone, time zone),
// USGS 3DEP elevation; plus the bundled Natural Earth country and the bundled
// EPA / FEMA / Federal Reserve regional lists. One failing upstream never
// fails the call: it is listed in `failed` and in the caveats.
//
// The point is snapped to a 0.001° grid (about 100 m) so nearby callers share
// a cache entry; `point` in the payload is the snapped point that was asked.
// Places and public boundaries only; nothing here is about a person.

import type { NextRequest } from "next/server";
import {
  fetchDownstream,
  fetchField,
  fetchUpstream,
  huc12Outlines,
  OUTLINE_BATCH,
  UNITS_BATCH,
  UNITS_BATCH_ATTRS,
  wbdUnits,
  type DownstreamResult,
  type FieldResult,
  type UpstreamResult,
} from "@/lib/fabric/fetch";
import { fetchFabric } from "@/lib/fabric/fetch";
import { clampFieldBbox, FIELD_POVS, FIELD_SPECS, isFieldKind, kindForScale, type BBox, type FieldPov } from "@/lib/fabric/field";
import { FABRIC_COLUMNS, fabricRows } from "@/lib/fabric/graph";
import { compareFabrics, compareSummary } from "@/lib/fabric/compare";
import type { Fabric } from "@/lib/fabric/types";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { cacheDelete, cached } from "@/lib/server/cache";
import { badRequest, csv, notFound, ok, options } from "@/lib/server/respond";
import { jsonError } from "@/lib/server/upstream";

export const maxDuration = 60;

const TTL_S = 6 * 3600;
const OPS = ["stack", "field", "downstream", "outlines", "upstream", "units", "compare"] as const;
const FIELD_TTL_S = 24 * 3600;
const DOWNSTREAM_TTL_S = 7 * 24 * 3600;

export const OPTIONS = options;

function provenanceFor(f: Fabric, retrievedAt: string): Provenance[] {
  const notes: Partial<Record<string, string[]>> = {
    "census-tigerweb": ["tigerWMS_Current: current-vintage legal and statistical boundaries; area is land area"],
    "usgs-wbd": ["area is total area; ToHUC names the downstream HUC-12"],
    "fema-nfhl": ["effective flood zone where FEMA has a digital FIRM; absence of a zone is not a finding of no flood risk"],
    "natural-earth": ["1:110m country outlines bundled with this app; coarse near coasts and borders"],
    "federal-regions": ["assigned by state from published lists; split Reserve-district states are named as split"],
  };
  return f.answered.map((id) => provenance(source(id), { kind: "published", retrievedAt, notes: notes[id] }));
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "stack";
  if (!(OPS as readonly string[]).includes(op)) return badRequest(`unknown op: ${OPS.join(" | ")}`, { op });
  if (op === "field") return field(q);
  if (op === "downstream") return downstream(q);
  if (op === "outlines") return outlines(q);
  if (op === "upstream") return upstreamOp(q);
  if (op === "units") return units(q);
  if (op === "compare") return compare(q);
  const lon = Number(q.get("lon"));
  const lat = Number(q.get("lat"));
  if (!q.get("lon") || !q.get("lat") || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)
    return badRequest("lon and lat are required degrees: /api/fabric?op=stack&lon=-97.74&lat=30.27");
  const geometry = q.get("geometry") === "1" || q.get("geometry") === "true";
  const format = q.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return badRequest("format is json | csv", { format });

  const sLon = Math.round(lon * 1000) / 1000;
  const sLat = Math.round(lat * 1000) / 1000;
  const key = `fabric:${sLon},${sLat}:${geometry ? 1 : 0}`;
  try {
    const r = await cached(key, TTL_S * 1000, () => fetchFabric(sLon, sLat, { geometry }));
    const fabric = r.value;
    // A partial stack is not kept whole: the next caller re-asks only the
    // upstreams that failed (each answer is cached on its own in fetchFabric).
    if (fabric.failed.length) cacheDelete(key);
    const retrievedAt = new Date(Date.now() - r.age).toISOString();
    const prov = provenanceFor(fabric, retrievedAt);
    const caveats = [
      fabric.coverage,
      ...fabric.failed.map((x) => `${x.source} did not answer (${x.error}); its constructs are missing from this stack.`),
      "Relations are only those the unit systems define (GEOID and HUC nesting, OMB metro delineation) or an agency publishes (NWS zone to office, state to federal region). Everything else in the stack shares the point and nothing more is claimed.",
    ];
    if (format === "csv")
      return csv(fabricRows(fabric), { columns: [...FABRIC_COLUMNS], filename: `fabric-${sLon}_${sLat}.csv`, provenance: prov, caveats, ttlS: TTL_S });
    return ok(fabric, {
      provenance: prov,
      caveats,
      ttlS: TTL_S,
      meta: {
        source: fabric.answered.join(", "),
        snapped: { lon: sLon, lat: sLat, grid: 0.001 },
        constructs: fabric.nodes.length,
        cacheAge: r.age,
        globe: `/?lat=${sLat}&lon=${sLon}&h=120000&layers=constructs`,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}

function parsePoint(q: URLSearchParams, lonKey: string, latKey: string): { lon: number; lat: number } | null {
  const lon = Number(q.get(lonKey));
  const lat = Number(q.get(latKey));
  if (!q.get(lonKey) || !q.get(latKey) || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return { lon: Math.round(lon * 1000) / 1000, lat: Math.round(lat * 1000) / 1000 };
}

/** Two stacks side by side: which constructs the places share, which differ, which only one has. Attributes only. */
async function compare(q: URLSearchParams) {
  const a = parsePoint(q, "lon", "lat");
  const b = parsePoint(q, "lon2", "lat2");
  if (!a || !b) return badRequest("lon, lat, lon2 and lat2 are required degrees: /api/fabric?op=compare&lon=-97.40&lat=27.80&lon2=-97.32&lat2=27.88");
  try {
    const [ra, rb] = await Promise.all(
      [a, b].map(async (p) => {
        const key = `fabric:${p.lon},${p.lat}:0`;
        const r = await cached(key, TTL_S * 1000, () => fetchFabric(p.lon, p.lat, { geometry: false }));
        if (r.value.failed.length) cacheDelete(key);
        return r;
      }),
    );
    const c = compareFabrics(ra.value, rb.value);
    const retrievedAt = new Date(Date.now() - Math.max(ra.age, rb.age)).toISOString();
    const failed = [...new Set([...ra.value.failed, ...rb.value.failed].map((x) => x.source))];
    const caveats = [
      "Shared means both stacks hold the same unit (same kind and code). Differs means both hold a unit of that kind but not the same one. A kind only one stack has is reported as only-a / only-b: a published boundary missing at one point is not a difference.",
      ...failed.map((s) => `${s} did not answer for at least one point; its constructs are missing from the comparison, not absent.`),
    ];
    const row = (r: (typeof c.rows)[number]) => ({
      kind: r.kind,
      status: r.status,
      a: r.a ? { id: r.a.id, name: r.a.name, code: r.a.code ?? null, areaKm2: r.a.areaKm2 ?? null } : null,
      b: r.b ? { id: r.b.id, name: r.b.name, code: r.b.code ?? null, areaKm2: r.b.areaKm2 ?? null } : null,
    });
    return ok(
      {
        a: ra.value.point,
        b: rb.value.point,
        summary: compareSummary(c),
        shared: c.shared,
        differs: c.differs,
        meet: c.meet ? { id: c.meet.id, kind: c.meet.kind, name: c.meet.name } : null,
        rows: c.rows.map(row),
      },
      {
        provenance: [...new Set([...ra.value.answered, ...rb.value.answered])].map((id) => provenance(source(id), { kind: "published", retrievedAt })),
        caveats,
        ttlS: TTL_S,
        meta: { source: "fabric", constructs: { a: ra.value.nodes.length, b: rb.value.nodes.length }, globe: `/?lat=${a.lat}&lon=${a.lon}&h=120000&layers=constructs&pin=${a.lat},${a.lon}&cmp=${b.lat},${b.lon}` },
      },
    );
  } catch (err) {
    return jsonError(err);
  }
}

function parseBbox(raw: string | null): BBox | null {
  const b = (raw ?? "").split(",").map(Number);
  if (b.length !== 4 || b.some((x) => !Number.isFinite(x))) return null;
  const [w, so, e, n] = b;
  if (w >= e || so >= n || w < -180 || e > 180 || so < -90 || n > 90) return null;
  return [w, so, e, n];
}

async function field(q: URLSearchParams) {
  const bbox = parseBbox(q.get("bbox"));
  if (!bbox) return badRequest("bbox=west,south,east,north is required, e.g. /api/fabric?op=field&kind=county&bbox=-100,28,-94,33");
  let kind = q.get("kind") ?? "";
  const pov = q.get("pov");
  if (!kind && pov) {
    if (!(FIELD_POVS as readonly string[]).includes(pov)) return badRequest(`pov is ${FIELD_POVS.join(" | ")}`, { pov });
    const h = Number(q.get("h"));
    if (!Number.isFinite(h) || h <= 0) return badRequest("pov needs h, the camera height in metres");
    kind = kindForScale(pov as FieldPov, h);
  }
  if (!isFieldKind(kind)) return badRequest(`kind is ${Object.keys(FIELD_SPECS).join(" | ")} (or pass pov and h)`, { kind });
  const clamped = clampFieldBbox(kind, bbox);
  try {
    const r: FieldResult = await fetchField(kind, clamped);
    const retrievedAt = new Date().toISOString();
    const caveats = [
      `US only. The box was clamped to ${FIELD_SPECS[kind]!.maxSpanDeg} degrees for ${kind} and snapped to a grid; bbox in the payload is what was asked.`,
      "Outlines are generalised for display; do not use them for boundary decisions.",
    ];
    if (r.truncated) caveats.push("The upstream stopped at its record limit; units at the edge of the box may be missing.");
    if (r.units.some((u) => u.facts["area basis"])) caveats.push("Where the upstream publishes no area, areaKm2 is computed from the generalised outline.");
    return ok(r, { provenance: [provenance(source(r.source), { kind: "published", retrievedAt })], caveats, ttlS: FIELD_TTL_S, meta: { source: r.source, kind, units: r.units.length } });
  } catch (err) {
    return jsonError(err);
  }
}

async function downstream(q: URLSearchParams) {
  const from = q.get("from");
  let start: { lon: number; lat: number } | { from: string };
  if (from) {
    if (!/^\d{12}$/.test(from)) return badRequest("from is a 12-digit HUC-12 code (the `next` of a truncated walk)", { from });
    start = { from };
  } else {
    const lon = Number(q.get("lon"));
    const lat = Number(q.get("lat"));
    if (!q.get("lon") || !q.get("lat") || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)
      return badRequest("lon and lat (or from=<HUC-12>) are required: /api/fabric?op=downstream&lon=-97.74&lat=30.27");
    start = { lon: Math.round(lon * 1000) / 1000, lat: Math.round(lat * 1000) / 1000 };
  }
  const key = `fabric-downstream:${"from" in start ? start.from : `${start.lon},${start.lat}`}`;
  try {
    const r = await cached(key, DOWNSTREAM_TTL_S * 1000, () => fetchDownstream(start));
    const d: DownstreamResult | null = r.value;
    if (!d) return notFound("no HUC-12 at this point (outside the US, or water WBD does not cover)", start);
    if (d.truncated) cacheDelete(key);
    const caveats = [
      "The chain follows WBD ToHUC from HUC-12 to HUC-12; it is the watershed sequence, not a traced river line.",
      "Outlines and centroids come from op=outlines, in batches of up to 100 HUC-12 codes.",
    ];
    if (d.truncated) caveats.push(`This leg stopped at its time budget (WBD is slow on a cold basin). Continue with op=downstream&from=${d.next}.`);
    return ok(d, {
      provenance: [provenance(source("usgs-wbd"), { kind: "published", retrievedAt: new Date(Date.now() - r.age).toISOString(), notes: ["ToHUC as published in WBD"] })],
      caveats,
      ttlS: d.truncated ? 0 : DOWNSTREAM_TTL_S,
      meta: { source: "usgs-wbd", hops: d.steps.length, terminal: d.terminal, next: d.next ?? null, cacheAge: r.age },
    });
  } catch (err) {
    return jsonError(err);
  }
}

async function outlines(q: URLSearchParams) {
  const codes = (q.get("huc12") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  if (!codes.length || codes.some((c) => !/^\d{12}$/.test(c)) || codes.length > OUTLINE_BATCH)
    return badRequest(`huc12 is a comma list of 1 to ${OUTLINE_BATCH} twelve-digit codes`);
  try {
    const r = await huc12Outlines(codes);
    return ok(r, {
      provenance: [provenance(source("usgs-wbd"), { kind: "published", retrievedAt: new Date().toISOString(), notes: ["outlines generalised to 0.004 degrees; centroids computed from them"] })],
      caveats: ["Outlines are generalised for display; centroids are computed by Embedding Atlas from the generalised outline."],
      ttlS: DOWNSTREAM_TTL_S,
      meta: { source: "usgs-wbd", units: Object.keys(r.outlines).length },
    });
  } catch (err) {
    return jsonError(err);
  }
}

async function upstreamOp(q: URLSearchParams) {
  const huc12 = q.get("huc12");
  let start: { lon: number; lat: number } | { huc12: string };
  if (huc12) {
    if (!/^\d{12}$/.test(huc12)) return badRequest("huc12 is a 12-digit code", { huc12 });
    start = { huc12 };
  } else {
    const lon = Number(q.get("lon"));
    const lat = Number(q.get("lat"));
    if (!q.get("lon") || !q.get("lat") || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)
      return badRequest("lon and lat (or huc12=<code>) are required: /api/fabric?op=upstream&lon=-97.74&lat=30.27");
    start = { lon: Math.round(lon * 1000) / 1000, lat: Math.round(lat * 1000) / 1000 };
  }
  const key = `fabric-upstream:${"huc12" in start ? start.huc12 : `${start.lon},${start.lat}`}`;
  try {
    const r = await cached(key, DOWNSTREAM_TTL_S * 1000, () => fetchUpstream(start));
    const u: UpstreamResult | null = r.value;
    if (!u) return notFound("no HUC-12 at this point (outside the US, or water WBD does not cover)", start);
    return ok(u, {
      provenance: [
        provenance(source("usgs-wbd"), {
          kind: "estimate",
          retrievedAt: new Date(Date.now() - r.age).toISOString(),
          method: "every HUC-12 whose WBD ToHUC chain reaches the start, from the bundled national table (pulled 2026-09-22); compacted to whole units by code nesting",
        }),
      ],
      caveats: [
        "The catchment drains to the outlet of the subwatershed under the point, not to the point itself.",
        "Built from WBD ToHUC links; areas that WBD marks as draining elsewhere (closed basins, non-contributing playas) are not in it.",
        "Outlines, names and published areas of the cover come from op=units.",
      ],
      ttlS: DOWNSTREAM_TTL_S,
      meta: { source: "usgs-wbd", huc12s: u.huc12s, units: u.cover.length, cacheAge: r.age },
    });
  } catch (err) {
    return jsonError(err);
  }
}

async function units(q: URLSearchParams) {
  const geometry = q.get("geometry") !== "0" && q.get("geometry") !== "false";
  const max = geometry ? UNITS_BATCH : UNITS_BATCH_ATTRS;
  const codes = (q.get("codes") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  if (!codes.length || codes.length > max || codes.some((c) => !/^(\d{2}){1,6}$/.test(c)))
    return badRequest(`codes is a comma list of 1 to ${max} WBD codes of 2, 4, 6, 8, 10 or 12 digits`);
  try {
    const r = await wbdUnits(codes, { geometry });
    return ok(r, {
      provenance: [provenance(source("usgs-wbd"), { kind: "published", retrievedAt: new Date().toISOString(), notes: ["names and areas as published; outlines generalised by level"] })],
      caveats: geometry ? ["Outlines are generalised for display, coarser for bigger units; centroids are computed from them."] : [],
      ttlS: DOWNSTREAM_TTL_S,
      meta: { source: "usgs-wbd", units: Object.keys(r.areas).length },
    });
  } catch (err) {
    return jsonError(err);
  }
}
