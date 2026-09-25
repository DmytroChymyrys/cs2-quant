import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
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
  livemode: false,
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
vi.mock("../src/lib/product/billing", () => ({
  stripeClient: () => stripe,
  publicPrices: async () => [
    { id: "price_test", interval: "month" },
    { id: "price_year", interval: "year" },
  ],
}));
let signedIn = true;
vi.mock("../src/lib/product/auth", () => ({
  currentUser: async () =>
    signedIn
      ? { app: { id: appId }, identity: { email: "billing@example.test" } }
      : null,
}));
vi.mock("../src/lib/product/db", () => ({
  productDatabase: () => drizzle(db, { schema: { ...schema, ...market } }),
}));
import { POST } from "../src/app/api/stripe/webhook/route";
// entitlements(userId, false) pins the post-Preview, subscription-driven
// behaviour. Preview itself grants Pro outright and is covered separately in
// tests/production-fail-closed.test.ts.
import { entitlements } from "../src/lib/product/entitlements";
import { POST as checkout } from "../src/app/api/product/billing/checkout/route";
import { POST as portal } from "../src/app/api/product/billing/portal/route";
import { billingAccount } from "../src/lib/product/billing-account";
beforeAll(async () => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_PRO_MONTHLY_PRICE_ID", "price_test");
  vi.stubEnv("STRIPE_PRO_ANNUAL_PRICE_ID", "price_year");
  vi.stubEnv("FLOATALPHA_BILLING_SANDBOX", "true");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_fixture");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("PRODUCT_DATABASE_URL", "postgresql://unused/billing_test");
  await db.exec(
    await readFile("drizzle-billing/0000_account_billing_sandbox.sql", "utf8"),
  );
  await db.query("insert into app_users(id) values($1)", [appId]);
  await db.query(
    "insert into billing_subscriptions(user_id,customer_id) values($1,'cus_test')",
    [appId],
  );
});
beforeEach(async () => {
  signedIn = true;
  latest = {
    ...latest,
    id: "sub_test",
    customer: "cus_test",
    livemode: false,
    status: "active",
    cancel_at_period_end: false,
  };
  await db.query("delete from billing_events");
  await db.query(
    "update billing_subscriptions set subscription_id=null,status='none',price_id=null,period_end=null,cancel_at_period_end=false,customer_id='cus_test'",
  );
});
afterAll(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
function request(
  id: string,
  signature = true,
  type = "customer.subscription.updated",
  object: unknown = { ...latest, status: "past_due" },
  livemode = false,
) {
  const payload = JSON.stringify({
    id,
    livemode,
    type,
    data: { object },
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
  expect((await entitlements(appId, false)).plan).toBe("Free");
  expect((await POST(request("evt_one"))).status).toBe(200);
  expect((await POST(request("evt_one"))).status).toBe(200);
  expect((await db.query("select * from billing_events")).rows).toHaveLength(1);
  expect((await entitlements(appId, false)).plan).toBe("Pro");
  latest = { ...latest, status: "canceled" };
  expect((await POST(request("evt_two"))).status).toBe(200);
  expect((await entitlements(appId, false)).plan).toBe("Free");
});
it.each([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
])(
  "handles %s and duplicate delivery from current Stripe state",
  async (type) => {
    const object = type.startsWith("invoice.")
      ? {
          customer: "cus_test",
          parent: { subscription_details: { subscription: "sub_test" } },
        }
      : type.startsWith("checkout.")
        ? {
            mode: "subscription",
            customer: "cus_test",
            subscription: "sub_test",
            client_reference_id: appId,
          }
        : latest;
    expect(
      (await POST(request("evt_lifecycle", true, type, object))).status,
    ).toBe(200);
    expect(
      (await POST(request("evt_lifecycle", true, type, object))).status,
    ).toBe(200);
    expect((await entitlements(appId, false)).plan).toBe("Pro");
    expect((await db.query("select * from billing_events")).rows).toHaveLength(
      1,
    );
  },
);
it("retains access for period-end cancellation, then expires without another Stripe request", async () => {
  latest.cancel_at_period_end = true;
  await POST(request("evt_cancel_scheduled"));
  expect(await billingAccount(appId)).toMatchObject({
    plan: "Pro",
    status: "active",
    cancelAtPeriodEnd: true,
  });
  await db.query(
    "update billing_subscriptions set period_end=now()-interval '1 second'",
  );
  expect((await entitlements(appId, false)).plan).toBe("Free");
});
it.each([
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
  "canceled",
])("removes access for %s", async (status) => {
  latest.status = status;
  await POST(request("evt_status"));
  expect((await entitlements(appId, false)).plan).toBe("Free");
});
it("rejects live events, mismatched customers and forged account association without a receipt", async () => {
  expect(
    (await POST(request("evt_live", true, undefined, latest, true))).status,
  ).toBe(400);
  const payload = { ...latest, metadata: { appUserId: randomUUID() } };
  expect(
    (await POST(request("evt_wrong_user", true, undefined, payload))).status,
  ).toBe(503);
  const valid = { ...latest };
  latest.customer = "cus_someone_else";
  expect(
    (await POST(request("evt_wrong_customer", true, undefined, valid))).status,
  ).toBe(503);
  expect((await db.query("select * from billing_events")).rows).toHaveLength(0);
  expect((await entitlements(appId, false)).plan).toBe("Free");
});
it("leaves no receipt after a provider failure and succeeds on retry", async () => {
  vi.mocked(stripe.subscriptions.retrieve).mockRejectedValueOnce(
    Error("timeout"),
  );
  expect((await POST(request("evt_retry"))).status).toBe(503);
  expect((await db.query("select * from billing_events")).rows).toHaveLength(0);
  expect((await POST(request("evt_retry"))).status).toBe(200);
});
it("ignores an old subscription deletion after a newer subscription was linked", async () => {
  await db.query(
    "update billing_subscriptions set subscription_id='sub_new', status='active',price_id='price_test',period_end=now()+interval '1 day'",
  );
  vi.mocked(stripe.subscriptions.retrieve)
    .mockResolvedValueOnce({ ...latest, status: "canceled" } as never)
    .mockResolvedValueOnce({ ...latest, id: "sub_new", created: 200 } as never);
  expect(
    (
      await POST(
        request("evt_old_delete", true, "customer.subscription.deleted"),
      )
    ).status,
  ).toBe(200);
  expect((await entitlements(appId, false)).plan).toBe("Pro");
});
const billingRequest = (
  path: string,
  body: object = {},
  origin = "http://localhost:3000",
) =>
  new Request(`http://localhost:3000/api/product/billing/${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
it("requires authentication and trusted origin for checkout and portal", async () => {
  signedIn = false;
  expect(
    (await checkout(billingRequest("checkout", { interval: "month" }))).status,
  ).toBe(401);
  expect((await portal(billingRequest("portal"))).status).toBe(401);
  signedIn = true;
  expect(
    (
      await checkout(
        billingRequest(
          "checkout",
          { interval: "month" },
          "https://evil.invalid",
        ),
      )
    ).status,
  ).toBe(403);
});
it("binds checkout and portal to the authenticated account; redirect alone grants nothing", async () => {
  vi.spyOn(stripe.subscriptions, "list").mockResolvedValue({
    data: [],
  } as never);
  vi.spyOn(stripe.checkout.sessions, "list").mockResolvedValue({
    data: [],
  } as never);
  const create = vi
    .spyOn(stripe.checkout.sessions, "create")
    .mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_test_fixture",
    } as never);
  const manage = vi
    .spyOn(stripe.billingPortal.sessions, "create")
    .mockResolvedValue({
      url: "https://billing.stripe.com/p/session/test_fixture",
    } as never);
  expect(
    (
      await checkout(
        billingRequest("checkout", {
          interval: "month",
          userId: "attacker",
          customerId: "cus_attacker",
        }),
      )
    ).status,
  ).toBe(200);
  expect(create.mock.lastCall?.[0]).toMatchObject({
    customer: "cus_test",
    mode: "subscription",
    client_reference_id: appId,
    subscription_data: { metadata: { appUserId: appId } },
  });
  expect((await entitlements(appId, false)).plan).toBe("Free");
  expect(
    (await portal(billingRequest("portal", { customerId: "cus_attacker" })))
      .status,
  ).toBe(200);
  expect(manage.mock.lastCall?.[0]).toMatchObject({ customer: "cus_test" });
});
it("links a Stripe customer to an existing empty billing row and reuses pending Checkout", async () => {
  await db.query("update billing_subscriptions set customer_id=null");
  const customer = vi
    .spyOn(stripe.customers, "create")
    .mockResolvedValue({ id: "cus_test" } as never);
  vi.spyOn(stripe.subscriptions, "list").mockResolvedValue({
    data: [],
  } as never);
  vi.spyOn(stripe.checkout.sessions, "list").mockResolvedValue({
    data: [
      {
        id: "cs_pending",
        mode: "subscription",
        client_reference_id: appId,
        metadata: { priceId: "price_test" },
        url: "https://checkout.stripe.com/c/pay/cs_pending",
      },
    ],
  } as never);
  const create = vi.spyOn(stripe.checkout.sessions, "create");
  create.mockClear();
  const response = await checkout(
    billingRequest("checkout", { interval: "month" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    url: "https://checkout.stripe.com/c/pay/cs_pending",
  });
  expect(customer.mock.lastCall?.[0]).toMatchObject({
    metadata: { appUserId: appId },
  });
  expect(create).not.toHaveBeenCalled();
  expect(
    (await db.query("select customer_id from billing_subscriptions")).rows[0],
  ).toMatchObject({ customer_id: "cus_test" });
});
it("does not grant Pro for unknown prices or expired periods", async () => {
  await db.query(
    "update billing_subscriptions set status='active',price_id='unapproved',period_end=now()+interval '1 day' where user_id=$1",
    [appId],
  );
  expect((await entitlements(appId, false)).plan).toBe("Free");
  await db.query(
    "update billing_subscriptions set price_id='price_test',period_end=now()-interval '1 second' where user_id=$1",
    [appId],
  );
  expect((await entitlements(appId, false)).plan).toBe("Free");
});
