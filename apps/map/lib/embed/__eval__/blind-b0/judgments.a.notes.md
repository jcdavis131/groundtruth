# Rater a notes, B0 fresh set

Read only `judge-task.md` and `pool.jsonl`. Did not open pool-map, writer, or any gods-eye-view folder.

## Policy choices applied uniformly

**Right kind, wrong state, on a sub-state query.** Graded 1 per the scale's definition ("the right kind of thing in the wrong place"). So Colorado and California wildfire records both get 1 under "wildfire risk for placerville" and "wildfire risk near pittsburgh"; Maryland, Ohio and Washington impaired waters all get 1 under "polluted waters around puget sound". I did not spread grades to add discrimination.

**Place match on an unrelated kind.** Grade 1 requires the record to be related first. "Ohio School for the Deaf" under "hazardus waste sites in ohio" is 0, not a place-match 1. Montana hospitals under "reservations in montana" are 0. Leaking-tank counties in Texas under "toxic release facilities in texas" are 1 because both are EPA pollution-release datasets and the state matches.

**Related kind with no compensating match.** When the kind is only loosely related and nothing else matches, 0: leaking-tank counties under "factories that report toxic chemical releases", FUDS properties under "brownfields". When the relation is close and nothing shown contradicts, 1: SEMS under "brownfield sites in detroit", FUDS properties under "high priority munitions sites", FUDS properties in NJ under "superfund sites in new jersey", levee-reduced flood zones under "levees along the missouri river", the long-term-care hospital under "nursing homes", impaired waters under "drinking water violations".

**Match-nothing queries (rule 5).** house prices, flights, ISS, weather radar, ships, gas stations near me, fire stations, palace of the governors, olentangy river: all pairs 0. Historic buildings in Santa Fe do not answer house prices; KC hospitals with helipads do not answer flights; fire-protection ponds are not fire stations.

**Missing field, don't punish (rule 3).** Wetlands with no state under "wetlands in north dakota" and "wetlands mapped before 1990", flood zones with no place under "galveston flood zones", LUST counties under "counties with open leaking tank cases", SEMS under "superfund sites on the national priorities list", TRI under "toxic release facilities in texas", RCRA under "hazardus waste sites in ohio", munitions response sites under "high priority munitions sites": 2 unless something shown contradicts. One rule-7 downgrade: estuarine/marine wetlands (p0541, p0575) cannot be in landlocked North Dakota, so 1.

**Shown condition differs, at most 1.** All "superfund sites at federal facilities" pairs say "Not a Federal Facility": 1. "Deleted from the Final NPL" under the NPL query: 1 (but 2 under plain "superfund sites" and "superfund sites in new jersey", which set no status). Helipad no: 1. Charter No: 1. Public schools under "private schools in columbus": 1. Munitions response sites at investigation or cleanup under "already closed out": 1; at closeout: 2. Zone X 0.2% under "100 year flood zone": 1. Munitions response site at closeout under "high priority munitions sites": 1 (closed-out is not high priority).

**"Very high" wildfire risk cutoff.** 90th percentile and above (bands "90 to 95" and "95 or more") is 2. Everything below is 1 (right kind, wrong value), including "under 40". The risk-rank field is the one judged; burn-probability rank was not used to lift a grade.

**Named-entity queries** (childrens mercy hospital kansas city, alleghany general hospital, folsom dam, tuttle creek dam, upper arlington high school, fort sumter, palace of the governors, everglades national park, rocky mountain national park, navajo nation, olentangy river). The kind of thing is the named entity. Same collection elsewhere with no distinctive name overlap and no place match shares only a category: 0 (dams in California under "tuttle creek dam", children's hospitals in Pittsburgh under "childrens mercy hospital kansas city", Montana general hospitals under "alleghany general hospital", Everglades under "rocky mountain national park", NRHP buildings in DC under "palace of the governors"). Same collection with the entity's city or state: 1 (Kansas City hospitals, Pittsburgh-area hospitals, Upper Arlington elementary and middle schools, Rocky Flats refuge in Colorado). Exact entity: 2.

**Name-overlap-plus-same-place records that are not the entity itself.** "Everglades National Park Expansion" (p0463) is 2: the name contains the whole query, it is designated National Park in Florida, and it is part of the same park. "Folsom Dike 1..8" and "Folsom Mormon Island Auxiliary Dam" are 1: Folsom structures in the same project, but not Folsom Dam. "Everglades and Francis S. Taylor WMA" is 1. "CHILDREN'S MERCY HOSPITAL KANSAS" in Overland Park (p0377) is 1 by rule 4: the text shows a different city than the one the query names.

**Collection-synonym queries.** "census tribal areas" and "indian reservations" match the BIA trust land collection: 2. "old military bases" and "former military sites" match the FUDS collections (properties and munitions response sites): 2 when no status condition fails. "navajo nation": Navajo, Navajo (Alamo) and Navajo (Ramah) trust lands are all Navajo Nation land: 2.

**"public lands near denver".** Colorado PAD-US records: 1 (state only, Denver not shown). Florida records (private agricultural easement, Native American land area): 0, wrong state and not public land.

**"places to hike and camp on public land".** Open-access BLM land (p0406): 2. Closed easements and the Florida tribal land area: 1 (in the collection, but closed or not public). Trust land: 0.

## Pair-level doubts

- p0001 and the other "census tribal areas" pairs: BIA trust land is not the Census AIANNH product, but it is the only tribal-area collection on the site and the kind matches. Gave 2.
- p0360: munitions response site at closeout under "where might there be unexploded bombs". No explicit status in the query; gave 2. A stricter reader could argue 1.
- p0645: hospital at Malmstrom AFB under "old military bases". The record is a hospital at an active base, not an old base. Gave 0.
- p0377: see above, 1 by rule 4 even though it is a Children's Mercy facility.
- p0463 vs the Folsom dikes: see above for why one is 2 and the others are 1.
- p0014, p0652, p0567, p0636, p0630: burn-probability rank is higher than the risk rank. Judged on the risk rank only.
