"use client";
// "Inside the racks" — interactive 3D CPU/GPU/DPU exploded-view panel.
// The THREE scene itself is framework-free (lib/chips/chipScene.js, ported from
// jcamd/chips); this component owns the UI chrome, captions, tour, and pin card.
// THREE is loaded client-side only from the vendored script — never SSR'd.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PARTS,
  CHIP_MODEL,
  FLOW,
  TOUR,
  DEPTH_LABELS,
  type ChipId,
  type DepthLevel,
} from "@/lib/chips/chipData";
import type { ChipScene } from "@/lib/chips/chipScene";

const CHIPS: ChipId[] = ["cpu", "gpu", "dpu"];
const LEVELS: DepthLevel[] = ["eli5", "fifteen", "pro", "expert"];

function loadThree(): Promise<unknown> {
  const w = window as unknown as { THREE?: unknown };
  if (w.THREE) return Promise.resolve(w.THREE);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/three.min.js";
    s.onload = () => resolve((w as { THREE?: unknown }).THREE);
    s.onerror = () => reject(new Error("three.js failed to load"));
    document.head.appendChild(s);
  });
}

export default function ChipViewer({ defaultChip = "gpu" }: { defaultChip?: ChipId }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ChipScene | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chip, setChip] = useState<ChipId>(defaultChip);
  const [level, setLevel] = useState<DepthLevel>("pro");
  const [explode, setExplode] = useState(62);
  const [flowOn, setFlowOn] = useState(false);
  const [xrayOn, setXrayOn] = useState(false);
  const [labelsOn, setLabelsOn] = useState(true);
  const [tourIdx, setTourIdx] = useState<number | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [flowStep, setFlowStep] = useState(0);
  const reduced = useRef(false);
  const chipRef = useRef<ChipId>(defaultChip);
  useEffect(() => {
    chipRef.current = chip;
  }, [chip]);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;
    let scene: ChipScene | null = null;
    loadThree()
      .then(async (THREE) => {
        if (disposed || !canvasRef.current || !labelRef.current) return;
        const { createChipScene } = await import("@/lib/chips/chipScene");
        scene = createChipScene(canvasRef.current, labelRef.current, THREE, {
          chip: chipRef.current,
          level: "pro",
          reducedMotion: reduced.current,
          onPin: (pid) => {
            setPinned(pid);
            setTourIdx(null);
          },
          onFlowStep: (s) => setFlowStep(s),
        });
        if (!scene) {
          setFailed(true);
          return;
        }
        sceneRef.current = scene;
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Pause rendering when the viewer scrolls out of view (perf).
  useEffect(() => {
    const wrap = wrapRef.current;
    const scene = sceneRef.current;
    if (!wrap || !scene) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries[0]?.isIntersecting ?? true;
        sceneRef.current?.setPaused(!vis);
      },
      { threshold: 0.05 }
    );
    io.observe(wrap);
    return () => io.disconnect();
  }, [ready]);

  // Tour auto-advance (manual stepping under reduced motion).
  useEffect(() => {
    if (tourIdx == null || reduced.current) return;
    const id = setTimeout(() => {
      setTourIdx((i) => (i == null ? null : (i + 1) % TOUR[chipRef.current].length));
    }, 7000);
    return () => clearTimeout(id);
  }, [tourIdx, chip]);

  const applyTour = useCallback(
    (idx: number | null) => {
      const scene = sceneRef.current;
      setTourIdx(idx);
      if (!scene) return;
      if (idx == null) {
        scene.stopTour();
        scene.spotlight(null);
        return;
      }
      const ch = TOUR[scene.chip][idx];
      scene.tourTo(ch.cam);
      scene.spotlight(ch.partIds);
      if (!reduced.current) scene.setFlow(false);
      setFlowOn(false);
    },
    []
  );

  const onChipTab = useCallback(
    (c: ChipId) => {
      setChip(c);
      setTourIdx(null);
      setPinned(null);
      setFlowStep(0);
      const scene = sceneRef.current;
      if (scene) {
        scene.setChip(c);
        scene.setFlow(false);
        setFlowOn(false);
      }
    },
    []
  );

  const onLevel = useCallback((l: DepthLevel) => {
    setLevel(l);
    sceneRef.current?.setLevel(l);
  }, []);

  const onExplode = useCallback((v: number) => {
    setExplode(v);
    sceneRef.current?.setExplode(v / 100);
  }, []);

  const onFlowToggle = useCallback(() => {
    setFlowOn((prev) => {
      const next = !prev;
      if (next) {
        setTourIdx(null);
        sceneRef.current?.stopTour();
        sceneRef.current?.spotlight(null);
      }
      sceneRef.current?.setFlow(next);
      return next;
    });
  }, []);

  const onXray = useCallback(() => {
    setXrayOn((prev) => {
      sceneRef.current?.setXray(!prev);
      return !prev;
    });
  }, []);

  const onLabels = useCallback(() => {
    setLabelsOn((prev) => {
      sceneRef.current?.setLabels(!prev);
      return !prev;
    });
  }, []);

  const closePin = useCallback(() => {
    setPinned(null);
    sceneRef.current?.pin(null);
  }, []);

  const chapters = TOUR[chip];
  const tourChapter = tourIdx != null ? chapters[tourIdx] : null;
  const flowStage = FLOW[chip].stages[flowStep];
  const pinPart = pinned ? PARTS[pinned] : null;

  return (
    <div ref={wrapRef} className="chips-viewer">
      {/* chip tabs */}
      <div className="flex gap-1 px-3 pt-2.5" role="tablist" aria-label="Chip">
        {CHIPS.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={chip === c}
            onClick={() => onChipTab(c)}
            className={`flex min-h-[48px] flex-1 items-center justify-center rounded-sm border px-2 text-[12px] font-medium transition-colors ${
              chip === c
                ? "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--bright)]"
                : "border-border/60 text-muted-foreground hover:bg-accent"
            }`}
          >
            {c === "cpu" ? "CPU" : c === "gpu" ? "GPU" : "DPU"}
          </button>
        ))}
      </div>
      <p className="px-3 pt-1 text-[10px] text-muted-foreground">{CHIP_MODEL[chip]}</p>

      {/* 3D stage */}
      <div className="relative mx-3 mt-2 overflow-hidden rounded-sm border border-border/60 bg-[#0e0c09]">
        {failed ? (
          <div className="flex h-[300px] items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
            3D view unavailable on this device — the captions and specs below still apply.
          </div>
        ) : (
          <>
            <canvas ref={canvasRef} className="block h-[300px] w-full touch-none sm:h-[360px]" aria-label={`Interactive 3D exploded view of ${CHIP_MODEL[chip]}`} />
            <div ref={labelRef} className="chips-label-layer" aria-hidden />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted-foreground">
                Loading 3D…
              </div>
            )}
          </>
        )}
      </div>

      {ready && !failed && (
        <>
          {/* tour */}
          <div className="px-3 pt-2.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => applyTour(tourIdx == null ? 0 : null)}
                className="flex min-h-[48px] items-center gap-2 rounded-sm border border-border/60 px-3 text-[12px] font-medium text-[var(--bright)] hover:bg-accent"
                aria-pressed={tourIdx != null}
              >
                {tourIdx == null ? "▶ Guided tour" : "⏸ Stop tour"}
              </button>
              <div className="flex flex-1 flex-wrap gap-1">
                {chapters.map((ch, i) => (
                  <button
                    key={ch.title}
                    onClick={() => applyTour(i)}
                    aria-pressed={tourIdx === i}
                    className={`min-h-[48px] rounded-sm border px-2 text-[11px] ${
                      tourIdx === i
                        ? "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--bright)]"
                        : "border-border/60 text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {ch.title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* caption card */}
          <div className="mx-3 mt-2 rounded-sm border border-border/60 bg-primary/5 px-3 py-2">
            <div className="hud-label text-[9px]">
              {tourChapter
                ? `TOUR · ${tourChapter.title}`
                : flowOn
                  ? `DATA FLOW · STEP ${flowStep + 1} OF 4`
                  : "ABOUT THIS VIEW"}
            </div>
            <p className="mt-1 text-[12px] leading-snug text-foreground/90">
              {tourChapter
                ? tourChapter.caption[level]
                : flowOn
                  ? `${flowStage.name} — ${flowStage.cap[level]}`
                  : "Drag to orbit, scroll to zoom. Tap any block to pin its specs. Use the explode slider to pull the stack apart."}
            </p>
          </div>

          {/* controls */}
          <div className="space-y-2 px-3 pt-2.5">
            <label className="flex items-center gap-3">
              <span className="hud-label w-16 shrink-0 text-[9px]">Explode</span>
              <input
                type="range"
                min={0}
                max={100}
                value={explode}
                onChange={(e) => onExplode(Number(e.target.value))}
                className="h-[48px] flex-1 accent-[var(--signal)]"
                aria-label="Explode amount"
              />
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {explode}%
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Detail level">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  onClick={() => onLevel(l)}
                  aria-pressed={level === l}
                  className={`min-h-[48px] rounded-sm border px-2.5 text-[11px] ${
                    level === l
                      ? "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--bright)]"
                      : "border-border/60 text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {DEPTH_LABELS[l]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              <Toggle on={flowOn} onClick={onFlowToggle} label={flowOn ? "⏸ Data flow" : "▶ Data flow"} />
              <Toggle on={xrayOn} onClick={onXray} label="X-ray slice" />
              <Toggle on={labelsOn} onClick={onLabels} label="Labels" />
            </div>
          </div>

          {/* pin detail card */}
          {pinPart && (
            <div className="mx-3 mt-2 rounded-sm border border-[var(--signal)]/50 bg-[var(--signal)]/5 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="hud-label text-[9px]">{pinPart.chip.toUpperCase()} · PINNED</div>
                  <div className="mt-0.5 text-[13px] font-medium text-[var(--bright)]">{pinPart.name}</div>
                </div>
                <button
                  onClick={closePin}
                  className="flex min-h-[48px] min-w-[48px] items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label="Unpin part"
                >
                  ✕
                </button>
              </div>
              <ul className="mt-1 flex flex-wrap gap-1">
                {pinPart.spec.map((s) => (
                  <li
                    key={s}
                    className="rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                  >
                    {s}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12px] leading-snug text-foreground/90">
                {pinPart[level]}
              </p>
            </div>
          )}
        </>
      )}

      <p className="px-3 py-2 text-[9px] leading-snug text-muted-foreground">
        Schematic model — not to die scale. Specs verified Sep 2026 from the jcamd.com chips deep dive.
      </p>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`min-h-[48px] rounded-sm border px-2.5 text-[11px] ${
        on
          ? "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--bright)]"
          : "border-border/60 text-muted-foreground hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
