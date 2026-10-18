# Blind writer note (blind-1)

## Files read

- `search-eval/BLIND-WRITER-PROMPT.md` (the task)
- `search-eval/CORPUS-DESCRIPTION.md` (sha256 checked: `3bd39548c5a37a5695a2ebbac776e834098de7a842df68311ef0736b6aab8d6a`, matches)

Other things in view, for the record:
- I ran `ls` on `search-eval/` and `search-eval/blind/`. That showed file names only (LOGGING.md, build-corpus-cards.cjs, corpus-cards.json, render-description.cjs). I did not open any of them.
- The harness handed me, as context, the user's memory index (one line per project, no eye record text) and the parent session's status report. The report describes the retrievers and the logging design. It has no queries, no record text and no scores.
- I did not open the eye repo, `records-eval/`, any earlier query set, the live site or any search results, and I did not run a search.

## How each type was chosen

- **known-item:** real public things (dams, hospitals, schools, landmarks, refuges, parks, reservations, Superfund sites) that could plausibly sit inside the named pull areas, or in the national/captured sets. I don't know whether any of them is loaded.
- **topical:** one plain-words query per collection where possible, without a place or a value. Two each went to TRI, brownfields and munitions, because those collections have few attributes to query on.
- **attribute:** values the catalogue says each collection carries: hazard potential, condition, trauma level, helipad, charter/virtual, enrollment, Cowardin regime, NHL flag, listing date, NPL status, federal facility, project count, open releases, TMDL, GAP status, flood zone/BFE, wildfire percentile, RCRA generator size.
- **place:** most use the named pull areas. Some use places the description doesn't name (New Jersey, Texas, Ohio statewide, Detroit, Alaska, Florida, Boulder) for the captured-sample collections, whose locations aren't described.
- **negative:** about half are near misses next to a loaded collection: private schools, nursing homes, urgent care, active fire, flood forecast, drinking-water lead, radon by county, bridge condition, hunting seasons, tribal casinos. The other half are far from every collection: flights, ships, hurricanes, prices, parcels, restaurants, air quality, nuclear plants, earthquakes, tornado shelters.

## Unsure

- Four deliberate misspellings: `hazardus`, `indian resevations`, `trama`, `chesapeke`.
- `rocky mountain arsenal wildlife refuge` also borders FUDS and Superfund; I aimed it at PAD-US. `love canal` could hit Superfund sites as well as the boundary layer.
- `is my house in a flood zone` is typed as topical, since it has no place or value.
- Spec conflict: the computed task text asked for a 25/25/20/15/15 split and a file at `search-eval/queries.blind.json` with a `query` key. The frozen prompt asks for 20 of each type in `blind/` with a `q` key. I followed the frozen prompt, because the downstream pipeline is built around it.
- The collection tags in my report are my own intent, not relevance grades.
