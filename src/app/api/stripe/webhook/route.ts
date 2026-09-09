import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { stripeClient } from "@/lib/product/billing";
import { productDatabase } from "@/lib/product/db";
import { billingEvents, subscriptions } from "@/lib/product/schema";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const stripe = stripeClient(),
    secret = process.env.STRIPE_WEBHOOK_SECRET,
    signature = request.headers.get("stripe-signature");
  if (!stripe || !secret)
    return Response.json({ error: "BILLING_UNAVAILABLE" }, { status: 503 });
  if (!signature)
    return Response.json({ error: "SIGNATURE_REQUIRED" }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      secret,
    );
  } catch {
    return Response.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }
  if (
    ![
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(event.type)
  )
    return Response.json({ received: true });
  try {
    const payload = event.data.object as Stripe.Subscription;
    const customerId =
      typeof payload.customer === "string"
        ? payload.customer
        : payload.customer.id;
    await productDatabase().transaction(async (tx) => {
      const sub = (
        await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.customerId, customerId))
          .for("update")
      )[0];
      if (!sub) throw new Error("UNKNOWN_BILLING_CUSTOMER");
      if (
        (
          await tx
            .select()
            .from(billingEvents)
            .where(eq(billingEvents.id, event.id))
        ).length
      )
        return;
      const latest = await stripe.subscriptions.retrieve(payload.id);
      if (sub.subscriptionId && sub.subscriptionId !== latest.id) {
        const current = await stripe.subscriptions.retrieve(sub.subscriptionId);
        if (current.created > latest.created) {
          await tx.insert(billingEvents).values({ id: event.id });
          return;
        }
      }
      const item = latest.items.data[0];
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
    return Response.json({ received: true });
  } catch {
    return Response.json(
      { error: "BILLING_SYNC_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
