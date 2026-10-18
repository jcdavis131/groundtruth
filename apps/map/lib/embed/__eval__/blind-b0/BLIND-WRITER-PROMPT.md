# Blind query writer (B0 fresh set): task for a fresh agent

The parent gives this file and `CORPUS-DESCRIPTION.md` (in this folder) to a new agent, and nothing else. That agent must not have seen eye's records, any earlier query set or any scores. This is the same task as the first blind set (blind-1), shortened to 60 queries.

---

You are writing search queries for an evaluation of the search box on eye.jcamd.com, a public 3D globe of US public-data layers. You will write 60 queries a member of the public might type to find records on the map.

## What you may read

Read exactly one other file: `C:\Users\jcdav\writeups\panel-2026-10-18b\b0\blind-b0\writer\CORPUS-DESCRIPTION.md`. Its sha256 must be `3bd39548c5a37a5695a2ebbac776e834098de7a842df68311ef0736b6aab8d6a`. If it is not, stop and say so.

Do not open anything else: nothing under `C:\Users\jcdav\writeups\` outside this `writer` folder (in particular not `panel-2026-10-18b\b0\` itself, `eye-embeddings-2026-10-16\` or anything named blind, records-eval or search-eval), no `gods-eye-view*` folder, not the live site or its API, and no search results. Do not run a search to test a query. The queries must come from the description alone. If you open anything else by mistake, say which file in `WRITER-NOTE.md`; the set will then be thrown away.

## What to write

Write 60 queries, 12 of each type:

| type | what it is | examples of the shape (do not reuse these) |
|---|---|---|
| `known-item` | One specific thing you expect may be loaded, named the way a person would name it. You don't know which items are loaded. Guess plausible ones from the areas listed. | "the big dam near X", "Y county hospital" |
| `topical` | A kind of thing, with no place and no attribute value. | "old mills", "places to hike" |
| `attribute` | A kind of thing plus a property, a category or a number: a status, a type, a level, a year, a range, yes or no. | "dams built before 1950", "schools without a charter" |
| `place` | A kind of thing plus a place: a city, county, state or region. Use the areas the description names, and some places it does not name. | "wetlands in North Dakota" |
| `negative` | Something a person might reasonably type on this site that none of these collections holds. Some should sit close to a loaded collection without being in it (a near miss), and some should be far from all of them. | |

Write them the way the public types: mostly short and lower case, sometimes a full question, sometimes a misspelling (no more than 1 in 10). Use plain words more often than the agencies' terms. Don't copy sentences from the description. Cover all 18 collections across the first four types. Every collection should get at least 2 queries, and no collection more than 8.

**Rules for every query:**

- After runs of whitespace are collapsed to one space, it is 2 to 200 characters long.
- It contains no person's name, email address, phone number or street address. Place names, agency names and the names of public things (a dam, a park, a school, a hospital) are fine.
- No query appears twice, and no query differs from another only in case or punctuation.

Do **not** say which records are relevant, and do not grade anything.

## Output

Write two files, both in `C:\Users\jcdav\writeups\panel-2026-10-18b\b0\blind-b0\writer\`:

1. `queries.blind.json`, UTF-8 with LF line endings, in this shape:

   ```json
   {
     "version": "blind-b0",
     "writtenBy": "<agent or session id>",
     "writtenAt": "<ISO date-time>",
     "descriptionSha256": "3bd39548c5a37a5695a2ebbac776e834098de7a842df68311ef0736b6aab8d6a",
     "queries": [ { "id": "f001", "type": "known-item", "q": "..." } ]
   }
   ```

   The ids run `f001` to `f060`. Shuffle the types so they are not grouped together.

2. `WRITER-NOTE.md`, listing: the files you read (and anything else you were shown as context); for each type, one line on how you chose its queries; anything you were unsure of.

Do not hash or edit the files after writing them; the parent hashes and freezes them.

Report back only: the count by type, the count of queries per collection you aimed at (your own intent, as a table), and the path.
