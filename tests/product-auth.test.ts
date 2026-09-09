import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";
const db = new PGlite();
const sent: { subject: string; text: string }[] = [];
vi.mock("../src/lib/product/db", () => ({
  productDatabase: () => drizzle(db, { schema: { ...schema, ...market } }),
}));
vi.mock("../src/lib/product/email", () => ({
  emailConfigured: () => true,
  sendEmail: async (_to: string, subject: string, text: string) => {
    sent.push({ subject, text });
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
import { authService } from "../src/lib/product/auth";
beforeAll(async () => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "isolated-test-secret-not-used-outside-tests-123456789",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://unused/test");
  for (const file of [
    "0000_initial_market_snapshots",
    "0001_protect_observation_history",
    "0002_product_accounts_monitoring_billing",
  ])
    await db.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
});
afterAll(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
const request = (path: string, body: object, cookie?: string) =>
  new Request(`http://localhost:3000/api/auth/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
it("runs email verification, session lifecycle, and password reset against the actual adapter and migrations", async () => {
  const auth = authService()!;
  const created = await auth.handler(
    request("sign-up/email", {
      name: "Auth Test",
      email: "auth@example.test",
      password: "Original-Password-123",
      callbackURL: "/onboarding",
    }),
  );
  expect(created.status).toBe(200);
  expect(sent).toHaveLength(1);
  expect(
    (
      await auth.handler(
        request("sign-in/email", {
          email: "auth@example.test",
          password: "Original-Password-123",
        }),
      )
    ).status,
  ).toBe(403);
  const verifyUrl = sent[0].text.match(/https?:\/\/\S+/)![0];
  const verified = await auth.handler(
    new Request(verifyUrl, { headers: { origin: "http://localhost:3000" } }),
  );
  expect([200, 302]).toContain(verified.status);
  const login = await auth.handler(
    request("sign-in/email", {
      email: "auth@example.test",
      password: "Original-Password-123",
    }),
  );
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token");
  const session = await auth.handler(
    new Request("http://localhost:3000/api/auth/get-session", {
      headers: { cookie },
    }),
  );
  expect((await session.json()).user.email).toBe("auth@example.test");
  const reset = await auth.handler(
    request("request-password-reset", {
      email: "auth@example.test",
      redirectTo: "/reset-password",
    }),
  );
  expect(reset.status).toBe(200);
  const resetEmail = sent.find((s) => s.subject.includes("Reset"))!;
  const url = resetEmail.text.match(/https?:\/\/\S+/)![0];
  const token = new URL(url).pathname.split("/").at(-1)!;
  const changed = await auth.handler(
    request("reset-password", {
      token,
      newPassword: "Replacement-Password-456",
    }),
  );
  expect(changed.status).toBe(200);
  expect(
    (
      await auth.handler(
        request("sign-in/email", {
          email: "auth@example.test",
          password: "Replacement-Password-456",
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await auth.handler(
        request("reset-password", {
          token,
          newPassword: "Replay-Password-789",
        }),
      )
    ).status,
  ).toBe(400);
  const missing = await auth.handler(
    request("request-password-reset", {
      email: "not-registered@example.test",
      redirectTo: "/reset-password",
    }),
  );
  expect(missing.status).toBe(200);
  expect((await auth.handler(request("sign-out", {}, cookie))).status).toBe(
    200,
  );
});
