import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";
const db = new PGlite(),
  appId = randomUUID();
const stripe = new Stripe("sk_test_local_fixture");
const secret = "whsec_isolated_local_fixture";
let latest = {
  id: "sub_test",
  customer: "cus_test",
  created: 100,
  status: "active",
  items: {
    data: [
      {
        price: { id: "price_test" },
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
      },
    ],
  },
  cancel_at_period_end: false,
};
vi.spyOn(stripe.subscriptions, "retrieve").mockImplementation(
  async () => latest as unknown as Stripe.Response<Stripe.Subscription>,
);
vi.mock("../src/lib/product/billing", () => ({ stripeClient: () => stripe }));
vi.mock("../src/lib/product/db", () => ({
  productDatabase: () => drizzle(db, { schema: { ...schema, ...market } }),
}));
import { POST } from "../src/app/api/stripe/webhook/route";
import { entitlements } from "../src/lib/product/entitlements";
beforeAll(async () => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_PRO_MONTHLY_PRICE_ID", "price_test");
  for (const file of [
    "0000_initial_market_snapshots",
    "0001_protect_observation_history",
    "0002_product_accounts_monitoring_billing",
    "0003_ops_application_role",
    "0004_ops_audit",
  ])
    await db.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
  await db.query("insert into app_users(id) values($1)", [appId]);
  await db.query(
    "insert into billing_subscriptions(user_id,customer_id) values($1,'cus_test')",
    [appId],
  );
});
afterAll(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
function request(id: string, signature = true) {
  const payload = JSON.stringify({
    id,
    type: "customer.subscription.updated",
    data: { object: { ...latest, status: "past_due" } },
    created: 100,
  });
  return new Request("http://localhost:3000/api/stripe/webhook", {
    method: "POST",
    headers: {
      "stripe-signature": signature
        ? stripe.webhooks.generateTestHeaderString({ payload, secret })
        : "invalid",
    },
    body: payload,
  });
}
it("rejects forged webhooks and synchronizes current provider state idempotently", async () => {
  expect((await POST(request("evt_forged", false))).status).toBe(400);
  expect((await entitlements(appId)).plan).toBe("Free");
  expect((await POST(request("evt_one"))).status).toBe(200);
  expect((await POST(request("evt_one"))).status).toBe(200);
  expect((await db.query("select * from billing_events")).rows).toHaveLength(1);
  expect((await entitlements(appId)).plan).toBe("Pro");
  latest = { ...latest, status: "canceled" };
  expect((await POST(request("evt_two"))).status).toBe(200);
  expect((await entitlements(appId)).plan).toBe("Free");
});
it("does not grant Pro for unknown prices or expired periods", async () => {
  await db.query(
    "update billing_subscriptions set status='active',price_id='unapproved',period_end=now()+interval '1 day' where user_id=$1",
    [appId],
  );
  expect((await entitlements(appId)).plan).toBe("Free");
  await db.query(
    "update billing_subscriptions set price_id='price_test',period_end=now()-interval '1 second' where user_id=$1",
    [appId],
  );
  expect((await entitlements(appId)).plan).toBe("Free");
});
