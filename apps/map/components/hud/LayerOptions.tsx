"use client";
// Controls under a data layer's row (not a picture's opacity, which is
// TileControls): the National Risk Index hazard picker and its legend, the
// "Landmarks only" chip on Historic places, the CDC PLACES measure picker, and
// the CDC/ATSDR SVI theme picker with its fixed-break legend, and the
// "Closed too" chip on Hospitals, the broadband measure picker, the wildfire
// risk rank picker, the Trust land (BIA) legend, and the housing measure
// picker with HUD's suppression line.

import type { LayerId } from "@/lib/layers/types";
import { useSettings } from "@/lib/store/settings";
import { NRI_CLASSES, NRI_COLORS, NRI_HAZARDS, NRI_HAZARD_CODES, NRI_NO_RATING_EDGE, parseNriPick } from "@/lib/hazards/nri";
import { isPlacesMeasure, PLACES_BIN_COLORS, PLACES_DEFAULT_MEASURE, PLACES_MEASURES, SOCIAL_NEEDS, UNRANKED_BIN, type PlacesMeasure } from "@/lib/civic/places";
import { parseSviTheme, SVI_BIN_COLORS, SVI_BIN_LABELS, SVI_NO_RANK_EDGE, SVI_THEMES } from "@/lib/civic/svi";
import { BROADBAND_BIN_COLORS, BROADBAND_MEASURES, BROADBAND_NO_DATA_EDGE, binLabelsFor, parseBroadbandMeasure } from "@/lib/civic/broadband";
import { parseWrcMeasure, parseWrcScope, WRC_BIN_COLORS, WRC_BIN_LABELS, WRC_NO_RANK_EDGE, WRC_RANKS } from "@/lib/hazards/wrc";
import { TRIBAL_COLOR } from "@/lib/land/tribal";
import { HOUSING_BIN_COLORS, HOUSING_MEASURES, HOUSING_NO_DATA_EDGE, HOUSING_SUPPRESSED_FILL, housingBinLabels, parseHousingMeasure, QCT_EDGE, SUPPRESSED_LEGEND } from "@/lib/civic/housing";
import { DDA_EDGE, housingPartsPref, LIHTC_COLOR, LIHTC_POINT_SIZES, LIHTC_UNIT_LABELS } from "@/lib/civic/taxcredit";

/** Layers with controls here. */
export const OPTION_LAYERS = new Set<LayerId>(["riskindex", "historic", "health", "vulnerability", "hospitals", "broadband", "wildfirerisk", "tribal", "housing"]);

function RiskPicker() {
  const pick = parseNriPick(useSettings((s) => s.prefs.nriHazard));
  const setPref = useSettings((s) => s.setPref);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Hazard</span>
        <select
          value={pick}
          onChange={(e) => setPref("nriHazard", e.target.value)}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="National Risk Index: composite or one hazard"
        >
          <option value="composite" className="bg-background">
            Composite (all 18 hazards)
          </option>
          {[...NRI_HAZARD_CODES].sort((a, b) => NRI_HAZARDS[a].localeCompare(NRI_HAZARDS[b])).map((h) => (
            <option key={h} value={h} className="bg-background">
              {NRI_HAZARDS[h]}
            </option>
          ))}
        </select>
      </label>
      <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {NRI_CLASSES.map((c) => (
          <li key={c} className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <span className="inline-block size-2 shrink-0 border border-black/40" style={{ background: NRI_COLORS[c] }} aria-hidden />
            {c}
          </li>
        ))}
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border border-dashed" style={{ borderColor: NRI_NO_RATING_EDGE }} aria-hidden />
          no rating or not in the index (never low)
        </li>
      </ul>
      <div>FEMA&apos;s rating words: a percentile among all US counties (or tracts), not a likelihood. Click a county for the 18 hazards, expected annual loss, social vulnerability as published in the index and resilience.</div>
    </>
  );
}

function LandmarksChip() {
  const on = useSettings((s) => s.prefs.nhlOnly);
  const setPref = useSettings((s) => s.setPref);
  return (
    <>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setPref("nhlOnly", !on)}
        className={`border px-2 py-0.5 text-[10px] uppercase tracking-widest ${on ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-foreground/80 hover:bg-accent"}`}
      >
        Landmarks only
      </button>
      <div>National Historic Landmarks as NPS flags them (Is_NHL), with the same exclusions: listed only, no restricted addresses.</div>
    </>
  );
}

function MeasurePicker() {
  const raw = useSettings((s) => s.prefs.placesMeasure);
  const setPref = useSettings((s) => s.setPref);
  const pick: PlacesMeasure = isPlacesMeasure(raw) ? raw : PLACES_DEFAULT_MEASURE;
  const entries = Object.entries(PLACES_MEASURES) as Array<[PlacesMeasure, (typeof PLACES_MEASURES)[PlacesMeasure]]>;
  const cats = [...new Set(entries.map(([, m]) => m.category))];
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Measure</span>
        <select
          value={pick}
          onChange={(e) => setPref("placesMeasure", e.target.value)}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="CDC PLACES measure"
        >
          {cats.map((c) => (
            <optgroup key={c} label={c}>
              {entries
                .filter(([, m]) => m.category === c)
                .map(([id, m]) => (
                  <option key={id} value={id} className="bg-background">
                    {m.short} ({m.year}){SOCIAL_NEEDS.includes(id) ? ", optional module: not every state" : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {PLACES_BIN_COLORS.map((c, i) => (
          <li key={c} className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <span className="inline-block size-2 shrink-0 border border-black/40" style={{ background: c }} aria-hidden />
            quintile {i + 1}
          </li>
        ))}
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border border-black/40" style={{ background: PLACES_BIN_COLORS[UNRANKED_BIN] }} aria-hidden />
          published, not ranked: fewer than five values (drawn as quintile 3)
        </li>
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border border-dashed" style={{ borderColor: NRI_NO_RATING_EDGE }} aria-hidden />
          not published
        </li>
      </ul>
      <div>{PLACES_MEASURES[pick].name}. Counties: age-adjusted, national quintiles; tracts below 100 km: crude, quintiles of the tracts in view. Model-based estimates, not counts.</div>
    </>
  );
}

function SviThemePicker() {
  const theme = parseSviTheme(useSettings((s) => s.prefs.sviTheme));
  const setPref = useSettings((s) => s.setPref);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Theme</span>
        <select
          value={String(theme)}
          onChange={(e) => setPref("sviTheme", e.target.value)}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="CDC/ATSDR SVI: overall or one theme"
        >
          {SVI_THEMES.map((t, i) => (
            <option key={t.field} value={String(i)} className="bg-background">
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {SVI_BIN_COLORS.map((c, i) => (
          <li key={c} className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <span className="inline-block size-2 shrink-0 border border-black/40" style={{ background: c }} aria-hidden />
            {SVI_BIN_LABELS[i]}
          </li>
        ))}
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border border-dashed" style={{ borderColor: SVI_NO_RANK_EDGE }} aria-hidden />
          not ranked by CDC or not in this release (never least)
        </li>
      </ul>
      <div>CDC/ATSDR SVI: percentile among US counties (or tracts), 0 least to 1 most vulnerable. Not FEMA&apos;s NRI social vulnerability; a click shows both, side by side.</div>
    </>
  );
}

function ClosedHospitalsChip() {
  const all = useSettings((s) => s.prefs.hospitalStatus) === "all";
  const setPref = useSettings((s) => s.setPref);
  return (
    <>
      <button
        type="button"
        aria-pressed={all}
        onClick={() => setPref("hospitalStatus", all ? "open" : "all")}
        className={`border px-2 py-0.5 text-[10px] uppercase tracking-widest ${all ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-foreground/80 hover:bg-accent"}`}
      >
        Closed too
      </button>
      <div>HIFLD lists 374 hospitals as closed; they are drawn grey when this is on. Dot size is published beds; a hospital with no bed count published takes the base size.</div>
    </>
  );
}

function BroadbandPicker() {
  const m = parseBroadbandMeasure(useSettings((s) => s.prefs.broadbandMeasure));
  const setPref = useSettings((s) => s.setPref);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Measure</span>
        <select
          value={String(m)}
          onChange={(e) => setPref("broadbandMeasure", e.target.value)}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="FCC broadband: measure drawn"
        >
          {BROADBAND_MEASURES.map((x, i) => (
            <option key={x.id} value={String(i)} className="bg-background">
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {BROADBAND_BIN_COLORS.map((c, i) => (
          <li key={c} className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <span className="inline-block size-2 shrink-0 border border-black/40" style={{ background: c }} aria-hidden />
            {binLabelsFor(m)[i]}
          </li>
        ))}
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border border-dashed" style={{ borderColor: BROADBAND_NO_DATA_EDGE }} aria-hidden />
          not published in this geography (Connecticut&apos;s planning regions) or no BDC row
        </li>
      </ul>
      <div>FCC BDC December 2025, summarized by Esri (Esri Master License Agreement). Shares of Broadband Serviceable Locations; available as providers report it, not subscribed. Below 60 km, BDC&apos;s own H3 hexagons.</div>
    </>
  );
}

function HousingPicker() {
  const m = parseHousingMeasure(useSettings((s) => s.prefs.housingMeasure));
  const parts = housingPartsPref(useSettings((s) => s.prefs.housingParts));
  const setPref = useSettings((s) => s.setPref);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Measure</span>
        <select
          value={String(m)}
          onChange={(e) => setPref("housingMeasure", e.target.value)}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="HUD housing vouchers: measure drawn"
        >
          {HOUSING_MEASURES.map((x, i) => (
            <option key={x.id} value={String(i)} className="bg-background">
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {HOUSING_BIN_COLORS.map((c, i) => (
          <li key={c} className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <span className="inline-block size-2 shrink-0 border border-black/40" style={{ background: c }} aria-hidden />
            {housingBinLabels(m)[i]}
          </li>
        ))}
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border border-dashed opacity-60" style={{ background: HOUSING_SUPPRESSED_FILL, borderColor: HOUSING_NO_DATA_EDGE }} aria-hidden />
          {SUPPRESSED_LEGEND}
        </li>
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border border-dashed" style={{ borderColor: HOUSING_NO_DATA_EDGE }} aria-hidden />
          not published for Connecticut
        </li>
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border-2 border-dashed" style={{ borderColor: QCT_EDGE }} aria-hidden />
          Qualified Census Tract (HUD, titled 2026)
        </li>
      </ul>
      <div>Housing Choice Voucher households per 2020 tract, through December 2025. The share is HUD&apos;s: vouchers over renter-occupied units (2020 Census). A Qualified Census Tract is a tax-credit designation, not a measure of conditions. Below 100 km, in a box around the view.</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {(
          [
            ["dda", "Tax-credit areas (DDA)"],
            ["lihtc", "Tax-credit properties (LIHTC)"],
          ] as const
        ).map(([id, label]) => {
          const on = parts.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => setPref("housingParts", (on ? parts.filter((p) => p !== id) : [...parts, id]).join(","))}
              className={`border px-2 py-0.5 text-[10px] uppercase tracking-widest ${on ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-foreground/80 hover:bg-accent"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {parts.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
          {parts.includes("dda") && (
            <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
              <span className="inline-block size-2 shrink-0 border-2 border-dashed" style={{ borderColor: DDA_EDGE }} aria-hidden />
              Difficult Development Area (HUD, titled 2026): metro ZIP area or non-metro county
            </li>
          )}
          {parts.includes("lihtc") &&
            LIHTC_UNIT_LABELS.map((l, i) => (
              <li key={l} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <span className="inline-block shrink-0 rounded-full border border-white" style={{ background: LIHTC_COLOR, width: LIHTC_POINT_SIZES[i], height: LIHTC_POINT_SIZES[i] }} aria-hidden />
                {l} low-income units
              </li>
            ))}
        </ul>
      )}
      {parts.includes("lihtc") && <div>HUD&apos;s LIHTC properties of five or more units at the address the state reported; smaller projects are a household&apos;s home and are never drawn. Coded fields are shown as HUD&apos;s codes.</div>}
    </>
  );
}

function WrcPicker() {
  const m = parseWrcMeasure(useSettings((s) => s.prefs.wrcMeasure));
  const scope = parseWrcScope(useSettings((s) => s.prefs.wrcScope));
  const setPref = useSettings((s) => s.setPref);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Rank</span>
        <select
          value={String(m)}
          onChange={(e) => setPref("wrcMeasure", e.target.value)}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="USFS Wildfire Risk to Communities: rank family (service aliases)"
        >
          {WRC_RANKS.map((k, i) => (
            <option key={k.national} value={String(i)} className="bg-background">
              {scope === "state" ? k.stateAlias : k.alias}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Among</span>
        <select
          value={scope}
          onChange={(e) => setPref("wrcScope", e.target.value === "state" ? "state" : "national")}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="Rank among all US places or within the state"
        >
          <option value="national" className="bg-background">
            the nation
          </option>
          <option value="state" className="bg-background">
            the state
          </option>
        </select>
      </label>
      <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {WRC_BIN_COLORS.map((c, i) => (
          <li key={c} className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <span className="inline-block size-2 shrink-0 border border-black/40" style={{ background: c }} aria-hidden />
            {WRC_BIN_LABELS[i]}
          </li>
        ))}
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border border-dashed" style={{ borderColor: WRC_NO_RANK_EDGE }} aria-hidden />
          not ranked by USFS (never low)
        </li>
      </ul>
      <div>Percentile ranks as USFS publishes them, named by the service&apos;s own aliases. Relative and modelled: not a forecast, not a local assessment. The Wildfire hazard layer draws WHP itself.</div>
    </>
  );
}

function TribalLegend() {
  return (
    <>
      <ul className="flex flex-wrap gap-x-2 gap-y-0.5">
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="inline-block size-2 shrink-0 border" style={{ background: `${TRIBAL_COLOR}44`, borderColor: TRIBAL_COLOR }} aria-hidden />
          BIA land area: trust, restricted fee or mixed ownership
        </li>
        <li className="flex items-center gap-1 text-[9px] text-muted-foreground">Census statistical areas are on the Field layer (tribal land), drawn unfilled</li>
      </ul>
      <div>Reference only, never jurisdiction. Parts under 0.7 km2 are dropped, except each land area&apos;s largest part, which is drawn even when smaller so no land area disappears. BIA&apos;s layer has no Oklahoma land, so a blank area does not mean no tribal land.</div>
    </>
  );
}

export default function LayerOptions({ id }: { id: LayerId }) {
  if (!OPTION_LAYERS.has(id)) return null;
  return <div className="mt-1.5 space-y-1 pl-4 text-[10px] text-muted-foreground md:text-[9px]">{id === "riskindex" && <RiskPicker />}{id === "historic" && <LandmarksChip />}{id === "health" && <MeasurePicker />}{id === "vulnerability" && <SviThemePicker />}{id === "hospitals" && <ClosedHospitalsChip />}{id === "broadband" && <BroadbandPicker />}{id === "wildfirerisk" && <WrcPicker />}{id === "tribal" && <TribalLegend />}{id === "housing" && <HousingPicker />}</div>;
}
