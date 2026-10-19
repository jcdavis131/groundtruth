# The canonical record and the snapshot manifest

Version `record/1` and `manifest/1`, 2026-10-18.

This writes down a shape eye already serves. It isn't a new design. On 2026-10-18 the schools, historic places and PAD-US routes on eye.jcamd.com all returned the same feature properties (`id`, `layer`, `name`, `kind`, `source`, `details`, `extra.embedText`), with ids that were unique and identical across two fetches, inside the provenance envelope from `lib/provenance/types.ts`. A record here is that feature plus that envelope, flattened into one row a training run or a retrieval tool can read without eye.

Files:

- `schema/record.schema.json` and `schema/manifest.schema.json`: JSON Schema 2020-12.
- `schema/validate.mjs`: the validator. Plain Node, no install. It reads the two schemas and adds the checks a schema can't express (below).
- `schema/validate.test.mjs`: the tests, run by `.github/workflows/data.yml`.
- `schema/fixtures/`: three real snapshots built from eye's live API, plus invalid copies with one thing broken in each.

```
node data/schema/validate.mjs record <file.json | file.jsonl> ...
node data/schema/validate.mjs manifest <snapshot>/manifest.json ...
node data/schema/validate.test.mjs
```

## Missing means absent

A field with no value is left out of the record. It is never `null`, `""`, `"N/A"`, `"TBD"`, `-9999` or any other stand-in. The validator rejects these strings anywhere in a record or manifest (trimmed, any case): empty, `null`, `nil`, `undefined`, `nan`, `n/a`, `tbd`, `todo`, `placeholder`, `lorem ipsum`, `-`, `--`, `?`, `xxx`, `missing`. It also rejects the fill numbers `-9999`, `-99999` and `-999999`.

A publisher's own coded state, in the publisher's own words, is a value. NCES's "not reported" and "not applicable", or PAD-US's "Unknown" owner type, are what the source said, so they stay. The rule is that we never write a filler of our own.

Required fields are required. If a builder can't fill one, it doesn't write the record, and the manifest's count gap says why.

## The record

One JSON object. In a snapshot file, it's one line of JSONL.

| field | required | what it is |
|---|---|---|
| `schemaVersion` | yes | `"record/1"` |
| `id` | yes | eye's feature id: a source prefix, a colon, then the upstream's own id (`nces:480001609410`, `nrhp:pt:1418942`). It is stable across fetches and unique inside the collection. The pair (`collection`, `id`) is the record's key. |
| `collection` | yes | The catalogue card id from eye's `lib/catalog/collections.ts` (`nces-public-schools`, `nrhp-listed`). |
| `layer` | yes | eye's layer id (`schools`, `historic`). |
| `name` | yes | The label eye draws. What it may be is set by `nameRule`. |
| `nameRule` | yes | `public-name` means the record's published name. It's allowed only on a collection with a public-name rule: today `hifld-hospitals`, `nces-public-schools`, `nid-dams` and `padus-units`, the same list as eye's `PUBLIC_NAME_RULE`. `label-by-id` means a label built from the record's id and category (`NRHP 82004525 · building`), never a name that could be a person's. |
| `kind` | no | eye's sub-type (`high`, `building`). |
| `geometry` | yes | GeoJSON geometry (RFC 7946): Point, MultiPoint, LineString, MultiLineString, Polygon or MultiPolygon. WGS84 degrees, longitude first. A height is kept only when the source measured one. |
| `place` | yes | Place joins: `stateFips` and `stateUsps` (required, and they must agree), and `countyFips` when it can be derived (it must sit inside the state). `method` says how the join was made: `source-field` (the upstream's own code), `point-in-polygon` (the geometry tested against a named boundary file) or `name-lookup` (a place name matched to a code table). |
| `details` | yes | The source's own fields, as eye shows them on click, keyed by eye's labels. Values are strings, numbers or booleans. A field with no value is left out, and so is any field the manifest lists as withheld. It may be `{}`. |
| `text` | no | The record text: eye's `recordText` (B0), which is the only text eye embeds. It starts with `collection: `. It's absent when the record has none. |
| `provenance` | yes | Where the record came from (below). |
| `snapshotId` | yes | The snapshot this row belongs to. Its collection part must equal `collection`. |

`provenance`. Each field comes from eye's `Provenance` and `SourceRef`:

| field | required | what it is |
|---|---|---|
| `sourceId` | yes | `SourceRef.id`, the key in eye's `lib/provenance/sources.ts` (`nces-edge-public`). |
| `sourceName` | yes | `SourceRef.name`, as a citation gives it. |
| `publisher` | yes | `SourceRef.publisher`. |
| `licence` | yes | `SourceRef.license`, word for word: the terms, credit line and caveats as eye recorded them. |
| `upstreamUrl` | yes | The upstream URL the rows were read from. |
| `retrievedAt` | yes | When eye fetched it: ISO 8601 UTC, ending in `Z`. It may not fall after the snapshot's day. |
| `kind` | yes | `published` (relayed as-is), `estimate` (computed from published values) or `snapshot` (our own observation of a live feed). |
| `seriesId` | no | The upstream's dataset, layer or series id, when one exists. |
| `period` | no | The period the record describes (`school year 2024-25`). Absent for a current-state source. |
| `releasedAt`, `method`, `revision`, `notes` | no | As in eye's `Provenance`. |

### From eye's LayerFeature

| eye | record |
|---|---|
| `properties.id`, `layer`, `name`, `kind`, `details` | the same fields. `null` and `undefined` details are dropped. |
| `properties.extra.embedText` | `text` |
| `properties.nameNotSearchable`, `PUBLIC_NAME_RULE` | `nameRule` |
| the envelope's `provenance[0]` | `provenance` (flattened: `source.id` becomes `sourceId`, `source.license` becomes `licence`) |
| `properties.source` (the HUD's short source label) | not carried. `provenance` names the source. |
| the rest of `properties.extra` (`levelClass`, `refnum` and so on) | not carried. It's eye's drawing state. Anything a reader needs is already in `details`. |
| `heading`, `altitude`, `speed`, `observedAt`, `simulated`, `imageUrl` | not in `record/1`. These belong to live feeds (aircraft, ships, cameras). `record/1` is for catalogued collections. Live feeds would get a revision when one is snapshotted, and simulated features are never snapshotted. |
| a Point's height of exactly 0 | dropped. ArcGIS fills it in, and the source didn't measure it. |

### Names and privacy

eye's privacy rules apply to every snapshot as they are written in eye: no private-person search or embedding, owner names only in the one clicked parcel's record, and the `GEV_PEOPLE_WITHHELD` list. A snapshot is a copy that leaves eye, so it adds one rule. A source field eye shows on click but that can hold a person's name is withheld from the snapshot, and the manifest lists it under `withheldFields` with the reason. The first case is NRHP's property name (`RESNAME`): eye's card says it can be a person's name and never searches or embeds it, so the historic snapshots leave it out and label each record by its NRIS number.

## The snapshot

A snapshot is one collection, one region and one UTC day, and it never changes once it's written. Its id is

```
<collection>.<region id>.<YYYY-MM-DD>      nces-public-schools.austin-east.2026-10-18
```

The day is the UTC date of `createdAt`. The commit that built it is in `builder.gitSha`. The charter's draft name was `YYYY-MM-DD+<commit7>`, with the commit inside the id. This version keeps the id readable and puts the commit in the manifest, because a training run cites the id and the manifest pins the code. If the id should carry the commit too, that takes a `manifest/2`.

A snapshot is a folder holding `manifest.json` and the record files it lists (`records.jsonl` for now). Records are sorted by `id`, one JSON object per line, LF line endings, UTF-8.

### The manifest

| field | required | what it is |
|---|---|---|
| `schemaVersion` | yes | `"manifest/1"` |
| `snapshotId` | yes | Must equal `<collection>.<region.id>.<createdAt's UTC date>`. |
| `collection` | yes | The collection. |
| `region` | yes | `id` (a slug), `name`, `bbox` as [west, south, east, north] in WGS84 with west < east and south < north, and `rule`: `point-in-bbox` (a Point is in when it lies inside the box, edges included) or `intersects-bbox`. `definition` is optional prose. |
| `createdAt` | yes | When the builder ran, in UTC. |
| `builder` | yes | `name`, `version` (semver) and `gitSha` (the full 40-character commit the builder ran from). `repo` is optional. |
| `recordSchemaVersion` | yes | `"record/1"` |
| `sources` | yes | Each `sourceId` in the records, with its `licence`. |
| `requests` | yes | Every request the builder made, in order: `purpose` (`records`, `count` or `gap`), `url`, `status`, `retrievedAt`, `bytes` and the `sha256` of the response body. |
| `recordCount` | yes | Rows in the snapshot. Must equal the sum of `files[].records`. |
| `publisherCount` | yes | The publisher's own count for the region: `value`, `method` (how it was asked for, in words), `url` and `countedAt`. When `value` differs from `recordCount`, `gap` is required and names the rows that aren't records and why. |
| `files` | yes | Each file: `path` (relative, inside the snapshot folder), `format` (`jsonl`), `sha256` (64 lowercase hex characters), `bytes` and `records`. |
| `withheldFields` | no | Source fields left out, each with `field` and `why`. Absent when none are withheld. |

### Checks beyond the schema

`validate.mjs` reports each problem as `{code, path, message}`. These codes come from rules JSON Schema can't express:

- `placeholder`: a filler value (see "Missing means absent").
- `ring`: a polygon ring whose first and last positions differ.
- `state`: `stateFips` isn't a state or territory code, or doesn't match `stateUsps`.
- `county`: `countyFips` isn't inside `stateFips`.
- `snapshot`: the record's snapshot is of another collection, or the date isn't a real date. In a manifest, the id doesn't match its collection, region and day.
- `time`: the record was retrieved after its snapshot's day.
- `public-name`: `nameRule` is `public-name` on a collection with no public-name rule.
- `bbox`: the box isn't west < east and south < north.
- `count`: `recordCount` doesn't match the files.
- `gap`: the counts differ and `gap` doesn't say why.
- `file-missing`, `file-bytes`, `file-sha`, `file-records`, `file-record`: a listed file is absent, its size, hash or line count differs from the manifest, or one of its lines isn't a valid record of this snapshot (including a repeated id).

Schema problems use the keyword's name (`required`, `type`, `pattern`, `enum`, `const`, `additional`, `minItems`), with `range` for `minimum` and `maximum`. The evaluator implements only the keywords the two schema files use, and throws on any other, so a schema can't quietly promise a check that isn't made.

## The fixtures

`schema/fixtures/build-fixtures.mjs` built three snapshots on 2026-10-18 from eye's live API (`civic?op=schools` and `land?op=historic`), using two small boxes in Austin, Texas. It made one count request per snapshot to the publisher's own ArcGIS layer:

| snapshot | records | publisher's count |
|---|---|---|
| `nces-public-schools.austin-east.2026-10-18` | 4 | 4 |
| `nces-public-schools.austin-downtown.2026-10-18` | 2 | 2 |
| `nrhp-listed.austin-east.2026-10-18` | 3 | 4 (the fourth row is a Removed listing, which eye doesn't draw) |

The first record of each snapshot is copied to `record/valid/`. The builder refuses to run with uncommitted changes to itself, the validator or the schemas, because each manifest names the commit it was built from. Rebuilding on a later day writes new snapshot folders. It doesn't change these.

`schema/fixtures/make-invalid.mjs` is the source of `record/invalid/` and `manifest/invalid/`. Each case is a valid fixture with one thing broken, plus the code and path the validator must report. The tests also fail if a file drifts from its case.

## Not in this version

- **A conformance count over all 60 collections.** This is the database's first real job. Of the six routes probed on 2026-10-18, three already emit this shape. WRC passes the upstream's raw fields through, with no canonical id or record text. Gauges and HUD DDA returned no features in the probe boxes, so they weren't checked.
- **A snapshot builder for production.** The fixture builder shows the mapping, but it isn't the weekly job the consumer contract asks for.
- **Records outside the United States.** `place` requires state codes, so a collection abroad (some World Heritage sites, for example) needs a `record/2` with a country join.
- **Embeddings.** A snapshot holds record text, not vectors. When vectors ship, the manifest will name the embedder, its commit and its table's sha256, as `catalog_search` already reports them.
