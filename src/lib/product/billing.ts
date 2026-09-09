import Stripe from "stripe";
export function stripeClient() {
  return process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
        maxNetworkRetries: 1,
        timeout: 15000,
      })
    : null;
}
export async function publicPrices() {
  const stripe = stripeClient();
  if (!stripe) return [];
  const prices = [];
  for (const id of [
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  ]) {
    if (!id) continue;
    try {
      const price = await stripe.prices.retrieve(id);
      if (
        price.active &&
        price.type === "recurring" &&
        price.currency === "usd" &&
        price.unit_amount !== null &&
        price.recurring?.interval_count === 1 &&
        price.recurring.interval ===
          (id === process.env.STRIPE_PRO_MONTHLY_PRICE_ID ? "month" : "year")
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
