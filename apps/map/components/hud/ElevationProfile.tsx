"use client";
// Elevation profile along the measure tool's drawn line, from the keyless
// terrarium tiles (lib/terrain/profile.ts does the arithmetic, and says how).
// Heights are the tiles' own values: ground below sea level and the sea floor
// are reported as published, even though the 3D globe draws them at 0 m.

import { useMemo, useState } from "react";
import { Mountain } from "lucide-react";
import type { Shape } from "@/lib/store/globe";
import { geodesicLength, fmtLength } from "@/lib/globe/measure";
import { chooseZoom, profileSamples, profileStats, sampleHeights, tilesFor, type HeightTile, type ProfileSample, type ProfileStats } from "@/lib/terrain/profile";
import { terrariumTile } from "@/lib/terrain/terrarium";
import { pixelMetres } from "@/lib/terrain/webmercator";

const SAMPLES = 200;
const MAX_TILES = 16;

interface Result {
  key: string;
  samples: ProfileSample[];
  heights: Array<number | null>;
  stats: ProfileStats;
  zoom: number;
  pixelM: number;
  failedTiles: number;
}

async function run(shape: Shape, key: string): Promise<Result> {
  const samples = profileSamples(shape.points, SAMPLES, geodesicLength);
  const zoom = chooseZoom(samples, MAX_TILES);
  const keys = tilesFor(samples, zoom);
  const tiles = new Map<string, HeightTile>();
  let failedTiles = 0;
  await Promise.all(
    keys.map(async (k) => {
      const [z, x, y] = k.split("/").map(Number);
      try {
        tiles.set(k, await terrariumTile(z, x, y));
      } catch {
        failedTiles++;
      }
    }),
  );
  const heights = sampleHeights(samples, zoom, tiles);
  const mid = samples[Math.floor(samples.length / 2)];
  return { key, samples, heights, stats: profileStats(samples, heights), zoom, pixelM: pixelMetres(zoom, mid?.lat ?? 0), failedTiles };
}

const m2ft = (m: number) => m / 0.3048;
const fmtH = (m: number | undefined) => (m == null ? "—" : `${m.toFixed(0)} m · ${m2ft(m).toFixed(0)} ft`);

function Chart({ r }: { r: Result }) {
  const W = 300;
  const H = 96;
  const pad = 2;
  const { minM = 0, maxM = 1, lengthM } = r.stats;
  const span = Math.max(1, maxM - minM);
  const segs: string[] = [];
  let cur = "";
  r.samples.forEach((s, i) => {
    const h = r.heights[i];
    if (h == null) {
      if (cur) segs.push(cur);
      cur = "";
      return;
    }
    const x = pad + ((W - 2 * pad) * s.distM) / Math.max(1, lengthM);
    const y = pad + (H - 2 * pad) * (1 - (h - minM) / span);
    cur += `${cur ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-24 w-full" role="img" aria-label={`Elevation profile from ${fmtH(r.stats.startM)} to ${fmtH(r.stats.endM)}, lowest ${fmtH(r.stats.minM)}, highest ${fmtH(r.stats.maxM)}`}>
      <rect x={0} y={0} width={W} height={H} fill="none" stroke="currentColor" strokeOpacity={0.15} />
      {segs.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#5EF2C2" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

export default function ElevationProfile({ shape }: { shape: Shape }) {
  const key = useMemo(() => shape.points.map((p) => p.join(",")).join(";"), [shape]);
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const failed = error?.key === key ? error.message : null;
  const loading = asked === key && result?.key !== key && !failed;

  const ask = () => {
    setAsked(key);
    setError(null);
    run(shape, key)
      .then(setResult)
      .catch((e: unknown) => setError({ key, message: e instanceof Error ? e.message : String(e) }));
  };

  if (shape.kind !== "line" || shape.points.length < 2) return null;
  const r = result?.key === key ? result : null;
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="hud-label">Elevation profile</span>
        {!r && (
          <button
            type="button"
            onClick={ask}
            disabled={loading}
            className="flex items-center gap-1 border border-[#5EF2C2]/60 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[#5EF2C2] hover:bg-[#5EF2C2]/10 disabled:opacity-60"
          >
            <Mountain className="size-3" /> {loading ? "reading tiles…" : "Profile"}
          </button>
        )}
      </div>
      {failed && <div className="text-[10px] text-alert">profile failed: {failed.slice(0, 80)}</div>}
      {r && (
        <>
          <Chart r={r} />
          <div className="grid grid-cols-2 gap-x-3 text-[10px] tabular-nums text-foreground/85">
            <span>start {fmtH(r.stats.startM)}</span>
            <span>end {fmtH(r.stats.endM)}</span>
            <span>low {fmtH(r.stats.minM)}</span>
            <span>high {fmtH(r.stats.maxM)}</span>
            <span>climb {r.stats.gainM == null ? "—" : `${r.stats.gainM.toFixed(0)} m`}</span>
            <span>descent {r.stats.lossM == null ? "—" : `${r.stats.lossM.toFixed(0)} m`}</span>
          </div>
          <ul className="mt-1 space-y-0.5 text-[9px] leading-snug text-muted-foreground">
            <li>
              {r.stats.samples} samples every {fmtLength(r.stats.spacingM)} along {fmtLength(r.stats.lengthM)}; height bilinear between the four nearest pixels of AWS
              Terrain Tiles (terrarium) at zoom {r.zoom}, about {r.pixelM.toFixed(r.pixelM < 10 ? 1 : 0)} m a pixel here.
            </li>
            <li>climb = Σ max(0, h[i+1] − h[i]), descent = Σ max(0, h[i] − h[i+1]) over the samples; both grow as the spacing shrinks.</li>
            <li>
              The tiles merge USGS 3DEP (about 10 m across most of the US), SRTM, GMTED2010, ETOPO1 and others by place; heights below sea level are reported as
              published.
              {r.stats.valid < r.stats.samples ? ` ${r.stats.samples - r.stats.valid} samples have no height (${r.failedTiles} tile${r.failedTiles === 1 ? "" : "s"} did not load).` : ""}
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
