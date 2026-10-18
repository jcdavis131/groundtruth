# The eye records corpus: what is loaded (description for a blind query writer)

eye.jcamd.com is a public 3D globe of US public-data layers. Its search palette can find loaded records "by meaning". This is the set of records that will be searched in the eval: 4,067 records from 18 collections, loaded from a few map areas plus some captured sample rows.

This file holds only what the public catalogue says about each collection and how many records are loaded where. It does not hold any record's text, field values, ids or names.

Map areas are named by the box they were pulled from (for example `pittsburgh-pa` is a box around Pittsburgh, Pennsylvania). A "captured sample" is a set of rows kept as test fixtures; where those rows are is not described here.

| Collection | Records loaded | Where |
|---|---:|---|
| Dams (USACE National Inventory of Dams) | 277 | captured sample (locations not described) 6, pittsburgh-pa 84, flint-hills-ks 120, sierra-foothills-ca 67 |
| Hospitals (HIFLD, FEMA's copy) | 125 | captured sample (locations not described) 17, pittsburgh-pa 37, kansas-city-mo 50, central-montana 21 |
| Public schools (NCES EDGE, school year 2024-25) | 262 | captured sample (locations not described) 11, columbus-oh 206, santa-fe-nm 34, dodge-city-ks 11 |
| National Wetlands Inventory polygons | 562 | captured sample (locations not described) 14, chesapeake-md 148, prairie-nd 400 |
| National Register of Historic Places, listed properties | 183 | captured sample (locations not described) 60, charleston-sc 81, santa-fe-nm 42 |
| Superfund sites (EPA EMEF, SEMS) | 1 | captured sample (locations not described) 1 |
| Toxics Release Inventory reporters (EPA EMEF) | 117 | captured sample (locations not described) 117 |
| RCRA hazardous-waste handlers (EPA EMEF, RCRAInfo) | 617 | captured sample (locations not described) 617 |
| Brownfields properties (EPA EMEF, ACRES) | 24 | captured sample (locations not described) 24 |
| Superfund site boundaries (EPA) | 54 | captured sample (locations not described) 54 |
| Formerly Used Defense Sites: properties (USACE FUDS) | 126 | captured sample (locations not described) 126 |
| Formerly Used Defense Sites: munitions response sites (USACE FUDS) | 11 | captured sample (locations not described) 11 |
| Leaking underground storage tank releases by county (EPA UST Finder) | 57 | captured sample (locations not described) 57 |
| Impaired waters (EPA ATTAINS, 303(d)) | 26 | captured sample (locations not described) 2, columbus-oh 4, puget-wa 20 |
| Protected areas and public lands (USGS PAD-US 4.1) | 343 | front-range-co 300, everglades-fl 43 |
| Flood hazard zones (FEMA National Flood Hazard Layer) | 393 | galveston-tx 274, kansas-city-mo 119 |
| Wildfire risk to communities, community ranks (USDA Forest Service, 2nd edition, 2024) | 554 | captured sample (locations not described) 23, sierra-foothills-ca 81, santa-fe-nm 96, pittsburgh-pa 344, central-montana 10 |
| Trust land: BIA American Indian and Alaska Native Land Area Representation | 335 | captured sample (locations not described) 335 |

## Dams (USACE National Inventory of Dams)

- **What the collection holds:** Dams in USACE's National Inventory of Dams public service: NID id, hazard potential with its meaning, the regulator's condition assessment and its date, purposes, dam type, height, storage, surface and drainage area, year completed, river, county, state, owner type, emergency action plan, operational status and the record's update date.
- **A record is:** A dam as NID lists it. Hazard potential is the damage a failure would cause downstream, not the dam's condition or how likely it is to fail.
- **Loaded:** 277 records (captured sample (locations not described): 6; pittsburgh-pa: 84; flint-hills-ks: 120; sierra-foothills-ca: 67).

## Hospitals (HIFLD, FEMA's copy)

- **What the collection holds:** Every hospital in HIFLD's hospital layer as FEMA's Resilience Analysis and Planning Tool last copied it: open hospitals nationally from orbit with a short record (name, type, status, beds, trauma level, city, state, county FIPS), and below 300 km the full record: address, beds, trauma level, helipad, owner type, NAICS industry, the state licensing source with its date, and the date HIFLD checked the location against imagery.
- **A record is:** A licensed hospital as its state licensing source published it on the date shown, which can be years old. Not a list of emergency departments, and not a measure of capacity today.
- **Loaded:** 125 records (captured sample (locations not described): 17; pittsburgh-pa: 37; kansas-city-mo: 50; central-montana: 21).

## Public schools (NCES EDGE, school year 2024-25)

- **What the collection holds:** Every public school in NCES's 2024-25 administrative data (the Common Core of Data directory and membership), as points below 25 km inside the civic box: name, district, grades, level, school type, charter and virtual status, locale, enrollment, free or reduced-price lunch, FTE teachers and the student-teacher ratio as NCES publishes them, with a link to NCES's own page for the school.
- **A record is:** A public school as its state reported it to NCES for 2024-25; enrollment is the October count. A full virtual school's point is its administrative address, not where students are. A negative value is one of CCD's reporting codes, never 0.
- **Loaded:** 262 records (captured sample (locations not described): 11; columbus-oh: 206; santa-fe-nm: 34; dodge-city-ks: 11).

## National Wetlands Inventory polygons

- **What the collection holds:** USFWS's map of wetland and deepwater habitat, one polygon per mapped unit, each with its Cowardin code decoded locally into its system, subsystem, class and water regime names and the year of the imagery it was drawn from (NWI Data_Source).
- **A record is:** A habitat polygon mapped from aerial imagery of a given year. It is not a jurisdictional (Clean Water Act) delineation and does not say the area is wet today.
- **Loaded:** 562 records (captured sample (locations not described): 14; chesapeake-md: 148; prairie-nd: 400).

## National Register of Historic Places, listed properties

- **What the collection holds:** Properties listed on the National Register as NPS publishes them in its public, non-restricted spatial data: points for every listing it maps, and boundaries for districts and sites, each with its NRIS reference number, resource type, NHL flag, listing date and National Archives nomination link.
- **A record is:** A listing on the National Register: a property NPS has listed, at the location NPS publishes. Absence is not absence on the ground.
- **Loaded:** 183 records (captured sample (locations not described): 60; charleston-sc: 81; santa-fe-nm: 42).

## Superfund sites (EPA EMEF, SEMS)

- **What the collection holds:** Superfund sites as EPA's Envirofacts EMEF map service publishes them (layer 0, program system SEMS), each with its EPA program id, FRS registry id and EPA facility page.
- **A record is:** A Superfund program listing at EPA's facility coordinates. A regulatory status, not a finding of contamination at the point.
- **Loaded:** 1 records (captured sample (locations not described): 1).

## Toxics Release Inventory reporters (EPA EMEF)

- **What the collection holds:** Facilities that report to the Toxics Release Inventory, as EMEF layer 1 publishes them, with the TRI facility id (TRIFID), FRS registry id and EPA facility page.
- **A record is:** A TRI reporter: a facility that filed with TRI. The listing alone says nothing about how much was released.
- **Loaded:** 117 records (captured sample (locations not described): 117).

## RCRA hazardous-waste handlers (EPA EMEF, RCRAInfo)

- **What the collection holds:** Handlers of hazardous waste registered in RCRAInfo, as EMEF layer 4 publishes them.
- **A record is:** A RCRA handler registration: a regulatory status, not a finding of contamination.
- **Loaded:** 617 records (captured sample (locations not described): 617).

## Brownfields properties (EPA EMEF, ACRES)

- **What the collection holds:** Brownfields properties in EPA's ACRES system, as EMEF layer 5 publishes them.
- **A record is:** A Brownfields property record: a property in an EPA grant program, not a finding of contamination.
- **Loaded:** 24 records (captured sample (locations not described): 24).

## Superfund site boundaries (EPA)

- **What the collection holds:** Superfund site boundary polygons as EPA regions map them, harvested into EPA_GEO's national layer: site areas, ground boundaries, operable-unit outlines and extents of contamination, each with its EPA ID, NPL status decoded from the layer's own domain, federal-facility flag, EPA program as published, city, county, state and EPA site page, and the site's NPL list row joined by EPA ID (npl-status). Drawn below 10 km, coloured by NPL status.
- **A record is:** One mapped feature of a Superfund site: a regulatory area as an EPA region drew it. Not a contamination footprint. A site can have several overlapping features; they are not merged, and each says how many its site has.
- **Loaded:** 54 records (captured sample (locations not described): 54).

## Formerly Used Defense Sites: properties (USACE FUDS)

- **What the collection holds:** Properties the Department of Defense once used and USACE is responsible for investigating and cleaning up, as USACE's FY2024 FUDS inventory publishes them: every property as a point (layer 1) and, below 10 km, the property's boundary where USACE has drawn one (layer 4), each with its FUDS property number, status, eligibility, county, state, closest city, USACE district, data year, FUDS portal page and its cleanup projects (fuds-projects).
- **A record is:** A property in the FUDS program. A program status, not a finding of contamination at the point; a property with no projects was found to need none or is not eligible.
- **Loaded:** 126 records (captured sample (locations not described): 126).

## Formerly Used Defense Sites: munitions response sites (USACE FUDS)

- **What the collection holds:** Munitions Response Site polygons on FUDS properties (layer 3), with property number, site id, project number, status, program and relative priority. Drawn below 10 km, dashed.
- **A record is:** Where munitions may be present on a former defense property, as USACE maps it. Not a confirmed hazard footprint.
- **Loaded:** 11 records (captured sample (locations not described): 11).

## Leaking underground storage tank releases by county (EPA UST Finder)

- **What the collection holds:** EPA UST Finder's county counts of reported leaking underground storage tank (LUST) releases: total, open, and no further action, with the county's population as the layer gives it. Drawn as county outlines filled by open releases.
- **A record is:** A county's count of reported tank leaks in state records as of 2018-2021. A release is a reported leak; 'no further action' is the state's closure, not proof that no contamination remains. A snapshot, not current status.
- **Loaded:** 57 records (captured sample (locations not described): 57).

## Impaired waters (EPA ATTAINS, 303(d))

- **What the collection holds:** Assessment units that states, territories and tribes report to EPA as impaired (isimpaired = 'Y'): Integrated Report category 4 and 5 stream reaches (lines) and lakes, estuaries and watersheds (areas), each with its category, 303(d) listing, TMDL, reporting cycle, overall status, EPA action status and How's My Waterway page.
- **A record is:** A state's report that a whole assessment unit is impaired, for one reporting cycle. A regulatory listing, not a measured value at a point.
- **Loaded:** 26 records (captured sample (locations not described): 2; columbus-oh: 4; puget-wa: 20).

## Protected areas and public lands (USGS PAD-US 4.1)

- **What the collection holds:** USGS's Protected Areas Database (PAD-US 4.1, Manager Name service) in the four categories the route asks for, fee lands, easements, designations and proclamation boundaries: each unit's owner and owner type, local owner, manager and manager type, designation, GAP status, IUCN category, public access, acres and year established, and for easements the holder and holder type, decoded with the service's own domains.
- **A record is:** A protected-area unit as PAD-US publishes it. Public access is PAD-US's code, not permission to enter; land inside a proclamation boundary is not all public; an easement's owner keeps the land.
- **Loaded:** 343 records (front-range-co: 300; everglades-fl: 43).

## Flood hazard zones (FEMA National Flood Hazard Layer)

- **What the collection holds:** FEMA's regulatory flood hazard zones (NFHL layer 28) in a box below 5 km: zone and subtype with FEMA's own meaning, whether the ground is in the special flood hazard area, the static base flood elevation where FEMA published one, depth and its units and datum, and the FIRM study it comes from (DFIRM_ID, study type). Under the zones, FEMA's own rendering of the same layer as a picture.
- **A record is:** A flood hazard zone on FEMA's regulatory map (FIRM): the 1% annual-chance floodplain and others. Not a forecast, and the absence of a zone is not a finding of no flood risk.
- **Loaded:** 393 records (galveston-tx: 274; kansas-city-mo: 119).

## Wildfire risk to communities, community ranks (USDA Forest Service, 2nd edition, 2024)

- **What the collection holds:** The same ranks for every community (Census place) on WRC's own place polygons, below 150 km in a box of at most 1 degree, at most 1,000 a box; communities USFS excludes are drawn unfilled with USFS's reason.
- **A record is:** A Census place's modelled percentile rank among all US communities (or the state's), by its 7-digit GEOID. A community USFS excludes (no people, no buildings, or DC as a state) has no rank: not ranked, never low.
- **Loaded:** 554 records (captured sample (locations not described): 23; sierra-foothills-ca: 81; santa-fe-nm: 96; pittsburgh-pa: 344; central-montana: 10).

## Trust land: BIA American Indian and Alaska Native Land Area Representation

- **What the collection holds:** BIA's Land Area Representation: the outer extent of land held in trust or restricted fee for federally recognized tribes and individual Indians, compiled from BIA land title records, as one national answer of 335 land areas (reservations, rancherias, pueblos and communities), each with its BIA region, classification code as BIA codes it, and GIS acres. Parts under 0.7 km2 are dropped, except each land area's largest part, which is drawn even when smaller so no land area disappears.
- **A record is:** A land area as BIA names it, held in trust, restricted fee or mixed ownership. For illustrative and reference purposes only: not legal, survey or jurisdictional. Not a Census tribal statistical area (those are on the Field layer).
- **Loaded:** 335 records (captured sample (locations not described): 335).

## What is not loaded

Anything not in the collections above: no flights, ships, satellites, weather, people, businesses, roads, parcels, prices or news are in this record set, even where the globe has other layers for them.
