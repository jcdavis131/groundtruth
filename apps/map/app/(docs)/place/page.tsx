// The county index: where a crawler and a reader both start.
//
// Without this page the ~3,235 county documents would be reachable only from
// a sitemap, which is the textbook orphan pattern — a URL a search engine has
// been told about but that nothing on the site links to. Here every state is
// one click from the root and every county is one click from its state, so
// the deepest document in the product sits three clicks down.
//
// Everything on this page comes from the bundled place manifest. No fetch, no
// cache, no upstream: that is what makes it one of the handful of new routes
// that can genuinely prerender on a build host with no network egress.
//
// The honesty constraint: while the county table is a seed rather than a pull,
// the per-state counts are counts of what the manifest NAMES, not of what
// exists, and the page says so in one sentence rather than letting a reader
// conclude that Texas has two counties.
//
// Ethics: places only. Names, states, codes.

import type { Metadata } from "next";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FactTable from "@/components/doc/FactTable";
import Section from "@/components/doc/Section";

import { num } from "@/lib/brief/format";
import type { SectionState } from "@/lib/places/facts";
import { COUNTRY_LABEL, COUNTRY_URL } from "@/lib/places/links";
import { MANIFEST, allUsps, countiesInState, countyLabel, metrosInState, stateByUsps } from "@/lib/places/registry";
import { absoluteUrl } from "@/lib/seo/base";

/** A day. The manifest is bundled, so this page changes only when a deploy changes it. */
export const revalidate = 86400;

/** ISR regeneration is a serverless render like any other, even one that reads only bundled JSON. */
export const maxDuration = 60;

const TITLE = "US counties by state";

const DESCRIPTION =
  "Housing, jobs, water and federal spending for every US county, indexed by state. Each county page prints its sources, its periods and the arithmetic behind every estimate.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/place") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl("/place"), type: "website" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

const STATE_COLUMNS = [
  { key: "state", label: "State" },
  { key: "usps", label: "USPS" },
  { key: "counties", label: "Counties listed", align: "right" as const },
  { key: "metros", label: "Metro areas", align: "right" as const },
];

const COUNTY_COLUMNS = [
  { key: "county", label: "County" },
  { key: "fips", label: "FIPS", align: "right" as const },
];

/** The manifest is the source, so a section is current as of the pull — or of this build when there has been none. */
function manifestState(): SectionState {
  const stamp = MANIFEST.pulled ?? "";
  return { status: "fresh", asOf: MANIFEST.pulled, retrievedAt: stamp };
}

const COMPLETENESS = MANIFEST.countiesComplete
  ? `The county table was pulled on ${MANIFEST.pulled ?? "an unrecorded date"} and names ${num(MANIFEST.countyCount)} counties and county equivalents. A five-digit code outside it is a genuine 404.`
  : `The county table in this build is a seed rather than a pull: it names ${num(MANIFEST.countyCount)} of roughly 3,143 counties and county equivalents. Every real county address still resolves — /place/48453 is checked against the complete 52-row state table and fetches its own identity — but the counts below are counts of what the manifest names today, not of what exists.`;

export default function PlaceHub() {
  const rows = allUsps().map((usps) => {
    const ref = stateByUsps(usps);
    return {
      usps,
      name: ref?.name ?? usps,
      counties: countiesInState(usps),
      metros: metrosInState(usps).length,
    };
  });

  const named = rows.flatMap((r) => r.counties);

  return (
    <article>
      <Breadcrumbs
        trail={[
          { name: COUNTRY_LABEL, url: COUNTRY_URL },
          { name: "Counties", url: "/place" },
        ]}
      />

      <header className="mt-2">
        <h1 className="text-[30px] font-semibold leading-tight text-foreground">Counties</h1>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
          One document per county: typical home value and rent, covered employment and wages from the
          quarterly census, the reservoirs and stream gauges within reach of the county&rsquo;s internal point,
          the banks chartered there and the federal money that landed. Every number carries its publisher,
          its period and, when it is an estimate, the arithmetic that produced it.
        </p>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-muted-foreground">
          A county address is its five-digit FIPS code: <span className="tabular-nums">/place/48453</span> is
          Travis County, Texas. {COMPLETENESS}
        </p>
      </header>

      <Section
        id="states"
        title="Browse by state"
        state={manifestState()}
        summary={`All ${num(rows.length)} states, the District of Columbia and Puerto Rico. Each state page lists its largest counties and its metropolitan areas.`}
        basis="Counts come from the bundled place manifest. The metro column counts metropolitan statistical areas that lie wholly or partly in the state, so a metro spanning a state line is counted on both sides."
      >
        <FactTable
          columns={STATE_COLUMNS}
          rows={rows.map((r) => ({
            key: r.usps,
            cells: [{ text: r.name, href: `/state/${r.usps}` }, r.usps, num(r.counties.length), num(r.metros)],
          }))}
          caption="The states, with the counties and metropolitan areas the place manifest names in each."
        />
      </Section>

      {MANIFEST.countiesComplete ? null : (
        <Section
          id="named"
          title="Counties named in this build"
          state={manifestState()}
          summary={`The ${num(named.length)} counties the seed manifest can name without a network pull. Every other county is still reachable by its FIPS code.`}
          basis="The seed is the union of the screener's county fixtures and the counties in the bundled company table. It is what the manifest can say offline; it is not a list of the counties that exist."
        >
          <FactTable
            columns={COUNTY_COLUMNS}
            rows={named.map((c) => ({
              key: c.geoid,
              cells: [{ text: countyLabel(c), href: `/place/${c.geoid}` }, c.geoid],
            }))}
            caption="Counties the bundled manifest names by hand, pending a full pull."
          />
        </Section>
      )}
    </article>
  );
}
