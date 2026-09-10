import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { LandingChart } from "../src/components/landing-chart";
type PreviewPoints = Parameters<typeof LandingChart>[0]["points"];
const points = (value: number | null): PreviewPoints =>
  [0, 1].map((i) => ({
    at: `2026-09-09T17:0${i * 5}:00Z`,
    median: value === null ? null : String(value),
    quantity: value,
    sales: value,
  }));
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
const render = (data: PreviewPoints) =>
  renderToStaticMarkup(React.createElement(LandingChart, { points: data }));
describe("landing observation preview", () => {
  it("labels absent history as a decorative collecting placeholder", () => {
    const html = render([]);
    expect(html).toContain("Collecting data · placeholder");
    expect(html).toContain("no observations plotted");
    expect(html).not.toContain("NaN");
  });
  it("keeps null observations unavailable rather than drawing a zero series", () => {
    const html = render(points(null));
    expect(html).toContain("Collecting data · placeholder");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
  it("renders legitimate zero sales with zero-height bars, without substituting collecting", () => {
    const html = render(points(0));
    expect(html).not.toContain("Collecting data · placeholder");
    expect(html).toMatch(/<rect[^>]+height="0"/);
    expect(html).not.toContain("NaN");
  });
  it("keeps an unchanged observed price flat", () => {
    const html = render(points(10));
    expect(html).toContain('d="M4.00,50.00 L396.00,50.00"');
    expect(html).not.toContain("Collecting data · placeholder");
  });
});
