# eval/ - the v4 eval kit

Plain Node and the Python standard library. No install, no network. The v4 run itself is not started from here: it waits for a preregistration, a hashed gold file and a hashed split on groundtruth#15 (writeups `PREREG-TEMPLATE.md`).

| File | What it does |
|---|---|
| `split.mjs` | Writes the split once: seed 20261019, stratified by `placeKind` from `pool.json`, an exclusion list applied, every kind within one item across the two halves (`open`, `sealed`). Refuses to overwrite. Prints the sha256 of the split and of the exclusion list. |
| `lineage.mjs`, `lineage-list.json` | Flags pool items whose `sources` come from the material that built the system under test (the FEMA legacy tables, the P19 audit). Run on the frozen pool it flags one item today. |
| `score.py` | Scores two arms with k runs each against a gold file. Selective accuracy, coverage, false-fill rate, `Q(k)` for k in 1, 2, 4, 9, a paired bootstrap (10,000 resamples, fixed seed, 2.5th and 97.5th). A failed or missing run is listed and unscored, never 0. |
| `lib.mjs` | Item ids (first 12 hex of sha256 of the question), argument parsing. |
| `*.test.mjs`, `test_score.py` | The tests, run by `.github/workflows/eval.yml` with no network. |

## What stays out of git

Gold, the KEY and the split output are sealed during the run (PREREG-TEMPLATE rule 6). `scripts/guard.mjs` fails any tracked file named like them (`gold*`, `KEY*`, `split*` with a data extension, or bare) or carrying their header marker (a `marker` field in the file's first object). Only their sha256 goes on #15. The tests build their files in a temp folder.

## Answer format (identical in both arms)

Each planner answers `{answer, status, citation}`, `status` one of `answered`, `not_published`, `unknown`. Scoring, per answered item-run, credit `c` in [0, 1]: exact for codes, ids, dates and labels (NFC, trimmed, whitespace collapsed, case kept), a declared tolerance for numbers, set-F1 for lists. Any answer on an item whose gold is NOT_PUBLISHED has `c = 0` (a false fill). Score for penalty `k`: answered `c - k(1 - c)`; `not_published` +1 when gold is NOT_PUBLISHED, else 0; `unknown` 0.

## Gold file shape (what `eval/gold/build-gold.mjs` will write)

`{marker, items: {id: {type, verdict: PUBLISHED | NOT_PUBLISHED, gold, tolerance, flag, url}}}`: every row carries the publisher URL it came from and a verdict; NOT_PUBLISHED comes from the publisher's own suppression flag.

## Not here yet

`eval/gold/build-gold.mjs` and its test. It imports the cite-check matchers (`apps/map/lib/cite/`, build item B1), which are not on master. It lands after B1.
