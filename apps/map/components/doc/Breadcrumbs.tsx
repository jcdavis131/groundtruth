// United States / Texas / Austin-Round Rock-San Marcos / Travis County.
//
// The visible half of the same trail that breadcrumbJsonLd emits, built from
// the same array so the two cannot disagree — a BreadcrumbList that claims a
// path the page does not show is the kind of mismatch that gets structured
// data ignored. The last crumb is the current page and is not a link.

import Link from "next/link";

export interface BreadcrumbTrail {
  trail: Array<{ name: string; url: string }>;
}

export default function Breadcrumbs({ trail }: BreadcrumbTrail) {
  if (trail.length === 0) return null;
  const last = trail.length - 1;
  return (
    <nav aria-label="Breadcrumb" className="text-[13px] leading-snug text-muted-foreground">
      <ol className="flex flex-wrap items-baseline gap-x-1.5">
        {trail.map((c, i) => (
          <li key={c.url} className="flex items-baseline gap-x-1.5">
            {i === last ? (
              <span aria-current="page" className="text-foreground">
                {c.name}
              </span>
            ) : (
              <Link href={c.url} className="text-primary underline">
                {c.name}
              </Link>
            )}
            {i === last ? null : <span aria-hidden="true">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
