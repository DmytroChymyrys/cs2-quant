import { expect, it, vi, afterEach } from "vitest";
const cached = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ unstable_cache: () => cached }));
import { assetImageState } from "../src/lib/asset-images/service";
import { GET } from "../src/app/api/asset-images/[name]/route";
afterEach(() => {
  vi.unstubAllEnvs();
  cached.mockReset();
});
it("manual false performs no health probes or resolution fetches even if cached healthy", async () => {
  vi.stubEnv("ASSET_IMAGES_ENABLED", " false ");
  cached.mockResolvedValue({ status: "HEALTHY" });
  const fetcher = vi.spyOn(globalThis, "fetch");
  expect(await assetImageState()).toMatchObject({
    effectiveEnabled: false,
    status: "DISABLED",
  });
  expect(
    (
      await GET(new Request("http://localhost/api/asset-images/a"), {
        params: Promise.resolve({ name: "a" }),
      })
    ).status,
  ).toBe(404);
  expect(cached).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRestore();
});
it("cache failure is isolated and returns text-only state", async () => {
  vi.stubEnv("ASSET_IMAGES_ENABLED", "true");
  cached.mockRejectedValue(Error("cache unavailable"));
  expect(await assetImageState()).toMatchObject({
    status: "DEGRADED",
    effectiveEnabled: false,
  });
});
