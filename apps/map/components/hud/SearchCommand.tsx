"use client";
// ⌘K palette: find a flight / ship / satellite / camera by callsign, name or
// id among loaded objects, geocode a place, find a Public Land Survey System
// township or section by its description ("T12N R3W S33"), or run a cockpit
// command. The PLSS lookup reads survey numbers only (lib/infra/plss.ts).
//
// By meaning (embeddings round 1): a "Collections" group ranks the catalogue
// cards for the query through /api/catalog?op=search (the server embeds the
// query; no weights in the browser for it), and, behind ?semantic=1, a "By
// meaning" group ranks loaded records by their record text (never names or
// ids): the gated hybrid (lib/embed/gatedHybrid.ts), BM25 and potion-base-8M
// cosine fused, shown only when the frozen gate (lib/embed/gateConfig.ts)
// says something relevant is loaded. The model loads on first use.
// Letter-by-letter matches always come first and are never repeated below.

import { useEffect, useMemo, useState } from "react";
import { Grid3x3, Library, MapPin, Radar, Sparkles, Terminal } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGlobe } from "@/lib/store/globe";
import { allFeatures } from "@/lib/globe/registry";
import { flyTo, flyToSelection, homeView } from "@/lib/globe/camera";
import { goLive } from "@/lib/globe/clock";
import { LAYERS, LAYER_BY_ID } from "@/lib/layers";
import type { LayerFeature } from "@/lib/layers/types";
import { matchScore } from "@/lib/search/allowlist";
import { parseTrs, type PlssCandidate } from "@/lib/infra/plss";
import { openHere } from "@/lib/whatshere/here";
import { queryText } from "@/lib/catalog/recordText";
import { potionBrowser } from "@/lib/embed/loadBrowser";
import { RecordIndex, featureKey, type RecordHit } from "@/lib/embed/recordIndex";
// The gate for the By meaning group, frozen on dev data before blind set C (writeups/panel-2026-10-18b/gate/PREREG.md).
// The group stays flagged (semanticRecordsOn) until a blind query set passes.
import { GATE_CONFIG } from "@/lib/embed/gateConfig";
import { trackRecordOpen, trackResultOpen, trackSearch } from "@/lib/analytics/events";

/** A catalogue card ranked by meaning (/api/catalog?op=search). */
export interface CardSearchHit {
  id: string;
  title: string;
  layer: string;
  score: number;
}

export async function catalogSearch(q: string, signal?: AbortSignal, limit = 3): Promise<CardSearchHit[]> {
  const res = await fetch(`/api/catalog?op=search&q=${encodeURIComponent(q)}&limit=${limit}`, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { hits?: CardSearchHit[] } };
  return json.data?.hits ?? [];
}

/** The "By meaning" record group is on only with ?semantic=1 until a hand-written eval sets its threshold. */
export function semanticRecordsOn(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("semantic") === "1";
  } catch {
    return false;
  }
}

/** Rows shown in the By meaning and Collections groups. */
const RECORD_ROWS = 8;
const CARD_ROWS = 3;

let recordIndex: RecordIndex | null = null;

/**
 * Loaded records for a query by the gated hybrid (one row per distinct record text, score = cosine),
 * skipping those already matched by letters. Loads the embedder on first use.
 */
export async function searchRecordsByMeaning(q: string, exclude: ReadonlySet<string>): Promise<RecordHit[]> {
  const text = queryText(q);
  if (!text) return [];
  const model = await potionBrowser();
  recordIndex ??= new RecordIndex(model);
  recordIndex.sync(allFeatures());
  const v = model.embed(text);
  return v ? recordIndex.searchGated(text, v, GATE_CONFIG, RECORD_ROWS, exclude) : [];
}

export interface GeocodeHit {
  name: string;
  lat: number;
  lon: number;
  type: string;
  bbox?: [number, number, number, number];
}

export async function geocode(q: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: GeocodeHit[] };
  return json.data ?? [];
}

/** The townships or sections a T-R-S description names (BLM CadNSDI via /api/infra); empty for anything else. */
export async function plssSearch(q: string, signal?: AbortSignal): Promise<PlssCandidate[]> {
  if (!parseTrs(q)) return [];
  const res = await fetch(`/api/infra?op=plss-search&q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: PlssCandidate[] };
  return json.data ?? [];
}

/** Camera height that frames a PLSS box (a section is a mile; a township six). */
export function heightForPlss(c: Pick<PlssCandidate, "bbox" | "lat">): number {
  const [w, s, e, n] = c.bbox;
  const span = Math.max((e - w) * Math.cos((c.lat * Math.PI) / 180), n - s) * 111_000;
  return Math.min(60_000, Math.max(4_000, span * 2.2));
}

function searchFeatures(q: string, limit = 12): LayerFeature[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: Array<[number, LayerFeature]> = [];
  for (const f of allFeatures()) {
    // Names, ids and allowlisted identifier and place fields only (lib/search/allowlist.ts).
    const score = matchScore(f.properties, needle);
    if (score > 0) hits.push([score, f]);
  }
  hits.sort((a, b) => b[0] - a[0] || a[1].properties.name.localeCompare(b[1].properties.name));
  return hits.slice(0, limit).map(([, f]) => f);
}

export default function SearchCommand() {
  const open = useGlobe((s) => s.searchOpen);
  const setOpen = useGlobe((s) => s.setSearchOpen);
  const setLayer = useGlobe((s) => s.setLayer);
  const seed = useGlobe((s) => s.searchSeed);
  const [q, setQ] = useState("");
  // What was typed in the home page's search field carries into the palette
  // once per opening (adjusted during render, not in an effect).
  const [seeded, setSeeded] = useState(false);
  if (open && seed && !seeded) {
    setSeeded(true);
    setQ(seed);
  } else if (!open && seeded) {
    setSeeded(false);
  }
  const [placeHits, setPlaceHits] = useState<{ q: string; hits: GeocodeHit[] }>({ q: "", hits: [] });
  const [plssHits, setPlssHits] = useState<{ q: string; hits: PlssCandidate[] }>({ q: "", hits: [] });
  const [cardHits, setCardHits] = useState<{ q: string; hits: CardSearchHit[] }>({ q: "", hits: [] });
  const [meaningHits, setMeaningHits] = useState<{ q: string; hits: RecordHit[] }>({ q: "", hits: [] });

  const objects = useMemo(() => searchFeatures(q), [q]);
  // Only show geocode results that belong to the current query.
  const places = placeHits.q === q.trim() ? placeHits.hits : [];
  const sections = plssHits.q === q.trim() ? plssHits.hits : [];
  const cards = cardHits.q === q.trim() ? cardHits.hits : [];
  const meaning = meaningHits.q === q.trim() ? meaningHits.hits : [];

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return;
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      catalogSearch(term, ctrl.signal, CARD_ROWS)
        .then((hits) => setCardHits({ q: term, hits }))
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3 || !semanticRecordsOn()) return;
    let live = true;
    const exclude = new Set(objects.map(featureKey));
    const id = setTimeout(() => {
      searchRecordsByMeaning(term, exclude)
        .then((hits) => live && setMeaningHits({ q: term, hits }))
        .catch(() => {});
    }, 350);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q, objects]);

  useEffect(() => {
    const term = q.trim();
    if (!parseTrs(term)) return;
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      plssSearch(term, ctrl.signal)
        .then((hits) => setPlssHits({ q: term, hits }))
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return;
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      geocode(term, ctrl.signal)
        .then((hits) => setPlaceHits({ q: term, hits }))
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [q]);

  // One 'search' event per palette session, sent as it closes: how many rows each group showed
  // (bucketed) and which groups, never the query (lib/analytics/events.ts).
  const reportSearch = () =>
    trackSearch(q, {
      objects: objects.length,
      meaning: meaning.length,
      catalog: cards.length,
      plss: sections.length,
      place: places.length,
    });

  const close = () => {
    reportSearch();
    setOpen(false);
    setQ("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reportSearch();
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription>Find flights, ships, satellites, cameras and places</DialogDescription>
      </DialogHeader>
      <DialogContent className="hud-panel top-1/4 translate-y-0 overflow-hidden rounded-none! p-0" showCloseButton={false}>
        <Command shouldFilter={false} className="rounded-none! bg-transparent">
      <CommandInput
        placeholder="callsign, MMSI, satellite, city, T12N R3W S33…"
        value={q}
        onValueChange={setQ}
        className="font-mono text-[12px]"
      />
      <CommandList className="max-h-[50vh]">
        <CommandEmpty className="text-[11px] text-muted-foreground">
          {q.length < 2 ? "Type to search loaded objects, places and commands." : "No matches in loaded layers."}
        </CommandEmpty>
        {objects.length > 0 && (
          <CommandGroup heading="Objects">
            {objects.map((f) => {
              const p = f.properties;
              const def = LAYER_BY_ID[p.layer];
              return (
                <CommandItem
                  key={`${p.layer}:${p.id}`}
                  value={`${p.layer}:${p.id}`}
                  onSelect={() => {
                    trackResultOpen(p.layer);
                    if (flyToSelection({ layer: p.layer, id: p.id })) trackRecordOpen(p.layer, "search");
                    close();
                  }}
                  className="font-mono text-[11px]"
                >
                  <Radar className="size-3.5" style={{ color: def?.color }} />
                  <span className="text-foreground">{p.name}</span>
                  <span className="ml-auto text-[9px] uppercase tracking-widest text-muted-foreground">
                    {def?.label} {p.kind ? `· ${p.kind}` : ""}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {meaning.length > 0 && (
          <CommandGroup heading="By meaning (record text, experimental)">
            {meaning.map(({ feature: f, score }) => {
              const p = f.properties;
              const def = LAYER_BY_ID[p.layer];
              return (
                <CommandItem
                  key={`meaning:${p.layer}:${p.id}`}
                  value={`meaning:${p.layer}:${p.id}`}
                  onSelect={() => {
                    trackResultOpen(p.layer);
                    if (flyToSelection({ layer: p.layer, id: p.id })) trackRecordOpen(p.layer, "search");
                    close();
                  }}
                  className="font-mono text-[11px]"
                >
                  <Sparkles className="size-3.5" style={{ color: def?.color }} />
                  <span className="text-foreground">{p.name}</span>
                  <span className="ml-auto text-[9px] uppercase tracking-widest text-muted-foreground">
                    {def?.label} · {score.toFixed(2)}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {cards.length > 0 && (
          <CommandGroup heading="Collections (by meaning of their catalogue card)">
            {cards.map((c) => {
              const def = LAYER_BY_ID[c.layer as keyof typeof LAYER_BY_ID];
              // The card opens its catalogue entry (/catalog#<id>) in a new tab, so the globe keeps
              // its state; a second row offers to show the collection's layer.
              return [
                <CommandItem
                  key={`card:${c.id}`}
                  value={`card:${c.id}`}
                  onSelect={() => {
                    // The catalogue card is the cited record (source, licence, freshness).
                    trackResultOpen("catalog");
                    trackRecordOpen(c.layer, "search");
                    window.open(`/catalog#${encodeURIComponent(c.id)}`, "_blank", "noopener,noreferrer");
                    close();
                  }}
                  className="font-mono text-[11px]"
                >
                  <Library className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{c.title}</span>
                  <span className="ml-auto text-[9px] uppercase tracking-widest text-muted-foreground">
                    catalogue · {c.score.toFixed(2)}
                  </span>
                </CommandItem>,
                def ? (
                  <CommandItem
                    key={`card-layer:${c.id}`}
                    value={`card-layer:${c.id}`}
                    onSelect={() => {
                      trackResultOpen(def.id);
                      setLayer(def.id, true);
                      close();
                    }}
                    className="pl-7 font-mono text-[11px] text-muted-foreground"
                  >
                    <span className="truncate">show layer: {def.label}</span>
                  </CommandItem>
                ) : null,
              ];
            })}
          </CommandGroup>
        )}
        {sections.length > 0 && (
          <CommandGroup heading="Survey grid (PLSS)">
            {sections.map((c) => (
              <CommandItem
                key={c.firstDivisionId ?? c.plssId}
                value={`plss:${c.firstDivisionId ?? c.plssId}`}
                onSelect={() => {
                  trackResultOpen("plss");
                  setLayer("plss", true);
                  flyTo(c.lon, c.lat, { height: heightForPlss(c) });
                  close();
                }}
                className="font-mono text-[11px]"
              >
                <Grid3x3 className="size-3.5 text-muted-foreground" />
                <span className="truncate">{c.label}</span>
                <span className="ml-auto text-[9px] uppercase tracking-widest text-muted-foreground">{c.section != null ? "section" : "township"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {places.length > 0 && (
          <CommandGroup heading="Places">
            {places.map((h, i) => (
              <CommandItem
                key={`${h.lat},${h.lon},${i}`}
                value={`place:${i}:${h.name}`}
                onSelect={() => {
                  trackResultOpen("place");
                  flyTo(h.lon, h.lat, { height: heightForPlace(h) });
                  close();
                }}
                className="font-mono text-[11px]"
              >
                <MapPin className="size-3.5 text-primary" />
                <span className="truncate">{h.name}</span>
                <span className="ml-auto text-[9px] uppercase tracking-widest text-muted-foreground">{h.type}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Commands">
          {LAYERS.map((l) => (
            <CommandItem
              key={`cmd:${l.id}`}
              value={`cmd:toggle:${l.id} ${l.label}`}
              onSelect={() => {
                setLayer(l.id, !useGlobe.getState().layers[l.id]);
                close();
              }}
              className="font-mono text-[11px]"
            >
              <Terminal className="size-3.5 text-muted-foreground" />
              Toggle {l.label}
            </CommandItem>
          ))}
          <CommandItem value="cmd:live go live now" onSelect={() => (goLive(), close())} className="font-mono text-[11px]">
            <Terminal className="size-3.5 text-muted-foreground" />
            Mission clock: go live
          </CommandItem>
          <CommandItem
            value="cmd:what's here at the camera target point place elevation geology survey"
            onSelect={() => {
              const v = useGlobe.getState().view;
              void openHere(v.lon, v.lat);
              close();
            }}
            className="font-mono text-[11px]"
          >
            <Terminal className="size-3.5 text-muted-foreground" />
            What&apos;s here (camera target; right-click the globe for any point)
          </CommandItem>
          <CommandItem value="cmd:home view" onSelect={() => (homeView(), close())} className="font-mono text-[11px]">
            <Terminal className="size-3.5 text-muted-foreground" />
            Home view
          </CommandItem>
        </CommandGroup>
      </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Camera height for a geocoded place based on its bounding box size. */
export function heightForPlace(h: GeocodeHit): number {
  if (!h.bbox) return 60_000;
  const [w, s, e, n] = h.bbox;
  const span = Math.max(Math.abs(e - w), Math.abs(n - s));
  return Math.min(6_000_000, Math.max(6_000, span * 111_000 * 1.6));
}
