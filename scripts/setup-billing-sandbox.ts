import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import Stripe from "stripe";
import {
  billingSandboxEnabled,
  billingBaseUrl,
} from "../src/lib/product/billing-config";
import { billingWebhookEvents } from "../src/lib/product/billing-webhook";

const envFile = ".env.billing-sandbox.local";
config({ path: envFile, quiet: true });
if (
  !billingSandboxEnabled() ||
  !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
)
  throw Error("EXPLICIT_STRIPE_SANDBOX_REQUIRED");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const requested = (["month", "year"] as const)
  .map((interval) => {
    const flag = interval === "month" ? "--monthly-cents=" : "--yearly-cents=";
    const value = process.argv
      .find((arg) => arg.startsWith(flag))
      ?.slice(flag.length);
    if (
      value !== undefined &&
      (!/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) <= 0)
    )
      throw Error("APPROVED_PRICE_MUST_BE_POSITIVE_INTEGER_CENTS");
    return {
      interval,
      amount: value === undefined ? undefined : Number(value),
      key:
        interval === "month"
          ? "STRIPE_PRO_MONTHLY_PRICE_ID"
          : "STRIPE_PRO_ANNUAL_PRICE_ID",
    };
  })
  .filter((p) => p.amount !== undefined || process.env[p.key]);
if (!requested.length)
  throw Error(
    "NO_APPROVED_PRICES: provide existing Sandbox Price IDs or explicitly approved --monthly-cents / --yearly-cents. No default prices are invented.",
  );
const updates: Record<string, string> = {};
const prices: Stripe.Price[] = [];
let product: Stripe.Product | undefined;
for (const request of requested) {
  let price: Stripe.Price | undefined;
  if (process.env[request.key])
    price = await stripe.prices.retrieve(process.env[request.key]!);
  else {
    const lookup = `floatalpha_pro_${request.interval}_usd_${request.amount}`;
    price = (
      await stripe.prices.list({
        lookup_keys: [lookup],
        active: true,
        limit: 1,
      })
    ).data[0];
    if (!price) {
      product ??= (
        await stripe.products.search({
          query: "metadata['floatalphaPlan']:'Pro' AND active:'true'",
          limit: 1,
        })
      ).data[0];
      product ??= await stripe.products.create(
        { name: "FloatAlpha Pro", metadata: { floatalphaPlan: "Pro" } },
        { idempotencyKey: "floatalpha-pro-sandbox-product" },
      );
      price = await stripe.prices.create(
        {
          product: product.id,
          currency: "usd",
          unit_amount: request.amount!,
          recurring: { interval: request.interval },
          lookup_key: lookup,
        },
        { idempotencyKey: lookup },
      );
    }
  }
  if (
    price.livemode ||
    !price.active ||
    price.currency !== "usd" ||
    price.type !== "recurring" ||
    price.recurring?.interval !== request.interval ||
    price.recurring.interval_count !== 1 ||
    price.unit_amount === null ||
    (request.amount !== undefined && price.unit_amount !== request.amount)
  )
    throw Error("PRICE_DOES_NOT_MATCH_APPROVED_SANDBOX_PLAN");
  updates[request.key] = price.id;
  prices.push(price);
}
const products = new Map<string, string[]>();
for (const price of prices) {
  const id =
    typeof price.product === "string" ? price.product : price.product.id;
  products.set(id, [...(products.get(id) ?? []), price.id]);
}
const configuration = await stripe.billingPortal.configurations.create(
  {
    business_profile: { headline: "FloatAlpha Billing Sandbox" },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: prices.length > 1,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: [...products].map(([product, prices]) => ({
          product,
          prices,
        })),
      },
    },
  },
  {
    idempotencyKey: `floatalpha-sandbox-portal-${prices
      .map((p) => p.id)
      .sort()
      .join("-")}`,
  },
);
updates.STRIPE_PORTAL_CONFIGURATION_ID = configuration.id;
let webhookUrl: string | undefined;
if (process.argv.includes("--register-webhook")) {
  webhookUrl = `${billingBaseUrl()}/api/stripe/webhook`;
  if (!webhookUrl.startsWith("https://"))
    throw Error("DEPLOYED_HTTPS_WEBHOOK_REQUIRED");
  const existing = (
    await stripe.webhookEndpoints.list({ limit: 100 })
  ).data.find((e) => e.url === webhookUrl);
  if (existing) {
    if (existing.api_version !== Stripe.API_VERSION)
      throw Error(
        "WEBHOOK_API_VERSION_MISMATCH: use a Sandbox endpoint matching the installed Stripe SDK",
      );
    if (!process.env.STRIPE_WEBHOOK_SECRET)
      throw Error(
        "EXISTING_WEBHOOK_SECRET_REQUIRED: Stripe cannot return it again",
      );
    await stripe.webhookEndpoints.update(existing.id, {
      enabled_events: [...billingWebhookEvents],
    });
  } else {
    const endpoint = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      api_version: Stripe.API_VERSION,
      enabled_events: [...billingWebhookEvents],
    });
    updates.STRIPE_WEBHOOK_SECRET = endpoint.secret!;
  }
}
let env = await readFile(envFile, "utf8");
for (const [key, value] of Object.entries(updates)) {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${env.trimEnd()}\n${line}\n`;
}
await writeFile(envFile, env, { mode: 0o600 });
console.info(
  JSON.stringify(
    {
      sandbox: true,
      prices: prices.map((p) => ({
        id: p.id,
        amount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval,
      })),
      portalConfiguration: configuration.id,
      webhookUrl,
      savedTo: envFile,
    },
    null,
    2,
  ),
);
