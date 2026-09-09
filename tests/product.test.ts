import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";
import { evaluateConditions, transition } from "../src/lib/product/conditions";
import { valueHolding } from "../src/lib/product/portfolio";
import { capabilities } from "../src/lib/product/entitlements";
import { money } from "../src/lib/product/format";
const db = new PGlite();
vi.mock("../src/lib/product/db", () => ({
  productDatabase: () => drizzle(db, { schema: { ...schema, ...market } }),
}));
vi.mock("../src/lib/db", () => ({
  database: () => drizzle(db, { schema: market }),
}));
let signedIn = true;
const appId = randomUUID(),
  authId = randomUUID(),
  otherId = randomUUID(),
  assetId = randomUUID();
vi.mock("../src/lib/product/auth", () => ({
  currentUser: async () =>
    signedIn
      ? {
          app: { id: appId },
          identity: { id: authId, email: "test@example.test" },
        }
      : null,
}));
import {
  POST as watch,
  DELETE as unwatch,
  PATCH as checkpoint,
} from "../src/app/api/product/watchlist/route";
import { POST as holding } from "../src/app/api/product/portfolio/route";
import { POST as createAlert } from "../src/app/api/product/alerts/route";
import { evaluateAlerts } from "../src/lib/product/alerts";
import { marketSnapshot } from "../src/lib/product/market";
const req = (
  path: string,
  body: unknown,
  method = "POST",
  origin = "http://localhost:3000",
) =>
  new Request(`http://localhost:3000/api/product/${path}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://unused/test");
  vi.stubEnv("STRIPE_PRO_MONTHLY_PRICE_ID", "price_test");
  for (const file of [
    "0000_initial_market_snapshots",
    "0001_protect_observation_history",
    "0002_product_accounts_monitoring_billing",
  ])
    await db.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
  await db.query(
    "insert into auth_users(id,name,email) values($1,'Test','test@example.test')",
    [authId],
  );
  await db.query("insert into app_users(id,auth_user_id) values($1,$2)", [
    appId,
    authId,
  ]);
  await db.query("insert into app_users(id) values($1)", [otherId]);
  await db.query(
    "insert into assets(id,market_hash_name,category,is_tracked) values($1,'Fixture Case','cases',true)",
    [assetId],
  );
});
afterAll(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
it("preserves zero, null, exact money, and condition re-arm semantics", () => {
  expect(money("0")).toBe("$0.00");
  expect(money(null)).toBe("—");
  expect(valueHolding(3, "999999999999.12345678", "0.10000000")).toEqual({
    value: "2999999999997.37037034",
    cost: "0.30000000",
    pnl: "2999999999997.07037034",
  });
  expect(transition(false, true)).toEqual({ notify: true, next: true });
  expect(transition(true, true).notify).toBe(false);
  expect(transition(true, null).next).toBe(true);
  expect(transition(true, false).next).toBe(false);
  expect(
    evaluateConditions(
      [{ metric: "sales24h", operator: "lt", threshold: "1" }],
      {
        median: null,
        quantity: 0,
        sales24h: 0,
        priceChange: null,
        listingChange: null,
        activityChange: null,
      },
    ).truth,
  ).toBe(true);
  expect(
    evaluateConditions(
      [{ metric: "priceChange", operator: "gt", threshold: "1" }],
      {
        median: null,
        quantity: 0,
        sales24h: 0,
        priceChange: null,
        listingChange: null,
        activityChange: null,
      },
    ).state,
  ).toBe("COLLECTING");
  expect(capabilities(false).canCreateAlerts).toBe(false);
});
it("enforces authentication, origin, limits, idempotent watch addition, and user ownership", async () => {
  signedIn = false;
  expect((await watch(req("watchlist", { assetId }))).status).toBe(401);
  signedIn = true;
  expect(
    (await watch(req("watchlist", { assetId }, "POST", "https://foreign.test")))
      .status,
  ).toBe(403);
  expect((await watch(req("watchlist", { assetId }))).status).toBe(200);
  expect((await watch(req("watchlist", { assetId }))).status).toBe(200);
  expect(
    (
      await db.query("select * from watchlist_entries where user_id=$1", [
        appId,
      ])
    ).rows,
  ).toHaveLength(1);
  await db.query(
    "insert into watchlist_entries(user_id,asset_id) values($1,$2)",
    [otherId, assetId],
  );
  await unwatch(req("watchlist", { assetId }, "DELETE"));
  expect(
    (
      await db.query("select * from watchlist_entries where user_id=$1", [
        otherId,
      ])
    ).rows,
  ).toHaveLength(1);
  await watch(req("watchlist", { assetId }));
  for (let i = 0; i < 19; i++) {
    const id = randomUUID();
    await db.query(
      "insert into assets(id,market_hash_name,is_tracked) values($1,$2,true)",
      [id, `Fixture ${i}`],
    );
    await db.query(
      "insert into watchlist_entries(user_id,asset_id) values($1,$2)",
      [appId, id],
    );
  }
  const additional = randomUUID();
  await db.query(
    "insert into assets(id,market_hash_name,is_tracked) values($1,'Fixture beyond limit',true)",
    [additional],
  );
  expect((await watch(req("watchlist", { assetId: additional }))).status).toBe(
    403,
  );
});
it("persists exact cost basis and rejects unavailable paid mutations", async () => {
  expect(
    (
      await holding(
        req("portfolio", { assetId, quantity: 2, unitCost: "123.12345678" }),
      )
    ).status,
  ).toBe(200);
  const stored = await db.query<{ unit_cost: string }>(
    "select unit_cost from portfolio_holdings where user_id=$1",
    [appId],
  );
  expect(stored.rows[0].unit_cost).toBe("123.12345678");
  expect(
    (await holding(req("portfolio", { assetId, quantity: 0, unitCost: null })))
      .status,
  ).toBe(400);
  expect(
    (
      await createAlert(
        req("alerts", {
          name: "Test",
          assetId,
          conditions: [{ metric: "quantity", operator: "lt", threshold: "10" }],
        }),
      )
    ).status,
  ).toBe(403);
});
let observationId: string;
async function observe(quantity: number, minutes: number) {
  const runId = randomUUID();
  observationId = randomUUID();
  await db.query(
    "insert into collector_runs(id,source,window_start,started_at) values($1,'SKINPORT',now(),now())",
    [runId],
  );
  await db.query(
    "insert into market_observations(id,asset_id,source,collector_run_id,observed_at,currency,quantity,source_created_at,source_updated_at,median_price,sales_24h_volume,raw_item_payload) values($1,$2,'SKINPORT',$3,now()+($4*interval '1 minute'),'USD',$5,now(),now(),'0.10000000',0,'{}')",
    [observationId, assetId, runId, minutes, quantity],
  );
  return observationId;
}
it("executes grounded queries and durable false-to-true alerts without duplicate events", async () => {
  await db.query(
    "insert into billing_subscriptions(user_id,status,price_id,period_end) values($1,'active','price_test',now()+interval '1 day')",
    [appId],
  );
  await observe(20, 0);
  expect(
    (await marketSnapshot()).assets.find((a) => a.id === assetId),
  ).toMatchObject({
    median: "0.10000000",
    quantity: 20,
    sales24h: 0,
    priceChange: null,
    historyState: "COLLECTING",
  });
  expect(
    (
      await createAlert(
        req("alerts", {
          name: "Low listings",
          assetId,
          conditions: [{ metric: "quantity", operator: "lt", threshold: "10" }],
          email: false,
        }),
      )
    ).status,
  ).toBe(200);
  await evaluateAlerts();
  await observe(5, 1);
  await evaluateAlerts();
  await evaluateAlerts();
  expect((await db.query("select * from alert_events")).rows).toHaveLength(1);
  await observe(4, 2);
  await evaluateAlerts();
  expect((await db.query("select * from alert_events")).rows).toHaveLength(1);
  await observe(12, 3);
  await evaluateAlerts();
  await observe(3, 4);
  await evaluateAlerts();
  expect((await db.query("select * from alert_events")).rows).toHaveLength(2);
  expect(
    (
      await checkpoint(
        req("watchlist", { observationIds: [observationId] }, "PATCH"),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await db.query<{ checkpoint_observation_id: string }>(
        "select checkpoint_observation_id from watchlist_entries where user_id=$1 and asset_id=$2",
        [appId, assetId],
      )
    ).rows[0].checkpoint_observation_id,
  ).toBe(observationId);
});
it("keeps the collector append-only protection after product migration", async () => {
  await expect(db.query("delete from market_observations")).rejects.toThrow(
    "append-only",
  );
});
