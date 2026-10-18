// Market report for the place under the camera: home values and rents,
// what a mortgage on the typical home would cost against local wages, jobs
// and wages, the nearest trade gateways, and the national pulse. Every
// number comes from a feature the layers hold or a published series; every
// estimate prints its arithmetic.

import type { MultiPolygon, Point, Polygon } from "geojson";
import { haversine } from "@/lib/globe/geo";
import type { LayerFeature, LayerId } from "@/lib/layers/types";
import { pointInGeometry } from "@/lib/water/report";
import type { Provenance } from "@/lib/provenance/types";
import { citationsOf, dedupeProvenance, iso } from "@/lib/provenance/collect";
import { affordability, momentum, type Affordability, type Momentum, type RateObs } from "./estimates";
import { fmtNum, fmtPct, fmtUsd, monthLabel, type AreaExtra, type CrossingExtra, type HomeValue, type JobsRow, type PortExtra, type RentValue, type SectorRow } from "./features";
import { btsBorderProvenance, btsPortsProvenance, estimateProvenance, fredProvenance, pulseProvenance, qcewProvenance, wpiProvenance, zillowProvenance } from "./provenance";
import type { PulseItem } from "./sources";

export interface MarketItem {
  id: string;
  layer: LayerId;
  name: string;
  distanceKm?: number;
  value: string;
  flag?: "ok" | "watch" | "poor";
}

export interface MarketSection<T = Record<string, unknown>> {
  title: string;
  loaded: boolean;
  summary: string;
  /** Prose: what the numbers are and are not. */
  basis: string;
  /** Machine-readable: which release each number came from; estimates carry their formula. */
  provenance: Provenance[];
  items: MarketItem[];
  data: T;
}

export interface MarketReport {
  lon: number;
  lat: number;
  generatedAt: number;
  area: { level: "county" | "state"; geoid: string; name: string; stateName?: string; metro?: string } | null;
  home: MarketSection<{ latest: number | null; yoyPct: number | null; y5Pct: number | null; asOf: string | null; metro: { name: string; latest: number; yoyPct: number | null } | null; us: { latest: number; yoyPct: number | null } | null }>;
  rent: MarketSection<{ latest: number | null; yoyPct: number | null; priceToRent: number | null; asOf: string | null }>;
  affordability: { estimate: Affordability | null; basis: string; provenance: Provenance[] };
  jobs: MarketSection<{ period: string | null; emp: number | null; estabs: number | null; avgWeeklyWage: number | null; yoyEmp: number | null; yoyWage: number | null; sectors: SectorRow[] }>;
  trade: MarketSection<{ ports: number; crossings: number }>;
  pulse: MarketSection<{ items: PulseItem[] }>;
  momentum: Momentum;
  caveats: string[];
  /** Every source the report used, de-duplicated across sections (estimates included). */
  provenance: Provenance[];
  /** One citation line per source, ready to paste. */
  citations: string[];
}

export interface MarketSources {
  /** County and state features from the commerce and real-estate layers. */
  areas: LayerFeature[];
  /** Ports, crossings and countries from the trade layer. */
  trade: LayerFeature[];
  loaded: { areas: boolean; trade: boolean; pulse: boolean };
  pulse?: PulseItem[];
  sectors?: SectorRow[];
  metroHome?: HomeValue | null;
  usHome?: HomeValue | null;
  caveats?: string[];
}

export const MARKET_RADII_KM = { ports: 200, crossings: 250 } as const;

function km(lon: number, lat: number, f: LayerFeature<Point>): number {
  return haversine(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) / 1000;
}

/** The smallest area containing the point: a county if one is loaded, else a state. */
export function areaAt(lon: number, lat: number, areas: LayerFeature[]): { county?: AreaExtra; state?: AreaExtra } {
  let county: AreaExtra | undefined;
  let state: AreaExtra | undefined;
  for (const f of areas) {
    if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
    const x = f.properties.extra as AreaExtra;
    if (x.level === "county" && county?.home && county?.jobs) continue;
    if (x.level === "state" && state?.home && state?.jobs) continue;
    if (!pointInGeometry(lon, lat, f.geometry as Polygon | MultiPolygon)) continue;
    if (x.level === "county") county = county ? { ...county, jobs: county.jobs ?? x.jobs, home: county.home ?? x.home, rent: county.rent ?? x.rent } : x;
    else state = state ? { ...state, jobs: state.jobs ?? x.jobs, home: state.home ?? x.home, rent: state.rent ?? x.rent } : x;
  }
  return { county, state };
}

export function buildMarketReport(lon: number, lat: number, src: MarketSources, now = Date.now()): MarketReport {
  const caveats: string[] = [...(src.caveats ?? [])];
  const { county, state } = areaAt(lon, lat, src.areas);
  const a = county ?? state;
  const home: HomeValue | undefined = a?.home;
  const rent: RentValue | undefined = a?.rent;
  const jobs: JobsRow | undefined = a?.jobs;
  const area = a ? { level: a.level, geoid: a.geoid, name: a.level === "county" ? `${a.name}${a.stusab ? ", " + a.stusab : ""}` : a.name, stateName: a.stateName, metro: a.metro } : null;
  if (!src.loaded.areas) caveats.push("County layers not loaded: turn on Home values or Jobs & wages, or descend below 2,500 km.");
  else if (!a) caveats.push("No US county or state under this point; home values and jobs cover the United States only.");
  if (a && a.level === "state") caveats.push("Statewide figures: descend below 2,500 km for the county.");

  const at = iso(now);
  const homeProvenance: Provenance[] = [];
  if (home && a) homeProvenance.push(zillowProvenance(a.level === "county" ? "zhviCounty" : "zhviState", home.asOf, at));
  // The metro and US rows both come from Zillow's metro file (the client may not carry its month; fall back to the county's).
  if (src.metroHome) homeProvenance.push(zillowProvenance("zhviMetro", src.metroHome.asOf || home?.asOf, at, ["metro and United States rows"]));
  else if (src.usHome) homeProvenance.push(zillowProvenance("zhviMetro", src.usHome.asOf || home?.asOf, at, ["United States row"]));
  const flagHome = home?.yoyPct != null && home.yoyPct < -3 ? "watch" : "ok";
  const homeSection: MarketReport["home"] = {
    title: "Home values",
    loaded: src.loaded.areas,
    summary: home
      ? `Typical home ${fmtUsd(home.latest)} (${monthLabel(home.asOf)}), ${fmtPct(home.yoyPct)} over one year, ${fmtPct(home.y5Pct)} over five`
      : "No Zillow home value index for this area",
    basis:
      "Zillow Home Value Index (ZHVI), typical value of homes in the 35th to 65th percentile, smoothed and seasonally adjusted; a model estimate of value, not a sale price. Data through Zillow Research.",
    provenance: homeProvenance,
    items: home ? [{ id: `${a!.level}:${a!.geoid}`, layer: "realestate", name: area!.name, value: `${fmtUsd(home.latest)} · ${fmtPct(home.yoyPct)} 1-yr`, flag: flagHome }] : [],
    data: {
      latest: home?.latest ?? null,
      yoyPct: home?.yoyPct ?? null,
      y5Pct: home?.y5Pct ?? null,
      asOf: home?.asOf ?? null,
      metro: src.metroHome ? { name: src.metroHome.name, latest: src.metroHome.latest, yoyPct: src.metroHome.yoyPct } : null,
      us: src.usHome ? { latest: src.usHome.latest, yoyPct: src.usHome.yoyPct } : null,
    },
  };

  const priceToRent = home && rent ? home.latest / (rent.latest * 12) : null;
  const rentProvenance: Provenance[] = [];
  if (rent) rentProvenance.push(zillowProvenance("zoriCounty", rent.asOf, at));
  if (priceToRent != null && home && rent)
    rentProvenance.push(estimateProvenance("zillow-zhvi", `price-to-rent = ${fmtUsd(home.latest)} / (${fmtUsd(rent.latest)} × 12) = ${priceToRent.toFixed(1)}`, at, ["rent from Zillow ZORI"]));
  const rentSection: MarketReport["rent"] = {
    title: "Rents",
    loaded: src.loaded.areas,
    summary: rent
      ? `Typical rent ${fmtUsd(rent.latest)}/mo (${monthLabel(rent.asOf)}), ${fmtPct(rent.yoyPct)} over one year${priceToRent != null ? `; price-to-rent ${priceToRent.toFixed(1)}` : ""}`
      : home
        ? "Zillow publishes no rent index for this area (ZORI covers about 1,400 counties)"
        : "No rent index for this area",
    basis: "Zillow Observed Rent Index (ZORI), smoothed, all homes and multifamily; price-to-rent = typical home / (typical rent × 12).",
    provenance: rentProvenance,
    items: rent ? [{ id: `${a!.level}:${a!.geoid}`, layer: "realestate", name: area!.name, value: `${fmtUsd(rent.latest)}/mo · ${fmtPct(rent.yoyPct)} 1-yr` }] : [],
    data: { latest: rent?.latest ?? null, yoyPct: rent?.yoyPct ?? null, priceToRent, asOf: rent?.asOf ?? null },
  };

  const rateItem = src.pulse?.find((p) => p.id === "MORTGAGE30US");
  const rate: RateObs | undefined = rateItem ? { value: rateItem.value, date: rateItem.date } : undefined;
  const estimate = affordability(home, rent, jobs, rate);
  if (home && !rate) caveats.push("Mortgage rate not loaded (FRED), so the payment estimate is missing.");
  const affordabilityProvenance: Provenance[] = [];
  if (estimate && home && a && rateItem) {
    affordabilityProvenance.push(zillowProvenance(a.level === "county" ? "zhviCounty" : "zhviState", home.asOf, at));
    affordabilityProvenance.push(fredProvenance(rateItem, at));
    if (jobs?.avgWeeklyWage != null) affordabilityProvenance.push(qcewProvenance(jobs.period, at, { area: qcewArea(a) }));
    affordabilityProvenance.push(estimateProvenance("zillow-zhvi", estimate.formula.join("; "), at, ["rate from FRED MORTGAGE30US (Freddie Mac PMMS)", "wage from BLS QCEW average weekly wage"]));
  }
  const affordabilitySection: MarketReport["affordability"] = {
    estimate,
    provenance: affordabilityProvenance,
    basis:
      "Estimate. Principal and interest on the typical home with 20% down over 30 years at this week's Freddie Mac average rate; compared with the average weekly wage of all jobs covered by unemployment insurance in the area (BLS QCEW), which is pay per job, not household income.",
  };

  const jobsFlag = jobs?.yoy.emp != null && jobs.yoy.emp < -1 ? "watch" : "ok";
  const jobsProvenance: Provenance[] = [];
  if (jobs && a) jobsProvenance.push(qcewProvenance(jobs.period, at, { area: qcewArea(a), notes: jobs.suppressed ? ["cell withheld by BLS (disclosure code N)"] : undefined }));
  if (src.sectors?.length && a) jobsProvenance.push(qcewProvenance(jobs?.period ?? null, at, { area: qcewArea(a), sectors: true, notes: ["location quotient = area sector share / national sector share, computed here from the same file"] }));
  const jobsSection: MarketReport["jobs"] = {
    title: "Jobs & wages",
    loaded: src.loaded.areas,
    summary: jobs
      ? jobs.suppressed
        ? `BLS withholds this area's totals (${jobs.period})`
        : `${fmtNum(jobs.emp)} jobs at ${fmtNum(jobs.estabs)} employers (${jobs.period}); ${fmtPct(jobs.yoy.emp)} jobs and ${fmtPct(jobs.yoy.avgWeeklyWage)} average weekly wage over the year`
      : "No QCEW row for this area",
    basis:
      "BLS Quarterly Census of Employment and Wages, all ownerships, total covered employment in the quarter's third month; over-the-year changes as published. Suppressed cells stay blank.",
    provenance: jobsProvenance,
    items: jobs && !jobs.suppressed ? [{ id: `${a!.level}:${a!.geoid}`, layer: "commerce", name: area!.name, value: `${fmtNum(jobs.emp)} jobs · ${fmtUsd(jobs.avgWeeklyWage)}/wk · ${fmtPct(jobs.yoy.emp)} YoY`, flag: jobsFlag }] : [],
    data: {
      period: jobs?.period ?? null,
      emp: jobs?.emp ?? null,
      estabs: jobs?.estabs ?? null,
      avgWeeklyWage: jobs?.avgWeeklyWage ?? null,
      yoyEmp: jobs?.yoy.emp ?? null,
      yoyWage: jobs?.yoy.avgWeeklyWage ?? null,
      sectors: src.sectors ?? [],
    },
  };

  // Trade gateways: ports by container volume then tonnage then harbour size; crossings by trucks.
  const portItems: MarketItem[] = [];
  const crossingItems: MarketItem[] = [];
  for (const f of src.trade as LayerFeature<Point>[]) {
    if (f.geometry.type !== "Point") continue;
    if (f.properties.kind === "port") {
      const d = km(lon, lat, f);
      if (d > MARKET_RADII_KM.ports) continue;
      const x = f.properties.extra as PortExtra;
      const s = x.stats;
      const size = x.wpi.size ?? "unlisted";
      if (!s && size !== "large" && size !== "medium") continue;
      const value = s?.container?.total != null
        ? `${fmtNum(s.container.total)} TEU ${s.year}${s.container.ranking != null ? ` · #${s.container.ranking} US` : ""}`
        : s?.tonnage?.total != null
          ? `${fmtNum(s.tonnage.total)} tons ${s.year}${s.tonnage.ranking != null ? ` · #${s.tonnage.ranking} US` : ""}`
          : `${size} harbour${x.wpi.channelM ? `, channel ${x.wpi.channelM.toFixed(1)} m` : ""}`;
      portItems.push({ id: f.properties.id, layer: "trade", name: f.properties.name, distanceKm: d, value, flag: s ? "ok" : undefined });
    } else if (f.properties.kind === "crossing") {
      const d = km(lon, lat, f);
      if (d > MARKET_RADII_KM.crossings) continue;
      const x = f.properties.extra as CrossingExtra;
      const t = x.measures.Trucks;
      crossingItems.push({
        id: f.properties.id,
        layer: "trade",
        name: f.properties.name,
        distanceKm: d,
        value: t ? `${fmtNum(t.latest)} trucks in ${monthLabel(t.latestDate)} · ${fmtPct(t.yoyPct)} YoY` : "no truck counts",
        flag: t?.yoyPct != null && t.yoyPct < -10 ? "watch" : undefined,
      });
    }
  }
  const rank = (i: MarketItem) => {
    const f = src.trade.find((t) => t.properties.id === i.id);
    const s = (f?.properties.extra as PortExtra | undefined)?.stats;
    return (s?.container?.total ?? 0) * 10 + (s?.tonnage?.total ?? 0) / 1e3;
  };
  portItems.sort((p, q) => rank(q) - rank(p) || p.distanceKm! - q.distanceKm!);
  crossingItems.sort((p, q) => {
    const tp = (src.trade.find((t) => t.properties.id === p.id)?.properties.extra as CrossingExtra | undefined)?.measures.Trucks?.latest ?? 0;
    const tq = (src.trade.find((t) => t.properties.id === q.id)?.properties.extra as CrossingExtra | undefined)?.measures.Trucks?.latest ?? 0;
    return tq - tp;
  });
  const tradeProvenance: Provenance[] = [];
  if (portItems.length) tradeProvenance.push(wpiProvenance(at));
  const btsYears = portItems.map((i) => (src.trade.find((t) => t.properties.id === i.id)?.properties.extra as PortExtra | undefined)?.stats?.year).filter((y): y is number => y != null);
  if (btsYears.length) tradeProvenance.push(btsPortsProvenance(Math.max(...btsYears), at));
  const crossingMonths = crossingItems.map((i) => (src.trade.find((t) => t.properties.id === i.id)?.properties.extra as CrossingExtra | undefined)?.asOf).filter((m): m is string => !!m);
  if (crossingItems.length) tradeProvenance.push(btsBorderProvenance(crossingMonths.length ? crossingMonths.sort().reverse()[0] : null, at));
  const tradeSection: MarketReport["trade"] = {
    title: "Trade gateways",
    loaded: src.loaded.trade,
    summary: !src.loaded.trade
      ? "Ports & trade layer not loaded"
      : portItems.length || crossingItems.length
        ? `${portItems.length} port${portItems.length === 1 ? "" : "s"} within ${MARKET_RADII_KM.ports} km, ${crossingItems.length} land crossing${crossingItems.length === 1 ? "" : "s"} within ${MARKET_RADII_KM.crossings} km`
        : `No medium or large harbour within ${MARKET_RADII_KM.ports} km and no land port of entry within ${MARKET_RADII_KM.crossings} km`,
    basis: "NGA World Port Index harbours (medium and large, or any with BTS statistics) and BTS Border Crossing Entry Data ports; BTS Port Performance volumes for the latest reporting year.",
    provenance: tradeProvenance,
    items: [...portItems.slice(0, 5), ...crossingItems.slice(0, 4)],
    data: { ports: portItems.length, crossings: crossingItems.length },
  };

  const pulseSection: MarketReport["pulse"] = {
    title: "National pulse",
    loaded: src.loaded.pulse,
    summary: src.pulse?.length ? `${src.pulse.length} national series, latest ${src.pulse.map((p) => p.date).sort().reverse()[0]}` : "National series not loaded",
    basis: "FRED series (Freddie Mac, Census, BEA, EIA, BLS, S&P) and BTS Supply Chain and Freight Indicators; each item carries its own date and source.",
    provenance: pulseProvenance(src.pulse ?? [], at),
    items: [],
    data: { items: src.pulse ?? [] },
  };

  const mom = momentum(home, rent, jobs);
  const momentumProvenance: Provenance[] =
    mom.score != null
      ? [estimateProvenance("zillow-zhvi", `momentum = ${mom.formula}; terms ${mom.terms.map((t) => `${t.name} ${fmtPct(t.raw)} / ±${t.scale}% × ${t.weight}`).join(", ")}`, at, ["terms from Zillow ZHVI, Zillow ZORI and BLS QCEW over-the-year changes"])]
      : [];
  const all = dedupeProvenance([
    homeSection.provenance,
    rentSection.provenance,
    affordabilitySection.provenance,
    jobsSection.provenance,
    tradeSection.provenance,
    pulseSection.provenance,
    momentumProvenance,
  ]);

  return {
    lon,
    lat,
    generatedAt: now,
    area,
    home: homeSection,
    rent: rentSection,
    affordability: affordabilitySection,
    jobs: jobsSection,
    trade: tradeSection,
    pulse: pulseSection,
    momentum: mom,
    caveats,
    provenance: all,
    citations: citationsOf(all),
  };
}

/** QCEW area code for an area: counties are their 5-digit GEOID, states are the 2-digit FIPS padded with 000. */
export function qcewArea(a: { level: "county" | "state"; geoid: string }): string {
  return a.level === "state" ? `${a.geoid.slice(0, 2)}000` : a.geoid;
}

/** Provenance of one report section by key, for callers that want to attach it next to a number. */
export function marketSectionProvenance(r: MarketReport): Record<"home" | "rent" | "affordability" | "jobs" | "trade" | "pulse", Provenance[]> {
  return { home: r.home.provenance, rent: r.rent.provenance, affordability: r.affordability.provenance, jobs: r.jobs.provenance, trade: r.trade.provenance, pulse: r.pulse.provenance };
}

/** Citation block for a report: one line per source, plus the estimate lines. */
export function marketCitations(r: MarketReport): string[] {
  return r.citations.length ? r.citations : citationsOf(r.provenance);
}

export function speakMarketReport(r: MarketReport): string {
  const parts: string[] = [];
  parts.push(r.area ? `Market report for ${r.area.name}.` : "Market report.");
  if (r.home.data.latest != null) parts.push(r.home.summary + ".");
  if (r.rent.data.latest != null) parts.push(r.rent.summary + ".");
  if (r.affordability.estimate) {
    const e = r.affordability.estimate;
    parts.push(`A mortgage on the typical home would run about ${fmtUsd(e.payment)} a month at ${e.ratePct.toFixed(2)} percent${e.wageSharePct != null ? `, ${e.wageSharePct.toFixed(0)} percent of one average job's pay` : ""}.`);
  }
  if (r.jobs.data.emp != null) parts.push(r.jobs.summary + ".");
  if (r.trade.items.length) parts.push(`Nearest gateways: ${r.trade.items.slice(0, 3).map((i) => i.name).join(", ")}.`);
  parts.push(r.momentum.score == null ? "Not enough terms for a momentum index." : `Momentum index ${r.momentum.score.toFixed(2)}, ${r.momentum.label}, an estimate.`);
  return parts.join(" ");
}

export function marketReportText(r: MarketReport): string {
  const lines: string[] = [];
  lines.push(`MARKET REPORT · ${r.area?.name ?? "no US area"} · ${r.lat.toFixed(3)}, ${r.lon.toFixed(3)} · ${new Date(r.generatedAt).toISOString()}`);
  lines.push("");
  for (const s of [r.home, r.rent, r.jobs, r.trade]) {
    lines.push(`${s.title.toUpperCase()}: ${s.summary}`);
    for (const i of s.items) lines.push(`  - ${i.name}${i.distanceKm != null ? ` (${i.distanceKm.toFixed(0)} km)` : ""}: ${i.value}`);
    lines.push(`  basis: ${s.basis}`);
    lines.push("");
  }
  if (r.affordability.estimate) {
    const e = r.affordability.estimate;
    lines.push(`AFFORDABILITY (estimate): ${fmtUsd(e.payment)}/mo principal and interest${e.wageSharePct != null ? `, ${e.wageSharePct.toFixed(0)}% of one average job's pay` : ""}${e.priceToRent != null ? `, price-to-rent ${e.priceToRent.toFixed(1)}` : ""}`);
    for (const f of e.formula) lines.push(`  ${f}`);
    lines.push(`  basis: ${r.affordability.basis}`);
    lines.push("");
  }
  lines.push(`MOMENTUM (estimate): ${r.momentum.score == null ? "n/a" : r.momentum.score.toFixed(2)} ${r.momentum.label}`);
  for (const t of r.momentum.terms) lines.push(`  ${t.name}: ${fmtPct(t.raw)} / ±${t.scale}% → ${t.value.toFixed(2)} × ${t.weight}`);
  if (r.momentum.missing.length) lines.push(`  missing: ${r.momentum.missing.join(", ")}`);
  lines.push(`  ${r.momentum.formula}`);
  lines.push("");
  if (r.pulse.data.items.length) {
    lines.push("NATIONAL PULSE");
    for (const p of r.pulse.data.items) lines.push(`  ${p.label}: ${fmtNum(p.value, 2)} ${p.unit} (${p.date}${p.changePct != null ? `, ${fmtPct(p.changePct)} vs prior` : ""}) · ${p.source}`);
    lines.push("");
  }
  if (r.caveats.length) {
    lines.push("CAVEATS");
    for (const c of r.caveats) lines.push(`  - ${c}`);
    lines.push("");
  }
  const cites = marketCitations(r);
  if (cites.length) {
    lines.push("SOURCES");
    for (const c of cites) lines.push(`  - ${c}`);
  }
  return lines.join("\n");
}
