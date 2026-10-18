import { afterEach, describe, expect, it, vi } from "vitest";
import { formatScreenParam, parseScreenParam, useScreener } from "./store";

describe("screen permalink parameter", () => {
  it("round-trips kind and query", () => {
    const p = formatScreenParam("county", "home.yoyPct > 5 AND state == TX SORT momentum DESC");
    expect(p).toBe("county:home.yoyPct%20%3E%205%20AND%20state%20%3D%3D%20TX%20SORT%20momentum%20DESC");
    expect(parseScreenParam(p)).toEqual({ kind: "county", queryText: "home.yoyPct > 5 AND state == TX SORT momentum DESC" });
  });
  it("accepts a bare kind, rejects unknown kinds and null, tolerates bad escapes", () => {
    expect(parseScreenParam("port")).toEqual({ kind: "port", queryText: "" });
    expect(parseScreenParam("parcel:x")).toBeNull();
    expect(parseScreenParam(null)).toBeNull();
    expect(parseScreenParam("")).toBeNull();
    expect(parseScreenParam("county:%E0%A4%A")).toEqual({ kind: "county", queryText: "%E0%A4%A" });
  });
});

describe("useScreener.runScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useScreener.getState().reset();
    useScreener.setState({ kind: "county", queryText: "", open: false, loading: false });
  });

  const body = {
    data: { rows: [{ id: "county:48453", layer: "realestate", kind: "county", name: "Travis County, TX", geo: [-97.78, 30.33], values: { name: "Travis County" } }], total: 1, fieldsUsed: ["home.yoyPct"], stats: {}, kind: "county", query: "home.yoyPct > 5" },
    fields: [{ key: "name", label: "Name", unit: "", kind: "string", source: "census-tigerweb" }],
    provenance: [],
    generatedAt: "2026-09-11T10:00:00Z",
    caveats: ["c"],
  };

  it("calls /api/screen with the kind and encoded query and stores the result", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await useScreener.getState().runScreen({ kind: "county", queryText: "home.yoyPct > 5" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/screen?kind=county&q=home.yoyPct%20%3E%205");
    const s = useScreener.getState();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.rows).toHaveLength(1);
    expect(s.total).toBe(1);
    expect(s.fields[0].key).toBe("name");
    expect(s.caveats).toEqual(["c"]);
    expect(s.ranKind).toBe("county");
    expect(s.ranQuery).toBe("home.yoyPct > 5");
    expect(s.kind).toBe("county");
    expect(s.queryText).toBe("home.yoyPct > 5");
  });

  it("keeps structured errors from a 400", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid query", errors: [{ code: "unknown_field", message: 'unknown field "x"', field: "x" }] }), { status: 400 })));
    useScreener.setState({ rows: body.data.rows as never, total: 1 });
    await useScreener.getState().runScreen({ kind: "port", queryText: "x > 1" });
    const s = useScreener.getState();
    expect(s.error).toBe("invalid query");
    expect(s.errors[0]).toMatchObject({ code: "unknown_field", field: "x" });
    expect(s.loading).toBe(false);
    // The previous rows stay on screen so the user can compare while fixing the query.
    expect(s.rows).toHaveLength(1);
  });

  it("reports a network failure as an error string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await useScreener.getState().runScreen();
    expect(useScreener.getState().error).toBe("offline");
    expect(useScreener.getState().loading).toBe(false);
  });

  it("toggle, setSort and selectRow are plain setters", () => {
    const s = useScreener.getState();
    s.toggle();
    expect(useScreener.getState().open).toBe(true);
    s.setSort({ field: "name", dir: "asc" });
    s.selectRow("county:1");
    expect(useScreener.getState().sort).toEqual({ field: "name", dir: "asc" });
    expect(useScreener.getState().selectedId).toBe("county:1");
    s.reset();
    expect(useScreener.getState().sort).toBeNull();
  });
});
