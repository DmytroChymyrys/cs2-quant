import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import {
  isDemoPreview,
  syntheticDataAllowed,
  usesBundledDemoArtwork,
  assertPreviewIsolation,
} from "../src/lib/preview";
import { proxy } from "../src/proxy";
import { assertDemoAllowed } from "../src/lib/product/intelligence/demo";
import bundle from "../config/asset-images/demo-bundle.json";
import { DEMO_UNIVERSE } from "../src/lib/product/intelligence/demo-universe";
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: vi.fn(),
}));
vi.mock("../src/lib/asset-images/store", () => ({
  readImageRecord: () => {
    throw Error("PREVIEW_MUST_NOT_READ_IMAGE_DATABASE");
  },
  writeImageRecord: () => {
    throw Error("PREVIEW_MUST_NOT_WRITE_IMAGE_DATABASE");
  },
}));
import { assetImageState } from "../src/lib/asset-images/service";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "true");
  vi.stubEnv("PRODUCT_ANALYTICS_MODE", "demo");
});
afterEach(() => vi.unstubAllEnvs());

it("allows explicitly isolated optimized previews", () => {
  expect(isDemoPreview()).toBe(true);
  expect(syntheticDataAllowed()).toBe(true);
  expect(assertDemoAllowed).not.toThrow();
});
it("renders bundled artwork immediately without a database and respects manual disable", async () => {
  expect(await assetImageState()).toMatchObject({
    effectiveEnabled: true,
    source: "BUNDLED_DEMO",
  });
  vi.stubEnv("ASSET_IMAGES_ENABLED", "false");
  expect(await assetImageState()).toMatchObject({
    effectiveEnabled: false,
    status: "DISABLED",
  });
});
it("keeps local demo artwork enabled independently of missing CDN health, with manual false winning", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "");
  expect(usesBundledDemoArtwork()).toBe(true);
  // The mocked image store throws: bundled demo state must not depend on it.
  expect(await assetImageState()).toMatchObject({
    effectiveEnabled: true,
    source: "BUNDLED_DEMO",
  });
  vi.stubEnv("ASSET_IMAGES_ENABLED", "false");
  expect(await assetImageState()).toMatchObject({
    effectiveEnabled: false,
    status: "DISABLED",
  });
});
it.each(["database", "fixture"])(
  "does not bypass CDN health for local %s mode",
  (mode) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "");
    vi.stubEnv("PRODUCT_ANALYTICS_MODE", mode);
    expect(usesBundledDemoArtwork()).toBe(false);
  },
);
it.each(["production", "development", ""])(
  "rejects preview flag in Vercel environment %s",
  (env) => {
    vi.stubEnv("VERCEL_ENV", env);
    expect(assertDemoAllowed).toThrow();
  },
);
it("rejects actual production even if NODE_ENV is misconfigured", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "");
  expect(syntheticDataAllowed()).toBe(false);
  expect(usesBundledDemoArtwork()).toBe(false);
  expect(assertDemoAllowed).toThrow();
});
it.each([
  "DATABASE_URL",
  "PRODUCT_DATABASE_URL",
  "ASSET_IMAGES_DATABASE_URL",
  "DERIVED_MARKET_DATABASE_URL",
  "PGPASSWORD",
  "CRON_SECRET",
  "CRON_JOB_ORG_API_KEY",
  "SKINPORT_CURRENCY",
  "CS2SH_API_KEY",
  "BETTER_AUTH_SECRET",
  "STRIPE_SECRET_KEY",
  "MARKET_ANALYTICS_SOURCE_URL",
])("fails closed when %s leaks into preview", (key) => {
  vi.stubEnv(key, "test-value");
  expect(assertPreviewIsolation).toThrow("DEMO_PREVIEW_CREDENTIALS_FORBIDDEN");
});
it.each([
  "/api/internal/collect/skinport",
  "/api/internal/asset-images/health",
  "/api/product/watchlist",
  "/api/stripe/webhook",
  "/ops-c8e4",
])("blocks privileged preview route %s before dispatch", (path) => {
  expect(proxy(new NextRequest(`https://preview.invalid${path}`)).status).toBe(
    403,
  );
});
it.each(["POST", "PUT", "DELETE", "PATCH"])(
  "blocks %s including server actions",
  (method) => {
    expect(
      proxy(new NextRequest("https://preview.invalid/assets", { method }))
        .status,
    ).toBe(403);
  },
);
it("passes through public navigation and image status", () => {
  for (const path of ["/", "/assets", "/terminal", "/api/asset-images/status"])
    expect(
      proxy(new NextRequest(`https://preview.invalid${path}`)).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
});
it("leaves non-preview collector dispatch unchanged", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "");
  expect(
    proxy(
      new NextRequest(
        "https://production.invalid/api/internal/collect/skinport",
        { method: "POST" },
      ),
    ).headers.get("x-middleware-next"),
  ).toBe("1");
});
it("ships the exact original artwork for every demo asset", () => {
  expect(bundle).toHaveLength(DEMO_UNIVERSE.length);
  for (const asset of DEMO_UNIVERSE) {
    const entry = bundle.find((e) => e.id === asset.id)!;
    expect(entry.source).toBe(asset.artwork.url);
    const bytes = readFileSync(`public/demo-artwork/${asset.id}.png`);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
  }
});
