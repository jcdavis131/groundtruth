# Glossary

What our words mean. Each meaning is taken from how eye ([gods-eye-view](https://github.com/jcdavis131/gods-eye-view)) uses the word today; the file named after "In eye" is where to check it. Use these words in contract columns, tool descriptions and docs, and add a term here before giving an old word a new meaning.

**Source.** A public upstream we relay or compute from, such as an agency's API or a published file. It has a stable id, a name, a publisher, a URL and its licence or terms. The licence belongs to the source, never to a collection. In eye: `SourceRef` in `lib/provenance/types.ts`; the entries are in `lib/provenance/sources.ts`.

**Provenance.** Where one value came from: its source, the upstream series or URL, the period it describes, when the upstream released it, when we fetched it, and its kind. The kind is `published` (relayed as is), `estimate` (computed by us from published values, with the method) or `snapshot` (our own observation of a live feed). Caveats a reader must see travel with it. A citation line is printed from it. In eye: `Provenance` in `lib/provenance/types.ts`.

**Record.** One item a collection holds: a point, a polygon, a pixel class or a table row, as the source published it. A record carries its provenance. What one record means, and what it doesn't, is stated on its card. In eye: `recordIs` on each entry of `lib/catalog/collections.ts`; record text for embedding is built only in `lib/catalog/recordText.ts`.

**Collection.** A curated set of records from one or more sources, drawn by one layer. It says what a record is, what it covers (place, time, a dated count), how current it is and where that was read, what is left out and why, what may be searched or embedded, and how sensitive locations and personal data are handled. Its id is kebab-case and never reused. In eye: `Collection` in `lib/catalog/collections.ts`.

**Card.** A collection's entry in the catalogue, the page a person or a program reads about it. One card per collection, sharing the collection's id, so eye's code uses "card id" and "collection id" for the same thing. A card's own prose can be embedded; its sensitivity line, caveats and exclusions are not. In eye: `lib/catalog/collections.ts`, served at `/api/catalog` and listed at `/catalog`.

**Shelf.** A group of layers whose cards sit together on the catalogue page, such as Water or Hazards and risk. It is presentation only and says nothing about the records. In eye: `SHELVES` in `lib/catalog/collections.ts`.

**Layer.** What the map draws and switches on and off. A layer fetches from its sources and hands the globe GeoJSON; a layer can draw one or more collections. In eye: `LayerDefinition` in `lib/layers/types.ts`.

**Snapshot.** Eye uses it in three related senses. All three mean a dated observation, not a history:
- a provenance kind: our own observation of a live feed, as against a published value or an estimate (`lib/provenance/types.ts`);
- a place export in `static` form: one value per place as of one date (`meta.asOf`), never carried across years (`lib/catalog/placeExport.ts`);
- a feed snapshot: counts and published readings sampled from live feeds on a schedule and committed as small series files (`docs/SNAPSHOTS.md`).

**Tower.** A group of place-level features, such as Superfund sites per county per year, handed to vector-places, the county and metro-year place embedding. Eye's place exports are candidate towers. A tower must earn its place on the bench like any other, with at least half its values observed. In eye: `lib/catalog/placeExport.ts` and `docs/place-towers.md`.

**Mask.** The flag that says whether a value was observed. Mask 0 means unknown: the value is null (NaN in a table) and carries its reason, never a 0 or a guess. A true 0 is claimed only where the source is a complete census for that place, and the export says so in its zero rule. In eye: `nullPlaces`, `nullCells` and `meta.zeroRule` in `docs/place-towers.md`.
