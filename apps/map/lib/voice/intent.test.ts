import { describe, expect, it } from "vitest";
import { parseIntent } from "./intent";
import { resolveLayer } from "./commands";
import { AIRNOW_ENABLED } from "@/lib/air/airnow";

const layerOf = (text: string) => parseIntent(text)?.args as { layer?: string; on?: boolean; place?: string } | undefined;

describe("voice words for the hazards and land layers", () => {
  it("hears each layer by its plain names", () => {
    expect(layerOf("show me wildfires")).toMatchObject({ layer: "wildfire", on: true });
    expect(layerOf("show active fires")).toMatchObject({ layer: "fires" });
    expect(layerOf("show hotspots")).toMatchObject({ layer: "fires" });
    expect(layerOf("show hazard alerts")).toMatchObject({ layer: "hazards" });
    expect(layerOf("show volcanoes")).toMatchObject({ layer: "hazards" });
    expect(layerOf("show flood zones over Houston")).toMatchObject({ layer: "flood", place: "houston" });
    expect(layerOf("hide wetlands")).toMatchObject({ layer: "wetlands", on: false });
    expect(layerOf("show public lands")).toMatchObject({ layer: "publiclands" });
  });

  it("keeps warnings with Live warnings, whose id is alerts, and floods with surface water", () => {
    expect(layerOf("show live warnings")).toMatchObject({ layer: "alerts" });
    expect(layerOf("show warnings")).toMatchObject({ layer: "alerts" });
    expect(layerOf("show alerts")).toMatchObject({ layer: "alerts" });
    expect(resolveLayer("alerts")).toBe("alerts");
    expect(layerOf("show floods")).toMatchObject({ layer: "water" });
  });
});

describe("voice words for the civic layers", () => {
  it("hears zoning, and zoning districts before the constructs' districts", () => {
    expect(layerOf("show zoning")).toMatchObject({ layer: "zoning", on: true });
    expect(layerOf("show zoning districts over Seattle")).toMatchObject({ layer: "zoning", place: "seattle" });
    expect(layerOf("show the zoning map")).toMatchObject({ layer: "zoning" });
    expect(layerOf("show districts")).toMatchObject({ layer: "constructs" });
  });
  it("hears building permits, licences and environmental permits apart", () => {
    expect(layerOf("show building permits in Chicago")).toMatchObject({ layer: "permits", place: "chicago" });
    expect(layerOf("show permits")).toMatchObject({ layer: "permits" });
    expect(layerOf("show environmental permits")).toMatchObject({ layer: "envpermits" });
    expect(layerOf("show army corps permits")).toMatchObject({ layer: "envpermits" });
    expect(layerOf("show business licenses")).toMatchObject({ layer: "licences" });
    expect(layerOf("hide liquor licences")).toMatchObject({ layer: "licences", on: false });
  });
});

describe("voice words for parcels", () => {
  it("hears parcels by their plain names without taking 'property' from home values", () => {
    expect(layerOf("show parcels")).toMatchObject({ layer: "parcels", on: true });
    expect(layerOf("show property lines over Austin")).toMatchObject({ layer: "parcels", place: "austin" });
    expect(layerOf("show lot lines")).toMatchObject({ layer: "parcels" });
    expect(layerOf("hide tax parcels")).toMatchObject({ layer: "parcels", on: false });
    expect(layerOf("show property values")).toMatchObject({ layer: "realestate" });
    expect(layerOf("show property")).toMatchObject({ layer: "realestate" });
  });
});

describe("voice words for the terrain & soils layers", () => {
  it("hears each picture layer by its plain names, before the fire and flood words they share", () => {
    expect(layerOf("show wildfire hazard")).toMatchObject({ layer: "firehazard", on: true });
    expect(layerOf("show fire hazard over colorado springs")).toMatchObject({ layer: "firehazard", place: "colorado springs" });
    expect(layerOf("show wildfires")).toMatchObject({ layer: "wildfire" });
    expect(layerOf("show sea level rise over galveston")).toMatchObject({ layer: "sealevel", place: "galveston" });
    expect(layerOf("show hillshade")).toMatchObject({ layer: "relief" });
    expect(layerOf("show contour lines")).toMatchObject({ layer: "contours" });
    expect(layerOf("hide soils")).toMatchObject({ layer: "soils", on: false });
    expect(layerOf("show land cover")).toMatchObject({ layer: "landcover" });
    expect(layerOf("show slope")).toMatchObject({ layer: "slope" });
    expect(resolveLayer("nlcd")).toBe("landcover");
  });
});

describe("voice words for the infrastructure and geohazard layers", () => {
  it("hears each layer by its plain names", () => {
    expect(layerOf("show transmission lines")).toMatchObject({ layer: "transmission", on: true });
    expect(layerOf("show power lines over austin")).toMatchObject({ layer: "transmission", place: "austin" });
    expect(layerOf("show pipelines")).toMatchObject({ layer: "pipelines" });
    expect(layerOf("show power plants")).toMatchObject({ layer: "plants" });
    expect(layerOf("show nuclear plants")).toMatchObject({ layer: "plants" });
    expect(layerOf("show railroads")).toMatchObject({ layer: "rail" });
    expect(layerOf("show airports")).toMatchObject({ layer: "airports" });
    expect(layerOf("hide dams")).toMatchObject({ layer: "dams", on: false });
    expect(layerOf("show fault lines")).toMatchObject({ layer: "faults" });
    expect(layerOf("show landslides")).toMatchObject({ layer: "landslides" });
    expect(layerOf("show geology")).toMatchObject({ layer: "geology" });
    expect(layerOf("show townships")).toMatchObject({ layer: "plss" });
    // Air quality resolves only while AirNow is turned on (lib/air/airnow.ts).
    if (AIRNOW_ENABLED) expect(layerOf("show air quality over denver")).toMatchObject({ layer: "airquality", place: "denver" });
    else expect(layerOf("show air quality over denver")?.layer ?? null).toBeNull();
    expect(layerOf("show news events")).toMatchObject({ layer: "events" });
  });

  it("does not take words other layers own", () => {
    expect(layerOf("show planes")).toMatchObject({ layer: "aircraft" });
    expect(layerOf("show reservoirs")).toMatchObject({ layer: "water" });
    expect(layerOf("show wildfires")).toMatchObject({ layer: "wildfire" });
    expect(resolveLayer("dams")).toBe("dams");
  });
});

describe("voice words for the heritage, species, contamination and imagery layers", () => {
  it("hears historic places by their plain names", () => {
    expect(layerOf("show historic places over washington")).toMatchObject({ layer: "historic", place: "washington" });
    expect(layerOf("show the national register")).toMatchObject({ layer: "historic" });
    expect(layerOf("hide landmarks")).toMatchObject({ layer: "historic", on: false });
  });
});

describe("voice words for critical habitat", () => {
  it("hears critical habitat and endangered species", () => {
    expect(layerOf("show critical habitat")).toMatchObject({ layer: "crithab" });
    expect(layerOf("show endangered species near austin")).toMatchObject({ layer: "crithab", place: "austin" });
  });
});

describe("voice words for contaminated sites", () => {
  it("hears superfund, brownfields and hazardous waste, and keeps hazards with hazard alerts", () => {
    expect(layerOf("show superfund sites")).toMatchObject({ layer: "contaminants" });
    expect(layerOf("show brownfields over houston")).toMatchObject({ layer: "contaminants", place: "houston" });
    expect(layerOf("show hazardous waste")).toMatchObject({ layer: "contaminants" });
    expect(layerOf("show national priorities list")).toMatchObject({ layer: "contaminants" });
    expect(layerOf("show npl sites near newark")).toMatchObject({ layer: "contaminants", place: "newark" });
    expect(layerOf("show formerly used defense sites")).toMatchObject({ layer: "contaminants" });
    expect(layerOf("show old military sites near sandy hook")).toMatchObject({ layer: "contaminants", place: "sandy hook" });
    expect(layerOf("show munitions")).toMatchObject({ layer: "contaminants" });
    expect(layerOf("show leaking tanks over houston")).toMatchObject({ layer: "ust", place: "houston" });
    expect(layerOf("show underground storage tanks")).toMatchObject({ layer: "ust" });
    expect(layerOf("show hazards")).toMatchObject({ layer: "hazards" });
  });
});

describe("voice words for community health", () => {
  it("hears community health and its plain names", () => {
    expect(layerOf("show community health over travis county")).toMatchObject({ layer: "health", place: "travis county" });
    expect(layerOf("show diabetes rate")).toMatchObject({ layer: "health" });
    expect(layerOf("show chronic disease")).toMatchObject({ layer: "health" });
    expect(layerOf("show social vulnerability over travis county")).toMatchObject({ layer: "vulnerability", place: "travis county" });
    expect(layerOf("show the social vulnerability index")).toMatchObject({ layer: "vulnerability" });
    expect(layerOf("show svi")).toMatchObject({ layer: "vulnerability" });
    expect(layerOf("show hospitals near austin")).toMatchObject({ layer: "hospitals", place: "austin" });
    expect(layerOf("show trauma centers")).toMatchObject({ layer: "hospitals" });
    expect(layerOf("show public schools near austin")).toMatchObject({ layer: "schools", place: "austin" });
    expect(layerOf("show schools")).toMatchObject({ layer: "schools" });
    expect(layerOf("show broadband over travis county")).toMatchObject({ layer: "broadband", place: "travis county" });
    expect(layerOf("show fiber internet")).toMatchObject({ layer: "broadband" });
    expect(layerOf("show wildfire risk over boulder")).toMatchObject({ layer: "wildfirerisk", place: "boulder" });
    expect(layerOf("show wildfire hazard")).toMatchObject({ layer: "firehazard" });
    expect(layerOf("show wildfires")).toMatchObject({ layer: "wildfire" });
    expect(layerOf("show trust land")).toMatchObject({ layer: "tribal" });
    expect(layerOf("show reservations over south dakota")).toMatchObject({ layer: "tribal", place: "south dakota" });
    expect(layerOf("show housing vouchers over austin")).toMatchObject({ layer: "housing", place: "austin" });
    expect(layerOf("show section 8")).toMatchObject({ layer: "housing" });
    expect(layerOf("show qualified census tracts")).toMatchObject({ layer: "housing" });
    expect(layerOf("show housing")).toMatchObject({ layer: "realestate" });
    expect(layerOf("show tax credit properties over austin")).toMatchObject({ layer: "housing", place: "austin" });
    expect(layerOf("show lihtc")).toMatchObject({ layer: "housing" });
    expect(layerOf("show difficult development areas")).toMatchObject({ layer: "housing" });
    expect(layerOf("show hospital ratings over houston")).toMatchObject({ layer: "hospitals", place: "houston" });
    expect(layerOf("show landslide susceptibility over colorado")).toMatchObject({ layer: "landslidesusc", place: "colorado" });
    expect(layerOf("show landslides")).toMatchObject({ layer: "landslides" });
    expect(layerOf("show landslide risk")).not.toMatchObject({ layer: "landslidesusc" });
  });
});

describe("voice words for national heritage", () => {
  it("hears parks, battlefields and world heritage", () => {
    expect(layerOf("show battlefields over virginia")).toMatchObject({ layer: "heritage", place: "virginia" });
    expect(layerOf("show national parks")).toMatchObject({ layer: "heritage" });
    expect(layerOf("show unesco sites")).toMatchObject({ layer: "heritage" });
    // "show world ..." is the home view, before any layer word.
    expect(parseIntent("show world heritage sites")?.command).toBe("home_view");
    expect(layerOf("show parks")).toMatchObject({ layer: "publiclands" });
  });
});

describe("voice words for NAIP aerial photos", () => {
  it("hears aerial photos before historic imagery", () => {
    expect(layerOf("show aerial photos over des moines")).toMatchObject({ layer: "naip", place: "des moines" });
    expect(layerOf("show naip")).toMatchObject({ layer: "naip" });
    expect(layerOf("show historic imagery")).toMatchObject({ layer: "wayback" });
  });
});

describe("voice words for the National Risk Index", () => {
  it("hears risk index before hazards", () => {
    expect(layerOf("show the national risk index over texas")).toMatchObject({ layer: "riskindex", place: "texas" });
    expect(layerOf("show disaster risk")).toMatchObject({ layer: "riskindex" });
    expect(layerOf("show hazard risk")).toMatchObject({ layer: "riskindex" });
    expect(layerOf("show hazards")).toMatchObject({ layer: "hazards" });
  });
});

describe("voice words for rivers and streams", () => {
  it("hears streams and hydrography before rivers", () => {
    expect(layerOf("show rivers and streams over boise")).toMatchObject({ layer: "hydro", place: "boise" });
    expect(layerOf("show streams")).toMatchObject({ layer: "hydro" });
    expect(layerOf("show hydrography")).toMatchObject({ layer: "hydro" });
    expect(layerOf("show rivers")).toMatchObject({ layer: "water" });
    expect(layerOf("show stream gauges")).toMatchObject({ layer: "water" });
  });
});

describe("voice words for historic imagery", () => {
  it("hears historic imagery before historic places", () => {
    expect(layerOf("show historic imagery")).toMatchObject({ layer: "wayback" });
    expect(layerOf("show wayback over austin")).toMatchObject({ layer: "wayback", place: "austin" });
    expect(layerOf("show historic places")).toMatchObject({ layer: "historic" });
  });
});

describe("voice words for historic topo maps", () => {
  it("hears topo maps before historic places and contour lines", () => {
    expect(layerOf("show historic maps")).toMatchObject({ layer: "topo" });
    expect(layerOf("show old maps over boston")).toMatchObject({ layer: "topo", place: "boston" });
    expect(layerOf("show topo maps")).toMatchObject({ layer: "topo" });
    expect(layerOf("show topo lines")).toMatchObject({ layer: "contours" });
    expect(layerOf("show historic places")).toMatchObject({ layer: "historic" });
  });
});

describe("voice words for PFAS in drinking water", () => {
  it("hears pfas and forever chemicals", () => {
    expect(layerOf("show pfas")).toMatchObject({ layer: "pfas" });
    expect(layerOf("show forever chemicals near collegeville")).toMatchObject({ layer: "pfas", place: "collegeville" });
    expect(layerOf("show drinking water pfas")).toMatchObject({ layer: "pfas" });
    expect(layerOf("show impaired waters")).toMatchObject({ layer: "impaired" });
  });
});

describe("voice words for impaired waters", () => {
  it("hears impaired waters and the 303(d) list", () => {
    expect(layerOf("show impaired waters")).toMatchObject({ layer: "impaired" });
    expect(layerOf("show 303d list")).toMatchObject({ layer: "impaired" });
    expect(layerOf("show polluted water over baltimore")).toMatchObject({ layer: "impaired", place: "baltimore" });
  });
});
