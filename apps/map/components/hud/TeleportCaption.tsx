"use client";
// The Teleport card: where the camera just landed and why, how long the thing
// has been going on and how long it has left, the agency's own page, and next
// / autoplay / stop. Any pointer, wheel or key pauses autoplay, as the preset
// tour does.

import { useEffect } from "react";
import { ExternalLink, Pause, Play, SkipForward, Square } from "lucide-react";
import { DWELL_S, useTeleport } from "@/lib/live/teleportStore";
import { useNow } from "@/lib/hooks/useNow";

function ago(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

export default function TeleportCaption() {
  const t = useTeleport();
  const now = useNow(500);

  // Autoplay: move on once the dwell is up.
  useEffect(() => {
    if (!t.active) return;
    const id = setInterval(() => {
      const s = useTeleport.getState();
      if (s.auto && Date.now() - s.startedAt >= DWELL_S * 1000) s.next();
    }, 500);
    return () => clearInterval(id);
  }, [t.active]);

  useEffect(() => {
    if (!t.active || !t.auto) return;
    const pause = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-teleport-controls]")) return;
      useTeleport.getState().setAuto(false);
    };
    for (const ev of ["pointerdown", "wheel", "keydown"]) window.addEventListener(ev, pause, { passive: true });
    return () => {
      for (const ev of ["pointerdown", "wheel", "keydown"]) window.removeEventListener(ev, pause);
    };
  }, [t.active, t.auto]);

  if (!t.active) return null;
  const item = t.items[t.index];
  const left = Math.max(0, Math.ceil(DWELL_S - (now - t.startedAt) / 1000));
  const btn = "flex flex-1 items-center justify-center gap-2 border border-border h-8 px-3 text-[10px] uppercase tracking-[0.22em] text-foreground/80 hover:bg-accent hover:text-primary";

  return (
    <div data-teleport-controls className="pointer-events-auto absolute inset-x-2 top-[calc(max(8px,env(safe-area-inset-top))_+_102px)] z-30 md:inset-x-auto md:bottom-[104px] md:left-1/2 md:top-auto md:w-[440px] md:-translate-x-1/2">
      <div className="hud-panel hud-panel-lit hud-enter">
        <div className="flex h-9 items-center justify-between border-b border-border px-3">
          <span className="hud-label text-signal">
            Teleport{t.items.length ? ` · ${t.index + 1}/${t.items.length}` : ""}
          </span>
          <span className="text-[9px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground">{t.auto ? `next in ${left}s` : "live · strongest first"}</span>
        </div>
        <div className="px-3 py-2.5">
          {t.status === "loading" && (
            <div className="text-[11px] text-muted-foreground">
              <span className="blink text-signal">listening</span> to NWS alerts and USGS earthquakes…
            </div>
          )}
          {t.status === "error" && <div className="text-[11px] text-alert">{t.error}</div>}
          {t.status === "ready" && !item && <div className="text-[11px] text-muted-foreground">Nothing rated Severe or Extreme is active right now, and no M4.5+ earthquake in the past day. A quiet planet.</div>}
          {item && (
            <>
              <div className="flex items-center gap-2">
                <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden />
                <span className="hud-display text-[15px] text-[var(--bright)]">{item.title}</span>
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-foreground/85">{item.subtitle}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {item.time != null && (item.time <= now ? `began ${ago(now - item.time)} ago` : `begins in ${ago(item.time - now)}`)}
                {item.until != null && ` · ${item.until > now ? `ends in ${ago(item.until - now)}` : "ended"}`}
                {" · "}
                <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                  {item.kind === "alert" ? "NWS alert" : "USGS event"} <ExternalLink className="size-2.5" />
                </a>
              </div>
              <div className="mt-1 hidden text-[9px] leading-snug text-muted-foreground md:block">
                {item.kind === "alert"
                  ? "Landed in the constructs world: the warning is drawn as a live construct; select it to see the gauges and everything else loaded inside it, and the stack of constructs under the camera."
                  : "Landed on the epicentre with the earthquake layer on and the stack of constructs under the camera."}
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2 border-t border-border p-2">
          <button type="button" className={btn} onClick={() => t.setAuto(!t.auto)} disabled={!t.items.length}>
            {t.auto ? <Pause className="size-3" /> : <Play className="size-3" />}
            {t.auto ? "Pause" : "Autoplay"}
          </button>
          <button type="button" className={btn} onClick={() => t.next()} disabled={!t.items.length}>
            <SkipForward className="size-3" /> Next
          </button>
          <button
            type="button"
            onClick={() => t.stop()}
            className="flex items-center justify-center gap-2 border border-border h-8 px-3 text-[10px] uppercase tracking-[0.22em] text-foreground/80 hover:bg-accent hover:text-alert"
            title="Stop teleporting"
            aria-label="Stop teleporting"
          >
            <Square className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
