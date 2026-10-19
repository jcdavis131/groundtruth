"use client";
// The Ask Jev panel (?jev=1): world_context's bundle for the place a visitor
// picked, as short cited sections. Loaded only through AskJevOverlay, so with
// the flag off none of this code is in the page.
//
// Screen readers hear one short status line ("Answer loaded: 12 facts, 3
// gaps"), not the whole answer: only that line is aria-live. Escape inside the
// panel closes it; focus moves into the panel when it opens and back to the
// opener when it closes; opened from What's here, it scrolls into view
// (instantly under reduced motion). The rules are lib/jev/focus.ts.

import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { MessageCircleQuestionMark, X } from "lucide-react";
import { closeJev, useJev, type JevState } from "@/lib/jev/store";
import { jevStatusLine, placeSubtitle, placeTitle } from "@/lib/jev/format";
import { Glosser } from "@/lib/jev/glossary";
import { isCloseKey, scrollOptions, scrollsOnOpen } from "@/lib/jev/focus";
import JevAnswer, { Gl, JevResting } from "./JevAnswer";

const ACCENT = "#A5B4FC";
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribeMotion(cb: () => void): () => void {
  const mq = typeof window !== "undefined" ? window.matchMedia?.(QUERY) : undefined;
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
}
const reducedNow = () => (typeof window !== "undefined" && window.matchMedia?.(QUERY).matches) || false;
const reducedOnServer = () => true;

type ViewState = Pick<JevState, "asked" | "status" | "bundle" | "error">;

/** The panel as drawn, from plain props: what the render tests read. */
export function JevPanelView({
  state,
  reducedMotion,
  onClose,
  panelRef,
}: {
  state: ViewState;
  reducedMotion: boolean;
  onClose: () => void;
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  const { asked, status, bundle } = state;
  const title = bundle ? placeTitle(bundle) : (asked ?? "this place");
  const g = new Glosser();
  const sub = bundle ? placeSubtitle(bundle) : null;
  const subSegs = sub ? g.gloss(sub) : null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isCloseKey(e.key)) return;
    // Stops here: the cockpit's window-level Escape (deselect) does not also fire.
    e.stopPropagation();
    onClose();
  };
  return (
    <div
      ref={panelRef}
      data-jev-panel=""
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="hud-panel pointer-events-auto outline-none"
      role="region"
      aria-label="Ask Jev"
      aria-busy={status === "loading"}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: ACCENT }}>
            <MessageCircleQuestionMark className="mr-1 inline size-3" />
            Ask Jev
          </div>
          <div data-jev-title="" className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">
            {title}
          </div>
          {subSegs && (
            <div className="text-[9px] text-muted-foreground">
              <Gl segs={subSegs} />
            </div>
          )}
          <div className="text-[9px] text-muted-foreground">Each line is a published record, with a link to where it comes from. Nothing here is written by a model.</div>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close Ask Jev">
          <X className="size-3.5" />
        </button>
      </div>
      <div data-jev-status="" aria-live="polite" role="status" className="px-3 py-1 text-[10px] text-muted-foreground">
        {jevStatusLine(status, bundle)}
      </div>
      {status === "loading" && <JevResting />}
      {status === "error" && <div className="px-3 py-2 text-[10px] text-muted-foreground">Jev couldn&apos;t get an answer for this place: {(state.error ?? "").slice(0, 200)}</div>}
      {status === "done" && bundle && <JevAnswer bundle={bundle} reducedMotion={reducedMotion} seen={[...g.seen]} />}
    </div>
  );
}

export default function AskJevPanel() {
  const { asked, status, bundle, error, origin, seq } = useJev();
  const reducedMotion = useSyncExternalStore(subscribeMotion, reducedNow, reducedOnServer);
  const ref = useRef<HTMLDivElement | null>(null);
  const open = status !== "idle";

  // Each new question: focus into the panel; from What's here, bring it into view.
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const scroll = scrollsOnOpen(origin);
    el.focus({ preventScroll: scroll });
    if (scroll) el.scrollIntoView(scrollOptions(reducedMotion));
    // A new question changes seq; the answer arriving does not, so it never steals focus.
  }, [open, seq, origin, reducedMotion]);

  if (!open) return null;
  return <JevPanelView state={{ asked, status, bundle, error }} reducedMotion={reducedMotion} onClose={closeJev} panelRef={ref} />;
}
