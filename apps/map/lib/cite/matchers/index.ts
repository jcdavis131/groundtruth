// One matcher per source in the host table (lib/cite/hosts.ts). A source with a host but no matcher here is refused by plan().

import type { Matcher } from "../types";
import { blsQcew } from "./bls-qcew";
import { cdcSvi } from "./cdc-svi";
import { censusTigerweb } from "./census-tigerweb";
import { cmsProviderData } from "./cms-provider-data";
import { epaCwsBoundaries } from "./epa-cws-boundaries";
import { epaEcoregions } from "./epa-ecoregions";
import { epaUcmr5Pat } from "./epa-ucmr5-pat";
import { femaNfhl } from "./fema-nfhl";
import { femaNri } from "./fema-nri";
import { femaOpenfema } from "./fema-openfema";
import { hifldHospitals } from "./hifld-hospitals";
import { nwsApi } from "./nws-api";
import { secEdgar } from "./sec-edgar";
import { usaceNid } from "./usace-nid";
import { usdm } from "./usdm";
import { usgsEpqs } from "./usgs-epqs";
import { usgsWbd } from "./usgs-wbd";

export const MATCHERS: Record<string, Matcher> = Object.fromEntries(
  [blsQcew, cdcSvi, censusTigerweb, cmsProviderData, epaCwsBoundaries, epaEcoregions, epaUcmr5Pat, femaNfhl, femaNri, femaOpenfema, hifldHospitals, nwsApi, secEdgar, usaceNid, usdm, usgsEpqs, usgsWbd].map((m) => [m.sourceId, m]),
);
