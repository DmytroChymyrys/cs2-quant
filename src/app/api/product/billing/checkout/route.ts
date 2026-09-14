import { eq } from "drizzle-orm";
import { z } from "zod";
import { productRequest, ProductError } from "@/lib/product/api";
import { stripeClient, publicPrices } from "@/lib/product/billing";
import {
  billingBaseUrl,
  billingConfigured,
} from "@/lib/product/billing-config";
import { productDatabase } from "@/lib/product/db";
import { appUsers, subscriptions } from "@/lib/product/schema";
export async function POST(request: Request) {
  return productRequest(request, async ({ user }) => {
    const stripe = stripeClient();
    if (!stripe || !billingConfigured())
      throw new ProductError(503, "Subscriptions are not available yet.");
    const { interval } = z
      .object({ interval: z.enum(["month", "year"]) })
      .parse(await request.json());
    const price = (await publicPrices()).find(
      (p) => p.interval === interval,
    )?.id;
    if (!price)
      throw new ProductError(503, "This subscription option is unavailable.");
    return productDatabase().transaction(async (tx) => {
      // Serialize checkout creation per app identity, including requests choosing different intervals.
      await tx
        .select()
        .from(appUsers)
        .where(eq(appUsers.id, user.app.id))
        .for("update");
      let existing = (
        await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.userId, user.app.id))
      )[0];
      if (
        existing &&
        ["active", "trialing", "past_due"].includes(existing.status)
      )
        throw new ProductError(
          409,
          "Manage your existing subscription in the billing portal.",
        );
      if (!existing?.customerId) {
        const customer = await stripe.customers.create(
          { email: user.identity.email, metadata: { appUserId: user.app.id } },
          { idempotencyKey: `cs2-quant-customer-${user.app.id}` },
        );
        await tx
          .insert(subscriptions)
          .values({ userId: user.app.id, customerId: customer.id })
          .onConflictDoUpdate({
            target: subscriptions.userId,
            set: { customerId: customer.id },
          });
        existing = (
          await tx
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.userId, user.app.id))
        )[0];
      }
      const active = await stripe.subscriptions.list({
        customer: existing.customerId!,
        status: "all",
        limit: 100,
      });
      if (
        active.data.some((s) =>
          ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(
            s.status,
          ),
        )
      )
        throw new ProductError(
          409,
          "An existing subscription is awaiting synchronization. Use the billing portal.",
        );
      const pending = await stripe.checkout.sessions.list({
        customer: existing.customerId!,
        status: "open",
        limit: 10,
      });
      const open = pending.data.find(
        (s) =>
          s.mode === "subscription" &&
          s.client_reference_id === user.app.id &&
          s.metadata?.priceId === price,
      );
      if (open) return { url: open.url };
      for (const session of pending.data.filter(
        (s) =>
          s.mode === "subscription" && s.client_reference_id === user.app.id,
      ))
        await stripe.checkout.sessions.expire(session.id);
      const origin = billingBaseUrl();
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: existing.customerId!,
          line_items: [{ price, quantity: 1 }],
          success_url: `${origin}/settings?checkout=success#billing`,
          cancel_url: `${origin}/pricing?checkout=cancelled`,
          client_reference_id: user.app.id,
          metadata: { appUserId: user.app.id, priceId: price },
          subscription_data: { metadata: { appUserId: user.app.id } },
          payment_method_types: ["card"],
        },
        {
          idempotencyKey: `cs2-quant-checkout-${user.app.id}-${price}-${pending.data[0]?.id ?? "initial"}-${Math.floor(Date.now() / 300000)}`,
        },
      );
      return { url: session.url };
    });
  });
}
