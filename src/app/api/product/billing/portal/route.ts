import { eq } from "drizzle-orm";
import { productRequest, ProductError } from "@/lib/product/api";
import { stripeClient } from "@/lib/product/billing";
import {
  billingBaseUrl,
  billingConfigured,
} from "@/lib/product/billing-config";
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
    if (!stripe || !billingConfigured() || !subscription?.customerId)
      throw new ProductError(503, "No billing account is available.");
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.customerId,
      return_url: `${billingBaseUrl()}/settings#billing`,
      ...(process.env.STRIPE_PORTAL_CONFIGURATION_ID
        ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID }
        : {}),
    });
    return { url: session.url };
  });
}
