// What a left click on the globe answers, first match wins (Cam, 2026-09-27):
//
//   parcel   Parcels on, camera at or below PARCEL_IDENTIFY_MAX_M (5 km), and the click is on
//            the ground, a lot line (outlines carry no record) or anything the zoning layer
//            draws (a district's fill or outline, the dashed loaded box): the parcel record
//            at that point
//   zoning   Zoning on, camera at or below ZONING_IDENTIFY_MAX_M (15 km), the click on the
//            ground or on the zoning layer: the zoning at that point. With Parcels on this is
//            the 5 to 15 km band; with Parcels off it is everywhere below 15 km
//   feature  any other layer's object picked (aircraft, ships, cameras, infrastructure, ...):
//            its own dossier
//   ground   a terrain, soil or land cover picture on and low enough (groundClickWanted):
//            what is under the cursor
//   none     nothing: the click clears the selection

import type { LayerId } from "@/lib/layers/types";
import { PARCEL_IDENTIFY_MAX_M } from "@/lib/layers/parcels";
import { ZONING_IDENTIFY_MAX_M } from "@/lib/layers/zoning";
import { groundClickWanted } from "@/lib/terrain/ground";

export type ClickAnswer = "parcel" | "zoning" | "feature" | "ground" | "none";

/**
 * What a left click answers, given the layer of the object picked under the cursor (null for
 * the bare ground or anything that is not a layer's object), which layers are on, and the
 * camera height in metres.
 */
export function clickAnswer(picked: LayerId | null, on: Partial<Record<LayerId, boolean>>, height: number): ClickAnswer {
  if ((picked === null || picked === "parcels" || picked === "zoning") && on.parcels && height <= PARCEL_IDENTIFY_MAX_M) return "parcel";
  if ((picked === null || picked === "zoning") && on.zoning && height <= ZONING_IDENTIFY_MAX_M) return "zoning";
  if (picked !== null && picked !== "parcels") return "feature";
  if (groundClickWanted(on, height)) return "ground";
  return "none";
}
