// The items world_context emits for one recorded world fixture (lib/mcp/__fixtures__/world/*.json), with no network:
// the fixture's recorded routes stand in for the app's own API, as scripts/world-record.mjs recorded them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toolByName, type CountyPoint, type JsonReply } from "../mcp/tools";
import { worldContext, type WorldInput, type WorldItem } from "../mcp/world";

export const WORLD_FIXTURES = fileURLToPath(new URL("../mcp/__fixtures__/world/", import.meta.url));

interface CountyTable {
  rows: Array<{ geoid: string; lon: number; lat: number }>;
  meta: { pulled?: string | null };
}

let counties: CountyTable | null = null;

function countyPoint(fips: string): CountyPoint | null {
  if (!counties) counties = JSON.parse(readFileSync(fileURLToPath(new URL("../places/data/counties.json", import.meta.url)), "utf8")) as CountyTable;
  const c = counties.rows.find((r) => r.geoid === fips);
  return c ? { lon: c.lon, lat: c.lat, pulled: counties.meta.pulled ?? null } : null;
}

export async function worldItems(file: string): Promise<WorldItem[]> {
  const fx = JSON.parse(readFileSync(file, "utf8")) as { input: unknown; routes: Record<string, { status: number; body: unknown }> };
  const fetchJson = async (p: string): Promise<JsonReply> => {
    const r = fx.routes[p];
    if (!r) return { status: 404, body: { error: "non-JSON reply" }, url: "http://t" + p };
    return { status: r.status, body: structuredClone(r.body), url: "http://t" + p };
  };
  const tool = toolByName("world_context");
  if (!tool) throw new Error("the world_context tool is not registered");
  const input = tool.inputSchema.parse(fx.input) as WorldInput;
  const reply = await worldContext(input, { fetchJson, countyPoint });
  const topics = (reply.payload.topics ?? {}) as Record<string, { items?: WorldItem[] }>;
  return Object.values(topics).flatMap((s) => s.items ?? []);
}
