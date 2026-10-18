// Pure markdown builder for the desk Notes tab: the operator's text, the
// permalink of the view, and citation lines for whichever reports are open.
// Reports are passed in a narrow shape so this file needs neither the water
// nor the market report types (and tests need no fixtures for them).

export interface ReportCite {
  /** "Market report", "Community water report". */
  title: string;
  /** Area name or formatted lat/lon. */
  place: string;
  /** Epoch ms the report was built. */
  generatedAt: number;
  /** Section title + the basis line the report prints under it. Unloaded sections are skipped. */
  sections: Array<{ title: string; basis: string; loaded: boolean }>;
  caveats: string[];
}

export interface NotesInput {
  notes: string;
  /** Permalink to the view (lib/globe/share.ts shareUrl(), with mode=desk kept). */
  url: string;
  /** Epoch ms now; injected for deterministic tests. */
  now: number;
  reports?: ReportCite[];
  /** Series on the chart, for a "Data" list. */
  series?: Array<{ label: string; id: string; source: string }>;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/** Citation lines for one report: every loaded section's basis plus caveats. */
export function citeReport(r: ReportCite): string[] {
  const out = [`- **${r.title}**, ${r.place}, generated ${iso(r.generatedAt)}`];
  for (const s of r.sections) {
    if (!s.loaded) continue;
    out.push(`  - ${s.title}: ${s.basis}`);
  }
  for (const c of r.caveats) out.push(`  - Caveat: ${c}`);
  return out;
}

/**
 * The note as a markdown document. Sections are omitted when empty so a bare
 * note copies as just a heading, the text and the link.
 */
export function notesMarkdown(input: NotesInput): string {
  const lines: string[] = [`# Embedding Atlas notes`, "", `_${iso(input.now)} · [permalink](${input.url})_`, ""];
  const text = input.notes.trim();
  if (text) lines.push(text, "");
  if (input.series && input.series.length > 0) {
    lines.push("## Data on the chart", "");
    for (const s of input.series) lines.push(`- ${s.label} (\`${s.id}\`, ${s.source})`);
    lines.push("");
  }
  if (input.reports && input.reports.length > 0) {
    lines.push("## Sources of the open reports", "");
    for (const r of input.reports) lines.push(...citeReport(r));
    lines.push("");
  }
  lines.push("---", "Aggregates only; estimates print their arithmetic. No data about private individuals.");
  return lines.join("\n") + "\n";
}
