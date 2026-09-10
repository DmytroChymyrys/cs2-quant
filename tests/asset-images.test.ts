import { afterEach, expect, it, vi } from "vitest";
import {
  areAssetImagesConfiguredEnabled,
  effectiveImageState,
} from "../src/lib/asset-images/config";
import {
  evaluateImageHealth,
  probeImages,
} from "../src/lib/asset-images/health";
import {
  fetchAssetImage,
  resolveAssetImage,
} from "../src/lib/asset-images/provider";
import catalog from "../config/asset-images/catalog.json";
import approved from "../config/tracked-assets.json";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMICAj4D8IMMAYAQZQHvZKcCy4AAAAASUVORK5CYII=",
  "base64",
);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each([
  [undefined, true],
  ["", true],
  ["true", true],
  ["TRUE", true],
  ["1", true],
  ["yes", true],
  ["false", false],
  ["FALSE", false],
  [" false ", false],
] as const)("opt-out config %s = %s", (value, result) => {
  vi.stubEnv("ASSET_IMAGES_ENABLED", value);
  expect(areAssetImagesConfiguredEnabled()).toBe(result);
});
it.each([
  [true, "HEALTHY", true],
  [true, "DEGRADED", false],
  [false, "HEALTHY", false],
  [true, "DISABLED", false],
] as const)("effective state %s %s", (enabled, status, result) =>
  expect(effectiveImageState(enabled, status).effectiveEnabled).toBe(result),
);
const good = Array.from({ length: 5 }, () => ({ ok: true, status: 200 }));
const outage = good.map(() => ({ ok: false, status: 403 }));
it("tolerates one missing sample but disables systemic failure and requires two good recovery rounds", () => {
  const missing = [...good.slice(0, 4), { ok: false, status: 404 }];
  expect(evaluateImageHealth([missing, missing])).toBe("HEALTHY");
  expect(evaluateImageHealth([outage, outage])).toBe("DEGRADED");
  expect(evaluateImageHealth([outage, good])).toBe("DEGRADED");
  expect(evaluateImageHealth([good, good])).toBe("HEALTHY");
  expect(evaluateImageHealth([])).toBe("DEGRADED");
});
it("contains probe exceptions", async () =>
  expect(
    await probeImages(["a"], async () => {
      throw Error("offline");
    }),
  ).toEqual([{ ok: false, status: null }]));
it("maps exactly the 100 approved names without fuzzy matching or extra assets", () => {
  expect(Object.keys(catalog).sort()).toEqual(
    approved.map((a) => a.marketHashName).sort(),
  );
  expect(resolveAssetImage("not an asset")).toBeNull();
  expect(resolveAssetImage("__proto__")).toBeNull();
});
it.each([
  [200, "text/html", "<html>error</html>"],
  [403, "image/png", png],
  [404, "image/png", png],
  [200, "image/png", "not an image"],
])("rejects non-image/error delivery %s %s", async (status, type, body) => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(body, {
        status: status as number,
        headers: { "content-type": type as string },
      }),
  );
  expect((await fetchAssetImage(Object.values(catalog)[0], fetcher)).ok).toBe(
    false,
  );
});
it("accepts image signature and rejects oversized or redirected/unknown-host delivery", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(png, { headers: { "content-type": "image/png" } }),
  );
  expect((await fetchAssetImage(Object.values(catalog)[0], fetcher)).ok).toBe(
    true,
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    cache: "no-store",
  });
  await expect(
    fetchAssetImage("https://example.com/image", fetcher),
  ).rejects.toThrow();
  expect(
    (
      await fetchAssetImage(
        Object.values(catalog)[0],
        async () =>
          new Response(png, {
            headers: {
              "content-type": "image/png",
              "content-length": "3000000",
            },
          }),
      )
    ).ok,
  ).toBe(false);
});

it("crops only exterior alpha-zero padding and preserves faint edge pixels", async () => {
  const { alphaBounds } = await import("../src/lib/asset-images/artwork");
  const pixels = new Uint8Array(8 * 6 * 4);
  pixels[(2 * 8 + 1) * 4 + 3] = 1;
  pixels[(4 * 8 + 6) * 4 + 3] = 255;
  expect(alphaBounds(pixels, 8, 6, 4)).toEqual({
    left: 1,
    top: 2,
    width: 6,
    height: 3,
  });
  expect(alphaBounds(new Uint8Array(4 * 4 * 4), 4, 4, 4)).toBeNull();
});
