# sports-money (NBA valuations x payrolls)

What powers the "which franchises appreciated most per dollar of payroll" views.

## What's staged

| File | Contents |
|---|---|
| `lib/sports-money/data/nba_valuations.json` | 12 Forbes editions (2015 through 2025), 30 teams each, values in USD billions. One gap: 2021a (Feb 2021) is missing MEM (rank 30) - never back-filled. |
| `lib/sports-money/data/nba_payrolls.json` | Spotrac Team Salary Cash Tracker per season: `active_usd`, `dead_usd`, `total_cash_usd` per team-season. Covers 2014-15, 2020-21, 2023-24, 2024-25 so far; the remaining seasons are still being pulled (see Gaps). |

## Schema

### nba_valuations.json
```jsonc
{
  "_readme": "...",
  "source": "Forbes annual NBA franchise valuations",
  "source_methodology": "enterprise value = equity + net debt; revenue x multiple",
  "teams": { "ATL": "Atlanta Hawks", ... },   // 30 short codes
  "editions": [
    {
      "edition": "2025",          // publication-year label; 2021 has "2021a" (Feb) and "2021b" (Oct)
      "published": "2025-10-23",  // Forbes publication date
      "season": "2024-25",        // season the valuation is based on (prior completed season)
      "league_avg_b": 5.4,
      "source_url": "...",        // republished table used for transcription
      "notes": "...",
      "valuations_b": { "GSW": 11.0, ... }   // 30 teams, USD billions, as Forbes rounded them
    }
  ],
  "gaps": [ { "edition": "2021a", "team": "MEM", "rank": 30, "note": "..." } ]
}
```

### nba_payrolls.json
```jsonc
{
  "_readme": "...",
  "seasons": {
    "2024-25": {   // Spotrac cash-tracker year param = season start year
      "active_usd":  { "PHX": 200826123, ... },  // cash paid to active roster
      "dead_usd":    { "PHX": 3814041, ... },    // dead money / stretched contracts
      "total_cash_usd": { "PHX": 219967750, ... } // active + dead + retained
    }
  }
}
```

## Pairing: valuation edition -> payroll season

Forbes prices each edition on the **prior completed season's** finances, so each edition pairs with that same season's payrolls:

| Edition | Published | Valuation season | Payroll season (Spotrac year) | Status |
|---|---|---|---|---|
| 2015 | 2015-01-21 | 2013-14 | 2013-14 (year=2013) | pending |
| 2016 | 2016-01-20 | 2014-15 | 2014-15 (year=2014) | done |
| 2017 | 2017-02-15 | 2015-16 | 2015-16 (year=2015) | pending |
| 2018 | 2018-02-07 | 2016-17 | 2016-17 (year=2016) | pending |
| 2019 | 2019-02-06 | 2017-18 | 2017-18 (year=2017) | pending |
| 2020 | 2020-02-11 | 2018-19 | 2018-19 (year=2018) | pending |
| 2021a | 2021-02-10 | 2019-20 | 2019-20 (year=2019) | pending |
| 2021b | 2021-10-18 | 2020-21 | 2020-21 (year=2020) | done |
| 2022 | 2022-10-27 | 2021-22 | 2021-22 (year=2021) | pending |
| 2023 | 2023-10-26 | 2022-23 | 2022-23 (year=2022) | pending |
| 2024 | 2024-10-24 | 2023-24 | 2023-24 (year=2023) | done |
| 2025 | 2025-10-23 | 2024-25 | 2024-25 (year=2024) | done |

Derived metric for the layer: `valuation_b * 1e9 / total_cash_usd` = franchise value per dollar of cash payroll
(e.g. the 2024-25 PHX: $4.3B / $219,967,750 = ~19.6x). Use `total_cash_usd` (the owner cash-outlay view) as the primary
ratio input; `active_usd` and `dead_usd` are kept for drill-downs (dead-money tax stories like BKN 2024-25's $58M dead).

## Sources

- Forbes valuations: canonical list at https://www.forbes.com/nba-valuations/list/ (latest edition only; older editions paywalled or removed). Transcription sources per edition are in each edition's `source_url` (Hoops Rumors, theScore, Bleacher Report, TalkBasket, NBC Sports, ESPN, sportsnaut, basketballnetwork, basketballinsiders). Wikipedia's "List of NBA teams by valuation" was used for the 2025 edition only.
- Payrolls: Spotrac NBA Team Salary Cash Tracker, https://www.spotrac.com/nba/cash/_/year/{YYYY}/sort/cash_total (year = season start year).
- Numbers are facts transcribed verbatim; prose was never copied.

## Gaps and honesty notes

1. **2021a edition missing MEM** (rank 30, Feb 2021) - the source list omitted the 30th team. Not back-filled.
2. **2023 edition minor discrepancy**: Sacramento Kings / Atlanta Hawks both listed at $3.33B; another source lists ATL at $3.32B and SAC at $3.33B. Kept as $3.33B for both per the primary source; noted in the bundle.
3. **Payroll coverage partial**: 8 seasons still pending (2013-14, 2015-16, 2016-17, 2017-18, 2018-19, 2019-20, 2021-22, 2022-23). Spotrac throttles automated fetches (HTTP 402); pulling a few pages per hour works. A refresh script sketch is in `scripts/sports-money-pull.mjs` with a polite-rate-limited puller plus a manual checklist for Forbes.
4. **Cash tracker = owner cash outlay**, not cap payroll. "Retained salary" (traded players' guaranteed cash) is included in total cash. This is the right denominator for "value per dollar spent", but differs from cap-sheet payroll (e.g. GSW 2024-25: $172M cash vs a higher cap number).
5. **2021b is an off-cycle October edition** (two 2021 editions exist); both are kept because dropping either would break the time series.
6. **2025 edition** transcribed from Wikipedia's mirror of the Forbes Oct 23, 2025 list; Forbes itself blocked text extraction. Values cross-checked against news coverage (GSW $11B, LAL $10B, NYK $9.75B, LAC $7.5B, BOS $6.7B).

## What a merge would wire up

Following the gas pattern (`lib/layers/gasPrices.ts` -> `lib/gas/data/*.json`):

- New layer file(s), e.g. `lib/layers/sportsMoney.ts` (+ `sportsMoneyValuations.ts` / `sportsMoneyPayroll.ts` if split), registered in the layer list the same way gasPrices/gasForecast are.
- A small loader in `lib/sports-money/` mirroring `lib/gas/gas.ts` (typed accessors: `valuations()`, `payrolls()`, `ratio(team, season)`).
- The view: franchise appreciation per payroll dollar, drawn at team map points (arena locations already exist in the places/company datasets) or as a panel/ranked list; Time-machine playback can step editions since each edition is a dated snapshot (the gas layer's `gasWeekForDate` pattern maps to "nearest edition <= playback date").
- Refresh wiring: `scripts/sports-money-pull.mjs` (`npm run data:sports-money`), documented to run annually after the Forbes list drops (October).
