# Indicators

Named signals with thresholds, built from series the app already relays. Every indicator has a stable id, a plain statement of why it matters, threshold rules with a citation, a history you can download, and provenance on every value. Nothing here is advice; a threshold marked *(convention)* is a level chosen for this dashboard, not an official one, and the rule prints its source either way.

Code: `lib/indicators/` (types, registry, evaluate, service, readers, api, store), `app/api/indicators/route.ts`, `components/hud/IndicatorsPanel.tsx`.

## The registry

| id | title | category | source | series | cadence | thresholds | rationale |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `mississippi-memphis-stage` | Mississippi River at Memphis, stage (ft) | water | USGS Water Data API | USGS-07032000 param 00065, daily mean | daily | watch ≤ −5 ft (convention); alert ≤ −8 ft (convention); alert ≥ 34 ft (NWS flood stage, MEMT1) | Reference gauge for the lower-Mississippi barge corridor. The October 2022 low of about −10.8 ft restricted drafts and split tows. |
| `mississippi-stlouis-stage` | Mississippi River at St. Louis, stage (ft) | water | USGS | USGS-07010000 param 00065 | daily | watch ≤ 0 ft (convention); alert ≥ 30 ft (NWS flood stage, EADM7) | Where the Missouri and Illinois join and open river begins. |
| `ohio-louisville-stage` | Ohio River at Louisville, stage (ft) | water | USGS | USGS-03294500 param 00065 | daily | alert ≥ 23 ft (NWS flood stage, LOUK2 upper gauge) | McAlpine Locks choke point; high water closes locks. |
| `missouri-stjoseph-stage` | Missouri River at St. Joseph, stage (ft) | water | USGS | USGS-06818000 param 00065 | daily | alert ≥ 17 ft (NWS flood stage, STJM7) | Levee and rail pressure downstream toward Kansas City. |
| `hoover-releases` | Colorado River below Hoover Dam, flow (ft³/s) | water | USGS | USGS-09421500 param 00060 | daily | none (informational) | Releases from Lake Mead to the lower basin. This is the flow below the dam, not the lake elevation; Reclamation's lake level needs a different (unverified) source. |
| `texas-reservoirs-pct-full` | Texas reservoirs, statewide percent full (%) | water | TWDB Water Data for Texas | statewide summary | daily | watch < 70 % (convention); alert < 60 % (convention) | Surface storage for cities, power and irrigation; below 70 % has coincided with stage-2 restrictions in past droughts. Lower is worse (`invert`). |
| `laredo-trucks` | Laredo truck crossings, monthly (trucks) | freight | BTS Border Crossing Entry Data | port 2304, measure Trucks | monthly | watch y/y < −5 % (convention) | Busiest US land port; truck counts lead trade statistics. Lower is worse. |
| `la-lb-container-teu` | Los Angeles + Long Beach container volume, annual (TEU) | freight | BTS Port Performance | ports 4120 + 4110, CONTAINER TOTAL, summed by us (estimate) | annual | watch y/y < −5 % (convention) | About a third of US containerised imports. Lower is worse. |
| `ships-awaiting-berth` | Containerships waiting for a berth, all US ports (ships) | freight | BTS Supply Chain Indicators | "Number of Containerships Awaiting Berths at all U.S. Ports" | weekly | watch ≥ 20 (convention); alert ≥ 50 (convention) | The visible edge of port congestion; the 2021 queue passed 100. |
| `shanghai-la-rate` | Shanghai to Los Angeles container rate ($ per 40 ft box) | freight | BTS Supply Chain Indicators (Freightos) | "Freight Rates in $ per 40ft Container from Shanghai to LA" | weekly | watch ≥ $5,000 (convention) | Spot rate on the busiest trans-Pacific lane; feeds import prices with a lag. |
| `diesel-price` | US diesel retail price ($ per gallon) | energy | BTS Supply Chain Indicators (EIA) | "U.S. Diesel Sales Prices" | weekly | watch ≥ $4.50 (convention); alert ≥ $5.00 (convention; record $5.81 on 2022‑06‑20) | Fuel of trucks, tows and tractors; passes into freight surcharges. |
| `wti-crude` | WTI crude oil, spot ($ per barrel) | energy | FRED | DCOILWTICO | daily | watch ≤ $55 (convention, Dallas Fed Energy Survey breakevens); watch ≥ $90 (convention) | Sets drilling budgets and fuel prices. |
| `mortgage-30y` | 30-year fixed mortgage rate (%) | housing | FRED (Freddie Mac PMMS) | MORTGAGE30US | weekly | watch ≥ 7 % (convention) | Sets the payment on a given price and so who can buy. |
| `housing-starts` | Housing starts, annual rate (thousands) | housing | FRED (Census/HUD) | HOUST | monthly | watch y/y < −10 % (convention) | Leads construction jobs and materials demand. Lower is worse. |
| `building-permits` | Building permits, annual rate (thousands) | housing | FRED (Census/HUD) | PERMIT | monthly | watch y/y < −10 % (convention) | Earliest read on residential construction. Lower is worse. |
| `case-shiller` | Case-Shiller US home price index (Jan 2000 = 100) | housing | FRED (S&P CoreLogic) | CSUSHPINSA | monthly | watch y/y < 0 (convention) | A year-over-year fall is rare outside recessions. |
| `unemployment-rate` | Unemployment rate (%) | labour | FRED (BLS) | UNRATE | monthly | watch y/y change ≥ +0.5 pt (Sahm-style, simplified) | Sahm (2019): a 0.5 pt rise of the 3-month average above the prior 12-month low has marked every US recession since 1970. Our rule is simpler and printed as such: latest month minus the same month a year earlier. See FRED `SAHMREALTIME` for the official series. |
| `trade-balance` | US goods and services trade balance, monthly ($ millions) | trade | FRED (Census/BEA) | BOPGSTB | monthly | none (informational) | Monthly swings are usually front-running or one-off shipments. |
| `retail-sales` | Retail sales ex food services, monthly ($ millions) | macro | FRED (Census) | RSXFS | monthly | watch y/y < 0 (convention) | Nominal, so a y/y fall means real spending fell more. Lower is worse. |

Threshold metric: rules test the latest value unless `on` is `yoyPct` (percent change against the point about 365 days earlier) or `yoyAbs` (absolute change, same lookup). The year-ago lookup tolerates 5 days (daily), 10 (weekly), 20 (monthly), 50 (quarterly) or 200 (annual); when no such point exists the y/y rule is skipped, never assumed.

Status is the worst triggered level: `alert` > `watch` > `ok`; a series with no numeric point is `no data`.

Cache TTLs per cadence (`ttlForCadence`): daily 1 h, weekly 3 h, monthly/quarterly 6 h, annual 24 h, on top of the readers' own caches (`fred()` 1 h, `btsIndicators()` 6 h, `borderCrossings()` 6 h, `btsPortStats()` 24 h).

## API

All responses are `Enveloped<T>`: `{ data, provenance: Provenance[], generatedAt, caveats? }`. CORS is open; `cache-control: public, max-age=0, s-maxage=<ttl>, stale-while-revalidate=<ttl>`.

```
GET /api/indicators?op=list[&category=water]
  data: { indicators: IndicatorMeta[], categories: string[] }     # registry metadata only, no fetches; s-maxage 3600

GET /api/indicators?op=latest[&ids=a,b][&category=freight]
  data: { items: IndicatorResult[] }                                # evaluated; s-maxage 900
  IndicatorResult = { meta, evaluation, provenance?, error?, cacheAge? }
  evaluation = { latest, latestAt, prev, prevAt, changeAbs, changePct, yoyPct, yoyAbs, yoyAt,
                 status: "ok"|"watch"|"alert"|"no data", triggered: Threshold[], sparkline: Point[60] }

GET /api/indicators?op=history&id=<id>[&from=YYYY-MM-DD|ISO|epochms][&to=..][&limit=1..5000][&format=csv]
  data: Series  (live upstream merged with the snapshot store's indicator:<id>); s-maxage 3600
  format=csv → text/csv: time,value,unit,source,series_id
```

Unknown `ids`, `category`, `format`, a bad `from`/`to` or `from > to` → `400 { error }` naming the valid values. An indicator whose upstream failed appears in `latest` with `status: "no data"` and an `error` string (and in `caveats`); `history` for an indicator with nothing live and nothing stored is `502`.

Examples:

```sh
curl -s 'https://<host>/api/indicators?op=list' | jq '.data.indicators[] | {id, category, thresholds: (.thresholds | length)}'
curl -s 'https://<host>/api/indicators?op=latest&category=water' | jq '.data.items[] | {id: .meta.id, latest: .evaluation.latest, status: .evaluation.status, fired: [.evaluation.triggered[].label]}'
curl -s 'https://<host>/api/indicators?op=latest&ids=mortgage-30y,unemployment-rate' | jq '.provenance'
curl -s 'https://<host>/api/indicators?op=history&id=mississippi-memphis-stage&from=2025-09-01&format=csv' > memphis.csv
```

Python:

```python
import requests
r = requests.get("https://<host>/api/indicators", params={"op": "latest"}).json()
for it in r["data"]["items"]:
    e = it["evaluation"]
    print(f'{e["status"]:8} {it["meta"]["title"]}: {e["latest"]} {it["meta"]["unit"]} ({e["latestAt"]})')
```

## Storing history

`getIndicators({ store })` appends the latest point of each evaluated series to `indicator:<id>` in the SeriesStore (the route uses `defaultStore()`, i.e. `GEV_SERIES_DIR` or `data/series`). `?op=history` merges those stored points with the live upstream window, so history keeps growing even without the snapshot cron. Set `GEV_INDICATORS_NO_STORE=1` to disable the write (read-only filesystems).

## Adding an indicator

Append to `INDICATORS` in `lib/indicators/registry.ts`:

```ts
{
  id: "my-signal",                       // kebab-case, unique
  title: "…", category: "freight", unit: "…",
  whyItMatters: "One or two factual sentences.",
  source: "fred",                        // must exist in lib/provenance/sources.ts
  seriesId: "SERIES",
  cadence: "monthly",
  thresholds: [{ level: "watch", op: ">=", value: 1, label: "… (convention)", citation: "…" }],
  fetch: async (ctx) => seriesFromPulse(ctx.indicator, (await fred("SERIES"))!, { sourceId: "fred" }),
  relatedLayers: ["trade"], flyTo: { lon, lat, height },
}
```

`registry.test.ts` enforces unique ids, a source in `SOURCES`, labels and citations on every threshold, and that any threshold whose citation says "convention" says so in its label.

## Unverified in the sandbox

No upstream was reachable while this was written. Parsers follow the shapes already used elsewhere in the app (USGS OGC `daily` collection as in `/api/water?op=history`; `fredgraph.csv`; BTS Socrata tables) plus one new one: the TWDB statewide CSV (`https://www.waterdatafortexas.org/reservoirs/statewide.csv`, expected columns `date, percent_full, conservation_storage, conservation_capacity`). If that CSV is missing or shaped differently the reader falls back to summing `recent-conditions.json`, labelled `kind: "estimate"` with the formula in `provenance.method`.
