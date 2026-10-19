"use client";
// "Power & water" context for a data-center panel — REAL regional data only.
// Per-site power/water use is not disclosed by operators, so every figure here
// is labeled with its source and geography. Nothing is estimated; anything
// unknown says so plainly.

import { useState } from "react";
import {
  ercotBundle,
  usElectricityBundle,
  globalGenerationBundle,
} from "@/lib/energy/energy";

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearest<T extends { lat: number; lon: number }>(lat: number, lon: number, items: T[]): { item: T; mi: number } | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const it of items) {
    const d = haversineMi(lat, lon, it.lat, it.lon);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return best ? { item: best, mi: bestD } : null;
}

const inTexas = (lat: number, lon: number) => lat >= 25.8 && lat <= 36.5 && lon >= -106.5 && lon <= -93.5;

export default function PowerWaterAside({ lat, lon }: { lat: number; lon: number }) {
  const [open, setOpen] = useState(true);

  const ercot = ercotBundle();
  const usElec = usElectricityBundle();
  const gen = globalGenerationBundle();

  const texas = inTexas(lat, lon);
  const ercotPt = texas ? nearest(lat, lon, ercot.rtm.points) : null;

  const states = Object.entries(usElec.states).map(([abbr, s]) => ({ abbr, ...s }));
  const stateHit = nearest(lat, lon, states);
  const inUS = stateHit != null && stateHit.mi < 400;

  const countryHit = nearest(lat, lon, gen.countries);
  const mix = countryHit?.item.fuels.slice(0, 3) ?? [];

  return (
    <div className="border-t border-border/60">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[48px] w-full items-center justify-between px-3 text-left"
      >
        <span className="hud-label text-[9px]">POWER &amp; WATER</span>
        <span className="text-[11px] text-muted-foreground" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <p className="text-[10px] leading-snug text-muted-foreground">
            Regional context only — hyperscalers don&apos;t publish per-site power or water use.
          </p>

          {ercotPt && (
            <div className="rounded-sm border border-border/60 px-2.5 py-2">
              <div className="hud-label text-[9px]">ERCOT REAL-TIME PRICE</div>
              <div className="mt-0.5 text-[13px] tabular-nums text-[var(--bright)]">
                ${ercotPt.item.price_usd_mwh.toFixed(2)}
                <span className="text-[10px] text-muted-foreground">/MWh</span>
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                {ercotPt.item.label} ({ercotPt.item.kind}), {Math.round(ercotPt.mi)} mi away · snapshot{" "}
                {ercot.rtm.asof ?? "date n/a"} · ERCOT MIS
              </div>
            </div>
          )}

          {inUS && stateHit && (
            <div className="rounded-sm border border-border/60 px-2.5 py-2">
              <div className="hud-label text-[9px]">ELECTRICITY PRICE · {stateHit.item.name.toUpperCase()}</div>
              <div className="mt-0.5 text-[13px] tabular-nums text-[var(--bright)]">
                {stateHit.item.industrial != null ? `${stateHit.item.industrial.toFixed(2)}¢` : "n/a"}
                <span className="text-[10px] text-muted-foreground">/kWh industrial avg</span>
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                EIA SEDS {usElec.asof_year} · state average, not this site&apos;s rate
              </div>
            </div>
          )}

          {countryHit && (
            <div className="rounded-sm border border-border/60 px-2.5 py-2">
              <div className="hud-label text-[9px]">GRID FUEL MIX · {countryHit.item.country.toUpperCase()}</div>
              <div className="mt-0.5 text-[12px] text-foreground/90">
                {mix.map((f) => `${f.fuel} ${f.share_pct.toFixed(0)}%`).join(" · ")}
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                Ember {countryHit.item.year} · national mix, {countryHit.item.total_twh.toLocaleString()} TWh
              </div>
            </div>
          )}

          <div className="rounded-sm border border-border/60 px-2.5 py-2">
            <div className="hud-label text-[9px]">WATER</div>
            <p className="mt-0.5 text-[11px] leading-snug text-foreground/90">
              Per-site water use isn&apos;t publicly disclosed.
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              Check the live Water layer for USGS gauges near this site.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
