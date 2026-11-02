// Tests for scripts/flows-data.mjs, run with a fake clock and a fake Open-Meteo:
// no request leaves the machine. The global fetch is stubbed to throw, so a call
// that slips past the fake fails the test instead of reaching the provider.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXIT,
  LIMITS,
  defaultCallLog,
  earliestStart,
  gridPoints,
  main,
  parseArgs,
  pickLayer,
  planRun,
  readCallLog,
  requestSizes,
} from "./flows-data.mjs";

const APP = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join(APP, "scripts", "flows-data.mjs");
const COMMITTED = path.join(APP, "lib", "flows", "data");
const T0 = Date.parse("2026-11-02T20:22:00Z");
const SEC = 1_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WIND_HOST = "api.open-meteo.com";
const MARINE_HOST = "marine-api.open-meteo.com";

type Call = { at: number; locations: number };
type Sent = Call & { host: string };
type Clock = { now: () => number; sleep: (ms: number) => Promise<void>; advance: (ms: number) => void };

/** A clock that moves only when the code sleeps or a fake reply takes time. */
function fakeClock(start = T0): Clock {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += Math.max(0, ms);
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** Open-Meteo's `current.time`: the 15-minute slot, as "YYYY-MM-DDTHH:MM". */
const slotOf = (ms: number) => new Date(Math.floor(ms / (15 * MIN)) * 15 * MIN).toISOString().slice(0, 16);

/** Rows like Open-Meteo's for the locations in a request URL. Currents have land (null) cells. */
function rowsFor(url: URL, time: string) {
  const lats = (url.searchParams.get("latitude") ?? "").split(",").map(Number);
  const lons = (url.searchParams.get("longitude") ?? "").split(",").map(Number);
  return lats.map((latitude, i) => {
    const longitude = lons[i];
    if (url.host === WIND_HOST) {
      return { latitude, longitude, current: { time, wind_speed_10m: 5, wind_direction_10m: 270 } };
    }
    const land = Math.abs(latitude) > 60 && longitude > 0;
    return {
      latitude,
      longitude,
      current: land
        ? { time, ocean_current_velocity: null, ocean_current_direction: null, sea_surface_temperature: null }
        : { time, ocean_current_velocity: 1.8, ocean_current_direction: 90, sea_surface_temperature: 15.04 },
    };
  });
}

/**
 * A fake Open-Meteo on the fake clock. Each request is recorded with its send time and size, then
 * takes `latencyMs`. `reply(n)` can replace the n-th reply (1-based) with a Response or an Error.
 */
function fakeOpenMeteo(clock: Clock, opts: { latencyMs?: number; reply?: (n: number) => Response | Error | undefined } = {}) {
  const sent: Sent[] = [];
  const fetch = async (input: string | URL): Promise<Response> => {
    const url = new URL(String(input));
    sent.push({ at: clock.now(), locations: (url.searchParams.get("latitude") ?? "").split(",").length, host: url.host });
    clock.advance(opts.latencyMs ?? 700);
    const over = opts.reply?.(sent.length);
    if (over instanceof Error) throw over;
    if (over) return over;
    return new Response(JSON.stringify(rowsFor(url, slotOf(clock.now()))), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, sent };
}

/** The most locations sent in any window of `ms`. The busiest window always starts at a send. */
function busiest(calls: Call[], ms: number): number {
  let max = 0;
  for (const a of calls) {
    let sum = 0;
    for (const b of calls) if (b.at >= a.at && b.at < a.at + ms) sum += b.locations;
    max = Math.max(max, sum);
  }
  return max;
}

const total = (calls: Call[]) => calls.reduce((s, c) => s + c.locations, 0);

let dir = "";
let dataDir = "";
let callLog = "";
let out: string[] = [];
let err: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "flows-data-"));
  dataDir = path.join(dir, "data");
  mkdirSync(dataDir);
  callLog = path.join(dir, "state", "calls.jsonl");
  out = [];
  err = [];
  vi.stubGlobal("fetch", () => {
    throw new Error("a real network call escaped the fake");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

/** Small bundles that carry only what layer choice reads. null leaves the file out. */
function seed(windAsof: string | null, currentsAsof: string | null) {
  if (windAsof) writeFileSync(path.join(dataDir, "wind.json"), JSON.stringify({ asof: windAsof, u: [1], v: [1] }));
  if (currentsAsof) {
    writeFileSync(path.join(dataDir, "currents.json"), JSON.stringify({ asof: currentsAsof, u: [1], v: [1], sst: [1] }));
  }
}

/**
 * Copies of the committed bundles, with the as-of of each copy pinned to one fixed value, so that
 * `--layer auto` always ties and a tie goes to wind. Every data PR moves the committed as-of of one
 * layer; without the pin, the tests that run auto on these copies would pass only while wind is not
 * newer than currents. Only the as-of field changes: every other byte is as committed.
 */
const PINNED_ASOF = "2026-11-01T20:15:00Z";
function seedCommitted() {
  for (const f of ["wind.json", "currents.json"]) {
    const text = readFileSync(path.join(COMMITTED, f), "utf8");
    if (!/"asof":"[^"]*"/.test(text)) throw new Error(`${f}: no "asof" field to pin`);
    writeFileSync(path.join(dataDir, f), text.replace(/"asof":"[^"]*"/, `"asof":"${PINNED_ASOF}"`));
  }
}

const snapshot = () =>
  Object.fromEntries(
    readdirSync(dataDir)
      .sort()
      .map((f) => [f, readFileSync(path.join(dataDir, f), "utf8")]),
  );

/** Call log lines as flows-data.mjs writes them. */
function writeLog(calls: Call[], host = MARINE_HOST) {
  mkdirSync(path.dirname(callLog), { recursive: true });
  const lines = calls.map((c) => JSON.stringify({ at: new Date(c.at).toISOString(), layer: "currents", host, locations: c.locations }));
  writeFileSync(callLog, lines.join("\n") + "\n");
}

/** One run's calls: `sizes` sent `gapMs` apart from `start`. */
const runCalls = (start: number, sizes: number[], gapMs = 12_400) => sizes.map((locations, i) => ({ at: start + i * gapMs, locations }));
const WIND_SIZES = requestSizes(2_520);
const CURRENTS_SIZES = requestSizes(3_690);

function run(argv: string[], clock: Clock, fetch: (input: string | URL) => Promise<Response>) {
  return main([...argv, "--call-log", callLog, "--data-dir", dataDir], {
    fetch,
    now: clock.now,
    sleep: clock.sleep,
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });
}

describe("the grids and the plan", () => {
  it("has 2,520 wind and 3,690 currents locations, 26 and 37 requests of up to 100", () => {
    expect(gridPoints("wind").flat).toHaveLength(2_520);
    expect(gridPoints("currents").flat).toHaveLength(3_690);
    expect(WIND_SIZES).toHaveLength(26);
    expect(CURRENTS_SIZES).toHaveLength(37);
    expect(Math.max(...CURRENTS_SIZES)).toBe(LIMITS.batch);
  });

  it("plans an idle start at 12.4 s per 100 locations: wind in 310 s, currents in 446.4 s", () => {
    const wind = planRun([], WIND_SIZES, T0);
    const currents = planRun([], CURRENTS_SIZES, T0);
    expect(wind.ok && currents.ok).toBe(true);
    expect(wind.ms).toBeCloseTo(310 * SEC, 6);
    expect(currents.ms).toBeCloseTo(446.4 * SEC, 6);
    expect(currents.peaks).toEqual({ minute: 500, hour: 3_690, day: 3_690 });
  });

  it("starts a request only once the busy minute has room", () => {
    const recent = runCalls(T0 - 10 * SEC, [100, 100, 100, 100, 100], 2 * SEC);
    expect(earliestStart(recent, 100, T0)).toBe(recent[0].at + 62 * SEC);
    expect(earliestStart([], 100, T0)).toBe(T0);
    expect(earliestStart([], 501, T0)).toBe(Infinity);
  });
});

describe("pacing (fake clock, fake fetch)", () => {
  it("never puts more than 500 locations in any minute over a full currents run, and writes the bundle once", async () => {
    seed("2026-11-02T08:15:00Z", "2026-11-01T20:15:00Z");
    const windBefore = readFileSync(path.join(dataDir, "wind.json"), "utf8");
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock);
    expect(await run([], clock, api.fetch)).toBe(EXIT.OK);

    expect(api.sent).toHaveLength(37);
    expect(api.sent.every((s) => s.host === MARINE_HOST)).toBe(true);
    expect(total(api.sent)).toBe(3_690);
    expect(busiest(api.sent, 60 * SEC)).toBeLessThanOrEqual(500);
    expect(busiest(api.sent, 62 * SEC)).toBeLessThanOrEqual(500);
    expect(busiest(api.sent, HOUR)).toBeLessThanOrEqual(4_500);
    for (let i = 1; i < api.sent.length; i++) {
      expect(api.sent[i].at - api.sent[i - 1].at).toBeGreaterThanOrEqual(api.sent[i - 1].locations * 124);
    }
    expect(clock.now() - T0).toBeLessThan(8 * MIN);

    const committed = JSON.parse(readFileSync(path.join(COMMITTED, "currents.json"), "utf8"));
    const bundle = JSON.parse(readFileSync(path.join(dataDir, "currents.json"), "utf8"));
    expect(Object.keys(bundle)).toEqual(Object.keys(committed));
    expect(bundle.grid).toEqual(committed.grid);
    expect(bundle.source).toBe(committed.source);
    expect(bundle.u).toHaveLength(3_690);
    expect(bundle.u.some((x: number | null) => x === null)).toBe(true);
    expect(bundle.asof).toBe("2026-11-02T20:15:00Z");
    expect(readFileSync(path.join(dataDir, "wind.json"), "utf8")).toBe(windBefore);
    expect(readdirSync(dataDir).sort()).toEqual(["currents.json", "wind.json"]);
    expect(readCallLog(callLog, clock.now()).calls).toHaveLength(37);
  });

  it("refreshes wind in 26 requests, about 5 min, with the committed bundle's shape", async () => {
    seed("2026-11-01T20:15:00Z", "2026-11-02T08:15:00Z");
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock);
    expect(await run(["--layer", "auto"], clock, api.fetch)).toBe(EXIT.OK);
    expect(api.sent).toHaveLength(26);
    expect(api.sent.every((s) => s.host === WIND_HOST)).toBe(true);
    expect(busiest(api.sent, 60 * SEC)).toBeLessThanOrEqual(500);
    expect(clock.now() - T0).toBeLessThan(5.5 * MIN);
    const committed = JSON.parse(readFileSync(path.join(COMMITTED, "wind.json"), "utf8"));
    const bundle = JSON.parse(readFileSync(path.join(dataDir, "wind.json"), "utf8"));
    expect(Object.keys(bundle)).toEqual(Object.keys(committed));
    expect(bundle.grid).toEqual(committed.grid);
    expect(bundle.source).toBe(committed.source);
  });

  it("counts an earlier run's calls: a run that starts right after one waits for the minute to clear", async () => {
    seed("2026-11-01T20:15:00Z", "2026-11-02T08:15:00Z");
    const before = runCalls(T0 - 10 * SEC, [100, 100, 100, 100, 100], 2 * SEC);
    writeLog(before, WIND_HOST);
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock);
    expect(await run([], clock, api.fetch)).toBe(EXIT.OK);
    expect(api.sent[0].at).toBeGreaterThanOrEqual(before[0].at + 62 * SEC);
    expect(busiest([...before, ...api.sent], 60 * SEC)).toBeLessThanOrEqual(500);
  });

  it("refuses a second run inside the same hour before sending anything (exit 44)", async () => {
    seed("2026-11-01T20:15:00Z", "2026-11-02T08:15:00Z");
    writeLog(runCalls(T0 - 5 * MIN - 446.4 * SEC, CURRENTS_SIZES));
    const logBefore = readFileSync(callLog, "utf8");
    const before = snapshot();
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock);
    expect(await run([], clock, api.fetch)).toBe(EXIT.GUARD);
    expect(api.sent).toHaveLength(0);
    expect(snapshot()).toEqual(before);
    expect(readFileSync(callLog, "utf8")).toBe(logBefore);
    expect(err.join("\n")).toMatch(/GUARD.*nothing sent, nothing written \(exit 44\)/);
  });

  it("alternates the layers twice a day and keeps every 24 h at 6,210 calls", async () => {
    seed("2026-11-01T20:15:00Z", "2026-11-01T20:15:00Z");
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock);
    const hosts: string[] = [];
    for (let i = 0; i < 4; i++) {
      clock.advance(T0 + i * 12 * HOUR - clock.now());
      const from = api.sent.length;
      expect(await run([], clock, api.fetch)).toBe(EXIT.OK);
      hosts.push(api.sent[from].host);
      expect(clock.now() - (T0 + i * 12 * HOUR)).toBeLessThan(8 * MIN);
    }
    expect(hosts).toEqual([WIND_HOST, MARINE_HOST, WIND_HOST, MARINE_HOST]);
    expect(busiest(api.sent, DAY)).toBe(6_210);
    expect(busiest(api.sent, HOUR)).toBe(3_690);
    expect(busiest(api.sent, 60 * SEC)).toBeLessThanOrEqual(500);
  });

  it("lets yesterday's calls age out as today's go out: a normal day never waits on the day guard", async () => {
    seed("2026-11-02T08:15:00Z", "2026-11-01T20:15:00Z");
    const yesterday = [...runCalls(T0 - DAY + 30 * SEC, CURRENTS_SIZES), ...runCalls(T0 - 12 * HOUR, WIND_SIZES)];
    writeLog(yesterday);
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock);
    expect(await run([], clock, api.fetch)).toBe(EXIT.OK);
    expect(api.sent).toHaveLength(37);
    expect(clock.now() - T0).toBeLessThan(8 * MIN);
    expect(busiest([...yesterday, ...api.sent], DAY)).toBeLessThanOrEqual(9_500);
  });

  it("waits for the day window rather than break it when yesterday's run started 10 min later", async () => {
    seed("2026-11-02T08:15:00Z", "2026-11-01T20:15:00Z");
    const yesterday = [...runCalls(T0 - DAY + 10 * MIN, CURRENTS_SIZES), ...runCalls(T0 - 12 * HOUR, WIND_SIZES)];
    writeLog(yesterday);
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock);
    expect(await run([], clock, api.fetch)).toBe(EXIT.OK);
    expect(api.sent).toHaveLength(37);
    expect(clock.now() - T0).toBeGreaterThan(10 * MIN);
    expect(clock.now() - T0).toBeLessThan(LIMITS.runMs + MIN);
    const all = [...yesterday, ...api.sent].sort((a, b) => a.at - b.at);
    for (const c of api.sent) {
      expect(all.filter((x) => x.at > c.at - DAY && x.at <= c.at).reduce((s, x) => s + x.locations, 0)).toBeLessThanOrEqual(9_500);
    }
  });

  it("refuses a run the day guard cannot fit in 20 min, before sending anything", async () => {
    seed("2026-11-01T20:15:00Z", "2026-11-02T08:15:00Z");
    writeLog(runCalls(T0 - 20 * HOUR, new Array(90).fill(100), 10 * SEC));
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock);
    expect(await run([], clock, api.fetch)).toBe(EXIT.GUARD);
    expect(api.sent).toHaveLength(0);
  });
});

describe("hard stops", () => {
  it("ends the run at the first 429: no retry, no file written, exit 42", async () => {
    seedCommitted();
    const before = snapshot();
    const clock = fakeClock();
    const limit = '{"error":true,"reason":"Minutely API request limit exceeded. Please try again in one minute."}';
    const api = fakeOpenMeteo(clock, { reply: (n) => (n === 7 ? new Response(limit, { status: 429 }) : undefined) });
    const code = await run([], clock, api.fetch);
    expect(code).toBe(42);
    expect(code).toBe(EXIT.PROVIDER_STOP);
    expect(api.sent).toHaveLength(7);
    expect(snapshot()).toEqual(before);
    expect(err.join("\n")).toMatch(/STOP: HTTP 429 from api\.open-meteo\.com on request 7 of 26 \(wind\).*no retry, nothing written \(exit 42\)/);
    expect(readCallLog(callLog, clock.now()).calls).toHaveLength(7);
  });

  it.each([
    ["a 403", 403, {}],
    ["a 503 with Retry-After", 503, { "retry-after": "120" }],
  ])("stops the same way on %s", async (_name, status, headers) => {
    seedCommitted();
    const before = snapshot();
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock, { reply: (n) => (n === 3 ? new Response("no", { status, headers }) : undefined) });
    expect(await run([], clock, api.fetch)).toBe(EXIT.PROVIDER_STOP);
    expect(api.sent).toHaveLength(3);
    expect(snapshot()).toEqual(before);
  });

  it("retries a 503 without Retry-After and a dropped socket, paced and logged like new requests", async () => {
    seedCommitted();
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock, {
      reply: (n) => (n === 3 ? new Response("busy", { status: 503 }) : n === 6 ? new TypeError("fetch failed") : undefined),
    });
    expect(await run([], clock, api.fetch)).toBe(EXIT.OK);
    expect(api.sent).toHaveLength(28);
    expect(busiest(api.sent, 60 * SEC)).toBeLessThanOrEqual(500);
    expect(readCallLog(callLog, clock.now()).calls).toHaveLength(28);
  });

  it("gives up after two retries of one request, with nothing written (exit 1)", async () => {
    seedCommitted();
    const before = snapshot();
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock, { reply: () => new TypeError("fetch failed") });
    expect(await run([], clock, api.fetch)).toBe(EXIT.FAILED);
    expect(api.sent).toHaveLength(3);
    expect(snapshot()).toEqual(before);
  });

  it("allows four retries a run, then fails with nothing written", async () => {
    seedCommitted();
    const before = snapshot();
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock, { reply: (n) => (n % 2 === 1 ? new TypeError("fetch failed") : undefined) });
    expect(await run([], clock, api.fetch)).toBe(EXIT.FAILED);
    expect(api.sent).toHaveLength(9);
    expect(snapshot()).toEqual(before);
  });

  it("fails on another 4xx without a retry", async () => {
    seedCommitted();
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock, { reply: () => new Response('{"error":true}', { status: 400 }) });
    expect(await run([], clock, api.fetch)).toBe(EXIT.FAILED);
    expect(api.sent).toHaveLength(1);
  });
});

describe("layer choice", () => {
  it("auto picks the layer with the older as-of", () => {
    seed("2026-11-01T20:15:00Z", "2026-11-02T08:15:00Z");
    expect(pickLayer("auto", dataDir).layer).toBe("wind");
    seed("2026-11-02T20:15:00Z", "2026-11-02T08:15:00Z");
    expect(pickLayer("auto", dataDir).layer).toBe("currents");
  });

  it("gives a tie to wind, and treats a missing or undated bundle as the oldest", () => {
    seed("2026-11-01T20:15:00Z", "2026-11-01T20:15:00Z");
    expect(pickLayer("auto", dataDir).layer).toBe("wind");
    rmSync(path.join(dataDir, "currents.json"));
    expect(pickLayer("auto", dataDir).layer).toBe("currents");
    seed("not a time", "2026-11-01T20:15:00Z");
    expect(pickLayer("auto", dataDir).layer).toBe("wind");
    rmSync(path.join(dataDir, "wind.json"));
    rmSync(path.join(dataDir, "currents.json"));
    expect(pickLayer("auto", dataDir).layer).toBe("wind");
  });

  it("does what --layer says", () => {
    seed("2026-11-01T20:15:00Z", "2026-11-02T08:15:00Z");
    expect(pickLayer("currents", dataDir).layer).toBe("currents");
  });
});

describe("--dry-run", () => {
  it("makes no network call, writes nothing, and prints every planned request", async () => {
    seedCommitted();
    const before = snapshot();
    const clock = fakeClock();
    const fetch = vi.fn(async (): Promise<Response> => {
      throw new Error("network in a dry run");
    });
    expect(await run(["--dry-run"], clock, fetch)).toBe(EXIT.OK);
    expect(fetch).not.toHaveBeenCalled();
    expect(existsSync(callLog)).toBe(false);
    expect(snapshot()).toEqual(before);
    const text = out.join("\n");
    expect(text).toMatch(/dry run \(no network call, nothing written\): wind/);
    expect(text).toMatch(/2,520 locations in 26 requests/);
    expect(text).toMatch(/last request at \+310\.0 s/);
    expect(text).toMatch(/network calls: 0/);
    expect(out.filter((l) => /^\s+request\s+\d+/.test(l))).toHaveLength(26);
  });

  it("exits 44 when a live run would be refused, still with no network call", async () => {
    seed("2026-11-01T20:15:00Z", "2026-11-02T08:15:00Z");
    writeLog(runCalls(T0 - 5 * MIN - 446.4 * SEC, CURRENTS_SIZES));
    const clock = fakeClock();
    const api = fakeOpenMeteo(clock);
    expect(await run(["--dry-run"], clock, api.fetch)).toBe(EXIT.GUARD);
    expect(api.sent).toHaveLength(0);
  });

  it("runs from the command line with fetch disabled and exits 0", () => {
    seedCommitted();
    const noNet = path.join(dir, "no-net.mjs");
    writeFileSync(noNet, 'globalThis.fetch = () => { console.error("NETWORK CALL"); process.exit(99); };\n');
    const res = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(noNet).href, SCRIPT, "--dry-run", "--call-log", callLog, "--data-dir", dataDir],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/network calls: 0/);
    expect(res.stderr).not.toMatch(/NETWORK CALL/);
    expect(existsSync(callLog)).toBe(false);
  });
});

describe("arguments and the call log's home", () => {
  it("parses --layer, --dry-run and the paths, and rejects anything else", () => {
    expect(parseArgs([]).layer).toBe("auto");
    expect(parseArgs(["--layer=currents", "--dry-run"])).toMatchObject({ layer: "currents", dryRun: true });
    expect(() => parseArgs(["--layer", "sideways"])).toThrow(/--layer must be/);
    expect(() => parseArgs(["--retry"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--call-log"])).toThrow(/needs a value/);
  });

  it("exits 2 on a bad argument, from the command line too", async () => {
    const clock = fakeClock();
    expect(await run(["--layer", "sideways"], clock, fakeOpenMeteo(clock).fetch)).toBe(EXIT.USAGE);
    const noNet = path.join(dir, "no-net.mjs");
    writeFileSync(noNet, 'globalThis.fetch = () => { console.error("NETWORK CALL"); process.exit(99); };\n');
    const res = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(noNet).href, SCRIPT, "--layer", "sideways", "--call-log", callLog, "--data-dir", dataDir],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/--layer must be auto, wind or currents/);
    expect(res.stderr).not.toMatch(/NETWORK CALL/);
    expect(existsSync(callLog)).toBe(false);
  });

  it("keeps the call log outside the repo: --call-log, then $FLOWS_CALL_LOG, then the XDG state folder", () => {
    expect(defaultCallLog({ FLOWS_CALL_LOG: "/x/calls.jsonl" }, "/home/u")).toBe("/x/calls.jsonl");
    expect(defaultCallLog({ XDG_STATE_HOME: "/s" }, "/home/u")).toBe(path.join("/s", "groundtruth", "flows-data-calls.jsonl"));
    expect(defaultCallLog({}, "/home/u")).toBe(path.join("/home/u", ".local", "state", "groundtruth", "flows-data-calls.jsonl"));
  });

  it("reads the last two days of the log and skips unreadable lines", () => {
    mkdirSync(path.dirname(callLog), { recursive: true });
    const line = (at: number) => JSON.stringify({ at: new Date(at).toISOString(), layer: "wind", host: WIND_HOST, locations: 100 });
    writeFileSync(callLog, [line(T0 - 3 * DAY), line(T0 - HOUR), "{not json", line(T0 - MIN), ""].join("\n"));
    const log = readCallLog(callLog, T0);
    expect(log.calls.map((c) => c.at)).toEqual([T0 - HOUR, T0 - MIN]);
    expect(log.bad).toBe(1);
  });
});
