// Which lens is active, whether the picker should show, and which "Start
// here" cards were dismissed. Persisted in localStorage; `?lens=` on a
// permalink wins over the stored choice for that visit.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { LAYER_IDS } from "@/lib/layers/types";
import { useGlobe } from "@/lib/store/globe";
import { useIndicators } from "@/lib/indicators/store";
import { useScreener } from "@/lib/screener/store";
import { closeAllPanels } from "@/lib/mobile/store";
import { isMobileViewport } from "@/lib/hooks/useIsMobile";
import { flyTo } from "@/lib/globe/camera";
import { PERSONA_BY_ID, isPersonaId, type Persona, type PersonaId } from "./registry";
import { setPanel } from "./actions";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

interface PersonaState {
  /** null until the visitor has chosen (or skipped) once. */
  personaId: PersonaId | null;
  pickerOpen: boolean;
  /** Lens ids whose "Start here" card was dismissed. */
  dismissedSteps: PersonaId[];
  setPickerOpen: (open: boolean) => void;
  dismissSteps: (id: PersonaId) => void;
  /** Record the choice without touching the globe (used by permalinks and tests). */
  setPersonaId: (id: PersonaId) => void;
}

export const useLens = create<PersonaState>()(
  persist(
    (set) => ({
      personaId: null,
      pickerOpen: false,
      dismissedSteps: [],
      setPickerOpen: (pickerOpen) => set({ pickerOpen }),
      dismissSteps: (id) => set((s) => ({ dismissedSteps: s.dismissedSteps.includes(id) ? s.dismissedSteps : [...s.dismissedSteps, id] })),
      setPersonaId: (personaId) => set({ personaId }),
    }),
    {
      name: "gev:lens",
      // No window (server render, tests): a throwaway in-memory storage.
      storage: createJSONStorage(() => (typeof window === "undefined" ? memoryStorage() : window.localStorage)),
      partialize: (s) => ({ personaId: s.personaId, dismissedSteps: s.dismissedSteps }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersonaState>;
        return {
          ...current,
          personaId: isPersonaId(p.personaId) ? p.personaId : null,
          dismissedSteps: Array.isArray(p.dismissedSteps) ? p.dismissedSteps.filter(isPersonaId) : [],
        };
      },
    },
  ),
);

export function currentPersona(): Persona | null {
  const id = useLens.getState().personaId;
  return id ? PERSONA_BY_ID[id] : null;
}

export interface ApplyOptions {
  /** Fly to the lens's starting view (false when a permalink already carries a camera). */
  fly?: boolean;
  /** Also set layers, panels and defaults (false to only record the choice). */
  configure?: boolean;
  /** Treat the viewport as a phone regardless of the media query (tests). */
  mobile?: boolean;
}

/** Layers a lens switches on for this viewport. */
export function layersFor(p: Persona, mobile: boolean): Persona["layers"] {
  if (!mobile || !p.heavy) return p.layers;
  const heavy = new Set(p.heavy);
  return p.layers.filter((l) => !heavy.has(l));
}

/**
 * Switch the cockpit to a lens: layers on/off, the arrival panel, the
 * indicator category and screener defaults, and the camera. Everything is
 * still reachable afterwards; a lens is a starting point, not a cage.
 */
export function applyPersona(id: PersonaId, opts: ApplyOptions = {}): Persona {
  const p = PERSONA_BY_ID[id];
  const mobile = opts.mobile ?? isMobileViewport();
  useLens.getState().setPersonaId(id);
  useLens.getState().setPickerOpen(false);
  if (opts.configure === false) return p;
  const g = useGlobe.getState();
  const on = new Set(layersFor(p, mobile));
  for (const l of LAYER_IDS) g.setLayer(l, on.has(l));
  closeAllPanels();
  if (p.indicatorCategory) useIndicators.getState().setCategory(p.indicatorCategory);
  if (p.screener) {
    const s = useScreener.getState();
    s.setKind(p.screener.kind);
    s.setQueryText(p.screener.query);
  }
  if (p.open) setPanel(p.open, true);
  if (opts.fly !== false) flyTo(p.start.lon, p.start.lat, { height: p.start.height, durationS: 3 });
  g.pushLog({ level: "info", text: `Lens: ${p.title}. ${p.tagline}` });
  return p;
}
