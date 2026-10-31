"use client";
// Fisherman mode panel: the catch. A cast resolves the county under the
// click; the mode reels in its nearest housing-trajectory twins from
// county-sim-v1 (/api/ml?op=similar). The footer names the model, its
// vintage, and what v1 actually measures, with the card — because a twin
// list without its provenance is just a leaderboard.

import { ExternalLink, Fish, X } from "lucide-react";
import { usePlay } from "@/lib/play/store";

export default function FishermanPanel() {
  const mode = usePlay((s) => s.mode);
  const cast = usePlay((s) => s.cast);
  const haul = usePlay((s) => s.haul);
  const reeling = usePlay((s) => s.reeling);
  const castError = usePlay((s) => s.castError);
  const setMode = usePlay((s) => s.setMode);
  if (mode !== "fisherman") return null;

  return (
    <div className="hud-panel pointer-events-auto">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: "#7dd3fc" }}>
            <Fish className="mr-1 inline size-3" />
            Fisherman
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">
            {cast?.name ? `${cast.name}, ${cast.state}` : "No cast yet"}
          </div>
          <div className="text-[9px] text-muted-foreground">
            Click the globe to cast. The hook pulls up the county&apos;s nearest housing-trajectory twins.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMode("off")}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Leave Fisherman mode"
          title="Leave Fisherman mode (Esc)"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="px-3 py-2">
        {reeling && (
          <div className="py-2 text-[12px] text-muted-foreground" role="status">
            Reeling it in…
          </div>
        )}
        {!reeling && castError && <div className="py-2 text-[12px] text-warn">{castError}</div>}
        {!reeling && !castError && haul && (
          <>
            <ul className="max-h-52 overflow-y-auto [scrollbar-width:thin]">
              {haul.items.map((n, i) => (
                <li key={n.fips} className="flex items-baseline gap-2 border-b border-border/50 py-1.5 text-[12px] last:border-0">
                  <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {n.name}, {n.state}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{(n.similarity * 100).toFixed(1)}%</span>
                </li>
              ))}
              {haul.items.length === 0 && (
                <li className="py-2 text-[12px] text-muted-foreground">The net came up empty.</li>
              )}
            </ul>
            <div className="mt-2 border-t border-border pt-2 text-[9px] leading-relaxed text-muted-foreground">
              {haul.modelVersion} · vintage {haul.vintage} · {haul.caveat}{" "}
              <a
                href={haul.modelCard}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                model card <ExternalLink className="size-2.5" aria-hidden />
              </a>
            </div>
          </>
        )}
        {!reeling && !castError && !haul && !cast && (
          <div className="py-2 text-[12px] text-muted-foreground">
            Cast anywhere on land. Open water gets no bite — the hook needs a county.
          </div>
        )}
      </div>
    </div>
  );
}
