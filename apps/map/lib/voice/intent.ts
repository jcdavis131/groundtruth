// Keyless natural-language parser for the browser Web Speech path.
// Deliberately small and regex-based: it maps a transcript to one command
// from lib/voice/commands.ts. Anything it cannot parse is reported back.

import { resolveLayer } from "./commands";

export interface Intent {
  command: string;
  args: Record<string, unknown>;
}

const LAYER_WORDS =
  // Terrain & soils first: "wildfire hazard" must be tried before "wildfire", "sea level rise" before "sea level".
  "tax credit properties|tax-credit properties|lihtc|difficult development areas|difficult development area|dda|hospital star ratings|hospital ratings|housing assistance|housing choice vouchers|housing vouchers|section 8|qualified census tracts|qualified census tract|qct|landslide susceptible terrain|landslide susceptibility|broadband availability|internet access|fiber internet|broadband|internet|fiber|wildfire risk to communities|wildfire risk ranks|wildfire ranking|wildfire risk|trust land|bia land|reservations|public schools|school locations|schools|trauma centers|trauma centres|hospitals|hospital|social vulnerability index|social vulnerability|vulnerable communities|svi|community health|health estimates|places data|diabetes rate|chronic disease|national heritage|national park units|national parks|heritage areas|battlefields|unesco sites|aerial photos by year|aerial photographs|aerial photos|naip|national risk index|risk index|disaster risk|natural hazard risk|hazard risk|rivers and streams|stream network|streams|hydrography|nhd|drinking water pfas|pfas in water|forever chemicals|pfas|impaired waters|impaired water|303d list|303d|polluted waters|polluted water|water quality listings|historic topo maps|historical topo maps|historic topographic maps|historical topographic maps|historic maps|historical maps|historical topo|old topo maps|old maps|topographic maps|topo maps|historic imagery|historical imagery|historical aerials|historical aerial|historic aerials|old imagery|old satellite imagery|wayback|contaminated sites|contamination|contaminants|national priorities list|npl sites|leaking underground storage tanks|underground storage tanks|leaking tanks|storage tanks|lust|formerly used defense sites|old military sites|fuds|munitions|superfund sites|superfund|brownfields|brownfield|toxic release inventory|toxic releases|hazardous waste|critical habitat|endangered species|threatened species|endangered|historic places|historic place|historic sites|national register|historic landmarks|landmarks|historic|transmission lines|transmission|power lines|power grid|grid|gas pipelines|oil pipelines|pipelines|pipeline|nuclear power plants|nuclear plants|power plants|power stations|plants|rail lines|railroads|railroad|railways|trains|rail|airports|airport|airfields|heliports|dams|dam|quaternary faults|fault lines|faults|landslides|landslide|mudslides|geologic map|geology|bedrock|rocks|public land survey|survey grid|townships|sections|plss|air quality|air pollution|aqi|smog|airnow|news events|conflict events|gdelt|protests|" +
  "wildfire hazard potential|wildfire hazard|wildfire potential|fire hazard|sea level rise|sea-level rise|sea level|shaded relief|hillshade|relief|contour lines|topo lines|contours|contour|soil survey|soils|soil|farmland|steepness|slopes|slope|land cover|landcover|nlcd|" +
  "zoning districts|zoning map|zoning|land use|environmental permits|discharge permits|clean water act|army corps permits|building permits|construction permits|permits|business licences|business licenses|liquor licences|liquor licenses|licences|licenses|" +
  "wildfires|wildfire|fire perimeters|active fires|hotspots|fires|fire|firms|weather alerts|hazard alerts|hazards|live warnings|warnings|alerts|disasters|volcanoes|flood zones|flood map|floodplain|fema|wetlands|wetland|marsh|public lands|public land|protected areas|national forests|parks|tax parcels|parcel lines|lot lines|property lines|parcels|parcel|" +
  "aircraft|airplanes|planes|flights|flight|jets|ships|ship|vessels|boats|satellites|satellite|sats|earthquakes|quakes|seismic|cameras|webcams|cctv|traffic|cars|launches|rockets|rocket|water quality|satellite water|stream gauges|water|rivers|river|lakes|lake|reservoirs|reservoir|gauges|floods|flooding|hydrology|groundwater|aquifers|aquifer|wells|drought|turbidity|sediment|trade|ports|port|harbours|harbors|shipping|borders|border crossings|crossings|commerce|jobs|employment|wages|business|economy|real estate|housing|home values|homes|rents|property values|property|companies|public companies|listed companies|stocks|tickers|banks|bank branches|deposits|spending|federal spending|federal dollars|contracts|grants|constructs|place fabric|jurisdictions|districts|watersheds|boundaries|construct field|field|emergence";

const num = (s: string) => {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100,
  };
  const n = Number(s);
  return Number.isFinite(n) ? n : (words[s.toLowerCase()] ?? NaN);
};

export function parseIntent(raw: string): Intent | null {
  const t = raw.trim().toLowerCase().replace(/[.,!?]+$/g, "");
  if (!t) return null;
  let m: RegExpMatchArray | null;

  if (/^(stop|release|unfollow|stop following|stop tracking)/.test(t)) {
    return { command: "follow_selected", args: { on: false } };
  }
  if (/^(follow|track|lock on|lock)( it| this| that| the selected| selection)?$/.test(t)) {
    return { command: "follow_selected", args: { on: true } };
  }
  if (/^(go live|live|back to live|live mode|return to now|now)$/.test(t)) {
    return { command: "set_time", args: { live: true } };
  }
  if ((m = t.match(/^(?:rewind|go back|back)\s+(\w+)\s+(minute|minutes|hour|hours)/))) {
    const n = num(m[1]);
    if (Number.isFinite(n)) return { command: "set_time", args: { offset_minutes: -(m[2].startsWith("hour") ? n * 60 : n) } };
  }
  if ((m = t.match(/^(?:fast forward|forward|skip ahead|ahead|jump ahead)\s+(\w+)\s+(minute|minutes|hour|hours)/))) {
    const n = num(m[1]);
    if (Number.isFinite(n)) return { command: "set_time", args: { offset_minutes: m[2].startsWith("hour") ? n * 60 : n } };
  }
  if (/^(home|zoom out|overview|show (me )?(the )?(whole )?(earth|globe|world|planet)|pull back)/.test(t)) {
    return { command: "home_view", args: {} };
  }
  // "start the tour", "take me on the tour", "explore lake mead"
  if (/^(?:start|begin|play|take)(?: me on)?(?: the)? (?:water |market |trade )?tour$/.test(t)) {
    return { command: "explore_preset", args: { tour: true } };
  }
  if ((m = t.match(/^(?:explore|preset|jump to preset)\s+(.+)$/))) {
    return { command: "explore_preset", args: { preset: m[1].trim() } };
  }
  // "where does the water go", "trace downstream", "trace the water from austin"
  if ((m = t.match(/^(?:where does (?:the |this )?water go|trace (?:the )?(?:water|downstream|river)(?: downstream)?)(?:\s+(?:from|in|near|at)\s+(.+))?$/))) {
    return { command: "trace_downstream", args: { place: m[1]?.trim() || undefined } };
  }
  // "what drains here", "trace upstream", "where does the water come from in austin"
  if ((m = t.match(/^(?:what drains (?:here|to (?:here|this))|trace (?:the )?(?:water )?upstream|where does (?:the |this )?water come from)(?:\s+(?:from|in|near|at|to)\s+(.+))?$/))) {
    return { command: "trace_upstream", args: { place: m[1]?.trim() || undefined } };
  }
  // "teleport", "teleport me", "show me something happening", "what's happening"
  if (/^(?:teleport(?: me)?(?: somewhere)?|next teleport|show me (?:something|what'?s) happening|what'?s happening(?: in the world)?)$/.test(t)) {
    return { command: "teleport", args: {} };
  }
  // "ascend", "powers of ten", "climb the stack", "ascend from corpus christi"
  if ((m = t.match(/^(?:ascend|powers of ten|climb (?:the|through the) (?:stack|constructs|strata))(?:\s+(?:from|over|at|in)\s+(.+))?$/))) {
    return { command: "ascend", args: { place: m[1]?.trim() || undefined } };
  }
  // "compare with portland", "compare corpus christi with portland texas", "compare here and rockport"
  if ((m = t.match(/^compare\s+(?:(?:here|this)\s+(?:with|to|and)\s+|(?:with|to)\s+)(.+)$/))) {
    return { command: "compare_places", args: { place: m[1].trim() } };
  }
  if ((m = t.match(/^compare\s+(.+?)\s+(?:with|to|and|vs\.?|versus)\s+(.+)$/))) {
    return { command: "compare_places", args: { from: m[1].trim(), place: m[2].trim() } };
  }
  // "water report", "water report for san antonio", "how is the water in austin"
  if ((m = t.match(/^(?:water report|water status|how(?:'s| is) the water|is the water (?:ok|safe))(?:\s+(?:for|in|near|around|over|at)\s+(.+))?$/))) {
    return { command: "water_report", args: { place: m[1]?.trim() || undefined } };
  }
  // "market report", "market report for austin", "home values in denver", "how is the economy in tulsa"
  if ((m = t.match(/^(?:market report|housing market|housing report|home values|property values|how(?:'s| is) the (?:economy|market|housing|job market))(?:\s+(?:for|in|near|around|over|at)\s+(.+))?$/))) {
    return { command: "market_report", args: { place: m[1]?.trim() || undefined } };
  }
  // Lenses: "I'm a realtor", "switch lens to economist", "lens water", "change lens"
  if ((m = t.match(/^(?:i(?:'| a)?m (?:an? )?|switch (?:the )?lens to |change (?:the )?lens to |set (?:the )?lens to |lens |look as (?:an? )?|view as (?:an? )?)(.+)$/))) {
    return { command: "set_lens", args: { lens: m[1].trim() } };
  }
  if (/^(?:change|pick|choose)(?: the| a)? lens$/.test(t) || /^who (?:am i|is looking)$/.test(t)) {
    return { command: "open_panel", args: { panel: "lens", on: true } };
  }
  // Practitioner panels: "open the screener", "show indicators", "release calendar", "what changed", "watchlist", "desk mode"
  if ((m = t.match(/^(?:(open|show|display|bring up|hide|close|dismiss)\s+)?(?:me\s+)?(?:the\s+|my\s+)?(screener|screen|indicators|signals|release calendar|releases|movers|what changed|watchlist|watch list|desk mode|desk|hud mode|hud)$/))) {
    const off = /^(hide|close|dismiss)$/.test(m[1] ?? "");
    const word = m[2];
    const panel = /screen/.test(word) ? "screener" : /indicator|signal/.test(word) ? "indicators" : /movers|what changed/.test(word) ? "movers" : /release/.test(word) ? "releases" : /watch/.test(word) ? "watchlist" : /hud/.test(word) ? "hud" : "desk";
    return { command: "open_panel", args: { panel, on: !off } };
  }
  if ((m = t.match(/^(?:watch this|add (?:this|it|the selection|the selected \w+) to (?:my|the) watchlist|watch the selected \w+)$/))) {
    return { command: "watch_selected", args: {} };
  }
  if ((m = t.match(/^(?:screen|find|rank)\s+(counties|states|ports|crossings|countries)\s+(?:where|by|with)\s+(.+)$/))) {
    return { command: "screen", args: { kind: m[1].replace(/s$/, "").replace("countrie", "country"), query: m[2].trim() } };
  }
  if ((m = t.match(/^(?:pin|set)\s+(?:the\s+)?vintage\s+(?:to\s+)?(\d{4}-\d{2}-\d{2})$/))) {
    return { command: "set_vintage", args: { date: m[1] } };
  }
  if (/^(?:clear|unpin|drop)\s+(?:the\s+)?vintage$/.test(t)) {
    return { command: "set_vintage", args: {} };
  }
  if (/^(where am i|what am i looking at|describe|status|report|sitrep)/.test(t)) {
    return { command: "describe_view", args: {} };
  }

  // "show me flights over austin", "turn on ships", "hide satellites"
  const layerRe = new RegExp(
    `^(?:(show|display|turn on|enable|put up|bring up|hide|turn off|disable|remove|clear)\\s+(?:me\\s+)?(?:the\\s+|all\\s+)?)(${LAYER_WORDS})(?:\\s+(?:over|around|near|in|above|at|for)\\s+(.+))?$`,
  );
  if ((m = t.match(layerRe))) {
    const verb = m[1];
    const on = !/hide|off|disable|remove|clear/.test(verb);
    const layer = resolveLayer(m[2]);
    if (layer) return { command: "show_layer", args: { layer, on, place: m[3]?.trim() || undefined } };
  }

  // "find flight ual123", "track ship ever given", "follow the iss", "locate n12345"
  if ((m = t.match(/^(find|search for|search|locate|look for|track|follow|lock on to|lock onto)\s+(?:the\s+)?(?:flight|plane|aircraft|ship|vessel|satellite|sat|camera)?\s*(.+)$/))) {
    const follow = /track|follow|lock/.test(m[1]);
    return { command: "find_object", args: { query: m[2].trim(), follow } };
  }

  // "go to austin", "fly to tokyo", "take me to the panama canal", "zoom in on paris"
  if ((m = t.match(/^(?:go to|fly to|take me to|jump to|move to|look at|zoom (?:in )?(?:to|on)|center on|centre on|show me)\s+(.+?)(?:\s+at\s+(\w+)\s*(?:km|kilometers|kilometres))?$/))) {
    const alt = m[2] ? num(m[2]) : undefined;
    return { command: "fly_to_place", args: { place: m[1].trim(), altitude_km: Number.isFinite(alt ?? NaN) ? alt : undefined } };
  }

  return null;
}
