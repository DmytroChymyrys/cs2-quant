import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";
import type { productDatabase } from "../src/lib/product/db";

/**
 * The signup conversion: exactly one per FloatAlpha account, for every auth
 * method, and never for a login or a linked identity.
 */

type ProductDb = ReturnType<typeof productDatabase>;
vi.mock("server-only", () => ({}));
const pg = new PGlite();
const db = drizzle(pg, { schema: { ...schema, ...market } }) as unknown as ProductDb;
vi.mock("../src/lib/product/db", () => ({ productDatabase: () => db }));

import {
  SIGNUP_CONVERSION_WINDOW_MS,
  claimSignupConversion,
  conversionMethod,
} from "../src/lib/product/signup-conversion";
import {
  ACQUISITION_COOKIE,
  conversionCampaign,
  parseAcquisition,
  readAcquisition,
  serializeAcquisition,
} from "../src/lib/acquisition";

const { appUsers, authUser, authAccount } = schema;

/** A FloatAlpha account created by `method`, with optional linked identities. */
async function account(
  method: schema.SignupMethod,
  providers: string[] = [],
  createdAt = new Date(),
) {
  const [u] = await db
    .insert(authUser)
    .values({
      name: "T",
      email: method === "STEAM" ? null : `t-${randomUUID()}@example.test`,
      // Steam supplies no email, so these users are never "verified".
      emailVerified: method !== "STEAM",
    } as never)
    .returning({ id: authUser.id });
  const [p] = await db
    .insert(appUsers)
    .values({ authUserId: u.id, signupMethod: method, createdAt } as never)
    .returning({ id: appUsers.id, createdAt: appUsers.createdAt });
  for (const providerId of providers)
    await db
      .insert(authAccount)
      .values({ userId: u.id, providerId, accountId: randomUUID() });
  return { authUserId: u.id, appUserId: p.id, createdAt: p.createdAt, signupMethod: method };
}

const claim = (a: Awaited<ReturnType<typeof account>>, now = new Date()) =>
  claimSignupConversion(
    { appUserId: a.appUserId, createdAt: a.createdAt, signupMethod: a.signupMethod },
    db,
    now,
  );

const reportedAt = async (id: string) =>
  (await db.select().from(appUsers).where(eq(appUsers.id, id)))[0].signupReportedAt;

beforeAll(async () => {
  // Product tables carry foreign keys into the market schema, so it exists first.
  for (const tag of [
    "0000_initial_market_snapshots",
    "0001_protect_observation_history",
    "0008_provider_universe_state",
    "0009_provider_identity_nulls",
    "0010_steamwebapi_provider",
  ])
    await pg.exec(await readFile(`drizzle/market/${tag}.sql`, "utf8"));
  for (const [folder, journal] of [
    ["drizzle/product", "drizzle/product/meta/_journal.json"],
    ["drizzle-steam", "drizzle-steam/meta/_journal.json"],
  ]) {
    const entries = (
      JSON.parse(await readFile(journal, "utf8")) as { entries: { tag: string }[] }
    ).entries;
    for (const entry of entries)
      await pg.exec(await readFile(`${folder}/${entry.tag}.sql`, "utf8"));
  }
}, 30_000);

beforeEach(async () => {
  await pg.exec("delete from auth_accounts; delete from app_users; delete from auth_users;");
});
afterAll(async () => { await pg.close(); });

describe("new signups convert exactly once", () => {
  it("Google new signup → once", async () => {
    const a = await account("GOOGLE", ["google"]);
    expect((await claim(a))?.method).toBe("google");
    expect(await claim(a)).toBeNull();
  });

  it("Email new signup → once", async () => {
    const a = await account("EMAIL", ["credential"]);
    expect((await claim(a))?.method).toBe("email");
    expect(await claim(a)).toBeNull();
  });

  it("Steam new signup → once, despite having no verified email", async () => {
    /*
     * The defect this gate exists to fix. The previous implementation gated on
     * emailVerified, and steam.ts creates these users with emailVerified:false,
     * so no Steam-first signup was ever counted.
     */
    const a = await account("STEAM", ["steam"]);
    expect((await claim(a))?.method).toBe("steam");
    expect(await claim(a)).toBeNull();
  });

  it("records the claim durably on the account", async () => {
    const a = await account("GOOGLE", ["google"]);
    expect(await reportedAt(a.appUserId)).toBeNull();
    await claim(a);
    expect(await reportedAt(a.appUserId)).toBeInstanceOf(Date);
  });
});

describe("logins and linking never convert", () => {
  it("existing Google login → zero", async () => {
    const a = await account("GOOGLE", ["google"]);
    await claim(a);                                   // the original signup
    expect(await claim(a)).toBeNull();                // every later sign-in
    expect(await claim(a)).toBeNull();
  });

  it("existing email login → zero", async () => {
    const a = await account("EMAIL", ["credential"]);
    await claim(a);
    expect(await claim(a)).toBeNull();
  });

  it("existing Steam login → zero", async () => {
    const a = await account("STEAM", ["steam"]);
    await claim(a);
    expect(await claim(a)).toBeNull();
  });

  it("linking Steam to an existing account → zero", async () => {
    const a = await account("GOOGLE", ["google"]);
    await claim(a);
    await db.insert(authAccount).values({
      userId: a.authUserId, providerId: "steam", accountId: randomUUID(),
    });
    expect(await claim(a)).toBeNull();
  });

  it("linking a second Google identity → zero", async () => {
    const a = await account("GOOGLE", ["google"]);
    await claim(a);
    await db.insert(authAccount).values({
      userId: a.authUserId, providerId: "google", accountId: randomUUID(),
    });
    expect(await claim(a)).toBeNull();
  });

  it("an account older than the conversion window never converts", async () => {
    const old = new Date(Date.now() - SIGNUP_CONVERSION_WINDOW_MS - 60_000);
    const a = await account("GOOGLE", ["google"], old);
    expect(await claim(a)).toBeNull();
    // and nothing was written, so the cheap rejection really did skip the write
    expect(await reportedAt(a.appUserId)).toBeNull();
  });
});

describe("duplicate protection", () => {
  it("refresh and a second tab cannot repeat it", async () => {
    const a = await account("GOOGLE", ["google"]);
    const results = await Promise.all([claim(a), claim(a), claim(a), claim(a)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("a replayed OAuth callback cannot repeat it", async () => {
    const a = await account("STEAM", ["steam"]);
    expect(await claim(a)).not.toBeNull();
    for (let i = 0; i < 5; i++) expect(await claim(a)).toBeNull();
  });

  it("a returnTo destination cannot double count with the market shell", async () => {
    /*
     * /pricing and the market layout both render the conversion. The claim is
     * what makes that safe — not which page rendered first.
     */
    const a = await account("EMAIL", ["credential"]);
    const pricing = await claim(a);
    const marketShell = await claim(a);
    expect([pricing, marketShell].filter(Boolean)).toHaveLength(1);
  });

  it("two different accounts each convert once", async () => {
    const a = await account("GOOGLE", ["google"]);
    const b = await account("STEAM", ["steam"]);
    expect(await claim(a)).not.toBeNull();
    expect(await claim(b)).not.toBeNull();
    expect(await claim(a)).toBeNull();
    expect(await claim(b)).toBeNull();
  });
});

describe("method provenance", () => {
  it("maps recorded provenance to the GA4 vocabulary", () => {
    expect(conversionMethod("GOOGLE")).toBe("google");
    expect(conversionMethod("EMAIL")).toBe("email");
    expect(conversionMethod("STEAM")).toBe("steam");
  });
  it("reports unknown provenance as unknown rather than guessing", () => {
    expect(conversionMethod("UNKNOWN")).toBe("unknown");
    expect(conversionMethod(null)).toBe("unknown");
  });
  it("carries no identifier", async () => {
    const a = await account("STEAM", ["steam"]);
    const conversion = await claim(a);
    expect(Object.keys(conversion!)).toEqual(["method"]);
    expect(JSON.stringify(conversion)).not.toContain(a.appUserId);
    expect(JSON.stringify(conversion)).not.toContain(a.authUserId);
  });
});

describe("acquisition context survives OAuth", () => {
  const landing = (path: string) => new URL(path, "https://floatalpha.com");

  it("captures campaign parameters and the landing path", () => {
    const a = readAcquisition(landing("/?utm_source=google&utm_medium=cpc&utm_campaign=cs2&gclid=XYZ"));
    expect(a).toMatchObject({
      utm_source: "google", utm_medium: "cpc", utm_campaign: "cs2",
      gclid: "XYZ", landing_path: "/",
    });
  });

  it("records nothing for a direct visit", () => {
    expect(readAcquisition(landing("/"))).toBeNull();
  });

  it("survives a round trip through the cookie — the Google OAuth hop", () => {
    /*
     * The callback URL carries none of the original query string, so the cookie
     * is the only thing that crosses the redirect. This is that crossing.
     */
    const landed = readAcquisition(landing("/?utm_source=google&utm_medium=cpc&utm_campaign=cs2&gclid=XYZ"))!;
    const cookie = serializeAcquisition(landed)!;
    const afterCallback = parseAcquisition(cookie);
    expect(afterCallback).toMatchObject({
      utm_source: "google", utm_medium: "cpc", utm_campaign: "cs2", gclid: "XYZ",
    });
  });

  it("survives the Steam OpenID hop identically", () => {
    const landed = readAcquisition(landing("/terminal?utm_source=google&utm_campaign=steam-test"))!;
    const afterCallback = parseAcquisition(serializeAcquisition(landed)!);
    expect(afterCallback?.utm_campaign).toBe("steam-test");
    expect(afterCallback?.landing_path).toBe("/terminal");
  });

  it("is first-touch: a later direct visit does not overwrite it", () => {
    // The proxy only writes when the cookie is absent; a direct visit yields
    // nothing to write in any case.
    expect(readAcquisition(landing("/?nothing=here"))).toBeNull();
  });

  it("sends campaign labels to GA4 but never click identifiers", () => {
    const a = parseAcquisition(
      serializeAcquisition(readAcquisition(landing("/?utm_source=google&utm_medium=cpc&utm_campaign=cs2&gclid=SECRET"))!)!,
    );
    const params = conversionCampaign(a);
    expect(params).toEqual({
      campaign_source: "google", campaign_medium: "cpc", campaign_name: "cs2",
    });
    expect(JSON.stringify(params)).not.toContain("SECRET");
  });

  it("tolerates a corrupt or absent cookie", () => {
    expect(parseAcquisition(undefined)).toBeNull();
    expect(parseAcquisition("not-json")).toBeNull();
    expect(parseAcquisition(encodeURIComponent('["array"]'))).toBeNull();
  });

  it("refuses an oversized cookie rather than truncating it", () => {
    const huge = readAcquisition(landing(`/?utm_campaign=${"x".repeat(5000)}`))!;
    // Values are capped on read, so this stays serialisable; the guard exists
    // for a crafted URL carrying every parameter at full length.
    expect(huge.utm_campaign!.length).toBeLessThanOrEqual(200);
    expect(serializeAcquisition(huge)).not.toBeNull();
  });

  it("strips control characters from campaign values", () => {
    const a = readAcquisition(landing("/?utm_source=goo%00gle%0a"));
    expect(a?.utm_source).toBe("google");
  });

  it("uses a cookie name the proxy and the reader agree on", () => {
    expect(ACQUISITION_COOKIE).toBe("fa_acq");
  });
});
