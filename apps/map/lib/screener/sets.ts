// Assembled entity sets for the screener and for anything else that needs a
// nationwide table of counties, states, ports, crossings or countries. These
// used to live inside app/api/screen/route.ts; place pages need the same
// tables to put a county in its cohort, and a route module is not importable.
//
// Every upstream a set reads is wrapped so a single outage degrades fields
// rather than the whole set — which is why the hourly cache entry is EVICTED
// when the produced set has no features at all. buildAreaPoints drops any
// area with neither jobs nor a home value, so a BLS cooldown plus a Zillow
// gap yields a perfectly successful set with features:[]; caching that for an
// hour would silently strip rank context from every page rendered in the
// window. Consumers must therefore check features.length, not just truthiness.

import { cached, cacheDelete } from "@/lib/server/cache";
import type { LayerFeature } from "@/lib/layers/types";
import { buildCountries, buildCrossings, buildPorts, type AreaJoins, type PortStats } from "@/lib/economy/features";
import { borderCrossings, btsPortStats, COUNTRIES, qcewLatest, stateLookup, tigerCountyPoints, tigerStates, worldBank, WPI, zillow } from "@/lib/economy/sources";
import type { Provenance } from "@/lib/provenance/types";
import type { SourceId } from "@/lib/provenance/sources";
import type { EntityKind } from "./fields";
import { buildAreaPoints, screenProvenance } from "./entities";

const H = 3600_000;

export interface EntitySet {
  features: LayerFeature[];
  provenance: Provenance[];
  caveats: string[];
  assembledAt: string;
  /** Source ids that did not answer. Their fields are empty, never imputed. */
  failed: SourceId[];
}

export async function areaSet(level: "county" | "state"): Promise<EntitySet> {
  const failed: SourceId[] = [];
  const periods: Partial<Record<SourceId, string>> = {};
  const caveats: string[] = [];
  const [points, q, h, r, states] = await Promise.all([
    level === "county" ? tigerCountyPoints() : tigerStates(),
    qcewLatest().catch(() => null),
    zillow(level === "county" ? "zhviCounty" : "zhviState").catch(() => null),
    level === "county" ? zillow("zoriCounty").catch(() => null) : Promise.resolve(null),
    stateLookup().catch(() => null),
  ]);
  const joins: AreaJoins = { jobs: new Map(), home: new Map(), rent: new Map(), stateNames: new Map() };
  if (q) {
    joins.jobs = level === "county" ? q.counties : q.states;
    periods["bls-qcew"] = q.period;
  } else failed.push("bls-qcew");
  if (h) {
    periods["zillow-zhvi"] = h.asOf;
    if (level === "county") joins.home = h.rows;
    else if (states) for (const [fips, s] of states) {
      const row = h.byName.get(s.name);
      if (row) joins.home.set(fips, row);
    }
  } else failed.push("zillow-zhvi");
  if (level === "county") {
    if (r) {
      periods["zillow-zori"] = r.asOf;
      joins.rent = r.rows;
    } else failed.push("zillow-zori");
  }
  if (states && level === "county") for (const [fips, s] of states) joins.stateNames!.set(fips, s.name);
  for (const id of failed) caveats.push(`${id} did not answer; its fields are empty.`);
  const assembledAt = new Date().toISOString();
  return {
    features: buildAreaPoints(points, level, joins),
    provenance: screenProvenance(level, { retrievedAt: assembledAt, periods, failed }),
    caveats,
    assembledAt,
    failed,
  };
}

export async function portSet(): Promise<EntitySet> {
  const stats = await btsPortStats().catch(() => null);
  const statMap = new Map<number, PortStats>(stats?.byWpi ?? []);
  const extras = stats?.extraPorts ?? [];
  for (const x of extras) statMap.set(x.port.id, x.stats);
  const assembledAt = new Date().toISOString();
  const caveats = stats ? [] : ["bts-ports did not answer; container and tonnage fields are empty."];
  caveats.push("World Port Index depths and sizes are the NGA snapshot bundled with the app, not live.");
  const failed: SourceId[] = stats ? [] : ["bts-ports"];
  return {
    features: buildPorts([...WPI.ports, ...extras.map((x) => x.port)], statMap),
    provenance: screenProvenance("port", { retrievedAt: assembledAt, periods: { "nga-wpi": WPI.pulled, "bts-ports": stats ? String(stats.year) : undefined }, failed }),
    caveats,
    assembledAt,
    failed,
  };
}

export async function crossingSet(): Promise<EntitySet> {
  const b = await borderCrossings();
  const assembledAt = new Date().toISOString();
  return {
    features: buildCrossings(b.rows),
    provenance: screenProvenance("crossing", { retrievedAt: assembledAt, periods: { "bts-border": b.asOf } }),
    caveats: ["Monthly counts; the latest month can be revised by BTS."],
    assembledAt,
    failed: [],
  };
}

export async function countrySet(): Promise<EntitySet> {
  const wb = await worldBank();
  const assembledAt = new Date().toISOString();
  const caveats: string[] = ["World Bank values are the most recent year each country reported; years differ between countries and indicators."];
  if (wb.failed.length) caveats.push(`World Bank indicators that did not answer: ${wb.failed.join(", ")}.`);
  return {
    features: buildCountries(COUNTRIES.features, wb.stats),
    provenance: screenProvenance("country", { retrievedAt: assembledAt, periods: { "natural-earth": COUNTRIES.pulled } }),
    caveats,
    assembledAt,
    failed: [],
  };
}

export async function entitySet(kind: EntityKind): Promise<EntitySet> {
  const build: Record<EntityKind, () => Promise<EntitySet>> = {
    county: () => areaSet("county"),
    state: () => areaSet("state"),
    port: portSet,
    crossing: crossingSet,
    country: countrySet,
  };
  const key = `screen:entities:${kind}`;
  const c = await cached(key, 1 * H, build[kind]);
  // An empty set is a degraded upstream, not an answer. Drop it so the next
  // caller retries instead of inheriting the outage for the rest of the hour.
  if (!c.value.features.length) cacheDelete(key);
  return c.value;
}

/**
 * One feature out of a set by its layer id ("county:48453", "state:48",
 * "port:7950", "crossing:2304"). A linear scan on purpose: a caller doing
 * many lookups should build its own Map over set.features once.
 */
export function featureFor(set: EntitySet, id: string): LayerFeature | undefined {
  return set.features.find((f) => f.properties.id === id);
}
