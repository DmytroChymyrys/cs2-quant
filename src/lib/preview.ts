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
  return process.env.NODE_ENV !== "production" || isDemoPreview();
}

export function assertPreviewIsolation() {
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
