"use client";
// Settings: optional API keys (stored in localStorage only), display prefs,
// data source choices. Everything works with the form left empty.

import { ExternalLink, Eye, EyeOff, LocateFixed, Trash2 } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useGlobe } from "@/lib/store/globe";
import { API_KEYS, useSettings, type ApiKeyId, type Prefs } from "@/lib/store/settings";
import { SATELLITE_GROUPS } from "@/lib/layers/satellites";

const GROUPS = ["Globe", "Aircraft", "Ships", "Cameras", "Voice"] as const;

export default function SettingsDialog() {
  const open = useGlobe((s) => s.settingsOpen);
  const setOpen = useGlobe((s) => s.setSettingsOpen);
  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogContent className="hud-panel max-h-[88vh] w-[min(720px,calc(100vw-24px))] overflow-y-auto rounded-none p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="hud-display text-lg text-primary">Settings</DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Everything works with no keys. Keys are stored in this browser&apos;s localStorage only and
            sent solely to this app&apos;s own /api routes or the vendor SDK they belong to.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="keys" className="px-5 pb-5 pt-3">
          <TabsList className="mb-3">
            <TabsTrigger value="keys">API keys</TabsTrigger>
            <TabsTrigger value="display">Display</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>
          <TabsContent value="keys" className="space-y-5">
            {GROUPS.map((g) => (
              <section key={g}>
                <div className="hud-label mb-2">{g}</div>
                <div className="space-y-3">
                  {API_KEYS.filter((k) => k.group === g).map((k) => (
                    <KeyField key={k.id} id={k.id} />
                  ))}
                </div>
              </section>
            ))}
          </TabsContent>
          <TabsContent value="display" className="space-y-3">
            <PrefSwitch id="scanlines" label="Scanlines & sweep overlay" />
            <PrefSwitch id="cinematic" label="Cinematic idle drift (orbits after 12 s without input)" />
            <PrefSwitch id="labels" label="Labels on small layers" />
            <PrefSwitch id="atmosphere" label="Atmosphere & fog" />
            <PrefSwitch id="nightLights" label="Night lights (NASA Black Marble on the dark side)" />
            <PrefSwitch id="googleTiles" label="Google Photorealistic 3D Tiles (needs GOOGLE_MAPS_API_KEY)" />
            <PrefSwitch id="terrain" label="3D terrain (keyless AWS Terrain Tiles; Cesium World Terrain with a CESIUM_ION_TOKEN)" />
            <TerrainExaggeration />
          </TabsContent>
          <TabsContent value="data" className="space-y-5">
            <AircraftSource />
            <SatelliteGroups />
            <ObserverLocation />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function KeyField({ id }: { id: ApiKeyId }) {
  const meta = API_KEYS.find((k) => k.id === id)!;
  const value = useSettings((s) => s.keys[id] ?? "");
  const setKey = useSettings((s) => s.setKey);
  const clearKey = useSettings((s) => s.clearKey);
  const [reveal, setReveal] = useState(false);
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-[11px] text-foreground">
          {meta.label}
          <span className="ml-2 text-[9px] text-muted-foreground">{id}</span>
        </label>
        <a
          href={meta.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-primary/80 hover:text-primary"
        >
          get key <ExternalLink className="size-3" />
        </a>
      </div>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type={meta.secret && !reveal ? "password" : "text"}
          value={value}
          onChange={(e) => setKey(id, e.target.value)}
          placeholder="not set — feature stays on the free path"
          autoComplete="off"
          spellCheck={false}
          className="h-8 rounded-none border-border bg-input font-mono text-[11px]"
        />
        {meta.secret && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="border border-border p-1.5 text-muted-foreground hover:text-foreground"
            aria-label={reveal ? "Hide" : "Reveal"}
          >
            {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        )}
        {value && (
          <button
            type="button"
            onClick={() => clearKey(id)}
            className="border border-border p-1.5 text-muted-foreground hover:text-alert"
            aria-label="Clear"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground">{meta.unlocks}</div>
    </div>
  );
}

function PrefSwitch({ id, label }: { id: keyof Prefs; label: string }) {
  const value = useSettings((s) => s.prefs[id]) as boolean;
  const setPref = useSettings((s) => s.setPref);
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 border border-border/60 px-3 py-2 text-[11px]">
      <span>{label}</span>
      <Switch size="sm" checked={value} onCheckedChange={(v) => setPref(id, v as never)} />
    </label>
  );
}

/** Scene.verticalExaggeration, 1× to 3×: what the terrain shows, stretched upward; heights read anywhere stay true. */
function TerrainExaggeration() {
  const value = useSettings((s) => s.prefs.terrainExaggeration);
  const terrain = useSettings((s) => s.prefs.terrain);
  const setPref = useSettings((s) => s.setPref);
  return (
    <label className="flex items-center justify-between gap-3 border border-border/60 px-3 py-2 text-[11px]">
      <span className={terrain ? "" : "text-muted-foreground"}>
        Terrain exaggeration <span className="tabular-nums text-foreground">{value.toFixed(1)}×</span>
        <span className="block text-[9px] text-muted-foreground">Stretches the relief you see upward; elevations the app reports are never exaggerated.</span>
      </span>
      <input
        type="range"
        min={1}
        max={3}
        step={0.25}
        value={value}
        onChange={(e) => setPref("terrainExaggeration", Number(e.target.value))}
        className="w-36 accent-[var(--primary)]"
        aria-label="Terrain vertical exaggeration"
      />
    </label>
  );
}

function AircraftSource() {
  const value = useSettings((s) => s.prefs.aircraftSource);
  const setPref = useSettings((s) => s.setPref);
  const opts: Array<[Prefs["aircraftSource"], string]> = [
    ["auto", "Auto: adsb.lol near the view, OpenSky when zoomed out"],
    ["adsblol", "adsb.lol only (250 nm around view)"],
    ["opensky", "OpenSky only (global; anonymous quota is small)"],
    ["adsbx", "ADS-B Exchange (needs RapidAPI key)"],
  ];
  return (
    <section>
      <div className="hud-label mb-2">Aircraft source</div>
      <div className="grid gap-1">
        {opts.map(([v, label]) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 border border-border/60 px-3 py-1.5 text-[11px]">
            <input
              type="radio"
              name="aircraftSource"
              checked={value === v}
              onChange={() => setPref("aircraftSource", v)}
              className="accent-[var(--primary)]"
            />
            {label}
          </label>
        ))}
      </div>
    </section>
  );
}

function SatelliteGroups() {
  const groups = useSettings((s) => s.prefs.satelliteGroups);
  const setPref = useSettings((s) => s.setPref);
  const toggle = (g: string) =>
    setPref("satelliteGroups", groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]);
  return (
    <section>
      <div className="hud-label mb-2">Satellite groups (CelesTrak)</div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {SATELLITE_GROUPS.map((g) => (
          <label key={g.id} className="flex cursor-pointer items-center gap-2 border border-border/60 px-2 py-1.5 text-[11px]">
            <input type="checkbox" checked={groups.includes(g.id)} onChange={() => toggle(g.id)} className="accent-[var(--primary)]" />
            <span className="truncate" title={g.label}>
              {g.label}
            </span>
            {g.heavy && <span className="ml-auto text-[8px] text-warn">HEAVY</span>}
          </label>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        CelesTrak asks for at most one fetch per group every two hours; the server caches accordingly.
      </div>
    </section>
  );
}

function ObserverLocation() {
  const observer = useSettings((s) => s.prefs.observer);
  const setPref = useSettings((s) => s.setPref);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [error, setError] = useState<string | null>(null);

  const useMyLocation = () => {
    setError(null);
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setPref("observer", {
          lat: +pos.coords.latitude.toFixed(4),
          lon: +pos.coords.longitude.toFixed(4),
          label: "My location",
        }),
      () => setError("Location permission denied — enter coordinates manually."),
      { timeout: 10_000 },
    );
  };

  const setManual = () => {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      setError("Enter a valid latitude (-90…90) and longitude (-180…180).");
      return;
    }
    setError(null);
    setPref("observer", { lat: la, lon: lo, label: "Manual" });
  };

  return (
    <section>
      <div className="hud-label mb-2">Observer location (satellite passes)</div>
      {observer ? (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="tabular-nums">
            {observer.label}: {observer.lat.toFixed(4)}°, {observer.lon.toFixed(4)}°
          </span>
          <button
            type="button"
            onClick={() => setPref("observer", null)}
            className="ml-auto flex items-center gap-1 border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Trash2 className="size-3" /> Clear
          </button>
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">Not set — pass predictions need it.</div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          className="flex items-center gap-1 border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary"
        >
          <LocateFixed className="size-3" /> Use my location
        </button>
        <Input
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="lat"
          inputMode="decimal"
          className="h-7 w-20 text-[11px]"
          aria-label="Latitude"
        />
        <Input
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          placeholder="lon"
          inputMode="decimal"
          className="h-7 w-20 text-[11px]"
          aria-label="Longitude"
        />
        <button
          type="button"
          onClick={setManual}
          className="border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary"
        >
          Set
        </button>
      </div>
      {error && <div className="mt-1 text-[10px] text-warn">{error}</div>}
      <div className="mt-1 text-[10px] text-muted-foreground">
        Stored in this browser only. Used solely to predict satellite passes overhead.
      </div>
    </section>
  );
}
