// The logic behind scripts/cite-check.mjs, kept here so a test can drive it with a fake fetch and a fake clock.
//
//   cite-check (--fixtures | --live) [--json] [input.json ...]
//
// Inputs: a recorded world fixture (lib/mcp/__fixtures__/world/*.json, with "routes"), a world_context reply
// ({payload: {topics}} or {topics}), or a v3-shaped facts file ({facts: [...]} or a bare array of items). No input = all world fixtures.
// --fixtures reads the recorded publisher replies and touches no network. --live fetches, at most 400 requests, one a second per host.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Summary } from "./citeCheck";
import { createGate, MAX_REQUESTS, type FetchDeps } from "./fetch";
import { runLive, runRecorded } from "./live";
import type { CiteItem, Verdict } from "./types";
import { WORLD_FIXTURES, worldItems } from "./worldItems";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Items from one input file, whichever of the three shapes it is. */
export async function loadItems(file: string): Promise<CiteItem[]> {
  const j: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (isObj(j) && isObj(j.routes)) return (await worldItems(file)) as CiteItem[];
  const topics = isObj(j) ? (isObj(j.payload) ? j.payload.topics : j.topics) : undefined;
  if (isObj(topics)) return Object.values(topics).flatMap((s) => (isObj(s) && Array.isArray(s.items) ? (s.items as CiteItem[]) : []));
  if (isObj(j) && Array.isArray(j.facts)) return j.facts as CiteItem[];
  if (Array.isArray(j)) return j as CiteItem[];
  throw new Error(`${file}: not a world fixture, a world_context reply or a facts file`);
}

export interface CliDeps extends Partial<FetchDeps> {
  maxRequests?: number;
}

export interface CliResult {
  code: number;
  text: string;
  verdicts: Verdict[];
  summary: Summary | null;
  byHost: Record<string, number>;
  requests: number;
  unrecorded: CiteItem[];
}

const clip = (v: unknown, n = 70): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<CliResult> {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const files = argv.filter((a) => !a.startsWith("--"));
  const empty: CliResult = { code: 2, text: "", verdicts: [], summary: null, byHost: {}, requests: 0, unrecorded: [] };
  const live = flags.has("--live");
  if (live === flags.has("--fixtures")) return { ...empty, text: "usage: node scripts/cite-check.mjs (--fixtures | --live) [--json] [input.json ...]\n" };
  const inputs = files.length ? files : readdirSync(WORLD_FIXTURES).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(WORLD_FIXTURES, f));
  const items = (await Promise.all(inputs.map(loadItems))).flat();
  const lines: string[] = [];
  let verdicts: Verdict[];
  let summary: Summary;
  let byHost: Record<string, number> = {};
  let requests = 0;
  let unrecorded: CiteItem[] = [];
  if (live) {
    if (!deps.fetchImpl || !deps.clock) throw new Error("--live needs a fetch and a clock");
    const r = await runLive(items, { fetchImpl: deps.fetchImpl, clock: deps.clock, gate: deps.gate ?? createGate(deps.clock), timeoutMs: deps.timeoutMs, maxRequests: deps.maxRequests ?? MAX_REQUESTS });
    ({ verdicts, summary, byHost, requests } = r);
  } else {
    const r = runRecorded(items);
    ({ verdicts, summary, unrecorded } = r);
  }
  for (const v of verdicts) {
    lines.push(`${v.status.padEnd(23)} ${v.sourceId} | ${clip(v.fact, 50)} | item ${clip(v.itemValue)}${v.publisherValue !== null || v.status === "CONTRADICTED" ? ` | publisher ${clip(v.publisherValue)}` : ""}${v.period ? ` (${v.period})` : ""}`);
    if (v.status !== "CONFIRMED") lines.push(`    ${v.reason}${v.recordUrl ? `\n    ${v.recordUrl}` : ""}${v.sha256 ? `\n    sha256 ${v.sha256}` : ""}`);
  }
  if (unrecorded.length) {
    lines.push("", `${unrecorded.length} item(s) with a record URL and no recorded publisher reply (not scored):`);
    for (const it of unrecorded) lines.push(`  ${it.sourceId} | ${clip(it.fact, 50)} | ${it.upstreamRecordUrl}`);
  }
  lines.push("", live ? "per host (requests made):" : "per host (items):");
  const perHost: Record<string, number> = live ? byHost : {};
  if (!live) for (const v of verdicts) if (v.recordUrl) perHost[new URL(v.recordUrl).host] = (perHost[new URL(v.recordUrl).host] ?? 0) + 1;
  for (const [h, n] of Object.entries(perHost).sort()) lines.push(`  ${h}: ${n}`);
  lines.push(
    "",
    `summary: ${summary.total} items`,
    `  CONFIRMED ${summary.byStatus.CONFIRMED}, CONTRADICTED ${summary.byStatus.CONTRADICTED}, CHANGED_SINCE_RETRIEVAL ${summary.byStatus.CHANGED_SINCE_RETRIEVAL}, NOT_PUBLISHED ${summary.byStatus.NOT_PUBLISHED}`,
    `  UNREACHABLE ${summary.byStatus.UNREACHABLE}, NO_RECORD_URL ${summary.byStatus.NO_RECORD_URL}, REFUSED ${summary.byStatus.REFUSED} (unscored: in neither the confirmed nor the wrong total)`,
    `  scored ${summary.scored}: confirmed ${summary.confirmed}, wrong ${summary.wrong}${summary.scored ? ` (${((100 * summary.confirmed) / summary.scored).toFixed(1)}% of scored confirmed)` : ""}`,
    ...(live ? [`  requests ${requests}`] : []),
  );
  return { code: 0, text: lines.join("\n") + "\n", verdicts, summary, byHost, requests, unrecorded };
}
