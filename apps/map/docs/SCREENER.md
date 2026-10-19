# Screener

Rank and filter every county, state, port, land border crossing or country by the published metrics the economy layers already carry, without loading a single polygon. Server-side over the whole set (`/api/screen`), client-side in the Screener panel next to the globe (click a row to fly there; `?screen=county:<query>` opens a saved screen).

Nothing is imputed: a value the upstream did not publish is empty and never matches a numeric condition. Derived fields are marked `estimate` and print their arithmetic in `fields[].method`, in the CSV footer and in `provenance`.

## Query syntax

```
<where> [SORT <field> [ASC|DESC][, ...]] [LIMIT n] [OFFSET n]
```

| element | example |
|---|---|
| comparison | `home.yoyPct > 5`, `jobs.yoy.emp <= 0`, `state == TX`, `state != TX` (`=` is accepted for `==`) |
| range | `teu BETWEEN 100000 AND 5000000` (inclusive) |
| list | `state IN (TX, CA, "NY")` |
| substring | `name CONTAINS "york"` (case-insensitive) |
| logic | `AND`, `OR`, parentheses; `AND` binds tighter than `OR` |
| strings | bare words (`TX`, `large`), or quoted with `"…"` / `'…'`; `\"` escapes a quote |
| numbers | `5`, `-2.5`, `1e6`, `250_000` |
| sort | `SORT momentum DESC, name` (missing values sort last either way); `ORDER BY` also works |
| paging | `LIMIT 50 OFFSET 100`; limit defaults to 100 and is clamped to 1000 |

Keywords are case-insensitive. Numeric operators (`> >= < <= BETWEEN`) need a numeric field; `CONTAINS` needs a text field; `==`, `!=` and `IN` work on either (text compares case-insensitively). A query longer than 2 KB is rejected. Errors come back structured: `{ code: "syntax" | "unknown_field" | "invalid_op" | "invalid_value" | ..., message, field?, position? }`.

Examples:

```
home.yoyPct > 5 AND jobs.yoy.emp < 0 SORT momentum DESC LIMIT 50
(state == TX OR state == AZ) AND priceToRent < 15 SORT priceToRent ASC
rent.yoyPct > 0 AND jobs.yoy.emp < 0 SORT rent.yoyPct DESC
teu.yoyPct < 0 SORT teu DESC
trucks > 0 SORT trucks.yoyPct DESC LIMIT 20
border CONTAINS Mexico SORT people DESC
balance > 0 SORT balancePctGdp DESC
continent == Europe AND tradePct > 100
```

### JSON form

Equivalent to the string form; accepted by `POST /api/screen`.

```json
{
  "kind": "county",
  "query": {
    "where": [
      { "field": "home.yoyPct", "op": ">", "value": 5 },
      { "or": [{ "field": "state", "op": "==", "value": "TX" }, { "field": "state", "op": "==", "value": "AZ" }] }
    ],
    "sort": [{ "field": "momentum", "dir": "desc" }],
    "limit": 50,
    "offset": 0
  }
}
```

`where` entries are ANDed. A group is `{ "and": [...] }` or `{ "or": [...] }` and may hold conditions or further groups (three levels deep at most). `op` is one of `> >= < <= == != between in contains`; `between` takes `[lo, hi]`, `in` takes a list. `"query"` may also be the string form.

## API

```bash
# Counties where home values rose more than 5% while jobs fell, hottest momentum first
curl "https://eye.jcamd.com/api/screen?kind=county&q=home.yoyPct>5%20AND%20jobs.yoy.emp<0%20SORT%20momentum%20DESC%20LIMIT%2050"

# Ports losing containers, as CSV with units in the header and provenance in the footer
curl "https://eye.jcamd.com/api/screen?kind=port&q=teu.yoyPct<0%20SORT%20teu%20DESC&format=csv" -o ports.csv

# Countries by trade balance, only three columns, with percentile ranks within the result
curl "https://eye.jcamd.com/api/screen?kind=country&q=SORT%20balance%20DESC%20LIMIT%2020&cols=name,balance,gdp&pct=1"

# Same thing as JSON
curl -X POST https://eye.jcamd.com/api/screen -H 'content-type: application/json' \
  -d '{"kind":"crossing","query":{"where":[{"field":"trucks","op":">","value":50000}],"sort":[{"field":"trucks.yoyPct","dir":"desc"}],"limit":20}}'

# The field registry for a kind
curl "https://eye.jcamd.com/api/screen?kind=crossing&fields=1"
```

Parameters: `kind` (required) `county | state | port | crossing | country`; `q` the string query; `format=csv`; `pct=1` adds `pct` (0–100 percentile rank of each numeric value within the matched set, ties at the average rank); `cols=a,b,c` limits `values` to those fields.

Response (`format` omitted):

```json
{
  "data": {
    "kind": "county",
    "query": "home.yoyPct>5 AND jobs.yoy.emp<0 SORT momentum DESC LIMIT 50",
    "rows": [{ "id": "county:48453", "layer": "realestate", "kind": "county", "name": "Travis County, TX", "geo": [-97.78, 30.33], "values": { "home.latest": 520000, "...": null } }],
    "count": 50,
    "total": 212,
    "applied": { "where": [], "sort": [], "limit": 50, "offset": 0 },
    "fieldsUsed": ["home.yoyPct", "jobs.yoy.emp", "momentum"],
    "stats": { "home.latest": { "n": 212, "min": 0, "p25": 0, "median": 0, "p75": 0, "max": 0 } }
  },
  "fields": [{ "key": "home.latest", "label": "Typical home value", "unit": "USD", "kind": "number", "source": "zillow-zhvi", "headline": true }],
  "provenance": [{ "source": { "id": "zillow-zhvi", "name": "…" }, "kind": "published", "period": "2026-07-31", "retrievedAt": "…" }],
  "generatedAt": "…",
  "caveats": ["…"]
}
```

`stats` covers every matching row, not just the page. `rows[].id` is the feature id on the globe (`county:GEOID`, `state:FIPS`, `port:WPI id`, `crossing:port code`, `country:ISO3`), so a row can select the polygon or point when that layer is loaded. Entity sets are assembled from the same cached tables as `/api/economy` and cached for an hour; responses carry `cache-control: public, s-maxage=3600`.

CSV: header cells read `key (unit)` or `key (unit, estimate)`; rows follow; then `#` comment lines with the query, one citation per source (with period and retrieval date) and the method of every estimate column.

## Adding a field

One object in `lib/screener/fields.ts`, in the list for its entity kind:

```ts
{ key: "jobs.yoy.estabs", label: "Establishments over-the-year change", unit: "%", kind: "pct", source: "bls-qcew", get: (f) => n(area(f).jobs?.yoy.estabs) }
```

`kind` is `number`, `pct`, `string` or `estimate` (estimates must set `method`); `source` is an id from `lib/provenance/sources.ts`; `headline: true` shows it in the panel by default. The getter returns `null` for a gap. Then run `UPDATE_SCREENER_DOCS=1 npx vitest run lib/screener/docs.test.ts` to regenerate the tables below.

## Fields

### Counties and states

Sources: Zillow ZHVI / ZORI (monthly), BLS QCEW (quarterly), Census TIGERweb (names and internal points). States have no rent series.

<!-- fields:county -->
| key | label | unit | kind | source | method |
|---|---|---|---|---|---|
| `name` | Name |  | string | census-tigerweb |  |
| `geoid` | GEOID |  | string | census-tigerweb |  |
| `state` | State |  | string | census-tigerweb |  |
| `metro` | Metro |  | string | zillow-zhvi |  |
| `home.latest` | Typical home value | USD | number | zillow-zhvi |  |
| `home.yoyPct` | Home value 1-yr change | % | pct | zillow-zhvi |  |
| `home.y5Pct` | Home value 5-yr change | % | pct | zillow-zhvi |  |
| `home.asOf` | Home value month |  | string | zillow-zhvi |  |
| `rent.latest` | Typical rent | USD/month | number | zillow-zori |  |
| `rent.yoyPct` | Rent 1-yr change | % | pct | zillow-zori |  |
| `jobs.emp` | Jobs (third month of quarter) | jobs | number | bls-qcew |  |
| `jobs.estabs` | Establishments | count | number | bls-qcew |  |
| `jobs.wages` | Total quarterly wages | USD | number | bls-qcew |  |
| `jobs.avgWeeklyWage` | Average weekly wage | USD/week | number | bls-qcew |  |
| `jobs.yoy.emp` | Jobs over-the-year change | % | pct | bls-qcew |  |
| `jobs.yoy.estabs` | Establishments over-the-year change | % | pct | bls-qcew |  |
| `jobs.yoy.wages` | Total wages over-the-year change | % | pct | bls-qcew |  |
| `jobs.yoy.avgWeeklyWage` | Weekly wage over-the-year change | % | pct | bls-qcew |  |
| `jobs.period` | QCEW quarter |  | string | bls-qcew |  |
| `jobs.suppressed` | QCEW cell withheld |  | string | bls-qcew |  |
| `priceToRent` | Price-to-rent | ratio | estimate | zillow-zhvi | typical home value / (typical rent × 12); Zillow ZHVI over ZORI, same month |
| `momentum` | Momentum index | index −1..1 | estimate | zillow-zhvi | momentum = Σ wᵢ · clip(changeᵢ / scaleᵢ, −1, 1) / Σ wᵢ over the terms present; weights and scales: home value 1-yr change 0.3 (±10%), rent 1-yr change 0.15 (±10%), jobs over-the-year change 0.3 (±3%), avg weekly wage over-the-year change 0.25 (±6%) |
| `yearsOfWages` | Years of wages | years | estimate | bls-qcew | typical home value / (average weekly wage × 52); one average covered job, not a household |
<!-- /fields:county -->

States use the same registry:

<!-- fields:state -->
| key | label | unit | kind | source | method |
|---|---|---|---|---|---|
| `name` | Name |  | string | census-tigerweb |  |
| `geoid` | GEOID |  | string | census-tigerweb |  |
| `state` | State |  | string | census-tigerweb |  |
| `metro` | Metro |  | string | zillow-zhvi |  |
| `home.latest` | Typical home value | USD | number | zillow-zhvi |  |
| `home.yoyPct` | Home value 1-yr change | % | pct | zillow-zhvi |  |
| `home.y5Pct` | Home value 5-yr change | % | pct | zillow-zhvi |  |
| `home.asOf` | Home value month |  | string | zillow-zhvi |  |
| `rent.latest` | Typical rent | USD/month | number | zillow-zori |  |
| `rent.yoyPct` | Rent 1-yr change | % | pct | zillow-zori |  |
| `jobs.emp` | Jobs (third month of quarter) | jobs | number | bls-qcew |  |
| `jobs.estabs` | Establishments | count | number | bls-qcew |  |
| `jobs.wages` | Total quarterly wages | USD | number | bls-qcew |  |
| `jobs.avgWeeklyWage` | Average weekly wage | USD/week | number | bls-qcew |  |
| `jobs.yoy.emp` | Jobs over-the-year change | % | pct | bls-qcew |  |
| `jobs.yoy.estabs` | Establishments over-the-year change | % | pct | bls-qcew |  |
| `jobs.yoy.wages` | Total wages over-the-year change | % | pct | bls-qcew |  |
| `jobs.yoy.avgWeeklyWage` | Weekly wage over-the-year change | % | pct | bls-qcew |  |
| `jobs.period` | QCEW quarter |  | string | bls-qcew |  |
| `jobs.suppressed` | QCEW cell withheld |  | string | bls-qcew |  |
| `priceToRent` | Price-to-rent | ratio | estimate | zillow-zhvi | typical home value / (typical rent × 12); Zillow ZHVI over ZORI, same month |
| `momentum` | Momentum index | index −1..1 | estimate | zillow-zhvi | momentum = Σ wᵢ · clip(changeᵢ / scaleᵢ, −1, 1) / Σ wᵢ over the terms present; weights and scales: home value 1-yr change 0.3 (±10%), rent 1-yr change 0.15 (±10%), jobs over-the-year change 0.3 (±3%), avg weekly wage over-the-year change 0.25 (±6%) |
| `yearsOfWages` | Years of wages | years | estimate | bls-qcew | typical home value / (average weekly wage × 52); one average covered job, not a household |
<!-- /fields:state -->

### Ports

Sources: NGA World Port Index (bundled snapshot; depths in metres), BTS Port Performance (annual, US ports only).

<!-- fields:port -->
| key | label | unit | kind | source | method |
|---|---|---|---|---|---|
| `name` | Name |  | string | nga-wpi |  |
| `country` | Country |  | string | nga-wpi |  |
| `region` | WPI region |  | string | nga-wpi |  |
| `locode` | UN/LOCODE |  | string | nga-wpi |  |
| `size` | Harbour size |  | string | nga-wpi |  |
| `type` | Harbour type |  | string | nga-wpi |  |
| `channelM` | Channel depth | m | number | nga-wpi |  |
| `maxDraftM` | Max draft | m | number | nga-wpi |  |
| `cargoPierM` | Cargo pier depth | m | number | nga-wpi |  |
| `anchorageM` | Anchorage depth | m | number | nga-wpi |  |
| `oilM` | Oil terminal depth | m | number | nga-wpi |  |
| `lngM` | LNG terminal depth | m | number | nga-wpi |  |
| `tidalRangeM` | Tidal range | m | number | nga-wpi |  |
| `bts.year` | BTS reporting year |  | number | bts-ports |  |
| `bts.authority` | BTS port authority |  | string | bts-ports |  |
| `teu` | Containers | TEU | number | bts-ports |  |
| `teu.imports` | Import containers | TEU | number | bts-ports |  |
| `teu.exports` | Export containers | TEU | number | bts-ports |  |
| `teu.empty` | Empty containers | TEU | number | bts-ports |  |
| `teu.rank` | Container rank (US) | rank | number | bts-ports |  |
| `teu.yoyPct` | Containers year-over-year | % | pct | bts-ports |  |
| `tons` | Total tonnage | short tons | number | bts-ports |  |
| `tons.foreign` | Foreign tonnage | short tons | number | bts-ports |  |
| `tons.domestic` | Domestic tonnage | short tons | number | bts-ports |  |
| `tons.rank` | Tonnage rank (US) | rank | number | bts-ports |  |
| `tons.yoyPct` | Tonnage year-over-year | % | pct | bts-ports |  |
| `dryBulk` | Dry bulk | short tons | number | bts-ports |  |
| `dryBulk.yoyPct` | Dry bulk year-over-year | % | pct | bts-ports |  |
| `teu.emptySharePct` | Empty container share | % | estimate | bts-ports | empty TEU / total TEU × 100, latest BTS reporting year |
<!-- /fields:port -->

### Border crossings

Source: BTS Border Crossing Entry Data (monthly). A measure the port does not report is empty, not zero.

<!-- fields:crossing -->
| key | label | unit | kind | source | method |
|---|---|---|---|---|---|
| `name` | Name |  | string | bts-border |  |
| `code` | Port code |  | string | bts-border |  |
| `state` | State |  | string | bts-border |  |
| `border` | Border |  | string | bts-border |  |
| `asOf` | Latest month |  | string | bts-border |  |
| `trucks` | Trucks (latest month) | per month | number | bts-border |  |
| `trucks.yoyPct` | Trucks year-over-year | % | pct | bts-border |  |
| `trains` | Trains (latest month) | per month | number | bts-border |  |
| `trains.yoyPct` | Trains year-over-year | % | pct | bts-border |  |
| `buses` | Buses (latest month) | per month | number | bts-border |  |
| `buses.yoyPct` | Buses year-over-year | % | pct | bts-border |  |
| `cars` | Personal vehicles (latest month) | per month | number | bts-border |  |
| `cars.yoyPct` | Personal vehicles year-over-year | % | pct | bts-border |  |
| `pedestrians` | Pedestrians (latest month) | per month | number | bts-border |  |
| `pedestrians.yoyPct` | Pedestrians year-over-year | % | pct | bts-border |  |
| `carPassengers` | Personal vehicle passengers (latest month) | per month | number | bts-border |  |
| `busPassengers` | Bus passengers (latest month) | per month | number | bts-border |  |
| `trainPassengers` | Train passengers (latest month) | per month | number | bts-border |  |
| `people` | People counted | per month | estimate | bts-border | sum of the passenger measures BTS published for the port (personal vehicle, bus and train passengers, pedestrians), latest month; a measure the port does not report is left out, not zeroed |
<!-- /fields:crossing -->

### Countries

Sources: World Bank WDI (most recent year per country and indicator; years differ), Natural Earth (names, label points, population estimate).

<!-- fields:country -->
| key | label | unit | kind | source | method |
|---|---|---|---|---|---|
| `name` | Name |  | string | natural-earth |  |
| `iso3` | ISO3 |  | string | natural-earth |  |
| `continent` | Continent |  | string | natural-earth |  |
| `pop` | Population (Natural Earth estimate) | people | number | natural-earth |  |
| `gdp` | GDP, current US$ | USD | number | worldbank-wdi |  |
| `gdp.year` | GDP year |  | string | worldbank-wdi |  |
| `exports` | Exports of goods and services | USD | number | worldbank-wdi |  |
| `imports` | Imports of goods and services | USD | number | worldbank-wdi |  |
| `tradePct` | Trade share of GDP | % | pct | worldbank-wdi |  |
| `teu` | Container port traffic | TEU | number | worldbank-wdi |  |
| `rank` | Trade rank | rank | number | worldbank-wdi |  |
| `balance` | Trade balance | USD | estimate | worldbank-wdi | exports − imports of goods and services, current US$, only when both are for the same year |
| `balancePctGdp` | Trade balance share of GDP | % | estimate | worldbank-wdi | (exports − imports) / GDP × 100, all three for the same year |
| `gdpPerCapita` | GDP per person | USD | estimate | worldbank-wdi | World Bank GDP (current US$) / Natural Earth population estimate; the two years differ, so read it as a rough scale |
<!-- /fields:country -->
