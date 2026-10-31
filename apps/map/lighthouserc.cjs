module.exports = {
  ci: {
    collect: {
      url: ["http://127.0.0.1:8901/atlas/field.html"],
      numberOfRuns: 1,
      settings: {
        preset: "perf",
        formFactor: "mobile",
        throttlingMethod: "simulate",
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4
        },
        onlyCategories: ["performance"],
        skipAudits: ["screenshot-thumbnails", "final-screenshot"]
      }
    },
    assert: {
      assertions: {
        "first-contentful-paint": ["warn", { "maxNumericValue": 3000 }],
        "largest-contentful-paint": ["warn", { "maxNumericValue": 4000 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.01 }],
        "errors-in-console": ["error", { "maxLength": 0 }]
      }
    },
    upload: {
      target: "filesystem",
      outputDir: "evidence/c7/lhci"
    }
  }
};
