# personal-world-jev, slice 1: context for agents

Cam's brief for Jev's first job: an agent building anything place-related asks Jev for cited world context before it acts. Slice 1 is one MCP tool on eye's server, `world_context`, in `lib/mcp/world.ts`.

## What it does

Give it exactly one place:

- a point: `{ "lon": -97.74, "lat": 30.27 }`
- a county or state FIPS: `{ "fips": "01097" }`, `{ "fips": "48" }` or `{ "fips": "48000" }`
- a box, at most 2 degrees a side: `{ "bbox": [-106.05, 35.6, -105.85, 35.75] }`

It answers one bundle. The cap is 24,000 bytes of UTF-8 JSON in `structuredContent`; the text content repeats that same JSON, so a client that reads both gets it twice:

- `place`: what the input resolved to (kind, name, county and state FIPS, the point used and why, the box searched for records).
- `topics.identity`, always: county, state, CBSA code, city, tract and ZCTA from Census TIGERweb (county-wide units only for a county FIPS; a box adds the counties FEMA's index returns for it). A county in no CBSA says so under `missing`; when a county's point is offshore, or lands in a different county, its state and CBSA are left out with the reason rather than borrowed from a neighbour.
- `fabric`: time zone, NWS office, HUC-12 and where it drains, FEMA flood zone and NFIP community, school and congressional district, ecoregion, elevation. Points and boxes only.
- `hazards`: FEMA National Risk Index rating, expected annual loss and the hazards it rates high; the newest FEMA declarations; this week's Drought Monitor; Severe and Extreme NWS alerts touching the place now.
- `economy`: BLS QCEW jobs and weekly wage (a withheld cell is null with the reason, never 0), Zillow home value and rent, and population as FEMA's NRI row carries it.
- `vulnerability`: CDC/ATSDR SVI and FEMA's NRI social vulnerability, side by side and never merged.
- `institutions`: hospitals and dams in the search box and public companies in the county (by ticker and CIK). Companies come from eye's bundled SEC snapshot, not from every EDGAR registrant: each says the bundle it was found in, and while the bundle is the committed fixture (`pulled: null`) no count is given and the topic is partial. When the hospital or dam route says it hit its record limit, the list says so instead of claiming it is all of them.
- `freshness`: the next scheduled releases of the sources the bundle cites.
- `collections`, only when you pass `about`: eye's collections ranked by meaning for what you are about to do.

Narrow it with `topics` (for example `["hazards", "economy"]`) and `max_records` (records per list, default 3, at most 10).

Every item carries `sourceId`, `publisher`, `upstreamUrl`, `retrievedAt` and `link`. `link` is the eye route that, fetched, returns the thing cited. An item whose route sent no provenance is not shown; it is listed under `missing` instead. Whatever is absent is listed in `topics[t].missing` with its reason, and `coverageStatus: { status: "partial", basis }` names every gap, every list cut by `max_records` and any cut to fit the byte cap. A route that fails or takes longer than 25 s costs only its own items. The call is an error (the typed envelope in [MCP.md](MCP.md)) only when the input is bad, the FIPS is unknown, or nothing answered at all. When every route answered 401 or 403 it is an auth refusal (HTTP 403, `refusal: "auth"`, not retryable), not an upstream failure.

It composes eye's own routes (`/api/fabric`, `/api/screen`, `/api/hazards`, `/api/live`, `/api/civic`, `/api/infra`, `/api/companies`, `/api/releases`, `/api/catalog`) on the server and calls no upstream of its own.

Privacy follows eye's cards. Places are named. Hospitals and dams are named only when the route's own record text carries the name, which it does only for hospitals and for dams with a non-private owner; anything else is labelled by its id. Companies are labelled by ticker and CIK. No address, phone, website, owner, representative or free text (such as Wikipedia extracts) is copied.

## How an agent uses it

Add eye's MCP server to Claude Code over HTTP. A suggestion for Cam to run; nothing here runs it:

```
claude mcp add --transport http eye https://www.arxiviq.com/api/mcp
```

Then, before acting on a place, call `world_context` and paste the bundle into the plan, citing items by their `link`. When `coverageStatus` is partial, read `missing` before relying on an absence.

## What it does not do yet

- No search over records by meaning. It returns hospitals, dams and companies in a box, not "dams near X built before 1950"; a `records_search` over snapshots is a later slice.
- No name lookup. "Mobile, Alabama" has to arrive as a point or a FIPS.
- No memory. It does not know Cam's preferences or earlier answers; every call starts fresh.
- No daily weather, IPEDS colleges, rail or airports, or which CBSA delineation a past year used.
- A county FIPS is read at the point `/api/screen` publishes for it; the fabric topic asks for a point.
