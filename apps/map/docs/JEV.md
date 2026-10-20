# personal-world-jev, slice 1: context for agents

Cam's brief for Jev's first job: an agent building anything place-related asks Jev for cited world context before it acts. Slice 1 is one MCP tool on eye's server, `world_context`, in `lib/mcp/world.ts`.

## What it does

Give it exactly one place:

- a point: `{ "lon": -97.74, "lat": 30.27 }`
- a county or state FIPS: `{ "fips": "01097" }`, `{ "fips": "48" }` or `{ "fips": "48000" }`
- a box, at most 2 degrees a side: `{ "bbox": [-106.05, 35.6, -105.85, 35.75] }`

It answers one bundle. The cap is 40,000 bytes of UTF-8 JSON in `structuredContent`; the text content repeats that same JSON, so a client that reads both gets it twice:

- `place`: what the input resolved to (kind, name, county and state FIPS, the point used and why, the box searched for records). A county is centred on Census's internal point (INTPTLON/INTPTLAT) from eye's county table, and the point carries its own citation: `census-tigerweb` and the TIGERweb query for that GEOID.
- `topics.identity`, always: county, state, CBSA code, city, tract and ZCTA from Census TIGERweb (county-wide units only for a county FIPS; a box adds the counties whose Census TIGERweb outline touches it, the one under its centre first). A county in no CBSA says so under `missing`; when a county's point is offshore, or lands in a different county, its state and CBSA are left out with the reason rather than borrowed from a neighbour.
- `fabric`: time zone, NWS office, HUC-12 and where it drains, FEMA flood zone and NFIP community, school and congressional district, ecoregion, elevation. Points and boxes only.
- `hazards`: FEMA National Risk Index rating, expected annual loss and the hazards it rates high; the latest FEMA declarations of any date, each disaster once (FEMA files one row per designated area), including those FEMA still files under a former county code (a split code's row is placed by its own designated area: the whole former census area goes to every successor, a school district or REAA only to the one it lies in, an area no cited source places to none, listed as missing; marked `filedUnder` in the note; see FEMA_LEGACY and FEMA_SPLIT_AREAS in `lib/hazards/history.ts`). "0 declarations" appears only when the route read zero rows and reports no boundary or join gap for the county; otherwise the gap is listed. This week's Drought Monitor; Severe and Extreme NWS alerts and M4.5+ earthquakes touching the search box now, each counted and cited to its own feed (for a county FIPS the box is 0.25 degrees around its Census internal point, not the whole county). FEMA's words that are not a rating ("Insufficient Data", "Data Unavailable") are listed as missing, never shown as a value. A Connecticut planning region has no FEMA declarations, because FEMA files them under the 8 legacy counties; that is said, not shown as 0.
- `economy`: BLS QCEW jobs and weekly wage (a withheld cell is null with the reason, never 0), Zillow home value and rent, and population as FEMA's NRI row carries it.
- `vulnerability`: CDC/ATSDR SVI and FEMA's NRI social vulnerability, side by side and never merged.
- `institutions`: hospitals and dams in the search box and public companies in the county (by ticker and CIK). Companies come from eye's bundled SEC snapshot, not from every EDGAR registrant: each says the bundle it was found in, and while the bundle is the committed fixture (`pulled: null`) no count is given and the topic is partial. When the hospital or dam route says it hit its record limit, the list says so instead of claiming it is all of them.
- `water`: the EPA community water system whose service area holds the point (by PWSID; names are not copied), its UCMR 5 PFAS status and its detections in ng/L, from `/api/water?op=pfas` for the 0.02-degree cell holding the point. A failed or cut answer, or no service area holding the point, is a missing entry with its reason, never a 0 or "not detected".
- `freshness`: the next scheduled releases of the sources the bundle cites. A release whose schedule page answers 403 to automated clients (BLS, Zillow, S&P, BTS ports, checked 2026-10-18) keeps that page and says so.
- `collections`, only when you pass `about`: eye's collections ranked by meaning for what you are about to do.

Narrow it with `topics` (for example `["hazards", "economy"]`) and `max_records` (records per list, default 3, at most 10).

Every item carries `sourceId`, `publisher`, `upstreamUrl`, `retrievedAt` and `link`. `link` is the eye route that, fetched, returns the thing cited. Most items also carry `upstreamRecordUrl`: a keyless query on the publisher's own host for exactly that record (a TIGERweb GEOID, an OpenFEMA disaster number, the BLS QCEW area CSV, the CMS row for a CCN, the NID row for a dam, EPA's rows for a PWSID). Where there is none, the item's note says "no record-level URL" and why. Cite `upstreamRecordUrl` (or `upstreamUrl`) for the fact and use `link` to reproduce it. Items about eye's own catalogue are `kind: "about-eye"`: claims about what eye holds, with no outside publisher to confirm them. An item whose route sent no provenance is not shown; it is listed under `missing` instead.

The invariant, tested in `lib/mcp/world.test.ts` over route replies recorded from the live site (`lib/mcp/__fixtures__/world/`, written by `node scripts/world-record.mjs <name> <input>`, or `--fill` to add only the routes a fixture lacks): every item's `sourceId` is the source its fact is about (a table in the test, kept apart from `world.ts`), its `publisher` and `upstreamUrl` come from that source's own provenance entry on the route its `link` names, and that route does not list the source in its `missing` or `failed`; a 0 appears only where the route itself says the answer is complete (`declarationRows` 0 with no boundary or join gap, `truncated: false`, a full SEC pull, a live list with nothing failed or unmapped). Every `upstreamRecordUrl` is on its source's own host (a table in the test) and contains the record's id; an item without one says so; `about-eye` is exactly the catalogue's items. A mutation case drops each cited source from its route in turn (provenance removed, named missing) and requires a missing entry in place of the value, and the fixtures between them cite every source in the table. When the reply is over the byte cap, rows of lists (declarations, records, events, companies) are cut before summaries such as the drought reading or a live count. A missing source never becomes a value or borrows another source's citation. Whatever is absent is listed in `topics[t].missing` as `{ what, code, reason, action }` (the codes and actions are in [MCP.md](MCP.md), Coverage status and absence codes), and `coverageStatus: { status: "partial", basis: [{ code, text }] }` names every gap, every list cut by `max_records` and any cut to fit the byte cap. A route that fails or takes longer than 25 s costs only its own items. The call is an error (the typed envelope in [MCP.md](MCP.md)) only when the input is bad, the FIPS is unknown, or nothing answered at all. When every route answered 401 or 403 it is an auth refusal (HTTP 403, `refusal: "auth"`, not retryable), not an upstream failure.

It composes eye's own routes (`/api/fabric`, `/api/screen`, `/api/hazards`, `/api/live`, `/api/civic`, `/api/infra`, `/api/companies`, `/api/water`, `/api/releases`, `/api/catalog`) on the server and calls no upstream of its own.

Privacy follows eye's cards. Places are named. Hospitals and dams are named only when the route's own record text carries the name, which it does only for hospitals and for dams with a non-private owner; anything else is labelled by its id. Companies are labelled by ticker and CIK. No address, phone, website, owner, representative or free text (such as Wikipedia extracts) is copied.

## How an agent uses it

Add eye's MCP server to Claude Code over HTTP. A suggestion for Cam to run; nothing here runs it:

```
claude mcp add --transport http eye https://www.arxiviq.com/api/mcp
```

Then, before acting on a place, call `world_context` and paste the bundle into the plan, citing items by their `link`. When `coverageStatus` is partial, read `missing` before relying on an absence, and act on `missing[].action`: `abstain` means say it is absent here, `retry` means call again, `narrow` means change the request (a county FIPS or a point, a smaller box, fewer topics), `redirect` means the value is filed under another code. The reply says `schemaVersion: "world/2"` and validates against the `outputSchema` in `tools/list`.

## What it does not do yet

- No search over records by meaning. It returns hospitals, dams and companies in a box, not "dams near X built before 1950"; a `records_search` over snapshots is a later slice.
- No name lookup. "Mobile, Alabama" has to arrive as a point or a FIPS.
- No memory. It does not know Cam's preferences or earlier answers; every call starts fresh.
- No daily weather, IPEDS colleges, rail or airports, or which CBSA delineation a past year used.
- A county FIPS is read at the point `/api/screen` publishes for it; the fabric topic asks for a point.
