import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  assertPreviewIsolation,
  syntheticDataAllowed,
} from "../src/lib/preview";
import {
  billingBaseUrl,
  billingSandboxEnabled,
} from "../src/lib/product/billing-config";
import { proxy } from "../src/proxy";
vi.mock("server-only", () => ({}));
import { stripeClient, publicPrices } from "../src/lib/product/billing";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("FLOATALPHA_BILLING_SANDBOX", "true");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "");
  vi.stubEnv("PRODUCT_ANALYTICS_MODE", "demo");
  vi.stubEnv(
    "PRODUCT_DATABASE_URL",
    "postgresql://billing@localhost/billing_sandbox",
  );
  vi.stubEnv("BILLING_DATABASE_NAME", "billing_sandbox");
  vi.stubEnv("BETTER_AUTH_URL", "https://billing-demo.example.test");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_isolated_unit_fixture");
});
afterEach(() => vi.unstubAllEnvs());
it("allows only explicit isolated staging billing with synthetic market data", () => {
  expect(assertPreviewIsolation).not.toThrow();
  expect(billingSandboxEnabled()).toBe(true);
  expect(syntheticDataAllowed()).toBe(true);
  expect(stripeClient()).not.toBeNull();
});
it.each([
  "DATABASE_URL",
  "DERIVED_MARKET_DATABASE_URL",
  "ASSET_IMAGES_DATABASE_URL",
  "CRON_SECRET",
  "SKINPORT_CURRENCY",
  "CS2SH_API_KEY",
  "PGHOST",
])("rejects leaked %s", (key) => {
  vi.stubEnv(key, "forbidden");
  expect(assertPreviewIsolation).toThrow("COLLECTOR_CREDENTIALS_FORBIDDEN");
});
it("rejects production, live Stripe keys, mixed visual-demo flags and an unidentified database", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_must_not_be_used");
  expect(stripeClient()).toBeNull();
  expect(await publicPrices()).toEqual([]);
  expect(assertPreviewIsolation).toThrow("STRIPE_SANDBOX_KEY_REQUIRED");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  vi.stubEnv("VERCEL_ENV", "production");
  expect(stripeClient()).toBeNull();
  expect(assertPreviewIsolation).toThrow();
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "true");
  expect(assertPreviewIsolation).toThrow();
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "");
  vi.stubEnv("BILLING_DATABASE_NAME", "different_database");
  expect(assertPreviewIsolation).toThrow("DATABASE_REQUIRED");
});
it.each([
  "/api/internal/collect/skinport",
  "/api/internal/asset-images/health",
  "/api/product/watchlist",
  "/api/product/portfolio",
  "/ops-c8e4",
])("blocks %s in billing Sandbox before dispatch", (path) => {
  expect(
    proxy(
      new NextRequest(`https://billing-demo.example.test${path}`, {
        method: "POST",
      }),
    ).status,
  ).toBe(403);
});
it.each([
  "/api/auth/sign-in/email",
  "/api/product/billing/checkout",
  "/api/product/billing/portal",
  "/api/product/billing/status",
  "/api/stripe/webhook",
])("passes %s to its own authentication/signature boundary", (path) => {
  expect(
    proxy(
      new NextRequest(`https://billing-demo.example.test${path}`, {
        method: "POST",
      }),
    ).headers.get("x-middleware-next"),
  ).toBe("1");
});
it("does not change actual production collector dispatch", () => {
  vi.stubEnv("FLOATALPHA_BILLING_SANDBOX", "");
  vi.stubEnv("VERCEL_ENV", "production");
  expect(
    proxy(
      new NextRequest(
        "https://production.invalid/api/internal/collect/skinport",
        { method: "POST" },
      ),
    ).headers.get("x-middleware-next"),
  ).toBe("1");
});
it("uses the configured application origin and rejects unsafe return origins", () => {
  expect(billingBaseUrl()).toBe("https://billing-demo.example.test");
  for (const url of [
    "https://user:secret@example.test",
    "https://example.test/path",
    "http://example.test",
    "https://example.test?next=evil",
  ]) {
    vi.stubEnv("BETTER_AUTH_URL", url);
    expect(billingBaseUrl).toThrow();
  }
});
