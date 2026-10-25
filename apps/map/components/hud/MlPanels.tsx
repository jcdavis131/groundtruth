"use client";
// Phase 1 ML surfaces for the market report panel:
// - ForecastLine: the momentum-v1 12-month outlook, shown only when the URL
//   carries ?forecast=1 (the SPEC's "?forecast report line").
// - SimilarPlaces: county-sim-v1 "places like this" for the report's county.
// Every prediction links its model card; failures render as text, never as
// invented numbers.

import { useEffect, useState } from "react";
import { fmtPct } from "@/lib/economy/features";

interface ForecastData {
  point: number;
  lo: number;
  hi: number;
  modelVersion: string;
  vintage: string;
  modelCard: string;
}

interface SimilarData {
  modelVersion: string;
  vintage: string;
  modelCard: string;
  neighbours: Array<{ fips: string; name: string; state: string; distance: number; similarity: number }>;
}

async function getJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const json = (await res.json()) as { data?: T; error?: string };
    if (!res.ok || !json.data) return { ok: false, message: json.error ?? `HTTP ${res.status}` };
    return { ok: true, data: json.data };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function useForecastEnabled(): boolean {
  const [on] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("forecast") === "1",
  );
  return on;
}

export function ForecastLine({ fips }: { fips: string | null }) {
  const enabled = useForecastEnabled();
  const [data, setData] = useState<ForecastData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!enabled || !fips) return;
    let dead = false;
    getJson<ForecastData>(`/api/ml?op=forecast&fips=${encodeURIComponent(fips)}`).then((r) => {
      if (dead) return;
      if (r.ok) setData(r.data);
      else setErr(r.message);
    });
    return () => {
      dead = true;
    };
  }, [enabled, fips]);
  if (!enabled || !fips) return null;
  return (
    <section className="border-t border-border/60 px-3 py-2" aria-label="12-month home-value outlook">
      <div className="hud-label">
        12-month outlook <span className="text-warn">FORECAST</span>
      </div>
      {data ? (
        <p className="mt-0.5 text-[11px] leading-snug text-foreground/90">
          {fmtPct(data.point * 100)} 12-mo ZHVI change (band {fmtPct(data.lo * 100)} to {fmtPct(data.hi * 100)})
          <span className="text-muted-foreground">
            {" "}
            · {data.modelVersion} @ {data.vintage} ·{" "}
            <a href={data.modelCard} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              model card
            </a>
          </span>
        </p>
      ) : err ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">Forecast unavailable: {err}</p>
      ) : (
        <p className="mt-0.5 text-[11px] text-muted-foreground">Loading outlook…</p>
      )}
    </section>
  );
}

export function SimilarPlaces({ fips }: { fips: string | null }) {
  const [data, setData] = useState<SimilarData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!fips) return;
    let dead = false;
    getJson<SimilarData>(`/api/ml?op=similar&fips=${encodeURIComponent(fips)}&k=6`).then((r) => {
      if (dead) return;
      if (r.ok) setData(r.data);
      else setErr(r.message);
    });
    return () => {
      dead = true;
    };
  }, [fips]);
  if (!fips) return null;
  return (
    <section className="border-t border-border/60 px-3 py-2" aria-label="Places like this">
      <div className="hud-label">
        Places like this{" "}
        <span className="text-muted-foreground">
          · {data ? `${data.modelVersion} @ ${data.vintage}` : "county-sim-v1"} ·{" "}
          <a
            href={
              data?.modelCard ??
              "https://github.com/jcdavis131/groundtruth/blob/master/apps/map/docs/model-cards/county-sim-v1.md"
            }
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            model card
          </a>
        </span>
      </div>
      {data ? (
        <ul className="mt-0.5 space-y-0.5 text-[11px] leading-snug text-foreground/90">
          {data.neighbours.map((n) => (
            <li key={n.fips}>
              {n.name}, {n.state}{" "}
              <span className="text-muted-foreground">similarity {(n.similarity * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      ) : err ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">Similar places unavailable: {err}</p>
      ) : (
        <p className="mt-0.5 text-[11px] text-muted-foreground">Loading similar places…</p>
      )}
      <p className="mt-0.5 text-[9px] text-muted-foreground/80">v1 uses home values + rents only: similar housing trajectories, not similar places in full.</p>
    </section>
  );
}
