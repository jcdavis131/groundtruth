"use client";
// The Ask Jev panel (?jev=1): world_context's bundle for the place a visitor
// picked, as short cited sections. Loaded only through AskJevOverlay, so with
// the flag off none of this code is in the page.

import { useSyncExternalStore } from "react";
import { MessageCircleQuestionMark, X } from "lucide-react";
import { closeJev, useJev } from "@/lib/jev/store";
import { placeSubtitle, placeTitle } from "@/lib/jev/format";
import JevAnswer, { JevResting } from "./JevAnswer";

const ACCENT = "#A5B4FC";
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribeMotion(cb: () => void): () => void {
  const mq = typeof window !== "undefined" ? window.matchMedia?.(QUERY) : undefined;
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
}
const reducedNow = () => (typeof window !== "undefined" && window.matchMedia?.(QUERY).matches) || false;
const reducedOnServer = () => true;

export default function AskJevPanel() {
  const { asked, status, bundle, error } = useJev();
  const reducedMotion = useSyncExternalStore(subscribeMotion, reducedNow, reducedOnServer);
  if (status === "idle") return null;
  const title = bundle ? placeTitle(bundle) : (asked ?? "this place");
  const sub = bundle ? placeSubtitle(bundle) : null;
  return (
    <div className="hud-panel pointer-events-auto" role="region" aria-label="Ask Jev" aria-busy={status === "loading"}>
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: ACCENT }}>
            <MessageCircleQuestionMark className="mr-1 inline size-3" />
            Ask Jev
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">{title}</div>
          {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
          <div className="text-[9px] text-muted-foreground">
            Jev here is the world_context tool agents use: each line is a published record with its source. Nothing is written by a model.
          </div>
        </div>
        <button type="button" onClick={closeJev} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close Ask Jev">
          <X className="size-3.5" />
        </button>
      </div>
      <div aria-live="polite">
        {status === "loading" && (
          <>
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground">asking world_context…</div>
            <JevResting />
          </>
        )}
        {status === "error" && <div className="px-3 py-2 text-[10px] text-muted-foreground">world_context did not answer for this place: {(error ?? "").slice(0, 200)}</div>}
        {status === "done" && bundle && <JevAnswer bundle={bundle} reducedMotion={reducedMotion} />}
      </div>
    </div>
  );
}
