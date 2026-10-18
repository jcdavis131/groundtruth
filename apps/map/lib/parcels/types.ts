// One shape for a parcel record, whichever county or state service it came
// from. Every field is the source's own value, cleaned of blanks and
// placeholders; a field the source does not publish is left out, never
// filled in. The labels on values and areas are the source's own terms
// ("full cash value", "just value", "estimated fair market value"), so values
// from two states are never presented as the same measure.

import type { MultiPolygon, Polygon } from "geojson";

/** Who owns the parcel, as far as the source says. */
export type ParcelOwner =
  | {
      status: "published";
      /** Owner names in the source's order, exactly as published. */
      names: string[];
      /** "owner" for an owner of record; "taxpayer" where the source publishes the taxpayer instead (Detroit). */
      role: "owner" | "taxpayer";
      careOf?: string;
      /** "Doing business as" name, where published. */
      dba?: string;
    }
  | {
      /** The source withholds the name (a confidentiality flag, a placeholder, a state law). */
      status: "withheld";
      reason: string;
    }
  | {
      /** The source's public service carries no owner field at all. */
      status: "not-published";
      reason: string;
    };

export interface ParcelValue {
  /** The source's own term: "market value", "full cash value", "land (assessed)". */
  label: string;
  amount: number;
}

export interface ParcelRecord {
  /** Adapter id, e.g. "tx-hcad". */
  adapter: string;
  /** The parcel id the source uses as its key (account, APN, PIN, SPAN…). */
  parcelId: string;
  /** Other published identifiers, label -> value. */
  otherIds?: Record<string, string>;
  county?: string;
  municipality?: string;
  /** Site (situs) address as published. */
  situs?: string;
  /** A name the source gives the property itself (a building name), never an owner's. */
  propertyName?: string;
  owner: ParcelOwner;
  /** Mailing address as published, one line. */
  mailing?: string;
  /** Why the mailing address is not shown when the source has one. */
  mailingNote?: string;
  /** A separately published owner address (Cook, Minnesota), one line. */
  ownerAddress?: string;
  /** A separately published taxpayer, when it differs from the owner (Minnesota). */
  taxpayer?: { name?: string; address?: string };
  /** The date the current owner took title, where the source publishes it (HCAD new_owner_date). */
  ownedSince?: string;
  values?: {
    /** Tax, roll, grand-list or fiscal year as the source labels it, e.g. "tax year 2026". */
    year?: string;
    items: ParcelValue[];
    /** e.g. "0 is published for this tax-exempt parcel". */
    note?: string;
  };
  /** Exemption as published ("EX-XV", "tax-exempt", "Tax Exempt - Government"). */
  exempt?: string;
  /** Land use or property class as published, code and description. */
  use?: string;
  zoning?: string;
  yearBuilt?: string;
  area?: { value: number; unit: "acres" | "sq ft"; basis: string };
  lastSale?: { date?: string; price?: number; reference?: string };
  legal?: string;
  subdivision?: string;
  /** Public Land Survey description the source itself publishes (section, township, range). */
  plssText?: string;
  /** When the source's data is current to, as published (ISO date where it can be read as one). */
  asOf?: string;
  /** The source's own page for this parcel, or its record search. */
  link?: { url: string; label: string };
  notes?: string[];
}

export type ParcelGeometry = Polygon | MultiPolygon;

/** One identified parcel: the record and the outline the source returned with it. */
export interface IdentifiedParcel {
  record: ParcelRecord;
  geometry: ParcelGeometry | null;
}

/** One address point from the USDOT National Address Database. */
export interface NadAddress {
  address: string;
  lon: number;
  lat: number;
  /** Who contributed it to NAD ("State of Texas"). */
  source?: string;
  /** When NAD last updated it, ISO date. */
  updated?: string;
  type?: string;
  /** The parcel id NAD carries for it, when its contributor supplied one. */
  parcelId?: string;
  /** Inside the identified parcel's outline (false: near the clicked point instead). */
  onParcel: boolean;
}

/** BLM Public Land Survey System description of a point. */
export interface PlssDescription {
  state?: string;
  meridian?: string;
  /** "10N 3W" as BLM labels the township. */
  township?: string;
  /** Section (first division) label, e.g. "32". */
  section?: string;
  /** "Section", "Protraction Block", … as BLM types the first division. */
  sectionType?: string;
  plssId?: string;
  firstDivisionId?: string;
}

/** Which county a point is in, from TIGERweb. */
export interface CountyRef {
  geoid: string;
  name: string;
  /** County name without the legal suffix ("Salt Lake"). */
  basename: string;
  state: string;
}

/** Summary of the adapter that answered, for the dossier and the API. */
export interface AdapterRef {
  id: string;
  name: string;
  publisher: string;
  coverage: string;
  ownerPublished: boolean;
}

/** `data` of /api/parcels?mode=identify. */
export interface ParcelIdentify {
  point: { lon: number; lat: number };
  county: CountyRef | null;
  adapter: AdapterRef | null;
  parcels: IdentifiedParcel[];
  /** NAD address points on the parcel (or near the point); null when NAD did not answer in time. */
  addresses: NadAddress[] | null;
  /** PLSS description; undefined outside PLSS states, null when BLM did not answer. */
  plss?: PlssDescription | null;
  /** Why nothing, or what is missing. */
  notes: string[];
}
