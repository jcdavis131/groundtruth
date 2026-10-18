// The state index, and the root of the crawl tree.
//
// lib/places/links.ts calls this page "United States": it is what the top
// breadcrumb on every county, metro and state document points at, so it is
// the one node the whole place graph hangs from. Four clicks does not exist
// here — root, state, county, brief.
//
// The largest-metro column is the only number on this page that does not come
// from the place manifest. It comes from the bundled federal wage survey
// index, which carries an employment total per metropolitan area and is
// committed to the repo, so it is still zero network and still prerenderable.
// It is labelled as employment in the metro area, not in the state.
//
// Ethics: places only.

import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FactTable from "@/components/doc/FactTable";
import Section from "@/components/doc/Section";

import { MISSING, num } from "@/lib/brief/format";
import { OEWS_AS_OF, oewsMsaIndex } from "@/lib/economy/oews";
import type { SectionState } from "@/lib/places/facts";
import { COUNTRY_LABEL, COUNTRY_URL } from "@/lib/places/links";
import { MANIFEST, allUsps, metrosInState, stateByUsps } from "@/lib/places/registry";
import { absoluteUrl } from "@/lib/seo/base";

/** A day. Both tables this page reads are bundled and change only with a deploy. */
export const revalidate = 86400;

/** ISR regeneration is a serverless render like any other, even one that reads only bundled JSON. */
export const maxDuration = 60;

const TITLE = "US states";

const DESCRIPTION =
  "Housing, jobs, wages and federal spending for every US state, the District of Columbia and Puerto Rico, each page listing its largest counties and its metropolitan areas.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/state") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl("/state"), type: "website" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

const COLUMNS = [
  { key: "state", label: "State" },
  { key: "usps", label: "USPS" },
  { key: "metro", label: "Largest metropolitan area" },
  { key: "jobs", label: "Its jobs", align: "right" as const },
  { key: "metros", label: "Metro areas", align: "right" as const },
];

function manifestState(): SectionState {
  return { status: "fresh", asOf: MANIFEST.pulled, retrievedAt: MANIFEST.pulled ?? "" };
}

/** Employment by CBSA from the bundled wage survey; a metro with no published total simply does not win. */
const EMP = new Map<string, number | null>(oewsMsaIndex().msas.map((m) => [m.id, m.emp]));

export default function StateHub() {
  const rows = allUsps().map((usps) => {
    const ref = stateByUsps(usps);
    const metros = metrosInState(usps);
    let largest = metros[0] ?? null;
    let largestEmp = largest ? (EMP.get(largest.cbsa) ?? null) : null;
    for (const m of metros) {
      const emp = EMP.get(m.cbsa) ?? null;
      if (emp != null && (largestEmp == null || emp > largestEmp)) {
        largest = m;
        largestEmp = emp;
      }
    }
    return {
      usps,
      name: ref?.name ?? usps,
      metros: metros.length,
      largest,
      largestEmp,
    };
  });

  return (
    <article>
      <Breadcrumbs trail={[{ name: COUNTRY_LABEL, url: COUNTRY_URL }]} />

      <header className="mt-2">
        <h1 className="text-[30px] font-semibold leading-tight text-foreground">United States</h1>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
          Fifty states, the District of Columbia and Puerto Rico. Each state page carries the state housing
          index, covered employment and wages by sector from the quarterly census, and the twelve counties
          with the most jobs &mdash; which is also the path down to the county documents.
        </p>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-muted-foreground">
          A state address is its two-letter postal abbreviation:{" "}
          <span className="tabular-nums">/state/TX</span>. Counties are indexed at{" "}
          <Link href="/place" className="text-primary underline">
            /place
          </Link>{" "}
          and metropolitan areas at{" "}
          <Link href="/metro" className="text-primary underline">
            /metro
          </Link>
          .
        </p>
      </header>

      <Section
        id="states"
        title="States"
        state={manifestState()}
        summary={`All ${num(rows.length)} state pages, with the largest metropolitan area in each by surveyed employment.`}
        basis={`Names and codes come from the bundled place manifest. The employment figure is the BLS Occupational Employment and Wage Statistics total for that METROPOLITAN AREA as of ${OEWS_AS_OF} — it is the metro's total, not the state's, and a metro that crosses a state line carries its whole total into each state it touches.`}
      >
        <FactTable
          columns={COLUMNS}
          rows={rows.map((r) => ({
            key: r.usps,
            cells: [
              { text: r.name, href: `/state/${r.usps}` },
              r.usps,
              r.largest
                ? { text: r.largest.name, href: `/metro/${r.largest.cbsa}` }
                : "no metropolitan area listed",
              r.largestEmp == null ? MISSING : num(r.largestEmp),
              num(r.metros),
            ],
          }))}
          caption="The states, each linked to its own document and to its largest metropolitan area."
        />
      </Section>
    </article>
  );
}
