// Records as the GeoJSON the /api/permits ops answer: one Point feature per
// record, the record itself as its properties (without lon/lat, which are
// the geometry). Pure.

import type { PermitRecord } from "./features";
import type { LicenceRecord } from "./licences";
import type { EnvRecord } from "./environmental";

export const HOME_HEURISTIC =
  "Licences at an address with an apartment or unit number (APT, UNIT, a bare #) are withheld: a heuristic for a business run from a home, so some offices written as '#302' are withheld too, and a home written without a unit is not. `withheld` counts them.";

type WithPoint = { lon: number; lat: number; id: string };

function collection<T extends WithPoint>(records: T[]) {
  return {
    type: "FeatureCollection" as const,
    features: records.map(({ lon, lat, ...props }) => ({
      type: "Feature" as const,
      id: props.id,
      geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] },
      properties: props,
    })),
  };
}

export const permitFeatures = (r: PermitRecord[]) => collection(r);
export const licenceFeatures = (r: LicenceRecord[]) => collection(r);
export const envFeatures = (r: EnvRecord[]) => collection(r);

export type RecordFeature<T> = { type: "Feature"; id: string; geometry: { type: "Point"; coordinates: [number, number] }; properties: Omit<T, "lon" | "lat"> };
