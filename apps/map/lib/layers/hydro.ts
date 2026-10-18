// Layer: rivers and streams, and where the water goes. A picture layer: the
// USGS National Hydrography Dataset as The National Map's cached tiles
// (USGSHydroCached), loaded by the browser from basemap.nationalmap.gov
// (CORS *, edge-cached; lib/terrain/products.ts DIRECT_SOURCES). While it is
// on, the Surface water layer stops drawing Natural Earth's generalised rivers
// (lib/layers/water.ts refine) so the two line sets do not double up.
//
// A click on the ground asks /api/water?op=reach for the NHDPlus V2 reach the
// point drains to (lib/terrain/ground.ts), and the dossier offers three NLDI
// traces from it, also offered on every USGS gauge of the Surface water layer
// (lib/water/nldiStore.ts): the river path downstream, the basin, the gauges
// upstream.

import { picture } from "./terrain";
import { HYDRO_ATTRIBUTION } from "@/lib/water/nldi";

export const hydroLayer = picture({
  id: "hydro",
  label: "Rivers and streams (NHD)",
  description:
    "Streams, rivers and water bodies from the USGS National Hydrography Dataset, drawn by The National Map. Click the ground for the NHDPlus V2 reach the point drains to (name, stream order, drainage area, modelled mean annual flow) and trace it: the river path downstream, the drainage basin, and the USGS gauges upstream.",
  color: "#38BDF8",
  attribution: HYDRO_ATTRIBUTION,
  source: "USGS The National Map, National Hydrography Dataset",
  note: "USGS NHD streams and water bodies (refreshed September 2026) · click the ground for the reach it drains to, then trace downstream, the basin or the gauges upstream (NHDPlus V2, through USGS NLDI)",
});
