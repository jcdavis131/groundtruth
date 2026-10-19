import Link from "next/link";

// The 404 as one composed frame: the corner brackets, the axis ticks, the
// reticle with nothing under it, the code, one line, and the way back. Used
// by the globe's not-found and by the app-wide global-not-found.
export default function NotFoundFrame() {
  return (
    <main className="relative flex h-full items-center justify-center overflow-hidden p-8 text-center">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="hud-corner left-3 top-3 border-l border-t" />
        <div className="hud-corner right-3 top-3 border-r border-t" />
        <div className="hud-corner bottom-3 left-3 border-b border-l" />
        <div className="hud-corner bottom-3 right-3 border-b border-r" />
        <span className="frame-tick frame-tick-n top-0" />
        <span className="frame-tick frame-tick-s bottom-0" />
        <span className="frame-tick frame-tick-w left-0" />
        <span className="frame-tick frame-tick-e right-0" />
      </div>
      <div className="flex flex-col items-center">
        <div className="reticle mb-10 opacity-70" aria-hidden>
          <span className="reticle-tick reticle-n" />
          <span className="reticle-tick reticle-s" />
          <span className="reticle-tick reticle-e" />
          <span className="reticle-tick reticle-w" />
        </div>
        <div className="hud-label text-[9px]">Error 404 · no signal</div>
        <h1 className="title-card-name mt-5 text-[clamp(28px,6vw,48px)]">Nothing here</h1>
        <div className="title-card-rule title-card-rule-solo" aria-hidden />
        <p className="text-[12px] text-foreground/75">There is no view at this address.</p>
        <Link
          href="/"
          className="mt-8 inline-flex h-9 items-center border border-border px-4 text-[10px] uppercase tracking-[0.22em] text-foreground hover:bg-accent hover:text-primary"
        >
          Back to the globe
        </Link>
      </div>
    </main>
  );
}
