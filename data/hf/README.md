---
pretty_name: groundtruth snapshots
language:
  - en
license: other
size_categories:
  - 10K<n<100K
tags:
  - geospatial
  - geoparquet
  - united-states
  - texas
  - alabama
  - dams
  - schools
  - historic-places
  - public-companies
  - sec-edgar
  - public-domain-sources
configs:
  - config_name: nid-dams.texas.2026-10-19
    data_files: snapshots/nid-dams.texas.2026-10-19/records.parquet
  - config_name: nid-dams.alabama.2026-10-19
    data_files: snapshots/nid-dams.alabama.2026-10-19/records.parquet
  - config_name: nces-public-schools.texas.2026-10-19
    data_files: snapshots/nces-public-schools.texas.2026-10-19/records.parquet
  - config_name: nces-public-schools.alabama.2026-10-19
    data_files: snapshots/nces-public-schools.alabama.2026-10-19/records.parquet
  - config_name: nrhp-listed.texas.2026-10-19
    data_files: snapshots/nrhp-listed.texas.2026-10-19/records.parquet
  - config_name: nrhp-listed.alabama.2026-10-19
    data_files: snapshots/nrhp-listed.alabama.2026-10-19/records.parquet
  - config_name: nid-dams.texas.2026-10-20
    data_files: snapshots/nid-dams.texas.2026-10-20/records.parquet
  - config_name: nid-dams.alabama.2026-10-20
    data_files: snapshots/nid-dams.alabama.2026-10-20/records.parquet
  - config_name: nces-public-schools.texas.2026-10-20
    data_files: snapshots/nces-public-schools.texas.2026-10-20/records.parquet
  - config_name: nces-public-schools.alabama.2026-10-20
    data_files: snapshots/nces-public-schools.alabama.2026-10-20/records.parquet
  - config_name: nrhp-listed.texas.2026-10-20
    data_files: snapshots/nrhp-listed.texas.2026-10-20/records.parquet
  - config_name: nrhp-listed.alabama.2026-10-20
    data_files: snapshots/nrhp-listed.alabama.2026-10-20/records.parquet
---

# groundtruth snapshots

Records from [groundtruth](https://github.com/jcdavis131/groundtruth): every source we collect, on one map, and the same records organized so models and tools can use them. This dataset is the second half. Each file here is a copy of what the map serves, with its sources, written once and never changed.

**LICENSE: Cam's call — the records are compiled from US federal public-domain sources (NID/USACE, NCES, NPS, SEC EDGAR, Census); the compilation's licence is not decided yet.** Until it is, the front matter says `license: other`. Each source keeps its own terms; they are quoted in every manifest's `sources[].licence`.

**Licences, publisher by publisher:** [data/LICENSES.md](https://github.com/jcdavis131/groundtruth/blob/master/data/LICENSES.md) gives each publisher's terms page and what its own page grants. Compilation licence: not yet chosen (Cam decides; until then the bundle carries no licence of its own and each record stays under its publisher's terms)

Four rules come with every record. Every record cites its source. Missing means missing: no placeholder values. Public, keyless sources only. No search or embedding of private individuals.

## What a snapshot is

A snapshot is one collection, one region and one UTC day. Its id is `<collection>.<region>.<YYYY-MM-DD>`, for example `nid-dams.texas.2026-10-19`. Once written it never changes. A later build writes a new snapshot with a new day.

Each snapshot is a folder with two files:

- `records.parquet`: the records, one row each, sorted by `id`. GeoParquet 1.0.0, WKB `geometry`, zstd. Each row's fields are columns, and the `record` column holds the exact JSON object that passed the validator. The columns are listed in [data/PIPELINE.md](https://github.com/jcdavis131/groundtruth/blob/master/data/PIPELINE.md) (The GeoParquet file).
- `manifest.json`: what the snapshot holds and how it was built. The builder's commit, every request it made with the sha256 of each response, the publisher's own count, and the sha256 and byte count of `records.parquet`.

The record format is `record/1` and the manifest format is `manifest/1`. Both are written down, with their JSON Schemas and validator, in [data/SCHEMA.md](https://github.com/jcdavis131/groundtruth/blob/master/data/SCHEMA.md). The short version: a record has an `id` (a source prefix and the upstream's own id, `nid:TX00028`), a `name` and the rule that allowed it (`nameRule`), a GeoJSON `geometry`, a `place` join to state and county FIPS codes, the source's own fields in `details`, the record `text`, and `provenance` naming the publisher, the upstream URL, the licence and when the rows were fetched. A field with no value is left out, never `null` or a stand-in.

The records come from the map's public API, which relays each publisher's own data. The builder is `data/pipeline/build.py` in the repo. It asks the publisher for nothing but its own count and its list of ids.

## The files

| path | what it is |
|---|---|
| `snapshots/<id>/records.parquet` | the records, GeoParquet |
| `snapshots/<id>/manifest.json` | the snapshot's manifest. This is the copy committed in the repo under `data/manifests/`, which carries `embeddableFields` and `embeddableName` |
| `companies/companies.full.2026-10-20.us-placed.json` | the full SEC EDGAR companies pull after the US-only placement rule, described below |
| `companies/companies.full.2026-10-20.us-placed.json.sha256` | its sha256, as `sha256sum` writes it |
| `README.md` | this card |

Six snapshots, all built on 2026-10-19:

| snapshot | records | publisher's count | source |
|---|---|---|---|
| `nid-dams.texas.2026-10-19` | 7,415 | 7,421 | US Army Corps of Engineers, National Inventory of Dams |
| `nid-dams.alabama.2026-10-19` | 2,253 | 2,263 | US Army Corps of Engineers, National Inventory of Dams |
| `nces-public-schools.texas.2026-10-19` | 9,192 | 9,624 | US Department of Education, NCES EDGE / Common Core of Data, school year 2024-25 |
| `nces-public-schools.alabama.2026-10-19` | 1,531 | 1,535 | US Department of Education, NCES EDGE / Common Core of Data, school year 2024-25 |
| `nrhp-listed.texas.2026-10-19` | 2,830 | 2,847 | National Park Service, National Register of Historic Places |
| `nrhp-listed.alabama.2026-10-19` | 913 | 919 | National Park Service, National Register of Historic Places |

A region is a whole state. A record is in when the source's own state field says so and its point lies inside the state outline, or within 0.05 degrees of it. The exact rule, with the outline's URL and the sha256 of the outline response, is in each manifest's `region.definition`. The builder's commit is in `builder.gitSha`; it differs between snapshots because the builder changed between runs.

## How the counts relate to the publishers' counts

Every manifest carries `publisherCount`: the publisher's own count for the state, how it was asked for (`method`), the query URL and when it was asked. `recordCount` is the number of rows in the snapshot. When the two differ, `publisherCount.gap` itemises every row that is not a record, by id, with the reason. There is nothing to add up by hand: the gap text is the full list.

The reasons that occur in these six:

- The publisher's row repeats an id another row already has. A record's key is its id, so there is one record per id. (Dams: Texas 3 rows, Alabama 10 rows.)
- The row's status is not one the map draws: an NCES school that is `Inactive` or `Future` in 2024-25 (Texas 432: 296 Inactive and 136 Future; Alabama 3 Future), or an NRHP row whose status is `Removed` or blank (Texas 16, Alabama 1).
- The source files the row under the state, but its own point lies more than 0.05 degrees outside the state outline (between one and five rows, in four of the six snapshots).

Each gap also says how many features from edge tiles the builder saw and set aside because their source field names another state. Those are counted on neither side.

## What may be embedded

Embed or train on a record's `text`, the `details` keys its manifest lists in `embeddableFields`, and its `name` only where `embeddableName` allows it. Everything else in `details` is for display and citation.

`details` holds what the map shows when a record is clicked, and that is more than the map searches or embeds: a school's street address and enrollment, a dam's river, ids like the NID id or NRIS reference number. A reader that embeds `details` whole would embed what the map never does.

The lists in these six manifests:

| collection | `embeddableFields` | `embeddableName` |
|---|---|---|
| `nid-dams` | primary purpose, dam type, hazard potential, condition assessment, county, state, year completed | `when-nameRule-public-name` |
| `nces-public-schools` | level, type, charter, virtual, status, locale, grades | `when-nameRule-public-name` |
| `nrhp-listed` | resource type, national historic landmark, listed, city, county, state | `never` |

`text` is the record text the map itself embeds. It starts with `collection: ` and holds only allowed fields. Both lists are derived from the map's own embedding rules, never written by hand, and the repo's tests fail when they drift.

## Names that are withheld

No record carries a private person's name, and no field that could hold one is searchable or embeddable.

- **Dams.** NID's published dam name is withheld as a detail on every dam, because a privately owned dam's name can be its owner's (`<Surname> Pond Dam`). A dam keeps its name in `name` only when its owner type, and every entry of its owner types, is Federal, State, Local Government, Public Utility or Tribal Government; then `nameRule` is `public-name`. Any other dam, including one whose owner type is Private anywhere, Not Listed or missing, is labelled by its id (`Dam TX00028`) with `nameRule` `label-by-id`, and its `text` has no name segment.
- **Historic places.** NRHP's property name is withheld on every listing, because it can be a person's name. Each record is labelled by its NRIS reference number and resource type (`NRHP 82004525 · building`), `nameRule` is `label-by-id`, and `embeddableName` is `never`.
- **Schools.** A public school's published name is public. `nameRule` is `public-name`.

Each manifest's `withheldFields` lists the withheld field and the reason.

## The companies file

`companies/companies.full.2026-10-20.us-placed.json` is the full pull of listed companies from SEC EDGAR on 2026-10-20, after the US-only placement rule: 8,029 companies, one object each, under a header with `source`, `pulled`, `counts` and `frameYears`. Per company: CIK, name, ticker, exchange, SIC code and description, the business-address state, city and ZIP the filer registered with the Commission, county FIPS and a point, `geo` (how the point was made), `geoReason` (why there is no point; `null` when placed), fiscal year end, state of incorporation, and `facts`: the latest value for eight XBRL concepts (revenues, net income, operating income, assets, equity, cash, long-term debt, employees) over calendar years 2025 and 2024, each citing the frame period, the period end and the accession number it came from. 5,792 companies have at least one fact. The sources are the SEC's company_tickers_exchange file, submissions API and XBRL frames API, the Census 2020 ZCTA-to-county file and TIGERweb ZCTA centroids. All keyless, all public domain. Details in [apps/map/docs/COMPANIES.md](https://github.com/jcdavis131/groundtruth/blob/master/apps/map/docs/COMPANIES.md).

The file derives from the raw pull (sha256 `15345d757b85601ab1e619c7a613927c89c4dd74f8078a9e4b73e10cb6a161ac`, kept off this dataset as lineage) by `apps/map/scripts/companies-compact.mjs --write-full`, which applies two rules after the pull and writes the result as one line. Placement is US-only: a company has a point only at the centroid of the 2020 Census ZCTA its ZIP matches (`geo` is `zcta-centroid`), and only when its business-address state is a US state or territory USPS code. The raw pull had placed 50 filers with a non-US address (Banco Santander in Madrid, for example) at the centroid of the US ZCTA their foreign postcode happened to match; here they have no point. And every unplaced company says why in `geoReason`. These are the same records the map's own committed bundle decodes to, and the header's `source` line records that the rule was applied after the pull.

Counts: 5,516 placed, 2,513 unplaced. The unplaced by reason: 1,999 `no US five-digit business-address ZIP in SEC submissions`, 321 `business address outside the US (postcode ...)`, 193 `ZIP ... is not a 2020 Census ZCTA`. An unplaced company has `countyFips`, `lon`, `lat` and `geo` as `null`. The publisher (`data/hf/publish.py`) refuses the file if any placed company has a non-US state, any unplaced company lacks a `geoReason`, or `counts.geocoded` differs from the placed count.

The file is about companies, not people. It carries no officer, director, owner or shareholder names, no mailing addresses and no individual filers.

## Verifying a file

Every `records.parquet` is listed in its own `manifest.json` under `files[]` with its `sha256`, `bytes` and record count. Hash the file and compare:

```
sha256sum snapshots/nid-dams.texas.2026-10-19/records.parquet
python -I -c "import json,hashlib;print(hashlib.sha256(open('snapshots/nid-dams.texas.2026-10-19/records.parquet','rb').read()).hexdigest(), json.load(open('snapshots/nid-dams.texas.2026-10-19/manifest.json'))['files'][0]['sha256'])"
```

The two digests must be equal. For the companies file, compare with the digest in `companies.full.2026-10-20.us-placed.json.sha256`. The repo's reader, `data/pipeline/read.py`, does these checks before it returns a row and refuses a snapshot whose file differs from its manifest by one bit.

The sha256 of each upstream response the builder read is in the manifest's `requests[]`, so a record can be followed back to the bytes it came from.

## How this dataset is published

From a checkout of the repo, `python -I data/hf/publish.py` checks every file above against its manifest or sidecar and prints the table; `--upload` then sends them in one commit. Nothing is uploaded until every hash matches.
