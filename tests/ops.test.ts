import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";
const db = new PGlite();
const id = randomUUID(),
  aid = randomUUID(),
  asset = randomUUID();
let signedIn = false,
  verified = true;
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/product/db", () => ({
  productDatabase: () => drizzle(db, { schema: { ...schema, ...market } }),
}));
vi.mock("../src/lib/product/auth", () => ({
  currentUser: async () =>
    signedIn
      ? {
          app: { id: aid, role: "ADMIN" },
          identity: {
            id,
            emailVerified: verified,
            password: "PASSWORD_SENTINEL",
          },
          session: { token: "TOKEN_SENTINEL" },
        }
      : null,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  forbidden: () => {
    throw new Error("forbidden");
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("../src/lib/db", () => ({
  database: () => drizzle(db, { schema: market }),
}));
vi.mock("../src/lib/catalog/db", () => ({
  catalogDatabase: () => ({
    query: (s: string, p?: unknown[]) => db.query(s, p),
  }),
}));
vi.mock("../src/lib/asset-images/service", () => ({
  assetImageState: async () => ({
    configuredEnabled: true,
    effectiveEnabled: false,
    status: "DEGRADED",
  }),
}));
vi.mock("../src/lib/asset-images/store", () => ({
  readImageRecord: async () => null,
}));
import { requireAdmin } from "../src/lib/ops/auth";
import { GET } from "../src/app/ops-c8e4/api/route";
import OpsPage from "../src/app/ops-c8e4/[[...section]]/page";
import { readOps } from "../src/lib/ops/data";
import { OPS_PATH } from "../src/lib/ops/config";
import { opsInput } from "../src/lib/ops/input";
const request = (query = "") =>
  new Request(`http://localhost${OPS_PATH}/api?${query}`);
const page = () =>
  OpsPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
beforeAll(async () => {
  // Market then product, which is the documented bootstrap order: product
  // migrations hold foreign keys into the market tables.
  for (const stream of ["market", "product"] as const)
    for (const entry of JSON.parse(
      await readFile(`drizzle/${stream}/meta/_journal.json`, "utf8"),
    ).entries)
      await db.exec(
        await readFile(`drizzle/${stream}/${entry.tag}.sql`, "utf8"),
      );
  await db.exec(await readFile("db/catalog/001_catalog.sql", "utf8"));
  await db.query(
    "insert into auth_users(id,name,email,email_verified) values($1,'Ops test','ops@example.test',true)",
    [id],
  );
  await db.query("insert into app_users(id,auth_user_id) values($1,$2)", [
    aid,
    id,
  ]);
  await db.query(
    "insert into assets(id,market_hash_name,is_tracked) values($1,'Test asset',true)",
    [asset],
  );
}, 30000);
beforeEach(async () => {
  signedIn = false;
  verified = true;
  await db.exec(
    "update app_users set role='USER'; delete from auth_rate_limits",
  );
});
afterAll(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
it("denies anonymous users at the page, route, and DAL", async () => {
  expect((await GET(request())).status).toBe(401);
  await expect(page()).rejects.toThrow("redirect:/login");
  await expect(readOps("users", 7)).rejects.toMatchObject({ status: 401 });
});
it("denies authenticated USER despite forged/stale ADMIN claims", async () => {
  signedIn = true;
  expect((await GET(request())).status).toBe(403);
  await expect(page()).rejects.toThrow("forbidden");
  await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
});
it("denies unverified ADMIN and observes role revocation immediately", async () => {
  signedIn = true;
  await db.exec("update app_users set role='ADMIN'");
  verified = false;
  expect((await GET(request())).status).toBe(403);
  verified = true;
  expect(await requireAdmin()).toEqual({ id: aid });
  await db.exec("update app_users set role='USER'");
  expect((await GET(request())).status).toBe(403);
});
it("allows verified ADMIN; allowlisted DTOs exclude secrets, session, and billing identifiers", async () => {
  signedIn = true;
  await db.exec("update app_users set role='ADMIN'");
  const response = await GET(request("section=users"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  const body = await response.text();
  expect(body).toContain("ops@example.test");
  expect(body).not.toMatch(
    /PASSWORD_SENTINEL|TOKEN_SENTINEL|access_token|refresh_token|customer_id|subscription_id|auth_id/,
  );
  expect(await page()).toBeTruthy();
});
it("matches current activation and entitlement formulas; real SQL executes for all sections", async () => {
  signedIn = true;
  await db.exec("update app_users set role='ADMIN'");
  await db.query(
    "insert into watchlist_entries(user_id,asset_id) values($1,$2)",
    [aid, asset],
  );
  const overview = await readOps("overview", 1);
  expect(overview[0].unavailable).toBeUndefined();
  expect(overview[0].rows[0]["Currently activated users"]).toBe(1);
  vi.stubEnv("STRIPE_PRO_MONTHLY_PRICE_ID", "price_ops");
  await db.query(
    "insert into billing_subscriptions(user_id,status,price_id,period_end) values($1,'active','price_ops',now()+interval '1 day')",
    [aid],
  );
  expect((await readOps("billing", 7))[0].rows[0].Plan).toBe("Pro");
  await db.exec(
    "update billing_subscriptions set period_end=now()-interval '1 day'",
  );
  expect((await readOps("billing", 7))[0].rows[0].Plan).toBe("Free");
  for (const section of ["product", "system"] as const) {
    const tables = await readOps(section, 7);
    expect(tables.filter((t) => t.unavailable)).toEqual([]);
  }
  await db.exec("delete from watchlist_entries");
  expect(
    (await readOps("overview", 7))[0].rows[0]["Currently activated users"],
  ).toBe(0);
});
it("bounds inputs and parameterizes search", async () => {
  expect(opsInput(new URLSearchParams("days=999&page=Infinity"))).toMatchObject(
    { days: 7, page: 1 },
  );
  signedIn = true;
  await db.exec("update app_users set role='ADMIN'");
  expect((await readOps("users", 7, "' OR 1=1 --"))[0].rows).toEqual([]);
  const missing = await GET(request("section=secrets"));
  expect(missing.status).toBe(404);
});
it("rate limits authenticated admins with the shared durable storage", async () => {
  signedIn = true;
  await db.exec("update app_users set role='ADMIN'");
  await requireAdmin();
  await db.exec("update auth_rate_limits set count=120");
  expect((await GET(request())).status).toBe(429);
});
it("database rejects unknown roles and defaults new app users to USER", async () => {
  await expect(db.exec("update app_users set role='OWNER'")).rejects.toThrow();
  const rows = await db.query(
    "insert into app_users default values returning role",
  );
  expect(rows.rows[0]).toEqual({ role: "USER" });
});
