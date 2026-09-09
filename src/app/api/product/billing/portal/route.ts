import { eq } from "drizzle-orm";
import { productRequest, ProductError } from "@/lib/product/api";
import { stripeClient } from "@/lib/product/billing";
import { productDatabase } from "@/lib/product/db";
import { subscriptions } from "@/lib/product/schema";
export async function POST(request: Request) {
  return productRequest(request, async ({ user }) => {
    const stripe = stripeClient();
    const subscription = (
      await productDatabase()
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, user.app.id))
    )[0];
    if (!stripe || !subscription?.customerId)
      throw new ProductError(503, "No billing account is available.");
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.customerId,
      return_url: `${process.env.BETTER_AUTH_URL}/settings`,
    });
    return { url: session.url };
  });
}
