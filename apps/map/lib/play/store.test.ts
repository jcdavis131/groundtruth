import { beforeEach, describe, expect, it } from "vitest";
import { usePlay } from "./store";

const county = { fips: "48453", name: "Travis County", state: "TX", lon: -97.74, lat: 30.27 };
const county2 = { fips: "48201", name: "Harris County", state: "TX", lon: -95.37, lat: 29.76 };

describe("play store", () => {
  beforeEach(() => {
    usePlay.setState({
      mode: "off",
      conquered: [],
      probe: null,
      cast: null,
      haul: null,
      reeling: false,
      castError: null,
    });
  });

  it("starts off with no territory", () => {
    const s = usePlay.getState();
    expect(s.mode).toBe("off");
    expect(s.conquered).toEqual([]);
  });

  it("switches modes and stands down", () => {
    usePlay.getState().setMode("command");
    expect(usePlay.getState().mode).toBe("command");
    usePlay.getState().setMode("fisherman");
    expect(usePlay.getState().mode).toBe("fisherman");
    usePlay.getState().setMode("off");
    expect(usePlay.getState().mode).toBe("off");
  });

  it("conquering the same county twice holds it once", () => {
    const s = usePlay.getState();
    s.conquer(county);
    s.conquer(county);
    expect(usePlay.getState().conquered).toHaveLength(1);
    expect(usePlay.getState().conquered[0].fips).toBe("48453");
  });

  it("holds several counties, oldest first", () => {
    const s = usePlay.getState();
    s.conquer(county);
    s.conquer(county2);
    const held = usePlay.getState().conquered;
    expect(held.map((c) => c.fips)).toEqual(["48453", "48201"]);
  });

  it("abandoning territory clears the ledger and the probe", () => {
    const s = usePlay.getState();
    s.conquer(county);
    s.setProbe({ lon: 0, lat: 0 });
    s.clearConquered();
    expect(usePlay.getState().conquered).toEqual([]);
    expect(usePlay.getState().probe).toBeNull();
  });

  it("a cast records the hook point and clears the old haul", () => {
    const s = usePlay.getState();
    s.setHaul({ fips: "48453", modelVersion: "v", vintage: "v", modelCard: "c", caveat: "c", items: [] });
    s.setCast({ lon: -97.7, lat: 30.3, fips: null, name: null, state: null, at: 1 });
    expect(usePlay.getState().cast?.lon).toBe(-97.7);
    expect(usePlay.getState().haul).not.toBeNull();
    s.setHaul(null);
    expect(usePlay.getState().haul).toBeNull();
  });

  it("reeling and cast errors are tracked", () => {
    const s = usePlay.getState();
    s.setReeling(true);
    expect(usePlay.getState().reeling).toBe(true);
    s.setCastError("no bite");
    expect(usePlay.getState().castError).toBe("no bite");
    s.setReeling(false);
    s.setCastError(null);
    expect(usePlay.getState().reeling).toBe(false);
    expect(usePlay.getState().castError).toBeNull();
  });
});
