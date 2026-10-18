// The in-content link block: roughly twenty server-rendered links that stop
// every place page being a sitemap-only orphan.
//
// Each group is rendered only when lib/places/links.ts filled it. That is not
// cosmetic tidiness: before a host with egress has run the manifest pull there
// is no adjacency table and no CBSA membership, so `neighbours` and
// `sameMetro` come back empty, and an empty heading would advertise a missing
// relationship rather than simply not claiming one. `sameState` is built from
// the state table, which is complete offline, so the block never disappears
// entirely.
//
// Ethics: every href here addresses a place, a comparison of two places or a
// place's brief. Nothing addresses a person, a parcel or a building.

import Link from "next/link";
import type { LinkSets, PlaceLink } from "@/lib/places/links";

function Group({ title, links }: { title: string; links: PlaceLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {links.map((l) => (
          <li key={l.href} className="text-[14px] leading-snug">
            <Link href={l.href} className="text-primary underline">
              {l.label}
            </Link>
            {l.sub ? <span className="text-muted-foreground"> {l.sub}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PlaceLinks({ links }: { links: LinkSets }) {
  return (
    <nav aria-label="Related places" className="mt-8 border-t border-border pt-5">
      <h2 id="related" className="text-[19px] font-semibold leading-tight text-foreground">
        Related places{" "}
        <a href="#related" className="text-muted-foreground no-underline hover:text-primary" aria-label="Link to Related places">
          #
        </a>
      </h2>
      <Group title="Up" links={links.up} />
      <Group title="Neighbouring counties" links={links.neighbours} />
      <Group title="Rest of the metropolitan area" links={links.sameMetro} />
      <Group title="Largest counties in the state" links={links.sameState} />
      <Group title="Side by side" links={links.compare} />
      <Group title="Brief" links={[links.brief]} />
      <div className="mt-4">
        <h3 className="text-[15px] font-semibold text-foreground">Subscribe</h3>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <li className="text-[14px] leading-snug">
            <a href={links.feeds.rss} className="text-primary underline">
              RSS
            </a>
          </li>
          <li className="text-[14px] leading-snug">
            <a href={links.feeds.json} className="text-primary underline">
              JSON Feed
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
}
