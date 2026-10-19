// The metropolitan area index, grouped by state.
//
// 393 metros, every one of them derivable with no network at all: the table is
// generated offline from the committed BLS OEWS metro index, which is also
// what lets a metro page render its full occupation mix during an outage. So
// this hub is complete in a way the county hub is not, and it says so.
//
// A metro that crosses a state line is listed under each of its states rather
// than under the first one. Kansas City is a Missouri question and a Kansas
// question, and a reader who came looking from either side should find it.
//
// Ethics: places only.

import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import Section from "@/components/doc/Section";

import { num } from "@/lib/brief/format";
import type { SectionState } from "@/lib/places/facts";
import { COUNTRY_LABEL, COUNTRY_URL } from "@/lib/places/links";
import { MANIFEST, allUsps, metrosInState, stateByUsps } from "@/lib/places/registry";
import { absoluteUrl } from "@/lib/seo/base";

/** A day. The metro table is bundled and changes only with a deploy. */
export const revalidate = 86400;

/** ISR regeneration is a serverless render like any other, even one that reads only bundled JSON. */
export const maxDuration = 60;

const TITLE = "US metropolitan areas";

const DESCRIPTION =
  "Every US metropolitan statistical area: its occupation mix from the federal wage survey, its housing market, and the counties that make it up. Sources and periods are printed on each page.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/metro") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl("/metro"), type: "website" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

function manifestState(): SectionState {
  return { status: "fresh", asOf: MANIFEST.pulled, retrievedAt: MANIFEST.pulled ?? "" };
}

export default function MetroHub() {
  const groups = allUsps()
    .map((usps) => ({ usps, name: stateByUsps(usps)?.name ?? usps, metros: metrosInState(usps) }))
    .filter((g) => g.metros.length > 0);

  const listed = new Set(groups.flatMap((g) => g.metros.map((m) => m.cbsa))).size;

  return (
    <article>
      <Breadcrumbs
        trail={[
          { name: COUNTRY_LABEL, url: COUNTRY_URL },
          { name: "Metropolitan areas", url: "/metro" },
        ]}
      />

      <header className="mt-2">
        <h1 className="text-[30px] font-semibold leading-tight text-foreground">Metropolitan areas</h1>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
          A metropolitan area is the labour market a commute actually covers, which is why the federal wage
          survey publishes an occupation mix for each one and why the housing indices publish a metro row.
          Each page prints the top thirty occupations and all twenty-two major groups, the metro housing
          market, and a jobs estimate rolled up from the member counties with its arithmetic shown and its
          withheld counties named rather than counted as zero.
        </p>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-muted-foreground">
          A metro address is its five-digit CBSA code: <span className="tabular-nums">/metro/41700</span> is
          San Antonio&ndash;New Braunfels. All {num(MANIFEST.metroCount)} areas are listed; the table is derived
          offline from the bundled wage survey index, so an unknown code is a genuine 404 rather than a gap
          waiting on a pull.
        </p>
      </header>

      <Section
        id="by-state"
        title="By state"
        state={manifestState()}
        summary={`${num(listed)} metropolitan areas across ${num(groups.length)} states. An area that spans a state line appears under each of its states.`}
        basis="Names and CBSA codes come from the bundled BLS OEWS metropolitan index; the state list for each area is read from its published title. Membership counties are filled in by the network pull and are not needed to reach a page."
      >
        <div className="mt-4 space-y-6">
          {groups.map((g) => (
            <section key={g.usps} id={`state-${g.usps}`}>
              <h3 className="text-[15px] font-semibold leading-tight text-foreground">
                <Link href={`/state/${g.usps}`} className="text-primary underline">
                  {g.name}
                </Link>{" "}
                <span className="font-normal text-muted-foreground">({num(g.metros.length)})</span>
              </h3>
              <ul className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {g.metros.map((m) => (
                  <li key={m.cbsa} className="text-[15px] leading-snug">
                    <Link href={`/metro/${m.cbsa}`} className="text-primary underline">
                      {m.name}
                    </Link>{" "}
                    <span className="tabular-nums text-muted-foreground">{m.cbsa}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Section>
    </article>
  );
}
