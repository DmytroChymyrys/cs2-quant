import { eq } from "drizzle-orm";
import { z } from "zod";
import { productRequest, ProductError } from "@/lib/product/api";
import { stripeClient } from "@/lib/product/billing";
import { productDatabase } from "@/lib/product/db";
import { appUsers, subscriptions } from "@/lib/product/schema";
export async function POST(request: Request) {
  return productRequest(request, async ({ user }) => {
    const stripe = stripeClient();
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET)
      throw new ProductError(503, "Subscriptions are not available yet.");
    const { interval } = z
      .object({ interval: z.enum(["month", "year"]) })
      .parse(await request.json());
    const price =
      interval === "month"
        ? process.env.STRIPE_PRO_MONTHLY_PRICE_ID
        : process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
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
          .onConflictDoNothing();
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
          s.mode === "subscription" && s.client_reference_id === user.app.id,
      );
      if (open) return { url: open.url };
      const origin = process.env.BETTER_AUTH_URL!;
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: existing.customerId!,
          line_items: [{ price, quantity: 1 }],
          success_url: `${origin}/settings?checkout=success`,
          cancel_url: `${origin}/pricing`,
          client_reference_id: user.app.id,
        },
        {
          idempotencyKey: `cs2-quant-checkout-${user.app.id}-${Math.floor(Date.now() / 300000)}`,
        },
      );
      return { url: session.url };
    });
  });
}
