"use client";
// Keeps the store's playbackYear in lockstep with the Cesium mission clock
// while the time machine is engaged. Layers refetch when the year changes
// (see LayerHost's playbackKey); the scrubber readout reads playbackYear.

import { useEffect } from "react";
import { getViewer } from "@/lib/globe/cesium";
import { missionTimeMs, setAnimate, setMissionTime } from "@/lib/globe/clock";
import { endOfPlaybackRange, playbackYearFromMissionTime } from "@/lib/globe/timeMachine";
import { useGlobe } from "@/lib/store/globe";

export default function TimeMachineTicker() {
  useEffect(() => {
    const id = setInterval(() => {
      const st = useGlobe.getState();
      if (!st.clock.timeMachine || !getViewer()) return;
      const ms = missionTimeMs();
      // Stop at the end of the range: hold the present, don't drift into the future.
      if (ms >= endOfPlaybackRange()) {
        setMissionTime(endOfPlaybackRange());
        setAnimate(false);
        return;
      }
      const year = playbackYearFromMissionTime(ms);
      if (year !== st.playbackYear) st.setPlaybackYear(year);
    }, 200);
    return () => clearInterval(id);
  }, []);
  return null;
}
