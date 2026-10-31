"use client";
// Command mode panel: the territory ledger. Click the globe to march the
// probe; the county under each click is claimed and the fog lifts there.
// The ledger is your own trail — nothing here is anyone else's data.

import { Flag, Swords, Trash2, X } from "lucide-react";
import { usePlay } from "@/lib/play/store";

export default function CommandPanel() {
  const mode = usePlay((s) => s.mode);
  const conquered = usePlay((s) => s.conquered);
  const setMode = usePlay((s) => s.setMode);
  const clearConquered = usePlay((s) => s.clearConquered);
  if (mode !== "command") return null;

  const recent = [...conquered].reverse().slice(0, 8);
  return (
    <div className="hud-panel pointer-events-auto">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: "#e8b34b" }}>
            <Swords className="mr-1 inline size-3" />
            Command
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">
            {conquered.length === 0 ? "No territory yet" : `${conquered.length} ${conquered.length === 1 ? "county" : "counties"} held`}
          </div>
          <div className="text-[9px] text-muted-foreground">Click the globe to march the probe and claim the county under it.</div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          {conquered.length > 0 && (
            <button
              type="button"
              onClick={clearConquered}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Abandon all territory"
              title="Abandon all territory (the fog returns)"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode("off")}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Leave Command mode"
            title="Leave Command mode (Esc)"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {recent.length > 0 ? (
        <ul className="max-h-44 overflow-y-auto px-3 py-2 [scrollbar-width:thin]">
          {recent.map((c) => (
            <li key={c.fips} className="flex items-center gap-2 py-1 text-[12px]">
              <Flag className="size-3 shrink-0" style={{ color: "#e8b34b" }} aria-hidden />
              <span className="min-w-0 truncate text-foreground">
                {c.name}, {c.state}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{c.fips}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-3 py-3 text-[12px] text-muted-foreground">
          The planet is dark. Send the probe somewhere and the fog will lift where it lands.
        </div>
      )}
    </div>
  );
}
