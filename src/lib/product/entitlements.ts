import { eq } from "drizzle-orm";
import { productDatabase } from "./db";
import { subscriptions } from "./schema";
import { planForPrice } from "./billing-config";
import { previewAccessActive } from "./release";
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
export async function entitlements(
  userId: string,
  /**
   * Whether early access is open. Defaults to the release stage; passed
   * explicitly by tests that pin the subscription-driven behaviour which
   * governs once Preview ends, so that path keeps its coverage meanwhile.
   */
  preview: boolean = previewAccessActive(),
) {
  const subscription = (
    await productDatabase()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
  )[0];
  // Preview grants Pro capability outright. It is not a subscription and not a
  // trial: no billing record exists, nothing is charged, and ending Preview
  // removes it. A paid subscription would grant the same capability, which is
  // why both paths converge here rather than branching the whole product.
  const pro =
    preview ||
    Boolean(
      subscription &&
      ["active", "trialing"].includes(subscription.status) &&
      planForPrice(subscription.priceId) === "Pro" &&
      subscription.periodEnd &&
      subscription.periodEnd.getTime() > Date.now(),
    );
  return capabilities(pro);
}
