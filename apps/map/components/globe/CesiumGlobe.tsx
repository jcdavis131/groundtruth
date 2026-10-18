"use client";
// The globe itself. Creates the Cesium viewer with a keyless imagery stack,
// wires picking / hover / follow / cinematic drift, mirrors camera and clock
// state into the store, and reacts to operator preferences.

import { useEffect, useRef } from "react";
import type * as CesiumNS from "cesium";
import { loadCesium, setViewer } from "@/lib/globe/cesium";
import { addBaseImagery, addNightLights, setGoogleTiles, setTerrain, terrainLogText } from "@/lib/globe/imagery";
import { allRenderers, getRenderer } from "@/lib/globe/registry";
import type { PickId } from "@/lib/globe/renderer";
import { cinematicTick, followTick } from "@/lib/globe/camera";
import { isMobileViewport } from "@/lib/hooks/useIsMobile";
import { satWorker } from "@/lib/globe/satWorker";
import { measureClick, startMeasureOverlay } from "@/lib/globe/measure";
import { groundClickWanted, identifyGround, startGroundOverlay } from "@/lib/terrain/ground";
import { openHere, startHereOverlay } from "@/lib/whatshere/here";
import { identifyParcel, startParcelOverlay } from "@/lib/parcels/pick";
import { clickAnswer } from "@/lib/globe/clickPrecedence";
import { parseShare } from "@/lib/globe/share";
import { flyTo } from "@/lib/globe/camera";
import { useGlobe } from "@/lib/store/globe";
import { useSettings } from "@/lib/store/settings";
import type { ViewState } from "@/lib/layers/types";
import { GLOBE_ERROR_EVENT } from "@/components/hud/TitleCard";
import { arbitrateLabels } from "@/lib/globe/labelArbiter";
import { useStrata } from "@/lib/fabric/strataStore";
import { identifyZoning, startZoningOverlay } from "@/lib/zoning/pick";
import { trackRecordOpen } from "@/lib/analytics/events";
import { currentFabric } from "@/lib/fabric/strataClient";

function isPickId(v: unknown): v is PickId {
  return !!v && typeof v === "object" && "layer" in v && "id" in v;
}

export default function CesiumGlobe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let viewer: CesiumNS.Viewer | undefined;
    const cleanups: Array<() => void> = [];

    const start = async () => {
      const C = await loadCesium();
      if (disposed || !containerRef.current) return;

      // No Ion account is needed for the baseline experience. Blank the
      // default token so nothing reaches ion.cesium.com unless the operator
      // adds a token in settings.
      C.Ion.defaultAccessToken = "";

      viewer = new C.Viewer(containerRef.current, {
        baseLayer: false,
        animation: false,
        timeline: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        baseLayerPicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        vrButton: false,
        shouldAnimate: true,
        // Phones: 2x MSAA is the difference between 60 and 30 fps on a mid-range GPU.
        msaaSamples: isMobileViewport() ? 2 : 4,
        creditContainer: creditRef.current ?? undefined,
        contextOptions: { webgl: { powerPreference: "high-performance" } },
      });
      setViewer(viewer);
      const scene = viewer.scene;
      const globe = scene.globe;
      const prefs = useSettings.getState().prefs;
      const keys = useSettings.getState().keys;

      // Look & feel. The globe is the subject of every frame: a cold, slightly
      // desaturated Earth (imagery tone lives in lib/globe/imagery.ts), a thin
      // cool limb, a black sky, so the data layers and the one warm accent in
      // the chrome carry the colour.
      globe.baseColor = C.Color.fromCssColorString("#03070b");
      globe.atmosphereSaturationShift = -0.28;
      globe.atmosphereBrightnessShift = -0.06;
      if (scene.skyAtmosphere) {
        scene.skyAtmosphere.saturationShift = -0.32;
        scene.skyAtmosphere.brightnessShift = -0.12;
        scene.skyAtmosphere.hueShift = 0.02;
      }
      scene.backgroundColor = C.Color.fromCssColorString("#020305");
      globe.enableLighting = true;
      // Cesium measures these against the camera's distance from Earth's
      // centre (~6.4e6 m at the surface). Small lighting fades keep the
      // day/night terminator visible at every altitude. The night fades stay
      // at Cesium's defaults: lowering them drives the ground atmosphere to
      // full black and swallows the Black Marble city lights.
      globe.lightingFadeOutDistance = 1.2e5;
      globe.lightingFadeInDistance = 3.5e5;
      globe.showGroundAtmosphere = prefs.atmosphere;
      if (scene.skyAtmosphere) scene.skyAtmosphere.show =prefs.atmosphere;
      scene.fog.enabled = true;
      scene.postProcessStages.fxaa.enabled = true;
      scene.highDynamicRange = false;
      scene.screenSpaceCameraController.minimumZoomDistance = 120;
      scene.screenSpaceCameraController.maximumZoomDistance = 45_000_000;
      scene.screenSpaceCameraController.enableCollisionDetection = true;
      viewer.clock.clockRange = C.ClockRange.UNBOUNDED;
      viewer.clock.clockStep = C.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
      viewer.clock.shouldAnimate = true;

      addBaseImagery(viewer);
      const night = prefs.nightLights ? addNightLights(viewer) : null;
      let nightLayer: CesiumNS.ImageryLayer | null = night;

      void setGoogleTiles(viewer, keys.GOOGLE_MAPS_API_KEY, prefs.googleTiles).then((r) => {
        if (r.active) useGlobe.getState().pushLog({ level: "info", text: "Google Photorealistic 3D Tiles online" });
        else if (r.error) useGlobe.getState().pushLog({ level: "warn", text: `Google tiles: ${r.error}` });
      });
      void setTerrain(viewer, keys.CESIUM_ION_TOKEN, prefs.terrain, (line) => useGlobe.getState().pushLog(line)).then((r) => {
        const line = terrainLogText(r);
        if (line) useGlobe.getState().pushLog(line);
      });
      scene.verticalExaggeration = prefs.terrainExaggeration;

      // Opening move: from deep space down to a tilted continental view.
      viewer.camera.setView({
        destination: C.Cartesian3.fromDegrees(-97.7, 10, 32_000_000),
        orientation: { heading: 0, pitch: C.Math.toRadians(-90), roll: 0 },
      });
      const shared = parseShare(window.location.search);
      if (shared.lat != null && shared.lon != null) {
        flyTo(shared.lon, shared.lat, {
          height: shared.h ?? 120_000,
          pitchDeg: shared.p ?? -55,
          headingDeg: shared.hd ?? 0,
          durationS: 5,
        });
      } else {
        viewer.camera.flyTo({
          destination: C.Cartesian3.fromDegrees(-97.7, 8, 9_500_000),
          orientation: { heading: 0, pitch: C.Math.toRadians(-72), roll: 0 },
          duration: 5,
          easingFunction: C.EasingFunction.QUADRATIC_OUT,
        });
      }

      // Camera state -> store (throttled)
      const ellipsoid = scene.globe.ellipsoid;
      const centerScratch = new C.Cartesian2();
      let lastViewPush = 0;
      const pushView = (force = false) => {
        const now = performance.now();
        if (!force && now - lastViewPush < 250) return;
        lastViewPush = now;
        const canvas = scene.canvas;
        centerScratch.x = canvas.clientWidth / 2;
        centerScratch.y = canvas.clientHeight / 2;
        const hit = viewer!.camera.pickEllipsoid(centerScratch, ellipsoid);
        const camCarto = viewer!.camera.positionCartographic;
        const carto = hit ? C.Cartographic.fromCartesian(hit) : camCarto;
        const rect = viewer!.camera.computeViewRectangle(ellipsoid);
        const view: ViewState = {
          lon: C.Math.toDegrees(carto.longitude),
          lat: C.Math.toDegrees(carto.latitude),
          height: camCarto.height,
          heading: C.Math.toDegrees(viewer!.camera.heading),
          pitch: C.Math.toDegrees(viewer!.camera.pitch),
          bbox: rect
            ? [
                C.Math.toDegrees(rect.west),
                C.Math.toDegrees(rect.south),
                C.Math.toDegrees(rect.east),
                C.Math.toDegrees(rect.north),
              ]
            : undefined,
        };
        useGlobe.getState().setView(view);
      };
      viewer.camera.percentageChanged = 0.01;
      const offChanged = viewer.camera.changed.addEventListener(() => pushView());
      const offMoveEnd = viewer.camera.moveEnd.addEventListener(() => pushView(true));
      cleanups.push(offChanged, offMoveEnd);
      pushView(true);

      // Clock -> store (2 Hz)
      let lastClockPush = 0;
      const offTick = viewer.clock.onTick.addEventListener((clock) => {
        const now = performance.now();
        if (now - lastClockPush < 500) return;
        lastClockPush = now;
        const offsetMs = C.JulianDate.toDate(clock.currentTime).getTime() - Date.now();
        const s = useGlobe.getState();
        if (Math.abs(s.clock.offsetMs - offsetMs) > 400 || s.clock.multiplier !== clock.multiplier) {
          s.setClock({ offsetMs, multiplier: clock.multiplier, animate: clock.shouldAnimate });
        }
      });
      cleanups.push(offTick);

      // Per-frame: advance renderers, follow target, cinematic drift
      let lastInput = performance.now();
      let lastFrame = performance.now();
      const markInput = () => {
        lastInput = performance.now();
      };
      const canvas = scene.canvas;
      for (const ev of ["pointerdown", "wheel", "keydown", "touchstart"]) {
        canvas.addEventListener(ev, markInput, { passive: true });
        cleanups.push(() => canvas.removeEventListener(ev, markInput));
      }
      window.addEventListener("keydown", markInput);
      cleanups.push(() => window.removeEventListener("keydown", markInput));

      let lastLabelPass = 0;
      const offPreUpdate = scene.preUpdate.addEventListener(() => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastFrame) / 1000);
        lastFrame = now;
        const t = C.JulianDate.toDate(viewer!.clock.currentTime).getTime();
        satWorker.tick(t);
        for (const r of allRenderers()) r.tick(t);
        // Label discipline across layers: a screen-space budget and collision pass, ~6 times a second.
        if (now - lastLabelPass > 160) {
          lastLabelPass = now;
          arbitrateLabels(viewer!, allRenderers());
        }
        const st = useGlobe.getState();
        // Time machine: slow spin while history plays; pauses on camera
        // input, resumes after 5 s idle. Never fights the operator.
        const timeMachineSpin = st.clock.timeMachine && st.clock.animate;
        if (st.following) {
          followTick();
        } else if (
          timeMachineSpin &&
          !isMobileViewport() &&
          now - lastInput > 5_000 &&
          !st.settingsOpen &&
          !st.searchOpen
        ) {
          cinematicTick(dt);
        } else if (
          useSettings.getState().prefs.cinematic &&
          !isMobileViewport() &&
          now - lastInput > 12_000 &&
          !st.settingsOpen &&
          !st.searchOpen
        ) {
          cinematicTick(dt);
        }
      });
      cleanups.push(offPreUpdate);

      // The point a zoning answer was asked for, marked while its dossier is open.
      cleanups.push(startZoningOverlay(viewer));

      // Measure tools draw their own overlay from the store.
      cleanups.push(startMeasureOverlay(viewer));
      // Where a "ground here" answer (terrain, soil and land cover pictures) was asked.
      cleanups.push(startGroundOverlay(viewer));
      cleanups.push(startHereOverlay(viewer));
      // The parcel a click identified: its outline, while its dossier is open.
      cleanups.push(startParcelOverlay(viewer));

      // Compare: a second pin (B) for the constructs stack. Dropped by the
      // rail's Compare button (next tap), a long-press on a phone, or a
      // shift-click on a desktop, while the constructs layer is on.
      const groundAt = (x: number, y: number): { lon: number; lat: number } | null => {
        const hit = viewer!.camera.pickEllipsoid(new C.Cartesian2(x, y), ellipsoid);
        if (!hit) return null;
        const c = C.Cartographic.fromCartesian(hit);
        return { lon: C.Math.toDegrees(c.longitude), lat: C.Math.toDegrees(c.latitude) };
      };
      const dropPinB = (x: number, y: number, asked = false): boolean => {
        const g = useGlobe.getState();
        // While a measure tool is on, a shift-click or a long-press is still a
        // measure click; only the rail's Compare button (`asked`) drops B then.
        if (!g.layers.constructs || (!asked && g.measure.mode !== "off")) return false;
        const p = groundAt(x, y);
        if (!p) return false;
        const strata = useStrata.getState();
        const f = currentFabric();
        if (!strata.pin && f) strata.setPin({ lon: f.point.lon, lat: f.point.lat });
        strata.setRailOpen(true);
        void strata.setCompare(p);
        useGlobe.getState().pushLog({ level: "info", text: `Compare: pin B at ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}.` });
        return true;
      };
      let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
      let pressFired = false;
      const onPressDown = (e: PointerEvent) => {
        if (e.pointerType !== "touch" || !e.isPrimary) return;
        if (press) clearTimeout(press.timer);
        pressFired = false;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        press = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          timer: setTimeout(() => {
            press = null;
            if (dropPinB(x, y)) {
              pressFired = true;
              navigator.vibrate?.(12);
            }
          }, 600),
        };
      };
      const onPressMove = (e: PointerEvent) => {
        if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
          clearTimeout(press.timer);
          press = null;
        }
      };
      const onPressEnd = () => {
        if (press) clearTimeout(press.timer);
        press = null;
      };
      // A second finger (pinch) is not a long-press.
      const onPressCancel = (e: PointerEvent) => {
        if (!e.isPrimary) onPressEnd();
      };
      canvas.addEventListener("pointerdown", onPressDown);
      canvas.addEventListener("pointerdown", onPressCancel);
      canvas.addEventListener("pointermove", onPressMove);
      for (const ev of ["pointerup", "pointercancel", "pointerleave"]) canvas.addEventListener(ev, onPressEnd);
      cleanups.push(() => {
        onPressEnd();
        canvas.removeEventListener("pointerdown", onPressDown);
        canvas.removeEventListener("pointerdown", onPressCancel);
        canvas.removeEventListener("pointermove", onPressMove);
        for (const ev of ["pointerup", "pointercancel", "pointerleave"]) canvas.removeEventListener(ev, onPressEnd);
      });

      // Picking
      const handler = new C.ScreenSpaceEventHandler(canvas);
      handler.setInputAction(
        (e: CesiumNS.ScreenSpaceEventHandler.PositionedEvent) => {
          dropPinB(e.position.x, e.position.y);
        },
        C.ScreenSpaceEventType.LEFT_CLICK,
        C.KeyboardEventModifier.SHIFT,
      );
      handler.setInputAction((e: CesiumNS.ScreenSpaceEventHandler.PositionedEvent) => {
        // The long-press that dropped pin B also ends in a tap; it is not a selection.
        if (pressFired) {
          pressFired = false;
          return;
        }
        // The rail's Compare button waits for this tap. Turning a measure tool on
        // ends that wait (setMeasureMode), so a wait still open is the newer intent.
        if (useStrata.getState().picking) {
          dropPinB(e.position.x, e.position.y, true);
          return;
        }
        // While a measure tool is active a click places a vertex (or asks for
        // the elevation) on the ground under the cursor instead of picking.
        if (useGlobe.getState().measure.mode !== "off") {
          const ray = viewer!.camera.getPickRay(e.position);
          const hit = (ray && scene.globe.pick(ray, scene)) || viewer!.camera.pickEllipsoid(e.position, ellipsoid);
          if (hit) {
            const c = C.Cartographic.fromCartesian(hit);
            measureClick(C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude));
          }
          return;
        }
        const picked = scene.pick(e.position) as { id?: unknown } | undefined;
        const id = picked?.id;
        const st = useGlobe.getState();
        // What the click answers, first match wins (lib/globe/clickPrecedence.ts): the parcel,
        // then the zoning, then any other object picked, then a ground picture's answer.
        const answer = clickAnswer(isPickId(id) ? id.layer : null, st.layers, st.view.height);
        // Parcels: with Parcels on and the camera below PARCEL_IDENTIFY_MAX_M (5 km), a click on
        // the ground, on a lot line (outlines carry no record) or on anything the zoning layer
        // draws (a district's fill or outline, its dashed loaded box) asks for the parcel at that
        // point (Cam, 2026-09-27). Any other object picked wins. This comes before the zoning
        // click and the ground-picture click below (groundClickWanted): switch Parcels off to
        // read zoning up close.
        if (answer === "parcel") {
          const ray = viewer!.camera.getPickRay(e.position);
          const hit = (ray && scene.globe.pick(ray, scene)) || viewer!.camera.pickEllipsoid(e.position, ellipsoid);
          if (hit) {
            const c = C.Cartographic.fromCartesian(hit);
            trackRecordOpen("parcels", "map");
            void identifyParcel(C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude));
            return;
          }
        }
        // Zoning: below ZONING_IDENTIFY_MAX_M (15 km), a click on the ground or on a district
        // (its fill picks with the same id as its outline, which carries only its code) asks for
        // the zoning at that point, unless the parcel took it above: with Parcels on, zoning
        // answers from 5 to 15 km; with Parcels off, everywhere below 15 km. Any other object
        // picked wins. It comes before the ground-picture click below.
        if (answer === "zoning") {
          const ray = viewer!.camera.getPickRay(e.position);
          const hit = (ray && scene.globe.pick(ray, scene)) || viewer!.camera.pickEllipsoid(e.position, ellipsoid);
          if (hit) {
            const c = C.Cartographic.fromCartesian(hit);
            trackRecordOpen("zoning", "map");
            void identifyZoning(C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude));
            return;
          }
        }
        // Any other object picked opens its own dossier (so does a district outline whose ground
        // point did not resolve, as before).
        if (isPickId(id) && id.layer !== "parcels") {
          const feature = getRenderer(id.layer)?.getFeature(id.id) ?? null;
          trackRecordOpen(id.layer, "map");
          st.select({ layer: id.layer, id: id.id }, feature);
        } else if (groundClickWanted(st.layers, st.view.height)) {
          // Pictures (soils, land cover, hazard classes, slope, relief) have nothing to pick:
          // a click on the ground asks what is under it.
          const ray = viewer!.camera.getPickRay(e.position);
          const hit = (ray && scene.globe.pick(ray, scene)) || viewer!.camera.pickEllipsoid(e.position, ellipsoid);
          if (hit) {
            const c = C.Cartographic.fromCartesian(hit);
            void identifyGround(C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude), st.layers);
          } else st.select(null);
        } else {
          st.select(null);
        }
      }, C.ScreenSpaceEventType.LEFT_CLICK);
      // Right-click (a click, not the right-drag that zooms): "what's here" at the ground under the cursor.
      handler.setInputAction((e: CesiumNS.ScreenSpaceEventHandler.PositionedEvent) => {
        const ray = viewer!.camera.getPickRay(e.position);
        const hit = (ray && scene.globe.pick(ray, scene)) || viewer!.camera.pickEllipsoid(e.position, ellipsoid);
        if (!hit) return;
        const c = C.Cartographic.fromCartesian(hit);
        void openHere(C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude));
      }, C.ScreenSpaceEventType.RIGHT_CLICK);
      let lastHoverPick = 0;
      handler.setInputAction((e: CesiumNS.ScreenSpaceEventHandler.MotionEvent) => {
        const now = performance.now();
        if (now - lastHoverPick < 70) return;
        lastHoverPick = now;
        const st = useGlobe.getState();
        // A measure tool owns the cursor: clicks place points, they do not select.
        if (st.measure.mode !== "off") {
          if (st.hover) st.setHover(null);
          canvas.style.cursor = "crosshair";
          return;
        }
        const picked = scene.pick(e.endPosition) as { id?: unknown } | undefined;
        const id = picked?.id;
        if (isPickId(id)) {
          if (!st.hover || st.hover.id !== id.id || st.hover.layer !== id.layer) {
            st.setHover({ layer: id.layer, id: id.id });
          }
          canvas.style.cursor = "pointer";
        } else {
          if (st.hover) st.setHover(null);
          if (canvas.style.cursor) canvas.style.cursor = "";
        }
      }, C.ScreenSpaceEventType.MOUSE_MOVE);
      cleanups.push(() => handler.destroy());

      // Store -> renderers (selection / hover highlight)
      const unsubSel = useGlobe.subscribe((s, prev) => {
        if (s.selected !== prev.selected) {
          for (const r of allRenderers()) {
            r.setSelected(s.selected && s.selected.layer === r.layer ? s.selected.id : null);
          }
        }
        if (s.hover !== prev.hover) {
          for (const r of allRenderers()) {
            r.setHover(s.hover && s.hover.layer === r.layer ? s.hover.id : null);
          }
        }
      });
      cleanups.push(unsubSel);

      // Preferences -> scene
      const unsubPrefs = useSettings.subscribe((s, prev) => {
        if (!viewer || viewer.isDestroyed()) return;
        const p = s.prefs;
        const q = prev.prefs;
        if (p.atmosphere !== q.atmosphere) {
          if (scene.skyAtmosphere) scene.skyAtmosphere.show =p.atmosphere;
          globe.showGroundAtmosphere = p.atmosphere;
        }
        if (p.nightLights !== q.nightLights) {
          if (p.nightLights && !nightLayer) nightLayer = addNightLights(viewer);
          else if (!p.nightLights && nightLayer) {
            viewer.imageryLayers.remove(nightLayer, true);
            nightLayer = null;
          }
        }
        if (p.labels !== q.labels) {
          for (const r of allRenderers()) r.setLabelsEnabled(p.labels);
        }
        if (p.googleTiles !== q.googleTiles || s.keys.GOOGLE_MAPS_API_KEY !== prev.keys.GOOGLE_MAPS_API_KEY) {
          void setGoogleTiles(viewer, s.keys.GOOGLE_MAPS_API_KEY, p.googleTiles).then((r) => {
            const log = useGlobe.getState().pushLog;
            if (r.active) log({ level: "info", text: "Google Photorealistic 3D Tiles online" });
            else if (r.error) log({ level: "warn", text: `Google tiles: ${r.error}` });
          });
        }
        if (p.terrain !== q.terrain || s.keys.CESIUM_ION_TOKEN !== prev.keys.CESIUM_ION_TOKEN) {
          void setTerrain(viewer, s.keys.CESIUM_ION_TOKEN, p.terrain, (line) => useGlobe.getState().pushLog(line)).then((r) => {
            const line = terrainLogText(r);
            if (line) useGlobe.getState().pushLog(line);
          });
        }
        if (p.terrainExaggeration !== q.terrainExaggeration) scene.verticalExaggeration = p.terrainExaggeration;
      });
      cleanups.push(unsubPrefs);

      useGlobe.getState().setReady(true);
      useGlobe.getState().pushLog({ level: "info", text: "Globe online. Keyless imagery stack: Esri World Imagery + NASA Black Marble." });
    };
    // A browser without WebGL (or a module that fails to load) must not leave
    // the visitor on a silent black screen: the title card turns into the
    // error state and says what happened.
    start().catch((err: unknown) => {
      if (disposed) return;
      const msg = err instanceof Error ? err.message : String(err);
      useGlobe.getState().pushLog({ level: "alert", text: `Globe failed to start: ${msg}` });
      window.dispatchEvent(new CustomEvent(GLOBE_ERROR_EVENT, { detail: "The globe could not start." }));
    });

    return () => {
      disposed = true;
      for (const c of cleanups.splice(0)) c();
      useGlobe.getState().setReady(false);
      setViewer(null);
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      <div
        ref={creditRef}
        className="absolute bottom-2 left-3 z-10 max-w-[38vw] overflow-hidden whitespace-nowrap"
      />
    </div>
  );
}
