import { eq } from "drizzle-orm";
import { productDatabase } from "./db";
import { subscriptions } from "./schema";
import { planForPrice } from "./billing-config";
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
  const pro = Boolean(
    subscription &&
    ["active", "trialing"].includes(subscription.status) &&
    planForPrice(subscription.priceId) === "Pro" &&
    subscription.periodEnd &&
    subscription.periodEnd.getTime() > Date.now(),
  );
  return capabilities(pro);
}
