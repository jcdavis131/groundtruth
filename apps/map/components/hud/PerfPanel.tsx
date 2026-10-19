"use client";
// The ?perf=1 overlay (MEASURE-FIRST): frame times from requestAnimationFrame
// deltas, long tasks, JS heap and per-layer fetch/draw timings, a scripted
// 10-second test and a copy of the results. Loaded only through PerfOverlay
// when the flag is on. It sends nothing anywhere: the numbers stay on screen,
// in the console and on the clipboard when asked.

import { useEffect, useRef, useState } from "react";
import { getCesium, getViewer } from "@/lib/globe/cesium";
import { stopFollowing } from "@/lib/globe/camera";
import { goLive, setAnimate, setMissionTime } from "@/lib/globe/clock";
import { DEG, destination } from "@/lib/globe/geo";
import { shareUrl } from "@/lib/globe/share";
import { PLAYBACK_MIN_YEAR, missionTimeForYear, playbackMaxYear } from "@/lib/globe/timeMachine";
import { LAYER_IDS } from "@/lib/layers/types";
import { perfMode } from "@/lib/perf/flag";
import { frameStats, Ring, type FrameStats } from "@/lib/perf/stats";
import { layerTimings, type LayerTiming } from "@/lib/perf/trace";
import { cameraAt, PERF_PRESETS, RUN_MS } from "@/lib/perf/views";
import { useGlobe } from "@/lib/store/globe";

/** Rolling window: the latest 600 frames (10 s at 60 Hz). */
const WINDOW_FRAMES = 600;

interface Snapshot {
  rolling: FrameStats;
  longTasks: number | null;
  heapMB: number | null;
  timings: LayerTiming[];
  /** ms left in a run, null when none is running. */
  remaining: number | null;
}

interface RunResult {
  frames: FrameStats;
  longTasks: number | null;
}

function heapMB(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof mem?.usedJSHeapSize === "number" ? Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10 : null;
}

const longTaskSupported = () =>
  typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes ?? []).includes("longtask");

const ms = (x: number | null) => (x == null ? "–" : x < 100 ? x.toFixed(1) : Math.round(x).toString());
const pct = (x: number | null) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);

/** Point the camera at a path keyframe target, backed off along the heading like flyTo. */
function setCamera(k: { lon: number; lat: number; h: number; hd: number; p: number }) {
  const viewer = getViewer();
  if (!viewer) return;
  const C = getCesium();
  const back = k.p <= -89 ? 0 : k.h / Math.tan(-k.p * DEG);
  const [lon, lat] = back > 0 ? destination(k.lat, k.lon, (k.hd + 180) % 360, back) : [k.lon, k.lat];
  viewer.camera.setView({
    destination: C.Cartesian3.fromDegrees(lon, Math.max(-89.9, Math.min(89.9, lat)), k.h),
    orientation: { heading: C.Math.toRadians(k.hd), pitch: C.Math.toRadians(k.p), roll: 0 },
  });
}

export default function PerfPanel() {
  const view = perfMode().view;
  const preset = view ? PERF_PRESETS[view] : null;
  const ring = useRef(new Ring(WINDOW_FRAMES));
  const longTaskTimes = useRef<number[]>([]);
  const run = useRef<{ start: number; deltas: number[]; lastYear: number | null } | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);
  const [supported] = useState(longTaskSupported);

  // Frame loop: every rAF delta into the rolling window, and into the run while one is on.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const d = t - last;
      last = t;
      ring.current.push(d);
      const r = run.current;
      if (r) {
        const elapsed = t - r.start;
        r.deltas.push(d);
        if (preset && elapsed <= RUN_MS) {
          setCamera(cameraAt(preset.path, elapsed / 1000));
          if (preset.scrub) {
            const max = playbackMaxYear();
            const y = Math.round(PLAYBACK_MIN_YEAR + ((max - PLAYBACK_MIN_YEAR) * elapsed) / RUN_MS);
            if (y !== r.lastYear) {
              r.lastYear = y;
              useGlobe.getState().setPlaybackYear(y);
              setMissionTime(missionTimeForYear(y));
            }
          }
        }
        if (elapsed >= RUN_MS) finish(r.start, t, r.deltas);
      }
      raf = requestAnimationFrame(frame);
    };
    const finish = (start: number, end: number, deltas: number[]) => {
      run.current = null;
      if (preset?.scrub) goLive();
      const lt = supported ? longTaskTimes.current.filter((x) => x >= start && x <= end).length : null;
      const res = { frames: frameStats(deltas), longTasks: lt };
      setResult(res);
      console.info("[perf] 10 s test", JSON.stringify(buildReport(res), null, 2));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // preset and supported are fixed for the page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Long tasks, where the browser reports them.
  useEffect(() => {
    if (!supported) return;
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration > 50) longTaskTimes.current.push(e.startTime);
    });
    try {
      obs.observe({ type: "longtask", buffered: true });
    } catch {
      return;
    }
    return () => obs.disconnect();
  }, [supported]);

  // Redraw the numbers twice a second (not every frame).
  useEffect(() => {
    const tick = () => {
      const r = run.current;
      setSnap({
        rolling: frameStats(ring.current.values()),
        longTasks: supported ? longTaskTimes.current.length : null,
        heapMB: heapMB(),
        timings: layerTimings(),
        remaining: r ? Math.max(0, RUN_MS - (performance.now() - r.start)) : null,
      });
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [supported]);

  useEffect(() => {
    if (fallback) fallbackRef.current?.select();
  }, [fallback]);

  const start = () => {
    if (run.current) return;
    setResult(null);
    if (preset) {
      const st = useGlobe.getState();
      for (const id of preset.layers) st.setLayer(id, true);
      stopFollowing();
      getViewer()?.camera.cancelFlight();
      if (preset.scrub) {
        st.setClock({ timeMachine: true });
        setAnimate(false);
      }
    }
    run.current = { start: performance.now(), deltas: [], lastYear: null };
  };

  function buildReport(res: RunResult | null) {
    const st = useGlobe.getState();
    const rolling = frameStats(ring.current.values());
    return {
      kind: "atlas-perf/1",
      takenAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      view: view ?? null,
      layers: LAYER_IDS.filter((id) => st.layers[id]),
      link: shareUrl(),
      run: res ? { windowMs: RUN_MS, scripted: !!preset, frames: res.frames, longTasks: res.longTasks } : null,
      rolling: { windowFrames: WINDOW_FRAMES, frames: rolling },
      longTasks: { supported, sinceLoad: supported ? longTaskTimes.current.length : null },
      heapMB: heapMB(),
      layerTimings: layerTimings(),
      notes: [
        "frame deltas over 1000 ms (hidden tab) are dropped, counted in frames.dropped",
        "layerTimings: response/parsed/drawn are ms after start; response is null for layers that do not fetch through proxy()",
        ...(preset?.note ? [preset.note] : []),
      ],
    };
  }

  const copy = async () => {
    const text = JSON.stringify(buildReport(result), null, 2);
    setFallback(null);
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setCopied("Copied");
    } catch {
      // No clipboard (insecure context, denied): show the text selected for a manual copy.
      setFallback(text);
      setCopied("Selected: copy it by hand");
    }
  };

  const running = snap?.remaining != null;
  const f = result?.frames ?? snap?.rolling;

  return (
    <section
      data-perf-overlay
      data-hud-occluder
      aria-label="Performance overlay"
      className="pointer-events-auto absolute z-50 w-[260px] max-w-[calc(100vw-16px)] border border-border bg-popover/90 text-[12px] leading-tight text-popover-foreground shadow-lg backdrop-blur-sm"
      style={{
        right: "max(8px, env(safe-area-inset-right))",
        // Below the top bar on both layouts; collapses to one line from its header.
        top: "calc(max(8px, env(safe-area-inset-top)) + 110px)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-8 w-full items-center justify-between px-2 uppercase tracking-widest"
      >
        <span>perf{view ? ` · ${view}` : ""}</span>
        <span className="tabular-nums text-muted-foreground">{f?.p95 != null ? `p95 ${ms(f.p95)} ms` : ""}</span>
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-2 tabular-nums">
          <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
            <dt className="text-muted-foreground">{result ? "10 s test" : `last ${f?.frames ?? 0} frames`}</dt>
            <dd />
            <dt>p50 / p95 ms</dt>
            <dd>
              {ms(f?.p50 ?? null)} / {ms(f?.p95 ?? null)}
            </dd>
            <dt>over 16.7 ms</dt>
            <dd>{pct(f?.overBudget ?? null)}</dd>
            <dt>long tasks &gt; 50 ms</dt>
            <dd>{supported ? (result ? result.longTasks : snap?.longTasks) : "not supported"}</dd>
            <dt>JS heap</dt>
            <dd>{snap?.heapMB != null ? `${snap.heapMB} MB` : "not exposed"}</dd>
          </dl>
          {snap && snap.timings.length > 0 && (
            <table className="w-full">
              <caption className="text-left text-muted-foreground">layer ms after fetch start</caption>
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-normal">layer</th>
                  <th className="text-right font-normal">resp</th>
                  <th className="text-right font-normal">ready</th>
                  <th className="text-right font-normal">drawn</th>
                </tr>
              </thead>
              <tbody>
                {snap.timings.map((t) => (
                  <tr key={t.layer}>
                    <td className="max-w-[90px] truncate">{t.layer}</td>
                    <td className="text-right">{ms(t.response)}</td>
                    <td className="text-right">{ms(t.parsed)}</td>
                    <td className="text-right">{ms(t.drawn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={start}
              disabled={running}
              className="h-9 flex-1 border border-border px-2 hover:bg-foreground/10 disabled:opacity-60"
            >
              {running ? `Running ${Math.ceil((snap?.remaining ?? 0) / 1000)} s` : "Run 10 s test"}
            </button>
            <button type="button" onClick={copy} className="h-9 flex-1 border border-border px-2 hover:bg-foreground/10">
              Copy results
            </button>
          </div>
          {copied && <p className="text-muted-foreground" role="status">{copied}</p>}
          {fallback && (
            <textarea
              ref={fallbackRef}
              readOnly
              value={fallback}
              aria-label="Results JSON"
              className="h-32 w-full resize-none border border-border bg-background p-1 font-mono text-[12px]"
            />
          )}
          {!preset && <p className="text-muted-foreground">Add &amp;view=austin, texas or flows for a scripted camera path.</p>}
        </div>
      )}
    </section>
  );
}
