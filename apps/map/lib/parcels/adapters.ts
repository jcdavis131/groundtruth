// Parcel adapters: one per keyless county or state parcel service, each with
// the exact fields it asks for and a normalize() into one ParcelRecord.
// Plain data and functions, no network (lib/parcels/sources.ts does that),
// so every adapter is tested against a payload captured from its service.
//
// Every adapter asks for an explicit outFields list, never "*": some services
// time out on "*" and answer the same point in a second with a list, and a
// list is also the audit of what this app reads. Owner-occupancy flags
// (homestead, owner-occupied, principal-residence share) are never asked for,
// nor a class field that encodes one (Maricopa's LC_CUR, MnGeo's useclass1).
// Nothing here searches by name: every query is a point or a box.

import type { SourceId } from "@/lib/provenance/sources";
import type { CountyRef, ParcelRecord } from "./types";
import {
  addressLine,
  amount,
  area,
  epochDate,
  finalize,
  ids,
  join,
  ownerNames,
  publishedOwner,
  sale,
  text,
  value,
  values,
  year,
  ymd,
} from "./normalize";

type Props = Record<string, unknown>;

export interface NormalizeContext {
  county?: CountyRef | null;
  /** A second hop's row (Cook County's parcel-address row for the same PIN). */
  extra?: Props | null;
}

export interface ParcelAdapter {
  id: string;
  /** Short name for the dossier and the API. */
  name: string;
  publisher: string;
  sourceId: SourceId;
  /** Where it answers, in words. */
  coverage: string;
  /** Whether this source's public service carries owner names at all. */
  ownerPublished: boolean;
  /** Politeness gate key: one request per second per host. */
  host: string;
  /**
   * "query": a FeatureServer / MapServer layer answering /query (point or box).
   * "identify": a MapServer that answers only /identify (TxGIO StratMap).
   */
  kind: "query" | "identify";
  /** The layer URL (…/FeatureServer/0) for this county; identify adapters give the MapServer URL. */
  url: (county: CountyRef | null) => string;
  /** Fields asked for at a point. Identify adapters cannot choose; they list what normalize reads. */
  outFields: readonly string[];
  /** The parcel key and use-class fields: the only attributes an outline carries. */
  idField: string;
  useField?: string;
  /**
   * The field naming each row's county as a five-digit GEOID, for a statewide
   * service that also carries counties another adapter answers for (StratMap
   * carries Harris, which HCAD answers for). Outline rows of those counties
   * are left to that adapter (`ownsRow`), so no lot is drawn twice.
   */
  countyField?: string;
  /** The layer's maxRecordCount, or less: the cap for one outline box. */
  maxRecords: number;
  /**
   * Why this service answers a click but draws no lot lines, when it cannot
   * answer a box in reasonable time. Absent: outlines are drawn.
   */
  noOutlines?: string;
  normalize: (p: Props, ctx?: NormalizeContext) => ParcelRecord;
  /** Said in the answer's caveats whenever this adapter answered. */
  caveat?: string;
}

const NOT_PUBLISHED = (who: string) => `${who} does not publish owner names in this public parcel service`;

// ---------------------------------------------------------------- Texas

const STRATMAP_URL = "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer";

/** StratMap identify keys come back upper-case, every value a string, blanks as " ". */
export const STRATMAP_FIELDS = [
  "PROP_ID",
  "GEO_ID",
  "OWNER_NAME",
  "NAME_CARE",
  "LEGAL_AREA",
  "LGL_AREA_UNIT",
  "GIS_AREA",
  "GIS_AREA_UNIT",
  "LEGAL_DESC",
  "LAND_VALUE",
  "IMP_VALUE",
  "MKT_VALUE",
  "SITUS_ADDR",
  "MAIL_ADDR",
  "SOURCE",
  "DATE_ACQ",
  "FIPS",
  "COUNTY",
  "TAX_YEAR",
  "YEAR_BUILT",
  "STAT_LAND_USE",
  "LOC_LAND_USE",
] as const;

function unitOf(v: unknown): "acres" | "sq ft" | undefined {
  const s = (text(v) ?? "").toLowerCase();
  if (s.startsWith("acre")) return "acres";
  if (s.includes("sq") || s.includes("square")) return "sq ft";
  return undefined;
}

const txStratmap: ParcelAdapter = {
  id: "tx-stratmap",
  name: "TxGIO StratMap Land Parcels",
  publisher: "Texas Geographic Information Office, from each county's appraisal district",
  sourceId: "txgio-stratmap",
  coverage:
    "Texas counties whose appraisal district contributes to StratMap, except Harris County: StratMap carries the Harris roll too, but this app reads HCAD's own service there",
  ownerPublished: true,
  host: "feature.geographic.texas.gov",
  kind: "identify",
  url: () => STRATMAP_URL,
  outFields: STRATMAP_FIELDS,
  idField: "PROP_ID",
  useField: "STAT_LAND_USE",
  countyField: "FIPS",
  maxRecords: 2000,
  caveat:
    "StratMap is TxGIO's statewide composite of appraisal-district rolls, collected once a year; the appraisal district's own records are the authority and may be newer.",
  normalize(p) {
    // An area is read only in a unit the record states: a blank or unrecognised
    // unit ("SF") leaves that area out rather than reading square feet as acres.
    const legalUnit = unitOf(p.LGL_AREA_UNIT);
    const gisUnit = unitOf(p.GIS_AREA_UNIT);
    const district = text(p.SOURCE);
    const taxYear = year(p.TAX_YEAR);
    const use = join([text(p.STAT_LAND_USE) && `state class ${text(p.STAT_LAND_USE)}`, text(p.LOC_LAND_USE) && `local use ${text(p.LOC_LAND_USE)}`], " · ");
    return finalize({
      adapter: "tx-stratmap",
      parcelId: text(p.PROP_ID) ?? "",
      otherIds: ids({ "geo id": p.GEO_ID }),
      county: text(p.COUNTY),
      situs: addressLine(p.SITUS_ADDR),
      owner: publishedOwner(ownerNames(p.OWNER_NAME), { careOf: p.NAME_CARE }),
      mailing: addressLine(p.MAIL_ADDR),
      values: values(taxYear ? `tax year ${taxYear}` : undefined, [
        value("land", p.LAND_VALUE),
        value("improvements", p.IMP_VALUE),
        value("market value", p.MKT_VALUE),
      ]),
      use,
      // "1990,1973" when a parcel has several buildings: kept as published.
      yearBuilt: (() => {
        const y = text(p.YEAR_BUILT);
        return y && y !== "0" ? y : undefined;
      })(),
      area:
        (legalUnit ? area(p.LEGAL_AREA, legalUnit, "legal (as recorded)") : undefined) ??
        (gisUnit ? area(p.GIS_AREA, gisUnit, "GIS (computed from the outline)") : undefined),
      legal: text(p.LEGAL_DESC),
      asOf: ymd(p.DATE_ACQ),
      notes: district ? [`roll from ${district}`] : undefined,
    });
  },
};

const HCAD_FIELDS = [
  "HCAD_NUM",
  "acct_num",
  "tax_year",
  "owner_name_1",
  "owner_name_2",
  "owner_name_3",
  "mail_addr_1",
  "mail_addr_2",
  "mail_city",
  "mail_state",
  "mail_zip",
  "site_str_pfx",
  "site_str_num",
  "site_str_num_sfx",
  "site_str_name",
  "site_str_sfx",
  "site_str_sfx_dir",
  "site_city",
  "site_zip",
  "state_class",
  "land_use",
  "land_value",
  "impr_value",
  "total_appraised_val",
  "total_market_val",
  "new_owner_date",
  "legal_dscr_1",
  "legal_dscr_2",
  "legal_dscr_3",
  "legal_dscr_4",
  "Acreage",
  "land_sqft",
  "confidential_flag",
] as const;

/** HCAD's confidential_flag: the first character is Y for a confidential account. */
export function hcadConfidential(p: Props): boolean {
  return (text(p.confidential_flag) ?? "").toUpperCase().startsWith("Y");
}

const txHcad: ParcelAdapter = {
  id: "tx-hcad",
  name: "HCAD parcels",
  publisher: "Harris Central Appraisal District",
  sourceId: "hcad-parcels",
  coverage: "Harris County, Texas",
  ownerPublished: true,
  host: "www.gis.hctx.net",
  kind: "query",
  url: () => "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
  outFields: HCAD_FIELDS,
  idField: "HCAD_NUM",
  useField: "state_class",
  maxRecords: 1000,
  normalize(p) {
    const taxYear = year(p.tax_year);
    const street = join([p.site_str_pfx, p.site_str_num, p.site_str_num_sfx, p.site_str_name, p.site_str_sfx, p.site_str_sfx_dir]);
    const acreage = amount(text(p.Acreage)?.replace(/\s*AC$/i, ""));
    return finalize(
      {
        adapter: "tx-hcad",
        parcelId: text(p.HCAD_NUM) ?? text(p.acct_num) ?? "",
        otherIds: text(p.acct_num) !== text(p.HCAD_NUM) ? ids({ account: p.acct_num }) : undefined,
        county: "Harris",
        situs: join([street, join([p.site_city, p.site_zip])], ", "),
        owner: publishedOwner(ownerNames(p.owner_name_1, p.owner_name_2, p.owner_name_3)),
        mailing: join([p.mail_addr_1, p.mail_addr_2, join([p.mail_city, p.mail_state, p.mail_zip])], ", "),
        ownedSince: epochDate(p.new_owner_date),
        values: values(taxYear ? `tax year ${taxYear}` : undefined, [
          value("land", p.land_value),
          value("improvements", p.impr_value),
          value("appraised value", p.total_appraised_val),
          value("market value", p.total_market_val),
        ]),
        use: join([text(p.state_class) && `state class ${text(p.state_class)}`, text(p.land_use) && `land use ${text(p.land_use)}`], " · "),
        area: acreage != null && acreage > 0 ? { value: acreage, unit: "acres", basis: "HCAD acreage" } : area(p.land_sqft, "sq ft", "land area"),
        legal: join([p.legal_dscr_1, p.legal_dscr_2, p.legal_dscr_3, p.legal_dscr_4], " "),
      },
      { confidential: hcadConfidential(p) },
    );
  },
};

// ---------------------------------------------------------------- county services

const azMaricopa: ParcelAdapter = {
  id: "az-maricopa",
  name: "Maricopa County Assessor parcels",
  publisher: "Maricopa County Assessor's Office",
  sourceId: "maricopa-assessor",
  coverage: "Maricopa County, Arizona",
  ownerPublished: true,
  host: "gis.mcassessor.maricopa.gov",
  kind: "query",
  url: () => "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/MaricopaDynamicQueryService/MapServer/3",
  outFields: [
    "APN",
    "APN_DASH",
    "OWNER_NAME",
    "INCAREOF",
    "MAIL_ADDRESS",
    "PHYSICAL_ADDRESS",
    "DEED_NUMBER",
    "DEED_DATE",
    "SALE_DATE",
    "SALE_PRICE",
    "SUBNAME",
    "LOT_NUM",
    "LAND_SIZE",
    "CONST_YEAR",
    "FCV_CUR",
    "LPV_CUR",
    "TAX_YR_CUR",
    // PUC is the property use code. LC_CUR (the legal class) is not asked for:
    // its classes 3.1-3.3 and 4.1-4.2 say whether the owner lives there.
    "PUC",
    "CITY_ZONING",
    "JURISDICTION",
    "STR",
  ],
  idField: "APN",
  useField: "PUC",
  maxRecords: 1000,
  normalize(p) {
    const apn = text(p.APN);
    const taxYear = year(p.TAX_YR_CUR);
    const deed = text(p.DEED_NUMBER);
    return finalize({
      adapter: "az-maricopa",
      parcelId: text(p.APN_DASH) ?? apn ?? "",
      county: "Maricopa",
      municipality: text(p.JURISDICTION),
      situs: text(p.PHYSICAL_ADDRESS),
      owner: publishedOwner(ownerNames(p.OWNER_NAME), { careOf: p.INCAREOF }),
      mailing: text(p.MAIL_ADDRESS),
      values: values(taxYear ? `tax year ${taxYear}` : undefined, [value("full cash value", p.FCV_CUR), value("limited property value", p.LPV_CUR)]),
      use: text(p.PUC) ? `property use code ${text(p.PUC)}` : undefined,
      // The layer holds this placeholder where it has no zoning; it is not a zone.
      zoning: text(p.CITY_ZONING, ["CONTACT LOCAL JURISDICTION"]),
      yearBuilt: year(p.CONST_YEAR),
      area: area(p.LAND_SIZE, "sq ft", "land size"),
      lastSale: sale(text(p.SALE_DATE) ?? undefined, p.SALE_PRICE, deed ? `deed ${deed}${epochDate(p.DEED_DATE) ? ` (${epochDate(p.DEED_DATE)})` : ""}` : undefined),
      subdivision: join([p.SUBNAME, text(p.LOT_NUM) && `lot ${text(p.LOT_NUM)}`], ", "),
      plssText: text(p.STR) ? `section-township-range ${text(p.STR)}` : undefined,
      link: apn ? { url: `https://mcassessor.maricopa.gov/mcs/?q=${encodeURIComponent(apn)}&mod=pd`, label: "Maricopa County Assessor parcel page" } : undefined,
    });
  },
};

const caLosAngeles: ParcelAdapter = {
  id: "ca-la",
  name: "LA County Assessor parcels",
  publisher: "Los Angeles County Office of the Assessor",
  sourceId: "lacounty-assessor",
  coverage: "Los Angeles County, California",
  ownerPublished: false,
  host: "public.gis.lacounty.gov",
  kind: "query",
  url: () => "https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0",
  outFields: [
    "AIN",
    "APN",
    "SitusFullAddress",
    "UseCode",
    "UseType",
    "UseDescription",
    "YearBuilt1",
    "Roll_Year",
    "Roll_LandValue",
    "Roll_ImpValue",
    "Roll_RealEstateExemp",
    "LegalDescription",
    "TaxRateArea",
  ],
  idField: "AIN",
  useField: "UseType",
  maxRecords: 1000,
  normalize(p) {
    const ain = text(p.AIN);
    const roll = year(p.Roll_Year);
    return finalize({
      adapter: "ca-la",
      parcelId: ain ?? "",
      otherIds: ids({ APN: p.APN, "tax rate area": p.TaxRateArea }),
      county: "Los Angeles",
      situs: text(p.SitusFullAddress),
      owner: { status: "not-published", reason: NOT_PUBLISHED("The LA County Assessor") },
      values: values(roll ? `roll year ${roll}` : undefined, [
        value("land (roll)", p.Roll_LandValue),
        value("improvements (roll)", p.Roll_ImpValue),
        value("real estate exemption", p.Roll_RealEstateExemp),
      ]),
      use: join([p.UseType, p.UseDescription, text(p.UseCode) && `use code ${text(p.UseCode)}`], " · "),
      yearBuilt: year(p.YearBuilt1),
      legal: text(p.LegalDescription),
      link: ain ? { url: `https://portal.assessor.lacounty.gov/parceldetail/${encodeURIComponent(ain)}`, label: "LA County Assessor portal" } : undefined,
    });
  },
};

/** Cook County's parcel-address rows, read by PIN only (never by a name column). */
export const COOK_ADDRESS_COLUMNS = [
  "pin",
  "year",
  "mail_address_name",
  "mail_address_full",
  "mail_address_city_name",
  "mail_address_state",
  "mail_address_zipcode_1",
  "owner_address_name",
  "owner_address_full",
  "owner_address_city_name",
  "owner_address_state",
  "owner_address_zipcode_1",
] as const;

const ilCook: ParcelAdapter = {
  id: "il-cook",
  name: "Cook County parcels and parcel addresses",
  publisher: "Cook County GIS and the Cook County Assessor's Office",
  sourceId: "cook-parcels",
  coverage: "Cook County, Illinois",
  ownerPublished: true,
  host: "gis12.cookcountyil.gov",
  kind: "query",
  url: () => "https://gis12.cookcountyil.gov/traditional/rest/services/CookViewer3Parcels/MapServer/0",
  outFields: [
    "PIN14",
    "PIN14_dash",
    "street_address",
    "city_state_zip",
    "TAXYR",
    "BCLASS",
    "class_description",
    "major_class_description",
    "township_name",
    "CURRENTVALUE_TOTAL",
    "CURRENTVALUE_LAND",
    "CURRENTVALUE_BLDG",
    "current_value_desc",
    "LANDSF",
    "assessor_link",
    "tax_municipality_name",
  ],
  idField: "PIN14",
  useField: "BCLASS",
  maxRecords: 2000,
  caveat: "Cook County's owner and mailing names come from the Assessor's parcel-address table, read by PIN for this one parcel.",
  normalize(p, ctx) {
    const x = ctx?.extra ?? null;
    const taxYear = year(p.TAXYR);
    const addrYear = x ? year(x.year) : undefined;
    const desc = text(p.current_value_desc);
    const names = x ? ownerNames(x.owner_address_name) : [];
    const mailName = x ? text(x.mail_address_name) : undefined;
    return finalize({
      adapter: "il-cook",
      parcelId: text(p.PIN14_dash) ?? text(p.PIN14) ?? "",
      county: "Cook",
      municipality: text(p.tax_municipality_name),
      situs: join([p.street_address, p.city_state_zip], ", "),
      owner: x
        ? publishedOwner(names, { blankReason: "the Assessor's parcel-address table has no owner name for this PIN" })
        : { status: "not-published", reason: "the Assessor's parcel-address table did not answer for this PIN" },
      mailing: x ? join([mailName, x.mail_address_full, join([x.mail_address_city_name, x.mail_address_state, x.mail_address_zipcode_1])], ", ") : undefined,
      ownerAddress: x ? join([x.owner_address_full, join([x.owner_address_city_name, x.owner_address_state, x.owner_address_zipcode_1])], ", ") : undefined,
      values: values(
        taxYear ? `tax year ${taxYear}${desc ? ` (${desc})` : ""}` : desc,
        [value("land (assessed)", p.CURRENTVALUE_LAND), value("building (assessed)", p.CURRENTVALUE_BLDG), value("total (assessed)", p.CURRENTVALUE_TOTAL)],
      ),
      use: join([text(p.BCLASS) && `class ${text(p.BCLASS)}`, p.class_description, p.major_class_description], " · "),
      area: area(p.LANDSF, "sq ft", "land"),
      link: text(p.assessor_link) ? { url: text(p.assessor_link)!, label: "Cook County Assessor PIN page" } : undefined,
      notes: [
        text(p.township_name) ? `assessor township ${text(p.township_name)}` : "",
        addrYear ? `owner and mailing from the ${addrYear} parcel-address table` : "",
      ].filter(Boolean),
    });
  },
};

const waKing: ParcelAdapter = {
  id: "wa-king",
  name: "King County parcels",
  publisher: "King County GIS Center and Department of Assessments",
  sourceId: "king-parcels",
  coverage: "King County, Washington",
  ownerPublished: false,
  host: "gismaps.kingcounty.gov",
  kind: "query",
  url: () => "https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/2",
  outFields: ["PIN", "MAJOR", "MINOR", "ADDR_FULL", "ZIP5", "POSTALCTYNAME", "PROP_NAME", "PLAT_NAME", "LOTSQFT", "APPRLNDVAL", "APPR_IMPR", "PROPTYPE", "KCA_ZONING", "KCA_ACRES", "PREUSE_DESC"],
  idField: "PIN",
  useField: "PREUSE_DESC",
  maxRecords: 1000,
  normalize(p) {
    const pin = text(p.PIN);
    return finalize({
      adapter: "wa-king",
      parcelId: pin ?? "",
      otherIds: ids({ major: p.MAJOR, minor: p.MINOR }),
      county: "King",
      situs: join([p.ADDR_FULL, join([p.POSTALCTYNAME, p.ZIP5])], ", "),
      propertyName: text(p.PROP_NAME),
      // The taxpayer name is published only on the parcel's eRealProperty page, linked below.
      owner: { status: "not-published", reason: `${NOT_PUBLISHED("King County")}; the Assessor's eRealProperty page for the parcel shows the taxpayer` },
      values: values(undefined, [value("appraised land", p.APPRLNDVAL), value("appraised improvements", p.APPR_IMPR)]),
      use: join([p.PREUSE_DESC, text(p.PROPTYPE) && `property type ${text(p.PROPTYPE)}`], " · "),
      zoning: text(p.KCA_ZONING),
      area: area(p.KCA_ACRES, "acres", "Assessor acres") ?? area(p.LOTSQFT, "sq ft", "lot"),
      subdivision: text(p.PLAT_NAME),
      link: pin ? { url: `https://blue.kingcounty.com/Assessor/eRealProperty/Detail.aspx?ParcelNbr=${encodeURIComponent(pin)}`, label: "King County eRealProperty" } : undefined,
    });
  },
};

const miDetroit: ParcelAdapter = {
  id: "mi-detroit",
  name: "City of Detroit parcel file",
  publisher: "City of Detroit",
  sourceId: "detroit-parcels",
  coverage: "the City of Detroit (Wayne County, Michigan); the rest of Wayne County is not covered",
  ownerPublished: true,
  host: "services2.arcgis.com",
  kind: "query",
  url: () => "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0",
  outFields: [
    "parcel_id",
    "address",
    "zip_code",
    "taxpayer_1",
    "taxpayer_2",
    "taxpayer_address",
    "taxpayer_city",
    "taxpayer_state",
    "taxpayer_zip_code",
    "property_class",
    "property_class_description",
    "use_code_description",
    "zoning_district",
    "tax_status_description",
    "amt_assessed_value",
    "amt_taxable_value",
    "amt_land_value",
    "sale_date",
    "amt_sale_price",
    "total_acreage",
    "total_square_footage",
    "legal_description",
    "year_built",
    "parcel_modified_date",
  ],
  idField: "parcel_id",
  useField: "property_class_description",
  maxRecords: 1000,
  normalize(p) {
    return finalize({
      adapter: "mi-detroit",
      parcelId: text(p.parcel_id) ?? "",
      county: "Wayne",
      municipality: "Detroit",
      situs: join([p.address, p.zip_code], ", "),
      owner: publishedOwner(ownerNames(p.taxpayer_1, p.taxpayer_2), { role: "taxpayer" }),
      mailing: join([p.taxpayer_address, join([p.taxpayer_city, p.taxpayer_state, p.taxpayer_zip_code])], ", "),
      values: values(undefined, [value("assessed value", p.amt_assessed_value), value("taxable value", p.amt_taxable_value), value("land value", p.amt_land_value)]),
      exempt: text(p.tax_status_description),
      use: join([text(p.property_class) && `class ${text(p.property_class)}`, p.property_class_description, p.use_code_description], " · "),
      zoning: text(p.zoning_district),
      yearBuilt: year(p.year_built),
      area: area(p.total_acreage, "acres", "total acreage") ?? area(p.total_square_footage, "sq ft", "total square footage"),
      lastSale: sale(epochDate(p.sale_date) ?? text(p.sale_date), p.amt_sale_price),
      legal: text(p.legal_description),
      asOf: epochDate(p.parcel_modified_date) ?? text(p.parcel_modified_date),
    });
  },
};

// ---------------------------------------------------------------- statewide services

const wiStatewide: ParcelAdapter = {
  id: "wi-statewide",
  name: "Wisconsin Statewide Parcel Map",
  publisher: "Wisconsin State Cartographer's Office and Department of Administration, from each county",
  sourceId: "wi-parcels",
  coverage: "Wisconsin, all 72 counties",
  ownerPublished: true,
  host: "services3.arcgis.com",
  kind: "query",
  url: () => "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0",
  outFields: [
    "STATEID",
    "PARCELID",
    "TAXPARCELID",
    "TAXROLLYEAR",
    "OWNERNME1",
    "OWNERNME2",
    "PSTLADRESS",
    "SITEADRESS",
    "PLACENAME",
    "ZIPCODE",
    "CNTASSDVALUE",
    "LNDVALUE",
    "IMPVALUE",
    "ESTFMKVALUE",
    "PROPCLASS",
    "AUXCLASS",
    "ASSDACRES",
    "DEEDACRES",
    "GISACRES",
    "CONAME",
    "LOADDATE",
    "PARCELSRC",
  ],
  idField: "PARCELID",
  useField: "PROPCLASS",
  maxRecords: 2000,
  // Probed 2026-09-26: a point answers in under a second, but every box query took 23-47 s,
  // whatever its size (35 parcels in a rural box still took 41 s).
  noOutlines: "Wisconsin's statewide parcel service answers a click in about a second but takes 25-45 s for any box, so no lot lines are drawn from it",
  normalize(p) {
    const roll = year(p.TAXROLLYEAR);
    return finalize({
      adapter: "wi-statewide",
      parcelId: text(p.PARCELID) ?? text(p.STATEID) ?? "",
      otherIds: ids({ "state id": p.STATEID, "tax parcel id": p.TAXPARCELID }),
      county: text(p.CONAME),
      municipality: text(p.PLACENAME),
      situs: join([p.SITEADRESS, p.ZIPCODE], ", "),
      owner: publishedOwner(ownerNames(p.OWNERNME1, p.OWNERNME2)),
      mailing: addressLine(p.PSTLADRESS),
      values: values(roll ? `tax roll year ${roll}` : undefined, [
        value("land (assessed)", p.LNDVALUE),
        value("improvements (assessed)", p.IMPVALUE),
        value("total assessed value", p.CNTASSDVALUE),
        value("estimated fair market value", p.ESTFMKVALUE),
      ]),
      use: join([text(p.PROPCLASS) && `class of property ${text(p.PROPCLASS)}`, text(p.AUXCLASS) && `auxiliary class ${text(p.AUXCLASS)}`], " · "),
      area: area(p.ASSDACRES, "acres", "assessed acres") ?? area(p.DEEDACRES, "acres", "deeded acres") ?? area(p.GISACRES, "acres", "GIS acres"),
      asOf: text(p.LOADDATE),
      notes: text(p.PARCELSRC) ? [`contributed by ${text(p.PARCELSRC)} County`] : undefined,
    });
  },
};

const ncStatewide: ParcelAdapter = {
  id: "nc-statewide",
  name: "NC OneMap parcels",
  publisher: "NC Center for Geographic Information and Analysis, from each county",
  sourceId: "nc-parcels",
  coverage: "North Carolina, all 100 counties",
  ownerPublished: true,
  host: "services.nconemap.gov",
  kind: "query",
  url: () => "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1",
  outFields: [
    "parno",
    "altparno",
    "ownname",
    "ownname2",
    "owntype",
    "mailadd",
    "munit",
    "mcity",
    "mstate",
    "mzip",
    "siteadd",
    "sunit",
    "scity",
    "szip",
    "landval",
    "improvval",
    "parval",
    "parvaltype",
    "saledate",
    "legdecfull",
    "parusecode",
    "parusedesc",
    "structyear",
    "gisacres",
    "recareano",
    "sourceref",
    "cntyname",
    "sourceagnt",
    "revdatetx",
  ],
  idField: "parno",
  useField: "parusedesc",
  maxRecords: 2000,
  caveat:
    "NC OneMap's mailing fields are shifted in some counties (a street in the city field), so the mailing address is shown as one line in the order published rather than split into labelled parts.",
  normalize(p) {
    const valType = text(p.parvaltype);
    return finalize({
      adapter: "nc-statewide",
      parcelId: text(p.parno) ?? "",
      otherIds: ids({ "alternate parcel number": p.altparno }),
      county: text(p.cntyname),
      situs: join([join([p.siteadd, p.sunit]), join([p.scity, p.szip])], ", "),
      owner: publishedOwner(ownerNames(p.ownname, p.ownname2)),
      // One line in the published order: the parts are not trusted to be what their names say.
      mailing: join([p.mailadd, p.munit, p.mcity, p.mstate, p.mzip], ", "),
      values: values(undefined, [
        value("land", p.landval),
        value("improvements", p.improvval),
        value(valType ? `parcel value (${valType.toLowerCase()})` : "parcel value", p.parval),
      ]),
      use: join([p.parusedesc, text(p.parusecode) && `use code ${text(p.parusecode)}`], " · "),
      yearBuilt: year(p.structyear),
      area: area(p.recareano, "acres", "recorded area") ?? area(p.gisacres, "acres", "GIS acres"),
      lastSale: sale(epochDate(p.saledate), undefined, text(p.sourceref)),
      legal: text(p.legdecfull),
      asOf: text(p.revdatetx),
      notes: [text(p.owntype) ? `owner type ${text(p.owntype)}` : "", text(p.sourceagnt) ? `from ${text(p.sourceagnt)}` : ""].filter(Boolean),
    });
  },
};

const mtStatewide: ParcelAdapter = {
  id: "mt-statewide",
  name: "Montana Cadastral Framework",
  publisher: "Montana State Library and Department of Revenue",
  sourceId: "mt-cadastral",
  coverage: "Montana, all 56 counties",
  ownerPublished: true,
  host: "gisservice.mt.gov",
  kind: "query",
  url: () => "https://gisservice.mt.gov/arcgis/rest/services/msdi_cadastral_map_v1/MapServer/1",
  outFields: [
    "PARCELID",
    "PropertyID",
    "AssessmentCode",
    "TaxYear",
    "CountyName",
    "Township",
    "Range",
    "Section",
    "LegalDescriptionShort",
    "Subdivision",
    "CertificateOfSurvey",
    "AddressLine1",
    "AddressLine2",
    "CityStateZip",
    "PropType",
    "TotalAcres",
    "GISAcres",
    "TotalBuildingValue",
    "TotalLandValue",
    "TotalValue",
    "OwnerName",
    "OwnerAddress1",
    "OwnerAddress2",
    "OwnerAddress3",
    "OwnerCity",
    "OwnerState",
    "OwnerZipCode",
    "DbaName",
    "CareOfTaxpayer",
  ],
  idField: "PARCELID",
  useField: "PropType",
  maxRecords: 2000,
  normalize(p) {
    const taxYear = year(p.TaxYear);
    const s = text(p.Section), t = text(p.Township), rg = text(p.Range);
    return finalize({
      adapter: "mt-statewide",
      parcelId: text(p.PARCELID) ?? "",
      otherIds: ids({ "property id": p.PropertyID, "assessment code": p.AssessmentCode }),
      county: text(p.CountyName),
      situs: join([p.AddressLine1, p.AddressLine2, p.CityStateZip], ", "),
      owner: publishedOwner(ownerNames(p.OwnerName), { careOf: p.CareOfTaxpayer, dba: p.DbaName }),
      mailing: join([p.OwnerAddress1, p.OwnerAddress2, p.OwnerAddress3, join([p.OwnerCity, p.OwnerState, p.OwnerZipCode])], ", "),
      values: values(taxYear ? `tax year ${taxYear}` : undefined, [
        value("land", p.TotalLandValue),
        value("buildings", p.TotalBuildingValue),
        value("total value", p.TotalValue),
      ]),
      use: text(p.PropType),
      area: area(p.TotalAcres, "acres", "total acres (Department of Revenue)") ?? area(p.GISAcres, "acres", "GIS acres"),
      legal: text(p.LegalDescriptionShort),
      subdivision: join([p.Subdivision, text(p.CertificateOfSurvey) && `certificate of survey ${text(p.CertificateOfSurvey)}`], ", "),
      plssText: s || t || rg ? join([s && `S${s}`, t && `T${t}`, rg && `R${rg}`], ", ") : undefined,
    });
  },
};

const mnParcels: ParcelAdapter = {
  id: "mn-parcels",
  name: "Minnesota Parcels, Open Data",
  publisher: "Minnesota Geospatial Information Office, from the counties that opt in",
  sourceId: "mn-parcels",
  coverage: "Minnesota counties that publish through MnGeo's open parcel service (not every county)",
  ownerPublished: true,
  host: "enterprise.gisdata.mn.gov",
  kind: "query",
  url: () => "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/1",
  outFields: [
    "county_pin",
    "state_pin",
    "anumberpre",
    "anumber",
    "anumbersuf",
    "st_pre_dir",
    "st_pre_typ",
    "st_name",
    "st_pos_typ",
    "st_pos_dir",
    "sub_type1",
    "sub_id1",
    "zip",
    "ctu_name",
    "co_name",
    "plat_name",
    "block",
    "lot",
    "owner_name",
    "owner_more",
    "own_add_l1",
    "own_add_l2",
    "own_add_l3",
    "own_add_l4",
    "tax_name",
    "tax_add_l1",
    "tax_add_l2",
    "tax_add_l3",
    "tax_add_l4",
    "acres_poly",
    "acres_deed",
    "emv_land",
    "emv_bldg",
    "emv_total",
    "tax_year",
    "mkt_year",
    // useclass1 is not asked for: in many opt-in counties it is the homestead
    // classification itself ("1A-Residential Homestead"). So Minnesota records
    // show no use class, and its lot lines carry the parcel id only.
    "tax_exempt",
    "year_built",
    "sale_date",
    "sale_value",
    "abb_legal",
  ],
  idField: "county_pin",
  maxRecords: 2000,
  normalize(p) {
    const taxYear = year(p.tax_year);
    const mktYear = year(p.mkt_year);
    const exempt = (text(p.tax_exempt) ?? "").toUpperCase() === "Y";
    const taxName = text(p.tax_name);
    const taxAddr = join([p.tax_add_l1, p.tax_add_l2, p.tax_add_l3, p.tax_add_l4], ", ");
    const names = ownerNames(p.owner_name, p.owner_more);
    const street = join([p.anumberpre, p.anumber, p.anumbersuf, p.st_pre_dir, p.st_pre_typ, p.st_name, p.st_pos_typ, p.st_pos_dir, p.sub_type1, p.sub_id1]);
    const yr = [mktYear && `market year ${mktYear}`, taxYear && `tax year ${taxYear}`].filter(Boolean).join(", ");
    return finalize({
      adapter: "mn-parcels",
      parcelId: text(p.county_pin) ?? text(p.state_pin) ?? "",
      otherIds: ids({ "state pin": p.state_pin }),
      county: text(p.co_name),
      municipality: text(p.ctu_name),
      situs: join([street, join([p.ctu_name, p.zip])], ", "),
      owner: publishedOwner(names),
      mailing: join([p.own_add_l1, p.own_add_l2, p.own_add_l3, p.own_add_l4], ", "),
      taxpayer:
        taxName || taxAddr
          ? { ...(taxName && !names.some((n) => n.toUpperCase() === taxName.toUpperCase()) ? { name: taxName } : {}), ...(taxAddr ? { address: taxAddr } : {}) }
          : undefined,
      values: values(
        yr || undefined,
        [value("land (estimated market)", p.emv_land), value("buildings (estimated market)", p.emv_bldg), value("total estimated market value", p.emv_total)],
        exempt ? "published for a tax-exempt parcel" : undefined,
      ),
      exempt: exempt ? "tax-exempt" : undefined,
      yearBuilt: year(p.year_built),
      area: area(p.acres_deed, "acres", "deeded acres") ?? area(p.acres_poly, "acres", "acres of the outline"),
      lastSale: sale(epochDate(p.sale_date), amount(p.sale_value) ? p.sale_value : undefined),
      legal: text(p.abb_legal),
      subdivision: join([p.plat_name, text(p.block) && `block ${text(p.block)}`, text(p.lot) && `lot ${text(p.lot)}`], ", "),
    });
  },
};

const flDor: ParcelAdapter = {
  id: "fl-dor",
  name: "Florida Statewide Cadastral",
  publisher: "Florida Department of Revenue, from the county property appraisers",
  sourceId: "fl-dor-cadastral",
  coverage: "Florida, all 67 counties (one annual snapshot)",
  ownerPublished: true,
  host: "services9.arcgis.com",
  kind: "query",
  url: () => "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0",
  outFields: [
    "PARCEL_ID",
    "CO_NO",
    "ASMNT_YR",
    "DOR_UC",
    "PA_UC",
    "JV",
    "AV_SD",
    "TV_SD",
    "LND_VAL",
    "ACT_YR_BLT",
    "SALE_PRC1",
    "SALE_YR1",
    "SALE_MO1",
    "OR_BOOK1",
    "OR_PAGE1",
    "OWN_NAME",
    "OWN_ADDR1",
    "OWN_ADDR2",
    "OWN_CITY",
    "OWN_STATE",
    "OWN_ZIPCD",
    "S_LEGAL",
    "PHY_ADDR1",
    "PHY_ADDR2",
    "PHY_CITY",
    "PHY_ZIPCD",
    "TWN",
    "RNG",
    "SEC",
    "LND_SQFOOT",
  ],
  idField: "PARCEL_ID",
  useField: "DOR_UC",
  maxRecords: 2000,
  caveat: "Florida DOR's statewide file is a once-a-year snapshot of the county property appraisers' rolls; the county appraiser's own record is the authority.",
  normalize(p) {
    const yr = year(p.ASMNT_YR);
    const saleYear = year(p.SALE_YR1);
    const saleMonth = text(p.SALE_MO1);
    const book = text(p.OR_BOOK1), page = text(p.OR_PAGE1);
    const twn = text(p.TWN), rng = text(p.RNG), sec = text(p.SEC);
    return finalize({
      adapter: "fl-dor",
      parcelId: text(p.PARCEL_ID) ?? "",
      otherIds: ids({ "DOR county number": p.CO_NO }),
      situs: join([join([p.PHY_ADDR1, p.PHY_ADDR2]), join([p.PHY_CITY, p.PHY_ZIPCD])], ", "),
      owner: publishedOwner(ownerNames(p.OWN_NAME)),
      mailing: join([p.OWN_ADDR1, p.OWN_ADDR2, join([p.OWN_CITY, p.OWN_STATE, p.OWN_ZIPCD])], ", "),
      values: values(yr ? `assessment year ${yr}` : undefined, [
        value("land", p.LND_VAL),
        value("just value", p.JV),
        value("assessed value (school district)", p.AV_SD),
        value("taxable value (school district)", p.TV_SD),
      ]),
      use: join([text(p.DOR_UC) && `DOR use code ${text(p.DOR_UC)}`, text(p.PA_UC) && `appraiser use code ${text(p.PA_UC)}`], " · "),
      yearBuilt: year(p.ACT_YR_BLT),
      area: area(p.LND_SQFOOT, "sq ft", "land"),
      // A sale year of 0 means no sale on file, whatever the price field says.
      lastSale: saleYear
        ? sale(saleMonth ? `${saleYear}-${saleMonth.padStart(2, "0")}` : saleYear, p.SALE_PRC1, book || page ? `official records book ${book ?? "?"} page ${page ?? "?"}` : undefined)
        : undefined,
      legal: text(p.S_LEGAL),
      plssText: twn || rng || sec ? join([sec && `section ${sec}`, twn && `township ${twn}`, rng && `range ${rng}`], ", ") : undefined,
    });
  },
};

const maMassgis: ParcelAdapter = {
  id: "ma-massgis",
  name: "MassGIS Property Tax Parcels",
  publisher: "MassGIS (Bureau of Geographic Information), with each city and town's assessor",
  sourceId: "massgis-parcels",
  coverage: "Massachusetts, all 351 cities and towns (fiscal year varies by town)",
  ownerPublished: true,
  host: "services1.arcgis.com",
  kind: "query",
  url: () => "https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0",
  outFields: [
    "MAP_PAR_ID",
    "LOC_ID",
    "PROP_ID",
    "BLDG_VAL",
    "LAND_VAL",
    "OTHER_VAL",
    "TOTAL_VAL",
    "FY",
    "LOT_SIZE",
    "LOT_UNITS",
    "LS_DATE",
    "LS_PRICE",
    "LS_BOOK",
    "LS_PAGE",
    "USE_CODE",
    "USE_DESC",
    "SITE_ADDR",
    "CITY",
    "ZIP",
    "OWNER1",
    "OWN_ADDR",
    "OWN_CITY",
    "OWN_STATE",
    "OWN_ZIP",
    "OWN_CO",
    "ZONING",
    "YEAR_BUILT",
    "POLY_TYPE",
  ],
  idField: "LOC_ID",
  useField: "USE_CODE",
  maxRecords: 2000,
  caveat: "MassGIS parcel outlines are not authoritative boundaries (MassGIS's own disclaimer), and each town's assessing data is from its own fiscal year.",
  normalize(p) {
    const fy = year(p.FY);
    const units = (text(p.LOT_UNITS) ?? "").toLowerCase();
    const lotUnit: "acres" | "sq ft" | undefined = units.startsWith("a") ? "acres" : units.startsWith("s") ? "sq ft" : undefined;
    const book = text(p.LS_BOOK), page = text(p.LS_PAGE);
    const allZero = (s: string | undefined) => !s || /^0+$/.test(s);
    return finalize({
      adapter: "ma-massgis",
      parcelId: text(p.MAP_PAR_ID) ?? text(p.LOC_ID) ?? "",
      otherIds: ids({ "location id": p.LOC_ID, "assessor property id": p.PROP_ID, "polygon type": p.POLY_TYPE }),
      municipality: text(p.CITY),
      situs: join([p.SITE_ADDR, join([p.CITY, p.ZIP])], ", "),
      owner: publishedOwner(ownerNames(p.OWNER1, p.OWN_CO)),
      mailing: join([p.OWN_ADDR, join([p.OWN_CITY, p.OWN_STATE, p.OWN_ZIP])], ", "),
      values: values(fy ? `fiscal year ${fy}` : undefined, [
        value("land", p.LAND_VAL),
        value("buildings", p.BLDG_VAL),
        value("other", p.OTHER_VAL),
        value("total assessed value", p.TOTAL_VAL),
      ]),
      use: join([text(p.USE_CODE) && `use code ${text(p.USE_CODE)}`, p.USE_DESC], " · "),
      zoning: text(p.ZONING),
      yearBuilt: year(p.YEAR_BUILT),
      area: lotUnit ? area(p.LOT_SIZE, lotUnit, "lot size (assessor)") : undefined,
      lastSale: sale(ymd(p.LS_DATE), p.LS_PRICE, !allZero(book) || !allZero(page) ? `book ${book} page ${page}` : undefined),
    });
  },
};

const vtVcgi: ParcelAdapter = {
  id: "vt-vcgi",
  name: "Vermont parcels with Grand List",
  publisher: "Vermont Center for Geographic Information, with each town's grand list",
  sourceId: "vcgi-parcels",
  coverage: "Vermont towns in VCGI's standardized parcel program",
  ownerPublished: true,
  host: "services1.arcgis.com",
  kind: "query",
  url: () => "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/ArcGIS/rest/services/FS_VCGI_VTPARCELS_WM_NOCACHE_v2/FeatureServer/1",
  outFields: [
    "SPAN",
    "PARCID",
    "TOWN",
    "TNAME",
    "GLYEAR",
    "OWNER1",
    "OWNER2",
    "ADDRGL1",
    "ADDRGL2",
    "CITYGL",
    "STGL",
    "ZIPGL",
    "DESCPROP",
    "LOCAPROP",
    "CAT",
    "ACRESGL",
    "REAL_FLV",
    "LAND_LV",
    "IMPRV_LV",
    "E911ADDR",
  ],
  idField: "SPAN",
  useField: "CAT",
  maxRecords: 2000,
  normalize(p) {
    const gl = year(p.GLYEAR);
    return finalize({
      adapter: "vt-vcgi",
      parcelId: text(p.SPAN) ?? text(p.PARCID) ?? "",
      otherIds: ids({ "town parcel id": p.PARCID }),
      municipality: text(p.TNAME) ?? text(p.TOWN),
      situs: join([text(p.E911ADDR) ?? text(p.LOCAPROP), text(p.TNAME) ?? text(p.TOWN)], ", "),
      propertyName: text(p.DESCPROP),
      owner: publishedOwner(ownerNames(p.OWNER1, p.OWNER2)),
      mailing: join([p.ADDRGL1, p.ADDRGL2, join([p.CITYGL, p.STGL, p.ZIPGL])], ", "),
      values: values(gl ? `grand list ${gl}` : undefined, [
        value("land (listed)", p.LAND_LV),
        value("improvements (listed)", p.IMPRV_LV),
        value("listed real value (full)", p.REAL_FLV),
      ]),
      use: text(p.CAT) ? `grand list category ${text(p.CAT)}` : undefined,
      area: area(p.ACRESGL, "acres", "grand list acres"),
    });
  },
};

/** Utah publishes one LIR service per county, named from the county: Parcels_SaltLake_LIR. */
export function utahService(county: CountyRef | null): string | null {
  const base = county?.basename?.replace(/[^A-Za-z]/g, "");
  return base ? `Parcels_${base}_LIR` : null;
}

const utLir: ParcelAdapter = {
  id: "ut-lir",
  name: "Utah LIR parcels",
  publisher: "Utah Geospatial Resource Center, from each county assessor",
  sourceId: "ugrc-lir",
  coverage: "Utah, one land-information-record service per county",
  ownerPublished: false,
  host: "services1.arcgis.com",
  kind: "query",
  url: (county) => `https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/${utahService(county) ?? "Parcels_SaltLake_LIR"}/FeatureServer/0`,
  outFields: [
    "PARCEL_ID",
    "SERIAL_NUM",
    "PARCEL_ADD",
    "PARCEL_CITY",
    "COUNTY_NAME",
    "ASSESSOR_SRC",
    "CURRENT_ASOF",
    "TAXEXEMPT_TYPE",
    "TOTAL_MKT_VALUE",
    "LAND_MKT_VALUE",
    "PARCEL_ACRES",
    "PROP_CLASS",
    "SUBDIV_NAME",
    "BUILT_YR",
  ],
  idField: "PARCEL_ID",
  useField: "PROP_CLASS",
  maxRecords: 2000,
  normalize(p) {
    const src = text(p.ASSESSOR_SRC);
    return finalize({
      adapter: "ut-lir",
      parcelId: text(p.PARCEL_ID) ?? "",
      otherIds: ids({ "serial number": p.SERIAL_NUM }),
      county: text(p.COUNTY_NAME)?.replace(/ County$/i, ""),
      municipality: text(p.PARCEL_CITY),
      situs: join([p.PARCEL_ADD, p.PARCEL_CITY], ", "),
      owner: { status: "not-published", reason: NOT_PUBLISHED("Utah's LIR parcel service") },
      values: values(undefined, [value("land market value", p.LAND_MKT_VALUE), value("total market value", p.TOTAL_MKT_VALUE)]),
      exempt: text(p.TAXEXEMPT_TYPE),
      use: text(p.PROP_CLASS),
      yearBuilt: year(p.BUILT_YR),
      area: area(p.PARCEL_ACRES, "acres", "parcel acres"),
      subdivision: text(p.SUBDIV_NAME),
      asOf: epochDate(p.CURRENT_ASOF),
      link: src && /^https:\/\//.test(src) ? { url: src, label: "county assessor (record search)" } : undefined,
    });
  },
};

const ohStatewide: ParcelAdapter = {
  id: "oh-statewide",
  name: "Ohio Statewide Parcels",
  publisher: "Ohio Geographically Referenced Information Program (OGRIP), from each county auditor",
  sourceId: "ohio-parcels",
  coverage: "Ohio, 88 counties",
  ownerPublished: false,
  host: "services2.arcgis.com",
  kind: "query",
  url: () => "https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0",
  outFields: ["County", "LocalParcelID", "StateParcelID", "StateLUC", "SitusAddressAll", "MailAddressAll", "CurrentTo", "CAMADataSite"],
  idField: "StateParcelID",
  useField: "StateLUC",
  maxRecords: 2000,
  caveat: "Ohio's statewide parcel view is refreshed irregularly; each parcel says the date its county's export is current to, and the county auditor's page (linked) is the record.",
  normalize(p) {
    const cama = text(p.CAMADataSite);
    return finalize({
      adapter: "oh-statewide",
      parcelId: text(p.LocalParcelID) ?? text(p.StateParcelID) ?? "",
      otherIds: ids({ "state parcel id": p.StateParcelID }),
      county: text(p.County),
      situs: text(p.SitusAddressAll),
      owner: { status: "not-published", reason: `${NOT_PUBLISHED("Ohio's statewide parcel view")}; the county auditor's page (linked) shows it` },
      mailing: text(p.MailAddressAll),
      use: text(p.StateLUC),
      asOf: epochDate(p.CurrentTo),
      link: cama && /^https?:\/\//.test(cama) ? { url: cama, label: "county auditor record" } : undefined,
    });
  },
};

/** Daniel's Law: NJOGIS redacts owner names; this app also leaves out the owner mailing fields. */
export const NJ_WITHHELD =
  "New Jersey's parcel services withhold owner names under Daniel's Law, and this app shows no New Jersey owner name or mailing address from any source";

const njModiv: ParcelAdapter = {
  id: "nj-modiv",
  name: "NJ Parcels and MOD-IV Composite",
  publisher: "NJ Office of GIS (NJOGIS), with the MOD-IV tax list",
  sourceId: "njogis-parcels",
  coverage: "New Jersey, statewide",
  ownerPublished: false,
  host: "maps.nj.gov",
  kind: "query",
  url: () => "https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0",
  // OWNER_NAME and the owner mailing fields (ST_ADDRESS, CITY_STATE, ZIP_CODE) are never asked for.
  outFields: [
    "PAMS_PIN",
    "COUNTY",
    "MUN_NAME",
    "PCLBLOCK",
    "PCLLOT",
    "PCLQCODE",
    "PROP_CLASS",
    "PROP_LOC",
    "LAND_VAL",
    "IMPRVT_VAL",
    "NET_VALUE",
    "BLDG_DESC",
    "LAND_DESC",
    "CALC_ACRE",
    "PROP_USE",
    "DEED_BOOK",
    "DEED_PAGE",
    "DEED_DATE",
    "SALE_PRICE",
    "YR_CONSTR",
    "FAC_NAME",
    "PCL_PBDATE",
  ],
  idField: "PAMS_PIN",
  useField: "PROP_CLASS",
  maxRecords: 1000,
  caveat: `${NJ_WITHHELD}. Situs, property class, values and the last sale are shown as MOD-IV publishes them.`,
  normalize(p) {
    const book = text(p.DEED_BOOK), page = text(p.DEED_PAGE);
    return finalize({
      adapter: "nj-modiv",
      parcelId: text(p.PAMS_PIN) ?? "",
      otherIds: ids({ block: p.PCLBLOCK, lot: p.PCLLOT, qualifier: p.PCLQCODE }),
      county: text(p.COUNTY),
      municipality: text(p.MUN_NAME),
      situs: text(p.PROP_LOC),
      propertyName: text(p.FAC_NAME),
      owner: { status: "withheld", reason: NJ_WITHHELD },
      mailingNote: "not shown (Daniel's Law; see owner)",
      values: values(undefined, [value("land (assessed)", p.LAND_VAL), value("improvements (assessed)", p.IMPRVT_VAL), value("net taxable value", p.NET_VALUE)]),
      use: join([text(p.PROP_CLASS) && `property class ${text(p.PROP_CLASS)}`, p.PROP_USE, p.BLDG_DESC, p.LAND_DESC], " · "),
      yearBuilt: year(p.YR_CONSTR),
      area: area(p.CALC_ACRE, "acres", "calculated acres"),
      lastSale: sale(ymd(p.DEED_DATE), text(p.DEED_DATE) ? p.SALE_PRICE : undefined, book || page ? `deed book ${book ?? "?"} page ${page ?? "?"}` : undefined),
      asOf: epochDate(p.PCL_PBDATE),
    });
  },
};

const nyTaxParcels: ParcelAdapter = {
  id: "ny-its",
  name: "NYS Tax Parcels Public",
  publisher: "NYS Office of Information Technology Services and Department of Taxation, from contributing counties",
  sourceId: "nys-tax-parcels",
  coverage: "New York counties that contribute to the public parcel service (all five New York City boroughs and some 33 other counties)",
  ownerPublished: true,
  host: "gisservices.its.ny.gov",
  kind: "query",
  url: () => "https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1",
  outFields: [
    "COUNTY_NAME",
    "MUNI_NAME",
    "SWIS",
    "PRINT_KEY",
    "SBL",
    "SWIS_SBL_ID",
    "PARCEL_ADDR",
    "LOC_ZIP",
    "PROP_CLASS",
    "ROLL_SECTION",
    "LAND_AV",
    "TOTAL_AV",
    "FULL_MARKET_VAL",
    "YR_BLT",
    "ACRES",
    "CALC_ACRES",
    "USED_AS_DESC",
    "MAIL_ADDR",
    "PO_BOX",
    "MAIL_CITY",
    "MAIL_STATE",
    "MAIL_ZIP",
    "BOOK",
    "PAGE",
    "OWNER_TYPE",
    "PRIMARY_OWNER",
    "ADD_OWNER",
    "ROLL_YR",
  ],
  idField: "SWIS_SBL_ID",
  useField: "PROP_CLASS",
  maxRecords: 2000,
  normalize(p) {
    const roll = year(p.ROLL_YR);
    const book = text(p.BOOK), page = text(p.PAGE);
    return finalize({
      adapter: "ny-its",
      parcelId: text(p.PRINT_KEY) ?? text(p.SWIS_SBL_ID) ?? "",
      otherIds: ids({ SWIS: p.SWIS, SBL: p.SBL, "SWIS+SBL": p.SWIS_SBL_ID }),
      county: text(p.COUNTY_NAME),
      municipality: text(p.MUNI_NAME),
      situs: join([p.PARCEL_ADDR, p.LOC_ZIP], ", "),
      owner: publishedOwner(ownerNames(p.PRIMARY_OWNER, p.ADD_OWNER)),
      mailing: join([p.MAIL_ADDR, p.PO_BOX, join([p.MAIL_CITY, p.MAIL_STATE, p.MAIL_ZIP])], ", "),
      values: values(roll ? `roll year ${roll}` : undefined, [
        value("land (assessed)", p.LAND_AV),
        value("total assessed value", p.TOTAL_AV),
        value("full market value", p.FULL_MARKET_VAL),
      ]),
      use: join([text(p.PROP_CLASS) && `property class ${text(p.PROP_CLASS)}`, p.USED_AS_DESC, text(p.ROLL_SECTION) && `roll section ${text(p.ROLL_SECTION)}`], " · "),
      yearBuilt: year(p.YR_BLT),
      area: area(p.ACRES, "acres", "roll acres") ?? area(p.CALC_ACRES, "acres", "calculated acres"),
      lastSale: book || page ? { reference: `deed book ${book ?? "?"} page ${page ?? "?"}` } : undefined,
      notes: text(p.OWNER_TYPE) ? [`owner type code ${text(p.OWNER_TYPE)}`] : undefined,
    });
  },
};

const ctCama: ParcelAdapter = {
  id: "ct-cama",
  name: "Connecticut CAMA and Parcel Layer",
  publisher: "State of Connecticut Office of Policy and Management, with each town's assessor",
  sourceId: "ct-parcels",
  coverage: "Connecticut, all 169 towns",
  ownerPublished: true,
  host: "services3.arcgis.com",
  kind: "query",
  url: () => "https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer_2025/FeatureServer/0",
  outFields: [
    "Town_Name",
    "Parcel_ID",
    "Location",
    "Location_1",
    "Property_City",
    "Property_Zip",
    "Owner",
    "Co_Owner",
    "Mailing_Address",
    "Mailing_City",
    "Mailing_State",
    "Mailing_Zip",
    "Assessed_Total",
    "Assessed_Land",
    "Assessed_Building",
    "Appraised_Land",
    "Appraised_Building",
    "Valuation_Year",
    "Land_Acres",
    "Zone",
    "State_Use",
    "State_Use_Description",
    "AYB",
    "Sale_Price",
    "Sale_Date",
    "Collection_year",
  ],
  idField: "Parcel_ID",
  useField: "State_Use_Description",
  maxRecords: 2000,
  normalize(p) {
    const vy = year(p.Valuation_Year);
    return finalize({
      adapter: "ct-cama",
      parcelId: text(p.Parcel_ID) ?? "",
      municipality: text(p.Town_Name),
      situs: join([text(p.Location_1) ?? text(p.Location), join([p.Property_City, p.Property_Zip])], ", "),
      // Towns that suppress ownership publish "Current Owner" / "Current Co-Owner", "SUPPRESSED OWNER" or a "(REDACTED)" marker; finalize() withholds those.
      owner: publishedOwner(ownerNames(p.Owner, p.Co_Owner)),
      mailing: join([p.Mailing_Address, join([p.Mailing_City, p.Mailing_State, p.Mailing_Zip])], ", "),
      values: values(vy ? `valuation year ${vy}` : undefined, [
        value("land (assessed)", p.Assessed_Land),
        value("buildings (assessed)", p.Assessed_Building),
        value("total assessed value", p.Assessed_Total),
        value("land (appraised)", p.Appraised_Land),
        value("buildings (appraised)", p.Appraised_Building),
      ]),
      use: join([p.State_Use_Description, text(p.State_Use) && `state use ${text(p.State_Use)}`], " · "),
      zoning: text(p.Zone),
      yearBuilt: year(p.AYB),
      area: area(p.Land_Acres, "acres", "land acres"),
      lastSale: sale(text(p.Sale_Date), p.Sale_Price),
      asOf: text(p.Collection_year) ? `collected ${text(p.Collection_year)}` : undefined,
    });
  },
};

const mdSdat: ParcelAdapter = {
  id: "md-sdat",
  name: "Maryland parcel boundaries with SDAT data",
  publisher: "MD iMAP, Maryland Department of Planning and State Department of Assessments and Taxation (SDAT)",
  sourceId: "md-parcels",
  coverage: "Maryland, every county and Baltimore City",
  ownerPublished: false,
  host: "mdgeodata.md.gov",
  kind: "query",
  url: () => "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0",
  outFields: [
    "ACCTID",
    "JURSCODE",
    "ADDRESS",
    "CITY",
    "ZIPCODE",
    "OWNADD1",
    "OWNADD2",
    "OWNCITY",
    "OWNSTATE",
    "OWNERZIP",
    "ZONING",
    "DESCLU",
    "DESCCIUSE",
    "DESCEXCL",
    "ACRES",
    "YEARBLT",
    "TRADATE",
    "CONSIDR1",
    "NFMLNDVL",
    "NFMIMPVL",
    "NFMTTLVL",
    "LEGAL1",
    "LEGAL2",
    "LEGAL3",
    "SDATWEBADR",
    "SDATDATE",
  ],
  idField: "ACCTID",
  useField: "DESCLU",
  maxRecords: 1000,
  normalize(p) {
    const web = text(p.SDATWEBADR);
    return finalize({
      adapter: "md-sdat",
      parcelId: text(p.ACCTID) ?? "",
      otherIds: ids({ jurisdiction: p.JURSCODE }),
      situs: join([p.ADDRESS, join([p.CITY, p.ZIPCODE])], ", "),
      owner: { status: "not-published", reason: `${NOT_PUBLISHED("Maryland's statewide parcel file")}; SDAT's record for the account (linked) shows it` },
      mailing: join([p.OWNADD1, p.OWNADD2, join([p.OWNCITY, p.OWNSTATE, p.OWNERZIP])], ", "),
      values: values(undefined, [
        value("new appraised land value", p.NFMLNDVL),
        value("new appraised improvement value", p.NFMIMPVL),
        value("new appraised full value", p.NFMTTLVL),
      ]),
      exempt: text(p.DESCEXCL),
      use: join([p.DESCLU, p.DESCCIUSE], " · "),
      zoning: text(p.ZONING),
      yearBuilt: year(p.YEARBLT),
      area: area(p.ACRES, "acres", "SDAT acres"),
      lastSale: sale(ymd(p.TRADATE), p.CONSIDR1),
      legal: join([p.LEGAL1, p.LEGAL2, p.LEGAL3], " "),
      asOf: text(p.SDATDATE) ? `SDAT data of ${text(p.SDATDATE)}` : undefined,
      link: web && /^https:\/\//.test(web) ? { url: web, label: "SDAT real property record" } : undefined,
    });
  },
};

export const ADAPTERS: readonly ParcelAdapter[] = [
  txStratmap,
  txHcad,
  azMaricopa,
  caLosAngeles,
  ilCook,
  waKing,
  miDetroit,
  wiStatewide,
  ncStatewide,
  mtStatewide,
  mnParcels,
  flDor,
  maMassgis,
  vtVcgi,
  utLir,
  ohStatewide,
  njModiv,
  nyTaxParcels,
  ctCama,
  mdSdat,
];

export const ADAPTER_BY_ID: ReadonlyMap<string, ParcelAdapter> = new Map(ADAPTERS.map((a) => [a.id, a]));

/** County GEOIDs whose own service takes precedence over the state's. */
export const COUNTY_ADAPTERS: Readonly<Record<string, string>> = {
  // Harris County, TX: StratMap carries the Harris roll too, but HCAD's own
  // service is newer (tax year 2026 against StratMap's 2025) and carries
  // HCAD's confidentiality flag. StratMap's Harris rows are left out of its
  // lot lines (countyField), so a box on the county line draws each lot once.
  "48201": "tx-hcad",
  "04013": "az-maricopa",
  "06037": "ca-la",
  "17031": "il-cook",
  "53033": "wa-king",
  "26163": "mi-detroit", // Wayne County, MI: the City of Detroit's file covers only the city
};

/** State FIPS -> statewide adapter. */
export const STATE_ADAPTERS: Readonly<Record<string, string>> = {
  "48": "tx-stratmap",
  "55": "wi-statewide",
  "37": "nc-statewide",
  "30": "mt-statewide",
  "27": "mn-parcels",
  "12": "fl-dor",
  "25": "ma-massgis",
  "50": "vt-vcgi",
  "49": "ut-lir",
  "39": "oh-statewide",
  "34": "nj-modiv",
  "36": "ny-its",
  "09": "ct-cama",
  "24": "md-sdat",
};

/** Travis County, TX: StratMap answers, and TCAD's public layer adds its record link. */
export const TRAVIS_GEOID = "48453";
export const TCAD_URL = "https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/0";

/** The adapter for a county, or null where no keyless parcel service is wired. */
export function adapterFor(county: CountyRef | null | undefined): ParcelAdapter | null {
  if (!county?.geoid) return null;
  const id = COUNTY_ADAPTERS[county.geoid] ?? STATE_ADAPTERS[county.geoid.slice(0, 2)];
  if (!id) return null;
  if (id === "ut-lir" && !utahService(county)) return null;
  return ADAPTER_BY_ID.get(id) ?? null;
}

/**
 * Whether an outline row is this adapter's to draw: true unless the row names
 * its county (`countyField`) and that county belongs to a different adapter.
 * A row with no readable county is kept. The rule depends only on the row, not
 * on which counties a box touches, so it can run before a box is cached.
 */
export function ownsRow(a: Pick<ParcelAdapter, "id" | "countyField">, p: Props): boolean {
  if (!a.countyField) return true;
  const geoid = text(p[a.countyField]);
  if (!geoid || !/^\d{5}$/.test(geoid)) return true;
  const owner = adapterFor({ geoid, name: geoid, basename: geoid, state: geoid.slice(0, 2) });
  return !owner || owner.id === a.id;
}
