// Attribution and disclaimer text the civic sources require, verbatim, and
// where the site shows it.

/**
 * The City of Chicago's required disclaimer, verbatim from its data terms of
 * use (https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html, read
 * 2026-09-26), which say an application using the data shall include it "at
 * the site where the software application ... can be accessed or
 * downloaded". Shown in the About dialog (components/hud/DataTerms.tsx), in
 * the dossier of every feature built from a Chicago dataset, and carried in
 * `caveats` on every API answer built from one (zoning, building permits,
 * business licences).
 */
export const CHICAGO_DISCLAIMER =
  "This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago. The City of Chicago makes no claims as to the content, accuracy, timeliness, or completeness of any of the data provided at this site. The data provided at this site is subject to change at any time. It is understood that the data provided at this site is being used at one's own risk.";

export const CHICAGO_TERMS_URL = "https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html";

/** The civic layers whose features carry the city they came from. */
const CIVIC_LAYERS = new Set(["zoning", "permits", "licences"]);

/**
 * The disclaimer a feature's dossier must show, or null: Chicago's for a
 * zoning district, permit or licence built from a City of Chicago dataset
 * (the layers put the city in `extra.city`, licences in `extra.source`).
 */
export function requiredDisclaimer(p: { layer: string; extra?: unknown }): string | null {
  if (!CIVIC_LAYERS.has(p.layer)) return null;
  const x = (p.extra ?? {}) as { city?: unknown; source?: unknown };
  return x.city === "chicago" || x.source === "chicago" ? CHICAGO_DISCLAIMER : null;
}
