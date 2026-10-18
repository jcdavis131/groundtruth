// Collector: aircraft near the big air-cargo hubs, as counts.
//
//   snapshot:hub-aircraft:<IATA>        airframes adsb.lol hears within 60 nm
//   snapshot:hub-cargo-aircraft:<IATA>  of those, flying a cargo-only carrier callsign
//
// adsb.lol is keyless and community-fed, so the count is "what the feeders
// around that hub hear", not "every aircraft". That is the same for every
// sample and drifts slowly with feeder coverage, which is why the series is a
// nowcast, not a census. Hex codes and callsigns are matched in memory and
// dropped; only the two integers per hub are stored.

import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { SeriesMeta } from "@/lib/series/types";
import { sleep, type Collector, type CollectorContext, type CollectorOutput } from "./types";

export interface CargoHub {
  iata: string;
  name: string;
  country: string;
  lon: number;
  lat: number;
}

export const HUB_RADIUS_NM = 60;

export const CARGO_HUBS: CargoHub[] = [
  { iata: "MEM", name: "Memphis (FedEx superhub)", country: "US", lon: -89.977, lat: 35.042 },
  { iata: "SDF", name: "Louisville (UPS Worldport)", country: "US", lon: -85.736, lat: 38.174 },
  { iata: "ANC", name: "Anchorage", country: "US", lon: -149.996, lat: 61.174 },
  { iata: "CVG", name: "Cincinnati / Northern Kentucky", country: "US", lon: -84.668, lat: 39.049 },
  { iata: "ONT", name: "Ontario, California", country: "US", lon: -117.601, lat: 34.056 },
  { iata: "MIA", name: "Miami", country: "US", lon: -80.291, lat: 25.796 },
  { iata: "ORD", name: "Chicago O'Hare", country: "US", lon: -87.905, lat: 41.979 },
  { iata: "LAX", name: "Los Angeles", country: "US", lon: -118.408, lat: 33.942 },
  { iata: "JFK", name: "New York JFK", country: "US", lon: -73.779, lat: 40.64 },
  { iata: "HKG", name: "Hong Kong", country: "HK", lon: 113.915, lat: 22.309 },
  { iata: "PVG", name: "Shanghai Pudong", country: "CN", lon: 121.805, lat: 31.144 },
  { iata: "ICN", name: "Seoul Incheon", country: "KR", lon: 126.451, lat: 37.469 },
  { iata: "DXB", name: "Dubai", country: "AE", lon: 55.365, lat: 25.253 },
  { iata: "LEJ", name: "Leipzig/Halle (DHL hub)", country: "DE", lon: 12.236, lat: 51.424 },
  { iata: "CGN", name: "Cologne Bonn", country: "DE", lon: 7.143, lat: 50.866 },
  { iata: "LUX", name: "Luxembourg (Cargolux)", country: "LU", lon: 6.204, lat: 49.627 },
  { iata: "LGG", name: "Liege", country: "BE", lon: 5.443, lat: 50.637 },
  { iata: "NRT", name: "Tokyo Narita", country: "JP", lon: 140.386, lat: 35.772 },
  { iata: "TPE", name: "Taipei Taoyuan", country: "TW", lon: 121.233, lat: 25.08 },
];

/**
 * ICAO three-letter designators of carriers that fly only freight. Combination
 * carriers (KAL, CPA, DLH ...) fly cargo under the same prefix as passengers
 * and are left out rather than guessed.
 */
export const CARGO_CALLSIGN_PREFIXES: ReadonlySet<string> = new Set([
  "FDX", // FedEx Express
  "UPS", // UPS Airlines
  "GTI", // Atlas Air
  "ABX", // ABX Air
  "CLX", // Cargolux
  "CKS", // Kalitta Air
  "GEC", // Lufthansa Cargo
  "PAC", // Polar Air Cargo
  "ATN", // Air Transport International
  "KYE", // Sky Lease Cargo
  "BOX", // AeroLogic
  "ABW", // AirBridgeCargo
  "QAC", // Qatar Airways Cargo
  "NCA", // Nippon Cargo Airlines
]);

/** readsb aircraft record fields this collector reads. */
interface AdsbAircraft {
  hex?: string;
  flight?: string;
}

interface AdsbPointResponse {
  ac?: AdsbAircraft[];
  total?: number;
  now?: number;
}

export interface HubCounts {
  all: number;
  cargo: number;
}

/** Callsign prefix, or null when the airframe broadcasts none. */
export function callsignPrefix(flight: string | undefined): string | null {
  const cs = (flight ?? "").trim().toUpperCase();
  if (cs.length < 3) return null;
  const pre = cs.slice(0, 3);
  return /^[A-Z]{3}$/.test(pre) ? pre : null;
}

/** Distinct airframes (by hex) and how many carry a cargo-only callsign. */
export function countAircraft(res: AdsbPointResponse, cargoPrefixes: ReadonlySet<string> = CARGO_CALLSIGN_PREFIXES): HubCounts {
  const seen = new Set<string>();
  let cargo = 0;
  for (const a of res.ac ?? []) {
    const hex = (a.hex ?? "").toLowerCase();
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    const pre = callsignPrefix(a.flight);
    if (pre && cargoPrefixes.has(pre)) cargo++;
  }
  return { all: seen.size, cargo };
}

export function adsbPointUrl(hub: CargoHub, radiusNm = HUB_RADIUS_NM): string {
  // shape per https://api.adsb.lol/docs (GET /v2/point/{lat}/{lon}/{radius}); unverified in sandbox
  return `https://api.adsb.lol/v2/point/${hub.lat.toFixed(3)}/${hub.lon.toFixed(3)}/${radiusNm}`;
}

export function hubOutputs(hub: CargoHub, counts: HubCounts, now: number): CollectorOutput[] {
  const retrievedAt = new Date(now).toISOString();
  const geo: SeriesMeta["geo"] = { kind: "point", id: hub.iata, name: hub.name, lon: hub.lon, lat: hub.lat };
  const notes = ["Community ADS-B coverage; counts what feeders near the hub hear.", "Counts only; no hex codes or callsigns are stored."];
  const all: SeriesMeta = {
    id: `snapshot:hub-aircraft:${hub.iata}`,
    title: `Aircraft within ${HUB_RADIUS_NM} nm of ${hub.name}`,
    unit: "count",
    frequency: "irregular",
    geo,
    provenance: provenance(source("adsb-lol"), { kind: "snapshot", retrievedAt, method: `distinct hex codes in one adsb.lol point query, radius ${HUB_RADIUS_NM} nm`, notes }),
    tags: ["aviation", "cargo", "hub", hub.country],
  };
  const cargo: SeriesMeta = {
    ...all,
    id: `snapshot:hub-cargo-aircraft:${hub.iata}`,
    title: `Cargo-carrier aircraft within ${HUB_RADIUS_NM} nm of ${hub.name}`,
    provenance: provenance(source("adsb-lol"), {
      kind: "snapshot",
      retrievedAt,
      method: `of the distinct hex codes, those whose callsign starts with a cargo-only ICAO designator (${[...CARGO_CALLSIGN_PREFIXES].join(", ")})`,
      notes: [...notes, "Combination carriers that fly freight under a passenger designator are not counted."],
    }),
  };
  return [
    { meta: all, points: [{ t: now, v: counts.all }] },
    { meta: cargo, points: [{ t: now, v: counts.cargo }] },
  ];
}

const ID = "cargo-flights";
const TITLE = "Aircraft at air-cargo hubs";
const CADENCE = "3h";

export const cargoFlightsCollector: Collector = {
  id: ID,
  title: TITLE,
  cadence: CADENCE,
  // 19 sequential point queries with a polite gap between them.
  timeoutMs: 90_000,
  describe() {
    return {
      id: ID,
      title: TITLE,
      cadence: CADENCE,
      seriesPrefix: "snapshot:hub-",
      sources: ["adsb-lol"],
      note: `Distinct airframes adsb.lol hears within ${HUB_RADIUS_NM} nm of ${CARGO_HUBS.length} cargo hubs, and the subset flying a cargo-only carrier callsign. Counts only.`,
    };
  },
  async collect(ctx: CollectorContext) {
    const out: CollectorOutput[] = [];
    const gap = ctx.politeDelayMs ?? 1500;
    let failures = 0;
    let lastError: unknown;
    for (let i = 0; i < CARGO_HUBS.length; i++) {
      const hub = CARGO_HUBS[i];
      if (i > 0) await sleep(gap, ctx.signal);
      try {
        const res = await ctx.fetchJson<AdsbPointResponse>(adsbPointUrl(hub), { timeoutMs: 20_000, signal: ctx.signal });
        out.push(...hubOutputs(hub, countAircraft(res), ctx.now));
      } catch (err) {
        // One hub failing (a 429, a timeout) should not lose the other 18.
        failures++;
        lastError = err;
        ctx.log?.(`cargo-flights: ${hub.iata} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failures === CARGO_HUBS.length) throw lastError instanceof Error ? lastError : new Error("every hub query failed");
    ctx.log?.(`cargo-flights: ${CARGO_HUBS.length - failures}/${CARGO_HUBS.length} hubs`);
    return out;
  },
};
