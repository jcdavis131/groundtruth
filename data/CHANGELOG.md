# Data changelog

One entry per snapshot id: what changed between a snapshot and the one before it, with the removal classes `data/pipeline/diff.py` gives (`publisher-status`, `our-rule`, `id-churn`, `unknown`). The classes are defined in [PIPELINE.md](PIPELINE.md) (Diff).

**The rule.** Every committed manifest in `data/manifests/` dated after 2026-10-19 has a `## <snapshot id>` entry in this file. Level-2 headings are for entries only, newest last. A snapshot with a predecessor (the latest earlier day of the same collection and region) gets the diff against it. A first snapshot of a collection or region says so.

**An entry** is these lines, and `unknown` is 0 or each unknown id is listed under `Unknown removals`:

```
## <snapshot id>

- Predecessor: <previous snapshot id>      or: none (first snapshot of <collection> for <region>)
- Command: `python data/pipeline/diff.py <predecessor> <snapshot id>` (diff.py <version>, exit 0, run <day>)
- Records: <predecessor's recordCount> -> <this recordCount>
- Added: <n>
- Removed: <n> (publisher-status a, our-rule b, id-churn c, unknown d)
- Changed: <n>
- Unchanged: <n>
- Unknown removals: none        or: <d>, then one line per id: "  - <id>: <why>"
- Changed fields: <dotted path> <n>, ...        informational
```

**What CI checks.** `node data/schema/validate.mjs changelog` (run by `data/schema/validate.test.mjs`, so by the `data` workflow on every pull request) fails a manifest dated after 2026-10-19 that has no entry, an entry that names no committed snapshot, and an entry whose lines disagree with the manifests: the wrong predecessor, a Command that does not name the pair or did not exit 0, Records that differ from the two manifests' `recordCount`, removal classes that do not add up to Removed, Added minus Removed that is not the change in records, Changed plus Unchanged that is not the records present on both days, and unknown removals that are not listed.

**What CI does not check.** That the counts reproduce from `diff.py`. The snapshot files are in the data root, outside git, so a reviewer runs the Command on a box that has them and compares the counts. `Changed fields` is read off the diff the Command writes with `--out` (the dotted paths in each `changed[].fields`, counted) and is not checked.

In the 2026-10-20 entries below, the only paths that changed are `place.countyFips` and `place.method`: the paths the 2026-10-20 county join writes ([PIPELINE.md](PIPELINE.md), Build, step 5). Schools already carried a county from the source field, so none of theirs changed.

## nces-public-schools.alabama.2026-10-20

- Predecessor: nces-public-schools.alabama.2026-10-19
- Command: `python data/pipeline/diff.py nces-public-schools.alabama.2026-10-19 nces-public-schools.alabama.2026-10-20` (diff.py 0.1.0, exit 0, run 2026-10-20)
- Records: 1531 -> 1531
- Added: 0
- Removed: 0 (publisher-status 0, our-rule 0, id-churn 0, unknown 0)
- Changed: 0
- Unchanged: 1531
- Unknown removals: none
- Changed fields: none

## nces-public-schools.texas.2026-10-20

- Predecessor: nces-public-schools.texas.2026-10-19
- Command: `python data/pipeline/diff.py nces-public-schools.texas.2026-10-19 nces-public-schools.texas.2026-10-20` (diff.py 0.1.0, exit 0, run 2026-10-20)
- Records: 9192 -> 9192
- Added: 0
- Removed: 0 (publisher-status 0, our-rule 0, id-churn 0, unknown 0)
- Changed: 0
- Unchanged: 9192
- Unknown removals: none
- Changed fields: none

## nid-dams.alabama.2026-10-20

- Predecessor: nid-dams.alabama.2026-10-19
- Command: `python data/pipeline/diff.py nid-dams.alabama.2026-10-19 nid-dams.alabama.2026-10-20` (diff.py 0.1.0, exit 0, run 2026-10-20)
- Records: 2253 -> 2253
- Added: 0
- Removed: 0 (publisher-status 0, our-rule 0, id-churn 0, unknown 0)
- Changed: 2253
- Unchanged: 0
- Unknown removals: none
- Changed fields: place.countyFips 2253, place.method 2251

## nid-dams.texas.2026-10-20

- Predecessor: nid-dams.texas.2026-10-19
- Command: `python data/pipeline/diff.py nid-dams.texas.2026-10-19 nid-dams.texas.2026-10-20` (diff.py 0.1.0, exit 0, run 2026-10-20)
- Records: 7415 -> 7415
- Added: 0
- Removed: 0 (publisher-status 0, our-rule 0, id-churn 0, unknown 0)
- Changed: 7409
- Unchanged: 6
- Unknown removals: none
- Changed fields: place.countyFips 7409, place.method 7409

## nrhp-listed.alabama.2026-10-20

- Predecessor: nrhp-listed.alabama.2026-10-19
- Command: `python data/pipeline/diff.py nrhp-listed.alabama.2026-10-19 nrhp-listed.alabama.2026-10-20` (diff.py 0.1.0, exit 0, run 2026-10-20)
- Records: 913 -> 913
- Added: 0
- Removed: 0 (publisher-status 0, our-rule 0, id-churn 0, unknown 0)
- Changed: 913
- Unchanged: 0
- Unknown removals: none
- Changed fields: place.countyFips 913, place.method 913

## nrhp-listed.texas.2026-10-20

- Predecessor: nrhp-listed.texas.2026-10-19
- Command: `python data/pipeline/diff.py nrhp-listed.texas.2026-10-19 nrhp-listed.texas.2026-10-20` (diff.py 0.1.0, exit 0, run 2026-10-20)
- Records: 2830 -> 2830
- Added: 0
- Removed: 0 (publisher-status 0, our-rule 0, id-churn 0, unknown 0)
- Changed: 2830
- Unchanged: 0
- Unknown removals: none
- Changed fields: place.countyFips 2830, place.method 2824
