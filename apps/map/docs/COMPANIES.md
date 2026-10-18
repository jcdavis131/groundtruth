# Public companies layer

Listed companies from SEC EDGAR, placed at the business address they register with the Commission, with their filings and XBRL financial facts, a sector bridge to counties and to sector ETFs, and a county-to-companies lookup for the market report.

## Sources (all keyless, public domain)

| What | Where | Cadence / cache |
| --- | --- | --- |
| Universe: CIK, name, ticker, exchange | `https://www.sec.gov/files/company_tickers_exchange.json` (fallback `company_tickers.json`) | daily file; cached 24 h |
| Profile, SIC, business address, recent filings | `https://data.sec.gov/submissions/CIK##########.json` | cached 12 h per company; a CIK that is neither bundled nor listed is first vetted with one uncached read whose yes/no verdict (no name, no address) is cached 12 h |
| Every XBRL fact a filer tagged | `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | cached 12 h per company |
| One concept, one period, every filer | `https://data.sec.gov/api/xbrl/frames/us-gaap/<Concept>/USD/CY2024.json` (instants: `CY2024Q4I`) | cached 24 h; used by the build script |
| Filing documents | `https://www.sec.gov/Archives/edgar/data/<cik>/<accession-no-dashes>/<primaryDocument>` | linked, never fetched |
| ZIP to county | Census 2020 ZCTA-to-county relationship file (`tab20_zcta520_county20_natl.txt`, pipe-delimited; largest `AREALAND_PART` wins) | cached 7 days |
| ZIP to point | TIGERweb Generalized ACS2023 ZCTA layer, `CENTLAT`/`CENTLON` attributes | cached 30 days |
| County jobs mix | BLS QCEW via `lib/economy/sources.ts qcewSectors()` | cached 12 h |

Response shapes for the EDGAR endpoints follow https://www.sec.gov/search-filings/edgar-application-programming-interfaces and could not be verified from the build sandbox (no egress); the parsers are tested on fixtures shaped from that documentation.

## Fair-access policy

The SEC asks automated clients to send a descriptive `User-Agent` with a contact address and to stay at or under ten requests a second. `lib/companies/edgar.ts` sends `embedding-atlas/0.1 contact: <address>` (`SEC_USER_AGENT`) in the header only (it never appears in a response body) and routes every call through `polite("sec", 120, 60_000, ...)`: at most one request every 120 ms (about 8/s), and a 60 s cool-down after any 429. The build script uses the same limits and additionally retries 429/5xx with back-off. Set `CONTACT=you@example.com` when running the script under your own name.

## The bundle and how to refresh it

Six thousand submissions fetches cannot happen at request time, so the layer draws from a snapshot committed at `lib/companies/data/companies.json`:

```
node scripts/companies-data.mjs                 # full build, ~15 minutes at 8 req/s; resumes a partial file
node scripts/companies-data.mjs --limit 200     # smoke test
node scripts/companies-data.mjs --years 2024,2023
node scripts/companies-data.mjs --fresh         # ignore companies.partial.json
```

Per company the bundle carries `cik, name, ticker, exchange, sic, sicDescription, state, city, zip, countyFips, lon, lat, geo, fiscalYearEnd, stateOfIncorporation, facts, pulled`. `geo` says how the point was made (`zcta-centroid` from TIGERweb, `city-centroid` in the hand-checked fixture); `countyFips`, `lon` and `lat` are null when the ZIP is missing, foreign, or not a ZCTA. `facts` holds the latest value for eight concepts (Revenues with `RevenueFromContractWithCustomerExcludingAssessedTax` / `SalesRevenueNet` fallbacks, NetIncomeLoss, OperatingIncomeLoss, Assets, StockholdersEquity, CashAndCashEquivalentsAtCarryingValue, LongTermDebt, and `dei:EntityNumberOfEmployees` which few filers tag) for the two most recent finished calendar years, read from the frames API, each with the frame period and accession it came from. The file header records `source`, `pulled`, `counts` and `frameYears`.

The committed file is a fixture of 25 well-known filers with their real CIK, ticker, SIC, business-address city/state/ZIP and county FIPS; positions are city centroids to two decimals and every financial field is `null` with `pulled: null`, so nothing is invented until the script runs. The script writes progress every 25 companies to `companies.partial.json` and resumes from it. It fails loudly if TIGERweb returns no centroid for any ZCTA, which means `ZCTA_LAYER_ID` (in the script and in `lib/companies/geo.ts`) needs to be looked up in the service directory.

## What is shown, what is not

Shown: the company's name, ticker, exchange, CIK, SIC code and description, registered business address (street, city, state, ZIP), state of incorporation, fiscal year end, county, recent 10-K / 10-Q / 8-K (and 20-F / 40-F / 6-K) filings with links to the primary document, annual XBRL facts with the period and form they came from, and four ratios computed here (net margin, operating margin, return on equity, debt to equity) labelled `ESTIMATE` with their formula.

Not shown, by design: nothing about people. No officer, director or insider names; ownership forms 3, 4 and 5 are filtered out of the filings list (`DOSSIER_FORMS` in `lib/companies/edgar.ts`); no shareholder names; no mailing addresses; no individual filers. The layer is about institutions, in line with the project's ethics guardrails.

## People linked to a company (Cam, 2026-10-01)

The paragraph above describes the dossier today, and it holds until the people roster ships. On 2026-10-01 Cam decided: "form 4 insiders should be counted as notable people construct associated with the specific business construct, etc." So the reporting owners on a company's Forms 3, 4 and 5 (officers, directors, 10% owners) are to be listed with that company, under these rules:

- They are reached from the company only, by its CIK. No search by a person's name, no person on the map or on a place page, and no list of people that is not scoped to one company.
- Identity is the owner's CIK. Names are never merged or joined.
- No reporting owner's address, signature, footnote or remarks text is read. Each row links its SEC filing instead; EDGAR's page for the filing shows the filer's address, and this app does not copy it.
- Funds and companies that file as owners are listed as institutions by filed name; trusts, estates and family vehicles by role only.
- Forms 3, 4 and 5 stay out of the filings list; their filers arrive as the roster.

Apart from the decision itself, these are proposed defaults rather than Cam's words. [docs/PEOPLE.md](PEOPLE.md) has the full list with which rule is whose, the columns read and never read, and the refresh plan.

## The sector and ETF bridge

`lib/companies/sectors.ts` maps a SIC code to its SIC division and to one of eleven GICS-style sector names, and maps a county's NAICS employment sectors (BLS QCEW) to the same names; each sector carries the SPDR sector fund (XLK, XLF, XLE, XLV, XLI, XLY, XLP, XLU, XLB, XLRE, XLC) plus, for a few industries, an industry fund (ITB/XHB homebuilders, IYT transports, KRE regional banks, XOP/OIH oil and gas, SMH semiconductors, XRT retail). `countySectorExposure()` folds a county's NAICS rows into those sectors with the location quotient carried through as an employment-weighted mean, and stamps every row with provenance `kind: "estimate"` and the method.

This is a convention, kept as one editable table, not a classification service: GICS is MSCI/S&P's taxonomy and the assignment here is our reading of SIC ranges. Listing a fund says nothing about it. None of this is investment advice.

## API

`GET /api/companies` (CORS `*`, edge-cached; every JSON response is `{ data, provenance[], generatedAt, caveats?, ...meta }`):

- `op=near&bbox=w,s,e,n` HQs in the box from the bundle, largest by revenue first, cap 2,000
- `op=county&fips=48029` HQs in a county, or a state as `48000`
- `op=search&q=nucor&limit=25` ticker / name search (exact ticker, ticker prefix, name prefix, name contains)
- `op=company&ticker=NUE` or `&cik=73309` live dossier: profile, sector, HQ, last 20 periodic/current filings, latest facts, ratios, annual fact series as `lib/series` Series (`edgar:CIK0000073309:Revenues`, provenance `seriesId` `CIK0000073309:Revenues`). A ticker resolves through SEC's live ticker list first, then the bundle; when the two disagree and the live CIK has no annual facts yet, a caveat names the bundled CIK. Only companies are served: a CIK in the bundle, on the listed universe, or an operating filer with an SIC code. Any other CIK (an individual who files ownership forms, or one SEC does not know) gets a 404 that names nothing, and nothing about it is cached.
- `op=sectors&fips=48029` the county's QCEW mix bridged to GICS sectors and ETFs
- `&format=csv` on near / county / search
