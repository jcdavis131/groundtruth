"use client";
// "Who is looking?" The first thing a new visitor sees, and reachable any time
// from the Lens button. One card per lens: who it is for, what it turns on,
// where it lands. Choosing applies the lens; "Just explore" is the old default.

import { CandlestickChart, Droplets, Globe2, Home, Landmark, Layers, LineChart, Ship, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LAYER_BY_ID } from "@/lib/layers";
import { PERSONAS, type Persona } from "@/lib/personas/registry";
import { applyPersona, useLens } from "@/lib/personas/store";

const ICONS: Record<Persona["icon"], LucideIcon> = { Home, LineChart, CandlestickChart, Droplets, Ship, Landmark, Layers, Globe2 };

export default function PersonaPicker() {
  const open = useLens((s) => s.pickerOpen);
  const setOpen = useLens((s) => s.setPickerOpen);
  const current = useLens((s) => s.personaId);
  const firstRun = current == null;
  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogContent className="hud-panel max-h-[88vh] w-[min(820px,calc(100vw-24px))] overflow-y-auto rounded-none p-0 sm:max-w-[820px]" showCloseButton={!firstRun}>
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="hud-display text-lg text-primary">{firstRun ? "Who is looking?" : "Change lens"}</DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            A lens turns on the layers you need, lands you somewhere useful and opens the right panel. Every layer stays one tap away; change lens any time.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 px-4 py-4 sm:grid-cols-2">
          {PERSONAS.map((p) => {
            const Icon = ICONS[p.icon];
            const active = p.id === current;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => applyPersona(p.id)}
                  className={`flex min-h-[96px] w-full items-start gap-3 border px-3 py-3 text-left hover:bg-accent ${active ? "border-primary/70 bg-primary/10" : "border-border"}`}
                  aria-pressed={active}
                >
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center border" style={{ color: p.color, borderColor: p.color + "66" }}>
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="hud-display block text-[15px] font-semibold text-foreground">{p.title}</span>
                    <span className="block text-[11px] text-muted-foreground">{p.who}</span>
                    <span className="mt-1 block text-[11px] leading-snug text-foreground/85">{p.tagline}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {p.layers.map((l) => (
                        <span key={l} className="rounded border border-border px-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                          {LAYER_BY_ID[l]?.label ?? l}
                        </span>
                      ))}
                    </span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">Lands on {p.start.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border px-5 py-3 text-[10px] text-muted-foreground">
          Lenses are starting points. Permalinks carry <code>lens=</code>; say &ldquo;I&rsquo;m a hydrologist&rdquo; or &ldquo;switch lens to trader&rdquo; to change by voice.
        </div>
      </DialogContent>
    </Dialog>
  );
}
