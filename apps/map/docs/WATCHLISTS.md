# Watchlists, alerts, feeds and webhooks

A watchlist is a short list of things on the globe (counties, states, ports,
border crossings, USGS gauges, stored series, computed indicators, companies)
plus rules ("home values in Travis County up 3 % or more year over year",
"Medina River stage crosses above 8 ft"). The list lives in your browser.
The server evaluates it on request and answers as RSS, Atom, JSON Feed or
plain JSON, or POSTs a signed payload to a webhook you name.

There is no account and no database. The list travels inside the feed URL as
a compact token, so any feed reader can poll it and the server keeps nothing
(unless the operator turns a small key/value store on; see "Persistence").

## The model

```jsonc
{
  "id": "austin-housing",          // 3-64 chars, [a-z0-9-], starts with a letter or digit
  "title": "Austin housing",       // 1-120 chars
  "items": [                       // at most 50
    { "kind": "county",   "id": "48453", "name": "Travis County, TX", "geo": [-97.78, 30.33] },
    { "kind": "state",    "id": "48" },
    { "kind": "port",     "id": "12345" },                 // World Port Index id
    { "kind": "crossing", "id": "2304" },                  // BTS port code
    { "kind": "gauge",    "id": "USGS-08180800" },         // USGS monitoring location
    { "kind": "series",   "id": "snapshot:port-vessels:USLAX" },
    { "kind": "indicator","id": "mississippi-memphis-stage" },
    { "kind": "company",  "id": "cik:0000320193" }         // resolver registered by lib/companies
  ],
  "rules": [                       // at most 100
    { "itemRef": 0,   "metric": "home.yoyPct", "op": ">=", "value": 3 },
    { "itemRef": "*", "metric": "stage",       "op": "crosses_above", "value": 8, "window": "1d" },
    { "metric": "value", "op": "changes_by_pct", "value": -10, "window": "7d" }   // itemRef omitted = "*"
  ],
  "createdAt": "2026-09-01T00:00:00Z",
  "version": 4                     // bumped on every edit
}
```

`itemRef` is an index into `items` or `"*"` (every item that publishes the
metric). Operators:

| op | fires when |
| --- | --- |
| `<` `>` `<=` `>=` | the current value compares so against `value` |
| `crosses_above` | the previous value was below `value` and the current one is at or above it |
| `crosses_below` | the previous value was above `value` and the current one is at or below it |
| `changes_by_pct` | the change from the reference is at least `value` % (positive = rose by, negative = fell by; 0 is rejected) |

"Previous" is the resolver's own look-back when it has one (series and
indicators know their own history; `window` picks 1d / 7d / 30d, default 7d),
otherwise the value the last evaluation stored. With neither, `crosses_*`
degrade to plain threshold checks and `changes_by_pct` is skipped; the
response's `caveats` say so every time.

Validation is in `lib/watch/model.ts` (`validateWatchlist`); every error names
the field, e.g. `rules[1].op: one of <, >, <=, >=, crosses_above, ...`.

### Metrics per kind

`GET /api/watch?op=metrics` returns the table below as JSON. Resolvers may
publish more (a crossing publishes `<measure>.latest` / `<measure>.yoyPct` for
every BTS measure it has; a gauge also publishes `p00065`-style raw codes).

| kind | metrics | source |
| --- | --- | --- |
| county | `home.latest` `home.yoyPct` `home.y5Pct` `rent.latest` `rent.yoyPct` `rent.y5Pct` `priceToRent` (estimate) `jobs.emp` `jobs.estabs` `jobs.wages` `jobs.avgWeeklyWage` `jobs.yoy.emp` `jobs.yoy.estabs` `jobs.yoy.wages` `jobs.yoy.avgWeeklyWage` | Zillow ZHVI / ZORI, BLS QCEW |
| state | same minus rent | Zillow ZHVI (state file), BLS QCEW |
| port | `container.total` `.pctChange` `.ranking` `.imports` `.exports`, same for `tonnage.*` and `dryBulk.*` | BTS Port Performance; position from the World Port Index |
| crossing | `trucks.latest` `trucks.yoyPct` `personalVehicles.*` `pedestrians.*` `trains.*` `buses.*` `personalVehiclePassengers.*` ... | BTS Border Crossing Entry Data |
| gauge | `stage` `flow` `temp` `do` `conductance` `ph` `turbidity` `elevation` `storage` + raw `p<code>` | USGS latest-continuous |
| series | `value` `previous` `change` `changePct` | the series store (`data/series`) |
| indicator | same, for the `indicator:<id>` series | the indicator cron |
| company | none until `registerResolver("company", fn)` is called | lib/companies |

Suppressed or unpublished cells are `null`, never guessed.

## The token

```
token = base64url( deflate-raw( JSON( compact form ) ) )
```

The compact form swaps keys for short arrays: `{ v: 1, id, t: title,
i: [[kind, id, name?, [lon, lat]?]], r: [[itemRef, metric, op, value,
window?]], c: createdAt, n: version }`. A 20-item list is a few hundred
characters. Limits: the token is at most 8 KB; it may inflate to at most 64 KB
(so a crafted token cannot exhaust the server). The browser encodes with
`CompressionStream("deflate-raw")`, the server with Node's `zlib.deflateRawSync`;
the bytes are identical, so either side reads the other's tokens.

Mint one from a script:

```sh
curl -s -X POST https://<host>/api/watch \
  -H 'content-type: application/json' \
  -d '{"watchlist": {"id":"demo","title":"Demo","items":[{"kind":"county","id":"48453"}],"rules":[{"itemRef":0,"metric":"home.yoyPct","op":">=","value":3}]}}'
# -> { data: { id, token, stored, urls: { rss, atom, json, jsonfeed }, shortUrls }, caveats }
```

## Feed URLs

```
GET /api/watch?t=<token>&format=rss        RSS 2.0        application/rss+xml
GET /api/watch?t=<token>&format=atom       Atom 1.0       application/atom+xml
GET /api/watch?t=<token>&format=jsonfeed   JSON Feed 1.1  application/feed+json
GET /api/watch?t=<token>&format=json       the evaluation: items, metrics, events, provenance
GET /api/watch?id=<id>&format=...          same, for a list the server stored (see Persistence)
```

Each fired rule is one entry whose id is a hash of item + rule + value +
period, so a reader polling hourly sees an alert once. A "Digest" entry lists
every current value, so the feed is never empty; its id changes only when a
value or period changes. Entry links are globe permalinks
(`/?lat=&lon=&h=&layers=&sel=`), the same shape the Share button writes.

Evaluation is cached five minutes per token. CORS is open; the JSON answer is
the usual envelope (`data`, `provenance`, `generatedAt`, `caveats`).

### Privacy

The token *is* your list. Anyone holding the URL can read the list, see the
evaluation and, if they can reach a server with the store on, publish it.
Treat feed URLs like passwords: paste them into a reader you trust, not into
chat. Nothing else is in the token (no webhook URL, no secrets, no account).

## Webhooks

```
POST /api/watch?op=test-webhook      { url, secret }              signed sample payload
POST /api/watch?op=dispatch          { token | id, url, secret, always? }   evaluate, deliver events
     header: x-gev-cron-secret: <GEV_CRON_SECRET>
```

Both ops answer 404 unless the operator set `GEV_CRON_SECRET`, and 401 when
the header does not match, so a public deployment cannot be used to spray
requests at third parties. Point a cron at `op=dispatch` (every hour is
plenty; sources update daily to quarterly) and it delivers whatever fired.
`always: true` delivers an empty `events` array too, as a heartbeat.

Delivery rules: https only; hosts that are loopback, RFC 1918, link-local,
CGNAT, multicast, `.local` / `.internal` / `localhost`, cloud metadata
addresses, IPv4-mapped or NAT64 IPv6 forms of those, or bare single-label
names are refused (DNS is not resolved, so a public name that later resolves
to a private address is out of scope). 10 s timeout. One retry after a network
error or a 5xx; none after a 4xx. One redirect is followed, and only to
another https URL that passes the same check.

Payload:

```json
{
  "type": "gev.watch.events",
  "watchlistId": "austin-housing",
  "title": "Austin housing",
  "generatedAt": "2026-09-10T12:00:00.000Z",
  "sample": false,
  "events": [
    {
      "itemRef": 0, "ruleIndex": 0,
      "rule": { "itemRef": 0, "metric": "home.yoyPct", "op": ">=", "value": 3 },
      "kind": "county", "itemId": "48453", "name": "Travis County, TX",
      "metric": "home.yoyPct", "value": 3.4, "previous": 2.9, "basis": "state",
      "firedAt": "2026-09-10T12:00:00.000Z", "asOf": "2026-07-31",
      "message": "Travis County, TX: home.yoyPct 3.40 at or above 3.00 (was 2.90)",
      "link": "https://<host>/?lat=30.3300&lon=-97.7800&h=150000&layers=realestate,commerce&sel=realestate:county:48453"
    }
  ]
}
```

Headers: `X-GEV-Signature: sha256=<hex HMAC-SHA256 of the raw body with your
secret>`, `X-GEV-Timestamp: <ISO time the body was signed>`,
`X-GEV-Watchlist: <id>`.

### Verify the signature

Node (Express-style; read the raw body, not a re-serialised object):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, secret, header) {
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
  const got = Buffer.from((header ?? "").trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

app.post("/hook", express.raw({ type: "application/json" }), (req, res) => {
  if (!verify(req.body, process.env.GEV_WEBHOOK_SECRET, req.get("x-gev-signature"))) return res.sendStatus(401);
  const payload = JSON.parse(req.body);
  // Optional replay guard: reject if Date.now() - Date.parse(payload.generatedAt) > 10 min.
  res.sendStatus(204);
});
```

Python:

```python
import hmac, hashlib

def verify(raw_body: bytes, secret: str, header: str | None) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, (header or "").strip())
```

## Persistence (optional)

The route works with no storage at all. When a key/value store is available
(`lib/watch/kv.ts`: memory or one JSON file per key under `data/watch/`),
`POST /api/watch` also stores the token under `watch:<id>` so `?id=<id>` works
as a short URL, and every evaluation stores the last value per item and
metric under `watchstate:<id>:<token hash>` (30-day TTL) so `crosses_*` and
`changes_by_pct` compare against what the previous run saw. State is keyed by
the token hash too: editing the list starts fresh, and a stranger's token
cannot pollute a published list's state.

The store is the same shape as `lib/series/store.ts`, for strings instead of
numbers: `get / set(ttl) / delete / list(prefix)`. A remote adapter (Cloudflare
KV, Vercel KV, Postgres) implements those four methods and is returned from
`defaultKv()` behind an env variable.

## Environment

| variable | effect |
| --- | --- |
| `GEV_CRON_SECRET` | enables `op=test-webhook` and `op=dispatch`; the header must match. Unset = 404. |
| `GEV_WATCH_KV` | `file` (default), `memory`, or `off` (stateless: no short ids, no crossing state). |
| `GEV_WATCH_DIR` | directory for the file store; default `data/watch`. Writes to a read-only file system are reported in `caveats`, never fatal. |
| `GEV_PUBLIC_ORIGIN` | origin used in permalinks and feed URLs when the request origin is not the public one (behind a proxy). |

No upstream key is needed for any resolver.

## Limits

- 50 items, 100 rules, 120-character names and titles, 64-character ids and metrics.
- Token: 8 KB encoded, 64 KB inflated. Request bodies: 64 KB.
- Evaluation cached 5 minutes per token; the panel refreshes every 10 minutes.
- Resolvers run four at a time and reuse the app's cached upstream tables
  (Zillow and QCEW are read once per process and shared with the layers).
- Webhook: 10 s timeout, at most two attempts, at most one redirect.

## In the cockpit

The Watchlist panel (`components/hud/WatchlistPanel.tsx`) keeps lists in
`localStorage` (`gev:watchlists`). Select a county, port, crossing or gauge on
the globe and press "add selected"; add rules from the metric list for that
kind; copy the RSS / Atom / JSON URLs; paste a webhook URL and "send test"
(needs the signing secret you chose and the server's `GEV_CRON_SECRET`, both
kept in memory only); import and export lists as JSON. Clicking an item flies
the camera to it.
