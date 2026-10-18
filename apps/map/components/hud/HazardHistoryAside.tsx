"use client";
// The county Hazard history click answer, under a county-level click of FEMA's
// National Risk Index, Social vulnerability or Wildfire risk ranks:
// /api/hazards?op=history&fips= (FEMA declarations, USDM drought, NOAA climate,
// SPC tornadoes, USGS landslide susceptibility, NCEI Storm Events by county
// since 1996). Asked once when the dossier
// opens (a click, never a pan). Every number is published or a count of
// published rows; the two drawn derivations (the highest weekly DSCI in each
// year, the 1901-2000 mean) are labelled as computed. Connecticut's planning
// regions get drought only, with the one-line reason.

import { useEffect, useState } from "react";
import type { Series } from "@/lib/series/types";
import { centuryMean, CT_HISTORY_LINE, dsciYearlyMax, yearRows, type HistoryData } from "@/lib/hazards/history";
import { STORM_ALASKA_LINE, STORM_CT_LINE, STORM_MAIN_TYPES, STORM_ZONE_SHARE_MAX } from "@/lib/hazards/storms";
import SeriesChart from "./SeriesChart";

type State = { data?: HistoryData; caveats?: string[]; error?: string };

const SHADES = { dr: "#B45309", em: "#D97706", fm: "#FBBF24" } as const;
const STORM_SHADES: Record<string, string> = { Hail: "#0E7490", "Thunderstorm Wind": "#4338CA", "Flash Flood": "#1D4ED8" };
/** "1996, 1998-2001": a list of years as runs. */
const runs = (ys: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < ys.length; ) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    out.push(i === j ? String(ys[i]) : `${ys[i]}-${ys[j]}`);
    i = j + 1;
  }
  return out.join(", ");
};
const pct = (v: number | null | undefined) => (v == null ? "not published" : `${v.toFixed(1)} %`);

export default function HazardHistoryAside({ fips }: { fips: string }) {
  const [st, setSt] = useState<State>({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/hazards?op=history&fips=${fips}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { data?: HistoryData; caveats?: string[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (live) setSt({ data: j.data, caveats: j.caveats });
      })
      .catch((e: Error) => live && setSt({ error: e.message }));
    return () => {
      live = false;
    };
  }, [fips]);

  if (st.error) return <div className="border-t border-border px-3 py-2 text-[10px] text-alert">Hazard history did not answer: {st.error.slice(0, 80)} (unknown, not missing)</div>;
  if (!st.data) return <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">asking FEMA, the Drought Monitor, NOAA and USGS for this county&apos;s hazard history…</div>;
  const d = st.data;
  const s = (id: string): Series | undefined => d.series.find((x) => x.id === `${id}:${fips}`);
  const miss = (src: string) => d.missing.find((m) => m.source === src || m.source.startsWith(src));
  const ct = /^091[1-9]0$/.test(fips);
  const dr = s("fema:dr");
  const em = s("fema:em");
  const fm = s("fema:fm");
  const total = (x?: Series) => (x ? x.points.reduce((a, p) => a + (p.v ?? 0), 0) : 0);
  const dsci = s("usdm:dsci");
  const tavg = s("cag:tavg");
  const pcp = s("cag:pcp");
  const torn = s("spc:tornadoes");
  const tMean = tavg ? centuryMean(tavg.points) : null;
  const pMean = pcp ? centuryMean(pcp.points) : null;
  const ls = d.landslide;
  const now = d.droughtNow;
  const storms = d.storms ?? null;
  const stormMiss = miss("NCEI Storm Events");
  const stormMain = storms ? STORM_MAIN_TYPES.map((t) => storms.types.find((x) => x.type === t)).filter((x): x is NonNullable<typeof x> => !!x) : [];
  const stormOther = storms ? storms.types.filter((x) => !(STORM_MAIN_TYPES as readonly string[]).includes(x.type) && x.total > 0).sort((a, b) => b.total - a.total) : [];

  return (
    <div className="border-t border-border" aria-label="Hazard history">
      <div className="px-3 pt-2">
        <div className="hud-label">Hazard history</div>
        {ct && <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground">{CT_HISTORY_LINE}</p>}
      </div>

      <section className="px-3 pt-2" aria-label="Disaster declarations">
        <div className="hud-label">Disaster declarations (FEMA)</div>
        {miss("FEMA") ? (
          <div className="text-[10px] text-muted-foreground">{miss("FEMA")!.reason === "source:failed" ? "FEMA did not answer (unknown, not none)" : "not published in this geography"}</div>
        ) : (
          <>
            <div className="text-[10px] tabular-nums">
              {total(dr)} major disaster · {total(em)} emergency · {total(fm)} fire management
            </div>
            <ul className="mt-1 space-y-0.5 text-[10px]">
              {d.declarations.slice(0, 5).map((x, i) => (
                <li key={`${x.disasterNumber}:${i}`} className="leading-snug">
                  {x.declarationType}-{x.disasterNumber} · {x.declarationDate} · {x.incidentType} · {x.declarationTitle}
                  {x.programs.length ? ` · ${x.programs.join(", ")}` : ""}
                </li>
              ))}
            </ul>
            {d.declarations.length > 5 && (
              <>
                <button type="button" className="mt-1 flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                  <span className="text-[10px] text-muted-foreground">all {d.declarations.length} declarations</span>
                  <span className="text-[11px] text-muted-foreground" aria-hidden>
                    {open ? "▾" : "▸"}
                  </span>
                </button>
                {open && (
                  <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-[10px]">
                    {d.declarations.slice(5).map((x, i) => (
                      <li key={`${x.disasterNumber}:${i + 5}`} className="leading-snug">
                        {x.declarationType}-{x.disasterNumber} · {x.declarationDate} · {x.incidentType} · {x.declarationTitle} · {x.designatedArea}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </section>
      {dr && <SeriesChart title="Major disaster declarations per year" rows={yearRows(dr.points)} bars color={SHADES.dr} fmt={(v) => String(Math.round(v))} note="Years with none are not drawn while the zero rule is pending." />}
      {em && <SeriesChart title="Emergency declarations per year" rows={yearRows(em.points)} bars color={SHADES.em} fmt={(v) => String(Math.round(v))} />}
      {fm && <SeriesChart title="Fire management declarations per year" rows={yearRows(fm.points)} bars color={SHADES.fm} fmt={(v) => String(Math.round(v))} />}

      <section className="px-3 pt-2" aria-label="Drought">
        <div className="hud-label">Drought (U.S. Drought Monitor)</div>
        {now ? (
          <div className="text-[10px] tabular-nums">
            week of {now.mapDate}: none {pct(now.none)} · D0 {pct(now.d0)} · D1 {pct(now.d1)} · D2 {pct(now.d2)} · D3 {pct(now.d3)} · D4 {pct(now.d4)}
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground">{miss("USDM") ? "the Drought Monitor did not answer (unknown, not none)" : "no week published"}</div>
        )}
      </section>
      {dsci && <SeriesChart title="Highest weekly DSCI in the year (USDM DSCI, 0-500)" rows={dsciYearlyMax(dsci.points)} bars color="#C2410C" fmt={(v) => String(Math.round(v))} note="Computed here from USDM's weekly index: each bar is the year's highest week." />}

      <section className="px-3 pt-2" aria-label="Climate">
        <div className="hud-label">Climate (NOAA Climate at a Glance)</div>
        {miss("NOAA Climate") && <div className="text-[10px] text-muted-foreground">{ct ? "published only for Connecticut's old counties" : d.state === "PR" ? "not published for Puerto Rico" : "NOAA did not answer (unknown, not missing)"}</div>}
        {d.state === "HI" && <div className="text-[9px] text-muted-foreground">climate from 1991</div>}
      </section>
      {tavg && <SeriesChart title={`Annual average temperature (${tavg.unit})`} points={tavg.points} color="#DC2626" reference={tMean != null ? { value: tMean, label: "1901-2000 mean (computed)" } : undefined} />}
      {pcp && <SeriesChart title={`Annual precipitation (${pcp.unit})`} points={pcp.points} color="#2563EB" reference={pMean != null ? { value: pMean, label: "1901-2000 mean (computed)" } : undefined} />}

      <section className="px-3 pt-2" aria-label="Tornadoes and landslides">
        <div className="hud-label">Tornadoes and landslides</div>
        {miss("SPC") && <div className="text-[10px] text-muted-foreground">tornadoes: published only for Connecticut&apos;s old counties</div>}
        {torn && <div className="text-[10px] tabular-nums">{total(torn)} tornado records since 1950 (NOAA SPC)</div>}
        {ls ? (
          <div className="text-[10px] leading-snug">
            {ls.prop_susc == null ? "susceptible share not published" : `${(ls.prop_susc * 100).toFixed(1)} % of the county's land is susceptible terrain (USGS 2024)`}
            {ls.v2_ls_count != null && `; ${ls.v2_ls_count} mapped landslides recorded in it (USGS inventory version 2; mapping effort varies by state)`}
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground">landslide susceptibility: {miss("USGS")?.reason === "join:boundary_changed_since_2010" ? "not published for this county (its boundary changed after 2010)" : ct ? "published only for Connecticut's old counties" : "not in USGS's county table"}</div>
        )}
      </section>
      {torn && <SeriesChart title="Tornadoes per year (NOAA SPC)" rows={yearRows(torn.points)} bars color="#7C3AED" fmt={(v) => String(Math.round(v))} note="SPC undercounts weak tornadoes before the 1990s radar network. Years with none are not drawn while the zero rule is pending." />}

      <section className="px-3 pt-2" aria-label="Storm events">
        <div className="hud-label">Storm events (NCEI)</div>
        {stormMiss ? (
          <div className="text-[10px] text-muted-foreground">{stormMiss.reason === "join:legacy_ct_counties" ? STORM_CT_LINE : stormMiss.reason === "join:ncei_areas_not_counties" ? STORM_ALASKA_LINE : "NCEI Storm Events could not be read (unknown, not none)"}</div>
        ) : storms ? (
          <>
            <div className="text-[10px] tabular-nums">
              {stormMain.map((t) => `${t.total.toLocaleString("en-US")} ${t.type.toLowerCase()}`).join(" · ")} reports since {storms.years?.[0] ?? 1996} (county-coded; tornadoes are SPC&apos;s, above)
            </div>
            {stormOther.length > 0 && (
              <div className="text-[10px] leading-snug text-muted-foreground">
                +{stormOther.reduce((a, x) => a + x.total, 0).toLocaleString("en-US")} other county-coded reports: {stormOther.map((x) => `${x.type.toLowerCase()} ${x.total}`).join(", ")}
              </div>
            )}
            {storms.break && <div className="text-[9px] text-muted-foreground">series break in {storms.break.year}: {storms.break.what}</div>}
          </>
        ) : null}
      </section>
      {stormMain.map((t) => (
        <SeriesChart
          key={t.type}
          title={`${t.type} reports per year (NOAA NCEI Storm Events)`}
          rows={t.points.map(([y, n]) => [String(y), n] as [string, number])}
          bars
          color={STORM_SHADES[t.type] ?? "#0E7490"}
          fmt={(v) => String(Math.round(v))}
          note={`${t.blank.length ? `Blank, not 0: ${runs(t.blank.map(([y]) => y))} (${Math.round(STORM_ZONE_SHARE_MAX * 100)} % or more of the type's reports nationally were by forecast zone). ` : ""}Years with none are not drawn while the zero rule is pending. Counts are reports, which grew with spotter networks.`}
        />
      ))}

      {st.caveats && st.caveats.length > 0 && <p className="px-3 py-2 text-[9px] leading-snug text-muted-foreground">{st.caveats[0]}</p>}
    </div>
  );
}
