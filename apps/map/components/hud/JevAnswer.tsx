// Jev's answer for one place: world_context's bundle as short sections
// (lib/jev/format.ts holds the rules, lib/jev/plain.ts the person-facing
// words). Presentational and pure, so the render tests read exactly what a
// visitor sees.
//
// Acronyms: one Glosser per answer, fed in reading order during this render,
// spells each acronym out on first use and gives later uses an <abbr> title
// (lib/jev/glossary.ts). `seen` names the ones the panel's header already
// spelled out. The glosser is rebuilt on every render, so a repeated render
// (React's strict mode) reads the same.
//
// Motion, one quiet move: each section fades up in topic order from a visible
// resting state (the jev-fade keyframe starts at a readable opacity). With
// reducedMotion no animation class or delay is applied at all, and globals.css
// turns the keyframe off under prefers-reduced-motion as well.

import { Glosser, type Seg } from "@/lib/jev/glossary";
import { jevSections, truncatedNote, JEV_SECTIONS, JEV_TITLES, type JevBundle, type JevLine, type JevSection } from "@/lib/jev/format";

export const JEV_FADE_CLASS = "jev-fade";
const STAGGER_MS = 90;

function motion(i: number, reducedMotion: boolean): { className: string; style?: React.CSSProperties } {
  if (reducedMotion) return { className: "" };
  return { className: JEV_FADE_CLASS, style: { animationDelay: `${i * STAGGER_MS}ms` } };
}

/** Text with its acronyms: written out in full on first use, an <abbr> after. */
export function Gl({ segs }: { segs: readonly Seg[] }) {
  return (
    <>
      {segs.map((s, i) =>
        typeof s === "string" ? (
          s
        ) : s.first ? (
          <span key={i}>
            {s.abbr} ({s.full})
          </span>
        ) : (
          <abbr key={i} title={s.full} className="no-underline">
            {s.abbr}
          </abbr>
        ),
      )}
    </>
  );
}

interface RichLine {
  l: JevLine;
  fact: Seg[];
  id: Seg[] | null;
  /** Null-valued lines show their note in plain words, glossed; a real value is the record's own words and is left as it is. */
  text: Seg[];
  note: Seg[] | null;
  publisher: Seg[];
}

interface RichSection {
  s: JevSection;
  marker: Seg[] | null;
  lines: RichLine[];
  cuts: Seg[][];
  gaps: Seg[][];
}

function enrich(sections: JevSection[], g: Glosser): RichSection[] {
  return sections.map((s) => ({
    s,
    marker: s.marker ? g.gloss(s.marker) : null,
    lines: s.lines.map((l) => ({
      l,
      fact: g.gloss(l.fact),
      id: l.id ? g.gloss(l.id) : null,
      text: l.fromNote ? g.gloss(l.text) : [l.text],
      // Reading order: publisher before the note under it.
      publisher: g.gloss(l.publisher),
      note: l.note ? g.gloss(l.note) : null,
    })),
    cuts: s.cuts.map((c) => g.gloss(c)),
    gaps: s.gaps.map((gap) => g.gloss(gap.sentence)),
  }));
}

function Line({ r }: { r: RichLine }) {
  const { l } = r;
  return (
    <li data-jev-line="" className="text-[10px] leading-snug">
      <span className="text-muted-foreground">
        <Gl segs={r.fact} />
      </span>{" "}
      {r.id && (
        <>
          <span data-jev-id="" className="font-mono text-foreground/80">
            <Gl segs={r.id} />
          </span>{" "}
        </>
      )}
      <span data-jev-value="" data-jev-from-note={l.fromNote ? "" : undefined} className={l.fromNote ? "text-foreground/75 italic" : "text-foreground/90"}>
        <Gl segs={r.text} />
      </span>
      <span className="text-[9px] text-muted-foreground">
        {" · "}
        <Gl segs={r.publisher} />
        {l.period ? ` · ${l.period}` : ""}
        {l.asOf ? ` · as of ${l.asOf}` : ""}
        {l.aboutEye ? " · about this atlas" : ""}
        {" · "}
        <a data-jev-source="" href={l.href} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-primary">
          source
        </a>
      </span>
      {r.note && (
        <span data-jev-note="" className="block text-[9px] leading-snug text-muted-foreground/90">
          <Gl segs={r.note} />
        </span>
      )}
    </li>
  );
}

function Section({ r, i, reducedMotion }: { r: RichSection; i: number; reducedMotion: boolean }) {
  const { s } = r;
  const m = motion(i, reducedMotion);
  return (
    <section data-jev-section={s.key} className={["border-t border-border/60 px-3 py-1.5", m.className].filter(Boolean).join(" ")} style={m.style}>
      <div className="flex items-baseline gap-2">
        <h3 className="hud-label">{s.title}</h3>
        {r.marker && (
          <span data-jev-marker={s.key} className="ml-auto text-[9px] uppercase tracking-widest text-amber-500/90">
            <Gl segs={r.marker} />
          </span>
        )}
      </div>
      {r.lines.length > 0 && (
        <ul>
          {r.lines.map((line, j) => (
            <Line key={`${line.l.fact}:${j}`} r={line} />
          ))}
        </ul>
      )}
      {r.cuts.length > 0 && (
        <ul className="mt-0.5">
          {r.cuts.map((c, j) => (
            <li key={j} data-jev-cut="" className="text-[9px] leading-snug text-muted-foreground">
              <Gl segs={c} />
            </li>
          ))}
        </ul>
      )}
      {r.gaps.length > 0 && (
        <ul className="mt-0.5">
          {r.gaps.map((g, j) => (
            <li key={`${s.gaps[j].what}:${j}`} data-jev-gap="" className="text-[10px] leading-snug text-muted-foreground">
              <Gl segs={g} />
            </li>
          ))}
        </ul>
      )}
      {s.lines.length === 0 && s.gaps.length === 0 && <div className="text-[10px] text-muted-foreground">Nothing came back for this topic.</div>}
    </section>
  );
}

/** The sections at rest, before the reply: titles only, readable, no motion. */
export function JevResting() {
  return (
    <>
      {JEV_SECTIONS.map((k) => (
        <section key={k} data-jev-resting={k} className="border-t border-border/60 px-3 py-1.5">
          <h3 className="hud-label text-muted-foreground/70">{JEV_TITLES[k]}</h3>
        </section>
      ))}
    </>
  );
}

export default function JevAnswer({ bundle, reducedMotion, seen = [] }: { bundle: JevBundle; reducedMotion: boolean; seen?: readonly string[] }) {
  const g = new Glosser(seen);
  const sections = enrich(jevSections(bundle), g);
  const trimmed = truncatedNote(bundle);
  return (
    <div data-jev-answer="">
      {trimmed && (
        <div data-jev-truncated="" className="px-3 py-1 text-[9px] text-muted-foreground">
          {trimmed}
        </div>
      )}
      {sections.map((r, i) => (
        <Section key={r.s.key} r={r} i={i} reducedMotion={reducedMotion} />
      ))}
    </div>
  );
}
