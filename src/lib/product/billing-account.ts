import { eq } from "drizzle-orm";
import { productDatabase } from "./db";
import { subscriptions } from "./schema";
import { entitlements } from "./entitlements";
import { billingConfigured } from "./billing-config";

export async function billingAccount(userId: string) {
  const subscription = (
    await productDatabase()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
  )[0];
  const caps = await entitlements(userId);
  return {
    plan: caps.plan,
    status: subscription?.status ?? "none",
    currentPeriodEnd: subscription?.periodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    canManage: billingConfigured() && Boolean(subscription?.customerId),
  };
}
