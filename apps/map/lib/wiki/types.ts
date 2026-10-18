// Shared shapes for Wikipedia data, as the layers and the fabric
// enrichment consume it. Everything here is relayed from the MediaWiki /
// Wikimedia APIs (lib/wiki/client.ts); nothing is invented locally.

export interface WikiArticle {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  /** Distance in metres from the point the geosearch was centred on, computed there from the real coordinates. */
  distM?: number;
  extract?: string;
  url: string;
}

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
  description?: string;
  lat?: number;
  lon?: number;
}

export interface WikiDayItem {
  year: number;
  text: string;
  type: "event" | "birth" | "death" | "selected";
  pages: Array<{ title: string; url: string; extract?: string; lat?: number; lon?: number }>;
}
