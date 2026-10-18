// The grid the headline Stats sit in, and the one place the percentile
// footnote is printed.
//
// percentileBasisNote() is printed once per page rather than under every
// number, because every percentile on the page is computed the same way and
// repeating it twelve times would train the reader to skip it. The note
// matters: lib/screener/engine.ts scales AVERAGE RANK between 0 and 100, so
// the smallest published value scores 0 and the largest scores 100. A reader
// who assumes "percent of counties below" will read 0 as "none below" when it
// means "smallest", and that misreading is on us if we do not say so.

import type { ReactNode } from "react";
import { percentileBasisNote } from "@/lib/places/percentiles";

export interface StatGridProps {
  children?: ReactNode;
  /** Set false on a grid whose Stats carry no peers, so the footnote is not orphaned. */
  note?: boolean;
}

export default function StatGrid({ children, note = true }: StatGridProps) {
  return (
    <div className="mt-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      {note ? (
        <p className="mt-3 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">{percentileBasisNote()}</p>
      ) : null}
    </div>
  );
}
