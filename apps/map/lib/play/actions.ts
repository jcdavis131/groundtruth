"use client";
// What a globe click does while a play mode owns it. Called from
// CesiumGlobe's LEFT_CLICK handler ahead of the normal click precedence,
// the way a measure tool owns its clicks.
//
// Command: the click marches the probe (the camera follows at a respectful
// distance) and claims the county under it. Fisherman: the click casts the
// hook; the county under it resolves, then the mode reels in its nearest
// housing-trajectory twins. A click that resolves to no county conquers
// nothing and catches nothing — open water is an honest miss.

import { usePlay } from "./store";
import { FishError, openWater, reelIn } from "./fish";
import { flyTo } from "@/lib/globe/camera";
import { useGlobe } from "@/lib/store/globe";
import type { CountyRef } from "@/lib/parcels/types";

interface CountyReply {
  county: CountyRef | null;
  error?: string;
}

async function resolveCounty(lon: number, lat: number): Promise<CountyRef | null> {
  const res = await fetch(`/api/play?op=county&lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}`);
  if (!res.ok) throw new Error(`county lookup failed (${res.status})`);
  const json = (await res.json()) as CountyReply;
  if (json.error) throw new Error(json.error);
  return json.county;
}

/** A newer cast supersedes an older one: only the latest cast may write. */
function liveCast(at: number): boolean {
  const s = usePlay.getState();
  return s.mode === "fisherman" && s.cast?.at === at;
}

async function commandClick(lon: number, lat: number): Promise<void> {
  const st = usePlay.getState();
  st.setProbe({ lon, lat });
  const height = Math.min(useGlobe.getState().view.height, 2_500_000);
  flyTo(lon, lat, { height });
  try {
    const county = await resolveCounty(lon, lat);
    if (!county) return;
    const s = usePlay.getState();
    if (s.mode !== "command") return;
    const held = s.conquered.some((c) => c.fips === county.geoid);
    s.conquer({ fips: county.geoid, name: county.name, state: county.state, lon, lat });
    if (!held) {
      useGlobe.getState().pushLog({ level: "info", text: `Claimed ${county.name}, ${county.state}` });
    }
  } catch {
    // A failed lookup conquers nothing; the probe still marched.
  }
}

async function fishermanClick(lon: number, lat: number): Promise<void> {
  const st = usePlay.getState();
  const at = Date.now();
  st.setCast({ lon, lat, fips: null, name: null, state: null, at });
  st.setHaul(null);
  st.setCastError(null);
  st.setReeling(true);
  try {
    const county = await resolveCounty(lon, lat);
    if (!liveCast(at)) return;
    if (!county) {
      const s = usePlay.getState();
      s.setReeling(false);
      s.setCastError(openWater().message);
      return;
    }
    usePlay.getState().setCast({ lon, lat, fips: county.geoid, name: county.name, state: county.state, at });
    try {
      const haul = await reelIn(county.geoid);
      if (!liveCast(at)) return;
      usePlay.getState().setHaul(haul);
    } catch (err) {
      if (!liveCast(at)) return;
      const s = usePlay.getState();
      s.setCastError(err instanceof FishError ? err.message : "The line snapped — try the cast again.");
    }
  } catch {
    if (!liveCast(at)) return;
    const s = usePlay.getState();
    s.setCastError("The cast missed the county service — try again.");
  } finally {
    if (liveCast(at)) usePlay.getState().setReeling(false);
  }
}

export async function playClick(lon: number, lat: number): Promise<void> {
  const mode = usePlay.getState().mode;
  if (mode === "command") return commandClick(lon, lat);
  if (mode === "fisherman") return fishermanClick(lon, lat);
}
