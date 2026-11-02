#!/usr/bin/env node
// Refresh for the animated flow layers (lib/layers/flows.ts: "windflow" and
// "oceanflow"). One run refreshes one layer:
//
//   wind      10 m wind (u/v, m/s) from Open-Meteo's forecast API (GFS under
//             the hood), 5-degree grid, 35 x 72 = 2,520 points.
//   currents  ocean surface currents (u/v, m/s) and sea-surface temperature
//             (degC) from Open-Meteo's marine API, 4-degree grid, 41 x 90 =
//             3,690 points. Land cells come back null and stay null in the
//             bundle (never zero-filled: zero would read as "calm water").
//
//   node scripts/flows-data.mjs [--layer auto|wind|currents] [--dry-run]
//                               [--call-log <file>] [--data-dir <dir>]
//
// --layer auto (the default) refreshes the layer whose bundle has the older
// as-of. A tie goes to wind; a missing or unreadable bundle counts as the
// oldest. The bundle, lib/flows/data/<layer>.json, is written atomically (tmp
// + rename) and only after the whole grid arrived and passed its checks: a
// stop or a failure leaves the committed bundles as they were.
//
// Cadence and limits. Open-Meteo's free tier counts each location of a
// multi-location request as one call, and allows 600 calls a minute, 5,000 an
// hour and 10,000 a day (Open-Meteo's post "Weather data for multiple
// locations", openmeteo.substack.com). The two layers together are 6,210
// calls, more than one hour allows, so a run fetches one layer and the cron
// runs every 12 h with --layer auto: each layer refreshes once a day, 6,210
// calls a day. The pacer sends 100 locations per request and holds a run to:
//
//   minute  at most 500 locations in any 62 s (the limit is 600; the extra
//           2 s absorbs network jitter), spread evenly: after a request of n
//           locations the next one waits n x 124 ms (12.4 s per 100)
//   hour    at most 4,500 locations in any 60 min (the limit is 5,000)
//   day     at most 9,500 locations in any 24 h (the limit is 10,000)
//   time    no request starts later than 20 min into the run (a wind run
//           takes about 5 min, a currents run about 8)
//
// The windows count earlier runs too. Every request is logged before it is
// sent, one JSON line, to a call log outside the repo: --call-log, else
// $FLOWS_CALL_LOG, else groundtruth/flows-data-calls.jsonl under
// $XDG_STATE_HOME or ~/.local/state. Before its first request a run plans its
// whole schedule against that log; a plan that cannot finish inside the
// guards sends nothing and exits 44.
//
// Stops. The first HTTP 429, any 403, or a 503 that carries Retry-After ends
// the run at once: no retry, nothing written, exit 42. A dropped socket, a
// timeout or another 5xx is retried at most twice per request and four times
// per run, each retry paced and logged like a new request.
//
// Exit codes:
//   0   one layer refreshed and written
//   1   failed (network, reply shape, too many missing cells); nothing written
//   2   bad arguments
//   42  the provider said stop (429, 403, or 503 with Retry-After); nothing
//       written; do not retry the run
//   44  no room under the guards above; nothing written
//
// --dry-run reads the bundles and the call log, prints the plan (layer,
// requests, send times, peak load per window) and exits 0, or 44 when a live
// run would be refused. It makes no network call and writes nothing.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(HERE, "..", "lib", "flows", "data");

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, USAGE: 2, PROVIDER_STOP: 42, GUARD: 44 });

const MINUTE = Object.freeze({ name: "minute", ms: 62_000, max: 500 });
export const LIMITS = Object.freeze({
  batch: 100, // locations per Open-Meteo request
  windows: Object.freeze([
    MINUTE,
    Object.freeze({ name: "hour", ms: 3_600_000, max: 4_500 }),
    Object.freeze({ name: "day", ms: 86_400_000, max: 9_500 }),
  ]),
  // Even spacing at the minute window's rate: 62 s / 500 locations = 124 ms a location.
  spacingMsPerLocation: MINUTE.ms / MINUTE.max,
  runMs: 20 * 60_000,
  retriesPerRequest: 2,
  retriesPerRun: 4,
  requestTimeoutMs: 60_000,
});

export const LAYERS = Object.freeze({
  wind: Object.freeze({
    file: "wind.json",
    url: "https://api.open-meteo.com/v1/forecast",
    params: "current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&forecast_days=1&timezone=UTC",
    grid: Object.freeze({ lat0: -85, lat1: 85, dlat: 5, lon0: -180, lon1: 175, dlon: 5 }),
  }),
  currents: Object.freeze({
    file: "currents.json",
    url: "https://marine-api.open-meteo.com/v1/marine",
    params: "current=ocean_current_velocity,ocean_current_direction,sea_surface_temperature&timezone=UTC",
    grid: Object.freeze({ lat0: -80, lat1: 80, dlat: 4, lon0: -180, lon1: 176, dlon: 4 }),
  }),
});
export const LAYER_NAMES = Object.keys(LAYERS);

const USAGE =
  "usage: node scripts/flows-data.mjs [--layer auto|wind|currents] [--dry-run] [--call-log <file>] [--data-dir <dir>]";
const fmt = (n) => n.toLocaleString("en-US");
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const msg = (e) => (e instanceof Error ? e.message : String(e));

/** Grid points of a layer in row-major (lat-major) order, as [lat, lon]. */
export function gridPoints(layer) {
  const { lat0, lat1, dlat, lon0, lon1, dlon } = LAYERS[layer].grid;
  const lats = [];
  for (let la = lat0; la <= lat1 + 1e-9; la += dlat) lats.push(Math.round(la * 1e6) / 1e6);
  const lons = [];
  for (let lo = lon0; lo <= lon1 + 1e-9; lo += dlon) lons.push(Math.round(lo * 1e6) / 1e6);
  const flat = [];
  for (const la of lats) for (const lo of lons) flat.push([la, lo]);
  return { flat, nlat: lats.length, nlon: lons.length };
}

/** Request sizes for n locations, `batch` to a request. */
export function requestSizes(n, batch = LIMITS.batch) {
  const sizes = [];
  for (let i = 0; i < n; i += batch) sizes.push(Math.min(batch, n - i));
  return sizes;
}

/** Meteorological "from" direction + speed -> east/north components. */
function uv(speed, dirDeg) {
  if (speed == null || dirDeg == null) return [null, null];
  const r = (dirDeg * Math.PI) / 180;
  const q = (x) => Math.round(x * 100) / 100;
  return [q(-speed * Math.sin(r)), q(-speed * Math.cos(r))];
}

const stamp = (time, now) => (time ? `${time}:00Z`.replace(" ", "T") : new Date(now).toISOString());

/** The bundle for one layer from its `current` rows (row-major). Throws when too much is missing. */
export function buildBundle(layer, cur, nlat, nlon, now) {
  const g = LAYERS[layer].grid;
  const grid = { lat0: g.lat0, lon0: g.lon0, dlat: g.dlat, dlon: g.dlon, nlat, nlon };
  const u = new Array(cur.length);
  const v = new Array(cur.length);
  let time = null;
  if (layer === "wind") {
    cur.forEach((c, i) => {
      [u[i], v[i]] = uv(c?.wind_speed_10m ?? null, c?.wind_direction_10m ?? null);
      if (!time && c?.time) time = c.time;
    });
    const missing = u.filter((x) => x == null).length;
    if (missing > u.length * 0.05) throw new Error(`wind grid ${missing}/${u.length} missing — aborting`);
    return { asof: stamp(time, now), source: "Open-Meteo (GFS 10 m wind)", grid, u, v };
  }
  // The marine API gives velocity in km/h.
  const sst = new Array(cur.length);
  cur.forEach((c, i) => {
    const ms = c?.ocean_current_velocity == null ? null : c.ocean_current_velocity / 3.6;
    [u[i], v[i]] = uv(ms, c?.ocean_current_direction ?? null);
    sst[i] = c?.sea_surface_temperature == null ? null : Math.round(c.sea_surface_temperature * 10) / 10;
    if (!time && c?.time) time = c.time;
  });
  const have = u.filter((x) => x != null).length;
  if (have < cur.length * 0.2) throw new Error(`currents grid only ${have}/${cur.length} ocean cells — aborting`);
  return { asof: stamp(time, now), source: "Open-Meteo Marine (ocean currents + SST)", grid, u, v, sst };
}

/** A bundle's as-of: the string, and its time in ms (-Infinity when missing, unreadable or undated). */
export function bundleAsof(dataDir, layer) {
  try {
    const j = JSON.parse(readFileSync(path.join(dataDir, LAYERS[layer].file), "utf8"));
    const ms = Date.parse(j?.asof);
    return { asof: typeof j?.asof === "string" ? j.asof : null, ms: Number.isFinite(ms) ? ms : -Infinity };
  } catch {
    return { asof: null, ms: -Infinity };
  }
}

/** Which layer a run refreshes: the one asked for, or for "auto" the one with the older as-of. */
export function pickLayer(choice, dataDir) {
  const wind = bundleAsof(dataDir, "wind");
  const currents = bundleAsof(dataDir, "currents");
  if (choice !== "auto") return { layer: choice, wind, currents, why: `--layer ${choice}` };
  const layer = currents.ms < wind.ms ? "currents" : "wind";
  const why = currents.ms === wind.ms ? "auto, a tie goes to wind" : `auto, ${layer} has the older as-of`;
  return { layer, wind, currents, why };
}

/**
 * Where the call log lives when --call-log is not given.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [home]
 */
export function defaultCallLog(env = process.env, home = os.homedir()) {
  if (env.FLOWS_CALL_LOG) return env.FLOWS_CALL_LOG;
  const state = env.XDG_STATE_HOME || path.join(home, ".local", "state");
  return path.join(state, "groundtruth", "flows-data-calls.jsonl");
}

const KEEP_MS = 2 * 86_400_000; // two days; the longest window is one

/** Calls in the log from the last two days, oldest first, and the count of unreadable lines. */
export function readCallLog(file, now) {
  if (!existsSync(file)) return { calls: [], bad: 0 };
  const calls = [];
  let bad = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      bad++;
      continue;
    }
    const at = Date.parse(j?.at);
    const locations = j?.locations;
    if (!Number.isFinite(at) || !Number.isInteger(locations) || locations < 0) {
      bad++;
      continue;
    }
    if (at > now - KEEP_MS) calls.push({ at, locations, layer: j.layer, host: j.host });
  }
  calls.sort((a, b) => a.at - b.at);
  return { calls, bad };
}

const logLine = (c) =>
  `${JSON.stringify({ at: new Date(c.at).toISOString(), layer: c.layer, host: c.host, locations: c.locations })}\n`;

/** Rewrite the log with only the kept calls (tmp + rename), creating its folder. */
function pruneCallLog(file, calls) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, calls.map(logLine).join(""));
  renameSync(tmp, file);
}

/**
 * The earliest time at or after `notBefore` that a request of `n` locations may start without
 * breaking a window or the even spacing, given `calls` (every logged and sent call, oldest first).
 * Infinity when n alone is over a window's cap. Pure.
 */
export function earliestStart(calls, n, notBefore, limits = LIMITS) {
  let t = notBefore;
  const last = calls[calls.length - 1];
  if (last) t = Math.max(t, last.at + last.locations * limits.spacingMsPerLocation);
  for (const w of limits.windows) {
    if (n > w.max) return Infinity;
    // A call is inside the window at t while t - w.ms < its time; it leaves at its time + w.ms.
    const inside = calls.filter((c) => c.at > t - w.ms);
    let sum = inside.reduce((s, c) => s + c.locations, 0);
    let k = 0;
    while (sum + n > w.max) sum -= inside[k++].locations;
    if (k > 0) t = Math.max(t, inside[k - 1].at + w.ms);
  }
  return t;
}

/** Locations sent in (t - ms, t]. */
function load(calls, t, ms) {
  let s = 0;
  for (const c of calls) if (c.at > t - ms && c.at <= t) s += c.locations;
  return s;
}

/** A run's send times planned against the log, with instant replies and no retries. Pure. */
export function planRun(calls, sizes, start, limits = LIMITS) {
  const all = calls.slice();
  const sends = [];
  let t = start;
  for (const n of sizes) {
    t = earliestStart(all, n, t, limits);
    if (!Number.isFinite(t)) break;
    sends.push({ at: t, locations: n });
    all.push({ at: t, locations: n });
  }
  const complete = sends.length === sizes.length;
  const lastAt = complete && sends.length ? sends[sends.length - 1].at : Infinity;
  const peaks = {};
  for (const w of limits.windows) peaks[w.name] = Math.max(0, ...sends.map((s) => load(all, s.at, w.ms)));
  return { start, sends, lastAt, ms: lastAt - start, ok: complete && lastAt - start <= limits.runMs, peaks };
}

/** Why a reply ends the run with no retry, or null. */
function stopReason(res) {
  if (res.status === 429) return "HTTP 429";
  if (res.status === 403) return "HTTP 403";
  if (res.status === 503 && res.headers.get("retry-after") != null) return "HTTP 503 with Retry-After";
  return null;
}

async function bodyText(res) {
  try {
    return (await res.text()).replace(/\s+/g, " ").slice(0, 200);
  } catch {
    return "";
  }
}

const netError = (e) => e?.cause?.code || e?.name || msg(e);

function writeBundle(dataDir, file, bundle) {
  mkdirSync(dataDir, { recursive: true });
  const text = JSON.stringify(bundle);
  const dst = path.join(dataDir, file);
  const tmp = `${dst}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, dst);
  return { dst, bytes: Buffer.byteLength(text) };
}

/**
 * Refresh one layer, or plan it (opts.dryRun). Returns the exit code.
 *   opts: { layer: "auto" | "wind" | "currents", dryRun, callLog, dataDir }
 *   deps: { fetch, now, sleep, out, err, timeoutSignal? }
 */
export async function refresh(opts, deps) {
  const { out, err } = deps;
  const pick = pickLayer(opts.layer, opts.dataDir);
  const name = pick.layer;
  const L = LAYERS[name];
  const host = new URL(L.url).host;
  const { flat, nlat, nlon } = gridPoints(name);
  const sizes = requestSizes(flat.length);
  const t0 = deps.now();

  let log;
  try {
    log = readCallLog(opts.callLog, t0);
  } catch (e) {
    err(`flows-data FAILED: cannot read the call log ${opts.callLog}: ${msg(e)}; nothing sent`);
    return EXIT.FAILED;
  }
  const plan = planRun(log.calls, sizes, t0);
  const dayAgo = log.calls.filter((c) => c.at > t0 - 86_400_000).reduce((s, c) => s + c.locations, 0);
  out(
    `flows-data${opts.dryRun ? " dry run (no network call, nothing written)" : ""}: ${name} (${pick.why}; ` +
      `wind as-of ${pick.wind.asof ?? "none"}, currents as-of ${pick.currents.asof ?? "none"})`,
  );
  out(`  ${fmt(flat.length)} locations in ${sizes.length} requests of up to ${LIMITS.batch} to ${host}`);
  out(
    `  call log ${opts.callLog}: ${fmt(dayAgo)} locations sent in the last 24 h` +
      (log.bad ? `; ${log.bad} unreadable lines skipped` : ""),
  );
  const peaks = LIMITS.windows.map((w) => `${w.name} ${fmt(plan.peaks[w.name])}/${fmt(w.max)}`).join(", ");
  out(
    `  plan: ${plan.ok ? `last request at +${secs(plan.ms)} (budget ${secs(LIMITS.runMs)})` : "does not fit inside the guards"}` +
      `; peak load with this run: ${peaks}`,
  );

  if (opts.dryRun) {
    plan.sends.forEach((s, i) =>
      out(`  request ${String(i + 1).padStart(2)}  +${secs(s.at - t0).padStart(8)}  ${s.locations} locations`),
    );
    out("  network calls: 0");
    return plan.ok ? EXIT.OK : EXIT.GUARD;
  }
  if (!plan.ok) {
    err(
      `flows-data GUARD: the ${name} run (${fmt(flat.length)} locations) cannot finish inside the minute/hour/day ` +
        `guards within ${secs(LIMITS.runMs)}, counting the call log; nothing sent, nothing written (exit 44)`,
    );
    return EXIT.GUARD;
  }
  try {
    pruneCallLog(opts.callLog, log.calls);
  } catch (e) {
    err(`flows-data FAILED: cannot write the call log ${opts.callLog}: ${msg(e)}; nothing sent`);
    return EXIT.FAILED;
  }

  const calls = log.calls.slice();
  const cur = new Array(flat.length);
  let retries = 0;
  let requests = 0;
  let i = 0;
  for (let r = 0; r < sizes.length; r++) {
    const slice = flat.slice(i, i + sizes[r]);
    const url =
      `${L.url}?latitude=${slice.map((p) => p[0].toFixed(2)).join(",")}` +
      `&longitude=${slice.map((p) => p[1].toFixed(2)).join(",")}&${L.params}`;
    const which = `request ${r + 1} of ${sizes.length} (${name})`;
    let body;
    for (let attempt = 0; ; attempt++) {
      const at = earliestStart(calls, slice.length, deps.now());
      if (!Number.isFinite(at) || at - t0 > LIMITS.runMs) {
        err(`flows-data GUARD: no room for ${which} inside the guards within ${secs(LIMITS.runMs)}; nothing written (exit 44)`);
        return EXIT.GUARD;
      }
      const wait = at - deps.now();
      if (wait > 0) await deps.sleep(wait);
      const call = { at: deps.now(), layer: name, host, locations: slice.length };
      try {
        appendFileSync(opts.callLog, logLine(call));
      } catch (e) {
        err(`flows-data FAILED: cannot write the call log ${opts.callLog}: ${msg(e)}; nothing written`);
        return EXIT.FAILED;
      }
      calls.push(call);
      requests++;
      const canRetry = attempt < LIMITS.retriesPerRequest && retries < LIMITS.retriesPerRun;
      let res;
      try {
        res = await deps.fetch(url, {
          headers: { "user-agent": "eye.jcamd.com flows-data" },
          signal: deps.timeoutSignal?.(LIMITS.requestTimeoutMs),
        });
      } catch (e) {
        if (canRetry) {
          retries++;
          out(`  ${which}: ${netError(e)}; retry ${attempt + 1} of ${LIMITS.retriesPerRequest}`);
          continue;
        }
        err(`flows-data FAILED: ${which}: ${netError(e)}, out of retries; nothing written`);
        return EXIT.FAILED;
      }
      const stop = stopReason(res);
      if (stop) {
        const ra = res.headers.get("retry-after");
        err(
          `flows-data STOP: ${stop} from ${host} on ${which}${ra != null ? `, Retry-After ${ra}` : ""}: ` +
            `${await bodyText(res)} -- hard stop, no retry, nothing written (exit 42)`,
        );
        return EXIT.PROVIDER_STOP;
      }
      if (res.ok) {
        try {
          body = await res.json();
        } catch (e) {
          err(`flows-data FAILED: ${which}: the reply is not JSON (${msg(e)}); nothing written`);
          return EXIT.FAILED;
        }
        break;
      }
      if (res.status >= 500 && canRetry) {
        retries++;
        out(`  ${which}: HTTP ${res.status}; retry ${attempt + 1} of ${LIMITS.retriesPerRequest}`);
        continue;
      }
      err(`flows-data FAILED: HTTP ${res.status} from ${host} on ${which}: ${await bodyText(res)}; nothing written`);
      return EXIT.FAILED;
    }
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length !== slice.length) {
      err(`flows-data FAILED: ${which}: expected ${slice.length} locations, got ${rows.length}; nothing written`);
      return EXIT.FAILED;
    }
    rows.forEach((row, k) => {
      cur[i + k] = row?.current ?? null;
    });
    i += slice.length;
    if ((r + 1) % 10 === 0 || r + 1 === sizes.length) out(`  …${i}/${flat.length} (+${secs(deps.now() - t0)})`);
  }

  let bundle;
  try {
    bundle = buildBundle(name, cur, nlat, nlon, deps.now());
  } catch (e) {
    err(`flows-data FAILED: ${msg(e)}; nothing written`);
    return EXIT.FAILED;
  }
  const { dst, bytes } = writeBundle(opts.dataDir, L.file, bundle);
  out(
    `flows-data: ${name} refreshed, ${requests} requests (${retries} retries) for ${fmt(flat.length)} locations ` +
      `in ${secs(deps.now() - t0)}; wrote ${dst} (${(bytes / 1024).toFixed(1)} KB, as-of ${bundle.asof})`,
  );
  return EXIT.OK;
}

/** Parse the command line. Throws on a bad argument. */
export function parseArgs(argv) {
  const opts = { layer: "auto", dryRun: false, callLog: null, dataDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--layer") opts.layer = value();
    else if (a.startsWith("--layer=")) opts.layer = a.slice("--layer=".length);
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--call-log") opts.callLog = value();
    else if (a === "--data-dir") opts.dataDir = value();
    else if (a === "-h" || a === "--help") opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!["auto", ...LAYER_NAMES].includes(opts.layer)) {
    throw new Error(`--layer must be auto, wind or currents, not ${JSON.stringify(opts.layer)}`);
  }
  return opts;
}

/** The command line. `deps` replaces the network, the clock and the output in tests. */
export async function main(argv, deps = {}) {
  const out = deps.out ?? ((s) => console.log(s));
  const err = deps.err ?? ((s) => console.error(s));
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    err(`flows-data: ${msg(e)}`);
    err(USAGE);
    return EXIT.USAGE;
  }
  if (opts.help) {
    out(USAGE);
    return EXIT.OK;
  }
  return refresh(
    { ...opts, callLog: opts.callLog ?? defaultCallLog(), dataDir: opts.dataDir ?? DATA_DIR },
    {
      fetch: deps.fetch ?? ((url, init) => globalThis.fetch(url, init)),
      now: deps.now ?? (() => Date.now()),
      sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      timeoutSignal: deps.timeoutSignal ?? ((ms) => AbortSignal.timeout(ms)),
      out,
      err,
    },
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`flows-data FAILED: ${msg(e)}`);
      process.exitCode = EXIT.FAILED;
    },
  );
}
