"use client";
// Space weather next to the satellites: the planetary Kp index from GFZ
// Potsdam (recent values preliminary, and labelled so), solar flares and
// space-weather notifications from NASA's DONKI. Empty lists say "none
// reported"; a source that did not answer says so instead.

import { useQuery } from "@tanstack/react-query";
import { Sun, X } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import { DONKI_DISCLAIMER, gScale, type SpaceWeather } from "@/lib/space/weather";

async function getWeather(): Promise<SpaceWeather> {
  const r = await fetch("/api/space?op=weather");
  const j = (await r.json()) as { data?: SpaceWeather; error?: string };
  if (!r.ok || !j.data) throw new Error(j.error ?? `${r.status}`);
  return j.data;
}

function kpColor(kp: number): string {
  if (kp >= 7) return "var(--alert)";
  if (kp >= 5) return "var(--warn)";
  return "var(--primary)";
}

/** "2026-09-25T18:00:00Z" and DONKI's "2026-09-19T18:17Z" both as "YYYY-MM-DD HH:MMZ". */
const utc = (s: string | undefined) => (s ? s.replace("T", " ").replace(/(\d\d:\d\d):\d\d(\.\d+)?Z$/, "$1Z") : "");

export default function SpaceWeatherPanel() {
  const open = useGlobe((s) => s.spaceWeatherOpen);
  const setOpen = useGlobe((s) => s.setSpaceWeatherOpen);
  const q = useQuery({ queryKey: ["space-weather"], queryFn: getWeather, enabled: open, staleTime: 10 * 60_000, refetchInterval: 15 * 60_000 });
  if (!open) return null;
  const w = q.data;
  const latest = w?.kp.length ? w.kp[w.kp.length - 1] : undefined;
  const g = latest ? gScale(latest.kp) : null;

  return (
    <div className="hud-panel pointer-events-auto flex max-h-[min(62vh,720px)] flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: "#FFD23F" }}>
            <Sun className="mr-1 inline size-3" />
            Space weather
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">geomagnetic activity and the Sun</div>
          <div className="text-[9px] text-muted-foreground">GFZ Kp index · NASA DONKI flares and notifications</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close space weather"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {q.isLoading && <div className="px-3 py-2 text-[10px] text-muted-foreground">reading GFZ and DONKI…</div>}
      {q.error && <div className="px-3 py-2 text-[10px] text-alert">unavailable: {(q.error as Error).message.slice(0, 80)}</div>}

      {w && (
        <div className="min-h-0 overflow-y-auto">
          <section className="px-3 py-2">
            {latest ? (
              <div className="grid grid-cols-[auto_1fr] items-center gap-3">
                <div className="hud-display text-[30px] font-semibold leading-none tabular-nums" style={{ color: kpColor(latest.kp) }}>
                  {latest.kp.toFixed(1)}
                </div>
                <div className="min-w-0 text-[10px] leading-snug">
                  <div className="hud-label">Kp · 3-hour interval from {utc(latest.time)}</div>
                  <div className="text-foreground/85">
                    {latest.status === "pre" ? "preliminary (GFZ)" : latest.status === "def" ? "definitive (GFZ)" : `status ${latest.status || "not given"}`}
                    {" · "}
                    {g ? `${g} on NOAA's G-scale` : "below storm level (NOAA's G-scale starts at Kp 5)"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">{w.failed.includes("GFZ Kp") ? "GFZ Kp did not answer." : "No Kp values in the last 3 days."}</div>
            )}
            {w.kp.length > 1 && (
              <svg viewBox={`0 0 ${w.kp.length * 6} 40`} className="mt-2 h-10 w-full" preserveAspectRatio="none" role="img" aria-label="Kp over the last three days">
                {[5, 7].map((lvl) => (
                  <line key={lvl} x1={0} x2={w.kp.length * 6} y1={40 - (lvl / 9) * 40} y2={40 - (lvl / 9) * 40} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="2 2" />
                ))}
                {w.kp.map((v, i) => (
                  <rect
                    key={v.time}
                    x={i * 6 + 0.5}
                    y={40 - (v.kp / 9) * 40}
                    width={5}
                    height={Math.max(0.5, (v.kp / 9) * 40)}
                    fill={kpColor(v.kp)}
                    fillOpacity={v.status === "pre" ? 0.55 : 0.95}
                  >
                    <title>{`${utc(v.time)} Kp ${v.kp.toFixed(3)} ${v.status === "pre" ? "(preliminary)" : ""}`}</title>
                  </rect>
                ))}
              </svg>
            )}
            <div className="text-[9px] text-muted-foreground/80">last 3 days · lighter bars are preliminary · dashed lines at Kp 5 (G1) and 7 (G3)</div>
          </section>

          <section className="border-t border-border/60 px-3 py-2">
            <div className="flex items-baseline justify-between">
              <span className="hud-label">Solar flares</span>
              <span className="text-[9px] text-muted-foreground">since {w.flaresFrom}</span>
            </div>
            {w.flares == null ? (
              <div className="text-[10px] text-muted-foreground">DONKI flares did not answer.</div>
            ) : w.flares.length === 0 ? (
              <div className="text-[10px] text-foreground/85">none reported</div>
            ) : (
              <ul className="mt-0.5 space-y-0.5 text-[10px] leading-tight">
                {w.flares.slice(0, 8).map((f) => (
                  <li key={f.id} className="flex justify-between gap-2 tabular-nums">
                    <a href={f.link} target="_blank" rel="noreferrer" className="text-foreground/90 hover:text-primary">
                      {f.classType ?? "class n/r"}
                    </a>
                    <span className="truncate text-muted-foreground">
                      peak {utc(f.peak ?? f.begin)}
                      {f.region ? ` · AR ${f.region}` : ""}
                      {f.location ? ` · ${f.location}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-t border-border/60 px-3 py-2">
            <div className="flex items-baseline justify-between">
              <span className="hud-label">Notifications</span>
              <span className="text-[9px] text-muted-foreground">since {w.noticesFrom}</span>
            </div>
            {w.notices == null ? (
              <div className="text-[10px] text-muted-foreground">DONKI notifications did not answer.</div>
            ) : w.notices.length === 0 ? (
              <div className="text-[10px] text-foreground/85">none reported</div>
            ) : (
              <ul className="mt-0.5 space-y-1 text-[10px] leading-snug">
                {w.notices.slice(0, 6).map((n) => (
                  <li key={n.id}>
                    <a href={n.url} target="_blank" rel="noreferrer" className="text-foreground/90 hover:text-primary">
                      {n.type} · {utc(n.issued)}
                    </a>
                    {n.summary && <div className="text-[9px] text-muted-foreground">{n.summary}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="border-t border-border/60 px-3 py-2 text-[9px] leading-snug text-muted-foreground/85">
            <p>Kp: GFZ Potsdam ({w.kpLicense ?? "CC BY 4.0"}). DONKI: NASA CCMC. DONKI says: &ldquo;{DONKI_DISCLAIMER}&rdquo;</p>
            <p className="mt-1">
              Official forecasts and alerts:{" "}
              <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                NOAA SWPC
              </a>
              .
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
