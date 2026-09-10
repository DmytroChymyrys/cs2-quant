import { afterEach, expect, it, vi } from "vitest";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/asset-images/service", () => ({
  refreshImageHealth: refresh,
}));
import { startDevelopmentImageHealth } from "../src/lib/asset-images/development-health";

afterEach(() => {
  vi.clearAllTimers();
  delete (globalThis as { assetImageHealthTimer?: unknown }).assetImageHealthTimer;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("bootstraps outside startup and refreshes every ten minutes without duplicate timers", async () => {
  vi.useFakeTimers();
  refresh.mockReset().mockResolvedValue({ status: "HEALTHY" });
  startDevelopmentImageHealth();
  startDevelopmentImageHealth();
  expect(refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(refresh).toHaveBeenCalledExactlyOnceWith({ invalidateCache: false });
  await vi.advanceTimersByTimeAsync(600_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("retries persistence failures in one minute without an unhandled rejection", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  refresh.mockReset().mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValue({ status: "HEALTHY" });
  startDevelopmentImageHealth();
  await vi.advanceTimersByTimeAsync(1000);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});
