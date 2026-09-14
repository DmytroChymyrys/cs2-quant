import "server-only";
import Stripe from "stripe";
import { billingSandboxEnabled, billingPriceId } from "./billing-config";
export function stripeClient() {
  return billingSandboxEnabled() &&
    /^sk_test_/.test(process.env.STRIPE_SECRET_KEY ?? "")
    ? new Stripe(process.env.STRIPE_SECRET_KEY!, {
        maxNetworkRetries: 1,
        timeout: 5000,
      })
    : null;
}
export async function publicPrices() {
  const stripe = stripeClient();
  if (!stripe) return [];
  const prices = [];
  for (const interval of ["month", "year"] as const) {
    const id = billingPriceId(interval);
    if (!id) continue;
    try {
      const price = await stripe.prices.retrieve(id);
      if (
        price.livemode === false &&
        price.active &&
        price.type === "recurring" &&
        price.currency === "usd" &&
        price.unit_amount !== null &&
        price.recurring?.interval_count === 1 &&
        price.recurring.interval === interval
      )
        prices.push({
          id: price.id,
          amount: price.unit_amount,
          currency: price.currency,
          interval: price.recurring!.interval,
        });
    } catch {
      /* Unavailable billing must not fabricate a price. */
    }
  }
  return prices;
}
