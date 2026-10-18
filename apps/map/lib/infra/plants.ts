// Power plants from the two bundled snapshots scripts/infra-data.mjs writes:
// EIA-860M (every US generator of 1 MW or more, grouped by plant) and
// Wikidata's nuclear power plants outside the United States. Pure: the
// route hands in the parsed JSON and a box, and gets features back.
//
// A plant's capacity is the nameplate MW EIA lists for its generators,
// summed; a generator with no nameplate value is counted, never added as 0
// ("n MW, plus k generators with no nameplate value"). The reporting entity
// is shown as EIA publishes it, in the dossier only (never in the name, never
// searchable). Wikidata's status and capacity are shown only where Wikidata
// has them; its capacity is the best-rank statement, with its dates, and a
// plant with several figures Wikidata does not order is drawn unsized.

import type { LayerFeature } from "@/lib/layers/types";

/** plants-eia860m.json as the script writes it. */
export interface EiaSnapshot {
  file: string;
  inventoryAsOf: string;
  pulled: string;
  lastModified?: string | null;
  techs: string[];
  entities: (string | null)[];
  sectors: (string | null)[];
  statuses: string[];
  /** [plantId, name, state, county, lat, lon, entity, sector, ba, opMW, opByTech, opStatus, firstYear, plannedMW, plannedByTech, plannedYear] */
  plants: EiaPlantRow[];
}

type TechRow = [tech: number, mw: number, n: number, unreported: number];
export type EiaPlantRow = [
  number,
  string | null,
  string | null,
  string | null,
  number,
  number,
  number,
  number,
  string | null,
  number,
  TechRow[],
  Array<[number, number]>,
  number | null,
  number,
  TechRow[],
  number | null,
];

/**
 * One best-rank Wikidata nameplate capacity (P2109) statement: MW, then its point in
 * time (P585), start (P580) and end (P582) at the precision Wikidata states them
 * (YYYY-MM-DD, YYYY-MM, YYYY or YYY0s), and the label of its method (P459); null
 * where the statement has none.
 */
export type WikidataCapacity = [mw: number, pointInTime: string | null, start: string | null, end: string | null, method: string | null];

/** nuclear-wikidata.json as the script writes it. */
export interface WikidataSnapshot {
  pulled: string;
  /** [qid, name, lon, lat, country, status[], capacities[], distinct coordinate locations] */
  plants: Array<[string, string | null, number, number, string | null, string[], WikidataCapacity[], number]>;
}

/** The colour family of a plant, from the technology with the most nameplate MW. */
export type FuelFamily = "nuclear" | "coal" | "gas" | "oil" | "hydro" | "wind" | "solar" | "storage" | "geothermal" | "biomass" | "other";

export function fuelFamily(tech: string | undefined): FuelFamily {
  const t = (tech ?? "").toLowerCase();
  if (!t) return "other";
  if (t.includes("nuclear")) return "nuclear";
  if (t.includes("coal") || t.includes("petroleum coke")) return "coal";
  if (t.includes("pumped storage") || t.includes("batter") || t.includes("flywheel") || t.includes("compressed air")) return "storage";
  if (t.includes("natural gas") || t.includes("other gases")) return "gas";
  if (t.includes("petroleum")) return "oil";
  if (t.includes("hydro")) return "hydro";
  if (t.includes("wind")) return "wind";
  if (t.includes("solar")) return "solar";
  if (t.includes("geothermal")) return "geothermal";
  if (t.includes("biomass") || t.includes("wood") || t.includes("landfill") || t.includes("municipal solid waste")) return "biomass";
  return "other";
}

export interface PlantExtra {
  family: FuelFamily;
  /** Nameplate MW in the operating inventory (EIA) or Wikidata's nameplate capacity; undefined when not published. */
  mw?: number;
  plannedMw?: number;
  source: "eia" | "wikidata";
  status?: string;
}

const fmtMw = (mw: number) => `${mw >= 100 ? Math.round(mw).toLocaleString("en-US") : mw.toLocaleString("en-US", { maximumFractionDigits: 1 })} MW`;

function techLine(s: EiaSnapshot, rows: TechRow[]): string | undefined {
  if (!rows.length) return undefined;
  return rows
    .map(([t, mw, n, unrep]) => `${s.techs[t] ?? "not reported"} ${fmtMw(mw)} (${n} generator${n === 1 ? "" : "s"}${unrep ? `, ${unrep} with no nameplate value` : ""})`)
    .join("; ");
}

export function inBox(lon: number, lat: number, b: [number, number, number, number]): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

/** EIA plants in a box with at least `minMw` operating or planned nameplate MW. */
export function eiaPlants(s: EiaSnapshot, bbox: [number, number, number, number], minMw = 0): LayerFeature[] {
  const out: LayerFeature[] = [];
  for (const r of s.plants) {
    const [id, name, state, county, lat, lon, ent, sec, ba, opMw, opTech, opStatus, firstYear, plannedMw, plannedTech, plannedYear] = r;
    if (!inBox(lon, lat, bbox)) continue;
    if (Math.max(opMw, plannedMw) < minMw) continue;
    const main = s.techs[(opTech[0] ?? plannedTech[0])?.[0] ?? -1];
    const family = fuelFamily(main);
    const planned = opTech.length === 0;
    const statusLine = opStatus.map(([st, n]) => `${s.statuses[st] ?? "not reported"} × ${n}`).join("; ");
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat, 0] },
      properties: {
        id: `eia:${id}`,
        layer: "plants",
        name: name ?? `EIA plant ${id}`,
        kind: planned ? "planned" : family,
        source: "EIA-860M",
        details: {
          "EIA plant id": id,
          "main technology": main,
          "operating capacity": opTech.length ? `${fmtMw(opMw)} nameplate` : "none yet (planned)",
          "operating generators": techLine(s, opTech),
          "generator status": statusLine || undefined,
          "first generator in service": firstYear ?? undefined,
          "planned capacity": plannedTech.length ? `${fmtMw(plannedMw)} nameplate` : undefined,
          "planned generators": techLine(s, plannedTech),
          "first planned in service": plannedYear ?? undefined,
          sector: s.sectors[sec] ?? undefined,
          // As EIA publishes it; not searchable (lib/search/allowlist.ts).
          "reporting entity (EIA)": s.entities[ent] ?? undefined,
          "balancing authority": ba ?? undefined,
          county: county ?? undefined,
          state: state ?? undefined,
          inventory: `EIA-860M, ${s.inventoryAsOf} (preliminary monthly inventory)`,
        },
        extra: { family, mw: opTech.length ? opMw : undefined, plannedMw: plannedTech.length ? plannedMw : undefined, source: "eia" } satisfies PlantExtra,
      },
    });
  }
  return out;
}

/** When a capacity statement holds: "2018", "since 2021", "1997 to 2010", "until 2018-12-22". */
function capacityWhen([, pit, start, end]: WikidataCapacity): string | undefined {
  const span = start && end ? `${start} to ${end}` : start ? `since ${start}` : end ? `until ${end}` : undefined;
  return [pit, span].filter(Boolean).join("; ") || undefined;
}

/**
 * The date a capacity statement is ordered by: its point in time, else its start; none
 * when absent or given more than once. A decade ("1970s") orders as its first three
 * digits, so it overlaps every year in it rather than passing for 1970.
 */
function capacityKey([, pit, start]: WikidataCapacity): string | undefined {
  const k = pit ?? start;
  if (!k || k.includes(",")) return undefined;
  return k.endsWith("0s") ? k.slice(0, -2) : k;
}

/** Plain code-unit order: ISO dates of any precision sort by time, a year before its months. */
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface WikidataCapacityPick {
  /** The figure that sizes the plant, or undefined when Wikidata does not say which of its figures is current. */
  mw?: number;
  /** Every figure with its date and method, most recent first; undefined when there is none. */
  text?: string;
  /** How many different figures the best-rank statements give. */
  figures: number;
}

/**
 * A plant's capacity from its best-rank P2109 statements (the query already dropped
 * normal-rank statements that a preferred one supersedes, and deprecated ones).
 * One figure: that figure. Several: the most recent by point in time (else start
 * time), but only when every statement is dated and no other figure shares or
 * overlaps that date ("2018" and "2018-06" cannot be ordered); otherwise none, and
 * the plant is drawn unsized rather than by a figure Wikidata does not call current.
 */
export function wikidataCapacity(caps: WikidataCapacity[]): WikidataCapacityPick {
  if (!caps.length) return { figures: 0 };
  const figures = new Set(caps.map((c) => c[0])).size;
  const keyed = caps.map((c) => ({ c, key: capacityKey(c) }));
  // Most recent first, undated last, then the larger figure first.
  keyed.sort((a, b) => byCode(b.key ?? "", a.key ?? "") || b.c[0] - a.c[0]);
  let mw: number | undefined;
  if (figures === 1) mw = caps[0][0];
  else if (keyed.every((k) => k.key)) {
    const top = keyed[0];
    const clear = keyed.every((k) => k.c[0] === top.c[0] || (k.key! < top.key! && !top.key!.startsWith(k.key!)));
    if (clear) mw = top.c[0];
  }
  const parts: string[] = [];
  for (const { c } of keyed) {
    const qual = [capacityWhen(c), c[4] ? `method: ${c[4]}` : undefined].filter(Boolean).join("; ");
    const s = `${fmtMw(c[0])}${qual ? ` (${qual})` : ""}`;
    if (!parts.includes(s)) parts.push(s);
  }
  return { mw, text: parts.join(" / "), figures };
}

/** Wikidata nuclear plants outside the US in a box. */
export function wikidataNuclear(s: WikidataSnapshot, bbox: [number, number, number, number]): LayerFeature[] {
  const out: LayerFeature[] = [];
  for (const [qid, name, lon, lat, country, status, caps, coords] of s.plants) {
    if (!inBox(lon, lat, bbox)) continue;
    const cap = wikidataCapacity(caps);
    const mw = cap.mw;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat, 0] },
      properties: {
        id: `wd:${qid}`,
        layer: "plants",
        name: name ?? qid,
        kind: "nuclear",
        source: "Wikidata",
        details: {
          "Wikidata item": qid,
          type: "nuclear power plant",
          status: status.length ? status.join(", ") : "not recorded in Wikidata",
          "nameplate capacity": cap.text ?? "not recorded in Wikidata",
          // Several figures: say which one sizes the dot, or that none does.
          "capacity drawn":
            cap.figures > 1
              ? mw != null
                ? `${fmtMw(mw)}, the most recent of Wikidata's figures`
                : "none: Wikidata's figures are not dated in a way that tells which is current"
              : undefined,
          country: country ?? undefined,
          // Distinct best-rank coordinate locations (scripts/infra-data.mjs); the westernmost is drawn.
          "coordinate locations": coords > 1 ? `${coords} in Wikidata (the westernmost is drawn)` : undefined,
          "item page": `https://www.wikidata.org/wiki/${qid}`,
          "what this is": "a Wikidata item (CC0); its completeness and status are Wikidata's, and a plant with no status statement says so",
        },
        extra: { family: "nuclear", mw, source: "wikidata", status: status.join(", ") || undefined } satisfies PlantExtra,
      },
    });
  }
  return out;
}

/** The larger of a plant's operating and planned nameplate MW (0 when neither is published). */
function plantMw(f: LayerFeature): number {
  const x = f.properties.extra as PlantExtra | undefined;
  return Math.max(x?.mw ?? 0, x?.plannedMw ?? 0);
}

export interface LargestFirst {
  features: LayerFeature[];
  /** True when some plants were left out to fit the budget. */
  truncated: boolean;
  /** The smallest capacity kept (MW) when truncated: the floor the answer reached. */
  floorMw?: number;
}

/**
 * Plants that fit in `budgetBytes` of JSON, largest first (by the larger of
 * operating and planned nameplate MW) when they do not all fit; every plant, in
 * its own order, when they do. The floor it reached is the smallest plant kept.
 */
export function largestFirst(features: LayerFeature[], budgetBytes: number): LargestFirst {
  const sizes = features.map((f) => JSON.stringify(f).length + 1);
  if (sizes.reduce((a, b) => a + b, 0) <= budgetBytes) return { features, truncated: false };
  const order = features.map((_, i) => i).sort((a, b) => plantMw(features[b]) - plantMw(features[a]) || a - b);
  const kept: LayerFeature[] = [];
  let used = 0;
  for (const i of order) {
    if (used + sizes[i] > budgetBytes) break;
    used += sizes[i];
    kept.push(features[i]);
  }
  return { features: kept, truncated: true, floorMw: kept.length ? plantMw(kept[kept.length - 1]) : undefined };
}
