# Embedding Atlas data API

Keyless, CORS-open JSON and CSV over the same public sources the globe draws: USGS, NOAA, TWDB and the Drought Monitor for water; BLS QCEW, Zillow, BTS, the World Port Index, the World Bank and FRED for jobs, homes and trade; NIFC, NASA FIRMS, NWS, GDACS and EONET for hazards (`/api/hazards`); FEMA, USFWS, USGS PAD-US and 3DEP for land (`/api/land`); USGS 3DEP, MRLC NLCD, USFS WHP and FEMA for terrain pictures and point classes (`/api/terrain`); NRCS SSURGO for soils (`/api/soil`); GFZ and NASA DONKI for space weather (`/api/space`); HIFLD, EIA, FRA/BTS, FAA, USACE, EIA-860M, Wikidata, USGS, BLM and Macrostrat for infrastructure and geohazards (`/api/infra`); EPA AirNow for air quality (`/api/air`); GDELT for news events (`/api/events`); Wikipedia for geotagged articles, article summaries and On this day entries (`/api/wikipedia`); ten city zoning services for zoning (`/api/zoning`); seven city permit portals, five licence registries, EPA ECHO and the Corps of Engineers for permits (`/api/permits`). Every number carries provenance. This guide is for people calling it from a notebook, a script or their own page.

Machine-readable description: [`/api/openapi`](https://eye.jcamd.com/api/openapi) (also `public/openapi.json` in the repo).

```bash
curl "https://eye.jcamd.com/api/water?op=report&lon=-98.49&lat=29.42"
curl "https://eye.jcamd.com/api/economy?op=areas&bbox=-98.5,29.8,-97,31&format=csv" -o travis.csv
```

## The envelope

Every JSON response has the same top-level shape:

```jsonc
{
  "source": "BLS QCEW + Zillow ZHVI + Zillow ZORI + Census TIGERweb",   // short human label (older scripts read this)
  "asOf": { "qcew": "2026 Q1", "zhvi": "2026-07-31", "zori": "2026-07-31" }, // route-specific fields sit here...
  "level": "county", "bbox": [-99, 29, -97, 32], "cacheAge": 1830912,        // ...beside the reserved ones below
  "data": { "type": "FeatureCollection", "features": [ ... ] },            // the payload; shape depends on op
  "provenance": [ { ... }, { ... } ],                                       // one record per upstream release used
  "generatedAt": "2026-09-11T14:02:11.412Z",                                // when this response was assembled
  "caveats": [ "..." ]                                                      // only when there is something to say
}
```

Reserved names: `data`, `provenance`, `generatedAt`, `caveats`. Everything else at the top level is route-specific metadata (`source`, `cacheAge`, `bbox`, `asOf`, `globe`, ...). Field names never change or disappear between versions; new ones are added.

Errors are JSON too: `400 { "error": "bbox=w,s,e,n required" }` for a bad parameter (the message says what a valid call looks like), `502 { "error", "upstream", "status" }` when an upstream did not answer. Both carry the CORS headers.

## Provenance

```jsonc
{
  "source": {
    "id": "bls-qcew",                                      // stable id (lib/provenance/sources.ts)
    "name": "Quarterly Census of Employment and Wages",
    "publisher": "U.S. Bureau of Labor Statistics",
    "url": "https://www.bls.gov/cew/",
    "license": "public domain"
  },
  "seriesId": "area 48453, all ownerships, all industries", // upstream series / file / site:parameter when one exists
  "upstreamUrl": "https://data.bls.gov/cew/data/api/2026/1/area/48453.csv",
  "period": "2026-Q1",                                     // what the value describes: ISO date, 2026-07, 2026-Q1, 2024, from/to
  "releasedAt": "2026-08-27",                              // when the upstream published it, when known
  "retrievedAt": "2026-09-11T13:31:40.500Z",               // when this server fetched it (cache age subtracted)
  "kind": "published",                                     // published | estimate | snapshot
  "revision": "quarterly files are revised when the next quarter is published; annual revisions follow",
  "notes": [ "..." ]
}
```

`kind` is the field to read first:

- `published` — relayed as the upstream serves it. Cite the upstream.
- `estimate` — computed here from published values. `method` holds the arithmetic that ran, with the inputs, e.g. `price-to-rent = $412,000 / ($1,850 × 12) = 18.6`. The `source` is the publisher of the main input; other inputs are named in `notes`. Cite it as an estimate by Embedding Atlas from those sources.
- `snapshot` — our own observation of a live feed (aircraft, ship and satellite counts). Not reproducible upstream.

Where a call knows the exact identifiers they are in `seriesId`: a FRED series id (`MORTGAGE30US`), a Zillow file name, a QCEW area code, a USGS `site:parameter` (`USGS-08180800:00060`), a BTS dataset id, a Sentinel-2 scene id. Where it does not (a bbox of many gauges) the record names the collection and parameter codes and the count is in `notes`.

`op=report` (both routes) attaches provenance twice: each section (`home`, `rent`, `jobs`, ... / `drought`, `reservoirs`, `gauges`, ...) has `provenance` next to its prose `basis`, and the report has a de-duplicated `provenance` union plus `citations`, one line per record. The HUD's report panels have "Copy citation" and "Copy provenance JSON" buttons that copy exactly these.

## Citation format

`citation(p)` in `lib/provenance/types.ts` renders one plain-text line per record, Chicago-ish, the same in the API (`citations`), the CSV footer and the HUD:

```
U.S. Bureau of Labor Statistics. Quarterly Census of Employment and Wages. series area 48453, all ownerships, all industries. period 2026-Q1. https://data.bls.gov/cew/data/api/2026/1/area/48453.csv. accessed 2026-09-11.
Zillow Research. Zillow Home Value Index (ZHVI). series County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv. period 2026-07. https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv. accessed 2026-09-11.
Zillow Research. Zillow Home Value Index (ZHVI). https://www.zillow.com/research/data/. accessed 2026-09-11. estimate computed by Embedding Atlas: price-to-rent = $412,000 / ($1,850 × 12) = 18.6.
```

Segments: publisher, source name, `series <id>` if any, `period <p>` if any, `released <date>` if known, the upstream URL (or the source landing page), `accessed <date>`, and for estimates the method. Accessed dates are the retrieval date, which is what a reader needs to reproduce a revisable series.

## CSV

Tabular ops answer `format=csv` (or `Accept: text/csv`):

| Route | Ops with CSV | One row per |
| --- | --- | --- |
| `/api/economy` | `areas`, `sectors`, `ports`, `border`, `countries`, `pulse` (`&series=1` for long format) | area, sector, port, crossing, country, series (or observation) |
| `/api/water` | `gauges`, `wells`, `nwps`, `twdb`, `history`, `matchup` | (site, parameter) reading, well reading, NWPS gauge, reservoir, day, observation |

Rules: RFC 4180 (CRLF, quoted only where needed, doubled quotes), UTF-8, header row first, stable `snake_case` columns listed under `x-csv-columns` in the OpenAPI document. A value the upstream withheld is an empty cell, never `0` or `null`. After the data come `#` comment lines: `generated_at`, one `source:` citation per provenance record, any `caveat:` lines. `Content-Disposition: inline; filename="economy-areas-county-....csv"` names the file.

Other ops (`report`, `context`, `partners`, `drought`) answer `400` to `format=csv` with the list of ops that offer it.

### pandas one-liners

```python
import pandas as pd
BASE = "https://eye.jcamd.com"

# counties in a box, one row each, with QCEW and Zillow joins
areas = pd.read_csv(f"{BASE}/api/economy?op=areas&bbox=-98.5,29.8,-97,31&format=csv", comment="#")

# every US land border crossing, latest month of each measure
border = pd.read_csv(f"{BASE}/api/economy?op=border&format=csv", comment="#")

# national pulse as a long time series (one row per observation)
pulse = pd.read_csv(f"{BASE}/api/economy?op=pulse&format=csv&series=1", comment="#", parse_dates=["date"])
mortgage = pulse[pulse.id == "MORTGAGE30US"].set_index("date")["value"]

# latest gauge readings in a box, then pivot to one row per site
g = pd.read_csv(f"{BASE}/api/water?op=gauges&bbox=-98.6,29.2,-98.2,29.6&format=csv", comment="#", parse_dates=["time"])
wide = g.pivot_table(index=["site", "name"], columns="parameter", values="value")

# a year of daily flow for one site
q = pd.read_csv(f"{BASE}/api/water?op=history&site=USGS-08180800&param=00060&format=csv", comment="#", parse_dates=["date"]).set_index("date")["value"]

# the citations that came with a CSV
import urllib.request
text = urllib.request.urlopen(f"{BASE}/api/water?op=twdb&format=csv").read().decode()
citations = [l[2:] for l in text.splitlines() if l.startswith("# source: ")]
```

JSON works just as well with `requests`; the envelope's `provenance` list is the same records as the CSV footer:

```python
import requests
r = requests.get(f"{BASE}/api/economy", params={"op": "report", "lon": -97.75, "lat": 30.3}).json()
print(r["data"]["home"]["summary"])
print("\n".join(r["data"]["citations"]))
```

## Caching

Responses carry `Cache-Control: public, max-age=0, s-maxage=<ttl>, stale-while-revalidate=<ttl>`: your browser revalidates each time, the CDN edge answers repeats within the TTL and serves stale while it refreshes. The server also holds each upstream table in memory; `cacheAge` (ms) says how old the table behind a response is, and `provenance[].retrievedAt` is already adjusted for it.

TTLs follow upstream cadence:

| Data | Edge TTL | Server table |
| --- | --- | --- |
| USGS latest continuous, NWPS | 5 min | 5 min |
| USGS wells, TWDB | 30 min | 1 h / 30 min |
| USGS history / matchup | 1 h | 1 h |
| Drought Monitor | 1 h | 6 h |
| Economy areas, sectors, ports, border | 1–6 h | 6 h (QCEW, Zillow) / 24 h (BTS ports) |
| Countries, partners | 12–24 h | 24 h |
| Pulse (FRED + BTS) | 30 min | 1 h / 6 h |
| Reports | 5–15 min | built from the tables above |
| Wildfires (WFIGS) | 5 min | 5 min |
| Fire hotspots (FIRMS) | 10 min (2 min while a file is missing) | 30 min per 24 h file; the box selection 10 min |
| Hazard alerts (NWS, GDACS, EONET) | 2 min (1 min while a source is down) | 2 min (NWS), 10 min (GDACS), 30 min (EONET) |
| Flood zones, wetlands, public lands | 1 h (wetlands 10 min while NWI's imagery layer is missing) | 1 day per snapped box |
| Elevation (EPQS) | 1 day (10 min for a "no value" answer) | 1 day per point |
| Parcel at a point (`/api/parcels`) | 1 h (10 min when no parcel was found) | 1 day per point to 5 decimals; the county lookup 30 days; NAD 7 days; PLSS 30 days |
| Parcel outlines (`mode=outlines`) | 6 h (10 min when a source failed) | 7 days per snapped box |
| Space weather, ISS stream | 15 min (2 min while a source is down) | 15 min, 30 min |
| Terrain tiles (`op=tile`: slope, contours, land cover, FEMA's map) | 30 days (FEMA's map 7 days); browsers 1 day | 1 day, up to 160 tiles per server instance |
| Terrain point classes, slope (`op=point`) | 1 h | 1 day per point (5 decimals) |
| Soils (`/api/soil`) | 1 h (point), 6 h (map unit) | 1 day per point, 7 days per map unit |
| Transmission, faults, landslides (`/api/infra`) | 6 h (faults, landslides 12 h) | 7 days per snapped box (archived or slow-changing) |
| Pipelines, rail, airports, dams (`/api/infra`) | 6 h (10 min while a pipeline service is down) | 1 day per snapped box |
| Power plants (`/api/infra?op=plants`) | 1 day | bundled snapshot (EIA-860M month, Wikidata pull date) |
| PLSS, T-R-S search, geology at a point (`/api/infra`) | 1 day | 30 days per box, query or point |
| Agency cameras (`/api/cameras`) | 2 min (LTA) to 1 h (DriveBC) | 2 min (LTA) to 6 h (DriveBC); Caltrans 1 h |
| Air quality (`/api/air`) | 10 min | 20 min per hourly file |
| News events (`/api/events`) | 10 min | 6 h per 15-minute export file; lastupdate.txt 5 min |
| Wikipedia nearby (`/api/wikipedia`) | 5 min | 5 min per point, radius and limit |
| Wikipedia summary / On this day (`/api/wikipedia`) | 6 h | 6 h per title / per calendar day |
| Zoning (point, districts) | 1 h (5 min for a New York answer whose tax-lot lookup failed) | 1 day per point or snapped box; the Census place 30 days |
| Building permits | 15 min (2 min while a city is down) | 30 min per city and box (Los Angeles 6 h) |
| Business licences | 30 min (2 min while a registry is down) | 1 h per registry and box (Los Angeles 6 h) |
| Environmental permits (ECHO, ORM) | 1 h (2 min while a source is down) | 6 h per program and box |

Bounding boxes are snapped outward (water: 0.5° grid, 4° max span; economy: 1° grid, 18° max span; fire hotspots: 1° grid, up to the whole globe; flood zones and wetlands: 0.02° grid, 0.08° max span; public lands: 0.25° grid, 2° max span; parcel outlines: 0.002° grid, 0.01° max span; infrastructure: transmission 2° / 0.25°, pipelines 4° / 0.5°, rail 1° / 0.1°, airports 8° / 1°, dams and faults 1.5° / 0.25°, landslides 0.5° / 0.1°, PLSS townships 2° / 0.25° and sections 0.4° / 0.05°, plants any span on a 1° grid, but a box whose US plants would not fit in one response returns the largest first, with `truncated` and a caveat naming the floor reached; zoning outlines: 0.0025° grid, 0.04° max span; building permits and licences: 0.0025° grid, 0.03° and 0.02° max span; environmental permits: 0.05° grid, 0.2° max span), so two callers a few kilometres apart share one entry. The snapped box comes back in `bbox`.

## Rate limits and courtesy

There is no key and no quota on this API. Behind it, the server rate-gates each upstream (one request per 150–400 ms per upstream, backing off for 30–60 s after a 429; county and state parcel servers one request per second per host, five minutes off after a 429 or a 503) and answers from cache whenever it can, so a burst from you becomes at most one upstream call per table. Please still:

- send a `User-Agent` that identifies your project;
- fetch tables once and keep them (the CSV is a file; save it);
- prefer the coarser ops (`areas&level=state`, `pulse`) for polling, and keep polling of the 5-minute ops to that cadence;
- keep the upstreams' terms: USGS, NOAA, BLS, BTS, Census, USDM and Natural Earth are public domain; Zillow data is free for public use with attribution to Zillow Research; the World Bank is CC BY 4.0; FRED relays series under their original publishers' terms.

If you need more than the edge and the cache can give, run the app yourself (`npm run dev`); every source is keyless.

## Vintages and revisions, per source

A number you fetch today may not be the number the same query returns next month. `provenance[].revision` says so per record; the specifics:

**BLS QCEW** (`bls-qcew`). Each quarter is first published about five months after it ends and is revised when the next quarter is released; a full annual revision follows. County totals can also be suppressed (`suppressed: true`, values null) in one quarter and disclosed in the next. `period` is the quarter (`2026-Q1`); re-fetching the same quarter later can give revised values, and there is no vintage API. Save what you fetched, with the `retrievedAt`.

**Zillow ZHVI / ZORI** (`zillow-zhvi`, `zillow-zori`). Zillow republishes the entire history every month and the model is re-estimated, so earlier months move a little each release (and occasionally a lot when the methodology changes). `period` is the last month column of the file at fetch time. Zillow keeps no public vintage archive; the file name plus `retrievedAt` is the vintage.

**FRED** (`fred`). FRED serves the latest vintage of every series. Series that are revised (retail sales `RSXFS`, trade balance `BOPGSTB`, housing starts `HOUST`, permits `PERMIT`, unemployment `UNRATE` after benchmark revisions) will differ from what was first released. For the as-first-published value use ALFRED (`https://alfred.stlouisfed.org/`), which the provenance `revision` note points to; `MORTGAGE30US` (Freddie Mac PMMS) and `DCOILWTICO` are not revised.

**BTS Border Crossing Entry Data** (`bts-border`). The most recent month is often incomplete when first posted and is filled in the following release; `period` is the latest month present. Year-over-year figures in `yoyPct` compare the latest month with the same month a year earlier as both stand today.

**BTS Port Performance** (`bts-ports`). Annual, `period` is the reporting year; prior years are occasionally restated when a port authority corrects its submission.

**BTS Supply Chain and Freight Indicators** (`bts-supply-chain`). Mixed cadence (weekly, monthly); the underlying series are revised by their original publishers and BTS refreshes the table, so treat them like FRED.

**World Bank WDI / WITS** (`worldbank-wdi`, `worldbank-wits`). Each value carries its own year (`mrnev=1`, most recent non-empty); countries report late and restate, so the latest year differs by country and the value for a given year can change between WDI editions.

**USGS Water Data** (`usgs-water`). Continuous and daily values are *provisional* until approved, and approved values can differ (shifts, corrections, removed readings). `revision` carries the approval flag the response saw (`Provisional`, `Approved`, or `mixed: ...`). A daily mean in `op=history` for last week is provisional; the same day next year may be approved and slightly different.

**NOAA NWPS** (`noaa-nwps`). Observations are live and superseded within the hour; forecasts change every cycle. Treat any value as a snapshot at `retrievedAt`.

**TWDB** (`twdb`). Daily conservation-pool figures; capacity tables are revised after a survey, which changes percent full for the same storage. `period` is the reservoir timestamp.

**US Drought Monitor** (`usdm`). Released Thursdays for the week ending the previous Tuesday and never revised; the feature service we read carries only the class, not the week, so the record says so in `notes` rather than inventing a date.

**NGA World Port Index, Natural Earth** (`nga-wpi`, `natural-earth`). Bundled copies; `retrievedAt` is the day the copy was taken (`wpiPulled`, `nePulled` at the top level of those responses).

**Hazard feeds** (`nifc-wfigs`, `nasa-firms`, `nws-api`, `gdacs`, `nasa-eonet`). Snapshots of live feeds (`kind: "snapshot"`): perimeters are redrawn, alerts updated and cancelled, events closed, and FIRMS's 24 h files are rewritten as new passes arrive, so the same call later answers differently and nothing is kept here. A FIRMS record carries the file's `Last-Modified` as `releasedAt`. Every hazards answer says in `caveats` that it is not a warning service; a source that did not answer is named there and its events are missing, not absent.

**FEMA NFHL** (`fema-nfhl`). The effective regulatory flood map; FEMA revises panels through map revisions and new studies, so a zone can change between fetches. A regulatory map, not a forecast, and a box with no zone is not a finding of no risk.

**USFWS NWI** (`usfws-nwi`). Each polygon is as old as the imagery its mapping project was drawn from; `imageYears` (and each feature's `mapped from`) says which years, and `null` means NWI's source layer did not answer, not that the year is unknown to NWI.

**USGS PAD-US** (`usgs-padus`). Version 4.1 (doi:10.5066/P96WBCHS), relayed as published, owners and easement holders included; a later version replaces it. Public-access codes are PAD-US's, not permission to enter.

**USGS EPQS** (`usgs-epqs`). The 3DEP DEM that covers the point answers; `resolutionM` says which resolution it was, and 3DEP replaces DEMs as new lidar arrives. Outside 3DEP coverage there is no value, never a guessed one.

**USGS 3DEP dynamic service** (`usgs-3dep`). Slope, contours and the point slope are computed by USGS on request from the best DEM it holds for the place, and 3DEP swaps in new lidar as it arrives, so a tile or a slope can change; the tile the edge holds can be up to 30 days older than a fresh render.

**NRCS SSURGO** (`nrcs-ssurgo`). Soil survey areas are revised and re-saved (the September 2025 save for Bexar County is what the probes read); `revision` carries the survey area's save date. NCCPI is an NRCS interpretation of the components, recomputed when they change; a component NRCS did not rate is `null`, never 0.

**USFS Wildfire Hazard Potential** (`usfs-whp`). The 2023 edition (updated 17 July 2024), landscape as of the end of 2020; the next edition replaces it. The class labels come from the service's own legend.

**MRLC NLCD 2021** (`mrlc-nlcd`). A fixed edition; MRLC also publishes annual land cover, which this app does not read yet. Labels and colours are MRLC's legend.

**NOAA sea level rise** (`noaa-slr`). Fixed scenario caches, one per foot of rise above today's MHHW; NOAA revises them when it re-runs an area.

**City zoning** (`seattle-zoning`, `denver-zoning`, `nyc-dcp-zoning`, `nyc-ztldb`, `chicago-zoning`, `dallas-zoning`, `sanantonio-zoning`, `austin-zoning`, `la-zoning`, `sf-zoning`). Each city edits its layer as ordinances pass, a few times a month; the ZTLDB is monthly. The ZTLDB has no row for a condominium's billing lot (75xx) and there is no lot in a street, so there New York's overlays come from DCP's special purpose district, commercial overlay and limited-height layers at the point (`published["overlays from"]` says so); `overlaysUnknown: true` means neither answered and the overlays are unknown, not empty. `state` says what the answer is (district, right-of-way, no-district, no-ordinance for Houston, not-covered), `place` is the Census place that picked the city, and `published` carries the city's further fields label by label. The adopted zoning map and code govern; this is not a zoning verification.

**Building permits** (`chicago-permits`, `austin-permits`, `seattle-permits`, `denver-permits`, `nyc-dob-permits`, `la-permits`, `sf-permits`). Live records: a permit's status, dates and valuation change as the city processes it, and the same query later answers differently. `coverage[]` names every city the box meets and its state; `partial` means the newest 500 came back and there are more. Valuations keep the name of the column they came from (`valuationLabel`), because the cities do not measure the same thing.

**Licences** (`ny-sla-licences`, `chicago-licences`, `sf-business-locations`, `la-active-businesses`, `nyc-dcwp-licences`). Named by trade name; the registry's legal or registrant name is requested only to test for an entity form and to compare it with the trade name, and is discarded otherwise, so a trade name that is a non-company registrant's own name is not shown (`nameNote` says why). `withheld` counts licences at apartment or unit addresses (a home-business heuristic). Los Angeles refreshes monthly, New York City's premises licences last updated 2026-08-20.

**Environmental permits** (`epa-echo-cwa`, `epa-echo-air`, `usace-orm`). ECHO refreshes weekly; compliance is ECHO's words, and `not reported by ECHO` is not "no violation". The Corps' search is an undocumented public API: it returns at most 300 actions, every one in the box first and then actions from anywhere in the country to fill the 300, so only those inside the box are kept (sorted newest first here); `coverage` says `partial` only when all 300 lay in the box. Its `total` is national, so it is not relayed. Project names are the Corps' own, except one that opens "Surname, Given" (a private applicant's project), which is withheld with `facilityNote` saying so; a project name can still carry a person's name in another form.

**GFZ Kp and NASA DONKI** (`gfz-kp`, `nasa-donki`). GFZ marks recent Kp values preliminary (`status: "pre"`) and replaces them with definitive ones later; the provenance `revision` says `preliminary` while any value in the answer is. DONKI calls itself experimental research information and points to NOAA SWPC as the official source.

**HIFLD transmission lines** (`hifld-transmission`). An archived layer: "It will no longer be updated or maintained", last data update 2024-09-30 (`period`). Lines built, rebuilt or retired since are not shown as they are now. HIFLD's -999999 voltage and `UNKNOWN<n>` substations are dropped.

**EIA pipelines, FRA rail, FAA airports, USACE NID, USGS Qfaults and landslides, BLM PLSS** (`eia-pipelines`, `bts-narn`, `faa-airports`, `usace-nid`, `usgs-qfaults`, `usgs-landslides`, `blm-plss`). Relayed as published from each feature service; each publisher revises on its own cycle (FAA every 56 days, FRA's network last on 2026-07-21 when read, NID continuously with a per-record update date, the landslide inventory as version 3.0 of February 2025). A box that hit a service's record limit says so in `truncated` and `caveats` (transmission highest voltage first, rail longest first, faults longest first, landslides most confident first; dams in the service's own order).

**EIA-860M and Wikidata** (`eia-860m`, `wikidata`). Bundled snapshots written by `node scripts/infra-data.mjs`: the newest monthly EIA-860M generator workbook that answers (preliminary; EIA replaces it monthly and with the annual EIA-860) and a Wikidata SPARQL pull of nuclear power plants outside the US. `inventoryAsOf` and `snapshotsPulled` say which.

**Macrostrat** (`macrostrat`). A compilation of published maps at several scales; each unit cites its map in `source`. CC BY 4.0.

**Agency cameras** (`caltrans-cwwp2`, `drivebc-highwaycams`, `digitraffic-weathercam`, `lta-traffic-images`, `tfl-jamcams`, `nyc-dot-cameras`). Snapshots of live lists (`kind: "snapshot"`); the stills are the agency's current images and nothing is recorded here.

**EPA AirNow** (`epa-airnow`). Preliminary: "not fully verified or validated … subject to change" (AirNow Data Exchange Guidelines, last updated August 2025). `ozoneAqi`, `pm25Aqi` and `pm10Aqi` are AirNow's NowCast AQI and `no2Aqi` its 1-hour AQI, computed by AirNow from the concentrations each agency sent (HourlyAQObs fact sheet). `period` is the observation hour (UTC); `hourUtc` names the file. Validated data live in EPA's AQS archive. `/api/air` answers 404 until the operator returns AirNow's data-user form (`AIRNOW_ENABLED` in `lib/air/airnow.ts`).

**GDELT** (`gdelt`). 15-minute export files, each fixed once published; a later file can add events about the same incident. The window is in `window`, and `leftOff` counts the rows dropped by the rules (not conflict, not city-level, no position).

**Parcels** (`txgio-stratmap`, `hcad-parcels`, `maricopa-assessor`, `lacounty-assessor`, `cook-parcels`, `king-parcels`, `detroit-parcels`, `wi-parcels`, `nc-parcels`, `mt-cadastral`, `mn-parcels`, `fl-dor-cadastral`, `massgis-parcels`, `vcgi-parcels`, `ugrc-lir`, `ohio-parcels`, `njogis-parcels`, `nys-tax-parcels`, `ct-parcels`, `md-parcels`, with `usdot-nad` and `blm-plss`). Each record is the county's or state's tax roll as its service holds it on the day it is read: values carry the source's own year label (`values.year`: tax, roll, fiscal or grand-list year), and a statewide composite (TxGIO StratMap, Florida DOR, Ohio OGRIP) can be a year or more behind the county's own record, which `link` points to where the source publishes one. Owners change hands and flags change at the source; a record here follows within about a day. `/api/parcels` takes a point (`lon`, `lat`) or a box (`bbox`) and refuses any name or search parameter; see the README's "Parcels & ownership" for what is withheld and why.

**Estimates** (`kind: "estimate"`). Deterministic given their inputs; the inputs are the records next to them. Re-running with revised inputs gives a different estimate, and `method` shows exactly which numbers went in.

## Adding an op or a route

`lib/server/respond.ts` has the pieces: `ok(data, { meta, provenance, caveats, ttlS })` for the envelope, `csv(rows, { columns, filename, provenance, caveats, ttlS })` for the CSV branch, `badRequest`, `options` for OPTIONS, `parseFormat(req)`. Build provenance with the helpers in `lib/economy/provenance.ts` / `lib/water/provenance.ts` (or `provenance(source(id), {...})` from `lib/provenance/types.ts`), add any new source to `lib/provenance/sources.ts` first, write the flattener as a pure function with a test, and add the op to the `op` enum in `public/openapi.json` (a test checks that the enum and the route's `case` labels agree).
