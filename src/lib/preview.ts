import { billingSandboxEnabled } from "./product/billing-config";
// Deployment-only demo isolation. NODE_ENV remains production on Vercel Preview.
export function isDemoPreview() {
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.FLOATALPHA_DEMO_PREVIEW === "true" &&
    process.env.PRODUCT_ANALYTICS_MODE === "demo"
  );
}

export function syntheticDataAllowed() {
  if (process.env.VERCEL_ENV === "production") return false;
  return (
    process.env.NODE_ENV !== "production" ||
    isDemoPreview() ||
    billingSandboxEnabled()
  );
}

// Demo artwork is checked in with the app, so CDN health cannot hide it.
// Actual production never enters this path, even with a stray demo-mode flag.
export function usesBundledDemoArtwork() {
  return (
    syntheticDataAllowed() && process.env.PRODUCT_ANALYTICS_MODE === "demo"
  );
}

/**
 * Production must never silently render synthetic intelligence.
 *
 * `syntheticDataAllowed()` already refuses synthetic data in production. This
 * makes the refusal explicit and loud rather than a silent downgrade: when a
 * synthetic mode is configured where it is not permitted, the dataset reports
 * UNAVAILABLE and names the misconfiguration instead of serving fabricated
 * numbers that look real.
 */
export function syntheticMisconfiguredInProduction() {
  return (
    ["fixture", "demo"].includes(process.env.PRODUCT_ANALYTICS_MODE ?? "") &&
    !syntheticDataAllowed()
  );
}
export function assertPreviewIsolation() {
  if (process.env.FLOATALPHA_BILLING_SANDBOX === "true") {
    if (
      !billingSandboxEnabled() ||
      process.env.FLOATALPHA_DEMO_PREVIEW === "true" ||
      process.env.PRODUCT_ANALYTICS_MODE !== "demo"
    )
      throw Error("BILLING_SANDBOX_ENVIRONMENT_REQUIRED");
    const forbidden = Object.keys(process.env).filter(
      (key) =>
        /^(DATABASE_URL|DERIVED_MARKET_DATABASE_URL|ASSET_IMAGES_DATABASE_URL)$|^CRON_|^SKINPORT_|^CS2SH_|^MARKET_ANALYTICS_SOURCE_URL$|^PG(HOST|PORT|USER|PASSWORD|SERVICE)/.test(
          key,
        ) && process.env[key],
    );
    if (forbidden.length)
      throw Error(
        `BILLING_SANDBOX_COLLECTOR_CREDENTIALS_FORBIDDEN: ${forbidden.join(",")}`,
      );
    if (
      process.env.STRIPE_SECRET_KEY &&
      !process.env.STRIPE_SECRET_KEY.startsWith("sk_test_")
    )
      throw Error("STRIPE_SANDBOX_KEY_REQUIRED");
    if (
      process.env.STRIPE_PUBLISHABLE_KEY &&
      !process.env.STRIPE_PUBLISHABLE_KEY.startsWith("pk_test_")
    )
      throw Error("STRIPE_SANDBOX_KEY_REQUIRED");
    if (
      !process.env.PRODUCT_DATABASE_URL ||
      !process.env.BILLING_DATABASE_NAME ||
      decodeURIComponent(
        new URL(process.env.PRODUCT_DATABASE_URL).pathname.slice(1),
      ) !== process.env.BILLING_DATABASE_NAME
    )
      throw Error("BILLING_SANDBOX_DATABASE_REQUIRED");
  }
  if (process.env.FLOATALPHA_DEMO_PREVIEW !== "true") return;
  if (!isDemoPreview()) throw Error("DEMO_PREVIEW_ENVIRONMENT_REQUIRED");
  const forbidden = Object.keys(process.env).filter(
    (key) =>
      /DATABASE|POSTGRES|^PG(HOST|PORT|USER|PASSWORD|SERVICE)|^CRON_|^SKINPORT_|^CS2SH_|^BETTER_AUTH_|^STRIPE_|^RESEND_|^GOOGLE_CLIENT_|^TURNSTILE_SECRET|^MARKET_ANALYTICS_SOURCE_URL$/.test(
        key,
      ) && process.env[key],
  );
  if (forbidden.length)
    throw Error(`DEMO_PREVIEW_CREDENTIALS_FORBIDDEN: ${forbidden.join(",")}`);
}
