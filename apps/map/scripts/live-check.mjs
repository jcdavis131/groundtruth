// The preview pass as a script. Against one origin (a Vercel preview, or any
// deployment) it checks, and counts each check as an assertion:
//   1. the front door: GET / answers 200 and the server HTML has an <h1>
//   2. POST /api/mcp initialize carries non-empty `instructions`
//   3. tools/list names exactly EXPECTED_TOOL_NAMES (lib/mcp/expectedTools.mjs),
//      and `_meta["anthropic/alwaysLoad"]` is true on world_context only
//   4. tools/call world_context {fips: "01097"} has the same shape as the
//      baseline reply: top-level keys, each topic's keys and item count, and
//      coverageStatus. Values may differ; shape may not.
// It prints "live-check: N assertions, M failed" and exits 1 on any failure.
// Before the checks it prints one run-id line, "live-check-run: <origin>
// ref=<ref|none> at=<ISO time>", which a merge's ledger row records.
//
//   node scripts/live-check.mjs <origin> [--cookie-jar <file>] [--bypass-header]
//        [--baseline <file | origin>] [--record-baseline <file>]
//        [--ref <deployment id | head sha>]
//
// --cookie-jar     a Netscape cookie-jar file (curl -c); its cookies for the
//                  origin's host ride on every request (the share-link cookie).
// --bypass-header  sends x-vercel-protection-bypass with the value of the
//                  VERCEL_AUTOMATION_BYPASS_SECRET env var (never a flag value,
//                  so the secret stays out of the process list and the log).
// --baseline       where "master's reply" comes from: a JSON shape file (default
//                  scripts/live-check.baseline.01097.json) or, if it starts with
//                  http, an origin whose world_context reply is fetched live now
//                  (production serves master).
// --record-baseline  fetch world_context from <origin> and write its shape to
//                  the file, with the origin and time, then exit.
// --ref            what this run checked, printed in the run-id line (the
//                  preview's deployment id, dpl_..., or the PR head sha);
//                  "none" when not given.
//
// Plain node, no dependencies. docs/PREVIEW-CHECK.md says how the loop runs it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_TOOL_NAMES } from "../lib/mcp/expectedTools.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = path.join(HERE, "live-check.baseline.01097.json");
const UA = "groundtruth-live-check/1 (preview pass; https://github.com/jcdavis131/groundtruth)";
const FIPS = "01097";

/** Cookie header value for `host` from a Netscape cookie-jar text; "" when none match. */
export function cookieHeaderFor(jar, host) {
  const out = [];
  for (let line of jar.split(/\r?\n/)) {
    if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length);
    else if (!line.trim() || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 7) continue;
    const dom = f[0].replace(/^\./, "").toLowerCase();
    const h = host.toLowerCase();
    if (h === dom || h.endsWith("." + dom)) out.push(`${f[5]}=${f[6]}`);
  }
  return out.join("; ");
}

/** The structure of a world_context reply: keys, each topic's keys and item count, coverageStatus. */
export function shapeOf(reply) {
  const topics = {};
  for (const [k, v] of Object.entries(reply.topics ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.items)) {
      topics[k] = { keys: Object.keys(v).sort(), items: v.items.length };
    }
  }
  return {
    keys: Object.keys(reply).sort(),
    topics,
    coverageStatus: reply.coverageStatus && typeof reply.coverageStatus === "object" ? reply.coverageStatus.status ?? null : null,
  };
}

/** Differences between a baseline shape and a candidate shape, as sentences; [] when equal. */
export function diffShape(base, cand) {
  const d = [];
  for (const k of base.keys) if (!cand.keys.includes(k)) d.push(`top-level key "${k}" missing from the reply`);
  for (const k of cand.keys) if (!base.keys.includes(k)) d.push(`top-level key "${k}" is not in the baseline`);
  for (const [t, b] of Object.entries(base.topics)) {
    const c = cand.topics[t];
    if (!c) { d.push(`topic ${t}: absent from the reply`); continue; }
    if (b.items !== c.items) d.push(`topic ${t}: ${c.items} items, baseline ${b.items}`);
    if (b.keys.join() !== c.keys.join()) d.push(`topic ${t}: keys [${c.keys}] vs baseline [${b.keys}]`);
  }
  for (const t of Object.keys(cand.topics)) if (!base.topics[t]) d.push(`topic ${t}: not in the baseline`);
  if ((base.coverageStatus ?? null) !== (cand.coverageStatus ?? null)) d.push(`coverageStatus ${cand.coverageStatus} vs baseline ${base.coverageStatus}`);
  return d;
}

async function rpc(origin, headers, method, params, id) {
  const res = await fetch(origin + "/api/mcp", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the caller reports a non-JSON answer */ }
  return { status: res.status, json, text };
}

async function worldReply(origin, headers) {
  const r = await rpc(origin, headers, "tools/call", { name: "world_context", arguments: { fips: FIPS } }, 4);
  const res = r.json?.result;
  if (r.status !== 200 || !res || res.isError) return { error: `HTTP ${r.status}${res?.isError ? ", isError: " + String(res.content?.[0]?.text).slice(0, 160) : ""}` };
  const reply = res.structuredContent ?? (() => { try { return JSON.parse(res.content[0].text); } catch { return null; } })();
  return reply ? { reply } : { error: "no structuredContent or JSON text in the reply" };
}

/**
 * Run the checks. opts: origin, ref (deployment id or head sha, printed in the run-id line), baseline (a shape object), cookieHeader, bypassSecret, log.
 * Returns { assertions, failures, exitCode }.
 */
export async function liveCheck(opts) {
  const origin = opts.origin.replace(/\/+$/, "");
  const log = opts.log ?? console.log;
  const headers = { "user-agent": UA };
  if (opts.cookieHeader) headers.cookie = opts.cookieHeader;
  if (opts.bypassSecret) headers["x-vercel-protection-bypass"] = opts.bypassSecret;
  const assertions = [];
  const failures = [];
  const check = (name, ok, detail = "") => {
    assertions.push({ name, ok, detail });
    log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ": " + detail : ""}`);
    if (!ok) failures.push(`${name}${detail ? ": " + detail : ""}`);
  };

  // The run id: the one line a merge's ledger row records.
  log(`live-check-run: ${origin} ref=${opts.ref || "none"} at=${new Date().toISOString()}`);

  // 1. front door
  try {
    const r = await fetch(origin + "/", { headers: { ...headers, accept: "text/html" } });
    const html = await r.text();
    check("front door: GET / answers 200", r.status === 200, `HTTP ${r.status}`);
    check("front door: the server HTML has an <h1>", /<h1[\s>]/i.test(html), r.status === 200 ? "no <h1> in the HTML" : "page not served");
  } catch (e) {
    check("front door: GET / answers 200", false, String(e));
    check("front door: the server HTML has an <h1>", false, "page not fetched");
  }

  // 2. initialize
  let init;
  try { init = await rpc(origin, headers, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "live-check", version: "1" } }, 1); } catch (e) { init = { status: 0, json: null, text: String(e) }; }
  check("mcp: initialize answers 200 with a JSON-RPC result", init.status === 200 && !!init.json?.result, `HTTP ${init.status}`);
  const ins = init.json?.result?.instructions;
  check("mcp: initialize carries instructions", typeof ins === "string" && ins.trim().length > 0, "instructions missing or empty");

  // 3. tools/list
  let tools;
  try { tools = await rpc(origin, headers, "tools/list", {}, 2); } catch (e) { tools = { status: 0, json: null, text: String(e) }; }
  const list = tools.json?.result?.tools;
  check("mcp: tools/list answers 200 with a tools array", tools.status === 200 && Array.isArray(list), `HTTP ${tools.status}`);
  if (Array.isArray(list)) {
    const names = list.map((t) => t.name);
    const missing = EXPECTED_TOOL_NAMES.filter((n) => !names.includes(n));
    const extra = names.filter((n) => !EXPECTED_TOOL_NAMES.includes(n));
    check(`mcp: all ${EXPECTED_TOOL_NAMES.length} expected tool names are listed`, missing.length === 0, `missing: ${missing.join(", ")}`);
    check("mcp: no tool outside EXPECTED_TOOL_NAMES is listed", extra.length === 0, `unexpected: ${extra.join(", ")}`);
    const al = list.filter((t) => t._meta?.["anthropic/alwaysLoad"] === true).map((t) => t.name);
    check("mcp: alwaysLoad is on exactly world_context", al.length === 1 && al[0] === "world_context", `alwaysLoad on: [${al.join(", ")}]`);
  }

  // 4. world_context vs the baseline
  let w;
  try { w = await worldReply(origin, headers); } catch (e) { w = { error: String(e) }; }
  check(`world_context ${FIPS}: answers without isError`, !w.error, w.error);
  if (w.reply) {
    const d = diffShape(opts.baseline, shapeOf(w.reply));
    check(`world_context ${FIPS}: same keys, item counts and coverageStatus as the baseline`, d.length === 0, d.join("; "));
  }

  log(`live-check: ${assertions.length} assertions, ${failures.length} failed (${origin})`);
  return { assertions, failures, exitCode: failures.length ? 1 : 0 };
}

async function main(argv) {
  const args = argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const jar = take("--cookie-jar");
  const baselineArg = take("--baseline");
  const record = take("--record-baseline");
  const ref = take("--ref");
  const useBypass = args.includes("--bypass-header");
  const origin = args.find((a) => /^https?:\/\//.test(a));
  if (!origin) { console.error("usage: node scripts/live-check.mjs <origin> [--cookie-jar <file>] [--bypass-header] [--baseline <file|origin>] [--record-baseline <file>] [--ref <deployment id or head sha>]"); return 2; }
  const host = new URL(origin).hostname;
  const cookieHeader = jar ? cookieHeaderFor(fs.readFileSync(jar, "utf8"), host) : "";
  if (jar && !cookieHeader) console.error(`warning: the cookie jar has no cookie for ${host}`);
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (useBypass && !secret) { console.error("--bypass-header needs VERCEL_AUTOMATION_BYPASS_SECRET in the environment"); return 2; }
  const headersFor = (cookie, bypass) => ({ "user-agent": UA, ...(cookie ? { cookie } : {}), ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) });

  if (record) {
    const w = await worldReply(origin.replace(/\/+$/, ""), headersFor(cookieHeader, useBypass ? secret : ""));
    if (!w.reply) { console.error("could not record: " + w.error); return 1; }
    fs.writeFileSync(record, JSON.stringify({ recordedFrom: origin, recordedAt: new Date().toISOString(), fips: FIPS, shape: shapeOf(w.reply) }, null, 2) + "\n");
    console.log(`recorded the ${FIPS} shape from ${origin} to ${record}`);
    return 0;
  }

  let baseline;
  if (baselineArg && /^https?:\/\//.test(baselineArg)) {
    // Master's reply, live: the baseline origin (production) is not behind the preview's protection.
    const w = await worldReply(baselineArg.replace(/\/+$/, ""), headersFor("", ""));
    if (!w.reply) { console.error(`baseline origin ${baselineArg}: ${w.error}`); return 2; }
    baseline = shapeOf(w.reply);
  } else {
    const file = baselineArg ?? DEFAULT_BASELINE;
    if (!fs.existsSync(file)) { console.error(`no baseline at ${file}; pass --baseline <file|origin> or record one with --record-baseline`); return 2; }
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    baseline = j.shape ?? j;
  }
  const r = await liveCheck({ origin, baseline, cookieHeader, bypassSecret: useBypass ? secret : "", ref });
  return r.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 2; });
}
