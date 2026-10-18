# Feed snapshots

The globe shows live feeds: ships from AIS, aircraft from ADS-B, river gauges, reservoir levels, earthquakes. None of those feeds keep history for free. This part of the repo samples them on a schedule, reduces every sample to aggregate numbers, and appends the numbers to small JSON files that are committed back to the repository. After a few weeks the files are a nowcast series anyone can chart, download or cite: how many ships were waiting off Los Angeles each day, how many cargo airframes were over Memphis at 03:00 UTC, what the Mississippi stage at Memphis did through the season.

## What is stored, and what is not

Only counts and published readings. A snapshot of a port is three integers: vessels inside the circle, of which stationary (SOG below 1 kn: at berth or anchor) and moving. A snapshot of a cargo hub is two integers: airframes heard within 60 nm, of which flying a cargo-only carrier callsign. MMSIs, ship names, hex codes and callsigns are used inside one sample to count distinct objects and are then discarded; they are never written to disk, never returned by the API, and the tests assert that the outputs contain none of them. Gauge, reservoir and earthquake series relay numbers the agencies already publish for everyone.

The point of this is the same as the rest of the project: public infrastructure and public events, aggregate first, every number traceable to the upstream that produced it.

## How it works

```
lib/series/collectors/*.ts     one module per feed; collect(ctx) -> [{ meta, points }]
lib/series/collect.ts          runCollectors(): timeouts, error isolation, validation, report
lib/series/store.ts            fileStore(dir): one JSON file per series, merged by time
lib/series/read.ts             readSeries() with daily roll-ups, seriesToCsv(), listSeries()
lib/series/githubRaw.ts        read-only store over raw.githubusercontent.com + layeredStore()
app/api/series/route.ts        GET list / get / collectors, POST collect (guarded)
scripts/snapshot.mjs           Node entry the cron runs
.github/workflows/snapshot.yml cron every 3 h, commits data/series with GITHUB_TOKEN
data/series/                   the series files and index.json
```

A collector implements one interface (`lib/series/collectors/types.ts`):

```ts
interface Collector {
  id: string;                 // "quakes"
  title: string;
  cadence: string;            // "3h", documentation only
  timeoutMs?: number;         // wall-clock budget, default 30 s
  describe(): CollectorDescription;
  collect(ctx: CollectorContext): Promise<Array<{ meta: SeriesMeta; points: Point[] }>>;
}
```

`ctx` carries the sample time (`now`), an injected `fetchJson`, optional `keys`, an `AbortSignal` that fires at the budget, an `openSocket` factory for stream samples, and `politeDelayMs` / `listenMs` knobs the tests set to zero. Collectors never import `fetch` directly, which is what makes them testable against fixtures.

`runCollectors()` runs the registry in sequence, gives each collector its own timeout, catches its errors, drops any output with a malformed id or non-finite value, appends the rest to the store and returns a report (`ran`, `failed[]`, `seriesWritten`, `pointsWritten`, per-collector timings). A run only throws when the store itself fails.

Points are stored at collection cadence. Daily roll-ups (`daily-mean`, `daily-max`, `daily-last`, UTC days, stamped at midnight) are computed when a series is read, never persisted, so the raw samples stay available.

### Series ids

| Collector | Series | Unit | Source |
|---|---|---|---|
| `port-vessels` | `snapshot:port-vessels:<LOCODE>`, `...-stationary:<LOCODE>`, `...-moving:<LOCODE>` | count | Digitraffic (Baltic, keyless), AISStream (rest, key) |
| `cargo-flights` | `snapshot:hub-aircraft:<IATA>`, `snapshot:hub-cargo-aircraft:<IATA>` | count | adsb.lol |
| `gauges` | `snapshot:gauge:<site>:00065` (stage, ft), `snapshot:gauge:<site>:00060` (discharge, ft³/s) | ft, ft³/s | USGS Water Data API |
| `reservoirs` | `snapshot:reservoir:texas:percent-full` (estimate), `snapshot:reservoir:<slug>:percent-full` (top 10 by capacity) | % | TWDB |
| `quakes` | `snapshot:quakes:{world,conus}:{m2.5,m4.5}` | count | USGS feeds |

Ports are the curated table in `lib/series/collectors/ports.ts` (LOCODE, centre, radius, which feed can see it). Hubs and gauges are tables at the top of their collectors. Every series carries a `provenance` record: the source, `kind` (`snapshot` for our counts, `published` for relayed readings, `estimate` for the statewide reservoir figure, with the formula in `method`), the exact upstream URL when it is safe to share, and caveats in `notes`.

## Running locally

```bash
node scripts/snapshot.mjs                        # every collector -> data/series
node scripts/snapshot.mjs --only=quakes,gauges   # a subset
node scripts/snapshot.mjs --dry-run              # collect, print the report, write nothing
node scripts/snapshot.mjs --dir=/tmp/series      # write elsewhere
node scripts/snapshot.mjs --listen=60            # shorter AISStream window (default 180 s)
AISSTREAM_KEY=... node scripts/snapshot.mjs      # cover the non-Baltic ports
```

The script compiles the TypeScript with `tsc` into `node_modules/.cache/gev-snapshot` (git-ignored), rewrites the `@/` imports for Node, runs the collectors against `fileStore(dir)` and writes `data/series/index.json` (an array of every series' metadata) for the raw adapter. It exits non-zero only when every collector failed, so one flaky upstream does not stop the others from being committed.

Then read it back:

```bash
npx next dev
curl "http://localhost:3000/api/series?op=list&prefix=snapshot:port-vessels"
curl "http://localhost:3000/api/series?op=get&id=snapshot:quakes:world:m4.5&rollup=daily-max"
curl "http://localhost:3000/api/series?op=get&ids=snapshot:gauge:07032000:00065,snapshot:gauge:07010000:00065&format=csv"
```

## The GitHub Action

`.github/workflows/snapshot.yml` runs at minute 17 of every third hour and on demand (`workflow_dispatch`, with `only` and `listen` inputs). It checks out the code, `npm ci --ignore-scripts`, restores `data/series` from the `series` branch (`scripts/snapshot-branch.sh restore`), runs `node scripts/snapshot.mjs`, and if anything changed commits the files to the `series` branch as `gev-snapshot[bot]` and pushes with the built-in `GITHUB_TOKEN` (`permissions: contents: write`; `scripts/snapshot-branch.sh publish`). `series` is an orphan branch that holds only `data/series` and a `vercel.json` that turns deployments of that branch off. master is protected (pull requests only, admins included), and pushing samples to it failed 56 of 56 times between 2026-09-16 and 2026-09-29. No personal token is needed. Pushes made with `GITHUB_TOKEN` do not trigger other workflows, and the commit message carries `[skip ci]` for any CI added later and for hosts that honour it. A concurrency group keeps two runs from racing on the same files; a `git pull --rebase` before the push handles a human commit that landed mid-sample.

To cover the non-Baltic ports, add a repository secret `AISSTREAM_KEY` (free at aisstream.io). Without it the port collector still runs and writes the Baltic ports; the other ports are simply absent, not zero.

The first run creates the `series` branch. Point `GEV_SERIES_RAW_BASE` at it (below) so the deployed app reads what the cron has written.

## Serving the series from a host that is not the repo

On Vercel (or any host whose filesystem is a build-time copy), set

```
GEV_SERIES_RAW_BASE=https://raw.githubusercontent.com/jcdavis131/gods-eye-view/series/data/series
```

`defaultStore()` then layers a read-only HTTP adapter under the file store: reads merge whatever the checkout has with whatever the branch has now, writes still go to the file store. The adapter fetches `<base>/<file>.json` and `<base>/index.json`, caches each for five minutes (raw.githubusercontent.com is itself CDN-cached for about that long), and serves the last good copy while the origin is down.

## The API

All GET ops are keyless, CORS-open (`*`) and edge-cached for five minutes. Every response is an envelope `{ data, provenance[], generatedAt, caveats? }` (`lib/provenance/types.ts`).

| Op | Params | Returns |
|---|---|---|
| `op=list` | `prefix` (optional) | `data`: `SeriesMeta[]` |
| `op=get` | `id` or `ids` (up to 20), `from`, `to` (ISO or epoch ms), `limit` (1..50000, default 5000, newest kept), `rollup` (`daily-mean`, `daily-max`, `daily-last`), `format=csv` | `data`: one series (with `id`) or a list (with `ids`); CSV is long format `series_id,t_iso,value` |
| `op=collectors` | | `data`: what each collector samples, its sources and optional keys |
| `POST op=collect` | `only` (optional); header `x-gev-cron-secret` | `data`: the run report. 404 unless `GEV_CRON_SECRET` is set; 401 on a wrong header |

Bad parameters are 400 with `{ error }`; an unknown single id is 404; a store failure is 502.

## Environment

| Variable | Where | Meaning |
|---|---|---|
| `AISSTREAM_KEY` | cron, script, route | optional; unlocks the non-Baltic ports |
| `GEV_SERIES_DIR` | script, route | where the file store lives (default `data/series`) |
| `GEV_SERIES_RAW_BASE` | route | read the committed series over HTTP (see above) |
| `GEV_CRON_SECRET` | route | enables `POST op=collect`; unset means the op does not exist |
| `GEV_SNAPSHOT_LISTEN_S` | script, route | AISStream listen window (script default 180; the route caps at 40 to fit a serverless budget) |

## Adding a collector

1. Create `lib/series/collectors/<name>.ts` exporting a `Collector`. Keep parsing and counting in exported pure functions that take the upstream payload, so the test can feed a fixture. Read everything through `ctx.fetchJson`; respect `ctx.signal`; use `ctx.politeDelayMs` between requests to one upstream. Build metadata with `provenance(source("<id>"), { kind, method, notes })`; add the source to `lib/provenance/sources.ts` first if it is new.
2. Stamp snapshot counts with `ctx.now` and relayed readings with the upstream observation time, so repeated samples of one reading merge into one point.
3. Never put an identifier of a vessel, aircraft or person in a series id, title, tag or note.
4. Add it to `COLLECTORS` in `lib/series/collectors/index.ts` and write `<name>.test.ts` next to it with a realistic fixture and an error-path test.
5. Run `node scripts/snapshot.mjs --dry-run --only=<name>` once with network to check the shapes, then run `npm test`.

## Retention

A series file grows by one point (about 25 bytes) per sample. At eight samples a day the whole directory grows by roughly 1 MB a year across the current 200-odd series, which git handles without noticing. When that changes, the hook is `runCollectors()`: a compaction step that rolls points older than N days up to daily values (`rollupDaily()` already exists) and rewrites the file would go there, leaving the read API unchanged. Nothing is deleted today.

## Privacy stance

Counts only. The collectors do see identities in memory for the length of one sample because that is how you count distinct objects in a stream, and then they are gone. No MMSI, IMO, ship name, ICAO hex, callsign, registration or operator is stored, indexed or served. If a future collector needs an identity to produce its count, the identity stays inside `collect()` and the test file must assert it is absent from the output, as `portVessels.test.ts` and `cargoFlights.test.ts` do now.
