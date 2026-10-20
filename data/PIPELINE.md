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
