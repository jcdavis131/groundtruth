// The storm-events shard loaders (server only: the hazards route imports this,
// the browser never does). One static import() per state, so the bundler emits
// one chunk per shard and a cold op=history&part=storms parses only the state
// asked. lib/hazards/storms.ts holds the pure series and gate.

import type { StormShard } from "./stormBake";

export type StormLoader = () => Promise<unknown>;

/**
 * One loader per shard. Static paths, so the bundler emits one chunk per state. There is no Alaska
 * shard: every county-coded Alaska row in 1996-2026 (596) is under NCEI's own areas ("MIDDLE TANANA
 * VALLEY", "SUSITNA VALLEY"), whose code and name agree with no borough or census area.
 */
export const STORM_LOADERS: Readonly<Record<string, StormLoader>> = {
  "01": () => import("./data/storm-events/01.json"),
  "04": () => import("./data/storm-events/04.json"),
  "05": () => import("./data/storm-events/05.json"),
  "06": () => import("./data/storm-events/06.json"),
  "08": () => import("./data/storm-events/08.json"),
  "09": () => import("./data/storm-events/09.json"),
  "10": () => import("./data/storm-events/10.json"),
  "11": () => import("./data/storm-events/11.json"),
  "12": () => import("./data/storm-events/12.json"),
  "13": () => import("./data/storm-events/13.json"),
  "15": () => import("./data/storm-events/15.json"),
  "16": () => import("./data/storm-events/16.json"),
  "17": () => import("./data/storm-events/17.json"),
  "18": () => import("./data/storm-events/18.json"),
  "19": () => import("./data/storm-events/19.json"),
  "20": () => import("./data/storm-events/20.json"),
  "21": () => import("./data/storm-events/21.json"),
  "22": () => import("./data/storm-events/22.json"),
  "23": () => import("./data/storm-events/23.json"),
  "24": () => import("./data/storm-events/24.json"),
  "25": () => import("./data/storm-events/25.json"),
  "26": () => import("./data/storm-events/26.json"),
  "27": () => import("./data/storm-events/27.json"),
  "28": () => import("./data/storm-events/28.json"),
  "29": () => import("./data/storm-events/29.json"),
  "30": () => import("./data/storm-events/30.json"),
  "31": () => import("./data/storm-events/31.json"),
  "32": () => import("./data/storm-events/32.json"),
  "33": () => import("./data/storm-events/33.json"),
  "34": () => import("./data/storm-events/34.json"),
  "35": () => import("./data/storm-events/35.json"),
  "36": () => import("./data/storm-events/36.json"),
  "37": () => import("./data/storm-events/37.json"),
  "38": () => import("./data/storm-events/38.json"),
  "39": () => import("./data/storm-events/39.json"),
  "40": () => import("./data/storm-events/40.json"),
  "41": () => import("./data/storm-events/41.json"),
  "42": () => import("./data/storm-events/42.json"),
  "44": () => import("./data/storm-events/44.json"),
  "45": () => import("./data/storm-events/45.json"),
  "46": () => import("./data/storm-events/46.json"),
  "47": () => import("./data/storm-events/47.json"),
  "48": () => import("./data/storm-events/48.json"),
  "49": () => import("./data/storm-events/49.json"),
  "50": () => import("./data/storm-events/50.json"),
  "51": () => import("./data/storm-events/51.json"),
  "53": () => import("./data/storm-events/53.json"),
  "54": () => import("./data/storm-events/54.json"),
  "55": () => import("./data/storm-events/55.json"),
  "56": () => import("./data/storm-events/56.json"),
  "72": () => import("./data/storm-events/72.json"),
};

/** One state's shard. A JSON import() resolves to { default }; a missing loader or a bad shard throws (an error part, never zeros). */
export async function loadStormShard(state: string, loaders: Readonly<Record<string, StormLoader>> = STORM_LOADERS): Promise<StormShard> {
  const load = loaders[state];
  if (!load) throw new Error(`no storm-events shard for state ${state}`);
  const m = (await load()) as { default?: unknown } | null;
  const sh = (m && typeof m === "object" && "default" in m ? m.default : m) as StormShard | null;
  if (!sh || typeof sh !== "object" || !sh.counties || typeof sh.counties !== "object") throw new Error(`storm-events shard ${state} is not a shard`);
  return sh;
}
