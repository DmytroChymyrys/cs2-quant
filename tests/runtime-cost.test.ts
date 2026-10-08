import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { IMAGE_HEALTH_POLL_MS } from "../src/components/asset-image";
import { HEALTH_MAX_AGE_MS } from "../src/lib/asset-images/service";
import { DERIVED_ACTIVATION_COOLDOWN_MS } from "../src/lib/derived-market/policy";

/**
 * Invocation cost that nothing else is watching.
 *
 * Both facts pinned here were found in a billing audit rather than by anything
 * failing: a background poll that was 32% of all production requests, and a
 * cron entry that started two copies of the heaviest function once an hour.
 * Neither broke anything, which is exactly why neither was noticed — so they
 * get assertions rather than a note in a report.
 */

const read = (p: string) => readFile(p, "utf8");
const crons = async () =>
  JSON.parse(await read("vercel.json")).crons as {
    path: string;
    schedule: string;
  }[];

describe("the image-health poll costs what it is worth", () => {
  it("polls no faster than the state it observes can change", () => {
    // Reading faster than the write horizon cannot surface anything new.
    expect(IMAGE_HEALTH_POLL_MS).toBeLessThanOrEqual(HEALTH_MAX_AGE_MS);
  });

  it("is five minutes, not one", () => {
    expect(IMAGE_HEALTH_POLL_MS).toBe(300_000);
  });

  it("runs only while the tab is visible", async () => {
    const src = await read("src/components/asset-image.tsx");
    expect(src).toContain('document.visibilityState === "visible"');
    // The interval itself is gated, not merely the listener.
    const interval = src.slice(src.indexOf("setInterval("));
    expect(interval.slice(0, 160)).toContain('document.visibilityState === "visible"');
  });

  it("uses the shared constant rather than a literal period", async () => {
    const src = await read("src/components/asset-image.tsx");
    expect(src).toContain("}, IMAGE_HEALTH_POLL_MS);");
    expect(src).not.toContain("setInterval(() => void refresh(), 60000)");
  });

  it("catches up on return without charging per alt-tab", async () => {
    const src = await read("src/components/asset-image.tsx");
    expect(src).toContain('addEventListener("visibilitychange"');
    // Guarded on elapsed time, so rapid switching cannot become a request each.
    expect(src).toContain("Date.now() - lastRun >= IMAGE_HEALTH_POLL_MS");
  });

  it("detaches both the interval and the listener", async () => {
    const src = await read("src/components/asset-image.tsx");
    const cleanup = src.slice(src.indexOf("return () => {"));
    expect(cleanup).toContain("clearInterval(interval)");
    expect(cleanup).toContain('removeEventListener("visibilitychange"');
  });
});

describe("no two cron entries drive the same endpoint", () => {
  it("schedules each path exactly once", async () => {
    const paths = (await crons()).map((c) => c.path);
    expect(new Set(paths).size, `duplicate cron path in ${paths.join(", ")}`).toBe(
      paths.length,
    );
  });

  it("drives the derived refresh from the continuation ticker alone", async () => {
    const refresh = (await crons()).filter(
      (c) => c.path === "/api/internal/refresh",
    );
    expect(refresh).toHaveLength(1);
    expect(refresh[0].schedule).toBe("*/5 * * * *");
  });

  it("keeps the other schedules untouched", async () => {
    const byPath = Object.fromEntries(
      (await crons()).map((c) => [c.path, c.schedule]),
    );
    expect(byPath["/api/internal/asset-images/health"]).toBe("*/10 * * * *");
    expect(byPath["/api/internal/collect/steamwebapi"]).toBe("40 * * * *");
  });

  it("still ticks far more often than activation can occur", async () => {
    /*
     * Removing the hourly entry is safe because the cooldown, not the
     * schedule, is what bounds publication. The ticker only has to be finer
     * than the cooldown for no activation to be delayed by its removal.
     */
    const [, minutes] = (await crons())
      .find((c) => c.path === "/api/internal/refresh")!
      .schedule.match(/^\*\/(\d+) /)!;
    expect(Number(minutes) * 60_000).toBeLessThan(DERIVED_ACTIVATION_COOLDOWN_MS);
  });
});
