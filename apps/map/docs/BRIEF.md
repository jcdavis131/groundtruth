# The brief

A brief is the short answer to "what changed here, and how do you know". One per place, optionally per lens, assembled from the same numbers the place page prints: five detectors, a fixed order, a capped list, and a digest that exists even when nothing fired.

Two properties do all the work, and both are structural rather than promised:

- **No language model wrote any of it.** Findings are assembled as *data* — kind, severity, metric, magnitude, period, provenance — and the sentence is the last thing computed, by total switches over templates in `lib/brief/sentence.ts`. Every word a reader sees is an interpolation of one of those templates. A wording change is a diff in one file and a diff in one golden fixture.
- **The same facts render the same bytes.** `buildBrief` is pure. Given an input and two timestamps it has no freedom.

## The determinism contract

`buildBrief(input, { now, generatedAt })` performs **no** `Date.now()`, no `new Date().toISOString()`, no network, no `Math.random()`. Every timestamp it emits comes from `opts.generatedAt` or `input.retrievedAt`, and both are **required, non-defaulted arguments**. That is not fussiness: `provenance()` in `lib/provenance/types.ts` and `envelope()` in `lib/series/api.ts` both default their timestamps to the wall clock, so calling either without an explicit value makes the same facts render differently on every regeneration — which breaks the golden fixture, the byte-diff review of a wording change, and any claim of reproducibility.

`opts.now` is used for exactly one thing: deciding whether a release window has already passed. It is never read as "the current time" anywhere else.

How it is enforced, in `lib/brief/build.test.ts`:

| test | what it pins |
| --- | --- |
| idempotence | the same input and options serialise identically twice |
| golden fixture | `buildBrief(TRAVIS_INPUT, …)` byte-equals `lib/brief/golden/county-48453.json` |
| shuffle invariance | reordering **every array and every object key** in the input changes nothing — the sort is a total order with every tie broken |
| timestamp isolation | moving `generatedAt` moves `generatedAt` and nothing else |
| id stability | changing one input value changes exactly one finding id |
| suppression | a withheld QCEW cell is named, prints no move, and is never rendered as zero |
| empty place | a county that published nothing still has a brief, a digest and a status |

Regenerating the golden fixture after an intentional wording change, mirroring `UPDATE_SCREENER_DOCS=1`:

```bash
UPDATE_BRIEF_GOLDEN=1 npx vitest run lib/brief/build.test.ts
```

Then read the diff. That diff *is* the review: if a sentence moved and you did not mean it to, the fixture says so before a reader ever sees it.

Fixtures live in `lib/brief/fixtures.ts` — a frozen Travis County input, a county with suppressed QCEW cells, and an all-nulls county — so the three interesting shapes are always covered without a network.

## "Since the last release" means the previous published period

Not "since the last time this page was generated". The distinction is the whole honesty story of this feature.

There is **no per-place series anywhere in this repo**: `data/series/` holds a `.gitkeep`, no collector is county-keyed, `defaultKv()` returns null when `GEV_WATCH_KV=off`, and `fileKv` writes to a filesystem that is read-only on Vercel. So there is nothing to diff a run against. Rather than fake it, the brief compares the two periods that are genuinely both **inside the published file**:

- Zillow ZHVI and ZORI county and metro tables carry 25 month columns. `HomeValue.monthly` gives a real month-over-month delta.
- BTS border-crossing tables carry a 25-month series, so `CrossingMeasure.series` gives the same.

Both are guarded exactly the way `zillowMovers` guards them: a metric is comparable **only** when its newest two month keys ARE the file's newest two month columns. A row that fails that guard goes into `input.skipped` — and the brief *says so*, as a `gap` finding naming the field key, rather than silently omitting the comparison. A brief that hides its own holes is worse than one that has them.

Consequences worth knowing:

- A finding's `period` and `previousPeriod` are publication periods (`2026-07`, `2026-Q1`), never run timestamps.
- Two runs an hour apart over the same vintage produce the **same** findings with the **same** ids. That is the point.
- The word "crossed" is only ever used when the rule's previous-period evaluation is available and disagrees with the current one (below).

## QCEW findings are levels, never crossings, never "went from X to Y"

The newest BLS QCEW file carries **one** level, plus BLS's own published `oty_*_pct_chg` over-the-year percent change. It does not carry the year-earlier level. So:

- `detectMoves` refuses the level path for any `jobs.*` metric, whatever the caller supplied in `input.previous`.
- An employment or wage finding states BLS's published change: *"…was 0.9% higher than the same quarter a year earlier, on BLS's published over-the-year change."*
- Its arithmetic prints `+0.9 % = BLS QCEW over-the-year percent change for <period>, as published` and then, in words, `the newest QCEW file carries no year-earlier level, so no move from one level to another is printed`.
- Any brief carrying such a finding also carries `QCEW_OTY_CAVEAT` at the top level, which says the same thing once more for a reader who only sees the caveat block.
- `qcewHistory` is not on any render path. It issues 44 sequential BLS requests behind a politeness gate — a ~13 s floor on a cold cache, with fail-fast for 60 s after a 429 — so "the level a year ago" stays unavailable by design, not by accident.

A withheld cell (QCEW disclosure code `N`) is **absent, never zero**. It is named in a `gap` finding, cited as *"BLS QCEW disclosure code N: the cell does not meet BLS disclosure standards and is withheld"*, and excluded from every rollup — the metro rollup names the withheld counties in its printed arithmetic rather than summing them as zeros.

## The threshold table

`lib/brief/thresholds.ts`. This closes a real gap rather than restating one: nothing in the screener marks a county field watch or alert, and of the nineteen registered indicators ten are national, five are river gauges, exactly one is state-scoped (Texas) and none is county-keyed. So a place has no rule to inherit, and these are written down instead.

`on` says which quantity the rule tests, and therefore how the sentence phrases the period:

| `on` | tests |
| --- | --- |
| `value` | the metric as published, at its own scale |
| `yoyPct` | a metric that is itself an over-the-year percent change |
| `momPct` | a metric that is itself a month-over-month change, derived from the Zillow month columns |
| `pct` | the entity's **position among its national peers**, read off the cohort table |

That last one is how a brief is specific about a level nobody official publishes. "In the top tenth of US counties" is a claim about the data that is true or false; "expensive" is not.

**Every entry carries a non-empty citation, and the citation is printed beside the label every single time a rule fires** — on the page, in the feed entry, in `briefText`, in `/api/brief`. Where the level is ours, the citation says so in those words: `not an official level`, or `convention chosen for this dashboard, not an official level`. Printing a label without its citation would imply an official threshold that does not exist, which is the exact failure this table was written to avoid.

### County

| metric | level | rule | label | citation |
| --- | --- | --- | --- | --- |
| `home.yoyPct` | watch | `< 0` (yoy %) | typical home value below a year ago | arithmetic on Zillow ZHVI, county and metro files; not an official level |
| `home.yoyPct` | **alert** | `<= -5` (yoy %) | typical home value at least 5 percent below a year ago | arithmetic on Zillow ZHVI, county and metro files; convention chosen for this dashboard, not an official level |
| `home.yoyPct` | watch | `>= 15` (yoy %) | typical home value at least 15 percent above a year ago | arithmetic on Zillow ZHVI, county and metro files; convention chosen for this dashboard, not an official level |
| `home.momPct` | watch | `<= -1` (mom %) | typical home value at least 1 percent below the previous month | arithmetic on the Zillow ZHVI month columns; convention chosen for this dashboard, not an official level |
| `rent.yoyPct` | watch | `>= 8` (yoy %) | typical asking rent at least 8 percent above a year ago | arithmetic on Zillow ZORI; convention chosen for this dashboard, not an official level |
| `rent.momPct` | watch | `<= -1` (mom %) | typical asking rent at least 1 percent below the previous month | arithmetic on the Zillow ZORI month columns; convention chosen for this dashboard, not an official level |
| `priceToRent` | watch | `>= 90` (percentile) | price-to-rent in the top tenth of US counties | position among the counties that published both ZHVI and ZORI this month; not an official level |
| `priceToRent` | watch | `>= 25` (value) | typical home value worth 25 or more years of typical rent | typical home value / (typical rent × 12), Zillow ZHVI over ZORI, same month; convention chosen for this dashboard, not an official level |
| `jobs.yoy.emp` | watch | `< 0` (yoy %) | covered employment below the same quarter a year earlier | BLS QCEW over-the-year percent change, as published; not an official level |
| `jobs.yoy.emp` | **alert** | `<= -3` (yoy %) | covered employment at least 3 percent below the same quarter a year earlier | BLS QCEW over-the-year percent change, as published; convention chosen for this dashboard, not an official level |
| `jobs.yoy.avgWeeklyWage` | watch | `< 0` (yoy %) | average weekly wage below the same quarter a year earlier, before inflation | BLS QCEW over-the-year percent change, as published, nominal dollars; convention chosen for this dashboard, not an official level |
| `momentum` | watch | `<= -0.25` (value) | momentum index in the cooling band | the cooling band of the momentum index computed here, score at or below -0.25; convention chosen for this dashboard, not an official level |
| `yearsOfWages` | watch | `>= 10` (value) | typical home value worth 10 or more years of one average covered wage | typical home value / (average weekly wage × 52), one average covered job rather than a household; convention chosen for this dashboard, not an official level |
| `yearsOfWages` | watch | `>= 90` (percentile) | years of wages in the top tenth of US counties | position among the counties that published both a ZHVI value and a QCEW average weekly wage; not an official level |

### Metro

Six rules, all housing. There is no QCEW path for a metro: `qcewSectors` handles `SSCCC` / `SS000` / `US000` at `agglvl` 74/54/14 and the route regex rejects a C-prefixed MSA code, so the metro page ships a county rollup instead and **no rule may depend on it**.

| metric | level | rule | label | citation |
| --- | --- | --- | --- | --- |
| `home.yoyPct` | watch | `< 0` (yoy %) | typical home value below a year ago | arithmetic on Zillow ZHVI, county and metro files; not an official level |
| `home.yoyPct` | **alert** | `<= -5` (yoy %) | typical home value at least 5 percent below a year ago | arithmetic on Zillow ZHVI, county and metro files; convention chosen for this dashboard, not an official level |
| `home.momPct` | watch | `<= -1` (mom %) | typical home value at least 1 percent below the previous month | arithmetic on the Zillow ZHVI month columns; convention chosen for this dashboard, not an official level |
| `rent.yoyPct` | watch | `>= 8` (yoy %) | typical asking rent at least 8 percent above a year ago | arithmetic on Zillow ZORI; convention chosen for this dashboard, not an official level |
| `priceToRent` | watch | `>= 90` (percentile) | price-to-rent in the top tenth of US metro areas | position among the metro areas that published both ZHVI and ZORI this month; not an official level |
| `priceToRent` | watch | `>= 25` (value) | typical home value worth 25 or more years of typical rent | typical home value / (typical rent × 12), Zillow ZHVI over ZORI, same month; convention chosen for this dashboard, not an official level |

### State

Eight rules. `rent.*` and `priceToRent` are omitted **entirely**, because `app/api/screen/route.ts` passes `Promise.resolve(null)` for the state ZORI table: those fields are structurally null at state level, so a rule over them could never fire and its absence from a state brief would be unexplainable.

| metric | level | rule | label | citation |
| --- | --- | --- | --- | --- |
| `home.yoyPct` | watch | `< 0` (yoy %) | typical home value below a year ago | arithmetic on Zillow ZHVI, county and metro files; not an official level |
| `home.yoyPct` | **alert** | `<= -5` (yoy %) | typical home value at least 5 percent below a year ago | arithmetic on Zillow ZHVI, county and metro files; convention chosen for this dashboard, not an official level |
| `home.momPct` | watch | `<= -1` (mom %) | typical home value at least 1 percent below the previous month | arithmetic on the Zillow ZHVI month columns; convention chosen for this dashboard, not an official level |
| `jobs.yoy.emp` | watch | `< 0` (yoy %) | covered employment below the same quarter a year earlier | BLS QCEW over-the-year percent change, as published; not an official level |
| `jobs.yoy.emp` | **alert** | `<= -3` (yoy %) | covered employment at least 3 percent below the same quarter a year earlier | BLS QCEW over-the-year percent change, as published; convention chosen for this dashboard, not an official level |
| `jobs.yoy.avgWeeklyWage` | watch | `< 0` (yoy %) | average weekly wage below the same quarter a year earlier, before inflation | BLS QCEW over-the-year percent change, as published, nominal dollars; convention chosen for this dashboard, not an official level |
| `momentum` | watch | `<= -0.25` (value) | momentum index in the cooling band | the cooling band of the momentum index computed here, score at or below -0.25; convention chosen for this dashboard, not an official level |
| `yearsOfWages` | watch | `>= 10` (value) | typical home value worth 10 or more years of one average covered wage | typical home value / (average weekly wage × 52), one average covered job rather than a household; convention chosen for this dashboard, not an official level |

A rule whose metric is missing is **skipped**, never assumed false-safe — the same contract as `triggeredThresholds` in `lib/indicators/evaluate.ts`. An `on: "pct"` rule additionally needs a national percentile and is skipped when the cohort could not be built, which is the normal state of the world with no egress.

## There is no "crossed on 12 March"

A threshold finding may say one of exactly three things, appended to its sentence:

- *"It was on the other side of that line in the previous published period."* — the rule is re-evaluated against `input.previous` and did not fire there.
- *"It was on the same side of that line in the previous published period."* — it fired in both.
- *"The previous published period is not in this table, so this is a standing level rather than a change."* — no comparable previous period exists, which is always the case for an `on: "pct"` rule, because there is no national percentile for a period that has already been replaced.

What it never says is when the line was crossed, because nothing in this repo knows. `Evaluation.triggered` in `lib/indicators` is recomputed from the latest point on every call; there is no crossed-at timestamp, no hysteresis and no stored previous status anywhere. Persisting one would need a KV that `defaultKv()` does not return with `GEV_WATCH_KV=off` and a filesystem that is read-only on Vercel. "Is above" and "is in the top tenth" are honest; "crossed three weeks ago" would be a claim that silently degrades into a plain threshold test the first time the store is empty.

Percentiles carry their own caveat whenever one is printed (`PERCENTILE_CAVEAT`), because a 0 must not be read as "none below it": a percentile here is a min-max scaling of average rank across the entities that published the metric that period, so the smallest published value scores 0 and the largest 100. It is not the share of entities below the value, and entities that did not publish are in neither the rank nor its denominator.

## Finding ids, and what they buy a Monday poller

```
Finding.id = stableHash([kind, scopeId, metric, discriminator, period ?? "", idValue.toFixed(4)].join("|"))
Digest.id  = stableHash(["digest", scopeId, lens ?? "", coversPeriods.join(","), String(findingCount)].join("|"))
```

`scopeId` here is `BriefInput.scopeId`, which `briefInputFromFacts` fills from `PlaceScope.id` — the bare `48453` / `41700` / `TX`, not the prefixed `county:48453` form the URL grammar uses. Ids are compared within one place's feed, so the bare form is sufficient there; the prefixed form is what `/api/brief` echoes in `meta.scope`.

`stableHash` (`lib/feed/hash.ts`) is FNV-1a over UTF-16 code units, 52 bits as hex. Stable across Node and browsers; not cryptographic, and not required to be — a collision costs one merged feed entry, not a security property.

`discriminator` is what separates two findings that share a kind and a metric: the rule key for a threshold (`metric|level|op|value|on`), the cohort key for a rank, `oty` for a QCEW over-the-year move, `suppressed` / `skipped` for a gap, the release title and window for a release. `idValue` is the number the finding is about, rounded to four decimals so float noise cannot move an id.

**There is no wall-clock term in either hash.** That is the whole point:

- A reader polls `/place/48453/feed.xml` every hour. An unchanged brief regenerates **byte-identical guids**, so nothing is re-notified.
- When ZHVI publishes a new month, the findings about that month get new ids, and the reader is notified about exactly those — one new item per genuinely new finding.
- The feed entry id is `gev-brief-<scopeId>-<findingId>`, and the digest's id changes only when the periods covered or the finding count change, so a quiet place produces one durable item rather than a weekly duplicate.

This is also why `lib/watch/feed.ts` is **not** reused for place feeds, and is not modified by any of this work. Its `eventEntry` hashes `e.ruleIndex`, a *positional* index into `watchlist.rules`; synthesising a watchlist from "the rules that fired" would shift every surviving finding's guid week to week and re-notify on unchanged findings — destroying the one property a subscription needs. `lib/feed/render.ts` and `lib/feed/hash.ts` are an independent narrow implementation over a `FeedDoc`, with `lib/feed/hash.test.ts` asserting byte-identical output against the `lib/watch` originals over a fixed corpus.

## Assembly, in order

Five detectors run in a fixed order and their drafts are concatenated:

1. **releases** — the next publication of every series the brief rests on, plus a watch-level note when a window has already passed and a newer vintage should exist.
2. **thresholds** — `triggeredPlaceThresholds` at the current period and, for every non-percentile rule, at the previous one.
3. **moves** — level changes against the previous published period (`home.latest`, `rent.latest`, `priceToRent`, `yearsOfWages`, `momentum`), each with a minimum size so rounding is not news; plus QCEW's published over-the-year changes as described above.
4. **ranks** — top or bottom decile in a cohort, and a national-versus-in-state disagreement of more than 30 percentile points, which is the sentence that actually changes a decision.
5. **gaps** — `suppressed` (withheld cells) and `skipped` (not comparable this run).

Then: lens filter, total sort, dedupe by id, cap, digest.

**Lens filtering** keeps findings whose metric family matches the lens's `indicatorCategory` and screener affinity. A finding about the place as a whole — a withheld cell, a release — survives every lens: a lens narrows which numbers are shown, not which holes are admitted to. `explorer` has no panel, no `indicatorCategory` and no screener, so all three are optional and an unknown or category-less lens falls back to the unfiltered default rather than emptying the brief.

**The order is total**, every tie broken: severity (`alert` 3, `watch` 2, `note` 1) descending, then kind (`threshold` 5, `move` 4, `gap` 3, `rank` 2, `release` 1), then `|magnitude|` descending with non-finite last, then metric ascending, then the content-addressed id. Comparisons are byte comparisons, never `localeCompare`, whose result depends on the machine's ICU build. Kind is ranked *before* magnitude because magnitude is comparable within a kind and not across kinds — a percentile forty points off the median and a home value that moved one percent are both "big" on their own scale and neither is bigger than the other.

**The cap is 12** findings; the tail is counted in the digest, never dropped silently.

**The digest is always present**, even with zero findings — the same trick the watchlist digest uses — so a quiet county still produces a feed item and the page is never blank. It lists the current values with their periods and says plainly that nothing crossed a line.

**Provenance is per sentence.** Every finding carries the `Provenance[]` of the metrics behind it; a finding with no provenance is dropped rather than published unattributed. `Brief.provenance` is `dedupeProvenance` over all of them and `Brief.citations` is `citationsOf` that union. Estimate-derived findings reuse the estimate's **own** `formula[]` array (`affordability()`, `momentum()`, `hhi()`, `perJob()`) as the printed arithmetic, so the arithmetic on the page cannot drift from the number it explains.

Numbers go through `lib/brief/format.ts` — module-level `Intl` instances pinned to `en-US` and UTC — not the `fmtUsd` / `fmtNum` / `fmtPct` / `monthLabel` helpers in `lib/economy/features.ts`, which call `toLocaleString` with no explicit locale. That is simultaneously a React hydration hazard on any number rendered on both sides and a byte-reproducibility hazard across ICU builds. The existing HUD formatters are untouched.

## Five delivery surfaces, one brief

| surface | URL | notes |
| --- | --- | --- |
| brief page | `/place/[fips]/brief` (and `/metro`, `/state`) | indexable when it has findings; `index: false, follow: true` when it has none |
| lens brief page | `/place/[fips]/brief/[lens]` | always `index: false, follow: true`, with `rel=canonical` to the default brief |
| RSS / Atom | `/place/[fips]/feed.xml`, `?format=atom`, `?lens=` | `application/rss+xml` / `application/atom+xml`, generator *Embedding Atlas place briefs* |
| JSON Feed | `/place/[fips]/feed.json` | JSON Feed 1.1, `application/feed+json` |
| the API | `/api/brief?scope=county:48453` | the provenance envelope |

The feeds and the API exist side by side on purpose: RSS, Atom and JSON Feed are fixed external standards and **cannot** carry `{ ...meta, data, provenance, generatedAt, caveats? }`. A reader wants a feed; a script that needs the findings *and* their sources in one object wants the envelope.

### `/api/brief`

```
GET /api/brief?scope=county:48453
GET /api/brief?scope=48453&lens=realestate
GET /api/brief?scope=metro:41700&format=txt
GET /api/brief?scope=state:TX
```

| parameter | values |
| --- | --- |
| `scope` | `county:SSCCC`, `metro:CCCCC`, `state:XX`. A bare five-digit code is a **county** and a bare two-letter code is a **state** — the county and CBSA code spaces overlap, so metros always carry the prefix. |
| `lens` | one of the seven `PersonaId` values (`banking`, `economist`, `explorer`, `logistics`, `realestate`, `trader`, `water`); omitted means the default, unfiltered brief |
| `format` | `json` (default) or `txt` for `briefText()` as `text/plain` — the compliance artifact an analyst attaches to a memo |

Responses: `200` with the envelope, whose `data` is the whole `Brief`; `400` with a message saying what a valid call looks like for a malformed scope, an unknown lens or an unknown format; `404` for a well-formed id nothing answers to. `OPTIONS` answers the CORS preflight. `maxDuration = 60`, edge cache `s-maxage=3600, stale-while-revalidate=3600`.

`meta` carries `scope`, `lens`, `status`, `findings`, `page` (the place page path), `provisional` (true for a county the offline manifest cannot yet name), `rulesVersion` and `cacheAge`. `caveats` is the brief's own caveats followed by any the facts assembler added — the offline reasons, the water disc, the national-indicator note.

The assembled brief is cached for an hour per scope and lens, and the envelope's `generatedAt` is the **brief's own stamp**, not the moment the response was written, so two calls inside one window return identical bytes. Because `buildBrief` is pure, that identity holds whether or not the cache was warm.

`robots.txt` disallows `/api/`, so none of this is a crawl surface.

## Rules version

`BRIEF_RULES_VERSION` (`lib/brief/types.ts`) is on every brief and in `briefText`'s footer. Bump it when a detector, a threshold or a sentence template changes in a way that alters findings for unchanged data — it is how a reader with an archived brief can tell "the world moved" from "we changed the rules".

## Related

- `docs/PLACES.md` — the URL scheme, the manifest, indexability and the offline degradation table.
- `docs/WATCHLISTS.md` — the other subscription surface, over user-defined rules rather than places.
- `docs/API.md` — the provenance envelope.
- `docs/RELEASES.md` — the calendar the release findings read.
