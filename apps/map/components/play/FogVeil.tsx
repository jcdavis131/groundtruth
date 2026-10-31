"use client";
// The play modes' canvas: fog of war for Command mode, the hook ripple for
// Fisherman mode. One absolutely-positioned canvas above the globe and below
// the HUD (pointer-events-none, so globe clicks pass through), repainted on
// an animation frame only while a mode is on.
//
// Command: a dark veil covers the planet; destination-out discs lift it
// around every conquered county and wider around the probe. Nothing is
// hidden that the layers do not already show — the veil only tracks where
// you have been. Fisherman: no veil, just the ripple where the hook landed.

import { useEffect, useRef } from "react";
import { usePlay } from "@/lib/play/store";
import { projectVisible } from "@/lib/play/project";
import { getViewer } from "@/lib/globe/cesium";

const FOG = "rgba(2, 6, 16, 0.80)";
const REVEAL_R = 110;
const PROBE_R = 170;
const GOLD = "#e8b34b";
const HOOK = "#7dd3fc";

export default function FogVeil() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mode = usePlay((s) => s.mode);

  useEffect(() => {
    if (mode === "off") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const punch = (x: number, y: number, r: number) => {
      const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const viewer = getViewer();
      const st = usePlay.getState();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (!viewer || w === 0 || h === 0) return;
      const t = (performance.now() - t0) / 1000;

      if (st.mode === "command") {
        ctx.fillStyle = FOG;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "destination-out";
        for (const c of st.conquered) {
          const p = projectVisible(viewer, c.lon, c.lat);
          if (p) punch(p.x, p.y, REVEAL_R);
        }
        if (st.probe) {
          const p = projectVisible(viewer, st.probe.lon, st.probe.lat);
          if (p) {
            punch(p.x, p.y, PROBE_R);
            // The probe crosshair survives the punch (drawn after, source-over).
            ctx.globalCompositeOperation = "source-over";
            const pulse = reduced ? 0 : Math.sin(t * 3) * 3;
            ctx.strokeStyle = GOLD;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 14 + pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(p.x - 22 - pulse, p.y);
            ctx.lineTo(p.x - 10, p.y);
            ctx.moveTo(p.x + 10, p.y);
            ctx.lineTo(p.x + 22 + pulse, p.y);
            ctx.moveTo(p.x, p.y - 22 - pulse);
            ctx.lineTo(p.x, p.y - 10);
            ctx.moveTo(p.x, p.y + 10);
            ctx.lineTo(p.x, p.y + 22 + pulse);
            ctx.stroke();
            ctx.globalCompositeOperation = "destination-out";
          }
        }
        ctx.globalCompositeOperation = "source-over";
      } else if (st.mode === "fisherman" && st.cast) {
        const p = projectVisible(viewer, st.cast.lon, st.cast.lat);
        if (p) {
          // The hook: a ring with expanding ripples while the line is out.
          const ripples = reduced ? 1 : 3;
          for (let i = 0; i < ripples; i++) {
            const phase = reduced ? 0.5 : ((t * 0.7 + i / ripples) % 1);
            const r = 10 + phase * 46;
            ctx.strokeStyle = HOOK;
            ctx.globalAlpha = 0.85 * (1 - phase);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = HOOK;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [mode]);

  if (mode === "off") return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
    />
  );
}
