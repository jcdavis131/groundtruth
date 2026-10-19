// Jev's answer for one place: world_context's bundle as short sections
// (lib/jev/format.ts holds the rules). Presentational and pure, so the render
// tests read exactly what a visitor sees.
//
// Motion, one quiet move: each section fades up in topic order from a visible
// resting state (the jev-fade keyframe starts at a readable opacity). With
// reducedMotion no animation class or delay is applied at all, and globals.css
// turns the keyframe off under prefers-reduced-motion as well.

import { jevSections, JEV_SECTIONS, JEV_TITLES, type JevBundle, type JevLine, type JevSection } from "@/lib/jev/format";

export const JEV_FADE_CLASS = "jev-fade";
const STAGGER_MS = 90;

function motion(i: number, reducedMotion: boolean): { className: string; style?: React.CSSProperties } {
  if (reducedMotion) return { className: "" };
  return { className: JEV_FADE_CLASS, style: { animationDelay: `${i * STAGGER_MS}ms` } };
}

function Line({ l }: { l: JevLine }) {
  return (
    <li data-jev-line="" className="text-[10px] leading-snug" title={l.note}>
      <span className="text-muted-foreground">{l.fact}</span>{" "}
      <span data-jev-value="" data-jev-from-note={l.fromNote ? "" : undefined} className={l.fromNote ? "text-foreground/75 italic" : "text-foreground/90"}>
        {l.text}
      </span>
      <span className="text-[9px] text-muted-foreground">
        {" · "}
        {l.publisher}
        {l.period ? ` · ${l.period}` : ""}
        {l.asOf ? ` · as of ${l.asOf}` : ""}
        {l.aboutEye ? " · about this atlas" : ""}
        {" · "}
        <a data-jev-source="" href={l.href} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-primary">
          source
        </a>
      </span>
    </li>
  );
}

function Section({ s, i, reducedMotion }: { s: JevSection; i: number; reducedMotion: boolean }) {
  const m = motion(i, reducedMotion);
  return (
    <section data-jev-section={s.key} className={["border-t border-border/60 px-3 py-1.5", m.className].filter(Boolean).join(" ")} style={m.style}>
      <div className="flex items-baseline gap-2">
        <h3 className="hud-label">{s.title}</h3>
        {s.marker && (
          <span data-jev-marker={s.key} className="ml-auto text-[9px] uppercase tracking-widest text-amber-500/90">
            {s.marker}
          </span>
        )}
      </div>
      {s.lines.length > 0 && (
        <ul>
          {s.lines.map((l, j) => (
            <Line key={`${l.fact}:${j}`} l={l} />
          ))}
        </ul>
      )}
      {s.gaps.length > 0 && (
        <ul className="mt-0.5">
          {s.gaps.map((g, j) => (
            <li key={`${g.what}:${j}`} data-jev-gap="" className="text-[10px] leading-snug text-muted-foreground">
              {g.sentence}
            </li>
          ))}
        </ul>
      )}
      {s.lines.length === 0 && s.gaps.length === 0 && <div className="text-[10px] text-muted-foreground">world_context returned nothing for this topic.</div>}
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

export default function JevAnswer({ bundle, reducedMotion }: { bundle: JevBundle; reducedMotion: boolean }) {
  const sections = jevSections(bundle);
  return (
    <div data-jev-answer="">
      {sections.map((s, i) => (
        <Section key={s.key} s={s} i={i} reducedMotion={reducedMotion} />
      ))}
    </div>
  );
}
