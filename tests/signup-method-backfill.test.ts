import { beforeAll, afterAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

/**
 * The one-time backfill in drizzle/product/0006_signup_method.sql.
 *
 * Timing evidence is used here and nowhere else in the product: these rows were
 * written before the column existed and nothing else survives that records how
 * they were created. The question is whether it is CONSERVATIVE -- it must
 * answer only when the evidence admits one answer, and say UNKNOWN whenever it
 * does not, because the value is read as acquisition data.
 *
 * The first two fixtures are the real production accounts, with their real
 * offsets.
 */

const db = new PGlite();
const base = "2026-10-01T15:43:02.488Z";
const at = (ms: number) => new Date(Date.parse(base) + ms).toISOString();

/** A user row plus its accounts, created before the column existed. */
async function legacyUser(
  name: string,
  email: string | null,
  userAt: string,
  accounts: { provider: string; at: string }[],
) {
  const [{ id }] = (
    await db.query<{ id: string }>(
      `insert into auth_users(name,email,email_verified,created_at,updated_at)
       values ($1,$2,true,$3,$3) returning id`,
      [name, email, userAt],
    )
  ).rows;
  for (const account of accounts)
    await db.query(
      `insert into auth_accounts(user_id,account_id,provider_id,created_at,updated_at)
       values ($1,$2,$3,$4,$4)`,
      [id, `${name}-${account.provider}`, account.provider, account.at],
    );
  await db.query(
    `insert into app_users(auth_user_id,created_at,updated_at) values ($1,$2,$2)`,
    [id, userAt],
  );
  return id;
}

const methodOf = async (authUserId: string) =>
  (
    await db.query<{ signup_method: string }>(
      `select signup_method from app_users where auth_user_id=$1`,
      [authUserId],
    )
  ).rows[0].signup_method;

const fixtures: Record<string, string> = {};

beforeAll(async () => {
  for (const tag of ["0000_initial_market_snapshots", "0001_protect_observation_history"])
    await db.exec(await readFile(`drizzle/market/${tag}.sql`, "utf8"));
  const entries = (
    JSON.parse(
      await readFile("drizzle/product/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string }[] }
  ).entries;
  // Everything up to, but NOT including, the migration under test.
  for (const entry of entries)
    if (entry.tag !== "0006_signup_method")
      await db.exec(await readFile(`drizzle/product/${entry.tag}.sql`, "utf8"));

  /*
   * The steam stream too, which is what makes auth_users.email nullable. It is
   * applied in production, so a Steam-first legacy row is a real case the
   * backfill must handle rather than one this fixture invented.
   */
  const steam = (
    JSON.parse(
      await readFile("drizzle-steam/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string }[] }
  ).entries;
  for (const entry of steam)
    await db.exec(await readFile(`drizzle-steam/${entry.tag}.sql`, "utf8"));

  // The two real production accounts, at their observed offsets.
  fixtures.canonical = await legacyUser("canonical", "owner@example.test", at(0), [
    { provider: "google", at: at(4) },
    { provider: "steam", at: at(68_629) },
  ]);
  fixtures.admin = await legacyUser("admin", "admin@example.test", at(0), [
    { provider: "credential", at: at(6) },
  ]);
  // A Steam-first account: no email at all, one identity.
  fixtures.steamFirst = await legacyUser("steamfirst", null, at(0), [
    { provider: "steam", at: at(3) },
  ]);

  // Everything below must stay UNKNOWN.
  fixtures.twoAtOnce = await legacyUser("twoatonce", "two@example.test", at(0), [
    { provider: "google", at: at(4) },
    { provider: "credential", at: at(900) },
  ]);
  fixtures.tied = await legacyUser("tied", "tied@example.test", at(0), [
    { provider: "google", at: at(4) },
    { provider: "credential", at: at(4) },
  ]);
  fixtures.lateOnly = await legacyUser("lateonly", "late@example.test", at(0), [
    { provider: "google", at: at(3_600_000) },
  ]);
  fixtures.none = await legacyUser("none", "none@example.test", at(0), []);
  fixtures.unmapped = await legacyUser("unmapped", "other@example.test", at(0), [
    { provider: "github", at: at(4) },
  ]);

  await db.exec(await readFile("drizzle/product/0006_signup_method.sql", "utf8"));
}, 30_000);

afterAll(async () => {
  await db.close();
});

it("assigns a method only where the evidence admits exactly one", async () => {
  // Google 4ms after the user row, Steam a minute later: the link cannot be
  // mistaken for the signup, so this is provably a Google signup.
  expect(await methodOf(fixtures.canonical)).toBe("GOOGLE");
  expect(await methodOf(fixtures.admin)).toBe("EMAIL");
  expect(await methodOf(fixtures.steamFirst)).toBe("STEAM");
});

it("refuses to guess wherever the evidence is not decisive", async () => {
  // Two identities inside the creation window: no way to tell which came first
  // in intent, whatever the millisecond ordering says.
  expect(await methodOf(fixtures.twoAtOnce)).toBe("UNKNOWN");
  // A dead heat: "first" would be a sort order, not a fact.
  expect(await methodOf(fixtures.tied)).toBe("UNKNOWN");
  // Nothing created with the account; whatever this is, it is not evidence of
  // how the account was made.
  expect(await methodOf(fixtures.lateOnly)).toBe("UNKNOWN");
  expect(await methodOf(fixtures.none)).toBe("UNKNOWN");
  // A provider we have never mapped is not silently given a plausible label.
  expect(await methodOf(fixtures.unmapped)).toBe("UNKNOWN");
});

it("is idempotent, and cannot overwrite an established value", async () => {
  // Re-applying the whole migration changes nothing...
  await db.exec(await readFile("drizzle/product/0006_signup_method.sql", "utf8"));
  expect(await methodOf(fixtures.canonical)).toBe("GOOGLE");
  expect(await methodOf(fixtures.admin)).toBe("EMAIL");
  expect(await methodOf(fixtures.twoAtOnce)).toBe("UNKNOWN");

  // ...and after it, the guard is in force.
  await expect(
    db.exec(
      `update app_users set signup_method='STEAM' where auth_user_id='${fixtures.canonical}';`,
    ),
  ).rejects.toThrow(/immutable/);
});
