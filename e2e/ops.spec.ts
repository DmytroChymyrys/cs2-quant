import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { OPS_PATH } from "../src/lib/ops/config";
const target = process.env.OPS_TEST_DATABASE_URL;
const secret = process.env.OPS_TEST_AUTH_SECRET;
test.skip(
  !target || !secret,
  "Requires an explicitly isolated local Ops review database and test server.",
);
let db: Pool;
const users: {
  id: string;
  app: string;
  token: string;
  role: string;
  verified: boolean;
}[] = [];
const cookie = (token: string) => ({
  name: "better-auth.session_token",
  value: encodeURIComponent(
    `${token}.${createHmac("sha256", secret!).update(token).digest("base64")}`,
  ),
  domain: "127.0.0.1",
  path: "/",
  httpOnly: true,
  sameSite: "Lax" as const,
});
test.beforeAll(async () => {
  const url = new URL(target!);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/floatalpha_ops_review")
    throw new Error("LOCAL_OPS_REVIEW_DATABASE_REQUIRED");
  db = new Pool({ connectionString: target, max: 1 });
  for (const [role, verified] of [
    ["USER", true],
    ["ADMIN", true],
    ["ADMIN", false],
  ] as const) {
    const user = {
      id: randomUUID(),
      app: randomUUID(),
      token: randomUUID(),
      role,
      verified,
    };
    users.push(user);
    await db.query(
      "insert into auth_users(id,name,email,email_verified) values($1,'Ops browser fixture',$2,$3)",
      [user.id, `${user.id}@example.test`, verified],
    );
    await db.query(
      "insert into app_users(id,auth_user_id,role) values($1,$2,$3)",
      [user.app, user.id, role],
    );
    await db.query(
      "insert into auth_sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 hour')",
      [user.id, user.token],
    );
  }
});
test.afterAll(async () => {
  if (!db) return;
  for (const u of users) {
    await db.query("delete from auth_rate_limits where key=$1", [
      `ops:${u.app}`,
    ]);
    await db.query("delete from auth_users where id=$1", [u.id]);
  }
  await db.end();
});
test("anonymous access redirects; API denies and public navigation does not advertise Ops", async ({
  page,
  request,
}) => {
  const response = await request.get(OPS_PATH, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await request.get(`${OPS_PATH}/api`)).status()).toBe(401);
  for (const route of [
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/watchlist",
  ]) {
    await page.goto(route);
    await expect(page.locator(`a[href^="${OPS_PATH}"]`)).toHaveCount(0);
  }
  for (const route of ["/sitemap.xml", "/robots.txt"]) {
    const response = await request.get(route);
    expect(await response.text()).not.toContain(OPS_PATH);
  }
});
test("USER and unverified ADMIN cannot read pages or APIs", async ({
  page,
  context,
}) => {
  for (const index of [0, 2]) {
    await context.clearCookies();
    await context.addCookies([cookie(users[index].token)]);
    expect((await page.goto(OPS_PATH))?.status()).toBe(403);
    await expect(
      page.getByRole("heading", { name: "Forbidden" }),
    ).toBeVisible();
    expect(
      (await context.request.get(`${OPS_PATH}/api?section=users`)).status(),
    ).toBe(403);
    const publicPage = await context.request.get("/");
    expect(await publicPage.text()).not.toContain(`href="${OPS_PATH}`);
  }
});
test("verified ADMIN sees five private read-only sections; records timings and supports narrow screens", async ({
  page,
  context,
}, testInfo) => {
  await context.addCookies([cookie(users[1].token)]);
  const timings: Record<string, unknown> = {};
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const section of ["overview", "users", "product", "system", "billing"]) {
    const start = performance.now();
    const response = await page.goto(`${OPS_PATH}/${section}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(
      page.getByRole("heading", { name: section, exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.locator('meta[name="robots"]').getAttribute("content"),
    ).toContain("noindex");
    const api = await context.request.get(`${OPS_PATH}/api?section=${section}`);
    expect(api.status()).toBe(200);
    const data = await api.json();
    timings[section] = {
      pageMs: Math.round(performance.now() - start),
      queries: data.tables.map(
        (t: { title: string; durationMs: number; unavailable?: boolean }) => ({
          title: t.title,
          ms: t.durationMs,
          unavailable: !!t.unavailable,
        }),
      ),
    };
    expect(JSON.stringify(data)).not.toMatch(
      /session_token|access_token|refresh_token|customer_id|subscription_id|password/,
    );
  }
  await page.goto(`${OPS_PATH}/users`);
  await page.setViewportSize({ width: 768, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("ops-users.png"),
    fullPage: true,
  });
  await testInfo.attach("timings", {
    body: JSON.stringify(timings, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
  await db.query("update app_users set role='USER' where id=$1", [
    users[1].app,
  ]);
  expect((await context.request.get(`${OPS_PATH}/api`)).status()).toBe(403);
  expect((await page.goto(`${OPS_PATH}/billing`))?.status()).toBe(403);
});
