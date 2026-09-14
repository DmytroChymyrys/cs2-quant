import type Stripe from "stripe";
import { stripeClient } from "@/lib/product/billing";
import { syncBillingEvent } from "@/lib/product/billing-webhook";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  const stripe = stripeClient(),
    secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret)
    return Response.json({ error: "BILLING_UNAVAILABLE" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
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
  if (event.livemode !== false)
    return Response.json({ error: "SANDBOX_EVENT_REQUIRED" }, { status: 400 });
  try {
    await syncBillingEvent(stripe, event);
    return Response.json({ received: true });
  } catch {
    // A failed transaction leaves no receipt; Stripe can retry safely.
    return Response.json(
      { error: "BILLING_SYNC_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
