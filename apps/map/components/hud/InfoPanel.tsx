"use client";
// Right-hand panel: selected object dossier, or the signal log when idle.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crosshair, LocateFixed, X } from "lucide-react";
import type { IssStream as IssStreamInfo } from "@/lib/space/weather";
import { useGlobe } from "@/lib/store/globe";
import { LAYER_BY_ID } from "@/lib/layers";
import { formatAltitude, formatLatLon, formatSpeed, timeAgo } from "@/lib/globe/geo";
import { flyToSelection, startFollowing, stopFollowing } from "@/lib/globe/camera";
import { getRenderer } from "@/lib/globe/registry";
import { getCesium } from "@/lib/globe/cesium";
import { isLive } from "@/lib/globe/clock";
import GaugeHistory from "./GaugeHistory";
import type { GaugeExtra } from "@/lib/layers/water";
import type { WellExtra } from "@/lib/layers/groundwater";
import type { ChipExtra } from "@/lib/layers/turbidity";
import type { SatExtra } from "@/lib/layers/satellites";
import { findPasses, type SatPass } from "@/lib/globe/passes";
import { useSettings } from "@/lib/store/settings";
import { turbidityHex } from "@/lib/water/overlay";
import EconomyAside from "./EconomyAsides";
import CompanyAside from "./CompanyAside";
import EmployerAside from "./EmployerAside";
import FinanceAside from "./FinanceAsides";
import ConstructAside, { ConstructContext } from "./ConstructAside";
import { requiredDisclaimer } from "@/lib/civic/terms";
import ParcelAside from "./ParcelAside";
import { flyTo } from "@/lib/globe/camera";
import dynamic from "next/dynamic";
import PowerWaterAside from "./PowerWaterAside";
import TriAside from "./TriAside";
import NldiAside from "./NldiAside";
import HealthAside from "./HealthAside";
import SviAside from "./SviAside";
import HazardHistoryAside from "./HazardHistoryAside";
import { countyHistoryFips } from "@/lib/hazards/history";
import type { SviExtra } from "@/lib/civic/svi";
import type { HealthExtra } from "@/lib/layers/health";
import { useGroundPick, type ReachAnswer } from "@/lib/terrain/ground";

const ChipViewer = dynamic(() => import("./ChipViewer"), {
  ssr: false,
  loading: () => (
    <div className="mx-3 my-2 rounded-sm border border-border/60 p-4 text-center text-[12px] text-muted-foreground">
      Loading 3D…
    </div>
  ),
});

/** "Inside the racks" — data-center dossier extras: power/water context + 3D chip viewer. */
function InsideRacks({ lat, lon }: { lat: number; lon: number }) {
  const [open, setOpen] = useState(() =>
    typeof window === "undefined" ? true : !window.matchMedia("(max-width: 700px)").matches,
  );
  return (
    <div className="border-t border-border/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[48px] w-full items-center justify-between px-3 text-left"
      >
        <span className="hud-label text-[9px]">INSIDE THE RACKS</span>
        <span className="text-[11px] text-muted-foreground" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="pb-1">
          <p className="px-3 pb-1 text-[10px] leading-snug text-muted-foreground">
            This is what&apos;s computing inside buildings like this one — the server CPU, the AI
            GPU, and the DPU that moves the bits.
          </p>
          <PowerWaterAside lat={lat} lon={lon} />
          <div className="hud-label px-3 pb-1 pt-2 text-[9px]">CHIP VIEWER</div>
          <ChipViewer defaultChip="gpu" />
        </div>
      )}
    </div>
  );
}

function useRefresh(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export default function InfoPanel() {
  const selected = useGlobe((s) => s.selected);
  const snapshot = useGlobe((s) => s.selectedFeature);
  // Constructs and the field refetch as the camera moves under a stable id; show the live one.
  const feature =
    snapshot && (snapshot.properties.layer === "constructs" || snapshot.properties.layer === "field" || snapshot.properties.layer === "alerts")
      ? (getRenderer(snapshot.properties.layer)?.getFeature(snapshot.properties.id) ?? snapshot)
      : snapshot;
  const following = useGlobe((s) => s.following);
  const clock = useGlobe((s) => s.clock);
  const log = useGlobe((s) => s.log);
  const layers = useGlobe((s) => s.layers);
  const status = useGlobe((s) => s.status);
  const groundPick = useGroundPick((s) => s.pick);
  // Moving contacts only: aircraft, ships, satellites. Quakes and launch pads
  // are events/places, not contacts.
  const contacts = (["aircraft", "ships", "satellites"] as const).reduce(
    (n, id) => n + (layers[id] && !LAYER_BY_ID[id]?.simulated ? (status[id]?.count ?? 0) : 0),
    0,
  );
  useRefresh(1000);

  if (!selected || !feature) {
    return (
      <aside className="pointer-events-auto hidden w-full md:block">
        <div className="hud-panel">
          <div className="flex h-10 items-center justify-between border-b border-border px-3">
            <span className="hud-label">Signal log</span>
            <span className="text-[9px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground" title="Live contacts: aircraft, ships and satellites on the globe now">
              {contacts > 0 ? `${contacts.toLocaleString()} contacts` : "standing by"}
            </span>
          </div>
          <ul className="max-h-[38vh] space-y-1 overflow-y-auto px-3 py-2.5 text-[10px] leading-relaxed" aria-live="polite">
            {log.length === 0 && (
              <li className="flex items-center gap-2 text-muted-foreground">
                <span className="hud-lamp hud-lamp-off blink" aria-hidden /> Waiting for the first signal
              </li>
            )}
            {log.slice(0, 14).map((e, i) => (
              <li key={`${e.t}-${i}`} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {new Date(e.t).toISOString().slice(11, 19)}
                </span>
                <span
                  className={
                    e.level === "alert" ? "text-alert" : e.level === "warn" ? "text-warn" : "text-foreground/85"
                  }
                >
                  {e.text}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Select any object on the globe for its dossier</div>
        </div>
      </aside>
    );
  }

  const p = feature.properties;
  const def = LAYER_BY_ID[p.layer];
  const color = def?.color ?? "var(--primary)";
  const live = isLive(clock.offsetMs);
  const renderer = getRenderer(p.layer);
  const pos = renderer?.getPosition(p.id);
  let lonlat: [number, number, number] | null = null;
  if (pos) {
    const C = getCesium();
    const c = C.Cartographic.fromCartesian(pos);
    lonlat = [C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude), c.height];
  } else if (feature.geometry.type === "Point") {
    const [lon, lat, alt] = feature.geometry.coordinates;
    lonlat = [lon, lat, alt ?? 0];
  }
  // A construct floats above the point it was asked about; report that point, not the stratum.
  const ground = p.layer === "constructs" || p.layer === "field" ? (p.extra as { ground?: [number, number] } | undefined)?.ground : undefined;
  if (ground) lonlat = [ground[0], ground[1], 0];
  // An identified parcel: the point that was clicked.
  const parcel = p.layer === "parcels";
  if (parcel && p.anchor) lonlat = [p.anchor[0], p.anchor[1], 0];
  const details = Object.entries(p.details ?? {}).filter(([, v]) => v != null && v !== "" && v !== false);
  const isLiveLayer =
    !p.simulated &&
    !["satellites", "launches", "water", "groundwater", "turbidity", "trade", "commerce", "realestate", "companies", "employers", "banks", "spending", "constructs", "field", "flood", "wetlands", "publiclands", "relief", "slope", "contours", "soils", "firehazard", "landcover", "sealevel", "transmission", "pipelines", "plants", "rail", "airports", "dams", "faults", "landslides", "geology", "plss", "parcels", "zoning", "permits", "licences", "envpermits", "historic", "crithab", "contaminants", "wayback", "topo", "impaired", "pfas", "ust", "hydro", "riskindex", "naip", "heritage", "health", "vulnerability", "broadband", "wildfirerisk", "tribal", "hospitals", "schools", "housing", "landslidesusc"].includes(p.layer);
  const banner = BANNER[p.layer];
  // County hazard history under a county-level click of the three county hazard choropleths.
  const historyFips = countyHistoryFips(p.layer, p.extra);
  const iss = p.layer === "satellites" && p.id === "25544";
  const construct = p.layer === "constructs" || p.layer === "field" || p.layer === "alerts";
  const gauge = p.layer === "water" && (p.kind === "gauge" || p.kind === "reservoir") && p.id.startsWith("usgs:") ? (p.extra as GaugeExtra) : null;
  const well = p.layer === "groundwater" && p.kind === "well" ? (p.extra as WellExtra) : null;
  const chip = p.layer === "turbidity" ? (p.extra as ChipExtra) : null;
  const sat = p.layer === "satellites" ? ((p.extra as SatExtra | undefined)?.omm ?? null) : null;
  const estimate = p.layer === "turbidity" || p.layer === "realestate" || p.layer === "spending" || p.layer === "field" ? "ESTIMATE" : null;
  const economy = p.layer === "trade" || p.layer === "commerce" || p.layer === "realestate";
  const disclaimer = requiredDisclaimer(p);
  const hydroPart = groundPick && p.kind === "ground" && p.id === `ground:${groundPick.lat.toFixed(5)},${groundPick.lon.toFixed(5)}` ? groundPick.parts.hydro : undefined;
  const hydroPick = hydroPart && !hydroPart.loading && !hydroPart.error ? ((hydroPart.data as ReachAnswer | null) ?? { comid: null, reach: null }) : null;

  return (
    <aside className="pointer-events-auto w-full" aria-label={`Selected: ${p.name}`}>
      <div className="hud-panel hud-panel-lit hud-enter">
        <div className="flex items-start justify-between gap-2 border-b border-border px-3 pb-2.5 pt-3">
          <div className="min-w-0">
            <div className="hud-label flex items-center gap-2 text-[9px]">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
              <span className="truncate">
                {def?.label ?? p.layer} · {p.kind ?? "object"}
              </span>
              {p.simulated && <span className="text-warn">Simulated</span>}
              {estimate && <span className="text-warn">{estimate}</span>}
            </div>
            <h2 className="hud-display mt-1.5 truncate text-[16px] leading-tight text-[var(--bright)]" title={p.name}>
              {p.name}
            </h2>
            <div className="mt-1 text-[9px] text-muted-foreground">
              src {p.source}
              {p.observedAt ? ` · seen ${timeAgo(p.observedAt)}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => useGlobe.getState().select(null)}
            className="-mr-1 -mt-1 flex size-7 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close (Esc)"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {isLiveLayer && !live && (
          <div className="border-b border-warn/40 bg-warn/10 px-3 py-1 text-[9px] tracking-widest text-warn">
            MISSION CLOCK NOT LIVE · SHOWING LAST KNOWN POSITION
          </div>
        )}

        {banner && (
          <div className="border-b border-border/60 bg-primary/5 px-3 py-1 text-[9px] tracking-widest text-foreground/80">{banner}</div>
        )}

        {p.imageUrl && <CameraStill key={p.imageUrl} url={p.imageUrl} name={p.name} />}
        {iss && <IssStream />}

        {chip && (
          <div className="flex items-center gap-3 border-b border-border px-3 py-2">
            <span
              className="block size-8 shrink-0 border border-black/60"
              style={{ background: turbidityHex(chip.stats.median) }}
              aria-hidden
            />
            <div className="text-[10px] leading-snug text-muted-foreground">
              Dogliotti (2015) physics on Sentinel-2 water pixels. The distilled TurbidityVision model is not bundled; this is
              the teacher it learns from. {chip.lowConfidence ? "Low confidence: spread exceeds the median." : ""}
            </div>
          </div>
        )}

        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 text-[11px]">
          {lonlat && (
            <>
              <dt className="hud-label">Position</dt>
              <dd className="tabular-nums">{formatLatLon(lonlat[1], lonlat[0])}</dd>
            </>
          )}
          {!construct && (p.altitude != null || (lonlat && lonlat[2] > 1)) && (
            <>
              <dt className="hud-label">Altitude</dt>
              <dd className="tabular-nums">{formatAltitude(lonlat ? lonlat[2] : p.altitude)}</dd>
            </>
          )}
          {p.speed != null && (
            <>
              <dt className="hud-label">Speed</dt>
              <dd className="tabular-nums">{formatSpeed(p.speed)}</dd>
            </>
          )}
          {p.heading != null && (
            <>
              <dt className="hud-label">Heading</dt>
              <dd className="tabular-nums">{Math.round(p.heading)}°</dd>
            </>
          )}
          {details.map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </dl>

        {p.layer === "datacenters" && lonlat && (
          <InsideRacks key={`racks:${p.id}`} lat={lonlat[1]} lon={lonlat[0]} />
        )}

        {disclaimer && <p className="border-t border-border/60 px-3 py-2 text-[9px] leading-snug text-muted-foreground">{disclaimer}</p>}

        {p.layer === "health" && (p.extra as HealthExtra | undefined)?.level === "county" && <HealthAside key={`places:${p.id}`} fips={(p.extra as HealthExtra).fips} />}
        {p.layer === "vulnerability" && (p.extra as SviExtra | undefined)?.fips && <SviAside key={`svi:${p.id}`} fips={(p.extra as SviExtra).fips} level={(p.extra as SviExtra).level} />}
        {historyFips && <HazardHistoryAside key={`history:${historyFips}`} fips={historyFips} />}
        {hydroPick && <NldiAside key={`nldi:${p.id}`} reach={hydroPick} />}
        {gauge && lonlat && <NldiAside key={`nldi:${p.id}`} lon={lonlat[0]} lat={lonlat[1]} />}
        {gauge?.primary && (
          <GaugeHistory key={`${gauge.site}:${gauge.primary}`} site={gauge.site} param={gauge.primary} latest={gauge.readings[gauge.primary]?.value} />
        )}
        {sat && <SatPasses key={sat.NORAD_CAT_ID} omm={sat} />}
        {economy && <EconomyAside key={p.id} feature={feature} />}
        {p.layer === "companies" && <CompanyAside key={p.id} feature={feature} />}
        {p.layer === "employers" && <EmployerAside key={p.id} feature={feature} />}
        {(p.layer === "banks" || p.layer === "spending") && <FinanceAside key={p.id} feature={feature} />}
        {parcel && <ParcelAside key={p.id} feature={feature} />}
        {p.layer === "contaminants" && p.kind === "tri" && <TriAside key={p.id} feature={feature} />}
        {construct ? <ConstructAside key={p.id} feature={feature} /> : <ConstructContext key={`ctx:${p.layer}:${p.id}`} feature={feature} />}
        {well && (
          <GaugeHistory
            key={`${well.site}:${well.primary}`}
            site={well.site}
            param={well.primary}
            latest={well.readings[well.primary]?.value}
            invert={well.primary === "72019"}
          />
        )}

        <div className="flex gap-1 border-t border-border p-2">
          {parcel ? (
            <button
              type="button"
              onClick={() => lonlat && flyTo(lonlat[0], lonlat[1], { height: 900, pitchDeg: -60 })}
              className="flex flex-1 items-center justify-center gap-2 border border-border px-2 py-1.5 text-[10px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary"
            >
              <Crosshair className="size-3.5" />
              Fly to
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => (following ? stopFollowing() : startFollowing())}
                className={`flex flex-1 items-center justify-center gap-2 border px-2 py-1.5 text-[10px] uppercase tracking-widest ${
                  following
                    ? "border-signal/60 bg-signal/10 text-signal"
                    : "border-border text-foreground/80 hover:bg-accent hover:text-primary"
                }`}
              >
                <LocateFixed className="size-3.5" />
                {following ? "Following" : "Follow"}
              </button>
              <button
                type="button"
                onClick={() => flyToSelection(selected)}
                className="flex flex-1 items-center justify-center gap-2 border border-border px-2 py-1.5 text-[10px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary"
              >
                <Crosshair className="size-3.5" />
                Fly to
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

/** One-line reminders of what a layer's features are and are not. */
const BANNER: Partial<Record<string, string>> = {
  broadband: "FCC BDC DECEMBER 2025, SUMMARIZED BY ESRI (ESRI MASTER LICENSE AGREEMENT) \u00b7 AVAILABLE AS PROVIDERS REPORT IT, NOT SUBSCRIBED, NOT MEASURED SPEED",
  wildfirerisk: "USFS WILDFIRE RISK TO COMMUNITIES (2ND ED., 2024) \u00b7 MODELLED RELATIVE RANKS, NOT A FORECAST \u00b7 NOT A LOCAL ASSESSMENT",
  tribal: "BIA LAND AREA REPRESENTATION \u00b7 REFERENCE ONLY, NOT LEGAL, SURVEY OR JURISDICTIONAL \u00b7 NOT CENSUS TRIBAL AREAS (FIELD LAYER)",
  vulnerability: "CDC/ATSDR SVI 2022 \u00b7 A PERCENTILE AMONG US COUNTIES (OR TRACTS), NOT A RISK \u00b7 NOT FEMA'S NRI SOCIAL VULNERABILITY",
  health: "CDC PLACES \u00b7 MODEL-BASED ESTIMATES, NOT COUNTS OF DIAGNOSED PEOPLE \u00b7 NOT FOR RANKING SMALL DIFFERENCES",
  heritage: "NPS DESIGNATIONS, NOT OWNERSHIP \u00b7 BATTLEFIELDS ARE SURVEY AREAS, MOSTLY PRIVATE LAND \u00b7 A HERITAGE AREA IS NOT FEDERAL LAND",
  naip: "USDA NAIP AS FLOWN \u00b7 A YEAR IS A MOSAIC OF FLIGHTS \u00b7 THE DATE ON CLICK IS THE PHOTO UNDER THE CURSOR",
  housing: "HUD HOUSING CHOICE VOUCHERS BY TRACT \u00b7 GREY: 10 OR FEWER, OR NONE (HUD SUPPRESSES) \u00b7 QCT AND DDA ARE TAX-CREDIT DESIGNATIONS, NOT MEASURES OF CONDITIONS \u00b7 LIHTC PROJECTS UNDER 5 UNITS ARE NEVER DRAWN",
  riskindex: "FEMA NATIONAL RISK INDEX \u00b7 A RELATIVE INDEX, NOT A LIKELIHOOD \u00b7 COUNTY AND TRACT SCORES ARE NOT COMPARABLE",
  hydro: "NHD PICTURE \u00b7 TRACE AND FLOW ON THE NHDPLUS V2 NETWORK \u00b7 MODELLED FLOW, NOT A MEASUREMENT",
  flood: "REGULATORY FLOOD MAP · NOT A FORECAST",
  parcels: "PUBLIC RECORD AS ITS SOURCE PUBLISHES IT · A TAX MAP, NOT A SURVEY",
  wetlands: "HABITAT MAP FROM DATED IMAGERY · MAY HAVE CHANGED SINCE · NOT A JURISDICTIONAL DELINEATION",
  fires: "SATELLITE HOTSPOT · NOT A CONFIRMED FIRE",
  transmission: "HIFLD ARCHIVE · LAST UPDATED 2024-09-30 · LINES BUILT OR RETIRED SINCE ARE NOT SHOWN AS THEY ARE",
  pipelines: "GENERALIZED ROUTE · NOT FOR LOCATING A LINE (CALL 811 BEFORE YOU DIG)",
  plants: "EIA-860M PRELIMINARY MONTHLY INVENTORY (US) · WIKIDATA NUCLEAR PLANTS (ELSEWHERE)",
  airports: "PUBLIC-USE FACILITY · NOT FOR NAVIGATION",
  schools: "NCES 2024-25 \u00b7 AS STATES REPORTED IT \u00b7 A VIRTUAL SCHOOL'S POINT IS ITS OFFICE \u00b7 NO RACE, SEX OR GRADE COUNTS ARE READ",
  hospitals: "HIFLD VIA FEMA \u00b7 AS EACH STATE LICENSING SOURCE PUBLISHED IT, ON THE DATE SHOWN \u00b7 NOT A LIST OF EMERGENCY DEPARTMENTS",
  dams: "HAZARD POTENTIAL IS THE CONSEQUENCE OF A FAILURE · NOT THE DAM'S CONDITION",
  faults: "QUATERNARY FAULT · NOT AN EARTHQUAKE FORECAST",
  landslides: "MAPPED WHERE SOMEONE LOOKED · NONE SHOWN IS NOT NONE THERE",
  plss: "SURVEY GRID FOR REFERENCE · NOT A PARCEL BOUNDARY",
  airquality: "PRELIMINARY · NOT FULLY VERIFIED OR VALIDATED · SUBJECT TO CHANGE (EPA AIRNOW)",
  events: "MACHINE-CODED FROM NEWS REPORTS · NOT VERIFIED INCIDENTS · NO ACTORS, NO ARTICLE LINKS",
  zoning: "AS THE CITY'S GIS PUBLISHES IT · THE ADOPTED MAP AND CODE GOVERN · NOT A ZONING VERIFICATION",
  permits: "A PERMIT AS THE CITY PUBLISHES IT · PERMISSION TO BUILD, NOT PROOF WORK HAPPENED",
  licences: "AS THE REGISTRY PUBLISHES IT · BY TRADE NAME, NOT A SOLE PROPRIETOR'S OWN NAME · APARTMENT AND UNIT ADDRESSES WITHHELD",
  envpermits: "AS EPA ECHO OR THE CORPS PUBLISHES IT · COMPLIANCE IN ECHO'S OWN WORDS",
  historic: "NATIONAL REGISTER LISTING AS NPS PUBLISHES IT · RESTRICTED ARCHAEOLOGICAL SITES ARE WITHHELD AND NOT SHOWN · NOT A SECTION 106 REVIEW",
  crithab: "REGULATORY DESIGNATION · NOT SPECIES RANGE OR OCCURRENCE · FWS GIS IS NOT THE LEGAL BOUNDARY",
  contaminants: "AN EPA PROGRAM LISTING OR SITE BOUNDARY · A REGULATORY STATUS OR AREA, NOT A FINDING OF CONTAMINATION HERE",
  ust: "COUNTY COUNTS FROM STATE RECORDS AS OF 2018-2021 · A SNAPSHOT, NOT CURRENT STATUS · NO INDIVIDUAL SITES",
  pfas: "UCMR 5 SAMPLES WHERE WATER ENTERS THE SYSTEM, 2023-2025 · NOT A TAP · NOT COMPARED WITH ANY HEALTH LIMIT",
  impaired: "AS THE STATE REPORTED IT TO EPA · A LISTING FOR THE WHOLE ASSESSMENT UNIT, NOT A MEASUREMENT HERE · NOT SHOWN IS NOT CLEAN",
  topo: "USGS MAP AS PUBLISHED · THE EDITION YEAR IS NOT A SURVEY DATE · PARTS OF A SHEET CAN BE DECADES OLDER",
};

/**
 * NASA's own live stream from the ISS, when YouTube's oEmbed confirms it is
 * embeddable, on NASA's channel and titled as the Space Station stream. Any
 * failure hides the block. The player is 200 px tall, YouTube's minimum
 * embedded viewport (200 x 200), with nothing drawn over it and no autoplay.
 * The page's CSP allows exactly this frame host (next.config.ts frame-src).
 */
function IssStream() {
  const q = useQuery({
    queryKey: ["iss-stream"],
    queryFn: async () => {
      const r = await fetch("/api/space?op=iss-stream");
      const j = (await r.json()) as { data?: IssStreamInfo };
      if (!r.ok || !j.data) throw new Error(`${r.status}`);
      return j.data;
    },
    staleTime: 15 * 60_000,
    retry: false,
  });
  const s = q.data;
  if (!s?.available || !s.videoId) return null;
  return (
    <div className="border-b border-border bg-black/60">
      <div className="relative h-[200px] w-full">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${s.videoId}?mute=1&playsinline=1`}
          title={s.title ?? "NASA live stream from the ISS"}
          className="absolute inset-0 h-full w-full border-0"
          allow="encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          allowFullScreen
        />
      </div>
      <div className="px-3 py-1 text-[9px] leading-snug text-muted-foreground">
        {s.title ?? "NASA live stream"} · {s.author ?? "NASA"} on YouTube · checked {new Date(s.checkedAt).toISOString().slice(11, 16)}Z
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number | boolean | null | undefined }) {
  const text = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  const isUrl = typeof v === "string" && /^https?:\/\//.test(v);
  return (
    <>
      <dt className="hud-label truncate" title={k}>
        {k}
      </dt>
      <dd className="min-w-0 break-words">
        {isUrl ? (
          <a href={v as string} target="_blank" rel="noreferrer" className="block truncate text-primary underline-offset-2 hover:underline" title={v as string}>
            {text.replace(/^https?:\/\//, "").slice(0, 40)}
          </a>
        ) : (
          text
        )}
      </dd>
    </>
  );
}

function CameraStill({ url, name }: { url: string; name: string }) {
  // Keyed by url by the parent, so a new camera mounts fresh state.
  const [stamp, setStamp] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setStamp(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const src = `${url}${url.includes("?") ? "&" : "?"}t=${stamp}`;
  return (
    <div className="relative border-b border-border bg-black/60">
      {failed ? (
        <div className="grid h-[150px] place-items-center text-[10px] text-muted-foreground">feed unavailable</div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Public camera: ${name}`}
          className="block max-h-[200px] w-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
      <div className="absolute left-2 top-2 flex items-center gap-1 text-[9px] tracking-widest text-alert">
        <span className="hud-dot blink" /> PUBLIC FEED
      </div>
      <div className="absolute bottom-1 right-2 text-[9px] text-white/60">
        {new Date(stamp).toISOString().slice(11, 19)}Z
      </div>
    </div>
  );
}

function SatPasses({ omm }: { omm: SatExtra["omm"] }) {
  const observer = useSettings((s) => s.prefs.observer);
  const [passes, setPasses] = useState<SatPass[] | null>(null);
  useEffect(() => {
    if (!observer) return;
    let cancelled = false;
    const compute = () => {
      let next: SatPass[];
      try {
        next = findPasses(omm, observer, Date.now(), { hoursAhead: 48 });
      } catch {
        next = [];
      }
      if (!cancelled) setPasses(next);
    };
    const t0 = setTimeout(compute, 0);
    const id = setInterval(compute, 60_000); // one satellite: cheap, keeps times fresh
    return () => {
      cancelled = true;
      clearTimeout(t0);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omm.NORAD_CAT_ID, omm.EPOCH, observer?.lat, observer?.lon]);

  // Without an observer there is nothing to predict against; stale results
  // from a cleared observer are hidden rather than shown.
  const shown = observer ? passes : null;

  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}Z`;
  };

  return (
    <div className="border-t border-border px-3 py-2">
      <div className="hud-label mb-1">Upcoming passes{observer ? ` · ${observer.label}` : ""}</div>
      {!observer && (
        <div className="text-[10px] leading-snug text-muted-foreground">
          Set an observer location in Settings → Data to predict passes overhead.
        </div>
      )}
      {observer && shown && shown.length === 0 && (
        <div className="text-[10px] leading-snug text-muted-foreground">
          No passes above the horizon in the next 48 h from this location.
        </div>
      )}
      {observer && shown && shown.length > 0 && (
        <ul className="space-y-1">
          {shown.slice(0, 5).map((ps, i) => (
            <li key={`${ps.aosTime}-${i}`} className="text-[10px] leading-snug tabular-nums">
              {ps.geostationary ? (
                <span>
                  Visible now · geostationary · max {ps.maxElevation.toFixed(0)}°
                </span>
              ) : (
                <span>
                  {fmt(ps.aosTime)} → {fmt(ps.losTime)}
                  <span className="text-muted-foreground">
                    {" "}
                    · max {ps.maxElevation.toFixed(0)}° · {ps.aosAzimuth.toFixed(0)}°→
                    {ps.losAzimuth.toFixed(0)}°
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 text-[9px] leading-snug text-muted-foreground">
        Predicted from public CelesTrak elements via SGP4 — approximate, degrades as elements age.
      </div>
    </div>
  );
}
