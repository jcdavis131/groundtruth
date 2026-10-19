# Rater A notes (conventions applied where judge-task.md left a choice)

- Named single entity (Conemaugh dam, Folsom dam, Children's Mercy, Eldorado Canyon SP, Rocky Mtn Arsenal NWR, San Miguel Chapel, Rainbow Row, Columbus Alternative HS, Benefis, UPMC): same kind + right state = 1; wrong state or wrong subtype = 0. Exceptions graded 2: p0823 (FL national park, GAP 1, for Everglades) and p1581 (Kings County NY final-NPL site, for Gowanus).
- Place smaller than a state, right kind but another state: 0. Named state, right kind but another state: 1.
- Condition the text has no field for (old dams with no year, enrollment, place on wetlands/flood-zone records): 1, not 2.
- Different kind that shares only a place: 0 (e.g. p0695 Galveston county record for "flood zones in galveston").
- Unanswerable queries (live events, prices, radon, urgent care open now, tribal casinos, river forecast): all 0.
- Doubtful: p1355/p1006 ACRES = brownfields (graded 2); p0077 MMRP closeout for unexploded ordnance (1); p1008 TRIS with no state, for TRI facilities in Texas (1); AE zones with flood study type NP, for "zone ae with base flood elevation" (1).
