import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { productDatabase } from "./db";
import { billingEvents, subscriptions } from "./schema";

export const billingWebhookEvents = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;
const objectId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;

// Authenticated events trigger a current-state read, so delayed deliveries cannot
// roll the account back to stale invoice/subscription payloads.
export async function syncBillingEvent(stripe: Stripe, event: Stripe.Event) {
  if (!(billingWebhookEvents as readonly string[]).includes(event.type)) return;
  let customerId: string | undefined,
    subscriptionId: string | undefined,
    accountId: string | undefined;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription") return;
    customerId = objectId(session.customer);
    subscriptionId = objectId(session.subscription);
    accountId = session.client_reference_id ?? session.metadata?.appUserId;
  } else if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    customerId = objectId(subscription.customer);
    subscriptionId = subscription.id;
    accountId = subscription.metadata?.appUserId;
  } else {
    const invoice = event.data.object as Stripe.Invoice;
    customerId = objectId(invoice.customer);
    subscriptionId = objectId(
      invoice.parent?.subscription_details?.subscription,
    );
  }
  if (!subscriptionId || !customerId) return;
  await productDatabase().transaction(async (tx) => {
    const sub = (
      await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.customerId, customerId!))
        .for("update")
    )[0];
    if (!sub) {
      if (accountId) throw Error("BILLING_CUSTOMER_NOT_YET_LINKED");
      return; // Unrelated Sandbox customers are not FloatAlpha accounts.
    }
    if (accountId && accountId !== sub.userId)
      throw Error("BILLING_OWNERSHIP_MISMATCH");
    if (
      (
        await tx
          .select()
          .from(billingEvents)
          .where(eq(billingEvents.id, event.id))
      ).length
    )
      return;
    const latest = await stripe.subscriptions.retrieve(subscriptionId!);
    if (
      latest.livemode !== false ||
      objectId(latest.customer) !== customerId ||
      (latest.metadata?.appUserId && latest.metadata.appUserId !== sub.userId)
    )
      throw Error("BILLING_SUBSCRIPTION_MISMATCH");
    if (sub.subscriptionId && sub.subscriptionId !== latest.id) {
      const current = await stripe.subscriptions.retrieve(sub.subscriptionId);
      if (
        current.created > latest.created ||
        !["canceled", "incomplete_expired"].includes(current.status)
      ) {
        await tx.insert(billingEvents).values({ id: event.id });
        return;
      }
    }
    const item =
      latest.items.data.length === 1 ? latest.items.data[0] : undefined;
    await tx
      .update(subscriptions)
      .set({
        subscriptionId: latest.id,
        status: latest.status,
        priceId: item?.price.id ?? null,
        periodEnd: item ? new Date(item.current_period_end * 1000) : null,
        cancelAtPeriodEnd: latest.cancel_at_period_end,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));
    await tx.insert(billingEvents).values({ id: event.id });
  });
}
