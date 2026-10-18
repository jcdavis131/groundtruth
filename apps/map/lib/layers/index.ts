// Registry of every data layer. Adding a layer = writing lib/layers/<name>.ts
// and listing it here (plus a style in lib/globe/styles.ts).

import type { LayerDefinition, LayerId } from "./types";
import { aircraftLayer } from "./aircraft";
import { satellitesLayer } from "./satellites";
import { issLayer } from "./iss";
import { shipsLayer } from "./ships";
import { earthquakesLayer } from "./earthquakes";
import { camerasLayer } from "./cameras";
import { launchesLayer } from "./launches";
import { waterLayer } from "./water";
import { groundwaterLayer } from "./groundwater";
import { turbidityLayer } from "./turbidity";
import { tradeLayer } from "./trade";
import { commerceLayer } from "./commerce";
import { realestateLayer } from "./realestate";
import { companiesLayer } from "./companies";
import { employersLayer } from "./employers";
import { banksLayer } from "./banks";
import { spendingLayer } from "./spending";
import { occupationsLayer } from "./occupations";
import { gasPricesLayer } from "./gasPrices";
import { gasForecastLayer } from "./gasForecast";
import { ercotPricesLayer } from "./ercotPrices";
import { usElectricityPricesLayer } from "./usElectricityPrices";
import { globalGenerationLayer } from "./globalGeneration";
import { datacentersLayer } from "./datacenters";
import { weatherLayer } from "./weather";
import { windFlowLayer, oceanFlowLayer } from "./flows";
import { wildfireLayer } from "./wildfire";
import { firesLayer } from "./fires";
import { hazardsLayer } from "./hazards";
import { floodLayer } from "./flood";
import { wetlandsLayer } from "./wetlands";
import { publiclandsLayer } from "./publiclands";
import { historicLayer } from "./historic";
import { heritageLayer } from "./heritage";
import { impairedLayer } from "./impaired";
import { pfasLayer } from "./pfas";
import { TERRAIN_LAYERS } from "./terrain";
import { waybackLayer } from "./wayback";
import { topoLayer } from "./topo";
import { hydroLayer } from "./hydro";
import { naipLayer } from "./naip";
import { INFRA_LAYERS } from "./infra";
import { airqualityLayer } from "./airquality";
import { AIRNOW_ENABLED } from "@/lib/air/airnow";
import { eventsLayer } from "./events";
import { parcelsLayer } from "./parcels";
import { zoningLayer } from "./zoning";
import { permitsLayer } from "./permits";
import { licencesLayer } from "./licences";
import { envpermitsLayer } from "./envpermits";
import { contaminantsLayer } from "./contaminants";
import { ustLayer } from "./ust";
import { riskindexLayer } from "./riskindex";
import { healthLayer } from "./health";
import { schoolsLayer } from "./schools";
import { vulnerabilityLayer } from "./vulnerability";
import { broadbandLayer } from "./broadband";
import { housingLayer } from "./housing";
import { wildfireriskLayer } from "./wildfirerisk";
import { tribalLayer } from "./tribal";
import { sportsLayer } from "./sports";
import { constructsLayer } from "./constructs";
import { fieldLayer } from "./field";
import { wikipediaLayer } from "./wikipedia";
import { wikidayLayer } from "./wikiday";
import { alertsLayer } from "./alerts";

export const LAYERS: LayerDefinition[] = [
  aircraftLayer,
  shipsLayer,
  satellitesLayer,
  issLayer,
  earthquakesLayer,
  camerasLayer,
  // Traffic (sim) is not offered: its vehicles are simulated, not a public
  // record. lib/layers/traffic.ts stays for the vehicle styling it exports.
  launchesLayer,
  waterLayer,
  groundwaterLayer,
  turbidityLayer,
  tradeLayer,
  commerceLayer,
  realestateLayer,
  companiesLayer,
  employersLayer,
  banksLayer,
  spendingLayer,
  occupationsLayer,
  gasPricesLayer,
  gasForecastLayer,
  ercotPricesLayer,
  usElectricityPricesLayer,
  globalGenerationLayer,
  datacentersLayer,
  weatherLayer,
  windFlowLayer,
  oceanFlowLayer,
  wildfireLayer,
  firesLayer,
  hazardsLayer,
  floodLayer,
  wetlandsLayer,
  impairedLayer,
  pfasLayer,
  publiclandsLayer,
  historicLayer,
  heritageLayer,
  ...TERRAIN_LAYERS,
  waybackLayer,
  topoLayer,
  hydroLayer,
  naipLayer,
  ...INFRA_LAYERS,
  // Off until the operator decides on AirNow's data-user form (lib/air/airnow.ts).
  ...(AIRNOW_ENABLED ? [airqualityLayer] : []),
  eventsLayer,
  parcelsLayer,
  zoningLayer,
  permitsLayer,
  licencesLayer,
  envpermitsLayer,
  contaminantsLayer,
  ustLayer,
  riskindexLayer,
  healthLayer,
  schoolsLayer,
  vulnerabilityLayer,
  broadbandLayer,
  wildfireriskLayer,
  tribalLayer,
  housingLayer,
  sportsLayer,
  constructsLayer,
  fieldLayer,
  wikipediaLayer,
  wikidayLayer,
  alertsLayer,
];

export const LAYER_BY_ID: Partial<Record<LayerId, LayerDefinition>> = Object.fromEntries(
  LAYERS.map((l) => [l.id, l]),
);
