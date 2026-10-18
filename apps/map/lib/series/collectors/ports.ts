// Curated table of major container, tanker and bulk ports the vessel-count
// collector watches. Coordinates are the harbour centre (or the anchorage
// where that is where ships actually wait) and `radiusKm` is chosen to cover
// berths plus the outer anchorage, so the count reads as "ships working or
// waiting at this port". Neighbouring ports (Singapore / Tanjung Pelepas,
// Hong Kong / Shenzhen, Port Said / Suez) overlap on purpose; a ship in the
// overlap counts for both.
//
// `coverage` says which keyless feed can see the port: Digitraffic relays
// Finnish AIS stations, which reach the Gulf of Finland and the northern
// Baltic only. Every other port needs the optional AISStream key.

export interface WatchedPort {
  /** UN/LOCODE. Doubles as the series geo id. */
  locode: string;
  name: string;
  country: string;
  lon: number;
  lat: number;
  radiusKm: number;
  coverage: "digitraffic" | "aisstream";
  /** Rough cargo profile, for tags and grouping. */
  kind: "container" | "tanker" | "bulk" | "mixed" | "canal";
}

export const PORTS: WatchedPort[] = [
  // North America
  { locode: "USLAX", name: "Los Angeles / Long Beach", country: "US", lon: -118.23, lat: 33.73, radiusKm: 30, coverage: "aisstream", kind: "container" },
  { locode: "USNYC", name: "New York / New Jersey", country: "US", lon: -74.05, lat: 40.66, radiusKm: 30, coverage: "aisstream", kind: "container" },
  { locode: "USSAV", name: "Savannah", country: "US", lon: -80.95, lat: 32.03, radiusKm: 35, coverage: "aisstream", kind: "container" },
  { locode: "USHOU", name: "Houston / Galveston", country: "US", lon: -94.85, lat: 29.6, radiusKm: 40, coverage: "aisstream", kind: "tanker" },
  { locode: "USSEA", name: "Seattle / Tacoma", country: "US", lon: -122.38, lat: 47.5, radiusKm: 30, coverage: "aisstream", kind: "container" },
  { locode: "USOAK", name: "Oakland", country: "US", lon: -122.32, lat: 37.8, radiusKm: 25, coverage: "aisstream", kind: "container" },
  { locode: "USCHS", name: "Charleston", country: "US", lon: -79.92, lat: 32.8, radiusKm: 25, coverage: "aisstream", kind: "container" },
  { locode: "USORF", name: "Norfolk / Hampton Roads", country: "US", lon: -76.33, lat: 36.93, radiusKm: 30, coverage: "aisstream", kind: "mixed" },
  { locode: "USMSY", name: "New Orleans", country: "US", lon: -90.06, lat: 29.95, radiusKm: 30, coverage: "aisstream", kind: "bulk" },
  { locode: "USBAL", name: "Baltimore", country: "US", lon: -76.55, lat: 39.25, radiusKm: 25, coverage: "aisstream", kind: "mixed" },
  { locode: "USMIA", name: "Miami", country: "US", lon: -80.17, lat: 25.77, radiusKm: 25, coverage: "aisstream", kind: "mixed" },
  { locode: "CAVAN", name: "Vancouver", country: "CA", lon: -123.1, lat: 49.29, radiusKm: 25, coverage: "aisstream", kind: "mixed" },
  // Latin America and canals
  { locode: "PACTB", name: "Colon (Cristobal, Atlantic anchorage)", country: "PA", lon: -79.9, lat: 9.38, radiusKm: 30, coverage: "aisstream", kind: "canal" },
  { locode: "PABLB", name: "Balboa (Pacific anchorage)", country: "PA", lon: -79.55, lat: 8.9, radiusKm: 30, coverage: "aisstream", kind: "canal" },
  { locode: "BRSSZ", name: "Santos", country: "BR", lon: -46.3, lat: -23.97, radiusKm: 25, coverage: "aisstream", kind: "container" },
  // Europe
  { locode: "NLRTM", name: "Rotterdam", country: "NL", lon: 4.1, lat: 51.95, radiusKm: 30, coverage: "aisstream", kind: "mixed" },
  { locode: "BEANR", name: "Antwerp", country: "BE", lon: 4.35, lat: 51.3, radiusKm: 25, coverage: "aisstream", kind: "container" },
  { locode: "DEHAM", name: "Hamburg", country: "DE", lon: 9.95, lat: 53.53, radiusKm: 25, coverage: "aisstream", kind: "container" },
  { locode: "DEBRV", name: "Bremerhaven", country: "DE", lon: 8.55, lat: 53.55, radiusKm: 20, coverage: "aisstream", kind: "container" },
  { locode: "GBFXT", name: "Felixstowe", country: "GB", lon: 1.32, lat: 51.95, radiusKm: 20, coverage: "aisstream", kind: "container" },
  { locode: "FRLEH", name: "Le Havre", country: "FR", lon: 0.12, lat: 49.48, radiusKm: 20, coverage: "aisstream", kind: "container" },
  { locode: "ESALG", name: "Algeciras", country: "ES", lon: -5.43, lat: 36.13, radiusKm: 20, coverage: "aisstream", kind: "container" },
  { locode: "ESVLC", name: "Valencia", country: "ES", lon: -0.32, lat: 39.45, radiusKm: 20, coverage: "aisstream", kind: "container" },
  { locode: "GRPIR", name: "Piraeus", country: "GR", lon: 23.62, lat: 37.94, radiusKm: 20, coverage: "aisstream", kind: "container" },
  { locode: "MAPTM", name: "Tanger Med", country: "MA", lon: -5.5, lat: 35.89, radiusKm: 20, coverage: "aisstream", kind: "container" },
  // Baltic (Finnish AIS coverage, keyless)
  { locode: "FIHEL", name: "Helsinki", country: "FI", lon: 24.95, lat: 60.15, radiusKm: 20, coverage: "digitraffic", kind: "mixed" },
  { locode: "FIKTK", name: "Kotka / Hamina", country: "FI", lon: 26.95, lat: 60.45, radiusKm: 20, coverage: "digitraffic", kind: "mixed" },
  { locode: "FITKU", name: "Turku / Naantali", country: "FI", lon: 22.1, lat: 60.43, radiusKm: 20, coverage: "digitraffic", kind: "mixed" },
  { locode: "EETLL", name: "Tallinn / Muuga", country: "EE", lon: 24.85, lat: 59.5, radiusKm: 20, coverage: "digitraffic", kind: "mixed" },
  { locode: "RULED", name: "St Petersburg / Ust-Luga", country: "RU", lon: 29.4, lat: 59.85, radiusKm: 40, coverage: "digitraffic", kind: "tanker" },
  { locode: "SESTO", name: "Stockholm", country: "SE", lon: 18.3, lat: 59.33, radiusKm: 25, coverage: "aisstream", kind: "mixed" },
  { locode: "LVRIX", name: "Riga", country: "LV", lon: 24.05, lat: 57.05, radiusKm: 20, coverage: "aisstream", kind: "mixed" },
  { locode: "LTKLJ", name: "Klaipeda", country: "LT", lon: 21.1, lat: 55.7, radiusKm: 20, coverage: "aisstream", kind: "mixed" },
  { locode: "PLGDN", name: "Gdansk / Gdynia", country: "PL", lon: 18.7, lat: 54.45, radiusKm: 25, coverage: "aisstream", kind: "container" },
  // Middle East, Africa, Indian Ocean
  { locode: "AEJEA", name: "Dubai (Jebel Ali)", country: "AE", lon: 55.05, lat: 25.0, radiusKm: 30, coverage: "aisstream", kind: "container" },
  { locode: "EGSUZ", name: "Suez (southern anchorage)", country: "EG", lon: 32.55, lat: 29.85, radiusKm: 30, coverage: "aisstream", kind: "canal" },
  { locode: "EGPSD", name: "Port Said (northern anchorage)", country: "EG", lon: 32.3, lat: 31.3, radiusKm: 30, coverage: "aisstream", kind: "canal" },
  { locode: "ZADUR", name: "Durban", country: "ZA", lon: 31.05, lat: -29.87, radiusKm: 25, coverage: "aisstream", kind: "mixed" },
  { locode: "LKCMB", name: "Colombo", country: "LK", lon: 79.84, lat: 6.95, radiusKm: 20, coverage: "aisstream", kind: "container" },
  { locode: "INNSA", name: "Nhava Sheva (JNPT)", country: "IN", lon: 72.95, lat: 18.95, radiusKm: 25, coverage: "aisstream", kind: "container" },
  // East and South-East Asia, Australia
  { locode: "SGSIN", name: "Singapore", country: "SG", lon: 103.75, lat: 1.25, radiusKm: 30, coverage: "aisstream", kind: "mixed" },
  { locode: "MYTPP", name: "Tanjung Pelepas", country: "MY", lon: 103.55, lat: 1.37, radiusKm: 15, coverage: "aisstream", kind: "container" },
  { locode: "MYPKG", name: "Port Klang", country: "MY", lon: 101.35, lat: 3.0, radiusKm: 25, coverage: "aisstream", kind: "container" },
  { locode: "CNSHA", name: "Shanghai (Waigaoqiao / Yangshan)", country: "CN", lon: 121.85, lat: 31.0, radiusKm: 45, coverage: "aisstream", kind: "container" },
  { locode: "CNNGB", name: "Ningbo-Zhoushan", country: "CN", lon: 121.95, lat: 29.9, radiusKm: 40, coverage: "aisstream", kind: "container" },
  { locode: "CNSZX", name: "Shenzhen (Yantian / Shekou)", country: "CN", lon: 114.05, lat: 22.5, radiusKm: 30, coverage: "aisstream", kind: "container" },
  { locode: "HKHKG", name: "Hong Kong", country: "HK", lon: 114.15, lat: 22.3, radiusKm: 25, coverage: "aisstream", kind: "container" },
  { locode: "CNCAN", name: "Guangzhou (Nansha)", country: "CN", lon: 113.6, lat: 22.7, radiusKm: 30, coverage: "aisstream", kind: "container" },
  { locode: "CNTAO", name: "Qingdao", country: "CN", lon: 120.3, lat: 36.05, radiusKm: 30, coverage: "aisstream", kind: "container" },
  { locode: "CNTXG", name: "Tianjin", country: "CN", lon: 117.75, lat: 38.98, radiusKm: 30, coverage: "aisstream", kind: "container" },
  { locode: "KRPUS", name: "Busan", country: "KR", lon: 129.05, lat: 35.08, radiusKm: 30, coverage: "aisstream", kind: "container" },
  { locode: "JPTYO", name: "Tokyo / Yokohama", country: "JP", lon: 139.75, lat: 35.5, radiusKm: 30, coverage: "aisstream", kind: "mixed" },
  { locode: "TWKHH", name: "Kaohsiung", country: "TW", lon: 120.28, lat: 22.6, radiusKm: 20, coverage: "aisstream", kind: "container" },
  { locode: "AUPHE", name: "Port Hedland", country: "AU", lon: 118.58, lat: -20.3, radiusKm: 40, coverage: "aisstream", kind: "bulk" },
];

export const PORT_BY_LOCODE: ReadonlyMap<string, WatchedPort> = new Map(PORTS.map((p) => [p.locode, p]));
