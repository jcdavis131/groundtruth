# Banks and federal spending

Two layers and one route over two keyless, public-domain sources:

- **Bank branches** (`banks`): every FDIC-insured office in view with the deposits booked there. FDIC BankFind Suite.
- **Federal spending** (`spending`): obligations by place of performance for every county (states from far away), coloured by dollars per covered job. USAspending, with BLS QCEW as the denominator.

Both are about institutions: banks, offices, recipients (legal entities), agencies. No person appears anywhere; the only addresses are the business addresses FDIC publishes for offices.

## Sources

| id | what | cadence | terms |
| --- | --- | --- | --- |
| `fdic-bankfind` | [BankFind Suite API](https://api.fdic.gov/banks/docs/): `/institutions`, `/locations`, `/sod` (Summary of Deposits), `/financials`, `/failures` | financials quarterly; SOD annual as of June 30, published in the autumn | public domain |
| `usaspending` | [USAspending API v2](https://api.usaspending.gov/docs/endpoints): `spending_by_geography`, `spending_by_category/{recipient,awarding_agency,naics}`, `spending_over_time` | continuous; agencies report within about 45 days of a quarter's end | public domain; asks for a User-Agent and reasonable rates |
| `bls-qcew` | covered employment (the per-job denominator) via `lib/economy/sources.ts` | quarterly | public domain |
| `census-tigerweb` | county and state polygons via `lib/economy/sources.ts` | | public domain |

Neither upstream could be reached from the build sandbox. Parsers follow the documented shapes and are tested on fixtures; each module carries `// shape per <docs url>; unverified in sandbox`.

## Terms

- **Obligation**: a binding commitment by an agency to spend. It is not an outlay (money actually paid), and a multi-year contract is obligated when signed, not spread over its life.
- **Place of performance**: where the work happens or the benefit lands, as the award reports it. A county's figure is not "money paid to companies in that county" (that would be recipient location).
- **Award families**: contracts (type codes A-D), grants (02-05), loans (07-08), direct payments (06, 10). Insurance and other codes are not requested. Extend `AWARD_GROUPS` in `lib/finance/types.ts` to add one.
- **Federal fiscal year**: FY N runs 1 October N-1 to 30 September N. `latestCompleteFy(now)` is the default; `fy=` overrides it.
- **Summary of Deposits (SOD)**: FDIC's annual survey of deposits by office, as of June 30. `DEPSUMBR` is $ thousands upstream; the API converts to dollars. Some banks book most deposits at a headquarters office, so branch dots understate those markets.
- **HHI**: Herfindahl-Hirschman index of county deposit shares, Σ (share %)², 0 to 10,000. Labels use the DOJ 1995 bank merger screen: under 1000 unconcentrated, 1000-1800 moderately concentrated, over 1800 highly concentrated. Kind `estimate`; the formula is printed with the figure.
- **Per job**: FY obligations divided by QCEW third-month employment for all ownerships. Federal employees are in the denominator. Kind `estimate`; the formula is printed.

## Route: `/api/finance`

Every response is the shared envelope `{ ...meta, data, provenance, generatedAt, caveats? }` with CORS open and an edge cache line. Tabular ops answer `format=csv` (or `Accept: text/csv`) with the provenance as `#` footer lines. Bad parameters return 400 with a message that says what a valid call looks like; well-formed ids with no upstream rows return 404.

| op | params | data | csv | cache |
| --- | --- | --- | --- | --- |
| `banks` | `bbox=w,s,e,n` (snapped to 1°, ≤ 18° span; ≤ 25 counties or 400 "zoom in") | GeoJSON points, kind `branch`, `extra: BranchExtra` (deposits joined from SOD by CERT + office number, then by FDIC office id) | yes | 6 h |
| `deposits` | `fips=SSCCC` | `CountyDeposits`: total, offices, banks, top 10 with shares, HHI; latest SOD year (this year, else the two before) | yes | 24 h |
| `bank` | `cert=<FDIC certificate>` | `BankProfile`: institution row, up to 40 quarters, `series[]` (ids `fdic:financials:<cert>:<field>`) | yes (financials) | 6 h |
| `failures` | `year=YYYY` (1934 to now; default this year) | `BankFailure[]` | yes | 24 h |
| `spending` | `bbox=` or `level=state`; optional `fy=` (2008 to current FY) | GeoJSON polygons, kind `county` or `state`, `extra: SpendingExtra` (obligations by family, FY-to-date, QCEW jobs, per-job); > 400 counties falls back to states and says so | yes | 12 h |
| `spending-detail` | `fips=SSCCC`; optional `fy=` | `SpendingDetail`: top recipients, awarding agencies, NAICS (contracts), six-year trace | yes | 12 h |
| `section` | `fips=SSCCC`; optional `fy=` | the finance section of the market report (`financeSection`) | no | 12 h |

Meta fields worth reading: `sodYear` and `counties` on `banks`; `fy`, `level`, `qcewPeriod`, `ytdThrough`, `failed` on `spending`.

### Examples

```bash
# Offices around downtown Austin with SOD deposits
curl "https://eye.jcamd.com/api/finance?op=banks&bbox=-98,30,-97.5,30.5"
curl "https://eye.jcamd.com/api/finance?op=banks&bbox=-98,30,-97.5,30.5&format=csv" -o austin-banks.csv

# Travis County's deposit market and its HHI
curl "https://eye.jcamd.com/api/finance?op=deposits&fips=48453"

# One institution's quarterly ROA, ROE, noncurrent loans (cert 3511 = Wells Fargo Bank, N.A.)
curl "https://eye.jcamd.com/api/finance?op=bank&cert=3511"

# Failures in 2023
curl "https://eye.jcamd.com/api/finance?op=failures&year=2023&format=csv"

# Counties in central Texas with FY2025 obligations and per-job figures; every state
curl "https://eye.jcamd.com/api/finance?op=spending&bbox=-99,29,-96,31.5"
curl "https://eye.jcamd.com/api/finance?op=spending&level=state&fy=2024"

# Who received Travis County's federal dollars
curl "https://eye.jcamd.com/api/finance?op=spending-detail&fips=48453"

# The finance section of the market report
curl "https://eye.jcamd.com/api/finance?op=section&fips=48453"
```

```python
import pandas as pd
df = pd.read_csv("https://eye.jcamd.com/api/finance?op=spending&level=state&format=csv", comment="#")
df.sort_values("per_job", ascending=False)[["name", "obligations", "emp", "per_job"]].head()
```

## Layers

- `lib/layers/banks.ts`: view-dependent, fetches below 300 km in a box of at most 120 km radius around the camera target. Above that height the layer is empty with a note. If the route answers "zoom in" the layer shows that note instead of an error.
- `lib/layers/spending.ts`: view-dependent, counties below 2,500 km (same threshold as the economy layers), states above; the state response is loaded once per 12 h.
- `lib/globe/financeStyles.ts`: `bankStyle` points sized and coloured by deposits (grey when the SOD has no row); `spendingStyle` polygons filled from `PER_JOB_STOPS` in `lib/finance/features.ts`.
- `components/hud/FinanceAsides.tsx`: `FinanceAside({ feature })` dispatches to `BankAside` (profile, ROA / noncurrent / deposits traces, county deposit market with HHI) and `SpendingAside` (families, per-job with formula, recipients, agencies, NAICS, six-year trace). Each has a copy-citations button.

## Caveats

- SOD is annual as of June 30; the current year is usually not out until October. The route tries this year, then the two before, and says which one it used.
- FDIC's `/locations` page cap is 10,000 rows per request; the route asks for at most 25 counties per call and flags a full page in `caveats`.
- An office FDIC lists without coordinates is dropped (there is nothing to place); one the SOD does not match shows "not in the Summary of Deposits", never zero.
- USAspending county shape codes are five-digit FIPS; state shape codes are USPS letters, mapped to FIPS through TIGERweb. A family whose request fails is `null` in `byGroup`, not zero, and is left out of `total`.
- Per-job figures are missing where BLS withholds a county's employment (disclosure code N) and for the current, incomplete fiscal year unless `fy=` asks for it (the response then says the year is still open).
- `spending_by_category/naics` is asked for contracts only; grants have no NAICS.
- Nothing here is lending, investment or relocation advice.

## Extending

- A new award family: add a key to `AWARD_GROUPS` (`lib/finance/types.ts`); the fold, the details, the CSV column and the aside table follow.
- A new FDIC field: add it to the `*_FIELDS` string and the parser in `lib/finance/fdic.ts`; the Series builder reads `SERIES_FIELDS`.
- A new op: write `opX()` returning `OpResult` in `app/api/finance/route.ts`, add a `case`, and list it in this file.
