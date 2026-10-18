// Parcel records this app withholds on request, by adapter and parcel id.
//
// The sources are public records and this app relays them as published, but
// a person a record concerns can ask for it not to be shown here (README,
// "Parcels & ownership": how to ask). A listed parcel's record is not
// returned by /api/parcels and its dossier says only that a record here is
// withheld on request; its outline stays, since the outline carries no name.
// Entries hold ids only: never a name, an address or the reason given.

export interface Suppression {
  adapter: string;
  parcelId: string;
  /** ISO date the request was honoured. */
  since: string;
}

export const SUPPRESSED: readonly Suppression[] = [];

const KEYS = new Set(SUPPRESSED.map((s) => `${s.adapter}|${s.parcelId}`));

export function isSuppressed(adapter: string, parcelId: string, list: readonly Suppression[] = SUPPRESSED): boolean {
  if (list === SUPPRESSED) return KEYS.has(`${adapter}|${parcelId}`);
  return list.some((s) => s.adapter === adapter && s.parcelId === parcelId);
}

export const SUPPRESSED_NOTE = "A parcel record at this point is withheld from this app at the request of someone it concerns; the source's own record is unchanged.";
