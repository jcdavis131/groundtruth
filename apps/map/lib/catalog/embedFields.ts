// What may be embedded, per catalogue card: each card's embedText fields (the
// catalogue reads them from here as `embedText: EMBED_TEXT[id]`), the deny
// list, the reviewed *name fields, the label each field is embedded under, and
// which cards' builders attach record text this round.
//
// A leaf module (no imports) so the route builders in lib/permits, lib/land,
// lib/water and lib/infra can import recordText without a cycle through
// collections.ts, which imports their caveats.
//
// Rules that apply to every card (embeddings round 1, 2026-10-16; B0 2026-10-18):
//   a record's text starts with its card's head (RECORD_HEAD: short title and
//     agency), then its public name where PUBLIC_NAME_RULE allows one, then its
//     place (PLACE_FIELD_RANK), then the card's other fields (B0);
//   no other name is embedded: a name that can be a person's or a business's
//     never is, and a private holding labelled by id never is (the palette's
//     letter-by-letter match owns the label-by-id rules);
//   ids are matched by letters, never embedded (NRIS_Refnum, ATTAINS unit ids,
//     CAS numbers, DFIRM_ID, NMFS UNIT, EMEF program and registry ids, FR citations);
//   free text is not embedded (USGS Citation, Wayback NICE_DESC);
//   measured quantities are not embedded (counts, heights, populations,
//     elevations, resolutions); years, dates and published categories are kept.
//   ATTAINS assessmentunitname and organizationname stay out while the allowlist
//   does not search them (embedding would be a side door).

export const EMBED_TEXT = {
  "nwi-wetlands": ["WETLAND_TYPE", "SYSTEM_NAME", "CLASS_NAME", "WATER_REGIME_NAME"],
  "nwi-wetlands-raster": [],
  "nrhp-listed": ["ResType", "Is_NHL", "CertDate", "City", "County", "State"],
  "fws-crithab": ["comname", "sciname", "listing_status", "status", "pubdate"],
  "nmfs-crithab": ["COMNAME", "SCIENAME", "LISTSTATUS", "CHSTATUS", "PUBDATE", "HABTYPE"],
  "opp-ranges": ["Common_Name", "Scientific_Name", "ESA_Listing_Status", "Entity_Description", "Lead_Agency", "Taxonomic_Group"],
  "attains-impaired": ["state", "reportingcycle", "ircategory", "on303dlist", "hastmdl", "cyclestatus"],
  "ucmr5-pfas": ["Contaminant", "State", "Result_At_or_Above_UCMR_MRL", "UCMR_Geolocation_Method"],
  "cws-service-areas": ["Pop_Cat_5", "Service_Area_Type", "Symbology_Field", "Primacy_Agency", "Data_Provider_Type"],
  "emef-sems": ["pgm_sys_acrnm"],
  "emef-tri": ["pgm_sys_acrnm"],
  "emef-rcra": ["pgm_sys_acrnm"],
  "emef-acres": ["pgm_sys_acrnm"],
  "tri-releases": ["cas_chem_name", "environmental_medium", "unit_of_measure", "reporting_year"],
  "npl-boundaries": ["NPL_STATUS_CODE", "FEDERAL_FACILITY_DETER_CODE", "EPA_PROGRAM", "SITE_FEATURE_TYPE", "CITY_NAME", "COUNTY", "STATE_CODE"],
  "npl-status": ["Status", "Proposed_Date", "Listing_Date", "Construction_Completion_Date", "Deletion_Date"],
  "fuds-properties": ["STATUS", "ELIGIBILITY", "CLOSESTCITY", "COUNTY", "STATE", "USACEDISTRICT", "FISCALYEAR"],
  "fuds-projects": ["ENVRESTORATIONCATEGORY", "DERPPROGRAM", "PROJECTSTATUS", "RISKVALUEMRSPP", "OVERLAPPINGFEDERALLANDAGENCY"],
  "fuds-mrs": ["PROJECTSTATUS", "DERPPROGRAM", "RELATIVEPRIORITY"],
  "ust-releases-county": ["County", "State"],
  "ust-facilities-county": ["State"],
  "fema-nfhl-zones": ["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STUDY_TYP"],
  "padus-units": ["Category", "Own_Type", "Mang_Type", "Des_Tp", "State_Nm", "Pub_Access", "GAP_Sts", "IUCN_Cat"],
  "nid-dams": ["PRIMARY_PURPOSE", "PRIMARY_DAM_TYPE", "HAZARD_POTENTIAL", "CONDITION_ASSESSMENT", "COUNTYSTATE", "STATE", "YEAR_COMPLETED"],
  "esri-wayback": [],
  "wayback-capture": ["SRC_DATE", "NICE_NAME"],
  "usgs-htmc": ["Map_Name", "Map_Scale", "DateCurrent", "Imprint_Year", "Survey_Year"],
  "nhd-hydro-picture": [],
  "nldi-trace": [],
  "nhdplus-v21-reach": ["ftype"],
  "nri-counties": ["COUNTY", "STATEABBRV", "RISK_RATNG", "EAL_RATNG", "SOVI_RATNG", "RESL_RATNG", "AVLN_RISKR", "CFLD_RISKR", "CWAV_RISKR", "DRGT_RISKR", "ERQK_RISKR", "HAIL_RISKR", "HWAV_RISKR", "HRCN_RISKR", "ISTM_RISKR", "IFLD_RISKR", "LNDS_RISKR", "LTNG_RISKR", "SWND_RISKR", "TRND_RISKR", "TSUN_RISKR", "VLCN_RISKR", "WFIR_RISKR", "WNTW_RISKR"],
  "nri-tracts": ["STATEABBRV", "RISK_RATNG", "EAL_RATNG", "SOVI_RATNG", "RESL_RATNG", "AVLN_RISKR", "CFLD_RISKR", "CWAV_RISKR", "DRGT_RISKR", "ERQK_RISKR", "HAIL_RISKR", "HWAV_RISKR", "HRCN_RISKR", "ISTM_RISKR", "IFLD_RISKR", "LNDS_RISKR", "LTNG_RISKR", "SWND_RISKR", "TRND_RISKR", "TSUN_RISKR", "VLCN_RISKR", "WFIR_RISKR", "WNTW_RISKR"],
  "nhl-listed": ["ResType", "Is_NHL", "CertDate", "City", "County", "State"],
  "naip-years": ["naip:year", "naip:state", "datetime"],
  "nps-units": ["UNIT_TYPE", "STATE", "REGION"],
  "nps-nha": [],
  "abpp-battlefields": ["WAR", "STATE", "BOUNDARY"],
  "nps-whs": [],
  "places-county": ["statedesc", "category", "measure", "year", "data_value_type"],
  "places-tract": ["category", "measure", "year", "data_value_type"],
  "svi-counties": ["COUNTY", "STATE"],
  "svi-tracts": ["STATE", "COUNTY"],
  "hifld-hospitals": ["TYPE", "TRAUMA", "HELIPAD", "CITY", "STATE"],
  "nces-public-schools": ["SCHOOL_LEVEL", "SCHOOL_TYPE_TEXT", "CHARTER_TEXT", "VIRTUAL", "SY_STATUS_TEXT", "ULOCALE", "GSLO", "GSHI", "LCITY", "NMCNTY", "LSTATE"],
  "fcc-bdc-counties": ["StateAbbr"],
  "fcc-bdc-hex": [],
  "wrc-counties": ["STUSPS"],
  "wrc-communities": ["STUSPS", "RISK_NATIO", "BP_NATIONA", "exclude_re"],
  "bia-lar": ["LARNAME", "REGION"],
  "fema-declarations": ["incidentType", "declarationType"],
  "usdm-county-dsci": [],
  "noaa-cag-county": [],
  "spc-tornado-county": [],
  "hud-hcv-tracts": [],
  "hud-qct": [],
  "usgs-landslide-susc": [],
  "ncei-storm-events-county": [],
  "hud-dda": [],
  "hud-lihtc": [],
  "cms-hospital-ratings": [],
} satisfies Record<string, string[]>;

export type CollectionId = keyof typeof EMBED_TEXT;

/**
 * Field names that must never be searchable or embedded: addresses, contacts, owners,
 * certifiers, free-text descriptions, and names that can be a person's (NRHP RESNAME, EPA
 * primary_name and SITE_NAME, UST Name, a water system's PWS_Name, USACE's FUDS property,
 * site and project names, PAD-US Loc_Own).
 */
export const DENY_FIELD =
  /address|street|zip|postal|contact|phone|email|owner|certif|^primary_name$|^resname$|^name$|^site_name$|^pws_name$|^featurename$|^dodformerlyuseddefensesitename$|^envrestorationprojectname$|^officialsitename$|^featuredescription$|^site_feature_description$|^loc_own$/i;

/** Field names that end in "name" and may be embedded: species and place names, never a person's or a holding's. Reviewed in round 1 of embeddings. */
export const NAME_FIELDS_ALLOWED: ReadonlySet<string> = new Set([
  "SYSTEM_NAME",
  "CLASS_NAME",
  "WATER_REGIME_NAME",
  "Map_Name",
  "NICE_NAME",
  "State_Nm",
  "comname",
  "COMNAME",
  "Common_Name",
  "sciname",
  "SCIENAME",
  "Scientific_Name",
  "cas_chem_name",
  // BIA LAR land area names: all 335 read (reservations, rancherias, pueblos, communities; none a
  // person's). Embedded on Cam's call, 2026-10-17; the one *name field that is also a feature's name.
  "LARNAME",
  // EPA Superfund boundaries' city: a place name (the site's city as EPA publishes it), never a person's (B0, 2026-10-18).
  "CITY_NAME",
]);

/**
 * Place fields, embedded right after the record's head and public name (B0, 2026-10-18), city before
 * county before state. Every one is also in its card's EMBED_TEXT; recordText only moves them forward.
 */
export const PLACE_FIELD_RANK: Readonly<Record<string, number>> = {
  City: 0,
  CITY: 0,
  LCITY: 0,
  CITY_NAME: 0,
  CLOSESTCITY: 0,
  County: 1,
  COUNTY: 1,
  NMCNTY: 1,
  COUNTYSTATE: 1,
  State: 2,
  STATE: 2,
  state: 2,
  STATE_CODE: 2,
  LSTATE: 2,
  State_Nm: 2,
  STUSPS: 2,
  STATEABBRV: 2,
};

/**
 * The head of every record text (B0, 2026-10-18): the card's short title and the agency that
 * publishes it, in plain words a person searches with. Each word comes from the card's own title,
 * what-text or its source's name and publisher (recordText.test.ts checks that), so the head says
 * nothing the catalogue does not. Same for every record of a card.
 */
export const RECORD_HEAD: Readonly<Record<string, { collection: string; agency: string }>> = {
  "nwi-wetlands": { collection: "Wetlands, National Wetlands Inventory", agency: "U.S. Fish and Wildlife Service" },
  "nrhp-listed": { collection: "National Register of Historic Places", agency: "National Park Service" },
  "attains-impaired": { collection: "Impaired waters, 303(d)", agency: "EPA ATTAINS" },
  "emef-sems": { collection: "Superfund sites (SEMS)", agency: "EPA" },
  "emef-tri": { collection: "Toxics Release Inventory reporters", agency: "EPA" },
  "emef-rcra": { collection: "RCRA hazardous-waste handlers", agency: "EPA RCRAInfo" },
  "emef-acres": { collection: "Brownfields properties (ACRES)", agency: "EPA" },
  "npl-boundaries": { collection: "Superfund site boundaries, NPL", agency: "EPA" },
  "fuds-properties": { collection: "Formerly Used Defense Sites, properties", agency: "U.S. Army Corps of Engineers FUDS" },
  "fuds-mrs": { collection: "Formerly Used Defense Sites, munitions response sites", agency: "U.S. Army Corps of Engineers FUDS" },
  "ust-releases-county": { collection: "Leaking underground storage tank releases by county", agency: "EPA UST Finder" },
  "fema-nfhl-zones": { collection: "Flood hazard zones, National Flood Hazard Layer", agency: "FEMA" },
  "padus-units": { collection: "Protected areas and public lands (PAD-US)", agency: "U.S. Geological Survey" },
  "nid-dams": { collection: "Dams, National Inventory of Dams", agency: "U.S. Army Corps of Engineers" },
  "hifld-hospitals": { collection: "Hospitals (HIFLD)", agency: "Homeland Infrastructure Foundation-Level Data, FEMA" },
  "nces-public-schools": { collection: "Public schools", agency: "National Center for Education Statistics (NCES)" },
  "wrc-communities": { collection: "Wildfire risk to communities", agency: "USDA Forest Service" },
  "bia-lar": { collection: "Trust land, Land Area Representation", agency: "Bureau of Indian Affairs (BIA)" },
};

/**
 * Cards whose record text may carry the record's own published name (B0, 2026-10-18), and the rule
 * the builder applies before passing it to recordText as `publicName`. Only cards whose sensitivity
 * line lets the name be searched as an institution's or a public holding's; each builder passes the
 * name it already shows as the feature's label, never a name it labels by id. Cards whose name can
 * be a person's or a business's stay out: NRHP RESNAME, EMEF primary_name, Superfund SITE_NAME, FUDS
 * FEATURENAME, and the WRC Census place name (an exclusion on its card). BIA land areas carry their
 * name as LARNAME, an embedText field, not through this door.
 */
export const PUBLIC_NAME_RULE: Readonly<Record<string, string>> = {
  "hifld-hospitals": "the licensed hospital's published name (an institution's), as its label",
  "nces-public-schools": "the public school's published name (an institution's), as its label",
  "nid-dams": "a dam's published name only when NID publishes an owner type and it is not Private (a private dam is labelled by NID id; a missing owner type is unknown, not public)",
  "padus-units": "a unit's published name only on federal or state land (Own_Type FED or STAT) and never an easement: local, district, joint and NGO units are often acquisitions named for a former owner",
};

/**
 * The words a field is embedded under: static word vectors gain from the field's meaning, not its
 * code. One label per upstream field name, shared by every card that embeds the field, so a field
 * on more than one card must be a place word or stay within one source's family of cards
 * (recordText.test.ts checks it).
 */
export const FIELD_LABEL: Readonly<Record<string, string>> = {
  // NWI (decoded locally from the Cowardin code)
  WETLAND_TYPE: "wetland type",
  SYSTEM_NAME: "wetland system",
  CLASS_NAME: "wetland class",
  WATER_REGIME_NAME: "water regime",
  // NRHP
  ResType: "historic resource type",
  Is_NHL: "national historic landmark",
  CertDate: "listed on the National Register",
  City: "city",
  County: "county",
  State: "state",
  // critical habitat and ranges (click answers; no record vectors this round)
  comname: "species",
  sciname: "scientific name",
  listing_status: "ESA listing status",
  status: "critical habitat status",
  pubdate: "rule published",
  COMNAME: "species",
  SCIENAME: "scientific name",
  LISTSTATUS: "ESA listing status",
  CHSTATUS: "critical habitat status",
  PUBDATE: "rule published",
  HABTYPE: "habitat type",
  Common_Name: "species",
  Scientific_Name: "scientific name",
  ESA_Listing_Status: "ESA listing status",
  Entity_Description: "listed entity",
  Lead_Agency: "lead agency",
  Taxonomic_Group: "taxonomic group",
  // ATTAINS
  state: "state",
  reportingcycle: "reporting cycle",
  ircategory: "impaired water category",
  on303dlist: "on the 303(d) list",
  hastmdl: "has a TMDL",
  cyclestatus: "EPA action status",
  // UCMR 5 and water systems (no record vectors this round)
  Contaminant: "PFAS contaminant",
  Result_At_or_Above_UCMR_MRL: "result at or above the reporting level",
  UCMR_Geolocation_Method: "located by",
  Pop_Cat_5: "population served category",
  Service_Area_Type: "service area type",
  Symbology_Field: "boundary source",
  Primacy_Agency: "primacy agency",
  Data_Provider_Type: "data provider type",
  // EMEF
  pgm_sys_acrnm: "EPA program",
  // TRI (click answer)
  cas_chem_name: "chemical",
  environmental_medium: "released to",
  unit_of_measure: "unit",
  reporting_year: "reporting year",
  // Superfund boundaries and NPL list
  NPL_STATUS_CODE: "NPL status",
  FEDERAL_FACILITY_DETER_CODE: "federal facility",
  EPA_PROGRAM: "EPA program",
  SITE_FEATURE_TYPE: "mapped feature",
  COUNTY: "county",
  STATE_CODE: "state",
  Status: "NPL status",
  Proposed_Date: "proposed to the NPL",
  Listing_Date: "listed on the NPL",
  Construction_Completion_Date: "construction complete",
  Deletion_Date: "deleted from the NPL",
  // FUDS
  STATUS: "FUDS status",
  ELIGIBILITY: "FUDS eligibility",
  STATE: "state",
  USACEDISTRICT: "USACE district",
  FISCALYEAR: "data fiscal year",
  ENVRESTORATIONCATEGORY: "restoration category",
  DERPPROGRAM: "restoration program",
  PROJECTSTATUS: "project status",
  RISKVALUEMRSPP: "risk value",
  OVERLAPPINGFEDERALLANDAGENCY: "overlapping federal land",
  RELATIVEPRIORITY: "relative priority",
  // NFHL
  FLD_ZONE: "flood zone",
  ZONE_SUBTY: "zone subtype",
  SFHA_TF: "special flood hazard area",
  STUDY_TYP: "flood study type",
  // PAD-US
  Category: "protected area category",
  Own_Type: "owner type",
  Mang_Type: "manager type",
  Des_Tp: "designation",
  State_Nm: "state",
  Pub_Access: "public access",
  GAP_Sts: "GAP status",
  IUCN_Cat: "IUCN category",
  // NID
  PRIMARY_PURPOSE: "dam purpose",
  PRIMARY_DAM_TYPE: "dam type",
  HAZARD_POTENTIAL: "hazard potential",
  CONDITION_ASSESSMENT: "condition assessment",
  YEAR_COMPLETED: "year completed",
  COUNTYSTATE: "county",
  // Places added in B0 (2026-10-18): a hospital's and a school's city and county, a Superfund boundary's city, a FUDS property's closest city
  CITY: "city",
  LCITY: "city",
  NMCNTY: "county",
  CITY_NAME: "city",
  CLOSESTCITY: "closest city",
  // Wayback capture metadata (click answer)
  SRC_DATE: "capture date",
  NICE_NAME: "imagery collection",
  // USGS topo sheets (click answer)
  Map_Name: "map sheet",
  Map_Scale: "map scale",
  DateCurrent: "edition year",
  Imprint_Year: "imprint year",
  Survey_Year: "survey year",
  // NHDPlus V2.1 reach (click answer): the NHD feature type as its published word
  ftype: "NHD feature type",
  // FEMA National Risk Index (COUNTY and STATE-like fields reuse the labels above)
  STATEABBRV: "state",
  RISK_RATNG: "composite risk rating",
  // NAIP STAC items (click answer)
  "naip:year": "NAIP year",
  // national heritage (NPS)
  UNIT_TYPE: "NPS unit type",
  REGION: "NPS region",
  WAR: "war",
  // CDC PLACES (CDC's measure wording is a closed vocabulary of 40 published strings)
  statedesc: "state",
  category: "health measure category",
  measure: "health measure",
  year: "data year",
  data_value_type: "value type",
  BOUNDARY: "battlefield survey area",
  "naip:state": "state",
  datetime: "photographed on",
  EAL_RATNG: "expected annual loss rating",
  SOVI_RATNG: "social vulnerability rating (as published in the NRI)",
  RESL_RATNG: "community resilience rating",
  AVLN_RISKR: "avalanche risk",
  CFLD_RISKR: "coastal flooding risk",
  CWAV_RISKR: "cold wave risk",
  DRGT_RISKR: "drought risk",
  ERQK_RISKR: "earthquake risk",
  HAIL_RISKR: "hail risk",
  HWAV_RISKR: "heat wave risk",
  HRCN_RISKR: "hurricane risk",
  ISTM_RISKR: "ice storm risk",
  IFLD_RISKR: "inland flooding risk",
  LNDS_RISKR: "landslide risk",
  LTNG_RISKR: "lightning risk",
  SWND_RISKR: "strong wind risk",
  TRND_RISKR: "tornado risk",
  TSUN_RISKR: "tsunami risk",
  VLCN_RISKR: "volcanic activity risk",
  WFIR_RISKR: "wildfire risk",
  WNTW_RISKR: "winter weather risk",
  // HIFLD hospitals (STATUS is not embedded: FIELD_LABEL has one label per field name, and STATUS is FUDS's;
  // NAICS_DESC is not either: a *desc field is treated as free text, and TYPE already says the kind)
  TYPE: "hospital type",
  TRAUMA: "trauma center level",
  HELIPAD: "helipad",
  // NCES public schools (CCD's published categories; names, the street and the counts are not embedded)
  SCHOOL_LEVEL: "school level",
  SCHOOL_TYPE_TEXT: "school type",
  CHARTER_TEXT: "charter school",
  VIRTUAL: "virtual school status",
  SY_STATUS_TEXT: "school status",
  ULOCALE: "locale",
  GSLO: "lowest grade",
  GSHI: "highest grade",
  LSTATE: "state",
  // FCC BDC via Esri, USFS WRC (state abbreviations are place words, shared freely)
  StateAbbr: "state",
  STUSPS: "state",
  exclude_re: "not ranked by USFS because",
  // USFS WRC community national ranks, embedded as the layer's own bin (WRC_BIN_LABELS: under 40, 40 to
  // 70, 70 to 90, 90 to 95, 95 or more), or "not ranked by USFS"; never the number. RISK_* is named by
  // its alias only (the service does not say whether it is wildfirerisk.org's "Risk to Homes"); BP is
  // burn probability, which wildfirerisk.org calls wildfire likelihood.
  RISK_NATIO: "wildfire risk community, national risk rank",
  BP_NATIONA: "wildfire likelihood (burn probability), national rank",
  // BIA LAR. REGION's shared label is NPS's; bia-lar embeds it under its own card label (CARD_FIELD_LABEL).
  LARNAME: "BIA land area",
  // OpenFEMA declarations (FEMA's published categories, as words; the title and designated area are never embedded)
  incidentType: "incident type",
  declarationType: "declaration type",
};

/**
 * Card-scoped labels, for a field another card already embeds under a label that is wrong for this
 * card (BIA's REGION is not an NPS region). The card's label wins over FIELD_LABEL for that card
 * only, and must differ from every other card's label for the same field (recordText.test.ts).
 */
export const CARD_FIELD_LABEL: Readonly<Partial<Record<CollectionId, Readonly<Record<string, string>>>>> = {
  "bia-lar": { REGION: "BIA trust land area, BIA region" },
};

/** The label a card's field is embedded under: the card's own label, else the field's shared one. */
export function fieldLabel(cardId: CollectionId, field: string): string | undefined {
  return CARD_FIELD_LABEL[cardId]?.[field] ?? FIELD_LABEL[field];
}

/**
 * Cards whose builder attaches record text to each feature (properties.extra.embedText), so
 * the palette can index loaded records by meaning. The rest have no record vectors this
 * round, and why.
 */
export const RECORD_VECTOR_CARDS: ReadonlySet<string> = new Set([
  "nwi-wetlands",
  "nrhp-listed",
  "attains-impaired",
  "emef-sems",
  "emef-tri",
  "emef-rcra",
  "emef-acres",
  "npl-boundaries",
  "fuds-properties",
  "fuds-mrs",
  "ust-releases-county",
  "fema-nfhl-zones",
  "padus-units",
  "nid-dams",
  "hifld-hospitals",
  "nces-public-schools",
  "wrc-communities",
  "bia-lar",
]);

export const NO_RECORD_VECTORS: Readonly<Record<string, string>> = {
  "nwi-wetlands-raster": "a picture of pixel classes; no record",
  "fws-crithab": "a click answer listing species, not a feature on the globe",
  "nmfs-crithab": "a click answer listing species, not a feature on the globe",
  "opp-ranges": "a click answer listing species; ranges are never drawn",
  "ucmr5-pfas": "results are assembled per system from three EPA layers; deferred to the next round",
  "cws-service-areas": "drawn as the PFAS system's geometry; deferred with ucmr5-pfas",
  "tri-releases": "asked from a TRI listing's record; never drawn",
  "npl-status": "joined by EPA ID into the Superfund boundary and point records",
  "fuds-projects": "listed in their property's record; not drawn",
  "ust-facilities-county": "joined into the release county's record",
  "esri-wayback": "a tile set per release; no record",
  "wayback-capture": "a click answer on imagery, not a feature on the globe",
  "usgs-htmc": "a click answer listing sheets, not a feature on the globe",
  "nhd-hydro-picture": "a picture of mapped water; no record",
  "nldi-trace": "computed per click from NLDI; no stored record",
  "nhdplus-v21-reach": "a click answer for one reach, not a feature on the globe",
  "nri-counties": "joined in the browser onto the shared county outlines; record vectors deferred to the next round",
  "nri-tracts": "deferred with nri-counties",
  "nhl-listed": "the same features as nrhp-listed, which carry its record text",
  "naip-years": "a picture and a click answer listing flight dates, not a feature on the globe",
  "nps-units": "record vectors deferred to the next round (the builder attaches none yet)",
  "nps-nha": "the only text is NPS's free-text description, which is not embedded (D-HE2)",
  "abpp-battlefields": "record vectors deferred with nps-units",
  "nps-whs": "names and links only; nothing embeddable",
  "places-county": "joined in the browser onto the shared county outlines; record vectors deferred to the next round",
  "places-tract": "deferred with places-county",
  "svi-counties": "joined in the browser onto the shared county outlines, as nri-counties; record vectors deferred to the next round",
  "svi-tracts": "deferred with svi-counties",
  "fcc-bdc-counties": "joined in the browser onto the shared county outlines, as svi-counties; record vectors deferred to the next round",
  "fcc-bdc-hex": "hexagon rows carry no text, only counts and an H3 id",
  "wrc-counties": "joined in the browser onto the shared county outlines, as svi-counties; record vectors deferred to the next round",
  "fema-declarations": "dossier series and a declaration list for one county; no record is drawn on the globe, so its embedText describes the card only",
  "usdm-county-dsci": "dossier series; one county's numbers, no record text",
  "noaa-cag-county": "dossier series; one county's numbers, no record text",
  "spc-tornado-county": "dossier series baked from SPC's file; one county's counts, no record text",
  "hud-hcv-tracts": "tract numbers only; no record text",
  "hud-qct": "tract numbers only; no record text",
  "usgs-landslide-susc": "picture layer; county shares are dossier numbers",
  "ncei-storm-events-county": "dossier series baked from NCEI's files; one county's counts, no record text",
  "hud-dda": "a designation outline; names and codes only",
  "hud-lihtc": "record vectors deferred: records-eval is pinned on 18 cards and would need re-measuring (D8-2)",
  "cms-hospital-ratings": "joined by address into the HIFLD hospital's click, as npl-status joins by EPA ID; the hifld-hospitals record text is unchanged, so records-eval stays pinned",
};

/** Fields that must never be embedded whatever a card says: the deny list, the dossier's "published name", and any *name field not reviewed. */
export function embeddableField(field: string): boolean {
  if (DENY_FIELD.test(field)) return false;
  if (/^published name$/i.test(field)) return false;
  if (/name$/i.test(field) && !NAME_FIELDS_ALLOWED.has(field)) return false;
  return true;
}
