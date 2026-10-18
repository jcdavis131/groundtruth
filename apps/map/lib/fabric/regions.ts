// Federal regions that are assigned by state: the ten standard federal
// regions (EPA and FEMA number them identically) and the twelve Federal
// Reserve districts. Bundled because they are published as lists, not as a
// service a point can be asked about.
//
// Fourteen states are split between two Reserve districts along county
// lines. For those this module says so and names both districts rather than
// picking one: which side a county is on is not in this table, and a guess
// would be an invented value.

/** Standard federal region by USPS code (EPA regions; FEMA uses the same ten). */
const FEDERAL_REGION: Record<string, number> = {
  CT: 1, ME: 1, MA: 1, NH: 1, RI: 1, VT: 1,
  NJ: 2, NY: 2, PR: 2, VI: 2,
  DE: 3, DC: 3, MD: 3, PA: 3, VA: 3, WV: 3,
  AL: 4, FL: 4, GA: 4, KY: 4, MS: 4, NC: 4, SC: 4, TN: 4,
  IL: 5, IN: 5, MI: 5, MN: 5, OH: 5, WI: 5,
  AR: 6, LA: 6, NM: 6, OK: 6, TX: 6,
  IA: 7, KS: 7, MO: 7, NE: 7,
  CO: 8, MT: 8, ND: 8, SD: 8, UT: 8, WY: 8,
  AZ: 9, CA: 9, HI: 9, NV: 9, AS: 9, GU: 9, MP: 9,
  AK: 10, ID: 10, OR: 10, WA: 10,
};

const REGION_HQ: Record<number, string> = {
  1: "Boston", 2: "New York", 3: "Philadelphia", 4: "Atlanta", 5: "Chicago",
  6: "Dallas", 7: "Lenexa", 8: "Denver", 9: "San Francisco", 10: "Seattle",
};

const FEMA_HQ: Record<number, string> = {
  1: "Boston", 2: "New York", 3: "Philadelphia", 4: "Atlanta", 5: "Chicago",
  6: "Denton", 7: "Kansas City", 8: "Denver", 9: "Oakland", 10: "Bothell",
};

/** Federal Reserve district(s) by USPS code; two entries = the state is split by county. */
const FED_DISTRICT: Record<string, number[]> = {
  ME: [1], NH: [1], VT: [1], MA: [1], RI: [1], CT: [1, 2],
  NY: [2], NJ: [2, 3], PR: [2], VI: [2],
  DE: [3], PA: [3, 4],
  OH: [4], KY: [4, 8], WV: [4, 5],
  MD: [5], VA: [5], NC: [5], SC: [5], DC: [5],
  FL: [6], GA: [6], AL: [6], TN: [6, 8], MS: [6, 8], LA: [6, 11],
  IA: [7], IL: [7, 8], IN: [7, 8], MI: [7, 9], WI: [7, 9],
  AR: [8], MO: [8, 10],
  MN: [9], MT: [9], ND: [9], SD: [9],
  CO: [10], KS: [10], NE: [10], OK: [10], WY: [10], NM: [10, 11],
  TX: [11],
  AK: [12], AZ: [12], CA: [12], HI: [12], ID: [12], NV: [12], OR: [12], UT: [12], WA: [12], AS: [12], GU: [12], MP: [12],
};

const FED_CITY: Record<number, string> = {
  1: "Boston", 2: "New York", 3: "Philadelphia", 4: "Cleveland", 5: "Richmond", 6: "Atlanta",
  7: "Chicago", 8: "St. Louis", 9: "Minneapolis", 10: "Kansas City", 11: "Dallas", 12: "San Francisco",
};

export interface RegionRef {
  number: number;
  /** Seat of the regional office. */
  seat: string;
}

export function epaRegion(usps: string): RegionRef | null {
  const n = FEDERAL_REGION[usps.toUpperCase()];
  return n ? { number: n, seat: REGION_HQ[n] } : null;
}

export function femaRegion(usps: string): RegionRef | null {
  const n = FEDERAL_REGION[usps.toUpperCase()];
  return n ? { number: n, seat: FEMA_HQ[n] } : null;
}

export interface FedDistrict {
  /** One district, or two when the state is split by county. */
  districts: RegionRef[];
  split: boolean;
}

export function fedDistrict(usps: string): FedDistrict | null {
  const ns = FED_DISTRICT[usps.toUpperCase()];
  if (!ns) return null;
  return { districts: ns.map((n) => ({ number: n, seat: FED_CITY[n] })), split: ns.length > 1 };
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function roman(n: number): string {
  return ROMAN[n] ?? String(n);
}
