export type BillingInterval = "month" | "year";
export type BillingPlan = "Free" | "Pro";

export function billingSandboxEnabled() {
  return (
    process.env.FLOATALPHA_BILLING_SANDBOX === "true" &&
    process.env.VERCEL_ENV !== "production" &&
    (process.env.NODE_ENV !== "production" ||
      process.env.VERCEL_ENV === "preview")
  );
}
export function billingPriceId(interval: BillingInterval) {
  return interval === "month"
    ? process.env.STRIPE_PRO_MONTHLY_PRICE_ID
    : process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
}
export function planForPrice(priceId: string | null): BillingPlan {
  return priceId &&
    [billingPriceId("month"), billingPriceId("year")].includes(priceId)
    ? "Pro"
    : "Free";
}
export function billingBaseUrl() {
  if (!process.env.BETTER_AUTH_URL) throw Error("BILLING_BASE_URL_REQUIRED");
  const url = new URL(process.env.BETTER_AUTH_URL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )) ||
    url.hostname === process.env.VERCEL_PROJECT_PRODUCTION_URL
  )
    throw Error("BILLING_BASE_URL_INVALID");
  return url.origin;
}
export function billingConfigured() {
  return (
    billingSandboxEnabled() &&
    /^sk_test_/.test(process.env.STRIPE_SECRET_KEY ?? "") &&
    Boolean(
      process.env.STRIPE_WEBHOOK_SECRET &&
      process.env.BETTER_AUTH_URL &&
      process.env.PRODUCT_DATABASE_URL,
    )
  );
}
