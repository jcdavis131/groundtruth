// Server-side fetchers for /api/permits. Only the route imports this file.
//
//   buildingPermits   permits issued in the last N days in a box, from every wired
//                     city portal the box meets, newest first, 500 per city at most;
//                     each city's answer cached 30 minutes (Los Angeles, weekly, 6 h)
//   licences          licensed premises in a box from five registries; 1 h (LA 6 h)
//   environmental     EPA ECHO NPDES and air facilities (two steps: a query id,
//                     then its rows; the rows are cached, never the id) and the
//                     Corps' ORM actions in a box (the search pads its answer
//                     with actions from elsewhere; only the box's are kept); 6 h
//   contaminants      EPA EMEF Superfund (SEMS), TRI, RCRA and Brownfields listings in
//                     a box, 1,000 per program at most; 6 h. With polygons, EPA's
//                     Superfund site boundaries (1 day). Every Superfund point and
//                     boundary is joined by EPA ID to EPA's NPL status list (1 day).
//                     USACE's Formerly Used Defense Sites: property points and their
//                     projects, and with polygons property boundaries and munitions
//                     response sites (1 day each)
//
// Every request goes through lib/civic/request.ts (a gate per host, ten
// minutes off after a 429 or a 503). A city that fails is named in
// `coverage` as "error", never left out.

import { cached } from "@/lib/server/cache";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { civicJson, runRows } from "@/lib/civic/request";
import type { Bbox } from "@/lib/zoning/features";
import {
  answeredState,
  buildPermits,
  PERMIT_CITIES,
  permitCitiesInBox,
  permitGapsInBox,
  permitRequest,
  permitRequestUrl,
  PERMIT_LIMIT,
  type CoverageState,
  type PermitCityId,
  type PermitRecord,
} from "./features";
import { buildLicences, LICENCE_LIMIT, LICENCE_SOURCES, licenceRequestUrl, licenceSourcesInBox, type LicenceRecord, type LicenceSourceId } from "./licences";
import {
  buildAir,
  buildNpdes,
  buildUsace,
  echoFacilities,
  echoFacilitiesUrl,
  echoQidUrl,
  echoQuery,
  ormFeatures,
  ormInBox,
  ormUrl,
  ORM_MAX,
  type EnvProgram,
  type EnvRecord,
} from "./environmental";
import { buildContaminants, EMEF, EMEF_LAYERS, EMEF_MAX, emefParams, type ContaminantExtra } from "./contaminants";
import {
  attachNpl,
  buildNplBoundaries,
  buildNplStatus,
  NPL_BOUNDARIES,
  NPL_BOUNDARY_MAX,
  NPL_BOUNDARY_WHERE,
  NPL_STATUS,
  nplBoundaryParams,
  nplLookup,
  nplStatusParams,
  type NplDomains,
  type NplStatus,
} from "./npl";
import { buildFudsMrs, buildFudsProjects, buildFudsProperties, FUDS, FUDS_LAYERS, FUDS_MAX, fudsParams, type FudsLayerId } from "./fuds";
import { codedDomains, type ArcgisLayerInfo } from "@/lib/server/arcgis";
import type { LayerFeature } from "@/lib/layers/types";

const MIN = 60_000;
const iso = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();

export interface CoverageEntry {
  id: string;
  name: string;
  state: CoverageState;
  /** Records returned; null where the source did not answer or was not asked (a stale, unfed or unwired city): missing, not none. */
  count: number | null;
  /** Why a source is stale, has no feed, is not wired or failed. */
  reason?: string;
  /** How often the source updates, as its portal states. */
  cadence?: string;
}

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
}

// ------------------------------------------------------------------ building permits

export interface PermitsAnswer {
  records: PermitRecord[];
  coverage: CoverageEntry[];
  provenance: Provenance[];
  age: number;
}

export async function buildingPermits(b: Bbox, days: number): Promise<PermitsAnswer> {
  // The window starts at a UTC day, so every caller today shares the cache entry.
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const cities = permitCitiesInBox(b);
  const results = await Promise.all(
    cities.map(async (c) => {
      const req = permitRequest(c.id, b, since);
      const url = permitRequestUrl(req);
      try {
        const r = await cached(`permits:${c.id}:${b.join(",")}:${since}`, c.id === "losangeles" ? 6 * 60 * MIN : 30 * MIN, async () => {
          const res =
            req.kind === "arcgis"
              ? await runRows(`permits-${c.id}`, { kind: "arcgis", layer: req.url, params: req.params ?? {} }, 25_000)
              : await runRows(`permits-${c.id}`, { kind: "socrata", url: req.url }, c.id === "sanfrancisco" ? 25_000 : 20_000);
          return { records: buildPermits(c.id, res.features), rows: res.features.length, truncated: res.truncated };
        });
        return { city: c.id, ok: true as const, ...r.value, age: r.age, url };
      } catch (err) {
        return { city: c.id, ok: false as const, error: errorText(err) };
      }
    }),
  );
  const records: PermitRecord[] = [];
  const coverage: CoverageEntry[] = [];
  const prov: Provenance[] = [];
  let age = 0;
  for (const r of results) {
    const c = PERMIT_CITIES[r.city];
    if (!r.ok) {
      coverage.push({ id: c.id, name: c.name, state: "error", count: null, reason: r.error, cadence: c.cadence });
      continue;
    }
    records.push(...r.records);
    age = Math.max(age, r.age);
    const state = answeredState(r.rows, r.truncated);
    coverage.push({
      id: c.id,
      name: c.name,
      state,
      count: r.records.length,
      cadence: c.cadence,
      reason: state === "partial" ? `the newest ${PERMIT_LIMIT} of more` : undefined,
    });
    prov.push(
      provenance(source(c.source), {
        kind: "published",
        upstreamUrl: r.url,
        retrievedAt: iso(r.age),
        notes: [`permits issued since ${since}: ${r.records.length}${state === "partial" ? ` (the newest ${PERMIT_LIMIT}; there are more)` : ""}`],
      }),
    );
  }
  for (const g of permitGapsInBox(b)) coverage.push({ id: g.name.toLowerCase().replace(/\W+/g, "-"), name: g.name, state: g.state, count: null, reason: g.reason });
  records.sort((a, z) => (z.issued ?? "").localeCompare(a.issued ?? ""));
  return { records, coverage, provenance: prov, age };
}

// ------------------------------------------------------------------ licences

export interface LicencesAnswer {
  records: LicenceRecord[];
  coverage: CoverageEntry[];
  /** Withheld by the home-based heuristic, per source. */
  withheld: number;
  provenance: Provenance[];
  age: number;
}

export async function licences(b: Bbox): Promise<LicencesAnswer> {
  const today = new Date().toISOString().slice(0, 10);
  const srcs = licenceSourcesInBox(b);
  const results = await Promise.all(
    srcs.map(async (s) => {
      const url = licenceRequestUrl(s.id, b, today);
      try {
        const r = await cached(`licences:${s.id}:${b.join(",")}:${s.id === "chicago" ? today : ""}`, s.id === "losangeles" ? 6 * 60 * MIN : 60 * MIN, async () => {
          const res = await runRows(`licences-${s.id}`, { kind: "socrata", url }, s.id === "sanfrancisco" ? 25_000 : 20_000);
          const built = buildLicences(s.id, res.features.map((f) => f.properties ?? {}));
          return { ...built, rows: res.features.length };
        });
        return { id: s.id, ok: true as const, ...r.value, age: r.age, url };
      } catch (err) {
        return { id: s.id, ok: false as const, error: errorText(err) };
      }
    }),
  );
  const records: LicenceRecord[] = [];
  const coverage: CoverageEntry[] = [];
  const prov: Provenance[] = [];
  let withheld = 0;
  let age = 0;
  for (const r of results) {
    const s = LICENCE_SOURCES[r.id as LicenceSourceId];
    if (!r.ok) {
      coverage.push({ id: s.id, name: s.name, state: "error", count: null, reason: r.error, cadence: s.cadence });
      continue;
    }
    records.push(...r.records);
    withheld += r.withheld;
    age = Math.max(age, r.age);
    const partial = r.rows >= LICENCE_LIMIT;
    coverage.push({
      id: s.id,
      name: s.name,
      state: partial ? "partial" : "covered",
      count: r.records.length,
      cadence: s.cadence,
      reason: [partial ? `the first ${LICENCE_LIMIT} records the registry returned` : "", r.withheld ? `${r.withheld} withheld at apartment or unit addresses (home-business heuristic)` : ""].filter(Boolean).join("; ") || undefined,
    });
    prov.push(
      provenance(source(s.source), {
        kind: "published",
        upstreamUrl: r.url,
        retrievedAt: iso(r.age),
        notes: [`${r.records.length} licensed premises shown, ${r.withheld} withheld by the home-business heuristic`],
      }),
    );
  }
  return { records, coverage, withheld, provenance: prov, age };
}

// ------------------------------------------------------------------ environmental

export interface EnvAnswer {
  records: EnvRecord[];
  coverage: CoverageEntry[];
  provenance: Provenance[];
  age: number;
}

/** ECHO in two steps: get_facilities for a query id and its row count, get_qid for page one of the rows. */
async function echo(program: "npdes" | "air", b: Bbox): Promise<{ records: EnvRecord[]; total: number; urls: string[] }> {
  const first = echoFacilitiesUrl(program, b);
  const q = echoQuery(await civicJson<unknown>(`echo-${program}`, first, 25_000));
  if (!q) throw new Error(`ECHO ${program}: no query id in the answer`);
  if (q.rows === 0) return { records: [], total: 0, urls: [first] };
  const second = echoQidUrl(program, q.qid);
  const rows = echoFacilities(await civicJson<unknown>(`echo-${program}`, second, 25_000));
  return { records: program === "npdes" ? buildNpdes(rows) : buildAir(rows), total: q.rows, urls: [first, second] };
}

interface EnvPart {
  records: EnvRecord[];
  /** ECHO: the rows its query counted. */
  total: number;
  urls: string[];
  /** The Corps: every action the search answered was in the box, and it answered its maximum. */
  capped?: boolean;
  /** The Corps: actions from outside the box the search padded its answer with, dropped. */
  outside?: number;
}

export async function environmental(b: Bbox): Promise<EnvAnswer> {
  const parts: Array<{ id: EnvProgram; name: string; run: () => Promise<EnvPart> }> = [
    { id: "npdes", name: "EPA ECHO, Clean Water Act (NPDES)", run: () => echo("npdes", b) },
    { id: "air", name: "EPA ECHO, Clean Air Act", run: () => echo("air", b) },
    {
      id: "usace",
      name: "U.S. Army Corps of Engineers, ORM",
      run: async () => {
        const url = ormUrl(b);
        // The search answers the box's actions first, then pads with actions from anywhere: keep the box's.
        const box = ormInBox(ormFeatures(await civicJson<unknown>("usace-orm", url, 25_000)), b);
        const records = buildUsace(box.features);
        return { records, total: records.length, urls: [url], capped: box.partial, outside: box.outside };
      },
    },
  ];
  const results = await Promise.all(
    parts.map(async (p) => {
      try {
        // The resolved rows are cached, never ECHO's query id (server-side state that expires).
        const r = await cached(`env:${p.id}:${b.join(",")}`, 6 * 60 * MIN, p.run);
        return { ...p, ok: true as const, ...r.value, age: r.age };
      } catch (err) {
        return { ...p, ok: false as const, error: errorText(err) };
      }
    }),
  );
  const records: EnvRecord[] = [];
  const coverage: CoverageEntry[] = [];
  const prov: Provenance[] = [];
  let age = 0;
  for (const r of results) {
    if (!r.ok) {
      coverage.push({ id: r.id, name: r.name, state: "error", count: null, reason: r.error });
      continue;
    }
    records.push(...r.records);
    age = Math.max(age, r.age);
    const partial = r.id === "usace" ? !!r.capped : r.records.length < r.total;
    coverage.push({
      id: r.id,
      name: r.name,
      state: partial ? "partial" : "covered",
      count: r.records.length,
      reason: partial
        ? r.id === "usace"
          ? `the search's ${ORM_MAX}-action maximum, every one in the box; there may be more`
          : `${r.records.length} of ${r.total} ECHO rows (page one)`
        : undefined,
      cadence: r.id === "usace" ? "as the Corps enters actions" : "ECHO refreshes weekly",
    });
    prov.push(
      provenance(source(r.id === "usace" ? "usace-orm" : r.id === "npdes" ? "epa-echo-cwa" : "epa-echo-air"), {
        kind: "published",
        // The first step's URL: the second carries ECHO's query id, which expires.
        upstreamUrl: r.urls[0],
        retrievedAt: iso(r.age),
        notes: [
          `${r.records.length} in the box`,
          ...(r.id === "usace" && r.outside ? [`${r.outside} more the search answered from outside the box, dropped`] : []),
        ],
      }),
    );
  }
  return { records, coverage, provenance: prov, age };
}

export type { PermitCityId };

// ------------------------------------------------------------------ contaminated sites (EPA EMEF, Superfund boundaries, NPL status)

export interface ContaminantsAnswer {
  features: LayerFeature[];
  coverage: CoverageEntry[];
  provenance: Provenance[];
  age: number;
}

const DAY = 24 * 60 * MIN;

type Part<T> = { id: string; name: string; ok: true; value: T; age: number } | { id: string; name: string; ok: false; error: string };

/** One upstream call through the cache; a failure is kept as an error for coverage, never thrown. */
async function part<T>(id: string, name: string, key: string, ttlMs: number, run: () => Promise<T>): Promise<Part<T>> {
  try {
    const r = await cached(key, ttlMs, run);
    return { id, name, ok: true, value: r.value, age: r.age };
  } catch (err) {
    return { id, name, ok: false, error: errorText(err) };
  }
}

interface Rows {
  rows: Array<{ id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>;
  /** The upstream said it held more than it sent, or the answer filled the cap. */
  capped: boolean;
  more: boolean;
}

/** An ArcGIS layer query as rows, with the cap read from the flag and the count. */
async function arcgisRowsCapped(name: string, layer: string, params: Record<string, string>, cap: number): Promise<Rows> {
  const res = await runRows(name, { kind: "arcgis", layer, params }, 25_000);
  return { rows: res.features, capped: res.truncated || res.features.length >= cap, more: res.truncated };
}

function capReason(capped: boolean, more: boolean, cap: number): string | undefined {
  if (!capped) return undefined;
  return more ? `the first ${cap.toLocaleString("en-US")} of more in this box` : `the first ${cap.toLocaleString("en-US")} in this box; there may be more`;
}

/** NPL_STATUS_CODE and FEDERAL_FACILITY_DETER_CODE labels from the boundary layer's own domains, held a week. */
async function nplDomains(): Promise<NplDomains | null> {
  try {
    const r = await cached("npl-domains", 7 * DAY, async () => {
      const d = codedDomains(await civicJson<ArcgisLayerInfo>("epa-npl-boundaries", `${NPL_BOUNDARIES}?f=json`, 20_000));
      return { status: [...(d.get("NPL_STATUS_CODE") ?? [])], federal: [...(d.get("FEDERAL_FACILITY_DETER_CODE") ?? [])] };
    });
    return { status: new Map(r.value.status), federal: new Map(r.value.federal) };
  } catch {
    // The codes are then shown as published.
    return null;
  }
}

/**
 * EPA's Superfund, TRI, RCRA and Brownfields listings in a box: one EMEF layer query each, in
 * parallel, each cached six hours; with `polygons` (below 10 km) Superfund site boundaries too,
 * cached a day. Every Superfund point and boundary then gains its NPL list row, joined by EPA ID
 * (never by box), in chunks of 50, cached a day. Each upstream that fails is named in `coverage`
 * as "error" with count null and leaves the others standing; one that hit its cap is "partial".
 */
export async function contaminants(b: Bbox, polygons = false): Promise<ContaminantsAnswer> {
  const box = b.join(",");
  const fudsLayers = FUDS_LAYERS.filter((l) => polygons || !l.polygons);
  const [emef, bnd, fuds] = await Promise.all([
    Promise.all(
      EMEF_LAYERS.map((l) =>
        part(l.id, `EPA ${l.short}`, `emef:${l.id}:${box}`, 6 * 60 * MIN, async () => {
          const rows = await runRows("epa-emef", { kind: "arcgis", layer: `${EMEF}/${l.layer}`, params: emefParams(b) }, 25_000);
          // `more`: EMEF said it held more than it sent. Exactly EMEF_MAX rows without
          // that flag is capped too, but there may be nothing beyond it.
          return { features: buildContaminants(l.id, rows.features), capped: rows.truncated || rows.features.length >= EMEF_MAX, more: rows.truncated };
        }),
      ),
    ),
    polygons ? part("npl-boundaries", "EPA Superfund site boundaries", `npl-bnd:${box}`, DAY, () => arcgisRowsCapped("epa-npl-boundaries", NPL_BOUNDARIES, nplBoundaryParams(b), NPL_BOUNDARY_MAX)) : Promise.resolve(null),
    Promise.all(fudsLayers.map((l) => part(`fuds-${l.id}`, l.name, `fuds:${l.id}:${box}`, DAY, () => arcgisRowsCapped("usace-fuds", `${FUDS}/${l.layer}`, fudsParams(l, b), FUDS_MAX)))),
  ]);

  // The NPL list, by EPA ID: every Superfund point's program id and every boundary's EPA_ID.
  const sems = emef.find((r) => r.id === "sems");
  const ids = new Set<string>();
  if (sems?.ok) for (const f of sems.value.features) if ((f.properties.extra as ContaminantExtra).programId) ids.add((f.properties.extra as ContaminantExtra).programId!);
  if (bnd?.ok)
    for (const r of bnd.value.rows) {
      const id = r.properties?.EPA_ID;
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    }
  const chunks = nplStatusParams([...ids]);
  const [statusParts, domains] = await Promise.all([
    Promise.all(chunks.map((params) => part("npl-status", "EPA NPL status list", `npl-status:${params.where}`, DAY, async () => (await runRows("epa-npl-status", { kind: "arcgis", layer: NPL_STATUS, params }, 25_000)).features))),
    bnd?.ok ? nplDomains() : Promise.resolve(null),
  ]);
  const found = new Map<string, NplStatus>();
  const unknown = new Set<string>();
  statusParts.forEach((r, i) => {
    if (r.ok) for (const [k, v] of buildNplStatus(r.value)) found.set(k, v);
    else for (const id of chunks[i].where.match(/'([A-Z0-9]+)'/g) ?? []) unknown.add(id.slice(1, -1));
  });
  const lookup = nplLookup(found, unknown);

  const features: LayerFeature[] = [];
  const coverage: CoverageEntry[] = [];
  const prov: Provenance[] = [];
  let age = 0;
  for (const r of emef) {
    const l = EMEF_LAYERS.find((x) => x.id === r.id)!;
    if (!r.ok) {
      coverage.push({ id: r.id, name: r.name, state: "error", count: null, reason: r.error });
      continue;
    }
    features.push(...(r.id === "sems" ? attachNpl(r.value.features, lookup) : r.value.features));
    age = Math.max(age, r.age);
    coverage.push({
      id: r.id,
      name: r.name,
      state: r.value.capped ? "partial" : "covered",
      count: r.value.features.length,
      reason: capReason(r.value.capped, r.value.more, EMEF_MAX),
      cadence: "as EPA's program systems update Envirofacts",
    });
    prov.push(
      provenance(source("epa-emef"), {
        kind: "published",
        seriesId: `EMEF efpoints MapServer layer ${l.layer} (${l.service})`,
        upstreamUrl: `${EMEF}/${l.layer}`,
        retrievedAt: iso(r.age),
        notes: [`${r.value.features.length} in the box${r.value.capped ? ` (capped at ${EMEF_MAX})` : ""}`],
      }),
    );
  }
  if (bnd) {
    if (!bnd.ok) coverage.push({ id: bnd.id, name: bnd.name, state: "error", count: null, reason: bnd.error });
    else {
      const built = buildNplBoundaries(bnd.value.rows, domains, lookup);
      features.push(...built);
      age = Math.max(age, bnd.age);
      coverage.push({ id: bnd.id, name: bnd.name, state: bnd.value.capped ? "partial" : "covered", count: built.length, reason: capReason(bnd.value.capped, bnd.value.more, NPL_BOUNDARY_MAX), cadence: "harvested weekly from EPA regions' datasets" });
      prov.push(
        provenance(source("epa-npl-boundaries"), {
          kind: "published",
          seriesId: `FAC_Superfund_Site_Boundaries_EPA_Public layer 0, ${NPL_BOUNDARY_WHERE}, simplified to 0.0005 degrees`,
          upstreamUrl: NPL_BOUNDARIES,
          retrievedAt: iso(bnd.age),
          notes: [`${built.length} mapped features for ${new Set(built.map((f) => (f.properties.extra as ContaminantExtra).programId)).size} sites in the box`],
        }),
      );
    }
  }
  // USACE FUDS: projects grouped onto their properties; a point is dropped where its property has a boundary.
  const fudsOf = (id: FudsLayerId) => fuds.find((r) => r.id === `fuds-${id}`) ?? null;
  const fPts = fudsOf("properties");
  const fProj = fudsOf("projects");
  const fPoly = fudsOf("property-polygons");
  const fMrs = fudsOf("mrs");
  const projects = fProj?.ok ? buildFudsProjects(fProj.value.rows, Date.now()) : null;
  const fudsProps = buildFudsProperties(fPts?.ok ? fPts.value.rows : [], fPoly?.ok ? fPoly.value.rows : null, projects);
  const fudsMrs = fMrs?.ok ? buildFudsMrs(fMrs.value.rows) : [];
  features.push(...fudsProps, ...fudsMrs);
  const fudsCount: Record<FudsLayerId, number | null> = {
    properties: fudsProps.filter((f) => (f.properties.extra as ContaminantExtra).shape === "point").length,
    "property-polygons": fudsProps.filter((f) => (f.properties.extra as ContaminantExtra).shape === "property").length,
    mrs: fudsMrs.length,
    // Projects in the box whose property is drawn here.
    projects: projects ? fudsProps.reduce((n, f) => n + ((f.properties.extra as { projects?: unknown[] | null }).projects?.length ?? 0), 0) : null,
  };
  for (const r of fuds) {
    const l = FUDS_LAYERS.find((x) => `fuds-${x.id}` === r.id)!;
    if (!r.ok) {
      coverage.push({ id: r.id, name: r.name, state: "error", count: null, reason: r.error });
      continue;
    }
    age = Math.max(age, r.age);
    coverage.push({
      id: r.id,
      name: r.name,
      state: r.value.capped ? "partial" : "covered",
      count: fudsCount[l.id],
      reason: [capReason(r.value.capped, r.value.more, FUDS_MAX), l.id === "properties" && fPoly?.ok ? "a property with a boundary here is drawn as its boundary, not its point" : ""].filter(Boolean).join("; ") || undefined,
      cadence: "USACE's FUDS inventory, FY2024 data (item updated 2026-10-07)",
    });
    prov.push(
      provenance(source("usace-fuds"), {
        kind: "published",
        seriesId: `fuds FeatureServer layer ${l.layer} (${l.name.replace("USACE FUDS ", "")})`,
        upstreamUrl: `${FUDS}/${l.layer}`,
        retrievedAt: iso(r.age),
        notes: [`${r.value.rows.length} rows in the box${r.value.capped ? ` (capped at ${FUDS_MAX})` : ""}`],
      }),
    );
  }

  if (chunks.length) {
    const okParts = statusParts.filter((r) => r.ok);
    const state = okParts.length === statusParts.length ? "covered" : okParts.length ? "partial" : "error";
    coverage.push({
      id: "npl-status",
      name: "EPA NPL status list",
      state,
      count: okParts.length ? found.size : null,
      reason:
        state === "error"
          ? (statusParts[0] as { error: string }).error
          : state === "partial"
            ? `${unknown.size} of ${ids.size} sites unknown: part of the list did not answer`
            : undefined,
      cadence: "as EPA updates the NPL",
    });
    if (okParts.length) {
      prov.push(
        provenance(source("epa-npl-status"), {
          kind: "published",
          seriesId: "Superfund NPL Sites with Status Information layer 0, by Site_EPA_ID",
          upstreamUrl: NPL_STATUS,
          retrievedAt: iso(Math.max(...okParts.map((r) => (r.ok ? r.age : 0)))),
          notes: [`${found.size} of ${ids.size} Superfund sites in the box are on the list; ${ids.size - found.size - unknown.size} are not`],
        }),
      );
    }
  }
  return { features, coverage, provenance: prov, age };
}
