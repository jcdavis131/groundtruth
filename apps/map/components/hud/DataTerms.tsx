// Disclaimers a data publisher requires on the site itself, verbatim. Rendered
// in the About dialog; a plain component so a test can render it without the
// dialog.

import { CHICAGO_DISCLAIMER, CHICAGO_TERMS_URL } from "@/lib/civic/terms";

export default function DataTerms() {
  return (
    <section>
      <div className="hud-label mb-1">Data terms</div>
      <p className="text-foreground/80">
        The zoning, building permit and business licence layers use City of Chicago data. Its{" "}
        <a href={CHICAGO_TERMS_URL} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-primary">
          terms of use
        </a>{" "}
        ask for this disclaimer, verbatim:
      </p>
      <blockquote className="mt-1 border-l-2 border-border pl-2 text-muted-foreground">{CHICAGO_DISCLAIMER}</blockquote>
    </section>
  );
}
