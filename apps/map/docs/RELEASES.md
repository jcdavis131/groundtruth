# Releases: calendar, vintages, movers

What is coming out, which release of each table is loaded, and what moved since the previous one. Everything is arithmetic over published values; the calendar is data plus a small rule language, so adding a source is one object literal.

- Code: `lib/releases/calendar.ts`, `lib/releases/vintage.ts`, `lib/releases/movers.ts`, `lib/releases/store.ts`
- Route: `app/api/releases/route.ts`
- Panel: `components/hud/ReleasesPanel.tsx`
- Permalink: `lib/globe/share.ts` (`&v=YYYY-MM-DD`)

## API

Every response is an `Enveloped<T>` (`lib/provenance/types.ts`): `{ data, provenance: Provenance[], generatedAt, caveats? }`. CORS is open; responses carry `cache-control: public, max-age=0, s-maxage=3600, stale-while-revalidate=3600`.

```bash
# Release windows in a date range (default: today + 30 days; range clamped to 366 days)
curl "https://eye.jcamd.com/api/releases?op=calendar"
curl "https://eye.jcamd.com/api/releases?op=calendar&from=2026-10-01&to=2026-10-31"

# Current vintage of every loaded table
curl "https://eye.jcamd.com/api/releases?op=vintages"

# Movers since the previous release (n 1..200, default 20; min = floor on the previous value)
curl "https://eye.jcamd.com/api/releases?op=movers&table=zillow&metric=zhviCounty&n=20"
curl "https://eye.jcamd.com/api/releases?op=movers&table=qcew&metric=emp&min=10000"
curl "https://eye.jcamd.com/api/releases?op=movers&table=border&metric=Trucks&format=csv"
curl "https://eye.jcamd.com/api/releases?op=movers&table=ports&metric=container"
```

| op | params | data |
|---|---|---|
| `calendar` | `from`, `to` (YYYY-MM-DD, real dates only; 400 otherwise) | `{ from, to, count, releases: [{ id, sourceId, seriesId?, title, cadence, rule, precision, window: { earliest, latest, nominal }, scheduleUrl?, covers?, notes? }] }` sorted by `window.earliest` then title |
| `vintages` | none | `{ count, vintages: VintageRecord[], failed: string[], cacheAge }` |
| `movers` | `table` = `zillow` \| `qcew` \| `border` \| `ports`; `metric` (whitelist per table below); `n`; `min`; `format=csv` | `{ table, metric, unit, period, previousPeriod, up: MoverRow[], down: MoverRow[], compared, skipped, signFlips?, cacheAge }` |

Metrics: `zillow` → `zhviCounty` (default), `zoriCounty`; `qcew` → `emp` (default), `avgWeeklyWage`, `wages`, `estabs`; `border` → any BTS measure (`Trucks` default, `Trains`, `Buses`, `Personal Vehicles`, `Pedestrians`, `Personal Vehicle Passengers`, `Train Passengers`, `Bus Passengers`); `ports` → `container` (default), `tonnage`, `dryBulk`. Anything else is a 400.

A `MoverRow` is `{ id, name, before, after, changeAbs, changePct, period, previousPeriod?, lon?, lat? }`. Border and port rows carry coordinates; county rows carry a GEOID. The CSV variant has the same columns plus `direction` and `rank`, and a trailing `#` line with the provenance.

## The rule language

Rules are evaluated on UTC calendar dates, so daylight-saving changes never move a window. `parseRule` throws on anything it does not understand; the calendar test parses every entry.

| Rule | Meaning | Window |
|---|---|---|
| `daily` | every calendar day | one day |
| `daily:business` | Monday to Friday | one day |
| `continuous` | always updating (USGS gauges); listed once in a calendar range | one day |
| `weekly:THU` | every Thursday (`SUN`..`SAT`) | one day |
| `monthly:day=17` | the 17th, clamped to the month length | one day |
| `monthly:day~17` | about the 17th | ±3 days (`:tol=N` to change) |
| `monthly:days=14-21` | somewhere between the 14th and the 21st | that range |
| `monthly:first-FRI` | first Friday (`second`, `third`, `fourth`, `last` too) | one day |
| `quarterly:+150d` | 150 days after each quarter end (31 Mar, 30 Jun, 30 Sep, 31 Dec) | ±10 days (`:tol=N`) |
| `annual:month=4` | sometime in April | the whole month |
| `annual:month=4:day=15` | exactly 15 April | one day |

Functions (all accept a rule string or a parsed `Rule`, and a `Date`, epoch ms or ISO text):

- `nextReleaseAfter(rule, date, slackDays?)` — first occurrence whose nominal date is strictly after `date`.
- `lastReleaseBefore(rule, date, slackDays?)` — last occurrence on or before `date`.
- `releasesBetween(rule, from, to, slackDays?)` — every occurrence in the range.
- `upcomingReleases(from, to, entries?)` — the whole calendar, sorted, with the effective precision.

Precision: a rule with `~`, `days=`, a quarterly lag or a month-only annual is approximate by construction and `effectivePrecision()` can never report it as official. A rule that lands on one day (`monthly:first-FRI`) can still be marked `approximate` on its entry; its `slackDays` then widens the window. The panel and the API never show a single date for an approximate entry.

## The calendar (`RELEASE_CALENDAR`)

| id | rule | precision | covers | schedule |
|---|---|---|---|---|
| `bls-qcew` | `quarterly:+150d:tol=14` | approximate | quarter ending ~5 months earlier | bls.gov/schedule/news_release/cewqtr.htm |
| `zillow-zhvi`, `zillow-zori` | `monthly:days=14-21` | approximate | previous month | zillow.com/research/data |
| `bts-border` | `monthly:day~20:tol=10` | approximate | month ending 6–8 weeks earlier | data.bts.gov keg4-3bc2 |
| `bts-ports` | `annual:month=1` | approximate | previous calendar year | bts.gov/ports |
| `bts-supply-chain` | `weekly:FRI` | approximate | per indicator | data.bts.gov y5ut-ibwt |
| `fred:MORTGAGE30US` | `weekly:THU` | official | week ending Thursday | freddiemac.com/pmms |
| `fred:UNRATE` | `monthly:first-FRI` (+7 slack) | approximate | previous month | bls.gov/schedule/news_release/empsit.htm |
| `fred:HOUST`, `fred:PERMIT` | `monthly:day~18:tol=2` | approximate | previous month | census.gov/construction/nrc |
| `fred:RSXFS` | `monthly:day~15:tol=3` | approximate | previous month | census.gov/retail/release_schedule.html |
| `fred:BOPGSTB` | `monthly:day~6:tol=4` | approximate | month before last | bea.gov/news/schedule |
| `fred:CSUSHPINSA` | `monthly:last-TUE` (+1 slack) | approximate | two months earlier | spglobal.com (Case-Shiller) |
| `fred:DCOILWTICO` | `daily:business` | approximate | each trading day | eia.gov/petroleum/data.php |
| `fred:MSPUS` | `quarterly:+25d:tol=5` | approximate | quarter just ended | census.gov/construction/nrs |
| `fred:TOTALSA` | `monthly:day~3:tol=3` | approximate | previous month | bea.gov (motor vehicles) |
| `usdm` | `weekly:THU` | official | through the preceding Tuesday | droughtmonitor.unl.edu |
| `usgs-water` | `continuous` | official | as gauges report | waterdata.usgs.gov |
| `worldbank-wdi` | `annual:month=7` | approximate | previous year | datatopics.worldbank.org/wdi |
| `worldbank-wits` | `annual:month=12` | approximate | 2–3 years behind | wits.worldbank.org |

The schedule URLs were written from the publishers' documentation and could not be fetched from the build sandbox; treat them as "start here" links and correct any that have moved.

## How vintages are detected

`describeVintages(inputs)` is pure. The route builds `VintageInputs` from what the readers in `lib/economy/sources.ts` already know:

| table | period read from | release date |
|---|---|---|
| Zillow ZHVI / ZORI | last month column of the CSV (`ZillowTable.asOf`) → `2026-07` | rule: last `monthly:days=14-21` window before retrieval |
| BLS QCEW | `QcewTable.period` (`2026 Q1`) | rule: last `quarterly:+150d` window |
| BTS border | newest month key (`2026-06`) | rule |
| BTS ports | newest `reporting_year` | rule |
| FRED series | newest observation date | rule per series (calendar entry by `fred:<id>`) |
| BTS indicators | newest observation date | rule (`bts-supply-chain`) |
| USDM | the feature service we read returns only the DM class, so the period is the Tuesday before the last Thursday window and says so in `notes` | rule (official) |
| World Bank WDI | newest year per indicator | rule |
| WITS | newest year answered | rule |

Each `VintageRecord` carries `basis`: `"table"` when the publisher's own stamp was read, `"rule"` when the window came from the calendar, `"unknown"` when the source has no calendar entry (the note says to add one). `maybeStale` is true when a whole next window has passed since the table was read. `retrievedAt` is when the server last read the table from its in-memory cache; the upstream fetch can be up to the table's TTL (1–24 h) older, and the response says so in `caveats`.

## What `v=` means today

`?v=YYYY-MM-DD` in a permalink is the data vintage. Today it does three things:

1. `lib/releases/store.ts` stores it (`useReleases`, `getVintage()`), after validating it is a real date.
2. `applyShare` pins the mission clock to noon UTC of that day (unless the link also carries an explicit `t=`).
3. The HUD shows `VINTAGE 2026-08-15` (Releases panel header and vintage row).

It does **not** yet change which release a layer reads. Layers that can read history (the series store, `zillowHistory()`, `qcewAreaTotal()`) are the ones that will honour it; live feeds ignore it. A malformed `v=` is dropped silently, never guessed.

## Movers

Pure functions over the parsed tables, provenance `kind: "published"` with the arithmetic in `method`:

- `zillowMovers(table, opts)` — newest month column vs the one before, per region; both must be the file's two newest months. Also counts regions whose year-over-year sign strictly flipped between those two months (a move from exactly zero is not a flip).
- `qcewMovers(table, names, metric, opts)` — BLS's published over-the-year percent (`oty_*_pct_chg`). The year-earlier level is not in the newest file, so `before` and `changeAbs` are null rather than reconstructed. Suppressed cells are skipped.
- `borderMovers(data, measure, opts)` — newest month vs previous month per port for one measure.
- `portMovers(data, metric, opts)` — newest reporting year vs the year before per port, from the TOTAL series.

Common rules: ties are broken by id so output is stable; rows with a missing value or zero base are counted in `skipped`; `minBefore` drops rows whose base is below a floor (percent moves on tiny bases are noise). `rank()` and `moversCsv()` are exported for reuse.

## How to extend

- **New release**: append an object to `RELEASE_CALENDAR` with a rule from the table above. The calendar test checks it parses, cites a `SOURCES` id and, if official, has a `scheduleUrl`. `findEntry(sourceId, seriesId?)` picks it up for vintages.
- **New rule form**: extend `parseRule` and `nominalsBetween` in `calendar.ts`; keep everything in UTC and add a case to `calendar.test.ts`.
- **New table vintage**: add a field to `VintageInputs`, a block in `describeVintages`, and have the route fill it in `vintageInputs()`.
- **New movers table**: add a pure `xMovers()` in `movers.ts` returning `MoversResult`, add its id to `MOVER_TABLES`, a metric whitelist and a `computeMovers` case in the route, and a `TABLES` entry in the panel.
