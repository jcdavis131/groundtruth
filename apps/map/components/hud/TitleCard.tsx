"use client";
// The first frame. While Cesium loads, the name, one rule in the signal
// colour, the one-line truth about the app, and the boot status sit centred
// over the dark globe. Once the globe is online the card holds for a beat and
// fades; any key, tap or wheel skips it at once. It never takes pointer
// events, so nothing underneath is ever blocked. If the globe cannot start
// (no WebGL, a failed module), the card stays and says so plainly.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useGlobe } from "@/lib/store/globe";
import { PROMISE } from "@/lib/seo/base";

export const GLOBE_ERROR_EVENT = "atlas:globe-error";

const HOLD_MS = 700;
const FADE_MS = 1200;

export default function TitleCard() {
  const ready = useGlobe((s) => s.ready);
  const [state, setState] = useState<"in" | "out" | "gone">("in");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onError = (e: Event) => setError((e as CustomEvent<string>).detail || "The globe could not start.");
    window.addEventListener(GLOBE_ERROR_EVENT, onError);
    return () => window.removeEventListener(GLOBE_ERROR_EVENT, onError);
  }, []);

  // Skip on any input.
  useEffect(() => {
    if (state !== "in" || error) return;
    const skip = () => setState("out");
    for (const ev of ["keydown", "pointerdown", "wheel"]) window.addEventListener(ev, skip, { passive: true });
    return () => {
      for (const ev of ["keydown", "pointerdown", "wheel"]) window.removeEventListener(ev, skip);
    };
  }, [state, error]);

  // Hold, then fade, once the globe is up.
  useEffect(() => {
    if (!ready || state !== "in") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(() => setState(reduced ? "gone" : "out"), reduced ? 0 : HOLD_MS);
    return () => window.clearTimeout(id);
  }, [ready, state]);

  useEffect(() => {
    if (state !== "out") return;
    const id = window.setTimeout(() => setState("gone"), FADE_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  if (state === "gone" && !error) return null;

  // Composed on the view's axes: the name above the horizontal centre line,
  // the rule along it parting around the reticle, the facts below it.
  return (
    <div className="title-card" data-state={error ? "in" : state} role="status" aria-live="polite">
      <div className="tc-1 absolute inset-x-0 bottom-[calc(50%+64px)] flex justify-center px-6 text-center">
        <div className="title-card-name">Embedding Atlas</div>
      </div>
      <div className="tc-2 absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[108px]" aria-hidden>
        <span className="title-card-rule" />
        <span className="title-card-rule" />
      </div>
      <div className="absolute inset-x-0 top-[calc(50%+64px)] flex flex-col items-center px-6 text-center">
        <p className="tc-3 max-w-[46ch] text-[12px] leading-relaxed text-foreground/80 sm:text-[13px]">
          {PROMISE}
        </p>
        <div className="tc-4 hud-label mt-8 flex items-center gap-3 text-[9px]">
          {error ? (
            <>
              <span className="size-1.5 rounded-full bg-alert" aria-hidden />
              <span className="text-alert">Globe offline</span>
            </>
          ) : (
            <>
              <span className={ready ? "hud-lamp" : "hud-lamp hud-lamp-off blink"} aria-hidden />
              <span>{ready ? "Globe online" : "Acquiring globe"}</span>
            </>
          )}
        </div>
        {error && (
          <p className="mt-3 max-w-[52ch] text-[11px] leading-relaxed text-muted-foreground">
            {error} The globe needs WebGL; try another browser or turn hardware acceleration on. The place, state and metro pages work without it:{" "}
            <Link href="/place" prefetch={false} className="pointer-events-auto text-primary underline underline-offset-4">
              /place
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
