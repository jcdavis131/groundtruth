# Writer note: blind-c query set

## Files read

- `C:\Users\jcdav\writeups\panel-2026-10-18b\gate\blind-c\writer\WRITER-PROMPT.md` (the task)
- `C:\Users\jcdav\writeups\panel-2026-10-18b\gate\blind-c\writer\CORPUS-DESCRIPTION.md` (sha256 checked: 3bd39548c5a37a5695a2ebbac776e834098de7a842df68311ef0736b6aab8d6a, matches)

Nothing else was opened. No search was run and no site or API was visited. Context I was shown besides those two files: the orchestrator's task text (pointing to WRITER-PROMPT.md) and the user's auto-memory index that the harness attaches to every session. That index names some eye PR history (for example a blind search eval, BM25-gated hybrid) but holds no record text, query text or scores, and I did not use it to choose queries.

## How each type was chosen

- **known-item (14):** guessed real, well-known public things inside the named map boxes (Folsom and Tuttle Creek dams, Pittsburgh and Kansas City hospitals, a Columbus school, a Chesapeake marsh, Charleston and Santa Fe landmarks, a Front Range park and bombing range, a Puget Sound river) plus famous national items for the captured-sample collections (Love Canal, Navajo Nation). I do not know whether any is loaded.
- **topical (15):** one plain-words kind-of-thing per collection ("toxic waste dumps", "leaking gas station tanks", "old military bases"), no place or attribute, two phrased as full questions.
- **attribute (15):** a kind plus a field the description says the collection holds (hazard potential, helipad, trauma level, charter, enrollment, water regime, NHL flag, NPL status, no projects, relative priority, open releases, TMDL, public access, base flood elevation, wildfire rank).
- **place (14):** a kind plus a place, mixing named boxes (Montana, Santa Fe, Chesapeake, Charleston, Seattle, Boulder, Kansas City) with places the description does not name (New Jersey, Texas, Louisiana, Detroit, Alaska, Florida) for the captured-sample collections.
- **negative (14):** near misses next to a loaded collection (private schools, ER wait times, flood forecast, active wildfires, air quality, drinking-water lead tests, tribal census tracts, nuclear plants, parcel owner) and far ones (flights, gas prices, ISS passes, news, earthquake faults).

Misspellings: 4 of 72 ("hosptials", "damn", "jersy", "brownfeilds").

## Unsure of

- Superfund queries could hit both the Superfund sites collection (1 record) and the Superfund boundaries collection; I counted each query toward the one I meant, but they overlap.
- "superfund sites on the national priorities list" I aimed at boundaries (NPL status field); "toxic waste dumps" and "superfund sites in new jersy" at the sites collection.
- "nuclear power plants" may not be a clean negative: such a plant could be a RCRA handler or TRI reporter.
- "earthquake fault lines" and "tribal census tracts" assume no such collection is loaded; the description says census tribal areas are on a different layer.
- "wildfire risk for grass valley" is typed like a known-item (one community) and "lowry bombing range" assumes a FUDS property of that name; both are guesses.
