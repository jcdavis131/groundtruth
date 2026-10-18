// Real captured upstream rows (the fixtures the builders' own tests use), run
// through each record-vector card's builder. Shared by the leak test, the
// port-fidelity test and scripts/embed-reference-texts.mts. `mutate` lets the
// leak test write a marker into fields of these real rows; nothing here
// invents a record.

import type { LayerFeature } from "@/lib/layers/types";
import { buildDams } from "@/lib/infra/features";
import dams from "@/lib/infra/fixtures/dams-sanantonio.json";
import { buildHospitals } from "@/lib/infra/hospitals";
import hospitals from "@/lib/infra/fixtures/hosp-box-austin.json";
import { buildSchools } from "@/lib/civic/schools";
import schools from "@/lib/civic/fixtures/nces-box-austin.json";
import { buildFloodZones, buildHistoric, buildPublicLands, buildWetlands } from "@/lib/land/features";
import nwiWetlands from "@/lib/land/fixtures/nwi-wetlands-mitchell.json";
import nrhpPoints from "@/lib/land/fixtures/nrhp-points-dc.json";
import { buildContaminants } from "@/lib/permits/contaminants";
import emef0 from "@/lib/permits/fixtures/emef-0-houston.json";
import emef1 from "@/lib/permits/fixtures/emef-1-houston.json";
import emef4 from "@/lib/permits/fixtures/emef-4-houston.json";
import emef5 from "@/lib/permits/fixtures/emef-5-houston.json";
import { buildNplBoundaries, buildNplStatus, nplLookup, type NplDomains } from "@/lib/permits/npl";
import bndNj from "@/lib/permits/fixtures/npl-bnd-nj.json";
import statusNj from "@/lib/permits/fixtures/npl-status-nj.json";
import bndInfo from "@/lib/permits/fixtures/npl-bnd-info.json";
import { buildFudsMrs, buildFudsProperties } from "@/lib/permits/fuds";
import fudsPts from "@/lib/permits/fixtures/fuds-1-njny.json";
import fudsMrs from "@/lib/permits/fixtures/fuds-3-njny.json";
import { buildUst } from "@/lib/permits/ust";
import ustRel from "@/lib/permits/fixtures/ust-3-gulf.json";
import ustFac from "@/lib/permits/fixtures/ust-2-gulf.json";
import { buildImpaired } from "@/lib/water/impaired";
import attainsLines from "@/lib/water/fixtures/attains-1-baltimore.json";
import { buildWrcPlaces } from "@/lib/hazards/wrc";
import wrcBoulder from "@/lib/hazards/fixtures/wrc-place-boulder-box.json";
import { buildTribal, filterTribalParts } from "@/lib/land/tribal";
import larNational from "@/lib/land/fixtures/bia-lar-national.json";
import { codedDomains, type ArcgisLayerInfo } from "@/lib/server/arcgis";
import type { CollectionId } from "@/lib/catalog/embedFields";

type AnyRow = { id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> };
type Mutate = (row: AnyRow) => AnyRow;

const keep: Mutate = (r) => r;
const rowsOf = (fc: unknown, mutate: Mutate): AnyRow[] =>
  ((fc as { features: AnyRow[] }).features ?? []).map((r) => mutate({ ...r, properties: { ...(r.properties ?? {}) } }));

const d = codedDomains(bndInfo as unknown as ArcgisLayerInfo);
const nplDomains: NplDomains = { status: d.get("NPL_STATUS_CODE")!, federal: d.get("FEDERAL_FACILITY_DETER_CODE")! };

/**
 * The PAD-US and NFHL builders have no captured fixture; their tests use the rows below, which
 * are the shapes of the service's fields (written in lib/land/features.test.ts, not captured).
 * The PAD-US private unit is that test's "Smith Family Farm" row.
 */
const square: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]]] };
const PADUS_TEST_ROWS: AnyRow[] = [
  { geometry: square, properties: { OBJECTID: 7, Category: "Easement", Unit_Nm: "Smith Family Farm", Loc_Nm: "Smith Farm", Own_Type: "PVT", Pub_Access: "XA" } },
];
const NFHL_TEST_ROWS: AnyRow[] = [{ geometry: square, properties: { FLD_AR_ID: "48029C_1", FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: -9999, DEPTH: -9999, LEN_UNIT: "Feet" } }];

/** Each record-vector card's features from real fixtures (PAD-US and NFHL: from their tests' written rows, labelled above). */
export function recordFixtures(mutate: Mutate = keep): Array<{ card: CollectionId; captured: boolean; features: LayerFeature[] }> {
  const ust = buildUst(rowsOf(ustRel, mutate) as never, rowsOf(ustFac, mutate) as never).features;
  return [
    { card: "nid-dams", captured: true, features: buildDams(rowsOf(dams, mutate) as never) },
    { card: "hifld-hospitals", captured: true, features: buildHospitals(rowsOf(hospitals, mutate) as never) },
    { card: "nces-public-schools", captured: true, features: buildSchools(rowsOf(schools, mutate) as never).features },
    { card: "nwi-wetlands", captured: true, features: buildWetlands(rowsOf(nwiWetlands, mutate), []) },
    { card: "nrhp-listed", captured: true, features: buildHistoric(rowsOf(nrhpPoints, mutate), "point") },
    { card: "emef-sems", captured: true, features: buildContaminants("sems", rowsOf(emef0, mutate)) },
    { card: "emef-tri", captured: true, features: buildContaminants("tri", rowsOf(emef1, mutate)) },
    { card: "emef-rcra", captured: true, features: buildContaminants("rcra", rowsOf(emef4, mutate)) },
    { card: "emef-acres", captured: true, features: buildContaminants("acres", rowsOf(emef5, mutate)) },
    { card: "npl-boundaries", captured: true, features: buildNplBoundaries(rowsOf(bndNj, mutate) as never, nplDomains, nplLookup(buildNplStatus(rowsOf(statusNj, mutate)))) },
    { card: "fuds-properties", captured: true, features: buildFudsProperties(rowsOf(fudsPts, mutate) as never, null, null) },
    { card: "fuds-mrs", captured: true, features: buildFudsMrs(rowsOf(fudsMrs, mutate) as never) },
    { card: "ust-releases-county", captured: true, features: ust },
    { card: "attains-impaired", captured: true, features: buildImpaired(rowsOf(attainsLines, mutate), "line") },
    { card: "wrc-communities", captured: true, features: buildWrcPlaces(rowsOf(wrcBoulder, mutate) as never, 0, "national") },
    { card: "bia-lar", captured: true, features: buildTribal(filterTribalParts(rowsOf(larNational, mutate)).features) },
    { card: "padus-units", captured: false, features: buildPublicLands(PADUS_TEST_ROWS.map((r) => mutate({ ...r, properties: { ...r.properties } })), new Map()) },
    { card: "fema-nfhl-zones", captured: false, features: buildFloodZones(NFHL_TEST_ROWS.map((r) => mutate({ ...r, properties: { ...r.properties } })) as never) },
  ];
}

