import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";

const db = new PGlite();
const sent: string[] = [];
vi.mock("../src/lib/product/db", () => ({
  productDatabase: () => drizzle(db, { schema: { ...schema, ...market } }),
}));
vi.mock("../src/lib/product/email", () => ({
  emailConfigured: () => true,
  sendEmail: async (_to: string, _subject: string, text: string) => {
    sent.push(text);
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
import { authService } from "../src/lib/product/auth";
import { steamConnection } from "../src/lib/product/steam";
import {
  STEAM_OPENID,
  steamCallbackRequestURL,
  verifySteamAssertion,
} from "../src/lib/product/steam-openid";

const MARKET_MIGRATIONS = new Set([
  "0000_initial_market_snapshots",
  "0001_protect_observation_history",
  "0006_history_payload_dedup",
  "0007_observation_rollups",
]);

const origin = "http://localhost:3338";
const ns = "http://specs.openid.net/auth/2.0";
const steamId = "76561197960287930";
const otherSteamId = "76561197960287931";
const discovery = `<xrds:XRDS xmlns:xrds="xri://$xrds"><XRD><Service priority="0"><Type>${ns}/signon</Type><URI>${STEAM_OPENID}</URI></Service></XRD></xrds:XRDS>`;
let auth: NonNullable<ReturnType<typeof authService>>;
let owner: { id: string; cookie: string };
let other: typeof owner;
const provider = vi.fn(
  async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (/^https:\/\/steamcommunity\.com\/openid\/id\/\d{17}$/.test(target))
      return new Response(discovery);
    expect(target).toBe(STEAM_OPENID);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(new URLSearchParams(String(init?.body)).get("openid.mode")).toBe(
      "check_authentication",
    );
    return new Response(`ns:${ns}\nis_valid:true\n`);
  },
);
const request = (
  path: string,
  body: object,
  cookie = "",
  requestOrigin = origin,
) =>
  new Request(`${origin}/api/auth/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: requestOrigin,
      cookie,
    },
    body: JSON.stringify(body),
  });
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
async function signUp(email: string) {
  const created = await auth.handler(
    request("sign-up/email", {
      name: "Steam Test",
      email,
      password: "Steam-Test-Password-123",
      callbackURL: "/onboarding",
    }),
  );
  expect(created.status).toBe(200);
  const verify = sent.at(-1)!.match(/https?:\/\/\S+/)![0];
  await auth.handler(new Request(verify));
  const login = await auth.handler(
    request("sign-in/email", { email, password: "Steam-Test-Password-123" }),
  );
  expect(login.status).toBe(200);
  const body = await login.json();
  return { id: body.user.id as string, cookie: cookies(login) };
}
async function begin(user = owner, flow = "settings") {
  const response = await auth.handler(
    request("steam/link", { flow }, user.cookie),
  );
  expect(response.status).toBe(200);
  const { url } = await response.json();
  const providerURL = new URL(url);
  expect(providerURL.origin + providerURL.pathname).toBe(STEAM_OPENID);
  expect(providerURL.searchParams.get("openid.realm")).toBe(`${origin}/`);
  expect(providerURL.searchParams.has("scope")).toBe(false);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  return {
    returnTo: providerURL.searchParams.get("openid.return_to")!,
    cookie: `${user.cookie}; ${cookies(response)}`,
  };
}
function assertion(returnTo: string, id = steamId, nonce?: string) {
  const url = new URL(returnTo);
  const fields = {
    ns,
    mode: "id_res",
    op_endpoint: STEAM_OPENID,
    claimed_id: `https://steamcommunity.com/openid/id/${id}`,
    identity: `https://steamcommunity.com/openid/id/${id}`,
    return_to: returnTo,
    response_nonce:
      nonce ??
      new Date().toISOString().replace(/\.\d{3}Z$/, "Z") + randomUUID(),
    assoc_handle: "fixture-handle",
    signed:
      "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    sig: "c2lnbmF0dXJl",
  };
  for (const [key, value] of Object.entries(fields))
    url.searchParams.set(`openid.${key}`, value);
  return url;
}
async function callback(url: URL, cookie: string) {
  return auth.handler(new Request(url, { headers: { cookie } }));
}
async function stillSignedIn(user = owner) {
  const session = await auth.handler(
    new Request(`${origin}/api/auth/get-session`, {
      headers: { cookie: user.cookie },
    }),
  );
  expect((await session.json()).user.id).toBe(user.id);
}

beforeAll(async () => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "steam-test-only-secret-isolated-not-a-real-credential-123456",
  );
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("PRODUCT_DATABASE_URL", "postgresql://unused/steam_test");
  vi.stubEnv("STEAM_ACCOUNT_LINKING_ENABLED", "true");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "false");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  for (const file of [
    "0000_initial_market_snapshots",
    "0001_protect_observation_history",
    "0002_product_accounts_monitoring_billing",
    "0003_ops_application_role",
    "0004_ops_audit",
  ])
    // Migration streams are isolated by directory; resolve each file to its owner.
    await db.exec(
      await readFile(
        `drizzle/${MARKET_MIGRATIONS.has(file) ? "market" : "product"}/${file}.sql`,
        "utf8",
      ),
    );
  await db.exec(
    await readFile("drizzle-steam/0000_steam_account_link.sql", "utf8"),
  );
  // Re-applying the canonical Steam migration is a no-op: it is the single
  // owner of this index and is guarded by IF NOT EXISTS.
  await db.exec(
    await readFile("drizzle-steam/0000_steam_account_link.sql", "utf8"),
  );
  auth = authService()!;
  owner = await signUp("steam-owner@example.test");
  other = await signUp("steam-other@example.test");
}, 30_000);
beforeEach(async () => {
  await db.exec(
    "delete from auth_accounts where provider_id='steam'; delete from auth_verifications; delete from auth_rate_limits;",
  );
  vi.stubEnv("STEAM_ACCOUNT_LINKING_ENABLED", "true");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "false");
  provider.mockClear();
  vi.stubGlobal("fetch", provider);
});
afterAll(async () => {
  await db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("keeps verified email signup and login usable without a Steam account", async () => {
  vi.stubEnv("STEAM_ACCOUNT_LINKING_ENABLED", "false");
  expect(await steamConnection(owner.id)).toBeNull();
  await stillSignedIn();
  const response = await auth.handler(
    request("steam/link", { flow: "settings" }, owner.cookie),
  );
  expect(response.status).toBe(503);
  expect(provider).not.toHaveBeenCalled();
});

it("links to the existing auth user without creating users, replacing email, or issuing Steam credentials", async () => {
  const flow = await begin();
  const response = await callback(assertion(flow.returnTo), flow.cookie);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    "/settings?steam=connected#connected-accounts",
  );
  expect(await steamConnection(owner.id)).toMatchObject({ steamId });
  const rows = await db.query(
    "select user_id,access_token,refresh_token,id_token,password from auth_accounts where provider_id='steam'",
  );
  expect(rows.rows).toEqual([
    {
      user_id: owner.id,
      access_token: null,
      refresh_token: null,
      id_token: null,
      password: null,
    },
  ]);
  expect(
    (await db.query("select count(*)::int as n from auth_users")).rows[0],
  ).toEqual({ n: 2 });
  expect(provider).toHaveBeenCalledTimes(2);
  await stillSignedIn();
});

it("returns cancellation to onboarding and preserves the account with no provider request", async () => {
  const flow = await begin(owner, "onboarding");
  const url = new URL(flow.returnTo);
  url.searchParams.set("openid.mode", "cancel");
  const response = await callback(url, flow.cookie);
  expect(response.headers.get("location")).toBe(
    "/onboarding?steam=cancelled#connected-accounts",
  );
  expect(await steamConnection(owner.id)).toBeNull();
  expect(provider).not.toHaveBeenCalled();
  await stillSignedIn();
});

it("treats reconnecting the same account as connected and blocks another user's Steam link", async () => {
  const first = await begin();
  await callback(assertion(first.returnTo), first.cookie);
  const repeat = await auth.handler(
    request("steam/link", { flow: "settings" }, owner.cookie),
  );
  expect((await repeat.json()).url).toBe(
    "/settings?steam=connected#connected-accounts",
  );
  const second = await begin(other);
  const response = await callback(assertion(second.returnTo), second.cookie);
  expect(response.headers.get("location")).toContain("steam=conflict");
  expect(await steamConnection(other.id)).toBeNull();
  expect(await steamConnection(owner.id)).toMatchObject({ steamId });
  await stillSignedIn(other);
});

it("disconnects via Better Auth's native endpoint and preserves email login and app data", async () => {
  await db.query(
    "insert into app_users(auth_user_id,categories) values($1,'[\"knives\"]') on conflict(auth_user_id) do nothing",
    [owner.id],
  );
  const first = await begin();
  await callback(assertion(first.returnTo), first.cookie);
  const account = (await steamConnection(owner.id))!;
  expect(
    (
      await auth.handler(
        request("unlink-account", { accountId: account.id }, other.cookie),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await auth.handler(
        request("unlink-account", { accountId: account.id }, owner.cookie),
      )
    ).status,
  ).toBe(200);
  expect(await steamConnection(owner.id)).toBeNull();
  expect(
    (
      await db.query("select categories from app_users where auth_user_id=$1", [
        owner.id,
      ])
    ).rows[0],
  ).toEqual({ categories: ["knives"] });
  await stillSignedIn();
  const again = await begin();
  expect(
    (await callback(assertion(again.returnTo), again.cookie)).headers.get(
      "location",
    ),
  ).toContain("steam=connected");
});

it("does not let a link-only Steam account replace the final usable login method", async () => {
  const first = await begin();
  await callback(assertion(first.returnTo), first.cookie);
  const [credential] = (
    await db.query<{ id: string }>(
      "select id from auth_accounts where user_id=$1 and provider_id='credential'",
      [owner.id],
    )
  ).rows;
  const response = await auth.handler(
    request("unlink-account", { accountId: credential.id }, owner.cookie),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe("LAST_LOGIN_METHOD");
  await stillSignedIn();
});

it("rejects anonymous, cross-origin, and arbitrary return destinations before redirecting", async () => {
  expect(
    (await auth.handler(request("steam/link", { flow: "settings" }))).status,
  ).toBe(401);
  expect(
    (
      await auth.handler(
        request(
          "steam/link",
          { flow: "settings" },
          owner.cookie,
          "https://evil.example",
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await auth.handler(
        request("steam/link", { flow: "https://evil.example" }, owner.cookie),
      )
    ).status,
  ).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});

it.each(["missing-cookie", "different-user", "expired", "revoked-session"])(
  "rejects an unbound callback: %s",
  async (mode) => {
    const flow = await begin();
    let cookie = flow.cookie;
    if (mode === "missing-cookie") cookie = owner.cookie;
    if (mode === "different-user")
      cookie = flow.cookie.replace(owner.cookie, other.cookie);
    if (mode === "expired")
      await db.exec(
        "update auth_verifications set expires_at=now()-interval '1 minute'",
      );
    if (mode === "revoked-session") {
      await db.query(
        "update auth_sessions set expires_at=now()-interval '1 minute' where user_id=$1",
        [owner.id],
      );
    }
    const response = await callback(assertion(flow.returnTo), cookie);
    expect(response.headers.get("location")).toContain("steam=failed");
    expect(await steamConnection(owner.id)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    if (mode === "revoked-session") {
      // Better Auth may prune expired sessions; restore this fixture with an actual login.
      const login = await auth.handler(
        request("sign-in/email", {
          email: "steam-owner@example.test",
          password: "Steam-Test-Password-123",
        }),
      );
      owner.cookie = cookies(login);
    }
  },
);

it("consumes callbacks once, including concurrent replay", async () => {
  const flow = await begin();
  const url = assertion(flow.returnTo);
  const responses = await Promise.all([
    callback(url, flow.cookie),
    callback(url, flow.cookie),
  ]);
  expect(responses.map((r) => r.headers.get("location")).sort()).toEqual([
    "/settings?steam=connected#connected-accounts",
    "/settings?steam=failed#connected-accounts",
  ]);
  expect(provider).toHaveBeenCalledTimes(2);
  expect((await callback(url, flow.cookie)).headers.get("location")).toContain(
    "steam=failed",
  );
});

it("enforces one Steam identity per user when distinct connection attempts race", async () => {
  const a = await begin();
  const b = await begin();
  const responses = await Promise.all([
    callback(assertion(a.returnTo), a.cookie),
    callback(assertion(b.returnTo, otherSteamId), b.cookie),
  ]);
  expect(
    responses.filter((r) =>
      r.headers.get("location")?.includes("steam=connected"),
    ),
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "select count(*)::int as n from auth_accounts where user_id=$1 and provider_id='steam'",
        [owner.id],
      )
    ).rows[0],
  ).toEqual({ n: 1 });
});

it("requires a fresh primary session for connection changes", async () => {
  await db.query(
    "update auth_sessions set created_at=now()-interval '10 minutes' where user_id=$1",
    [owner.id],
  );
  const response = await auth.handler(
    request("steam/link", { flow: "settings" }, owner.cookie),
  );
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("SESSION_NOT_FRESH");
  await db.query("update auth_sessions set created_at=now() where user_id=$1", [
    owner.id,
  ]);
});

it("fails recoverably when Steam is unavailable or denies the signature", async () => {
  for (const response of [
    new Response("unavailable", { status: 503 }),
    new Response(`ns:${ns}\nis_valid:false\n`),
  ]) {
    const flow = await begin();
    provider.mockImplementationOnce(async () => new Response(discovery));
    provider.mockImplementationOnce(async () => response);
    expect(
      (await callback(assertion(flow.returnTo), flow.cookie)).headers.get(
        "location",
      ),
    ).toContain("steam=failed");
    expect(await steamConnection(owner.id)).toBeNull();
    await stillSignedIn();
  }
});

it.each([
  "endpoint",
  "identity",
  "return-to",
  "unsigned-id",
  "old-nonce",
  "future-nonce",
  "duplicate",
  "namespace",
])(
  "rejects malformed Steam assertions before external requests: %s",
  async (mode) => {
    const returnTo = `${origin}/api/auth/steam/callback?state=test&flow=settings`;
    const url = assertion(returnTo);
    if (mode === "endpoint")
      url.searchParams.set("openid.op_endpoint", "http://127.0.0.1/private");
    if (mode === "identity")
      url.searchParams.set(
        "openid.identity",
        `https://evil.example/${steamId}`,
      );
    if (mode === "return-to")
      url.searchParams.set("openid.return_to", "https://evil.example");
    if (mode === "unsigned-id")
      url.searchParams.set(
        "openid.signed",
        "op_endpoint,return_to,response_nonce,assoc_handle",
      );
    if (mode === "old-nonce")
      url.searchParams.set("openid.response_nonce", "2020-01-01T00:00:00Zold");
    if (mode === "future-nonce")
      url.searchParams.set(
        "openid.response_nonce",
        "2099-01-01T00:00:00Zfuture",
      );
    if (mode === "duplicate")
      url.searchParams.append("openid.claimed_id", "https://evil.example");
    if (mode === "namespace") url.searchParams.set("openid.ns", "other");
    await expect(verifySteamAssertion(url, returnTo)).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  },
);

it("requires Steam discovery and rejects ambiguous or oversized verification responses", async () => {
  const returnTo = `${origin}/api/auth/steam/callback?state=test&flow=settings`;
  provider.mockImplementationOnce(
    async () =>
      new Response(discovery.replace(STEAM_OPENID, "https://evil.example")),
  );
  await expect(
    verifySteamAssertion(assertion(returnTo), returnTo),
  ).rejects.toThrow();
  for (const body of [
    `ns:${ns}\nis_valid:true\nis_valid:false\n`,
    "x".repeat(20_000),
  ]) {
    provider.mockImplementationOnce(async () => new Response(discovery));
    provider.mockImplementationOnce(async () => new Response(body));
    await expect(
      verifySteamAssertion(assertion(returnTo), returnTo),
    ).rejects.toThrow();
  }
});

it("keeps nonce replay protection across distinct connection attempts", async () => {
  const nonce =
    new Date(Date.now() + 30_000).toISOString().replace(/\.\d{3}Z$/, "Z") +
    randomUUID();
  const first = await begin();
  await callback(assertion(first.returnTo, steamId, nonce), first.cookie);
  const markers = await db.query<{ expires_at: Date }>(
    "select expires_at from auth_verifications where identifier like 'steam-nonce:%'",
  );
  expect(new Date(markers.rows[0].expires_at).getTime()).toBeGreaterThanOrEqual(
    Date.parse(nonce.slice(0, 20)) + 600_000,
  );
  const account = (await steamConnection(owner.id))!;
  await auth.handler(
    request("unlink-account", { accountId: account.id }, owner.cookie),
  );
  const second = await begin();
  expect(
    (
      await callback(assertion(second.returnTo, steamId, nonce), second.cookie)
    ).headers.get("location"),
  ).toContain("steam=failed");
  expect(await steamConnection(owner.id)).toBeNull();
});

it("arbitrates concurrent claims from different FloatAlpha users without reassignment", async () => {
  const first = await begin();
  const second = await begin(other);
  const responses = await Promise.all([
    callback(assertion(first.returnTo), first.cookie),
    callback(assertion(second.returnTo), second.cookie),
  ]);
  const destinations = responses.map((r) => r.headers.get("location"));
  expect(
    destinations.filter((path) => path?.includes("steam=connected")),
  ).toHaveLength(1);
  expect(
    destinations.filter((path) => path?.includes("steam=conflict")),
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "select count(*)::int as n from auth_accounts where provider_id='steam' and account_id=$1",
        [steamId],
      )
    ).rows[0],
  ).toEqual({ n: 1 });
});

it("cleans expired Steam challenges without removing other verification records", async () => {
  await db.query(
    "insert into auth_verifications(identifier,value,expires_at) values ('steam-link:expired','{}',now()-interval '1 minute'),('steam-nonce:expired','used',now()-interval '1 minute'),('unrelated','keep',now()+interval '1 hour')",
  );
  await begin();
  expect(
    (
      await db.query(
        "select identifier from auth_verifications where identifier in ('steam-link:expired','steam-nonce:expired','unrelated')",
      )
    ).rows,
  ).toEqual([{ identifier: "unrelated" }]);
});

it("allows disconnect after linking is disabled and forbids linking in the read-only demo", async () => {
  const first = await begin();
  await callback(assertion(first.returnTo), first.cookie);
  const account = (await steamConnection(owner.id))!;
  vi.stubEnv("STEAM_ACCOUNT_LINKING_ENABLED", "false");
  expect(
    (
      await auth.handler(
        request("unlink-account", { accountId: account.id }, owner.cookie),
      )
    ).status,
  ).toBe(200);
  expect(await steamConnection(owner.id)).toBeNull();
  vi.stubEnv("STEAM_ACCOUNT_LINKING_ENABLED", "true");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "true");
  expect(
    (
      await auth.handler(
        request("steam/link", { flow: "settings" }, owner.cookie),
      )
    ).status,
  ).toBe(503);
});

it("accepts Next.js internal request URLs only with the configured public Host", () => {
  const external = "https://floatalpha.example";
  const request = new Request(
    "http://localhost:3000/api/auth/steam/callback?state=example",
    { headers: { host: "floatalpha.example" } },
  );
  expect(steamCallbackRequestURL(request, external).href).toBe(
    "https://floatalpha.example/api/auth/steam/callback?state=example",
  );
  expect(() =>
    steamCallbackRequestURL(
      new Request(request.url, {
        headers: { "x-forwarded-host": "floatalpha.example" },
      }),
      external,
    ),
  ).toThrow();
  expect(() =>
    steamCallbackRequestURL(
      new Request(request.url, { headers: { host: "evil.example" } }),
      external,
    ),
  ).toThrow();
  expect(() =>
    steamCallbackRequestURL(
      new Request(external + "/api/auth/steam/callback", {
        headers: { host: "evil.example" },
      }),
      external,
    ),
  ).toThrow();
});
