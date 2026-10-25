// SPEC-1.3: no prediction renders without a model-card link.
import { describe, expect, it } from "vitest";
import { forecastChartSeries, type ForecastPayload } from "./forecast";

const payload: ForecastPayload = {
  fips: "48453",
  modelVersion: "momentum-v1",
  vintage: "2026-09",
  horizonMonths: 12,
  point: 0.03,
  lo: -0.0425,
  hi: 0.1068,
  modelCard: "https://github.com/jcdavis131/groundtruth/blob/master/apps/map/docs/model-cards/momentum-v1.md",
};

describe("forecastChartSeries", () => {
  it("every series carries a caption and a model-card link", () => {
    const series = forecastChartSeries(Date.UTC(2026, 8, 1), 650000, payload, "#1d4ed8");
    expect(series).toHaveLength(3);
    for (const s of series) {
      expect(s.dash).toBe(true);
      expect(s.caption, `${s.id} needs a caption`).toBeTruthy();
      expect(s.captionLink, `${s.id} needs a model-card link`).toBeTruthy();
      expect(s.captionLink!.href).toMatch(/model-cards\/momentum-v1\.md$/);
      expect(s.caption).toMatch(/momentum-v1/);
      expect(s.caption).toMatch(/2026-09/);
    }
  });

  it("draws endpoint levels from the last observed value (no invented history)", () => {
    const lastV = 650000;
    const series = forecastChartSeries(Date.UTC(2026, 8, 1), lastV, payload, "#1d4ed8");
    const mid = series[0];
    expect(mid.points).toHaveLength(2);
    expect(mid.points[0].v).toBe(lastV);
    expect(mid.points[1].v).toBeCloseTo(lastV * 1.03, 6);
    expect(series[1].points[1].v).toBeCloseTo(lastV * (1 - 0.0425), 6);
    expect(series[2].points[1].v).toBeCloseTo(lastV * (1 + 0.1068), 6);
  });
});
