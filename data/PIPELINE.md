# The snapshot pipeline

`data/pipeline/` builds whole-state snapshots of eye's collections from eye's public API, writes them as GeoParquet in the data root, and commits each manifest here under `data/manifests/`. The record and manifest formats are in [SCHEMA.md](SCHEMA.md).

Built so far, for `nid-dams`, `nces-public-schools` and `nrhp-listed`: Texas (state FIPS 48) and Alabama (01), on 2026-10-19 (no county for dams and NRHP listings) and again on 2026-10-20 (with the county join, and `joins` in each manifest). Those three collections are the ones the conformance count found canonical on the wire with stable ids. A region is one entry in `cards.REGIONS` (its FIPS, USPS code, name and eye outline id), chosen with `--region`.

## Setup

One small Python project, `data/pyproject.toml`, with one pinned dependency: `duckdb==1.4.4`. DuckDB's spatial extension isn't on pip. The code loads it at runtime with `INSTALL spatial`, from DuckDB's own extension repository, which needs no key.

```
python -m venv data/.venv                       # gitignored
data/.venv/Scripts/python -m pip install duckdb==1.4.4      (Windows; data/.venv/bin/python elsewhere)
```

Node 22 or later must be on the PATH: records and manifests are checked by `data/schema/validate.mjs`, the spec's own validator.

## The data root

Nothing the pipeline fetches or writes goes in git, except the manifests. Everything else lives under one directory, the data root:

- `--data-root DIR`, or
- the `GROUNDTRUTH_DATA_ROOT` environment variable, or
- `<home>/datastore/groundtruth-snapshots`, the default.

The docs write it as `<data-root>`. `data/snapshots/` is gitignored too, for anyone who points the root inside the checkout.

```
<data-root>/raw/<sha256 of url>.body           each response body, as received (200s only)
<data-root>/raw/<sha256 of url>.json           {url, status, retrievedAt, bytes, sha256}
<data-root>/work/<snapshot-id>.jsonl           the records as validated, before Parquet
<data-root>/work/<snapshot-id>.summary.json    run counts, and the ids the region rule left out
<data-root>/snapshots/<snapshot-id>/records.parquet
<data-root>/snapshots/<snapshot-id>/manifest.json    the same bytes as data/manifests/<collection>/<snapshot-id>.json
```

The raw cache makes a rerun after a failure cheap. A cached body is checked against its sha256 before use. It also keeps its original `retrievedAt`, so a manifest built from the cache still says when each body was fetched.

## Build

```
data/.venv/Scripts/python data/pipeline/build.py nid-dams nces-public-schools nrhp-listed [--region texas|alabama] [--data-root DIR]
```

`--offline` builds from the raw cache only: a request that isn't cached stops the build instead of going to the network.

The builder refuses to run when `data/pipeline`, `data/schema` or `data/pyproject.toml` have uncommitted changes, because each manifest names the commit it was built from (`builder.gitSha`).

For each collection:

1. **Outline.** The builder reads the state's outline from eye: the region's `boundaryId` (`state:<FIPS>`, e.g. `state:48`) of `/api/economy?op=areas&level=state`, which is Census TIGERweb's state layer generalised to 1:20M. This is the manifest's `region` request.
2. **Tiles.** eye clamps each box to a route-specific size and snaps it to a grid. The builder asks for boxes of exactly that size, on that grid, so eye answers each box as asked. If the echoed `bbox` differs, the build stops.
   - **Box sizes, from eye's code at `ed1a907`:**

     | collection | route | box | grid | eye's cap |
     |---|---|---|---|---|
     | `nid-dams` | `infra?op=dams` | 1.5° | 0.25° | NID's record limit |
     | `nces-public-schools` | `civic?op=schools` | 0.2° | 0.05° | 4,000 schools |
     | `nrhp-listed` | `land?op=historic` | 0.12° | 0.02° | 2,000 listings |

   - **Which tiles:** only those that touch the outline, widened by 0.05°.
   - **Truncated answers:** a tile eye answers as `truncated` is split in four, down to a single grid cell. A single cell that is still truncated stops the build.
   - **Pace:** one request a second at most, start to start, over IPv4.
3. **Region rule.** Features are deduplicated by id, and the first tile to hold one wins. A feature is kept when two things agree:
   - The source's own state field puts it in the region's state. That's the first two digits of NCES's county code (`CNTY`, e.g. the `(48453)` in `details.county`), NID's `STATE` or NPS's `State`.
   - Its point lies inside eye's outline, or within 0.05° of it.

   The tolerance is there because the 1:20M outline cuts corners on coasts and river borders (in Texas, the Gulf coast and the Red River, the Rio Grande and the Sabine; in Alabama, the Gulf coast and the Chattahoochee). Between neighbouring states, the source field decides. The rule is written into the manifest's `region.definition`, with the outline response's sha256.
4. **Records.** Each kept feature is mapped to `record/1` exactly as `build-fixtures.mjs` does it (SCHEMA.md, "From eye's LayerFeature").
   - NRHP property names are withheld, and each record is labelled by its NRIS number.
   - A dam's `nameRule` is set per record from its owner types, as eye's `PUBLIC_NAME_RULE` does (`cards.dam_name_rule`). It's `public-name` only when the owner type is Federal, State, Local Government, Public Utility or Tribal Government, and so is every entry of `owner types`. Anything else is `label-by-id`: Private anywhere, Not Listed, missing, empty or any other value.
     - **Answers without `owner types`.** eye's answers from before it requested `OWNER_TYPES` don't carry it, so only the primary type decides.
     - **eye named it, the rule says label by id.** The builder names the record `Dam <NIDID>` and drops the `name: <name>` segment from its text. The count goes into the manifest's `withheldFields` reason.
     - **eye labelled it by id.** The record is `label-by-id` whatever the owner type says.
     - NID's `published name` detail is withheld on every dam.
   - `place` comes from the source field:
     - schools: `source-field`, with the county code
     - dams and historic places: `name-lookup` for the state. Their county is written in step 5.
5. **County join.** `join.py` writes `place.countyFips` for every record whose config gives none (dams, NRHP listings), as in "Joins" in [SCHEMA.md](SCHEMA.md):
   - **Boundary:** `boundaries.py` downloads TIGER/Line 2025 COUNTY (`tl_2025_us_county.zip`, about 84 MB) once into `<data-root>/raw/boundaries/` with a sidecar `{url, retrievedAt, bytes, sha256}`, and refuses the file when its hash differs from the sidecar. It is the only download the join makes, and DuckDB's `ST_Read` reads the shapefile out of the zip. Run the build under `admit.sh` on a RAM-poor box: loading the polygons takes about 1 GB.
   - **Point in polygon:** DuckDB `ST_Contains` against the counties of the record's state, with a bounding-box pass first. Exactly one hit places the record (`point-in-polygon`); the publisher's county string, joined by name, is the cross-check.
   - **Abstain, with a reason:** no polygon contains the point, and the name rule can't place it either: the record has no `countyFips`, and `joins[].unplaced` says why.
   - **Written to the manifest:** `joins` (boundary product, vintage, URL and sha256; methods; cross-check counts; placed and unplaced; disagreements) and `publisherCount.gapItems` / `duplicateRows`, so `validate.mjs` can check the arithmetic: `placed + unplaced = recordCount` and `publisherCount.value = recordCount + gapItems + duplicate rows`.
   - **Second run:** `join.py` over the same raw cache writes the same `records.parquet` bytes (`test_join.py` checks it on real county polygons).
6. **Validation.** Every record goes through `node data/schema/validate.mjs record`. Any failure stops the build, and nothing is written past this point.
7. **Files.** The builder writes `records.parquet`, then asks the publisher for its own count:
   - **Count:** an ArcGIS `returnCountOnly=true` query on the publisher's layer, keyless: `LSTATE='<USPS>'` for NCES, `STATE='<state name>'` for NID and `State='<STATE NAME>'` for NPS (for Texas: `LSTATE='TX'`, `STATE='Texas'`, `State='TEXAS'`).
   - **Ids:** it pages the publisher's ids, so the manifest's `publisherCount.gap` can name every row that isn't a record, and why.
   - **Manifest:** written, validated with its files, copied to `data/manifests/`, and read back through `read.py`.

These are the only upstream requests the builder makes itself. Every record comes from eye.

## Read

```
data/.venv/Scripts/python data/pipeline/read.py <snapshot-id> [--data-root DIR] [--jsonl]
```

```python
import read                      # with data/pipeline on sys.path
rows = read.load("nid-dams.texas.2026-10-19")
```

The reader takes the committed manifest, `data/manifests/<collection>/<snapshot-id>.json`. Before it reads any row, it checks every listed file's byte count and sha256 against that manifest. Then it checks:
- the row count against the manifest
- each row's `snapshotId`
- that every id is unique

Any mismatch raises `SnapshotRefused`, and the CLI exits 1 without printing a row. `test_read.py` shows that a one-bit change, an appended byte or a missing file is refused.

## The GeoParquet file

One row per record, sorted by `id`. The file is written single-threaded with zstd compression, so the same records give the same bytes (a test checks this). It carries GeoParquet 1.0.0 `geo` metadata, with WKB `geometry` as the primary column.

| column | type | what it is |
|---|---|---|
| `schemaVersion`, `id`, `collection`, `layer`, `name`, `nameRule`, `kind`, `text`, `snapshotId` | string | the record's fields. `kind` and `text` are null when the record has none. |
| `geometry` | WKB (GeoParquet) | the record's geometry |
| `stateFips`, `stateUsps`, `countyFips`, `placeMethod` | string | `place`, flattened. `countyFips` is null when it isn't derivable. |
| `details`, `provenance` | JSON | the record's objects |
| `record` | string | the exact JSON object that passed `validate.mjs`. `read.py` returns these. |

A null in a typed column means the field is absent from the record. The `record` column never holds a null.

## Tests

```
data/.venv/Scripts/python -m unittest discover -s data/pipeline -p "test_*.py"
node data/schema/validate.test.mjs
```

Both run in `.github/workflows/data.yml`. CI also validates every committed manifest with `--no-files`, because the files they list aren't in git.

## Diff

```
data/.venv/Scripts/python data/pipeline/diff.py <from-snapshot-id> <to-snapshot-id> [--out diff.json]
node data/schema/validate.mjs diff diff.json
```

`diff.py` compares two days of one collection and region (both read through `read.py`, so each file is checked against its manifest first) and writes `diff/1` ([`diff.schema.json`](schema/diff.schema.json)). Every removed id gets one reason:

- `publisher-status`: the later manifest's `gapItems` names it and says the publisher's own status or address flag keeps it out (NPS STATUS, NCES status).
- `our-rule`: the same gap item says our region rule or outline test left it out.
- `id-churn`: no gap item names it, but exactly one added record has the same secondary key (`NRIS_Refnum` for NRHP, `NIDID` for dams, `NCESSCH` for schools) within 1 m, and no other removed id claims that record.
- `unknown`: anything else, with a `why`. A gap reason the module doesn't recognise is `unknown`, not `our-rule`.

Records present on both days are compared field by field (`snapshotId` aside); a change lists its dotted paths, not values.

```
data/.venv/Scripts/python data/pipeline/diff.py --probe [--offline] [--manifest FILE]
```

`--probe` re-fetches the id list of a manifest's first `gap` request (default: NRHP Alabama, 2026-10-19) with the same URL, at most two requests and one page, and reports OBJECTID churn against the sha-pinned body in `<data-root>/raw/`: `churn_rate = (ids only in one body) / (ids in either)`. `--offline` reads the cached body for both sides and reports 0.0. A cached body that no longer hashes to the manifest's sha256 is refused, and a fresh answer is cached in a temporary folder, never in the data root.

## Changelog

Every snapshot id dated after 2026-10-19 has an entry in [CHANGELOG.md](CHANGELOG.md): the `diff.py` output against its predecessor (the latest earlier day of the same collection and region), or a line saying it has none. Run `diff.py` with `--out` as above, write its counts into the entry in the form that file documents, and add the entry in the same pull request as the manifest. `node data/schema/validate.mjs changelog` (code `changelog`, run by `data/schema/validate.test.mjs` on every pull request) fails a manifest without its entry, and an entry whose lines disagree with the manifests: the wrong predecessor, record counts that are not the two manifests' `recordCount`, removal classes that do not add up, or unknown removals that are not listed. It cannot reproduce the counts from `diff.py`, because the snapshot files are in the data root and not in git, so a reviewer reruns the entry's Command.

## Freshness

[`cadence.json`](cadence.json) says, per collection, how often its publisher says it releases new data, with the publisher's page and the sentence. A row has a number only when a quote carries the cadence word the publisher uses, and the days come from a closed table in `validate.mjs` (`CADENCE_DAYS`: daily 1, weekly 7, annual 365). Where the publisher states no interval for the data the pipeline reads, `expectedDays` is `null` with the reason `publisher-cadence-unstated` and a note of what was read. A number is never guessed, and a statute, a catalogue entry or memory is not a publisher page.

```
node data/schema/freshness.mjs [--today YYYY-MM-DD] [--manifests DIR] [--cadence FILE]
```

For each collection it prints its newest committed snapshot (across regions), the age in days and the cadence, then `overdue: <collection> newest <day> cadence <days>` for each collection older than its cadence, or `none overdue`, then `unstated:` with the collections whose cadence is null. A null cadence is never overdue. It reports and exits 0 whatever it finds; it exits 2 only when it cannot read its inputs. The weekly `data` workflow runs it as a step of the `hub-verify` job (Mondays, and on `workflow_dispatch`). Because the newest snapshot of a collection decides, a region left behind while another is refreshed does not show in the overdue line; the `held:` line names the snapshot that decided.

`node data/schema/validate.mjs cadence` (code `cadence`, run by `data/schema/validate.test.mjs`) fails a committed collection with no row, a row with no committed manifest, a number that disagrees with its cadence word or that no quote carries, and a null with no reason. To add a collection, read its publisher's own page, copy the sentence into a row, and leave the number `null` if there is no sentence that gives an interval.

## Licences

[`LICENSES.md`](LICENSES.md) has one row per publisher that a committed collection (or the Hugging Face companies file) draws on: the terms page, what the publisher's own page grants as a quote of under 25 words (or that it states no licence, or that no terms page was found), and what we grant on top, which is always nothing beyond their terms. The compilation licence of the bundle is Cam's open decision and the file says so. A licence name no page gave is never written down.

```
python -I data/pipeline/licenses_fetch.py --write     # fetch every terms page, check the quotes, rewrite licenses.lock.json
python -I data/pipeline/licenses_fetch.py --check     # fetch them again and report; writes nothing
node data/schema/licenses.test.mjs
```

[`licenses.lock.json`](licenses.lock.json) holds, per terms URL, the status, bytes and sha256 of the response, the User-Agent sent, and whether the quote was on the page (for the USACE FeatureServer, whose JSON has a `copyrightText`, the value of that field too, which must be the empty string: `--check` reads it again). `licenses_fetch.py` asks each host for one page at most once a second, with `net.UA` (the SEC with the string it asks for), follows redirects by hand, and refuses to write the lock when a quote is not on its page. `--check` fails on a status other than 200, a quote that has left its page or a "states no licence" page that now mentions one; a sha256 that differs is reported and does not fail it, because census.gov and nps.gov pages change without their terms changing. Neither mode runs in CI: a publisher being down should not fail a pull request.

`node data/schema/licenses.test.mjs` (run by `data/schema/validate.test.mjs`, so by the `data` workflow) fails a collection whose source's publisher has no row naming it (each manifest's `sources[].sourceId` is tied to a publisher in `SOURCE_PUBLISHERS` in the test), a row that names a collection it publishes no source of, a publisher a manifest's `joins[].boundary` names with no row naming the collection under "Also used for", a terms URL that is not https, a statement that is not a quote, a stated absence or a no-page finding, a quote of 25 words or more or one the lock did not find on the page, a licence name outside the quote the lock found (the list in `LICENCE_NAMES` takes a no-break space or a non-breaking hyphen for a space or a hyphen), anything granted on top, a statement that the service's `copyrightText` is empty when the lock does not record `copyrightText` as the empty string, a retrieved day that is not the lock's fetch day, and a lost compilation line. The files the Hugging Face dataset ships that no manifest lists are held by shipped file: `EXTRA_FILES` in `data/hf/publish.py` (read by scanning its literal, since it is Python) says what is shipped, `EXTRA_FILE_PUBLISHERS` in the test says whose data each file is drawn from (the SEC and the Census Bureau for the companies file), and every one of those publishers needs a row that names the file under "Also used for"; a shipped file with no line in `EXTRA_FILE_PUBLISHERS` fails, naming it. It also holds the Hugging Face card, `apps/map/lib/mcp/server.ts` (the server instructions) and `apps/map/docs/MCP.md` to the link. It reads the lock and never the network.

## Pack raw/

```
python -I data/pipeline/pack_raw.py --dry-run [--data-root DIR] [--manifests DIR]
python -I data/pipeline/pack_raw.py --out DIR
```

Every manifest's `requests[].sha256` pins a response body, and the bodies live in `<data-root>/raw/`, on one disk, outside git. `pack_raw.py` packs that folder into `raw.tar` with an `index.json` beside it, so a copy can be kept somewhere else and checked against the manifests.

- **What goes in:** every regular file under `raw/`, recursively: the bodies, their `.json` sidecars (url and `retrievedAt`), the athletes cache and the county boundary zip. A symlink or any other non-regular file stops the run. `raw-stale-nid-2026-10-19/` sits beside `raw/` in the data root, not under it, and is not packed.
- **The tar:** members are `raw/<path>`, so `tar -xf raw.tar -C <data-root>` restores the cache. They are sorted by name, with mtime 0, uid and gid 0 and mode 0644, and not compressed, so the same `raw/` gives the same bytes. No compression has been measured, so none is chosen.
- **index.json:** `files` lists every member as `{path, bytes, sha256}`, then the tar's own size and sha256 and the coverage counts. No dates, so the index is reproducible too.
- **Coverage:** the sha256 of every file is computed from its bytes (a sidecar's claim is not read). Each distinct `requests[].sha256` in `data/manifests/*/*.json` must equal one of them. A pin with no file is printed as `MISSING <snapshot> <purpose> <url> <sha256>` and the exit code is 1. No manifests, a manifest without `requests[]`, or a pin that isn't 64 hex digits is refused too.
- **`--dry-run`:** does all of the above except writing: file count, bytes by kind, the exact tar size, the requests and distinct shas per manifest, the coverage count. It reads `raw/` end to end, so on a RAM-poor box run it under `admit.sh`.
- **`--out DIR`:** does the dry run, and only if coverage is complete writes `raw.tar.part` and `index.json.part`, re-hashing each file as it goes in, then renames both. It refuses an existing `raw.tar` or `index.json`, and a `DIR` that is the data root or anywhere inside it (`raw/` included). `DIR` is the only place it writes, so the pack never writes in the data root.
- **Upload:** none here. Where the tar goes (Hugging Face, rclone, an external disk) is Cam's call, per the datastore tiering.

`test_pack_raw.py` builds a temporary `raw/` for the three fixture snapshots, whose pinned bodies are not in git, and shows that deleting a body, or flipping one bit in it, turns the coverage check red.

## The 2026-10-19 drift, and its remedy

PR #51 backfilled `embeddableFields` and `embeddableName` into the three Texas manifests of 2026-10-19 in place, but only the committed copies under `data/manifests/`. The `manifest.json` beside each snapshot's files in the data root stayed as the build wrote it, so `nces-public-schools.texas.2026-10-19`, `nid-dams.texas.2026-10-19` and `nrhp-listed.texas.2026-10-19` each existed as two different byte strings, and nothing compared them. Found on 2026-10-20 by comparing every committed manifest with its data-root copy (12 manifests; exactly those 3 differed).

Remedy, all in the W2D change:

- `node data/schema/embeddable.mjs --backfill` was run on those three data-root copies, so they now equal the committed ones byte for byte.
- `data/hf/publish.py`'s dry run refuses any data-root manifest that differs byte for byte from its committed copy. Before the backfill the real dry run exited 1 naming the three; after it, 0 (`data/hf/test_publish.py` has the case for both).
- `data/manifests/LOCK.json` and `node data/schema/lock.mjs --check` (in `data.yml`) hold each committed manifest's sha256, so a committed manifest cannot change again without a CI failure. A change is a new snapshot id on a new UTC day (SCHEMA.md, "Changing a manifest").
- `data/hf/verify.py` compares the Hub's stored hashes with the committed manifests once the dataset is uploaded; `data.yml` runs it weekly.
