# Writer note (blind-c top-up, writer2)

## Files read

- `C:\Users\jcdav\writeups\panel-2026-10-18b\gate\blind-c\writer2\WRITER-PROMPT.md` (the task)
- `C:\Users\jcdav\writeups\panel-2026-10-18b\gate\blind-c\writer2\CORPUS-DESCRIPTION.md` (sha256 checked: `3bd39548c5a37a5695a2ebbac776e834098de7a842df68311ef0736b6aab8d6a`, matches)

Nothing else was opened. No search was run, no site or API was visited, and the `writer\` folder was not opened.

Context I was shown without asking: the harness's task text naming these paths, and the session's auto-memory index (a list of one-line notes on the user's projects, including one line about eye's layers and merged PRs). That line names some layer topics and a few facility names; I did not use it to pick queries, and every query here comes from the description's collection list and map areas. The memory text named one hospital in passing; no query uses it.

## How each type was chosen

- **known-item:** a well-known public thing that plausibly sits inside one of the named map areas (Folsom Dam in the Sierra foothills, UPMC Presbyterian in Pittsburgh, Rainbow Row in Charleston, Rocky Mountain Arsenal refuge on the Front Range, a Columbus high school) or in the national trust-land set (Navajo Nation). I don't know whether any of them is loaded.
- **topical:** a plain-words name for the kind of thing in a collection held only as captured samples (tank leaks, Superfund, TRI, FUDS, munitions, brownfields), avoiding agency terms where a person wouldn't use them; one is a full question.
- **attribute:** a kind of thing plus a field the description says the collection carries (hazard potential and emergency action plan, trauma level, charter status and enrollment, TMDL, NPL status and federal-facility flag, NHL flag and listing date).
- **place:** a kind of thing plus a place; three use the named boxes (Galveston, Chesapeake, Santa Fe), one a city inside a box (Boulder), and two use places the description does not name (Ohio for RCRA, Arizona for trust land). One has a misspelling (galvaston).
- **negative:** three near misses next to a loaded collection (private schools vs public schools, active fires vs wildfire risk ranks, air monitors vs the EPA layers, nursing homes vs hospitals) and two far from all of them (flights, gas prices), both of which the description's "what is not loaded" covers.

## Intended collection per query (types 1-4)

| Collection | Queries | Count |
|---|---|---:|
| Dams | d002, d005 | 2 |
| Hospitals | d006, d009 | 2 |
| Public schools | d014, d026 | 2 |
| Wetlands | d008 | 1 |
| National Register | d011, d029 | 2 |
| Superfund sites (EMEF) | d007 | 1 |
| TRI reporters | d017 | 1 |
| RCRA handlers | d018 | 1 |
| Brownfields | d027 | 1 |
| Superfund boundaries | d024 | 1 |
| FUDS properties | d012 | 1 |
| FUDS munitions sites | d022 | 1 |
| Leaking USTs by county | d001 | 1 |
| Impaired waters | d019 | 1 |
| PAD-US | d016, d023 | 2 |
| Flood hazard zones | d003 | 1 |
| Wildfire risk | d013 | 1 |
| Trust land (BIA LAR) | d021, d028 | 2 |

## Unsure of

- d007 "superfund sites" will also match Superfund boundaries; I aimed it at the EMEF collection, but the two overlap by design.
- d016 Rocky Mountain Arsenal is also a former Army site and a Superfund site; I aimed it at PAD-US (Front Range box), but it may sit in other collections too.
- d012 "old army bases" may also pull FUDS munitions sites.
- d020 "nursing homes" is a near miss to hospitals; some hospital records could have a long-term-care type, so it is the least certain negative.
- d015 "air quality monitoring stations" might weakly match TRI or RCRA facility text.
