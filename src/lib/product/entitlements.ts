import { eq } from "drizzle-orm";
import { productDatabase } from "./db";
import { subscriptions } from "./schema";
export function capabilities(pro: boolean) {
  return {
    plan: pro ? "Pro" : "Free",
    canCreateAlerts: pro,
    canUseAdvancedScreener: pro,
    canSaveScreens: pro,
    canExport: pro,
    maxWatchlistAssets: pro ? 100 : 20,
    maxHoldings: pro ? 100 : 20,
    historyWindowDays: pro ? 30 : 7,
  } as const;
}
export async function entitlements(userId: string) {
  const subscription = (
    await productDatabase()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
  )[0];
  const configuredPrices = [
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  ].filter(Boolean);
  const pro = Boolean(
    subscription &&
    ["active", "trialing"].includes(subscription.status) &&
    subscription.priceId &&
    configuredPrices.includes(subscription.priceId) &&
    subscription.periodEnd &&
    subscription.periodEnd.getTime() > Date.now(),
  );
  return capabilities(pro);
}
