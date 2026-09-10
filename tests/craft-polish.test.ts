import { expect, it } from "vitest";
import { nearestObservation } from "../src/components/intelligence-chart";
import { metricHelp } from "../src/components/metric-help";
it("chart inspection selects recorded timestamps rather than filling gaps", () => {
  const points = ["00:00", "00:05", "01:00"].map((t) => ({
    at: `2026-09-09T${t}:00Z`,
  }));
  expect(nearestObservation(points, Date.parse("2026-09-09T00:12:00Z"))).toBe(
    1,
  );
  expect(nearestObservation(points, Date.parse("2026-09-09T00:58:00Z"))).toBe(
    2,
  );
  expect(nearestObservation(points, Date.parse("2026-09-08T00:00:00Z"))).toBe(
    0,
  );
  expect(nearestObservation(points, Date.parse("2026-09-10T00:00:00Z"))).toBe(
    2,
  );
});
it("volatility explanations distinguish complete horizon requirements", () => {
  expect(metricHelp("Volatility · 1h")?.text).toContain("13 consecutive");
  expect(metricHelp("Volatility · 6h")?.text).toContain("73 consecutive");
  expect(metricHelp("24h volatility")?.text).toContain("289 consecutive");
  expect(metricHelp("Price confidence")?.text).toContain("Unavailable");
});
