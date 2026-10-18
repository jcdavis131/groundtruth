# Judge task: blind search eval pool

You are grading how relevant a record is to a search query typed into a map site's search box. The site shows public records from 18 collections, among them dams, hospitals, public schools, wetlands, historic places, EPA facility and cleanup lists, defense sites, impaired waters, protected areas, flood zones, wildfire risk and trust land.

## What you read

Read only `pool.jsonl` in this folder. Each line is one pair:

```json
{"id": "p0001", "query": "...", "text": "..."}
```

- `query` is what someone typed.
- `text` is the record's whole indexed string, as `field: value; field: value`. It is all the search engine knows about the record. It carries no name or ID.

**Do not open** `pool-map.json`, anything in `blind/`, `pool/`, or any other file in this folder or in `records-eval/`. They hold which system found each pair, the ranks and the scores. Judge only from the query and the text. If you have already seen any of those files, stop and tell the parent; your grades cannot be used.

The pairs are shuffled. Pairs for the same query are not next to each other, and their order means nothing. Several pairs may share a query. Grade each one on its own; do not compare the records for a query against each other or try to spread grades out.

## The scale

| Grade | Meaning |
|---|---|
| **2 relevant** | The record is the kind of thing the query asks for and matches every condition in the query that the text can show. A user who typed the query would be glad to see it. |
| **1 partly** | The record is related but misses part of the request: the right kind of thing in the wrong place or with the wrong attribute, or the right place or attribute on a different kind of thing. A user might click it but would not call it an answer. |
| **0 not relevant** | Unrelated, or it only shares a word with the query. |

Rules, so both raters apply the same ones:

1. **Intent over spelling.** Read a misspelled or abbreviated query as what the person clearly meant ("hospitls" is "hospitals").
2. **Kind of thing first.** If the query names a kind of thing (dams, schools, wetlands, Superfund sites) and the record is a different kind, it is at most 1, and 0 when the only link is a shared word.
3. **Conditions the text can show.** If the query sets a condition (a value, a level, a year, a range, a status) and the text shows a different value, it is at most 1. If the text has no field for that condition at all, judge on the rest and do not punish the missing field below 1.
4. **Place.** The text usually has only a state (sometimes a county or a city).
   - A query naming a state: a record of the right kind in that state is 2; in another state is at most 1.
   - A query naming something smaller or fuzzier than a state (a city, a county, a region such as "eastern Oregon"): a record of the right kind whose text shows that exact city or county is 2. One whose text shows only the right state is 1. One in another state is 0 or 1 by rule 2 on the rest.
   - A query naming a larger region ("the Southwest", "New England"): a record of the right kind in a state plainly inside it is 2.
5. **Queries that should match nothing.** Some queries ask for something no collection here holds (live events, people, things outside these collections). Grade them like any other pair. Most of their pairs will be 0; give a 1 or 2 only if the text really answers the query.
6. **Numbers.** "Built before 1900", "after 1990", "class 3": read the text's value literally. A value just outside the range is at most 1.
7. **No outside knowledge of the specific record.** Judge from the text. General knowledge is fine (that Arizona is in the Southwest, that a Class 1 site is usually the most serious).

When unsure between two grades, pick the lower one and keep going. Do not leave a pair ungraded.

## What you write

Grade every pair in the file; both raters grade the full set so agreement (kappa) can be measured on all of it. Work alone: do not see the other rater's file.

Write one line per pair, in any order, to `judgments.<rater>.jsonl` in this folder (`<rater>` is `a` or `b` as the parent assigns):

```json
{"id": "p0001", "grade": 2}
```

`grade` is 0, 1 or 2. Nothing else on the line: no notes, no reasons. If you want to record doubts, put them in `judgments.<rater>.notes.md`, by pair id. When done, report the number of lines written and the count of each grade.
