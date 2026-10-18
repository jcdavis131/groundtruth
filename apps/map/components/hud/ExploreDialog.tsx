"use client";
// Explore: curated places (each one a permalink), the guided tour, exports,
// and the embed snippet. The things a visitor needs to get somewhere
// interesting fast and take the data home.

import { useState } from "react";
import { Compass, Copy, Download, Link2, Play } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LAYER_BY_ID } from "@/lib/layers";
import { PRESETS, PRESET_GROUPS, presetShare, presetTarget, type Preset } from "@/lib/explore/presets";
import { exportAreas, exportChips, exportGauges, exportTrade } from "@/lib/explore/export";
import { applyShare, copyShareLink, shareQuery, shareUrl } from "@/lib/globe/share";
import { useGlobe } from "@/lib/store/globe";
import { useLens } from "@/lib/personas/store";
import { PERSONA_BY_ID } from "@/lib/personas/registry";

export default function ExploreDialog() {
  const open = useGlobe((s) => s.exploreOpen);
  const setOpen = useGlobe((s) => s.setExploreOpen);
  const status = useGlobe((s) => s.status);
  const [copied, setCopied] = useState<string | null>(null);
  const personaId = useLens((s) => s.personaId);
  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  const lensPresets = persona ? persona.presets.map((id) => PRESETS.find((p) => p.id === id)).filter((p): p is Preset => !!p) : [];

  const go = (p: Preset) => {
    void presetTarget(p).then((s) => applyShare(s));
    useGlobe.getState().pushLog({ level: "info", text: `Explore → ${p.title}, ${p.region}` });
    setOpen(false);
  };
  const copyPreset = async (p: Preset) => {
    const url = shareUrl(presetShare(p));
    try {
      await navigator.clipboard.writeText(url);
      setCopied(p.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      useGlobe.getState().pushLog({ level: "warn", text: `Clipboard blocked; the link is ${url}` });
    }
  };
  const startTour = () => {
    useGlobe.getState().setTour({ active: true, index: 0, startedAt: Date.now(), paused: false });
    setOpen(false);
  };
  const embedSnippet = () => {
    const url = shareUrl({ ...presetShare(PRESETS[1]), embed: true });
    return `<iframe src="${url}" width="960" height="600" style="border:0" allow="clipboard-write" loading="lazy"></iframe>`;
  };

  const chips = status.turbidity?.count ?? 0;
  const gauges = status.water?.count ?? 0;
  const areas = Math.max(status.realestate?.count ?? 0, status.commerce?.count ?? 0);
  const trade = status.trade?.count ?? 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="hud-panel max-h-[88vh] w-[min(760px,calc(100vw-24px))] overflow-y-auto rounded-none p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="hud-display flex items-center gap-2 text-lg text-primary">
            <Compass className="size-4" /> Explore
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Curated places with the right layers on, a guided tour, and the data as files. Every place is a link you can send.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5 py-4 text-[11px] leading-relaxed">
          {persona && lensPresets.length > 0 && (
            <section>
              <div className="hud-label mb-2" style={{ color: persona.color }}>
                For your lens · {persona.title}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {lensPresets.map((p) => (
                  <button key={p.id} type="button" onClick={() => go(p)} className="border border-border px-2 py-1 text-left text-[11px] hover:border-primary/60 hover:text-primary" title={p.blurb}>
                    <span className="text-foreground">{p.title}</span>
                    <span className="text-muted-foreground"> · {p.region}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="hud-label">Places</div>
              <button
                type="button"
                onClick={startTour}
                className="flex items-center gap-2 border border-primary/50 px-3 py-1 text-[10px] uppercase tracking-widest text-primary hover:bg-primary/10"
              >
                <Play className="size-3" /> Play the tour
              </button>
            </div>
            {PRESET_GROUPS.map((g) => (
            <div key={g.title} className="mb-3">
            <div className="mb-1 text-[9px] uppercase tracking-widest text-muted-foreground">{g.title}</div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {g.presets.map((p) => (
                <li key={p.id} className="border border-border/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => go(p)} className="min-w-0 text-left" title="Fly there">
                      <div className="hud-display text-[13px] font-semibold text-foreground hover:text-primary">{p.title}</div>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{p.region}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyPreset(p)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Copy link to this place"
                      aria-label={`Copy link to ${p.title}`}
                    >
                      {copied === p.id ? <span className="text-[9px] text-primary">copied</span> : <Link2 className="size-3.5" />}
                    </button>
                  </div>
                  <p className="mt-1 text-foreground/80">{p.blurb}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.layers.map((id) => (
                      <span
                        key={id}
                        className="rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
                        style={{ color: LAYER_BY_ID[id]?.color, borderColor: `${LAYER_BY_ID[id]?.color}66` }}
                      >
                        {LAYER_BY_ID[id]?.label ?? id}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            </div>
            ))}
          </section>

          <section>
            <div className="hud-label mb-2">Take the data with you</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportGauges}
                className="flex items-center gap-2 border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary"
                title="Every USGS / NWS / TWDB reading currently loaded"
              >
                <Download className="size-3" /> Gauges CSV{gauges ? ` (${gauges.toLocaleString()})` : ""}
              </button>
              <button
                type="button"
                onClick={exportChips}
                className="flex items-center gap-2 border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary"
                title="Turbidity chips with scene provenance as GeoJSON polygons"
              >
                <Download className="size-3" /> Turbidity chips GeoJSON{chips ? ` (${chips})` : ""}
              </button>
              <button
                type="button"
                onClick={exportAreas}
                className="flex items-center gap-2 border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary"
                title="Every county or state currently loaded: home value, rent, jobs, wages"
              >
                <Download className="size-3" /> Counties CSV{areas ? ` (${areas})` : ""}
              </button>
              <button
                type="button"
                onClick={exportTrade}
                className="flex items-center gap-2 border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary"
                title="Harbours and border crossings currently loaded with their volumes"
              >
                <Download className="size-3" /> Ports & crossings CSV{trade ? ` (${trade})` : ""}
              </button>
              <button
                type="button"
                onClick={() => void copyShareLink()}
                className="flex items-center gap-2 border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary"
              >
                <Link2 className="size-3" /> Copy link to this view
              </button>
            </div>
            <p className="mt-2 text-muted-foreground">
              The community water report has its own copy and JSON buttons in its header. Without the globe, the same data is one
              request away: <code className="text-foreground/80">/api/water?op=report&amp;lon=-98.4&amp;lat=29.4</code> and the other
              ops listed in the README, CORS open.
            </p>
          </section>

          <section>
            <div className="hud-label mb-2">Embed</div>
            <p className="text-muted-foreground">
              Add <code className="text-foreground/80">&amp;embed=1</code> to any link for a chrome-free globe that fits an iframe. Data
              credits stay on screen.
            </p>
            <div className="mt-2 flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto border border-border/70 bg-black/30 p-2 text-[10px] text-foreground/80">
                {embedSnippet()}
              </pre>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(embedSnippet()).then(
                    () => useGlobe.getState().pushLog({ level: "info", text: "Embed snippet copied." }),
                    () => useGlobe.getState().pushLog({ level: "warn", text: "Clipboard blocked." }),
                  );
                }}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Copy embed snippet"
                aria-label="Copy embed snippet"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Link format: <code>{shareQuery({ lat: 29.28, lon: -98.34, h: 60_000, layers: ["water", "turbidity"], report: true })}</code>
              {" "}plus <code>t=</code> for the mission clock and <code>sel=layer:id</code> for a selected object.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
