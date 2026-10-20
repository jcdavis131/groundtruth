// The publisher host each source id's record URLs must live on. One table, two readers:
// world.test.ts checks every upstreamRecordUrl against it, and worldSchema.ts turns it into
// the `if sourceId == X then upstreamRecordUrl matches ^https://<host>/` rules of the published
// outputSchema, so the test and the schema cannot disagree about a host.
//
// Written from each publisher's own service directory, not from world.ts, so a record URL on
// any other host (a different publisher than the item cites: the borrowed-citation bug, one
// level down) fails. Moved out of world.test.ts unchanged on 2026-10-20; B1's hosts.ts (open PR #68) copies the same
// regexes; a follow-up makes one import the other.
//
// Relative imports only (see ./tools.ts for why); this file imports nothing.

export const RECORD_HOSTS: Record<string, RegExp> = {
  "census-tigerweb": /^https:\/\/tigerweb\.geo\.census\.gov\/arcgis\/rest\/services\//,
  "nws-api": /^https:\/\/api\.weather\.gov\//,
  "usgs-wbd": /^https:\/\/hydro\.nationalmap\.gov\//,
  "fema-nfhl": /^https:\/\/hazards\.fema\.gov\//,
  "epa-ecoregions": /^https:\/\/geodata\.epa\.gov\//,
  "usgs-epqs": /^https:\/\/epqs\.nationalmap\.gov\//,
  "fema-nri": /^https:\/\/services\.arcgis\.com\/XG15cJAlne2vxtgt\/arcgis\/rest\/services\/National_Risk_Index_Counties\//,
  "fema-openfema": /^https:\/\/www\.fema\.gov\/api\/open\//,
  usdm: /^https:\/\/usdmdataservices\.unl\.edu\//,
  "usgs-earthquakes": /^https:\/\/earthquake\.usgs\.gov\//,
  "bls-qcew": /^https:\/\/data\.bls\.gov\/cew\//,
  "cdc-svi": /^https:\/\/services3\.arcgis\.com\/ZvidGQkLaDJxRSJ2\//,
  "hifld-hospitals": /^https:\/\/services\.arcgis\.com\/XG15cJAlne2vxtgt\/arcgis\/rest\/services\/Hospitals_RAPT\//,
  "cms-provider-data": /^https:\/\/data\.cms\.gov\/provider-data\//,
  "usace-nid": /^https:\/\/geospatial\.sec\.usace\.army\.mil\//,
  "sec-edgar": /^https:\/\/data\.sec\.gov\//,
  "epa-cws-boundaries": /^https:\/\/services\.arcgis\.com\/cJ9YHowT8TU7DUyn\/arcgis\/rest\/services\/Water_System_Boundaries\//,
  "epa-ucmr5-pat": /^https:\/\/services\.arcgis\.com\/cJ9YHowT8TU7DUyn\/arcgis\/rest\/services\/PFAS_Analytic_Tools_Layers\//,
};
