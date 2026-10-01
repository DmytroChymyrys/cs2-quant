import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";

/**
 * Explicit Connect Google, and the identity rules around it.
 *
 * The product must support one FloatAlpha user holding several provider
 * identities, including more than one from the SAME provider, while a given
 * (provider, subject) pair belongs to exactly one user globally. These exercise
 * that in both directions, plus the security boundary of the LINK challenge.
 */

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
import { STEAM_OPENID } from "../src/lib/product/steam-openid";

const origin = "http://localhost:3341";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
let auth: NonNullable<ReturnType<typeof authService>>;

/* ------------------------------------------------------------- fixtures --- */

const b64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * A Google id token as the product actually consumes it.
 *
 * `getUserInfo` decodes this token rather than verifying it -- the proof of
 * identity on this path is the authorization-code exchange against Google over
 * TLS with the client secret, exactly as on Better Auth's own callback. So an
 * unsigned token is a faithful fixture here, not a shortcut around a check.
 */
const idToken = (sub: string, email: string | null, verified = true) =>
  [
    b64url({ alg: "RS256", kid: "fixture" }),
    b64url({
      iss: "https://accounts.google.com",
      aud: "google-test-client-id",
      sub,
      ...(email ? { email, email_verified: verified } : {}),
      name: "Google Fixture",
      picture: "https://example.test/avatar.png",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    "ZmFrZS1zaWduYXR1cmU",
  ].join(".");

/** The Google identity a given authorization code stands for. */
const codeFor = (sub: string, email: string | null, verified = true) =>
  b64url({ sub, email, verified });

/**
 * Google, as far as this process is concerned.
 *
 * Only the token endpoint is reachable. Anything else is a bug in the flow
 * under test -- a network call we did not intend -- so it fails loudly instead
 * of being quietly satisfied.
 */
const network = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const target = String(typeof url === "object" && "url" in url ? url.url : url);
  if (target === TOKEN_ENDPOINT) {
    const body = new URLSearchParams(String(init?.body));
    const code = body.get("code") ?? "";
    // PKCE must round-trip: Google rejects a mismatched verifier and so does this.
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(body.get("grant_type")).toBe("authorization_code");
    const claim = JSON.parse(Buffer.from(code, "base64url").toString()) as {
      sub: string;
      email: string | null;
      verified: boolean;
    };
    return new Response(
      JSON.stringify({
        token_type: "Bearer",
        access_token: `access-${claim.sub}`,
        refresh_token: `refresh-${claim.sub}`,
        expires_in: 3600,
        scope: "openid email profile",
        id_token: idToken(claim.sub, claim.email, claim.verified),
      }),
      { headers: { "content-type": "application/json" } },
    );
  }
  if (/^https:\/\/steamcommunity\.com\/openid\/id\/\d{17}$/.test(target))
    return new Response(
      `<xrds:XRDS xmlns:xrds="xri://$xrds"><XRD><Service priority="0"><Type>http://specs.openid.net/auth/2.0/signon</Type><URI>${STEAM_OPENID}</URI></Service></XRD></xrds:XRDS>`,
    );
  if (target === STEAM_OPENID)
    return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:true\n`);
  throw new Error(`unexpected network call: ${target}`);
});

/* -------------------------------------------------------------- request --- */

const post = (path: string, body: object, cookie = "", reqOrigin = origin) =>
  new Request(`${origin}/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: reqOrigin, cookie },
    body: JSON.stringify(body),
  });
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
const merge = (...values: string[]) => values.filter(Boolean).join("; ");

async function signUpEmail(email: string) {
  const created = await auth.handler(
    post("sign-up/email", {
      name: "Link Test",
      email,
      password: "Link-Test-Password-123",
      callbackURL: "/onboarding",
    }),
  );
  expect(created.status).toBe(200);
  await auth.handler(new Request(sent.at(-1)!.match(/https?:\/\/\S+/)![0]));
  const login = await auth.handler(
    post("sign-in/email", { email, password: "Link-Test-Password-123" }),
  );
  expect(login.status).toBe(200);
  const body = await login.json();
  return { id: body.user.id as string, cookie: cookies(login) };
}

/* ------------------------------------------------- ordinary Google AUTH --- */

/** Drives a full "Continue with Google" round trip to wherever it lands. */
async function googleSignIn(sub: string, email: string | null, verified = true) {
  const started = await auth.handler(
    post("sign-in/social", { provider: "google", callbackURL: "/continue" }),
  );
  expect(started.status).toBe(200);
  const { url } = await started.json();
  const state = new URL(url).searchParams.get("state")!;
  const jar = cookies(started);
  const landed = await auth.handler(
    new Request(
      `${origin}/api/auth/callback/google?state=${state}&code=${codeFor(sub, email, verified)}`,
      { headers: { cookie: jar } },
    ),
  );
  return {
    location: landed.headers.get("location") ?? "",
    cookie: merge(jar, cookies(landed)),
  };
}

/** Who, if anyone, a jar of cookies is signed in as. */
async function sessionUser(cookie: string) {
  const response = await auth.handler(
    new Request(`${origin}/api/auth/get-session`, { headers: { cookie } }),
  );
  const body = await response.json().catch(() => null);
  return body?.user?.id ?? null;
}

/* -------------------------------------------------------- explicit LINK --- */

async function beginLink(user: { cookie: string }, flow = "settings") {
  const response = await auth.handler(post("google/link", { flow }, user.cookie));
  expect(response.status).toBe(200);
  const { url } = await response.json();
  return {
    authorize: new URL(url),
    cookie: merge(user.cookie, cookies(response)),
  };
}

const linkCallback = (state: string, code: string, cookie: string) =>
  auth.handler(
    new Request(
      `${origin}/api/auth/google/link/callback?state=${state}&code=${code}`,
      { headers: { cookie } },
    ),
  );

/** Begins and completes one explicit connect, returning the outcome status. */
async function link(
  user: { cookie: string },
  sub: string,
  email: string | null,
  verified = true,
) {
  const started = await beginLink(user);
  const response = await linkCallback(
    started.authorize.searchParams.get("state")!,
    codeFor(sub, email, verified),
    started.cookie,
  );
  const location = response.headers.get("location") ?? "";
  return { status: new URL(location, origin).searchParams.get("google"), location };
}

/* ----------------------------------------------------------------- state --- */

const counts = async () => {
  const [row] = (
    await db.query<{
      auth_users: number;
      auth_accounts: number;
      app_users: number;
    }>(`select (select count(*)::int from auth_users) auth_users,
               (select count(*)::int from auth_accounts) auth_accounts,
               (select count(*)::int from app_users) app_users`)
  ).rows;
  return row;
};
const accountsOf = async (userId: string) =>
  (
    await db.query<{ provider_id: string; account_id: string }>(
      `select provider_id, account_id from auth_accounts where user_id=$1
       order by provider_id, account_id`,
      [userId],
    )
  ).rows;
const authUserRow = async (userId: string) =>
  (
    await db.query<{ email: string | null; name: string }>(
      `select email, name from auth_users where id=$1`,
      [userId],
    )
  ).rows[0];
const signupMethodOf = async (authUserId: string) =>
  (
    await db.query<{ signup_method: string }>(
      `select signup_method from app_users where auth_user_id=$1`,
      [authUserId],
    )
  ).rows[0]?.signup_method ?? null;

beforeAll(async () => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "google-link-test-secret-isolated-not-a-real-credential-1234",
  );
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("PRODUCT_DATABASE_URL", "postgresql://unused/google_link_test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-test-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-test-client-secret");
  vi.stubEnv("STEAM_ACCOUNT_LINKING_ENABLED", "true");
  vi.stubEnv("FLOATALPHA_DEMO_PREVIEW", "false");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  for (const tag of ["0000_initial_market_snapshots", "0001_protect_observation_history"])
    await db.exec(await readFile(`drizzle/market/${tag}.sql`, "utf8"));
  /*
   * Both streams read from their journals rather than named here, so a
   * migration added later cannot be silently missing from the schema under
   * test. That omission is exactly how the nullable-email change was missed.
   */
  for (const [folder, journal] of [
    ["drizzle/product", "drizzle/product/meta/_journal.json"],
    ["drizzle-steam", "drizzle-steam/meta/_journal.json"],
  ]) {
    const entries = (
      JSON.parse(await readFile(journal, "utf8")) as { entries: { tag: string }[] }
    ).entries;
    for (const entry of entries)
      await db.exec(await readFile(`${folder}/${entry.tag}.sql`, "utf8"));
  }
  auth = authService()!;
}, 30_000);

beforeEach(async () => {
  // The suite drives far more auth traffic than one person ever would; the
  // limiter is exercised on its own rather than throttling every other test.
  await db.exec("delete from auth_rate_limits;");
  network.mockClear();
  vi.stubGlobal("fetch", network);
});
afterAll(async () => {
  await db.close();
});

it("B. an authenticated user explicitly links a Google identity whose email differs", async () => {
  const user = await signUpEmail("b-owner@example.test");
  const before = await counts();
  expect(await link(user, "G-b-1", "completely-different@gmail.test")).toMatchObject({
    status: "connected",
  });
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
    { provider_id: "google", account_id: "G-b-1" },
  ]);
  const after = await counts();
  expect(after.auth_users).toBe(before.auth_users);
  expect(after.app_users).toBe(before.app_users);
  expect(after.auth_accounts).toBe(before.auth_accounts + 1);
  // The local address is the account's own and is never replaced by Google's.
  expect((await authUserRow(user.id)).email).toBe("b-owner@example.test");
});

/* ------------------------------------------------------ Steam-first user --- */

const ns = "http://specs.openid.net/auth/2.0";
/** A signed-looking Steam assertion for `returnTo`. The verifier is mocked. */
function steamAssertion(returnTo: string, steamId: string) {
  const url = new URL(returnTo);
  const fields: Record<string, string> = {
    ns,
    mode: "id_res",
    op_endpoint: STEAM_OPENID,
    claimed_id: `https://steamcommunity.com/openid/id/${steamId}`,
    identity: `https://steamcommunity.com/openid/id/${steamId}`,
    return_to: returnTo,
    response_nonce:
      new Date().toISOString().replace(/\.\d{3}Z$/, "Z") + crypto.randomUUID(),
    assoc_handle: "fixture-handle",
    signed:
      "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    sig: "c2lnbmF0dXJl",
  };
  for (const [key, value] of Object.entries(fields))
    url.searchParams.set(`openid.${key}`, value);
  return url;
}

/**
 * A user created by Steam sign-in, which is the only way to get an account
 * with no email address at all.
 */
async function steamFirstUser(steamId: string) {
  const started = await auth.handler(post("steam/auth", {}));
  const { url } = await started.json();
  const returnTo = new URL(url).searchParams.get("openid.return_to")!;
  let jar = cookies(started);
  const landed = await auth.handler(
    new Request(steamAssertion(returnTo, steamId), { headers: { cookie: jar } }),
  );
  expect(landed.headers.get("location")).toBe("/steam/choose");
  jar = merge(jar, cookies(landed));
  const created = await auth.handler(post("steam/create-account", {}, jar));
  expect(created.status).toBe(200);
  jar = merge(jar, cookies(created));
  const id = await sessionUser(jar);
  expect(id).toBeTruthy();
  return { id: id as string, cookie: jar };
}

/* =========================================================== A - Q ======= */

it("A. a matching verified email does not implicitly link during ordinary sign-in", async () => {
  const user = await signUpEmail("a-owner@example.test");
  const before = await counts();
  // Google asserts the SAME address, from a subject nobody has ever linked.
  const landed = await googleSignIn("G-a-unknown", "a-owner@example.test");
  expect(landed.location).toContain("account_not_linked");
  /*
   * And it lands somewhere that can explain itself, rather than on Better
   * Auth's bare error page. The destination is set server-side, so no caller
   * can forget to ask for it.
   */
  expect(landed.location).toContain("/login");
  expect(await sessionUser(landed.cookie)).not.toBe(user.id);
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
  ]);
  /*
   * Nothing was created either. An address is a claim a provider makes about a
   * person; it is not proof that the person at the keyboard controls this
   * FloatAlpha account, so it neither links nor silently forks a second one.
   */
  expect(await counts()).toEqual(before);
});

it("ordinary Google sign-in also forces the account chooser", async () => {
  const started = await auth.handler(
    post("sign-in/social", { provider: "google", callbackURL: "/continue" }),
  );
  const authorize = new URL((await started.json()).url);
  /*
   * The production incident happened HERE, not in Connect Google: a signed-in
   * Google session was reused silently and a second FloatAlpha account was
   * created for an identity the person did not mean to use.
   *
   * This is UX protection only. Authorization rests on the provider subject
   * returned through the code exchange; suppressing the chooser would grant
   * nobody anything, which is exactly why it is safe to rely on it for
   * accident-prevention and wrong to rely on it for anything else.
   */
  expect(authorize.searchParams.get("prompt")).toBe("select_account");
  expect(authorize.origin + authorize.pathname).toBe(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
});

it("C. a Steam-created user with no email address can explicitly link Google", async () => {
  const user = await steamFirstUser("76561197960287940");
  expect((await authUserRow(user.id)).email).toBeNull();
  expect(await signupMethodOf(user.id)).toBe("STEAM");
  const before = await counts();

  expect(await link(user, "G-c-1", "somebody@example.com")).toMatchObject({
    status: "connected",
  });

  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "google", account_id: "G-c-1" },
    { provider_id: "steam", account_id: "76561197960287940" },
  ]);
  const after = await counts();
  expect(after.auth_users).toBe(before.auth_users); // H
  expect(after.app_users).toBe(before.app_users); // I
  expect(after.auth_accounts).toBe(before.auth_accounts + 1);
  // J: Google's address is NOT copied in. Adopting a contact address is a
  // separate product decision, not a side effect of connecting an identity.
  expect((await authUserRow(user.id)).email).toBeNull();
  expect(await signupMethodOf(user.id)).toBe("STEAM"); // K
});

it("C+G. the Steam-first user then signs in through that Google identity", async () => {
  const user = await steamFirstUser("76561197960287941");
  expect(await link(user, "G-c2-1", "steam-first@example.com")).toMatchObject({
    status: "connected",
  });
  const before = await counts();
  // Signed out entirely: a brand new jar, no session cookie at all.
  const landed = await googleSignIn("G-c2-1", "steam-first@example.com");
  expect(await sessionUser(landed.cookie)).toBe(user.id);
  // Signing in creates a session and nothing else.
  expect(await counts()).toEqual(before);
});

it("D. a Google identity owned by another user is refused, and nothing moves", async () => {
  const first = await signUpEmail("d-first@example.test");
  const second = await signUpEmail("d-second@example.test");
  expect(await link(first, "G-d-shared", "shared@example.test")).toMatchObject({
    status: "connected",
  });
  const before = await counts();

  expect(await link(second, "G-d-shared", "shared@example.test")).toMatchObject({
    status: "conflict",
  });

  // The identity did not move, no row was added, no account was merged.
  expect(await accountsOf(first.id)).toEqual([
    { provider_id: "credential", account_id: first.id },
    { provider_id: "google", account_id: "G-d-shared" },
  ]);
  expect(await accountsOf(second.id)).toEqual([
    { provider_id: "credential", account_id: second.id },
  ]);
  expect(await counts()).toEqual(before);
});

it("E. linking an identity this account already holds is idempotent", async () => {
  const user = await signUpEmail("e-owner@example.test");
  expect(await link(user, "G-e-1", "e@example.test")).toMatchObject({
    status: "connected",
  });
  const before = await counts();
  expect(await link(user, "G-e-1", "e@example.test")).toMatchObject({
    status: "connected",
  });
  // Reported as connected, with no duplicate row.
  expect(await counts()).toEqual(before);
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
    { provider_id: "google", account_id: "G-e-1" },
  ]);
});

it("F+G. one user may hold two Google identities, and either one signs them in", async () => {
  const user = await signUpEmail("f-owner@example.test");
  expect(await link(user, "G-f-1", "first@gmail.test")).toMatchObject({
    status: "connected",
  });
  expect(await link(user, "G-f-2", "second@company.test")).toMatchObject({
    status: "connected",
  });
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
    { provider_id: "google", account_id: "G-f-1" },
    { provider_id: "google", account_id: "G-f-2" },
  ]);
  // Both resolve to the same FloatAlpha user. There is no one-Google-per-user
  // rule; the invariant is one (provider, subject) to at most one user.
  expect(await sessionUser((await googleSignIn("G-f-1", "first@gmail.test")).cookie)).toBe(user.id);
  expect(await sessionUser((await googleSignIn("G-f-2", "second@company.test")).cookie)).toBe(user.id);
  expect(await signupMethodOf(user.id)).toBe("EMAIL"); // K: unchanged by either link
});

/* ------------------------------------------- the LINK challenge itself --- */

it("L. an expired LINK challenge is refused", async () => {
  const user = await signUpEmail("l-owner@example.test");
  const started = await beginLink(user);
  await db.exec(
    "update auth_verifications set expires_at = now() - interval '1 hour' where identifier like 'google-link:%';",
  );
  const response = await linkCallback(
    started.authorize.searchParams.get("state")!,
    codeFor("G-l-1", "l@example.test"),
    started.cookie,
  );
  expect(response.headers.get("location")).toContain("google=failed");
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
  ]);
  // Refused before any token was requested: an expired challenge never reaches Google.
  expect(network).not.toHaveBeenCalled();
});

it("M. a replayed LINK callback is refused", async () => {
  const user = await signUpEmail("m-owner@example.test");
  const started = await beginLink(user);
  const state = started.authorize.searchParams.get("state")!;
  const code = codeFor("G-m-1", "m@example.test");
  const first = await linkCallback(state, code, started.cookie);
  expect(first.headers.get("location")).toContain("google=connected");
  const before = await counts();

  const replay = await linkCallback(state, code, started.cookie);

  expect(replay.headers.get("location")).toContain("google=failed");
  expect(await counts()).toEqual(before);
});

it("N. a LINK challenge cannot be completed from another session", async () => {
  const user = await signUpEmail("n-owner@example.test");
  const intruder = await signUpEmail("n-intruder@example.test");
  const started = await beginLink(user);
  // The challenge cookie, carried into somebody else's session.
  const challengeCookie = started.cookie
    .split("; ")
    .filter((c) => c.includes("google_link"))
    .join("; ");
  expect(challengeCookie).toBeTruthy();

  const response = await linkCallback(
    started.authorize.searchParams.get("state")!,
    codeFor("G-n-1", "n@example.test"),
    merge(intruder.cookie, challengeCookie),
  );

  expect(response.headers.get("location")).toContain("google=failed");
  // Neither account gained the identity: the challenge is bound to the user
  // AND the session that began it, not merely to the browser.
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
  ]);
  expect(await accountsOf(intruder.id)).toEqual([
    { provider_id: "credential", account_id: intruder.id },
  ]);
});

it("N3. a known state is worthless without the challenge cookie", async () => {
  const user = await signUpEmail("n3-owner@example.test");
  const started = await beginLink(user);
  /*
   * The right person, the right session, the right state -- and no challenge
   * cookie. A state value can leak: it travels in a URL, through Google, and
   * into referrers and logs. The signed HttpOnly cookie is what makes knowing
   * it insufficient, so that binding is tested on its own rather than only
   * alongside the session checks.
   */
  const response = await linkCallback(
    started.authorize.searchParams.get("state")!,
    codeFor("G-n3-1", "n3@example.test"),
    user.cookie,
  );
  expect(response.headers.get("location")).toContain("google=failed");
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
  ]);
  expect(network).not.toHaveBeenCalled();
});

it("N2. signing out and back in mid-flow invalidates the challenge", async () => {
  const user = await signUpEmail("n2-owner@example.test");
  const started = await beginLink(user);
  // Same person, same browser, but a different session id than the one bound.
  const again = await auth.handler(
    post("sign-in/email", {
      email: "n2-owner@example.test",
      password: "Link-Test-Password-123",
    }),
  );
  const challengeCookie = started.cookie
    .split("; ")
    .filter((c) => c.includes("google_link"))
    .join("; ");
  // Guard the fixture: an empty cookie would make this pass for the wrong reason.
  expect(challengeCookie).toBeTruthy();
  const response = await linkCallback(
    started.authorize.searchParams.get("state")!,
    codeFor("G-n2-1", "n2@example.test"),
    merge(cookies(again), challengeCookie),
  );
  expect(response.headers.get("location")).toContain("google=failed");
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
  ]);
});

it("O. an ordinary Google sign-in state cannot be spent as a LINK", async () => {
  const user = await signUpEmail("o-owner@example.test");
  const signIn = await auth.handler(
    post("sign-in/social", { provider: "google", callbackURL: "/continue" }),
  );
  const authState = new URL((await signIn.json()).url).searchParams.get("state")!;
  const started = await beginLink(user);
  const linkState = started.authorize.searchParams.get("state")!;
  expect(authState).not.toBe(linkState);

  // A real LINK cookie, but the AUTH challenge's state.
  const crossed = await linkCallback(
    authState,
    codeFor("G-o-1", "o@example.test"),
    started.cookie,
  );
  expect(crossed.headers.get("location")).toContain("google=failed");
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
  ]);

  /*
   * And the refusal was the crossing, not a broken fixture: the same cookie
   * with its OWN state still completes. The challenge was never consumed by
   * the failed attempt.
   */
  const honest = await linkCallback(
    linkState,
    codeFor("G-o-1", "o@example.test"),
    started.cookie,
  );
  expect(honest.headers.get("location")).toContain("google=connected");
});

it("P. a LINK state cannot be spent as an ordinary Google sign-in", async () => {
  const user = await signUpEmail("p-owner@example.test");
  const started = await beginLink(user);
  const linkState = started.authorize.searchParams.get("state")!;
  const before = await counts();

  const landed = await auth.handler(
    new Request(
      `${origin}/api/auth/callback/google?state=${linkState}&code=${codeFor("G-p-1", "p@example.test")}`,
      { headers: { cookie: started.cookie } },
    ),
  );

  // Better Auth does not recognise our identifier, so there is no sign-in and
  // no account: the two challenge namespaces do not overlap.
  expect(landed.headers.get("location") ?? "").not.toContain("/continue");
  expect(await counts()).toEqual(before);
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "credential", account_id: user.id },
  ]);
});

it("Q. two users racing for one Google identity produce exactly one owner", async () => {
  const first = await signUpEmail("q-first@example.test");
  const second = await signUpEmail("q-second@example.test");
  const a = await beginLink(first);
  const b = await beginLink(second);
  const code = codeFor("G-q-contested", "contested@example.test");

  const [one, two] = await Promise.all([
    linkCallback(a.authorize.searchParams.get("state")!, code, a.cookie),
    linkCallback(b.authorize.searchParams.get("state")!, code, b.cookie),
  ]);

  const outcomes = [one, two].map(
    (r) => new URL(r.headers.get("location")!, origin).searchParams.get("google"),
  );
  expect(outcomes.filter((s) => s === "connected")).toHaveLength(1);
  expect(outcomes.filter((s) => s === "conflict")).toHaveLength(1);
  const rows = await db.query<{ n: number }>(
    "select count(*)::int n from auth_accounts where provider_id='google' and account_id='G-q-contested'",
  );
  expect(rows.rows[0].n).toBe(1);
});

it("the database is the final arbiter: one (provider, subject) globally", async () => {
  const [index] = (
    await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname='auth_provider_subject'",
    )
  ).rows;
  expect(index.indexdef).toContain("UNIQUE");
  expect(index.indexdef).toMatch(/provider_id/);
  expect(index.indexdef).toMatch(/account_id/);
  // And deliberately NO one-google-per-user rule: several Google identities
  // may belong to one user. Only Steam is restricted to one per account.
  const names = (
    await db.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename='auth_accounts'",
    )
  ).rows.map((r) => r.indexname);
  expect(names).toContain("auth_one_steam_per_user");
  expect(names).not.toContain("auth_one_google_per_user");
});

/* ------------------------------------------------- beginning the flow ---- */

it("the LINK start refuses a foreign origin and an anonymous caller", async () => {
  const user = await signUpEmail("origin-owner@example.test");
  const foreign = await auth.handler(
    post("google/link", { flow: "settings" }, user.cookie, "https://evil.test"),
  );
  expect(foreign.status).toBe(403);
  const anonymous = await auth.handler(post("google/link", { flow: "settings" }));
  expect(anonymous.status).toBe(401);
});

it("the authorization request forces Google's account chooser and carries PKCE", async () => {
  const user = await signUpEmail("chooser-owner@example.test");
  const { authorize, cookie } = await beginLink(user);
  /*
   * Pinned deliberately. A signed-in Google session being reused silently is
   * how the wrong identity was once attached to a new account; someone
   * connecting a second Google identity is by definition not using the one the
   * browser already holds. This is UX protection, not a security control --
   * the controls are the session, the single-use state and the ownership check.
   */
  expect(authorize.searchParams.get("prompt")).toBe("select_account");
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
  expect(authorize.searchParams.get("redirect_uri")).toBe(
    `${origin}/api/auth/google/link/callback`,
  );
  expect(authorize.origin + authorize.pathname).toBe(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  expect(cookie).toContain("google_link");
});

it("the challenge cookie is HttpOnly, Lax and short lived", async () => {
  const user = await signUpEmail("cookie-owner@example.test");
  const response = await auth.handler(
    post("google/link", { flow: "settings" }, user.cookie),
  );
  const set = response.headers.getSetCookie().find((c) => c.includes("google_link"))!;
  expect(set).toContain("HttpOnly");
  expect(set).toContain("SameSite=Lax");
  expect(set).toMatch(/Max-Age=600\b/);
});

/* --------------------------------------------------- signup provenance --- */

it("every creation path records how the account was created", async () => {
  const byEmail = await signUpEmail("provenance-email@example.test");
  expect(await signupMethodOf(byEmail.id)).toBe("EMAIL");

  const byGoogle = await googleSignIn("G-prov-1", "provenance-google@example.test");
  const googleId = (await sessionUser(byGoogle.cookie)) as string;
  expect(googleId).toBeTruthy();
  expect(await signupMethodOf(googleId)).toBe("GOOGLE");

  const bySteam = await steamFirstUser("76561197960287942");
  expect(await signupMethodOf(bySteam.id)).toBe("STEAM");
});

it("connecting identities never rewrites how the account was created", async () => {
  /*
   * The canonical production shape: a Google signup that later connects Steam
   * and a second Google identity. It stays a Google signup throughout --
   * otherwise acquisition numbers would drift every time somebody linked
   * something.
   */
  const landed = await googleSignIn("G-canonical", "canonical@example.test");
  const user = { id: (await sessionUser(landed.cookie)) as string, cookie: landed.cookie };
  expect(await signupMethodOf(user.id)).toBe("GOOGLE");

  const steam = await auth.handler(post("steam/link", { flow: "settings" }, user.cookie));
  const returnTo = new URL((await steam.json()).url).searchParams.get("openid.return_to")!;
  const steamJar = merge(user.cookie, cookies(steam));
  const connected = await auth.handler(
    new Request(steamAssertion(returnTo, "76561197960287943"), {
      headers: { cookie: steamJar },
    }),
  );
  expect(connected.headers.get("location")).toContain("steam=connected");
  expect(await link(user, "G-canonical-2", "second-identity@example.test")).toMatchObject(
    { status: "connected" },
  );

  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "google", account_id: "G-canonical" },
    { provider_id: "google", account_id: "G-canonical-2" },
    { provider_id: "steam", account_id: "76561197960287943" },
  ]);
  expect(await signupMethodOf(user.id)).toBe("GOOGLE");
});

it("the database refuses to change a recorded signup method", async () => {
  const user = await signUpEmail("immutable@example.test");
  expect(await signupMethodOf(user.id)).toBe("EMAIL");
  await expect(
    db.exec(
      `update app_users set signup_method='STEAM' where auth_user_id='${user.id}';`,
    ),
  ).rejects.toThrow(/immutable/);
  expect(await signupMethodOf(user.id)).toBe("EMAIL");
  // Unrelated updates to the same row are unaffected.
  await db.exec(
    `update app_users set onboarded=true where auth_user_id='${user.id}';`,
  );
  expect(await signupMethodOf(user.id)).toBe("EMAIL");
});

it("an UNKNOWN provenance may be established once, then is fixed", async () => {
  /*
   * A legacy row, as the backfill leaves one whose provenance could not be
   * established. Evidence found later may fill it in exactly once; after that
   * it is as immutable as any other value, so a second opinion cannot overwrite
   * the first.
   */
  const [{ id }] = (
    await db.query<{ id: string }>(
      `insert into auth_users(name,email,email_verified) values ('Legacy','legacy@example.test',true) returning id`,
    )
  ).rows;
  await db.query(`insert into app_users(auth_user_id) values ($1)`, [id]);
  expect(await signupMethodOf(id)).toBe("UNKNOWN");

  await db.query(`update app_users set signup_method='GOOGLE' where auth_user_id=$1`, [id]);
  expect(await signupMethodOf(id)).toBe("GOOGLE");

  await expect(
    db.exec(`update app_users set signup_method='EMAIL' where auth_user_id='${id}';`),
  ).rejects.toThrow(/immutable/);
  // Nor can it be erased back to UNKNOWN once it means something.
  await expect(
    db.exec(`update app_users set signup_method='UNKNOWN' where auth_user_id='${id}';`),
  ).rejects.toThrow(/immutable/);
  expect(await signupMethodOf(id)).toBe("GOOGLE");
});

it("only the four known methods are storable", async () => {
  const user = await signUpEmail("checked@example.test");
  await expect(
    db.exec(
      `update app_users set signup_method='FACEBOOK' where auth_user_id='${user.id}';`,
    ),
  ).rejects.toThrow();
});

/* ------------------------------------------------------------ unlinking --- */

const accountRowId = async (userId: string, provider: string, subject: string) =>
  (
    await db.query<{ id: string }>(
      `select id from auth_accounts where user_id=$1 and provider_id=$2 and account_id=$3`,
      [userId, provider, subject],
    )
  ).rows[0].id;

it("a second Google identity may be removed, but never the last way in", async () => {
  const user = await steamFirstUser("76561197960287944");
  expect(await link(user, "G-u-1", "one@example.test")).toMatchObject({
    status: "connected",
  });
  expect(await link(user, "G-u-2", "two@example.test")).toMatchObject({
    status: "connected",
  });

  // Two Google identities plus Steam: removing one leaves a way in.
  const first = await auth.handler(
    post(
      "unlink-account",
      { accountId: await accountRowId(user.id, "google", "G-u-1") },
      user.cookie,
    ),
  );
  expect(first.status).toBe(200);

  /*
   * Now Google is the only primary method, with Steam alongside. Removing it
   * would leave an account reachable by Steam alone and with no email address
   * to recover through, so it is refused.
   */
  const last = await auth.handler(
    post(
      "unlink-account",
      { accountId: await accountRowId(user.id, "google", "G-u-2") },
      user.cookie,
    ),
  );
  expect(last.status).toBe(400);
  expect((await last.json()).code).toBe("LAST_LOGIN_METHOD");
  expect(await accountsOf(user.id)).toEqual([
    { provider_id: "google", account_id: "G-u-2" },
    { provider_id: "steam", account_id: "76561197960287944" },
  ]);
});

it("unlinking never disturbs how the account was created", async () => {
  const user = await signUpEmail("unlink-provenance@example.test");
  expect(await link(user, "G-u-3", "three@example.test")).toMatchObject({
    status: "connected",
  });
  const removed = await auth.handler(
    post(
      "unlink-account",
      { accountId: await accountRowId(user.id, "google", "G-u-3") },
      user.cookie,
    ),
  );
  expect(removed.status).toBe(200);
  expect(await signupMethodOf(user.id)).toBe("EMAIL");
});
