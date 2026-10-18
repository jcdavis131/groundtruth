# Writer note: blind-b0 query set

Written 2026-10-18T18:57:26Z by claude-fable-5-1, session 0c2607d0-340d-4849-8757-d708aae21104.

## Files read

1. `C:\Users\jcdav\writeups\panel-2026-10-18b\b0\blind-b0\writer\BLIND-WRITER-PROMPT.md` (the task).
2. `C:\Users\jcdav\writeups\panel-2026-10-18b\b0\blind-b0\writer\CORPUS-DESCRIPTION.md`. Its sha256 was computed with a one-shot `sha256sum` shell command (through the Monitor tool, the only shell available in this session) and came back `3bd39548c5a37a5695a2ebbac776e834098de7a842df68311ef0736b6aab8d6a`, matching the prompt.

No other file was opened. No search was run against the site or its API, and no query was tested anywhere. Nothing under `panel-2026-10-18b\b0\` outside this `writer` folder, nothing named blind, records-eval or search-eval, and no `gods-eye-view*` folder was touched.

## Other context I was shown without opening anything

So the parent can judge contamination risk:

- The session start injected a "mistake ledger" of 53 entry headings (one-line titles about shell pipes, git, Windows traps and so on). None mention eye, records, queries or scores.
- The harness attached a git status snapshot of the writeups repo. It names sibling folders only by name (for example `panel-2026-10-18/`, `eye-embeddings-2026-10-16/`, `eye-collections-2026-10-18/`, `eye-layers-2026-10-12/`, `status-2026-10-18/`) and five recent commit subjects about an unrelated "cds" writeup. No contents were shown.
- A HawkScan security-scan notice (irrelevant, not used).
- An "advisor" reviewer model was consulted twice. It sees this session's transcript, which contains only the two allowed files and my draft; it gave no corpus information. On its advice I changed one topical query from "old military sites still being cleaned up" to "old military bases" so the topical query carries no status value.

## Validation of `queries.blind.json`

- A Python check (parse, counts, id order, duplicate and length rules) was blocked by a shell permission prompt with no one present to approve it, so those rules were checked by reading the file I wrote: 60 entries, ids `f001`..`f060` in order, 12 per type, no duplicate text after lowercasing and stripping punctuation, every query between 10 and 47 characters, all lower case.
- A `file` and `wc` one-shot confirmed: "JSON text data" with no CRLF line terminators reported (so LF), 68 lines, 60 `"q":` lines.
- The files were not hashed or edited after writing.

## How I chose each type

- **known-item:** a named public thing that plausibly sits inside one of the described map boxes (a dam in the Flint Hills or Sierra foothills, a Pittsburgh or Kansas City hospital, a Columbus-area high school, Charleston and Santa Fe landmarks, a Front Range and an Everglades park, a Columbus river, a Sierra foothills town for wildfire rank) plus one national trust-land name. One is deliberately misspelt. I do not know which items are actually loaded; every one is a guess from the areas.
- **topical:** one plain-language kind of thing per collection for the collections whose records are "captured sample" with no described location (Superfund, TRI, RCRA, Brownfields, FUDS properties and munitions sites, LUST, trust land), plus wetlands, impaired waters, flood zones and public lands. No place, no value.
- **attribute:** a kind plus one property the description says the collection carries: hazard potential, helipad, charter status, imagery year, NHL flag, NPL status, federal-facility flag, FUDS status, munitions priority, open LUST releases, the 1% flood zone, wildfire rank. Worded in plain terms where I could ("100 year flood zone", "very high wildfire risk"), one as a full question, one misspelt.
- **place:** a kind plus a city, state or region. Eight use areas the description names (Columbus, North Dakota, Charleston, Puget Sound, Denver, Galveston, Pittsburgh, Montana); four use places it does not name (New Jersey, Texas, Ohio for hazardous waste, Detroit), chosen for the EPA collections whose locations are undescribed. One misspelt.
- **negative:** seven near misses that sit next to a loaded collection without being in it (private schools next to public schools, nursing homes and fire stations next to hospitals, levees next to dams, drinking water violations next to EPA layers, gas stations next to tank-leak counts, census tribal areas which the description says are not loaded) and five far misses the description lists as not in the record set (flights, ships, weather, prices, a satellite).

Misspellings: 4 of 60 (f016, f030, f038, f052).

## Queries aimed per collection (my intent only)

| Collection | Aimed |
|---|---:|
| Dams | 3 |
| Hospitals | 3 |
| Public schools | 3 |
| NWI wetlands | 3 |
| NRHP listed properties | 4 |
| Superfund sites (SEMS) | 2 |
| TRI reporters | 2 |
| RCRA handlers | 2 |
| Brownfields | 2 |
| Superfund site boundaries | 2 |
| FUDS properties | 2 |
| FUDS munitions response sites | 2 |
| LUST releases by county | 2 |
| Impaired waters | 3 |
| PAD-US protected areas | 4 |
| FEMA flood zones | 3 |
| Wildfire risk to communities | 3 |
| BIA trust land | 3 |
| total (known-item, topical, attribute, place) | 48 |

## Things I was unsure of

- "superfund sites" (f043) is aimed at the 1-record SEMS collection but will plausibly land on the 54 Superfund boundary records too; the two collections overlap in meaning. Same for "superfund sites in new jersey" (f015).
- "olentangy river" (f056) is a guess against a 4-record Columbus slice of impaired waters; it may not be loaded at all.
- "wildfire risk for placerville" (f021) assumes the Sierra foothills box reaches Placerville; the box's extent is not described.
- "reservations in montana" (f055) and "hospitals"-adjacent Montana coverage: the description says "central-montana" without naming a town, so no Montana known-item was attempted.
- "census tribal areas" (f059) is a negative only because the description says Census tribal statistical areas are on a different layer; a searcher might consider BIA trust land a fair answer.
- "drinking water violations" (f049) is treated as a near miss; if any loaded EPA collection carries drinking-water fields it would stop being negative.
- Whether a county-level LUST record can answer "leaking undergound gas tanks" (f038) depends on how the county rows are worded, which I have not seen.
- The TRI and RCRA collections carry only ids per the description, so their queries test the kind of facility only; I could not write an attribute query for them.
