"use client";
// What this is, what it is not, and where every signal comes from.

import { useState } from "react";
import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LAYERS } from "@/lib/layers";
import DataTerms from "./DataTerms";
import { TERRARIUM_ATTRIBUTION } from "@/lib/terrain/products";
import { PROMISE } from "@/lib/seo/base";

export default function AboutButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "flex w-full items-center gap-2.5 rounded px-3 py-2.5 text-left text-[13px] text-foreground/85 hover:bg-accent hover:text-primary"
            : "hud-btn"
        }
        title="About, data sources and rules"
        aria-label={compact ? undefined : "About, data sources and rules"}
      >
        <Info className={compact ? "size-4 shrink-0" : "size-3.5"} />
        {compact && "About & data sources"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="hud-panel max-h-[88vh] w-[min(640px,calc(100vw-24px))] overflow-y-auto rounded-none p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="hud-display text-lg text-primary">Embedding Atlas</DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground">
              {PROMISE} Open source, MIT.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4 text-[11px] leading-relaxed">
            <section>
              <div className="hud-label mb-1">Rules of engagement</div>
              <ul className="list-disc space-y-1 pl-4 text-foreground/90">
                <li>Public infrastructure, public land and public events: aircraft, ships, satellites, earthquakes, open-data cameras, rocket launches, the water systems communities depend on (rivers, lakes, reservoirs, aquifers, drought), the economy in aggregate (harbours and border crossings, jobs, wages, home values and rents by county), public companies, banks and federal award recipients as their regulators publish them, and hazards and land: wildfires, satellite fire hotspots, weather and disaster alerts, flood zones, wetlands (with the year of the imagery they were mapped from), public and protected lands with their owners, managers and easement holders; and infrastructure and geohazards: transmission lines, pipelines, power plants, rail, public-use airports, dams, Quaternary faults, landslides, geology and the PLSS survey grid, with AirNow air quality monitors and conflict events GDELT codes from the news; and parcels as each county or state parcel service publishes them; and zoning as ten cities&apos; own GIS publish it, building permits from seven city portals, licensed premises from five registries, and EPA and Army Corps environmental permits.</li>
                <li>No face recognition, no person tracking, no search for named individuals, no licence plates, no phone signals. No code path identifies a person from a face, a track, a licence plate or a phone signal, and no search goes from a person&apos;s name to what they own.</li>
                <li>Parcels, addresses and ownership appear as each public source publishes them, with nothing added. ⌘K search looks only at names and published identifiers (callsign, registration, MMSI, NORAD id, fire id, ticker, place names), never at owner, operator, manager or easement-holder fields, so an owner&apos;s name finds land only where the publisher&apos;s own name for it contains that name. A parcel&apos;s owner appears only in the record of the one parcel you click; lot lines carry no names, and what a source withholds (a confidentiality flag, New Jersey&apos;s Daniel&apos;s Law) stays withheld here. Companies and banks are found by the names their regulators publish, and a bank branch&apos;s name includes its bank, so a bank&apos;s name lists its loaded branches. Permits, licences and environmental permits are named by their numbers (a licence by its trade name). No applicant, owner or contact name is requested. A licence registrant&apos;s legal name is requested only to test whether it is a company&apos;s and whether the trade name is that same name, and is never shown unless it is a company&apos;s, so a sole proprietor trading under their own name is not named; a trade name is otherwise shown as published and can contain a person&apos;s name. The contractor on a permit and the Corps&apos; project name are shown in the dossier as published and can be a person&apos;s name (a Corps project name that opens &ldquo;Surname, Given&rdquo; is withheld); none of these is searched. Licences at apartment or unit addresses are withheld as likely homes.</li>
                <li>Every severity is its publisher&apos;s own (NWS, GDACS, FIRMS confidence, WFIGS containment). Anything the source did not rate says &ldquo;not rated by source&rdquo; and is never drawn as calm. FEMA flood zones are a regulatory map, not a forecast. Zoning is shown as each city publishes it and never as &ldquo;unzoned&rdquo; where no polygon covers a point; ECHO compliance is ECHO&apos;s own words. The hazard layers are not a warning service; follow official channels in an emergency.</li>
                <li>Camera positions are operator-published and coarse; no camera orientation is ever drawn. DriveBC and Caltrans publish a compass word for some cameras, which the dossier shows as published. Cameras come only from agencies whose published terms allow reuse (TfL, NYC DOT, Caltrans, DriveBC, Digitraffic, LTA).</li>
                <li>Operators and owners of infrastructure (a line&apos;s owner, a pipeline&apos;s operator, a railroad&apos;s reporting marks, a plant&apos;s reporting entity) are shown as the public registry publishes them, in the dossier only; search never reads them and nothing is joined across sources. Private-use airports and dam owner names are left out.</li>
                <li>AirNow readings are PRELIMINARY, as AirNow requires, and credited to the agency that reported them. GDELT events are machine-coded from news: city-level locations and conflict classes only, counted per city, with no actor names and no article links.</li>
                <li>The turbidity layer is a labelled estimate: Dogliotti (2015) physics run in your browser on real Sentinel-2 pixels, the teacher that TurbidityVision distils, not the distilled model and not a measurement. Every other layer relays a public feed or dataset as it was published; nothing is invented.</li>
                <li>The weather layer samples live current conditions on a coarse grid around your view (temperature colour, wind barbs) — it is a sampling of now, not a forecast and not global coverage. The sports layer plots games at their venues as geocoded from the stadium name; scores and statuses are the feed&apos;s as-reported, and venues still being located are counted, not placed.</li>
                <li>The satellites layer propagates public CelesTrak elements with SGP4. Pass predictions use the standard horizon-search approach (as in Gpredict and Look4Sat, whose design informed this implementation) and are approximate: they degrade as elements age, and they need an observer location you set yourself.</li>
                <li>Water-quality screens compare a gauge&apos;s latest reading with cited EPA freshwater thresholds and print the formula; the community water report prints its weights and the terms it lacked. None of it is advice on whether water is safe to drink.</li>
                <li>Home values, rents, jobs and wages are county, metro and state aggregates from Zillow Research and the BLS; the Home values layer is labelled ESTIMATE because Zillow&apos;s indexes are models of a typical home, and the mortgage-against-wages line prints its formula. None of it is investment or lending advice.</li>
                <li>API keys you enter stay in this browser and only reach this app&apos;s own /api routes or the vendor SDK they belong to.</li>
              </ul>
            </section>
            <section>
              <div className="hud-label mb-1">Signal sources</div>
              <p className="mb-2 text-foreground/90">
                <a href="/catalog" target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                  Browse the catalogue
                </a>
                : each curated collection with its source, licence, coverage, freshness, and what is left out and why.
              </p>
              <ul className="space-y-1">
                {LAYERS.map((l) => (
                  <li key={l.id} className="flex gap-2">
                    <span className="hud-dot mt-1.5 shrink-0" style={{ color: l.color }} />
                    <span>
                      <span className="hud-display text-[12px]" style={{ color: l.color }}>
                        {l.label}
                      </span>
                      {l.simulated && <span className="ml-2 text-[9px] tracking-widest text-warn">SIMULATED</span>}
                      {l.estimate && <span className="ml-2 text-[9px] tracking-widest text-warn">ESTIMATE</span>}
                      <span className="text-muted-foreground"> · {l.attribution}</span>
                      <div className="text-foreground/75">{l.description}</div>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <DataTerms />
            <section>
              <div className="hud-label mb-1">Globe</div>
              <p className="text-foreground/80">
                CesiumJS with Esri World Imagery and NASA Black Marble night lights, no account required. Add a Google Maps
                key for Photorealistic 3D Tiles in Settings. 3D terrain (Settings) is keyless: AWS Terrain Tiles (Mapzen / Tilezen), or Cesium World Terrain with a Cesium ion token. Terrain data credits: {TERRARIUM_ATTRIBUTION.join("; ")}.
              </p>
            </section>
            <section>
              <div className="hud-label mb-1">Keyboard</div>
              <p className="text-muted-foreground">
                <span className="hud-kbd">⌘K</span> search · <span className="hud-kbd">,</span> settings ·{" "}
                <span className="hud-kbd">Esc</span> leave a measure tool, then deselect · right-click: what&apos;s here · drag to orbit · scroll to zoom · middle-drag to tilt
              </p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
