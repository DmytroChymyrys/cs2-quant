import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  fetch: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: mocks.invalidate,
}));
vi.mock("../src/lib/asset-images/store", () => ({
  readImageRecord: mocks.read,
  writeImageRecord: mocks.write,
}));
vi.mock("../src/lib/asset-images/provider", () => ({
  resolveAssetImage: () => "https://cdn.steamstatic.com/test.png",
  imageProvider: "STEAM_CDN",
  fetchAssetImage: mocks.fetch,
}));
import {
  assetImageState,
  refreshImageHealth,
} from "../src/lib/asset-images/service";
import { deliverAssetImage } from "../src/lib/asset-images/delivery";
import { POST } from "../src/app/api/internal/asset-images/health/route";
import { GET } from "../src/app/api/asset-images/[name]/route";
beforeEach(() => {
  vi.stubEnv("ASSET_IMAGES_ENABLED", "true");
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(null);
  mocks.write.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("cold and warm health reads never probe, and absent/expired state fails closed", async () => {
  expect((await assetImageState()).effectiveEnabled).toBe(false);
  mocks.read.mockResolvedValue({
    value: { status: "HEALTHY" },
    expires_at: new Date(Date.now() + 60000),
  });
  expect((await assetImageState()).effectiveEnabled).toBe(true);
  mocks.read.mockResolvedValue({
    value: { status: "HEALTHY" },
    expires_at: new Date(0),
  });
  expect((await assetImageState()).effectiveEnabled).toBe(false);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("manual off skips reads and explicit probes", async () => {
  vi.stubEnv("ASSET_IMAGES_ENABLED", " FaLsE ");
  expect((await assetImageState()).effectiveEnabled).toBe(false);
  await refreshImageHealth();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("protected endpoint rejects unauthenticated refresh before any work", async () => {
  expect(
    (await POST(new Request("http://local", { method: "POST" }))).status,
  ).toBe(401);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("explicit refresh preserves two-round threshold and persists its decision", async () => {
  vi.useFakeTimers();
  mocks.fetch.mockResolvedValue({ ok: true, status: 200 });
  mocks.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
  const pending = refreshImageHealth();
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({
    status: "HEALTHY",
    sampleSize: 10,
    failureCount: 1,
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(10);
  expect(mocks.write).toHaveBeenCalledWith(
    "health",
    expect.objectContaining({ status: "HEALTHY" }),
    1200000,
  );
});
it.each([404, 410])(
  "persists an individual %s as MISSING and suppresses subsequent upstream work",
  async (status) => {
    mocks.fetch.mockResolvedValue({ ok: false, status });
    mocks.write.mockImplementation(async (_key, value, ttl) => {
      mocks.read.mockResolvedValue({
        value,
        expires_at: new Date(Date.now() + ttl),
      });
    });
    await expect(deliverAssetImage("capsule")).rejects.toMatchObject({
      state: "MISSING",
      retrySeconds: 86400,
    });
    await expect(deliverAssetImage("capsule")).rejects.toMatchObject({
      state: "MISSING",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls.every(([key]) => key !== "health")).toBe(
      true,
    );
  },
);
it("temporary errors retry after expiry, while successful artwork becomes AVAILABLE", async () => {
  mocks.read.mockResolvedValue({
    value: { state: "TEMPORARY_FAILURE" },
    expires_at: new Date(Date.now() + 60000),
  });
  await expect(deliverAssetImage("item")).rejects.toMatchObject({
    state: "TEMPORARY_FAILURE",
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({
    value: { state: "TEMPORARY_FAILURE" },
    expires_at: new Date(0),
  });
  mocks.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    bytes: new Uint8Array([1]),
    type: "image/webp",
  });
  expect(await deliverAssetImage("item")).toMatchObject({ bytes: "AQ==" });
  expect(mocks.write).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ state: "AVAILABLE" }),
    86400000,
  );
});
it("negative delivery responses are cacheable without degrading provider health", async () => {
  mocks.read.mockImplementation(async (key) =>
    key === "health"
      ? {
          value: { status: "HEALTHY" },
          expires_at: new Date(Date.now() + 60000),
        }
      : null,
  );
  mocks.fetch.mockResolvedValue({ ok: false, status: 404 });
  const r = await GET(new Request("http://local"), {
    params: Promise.resolve({ name: "capsule" }),
  });
  expect(r.status).toBe(404);
  expect(r.headers.get("cache-control")).toContain("max-age=86400");
  expect((await assetImageState()).effectiveEnabled).toBe(true);
});

it("oversized HTTP 200 artwork is UNUSABLE for 24 hours without changing the byte limit", async () => {
  mocks.fetch.mockResolvedValue({
    ok: false,
    status: 200,
    reason: "SIZE_LIMIT",
  });
  mocks.write.mockImplementation(async (_key, value, ttl) => {
    mocks.read.mockResolvedValue({
      value,
      expires_at: new Date(Date.now() + ttl),
    });
  });
  await expect(deliverAssetImage("large capsule")).rejects.toMatchObject({
    state: "UNUSABLE",
    retrySeconds: 86400,
  });
  await expect(deliverAssetImage("large capsule")).rejects.toMatchObject({
    state: "UNUSABLE",
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
