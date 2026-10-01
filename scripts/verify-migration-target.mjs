/**
 * Proves PRODUCT_DATABASE_URL points at the intended production database.
 *
 * Run this BEFORE `npm run db:migrate:product:plan` against production:
 *
 *   PRODUCT_DATABASE_URL="<production DATABASE_URL>" \
 *     node scripts/verify-migration-target.mjs
 *
 * STRICTLY READ ONLY. It issues SELECTs and nothing else: it never migrates,
 * repairs, normalises or writes, and it never invokes the migrator. Its only
 * output is a verdict and an exit code.
 *
 * It prints no credential. The connection string is reduced to a host and a
 * database name before anything is shown.
 *
 * WHY IT EXISTS
 * -------------
 * `.env.steam-preview.local` defines its own PRODUCT_DATABASE_URL aimed at the
 * steam-acceptance Neon project. Sourcing it during a migration would migrate
 * the wrong database -- and the migration would SUCCEED there, so the mistake
 * would be silent. "Do not load that file" is a procedure, and procedures fail
 * quietly. This proves the target from its DATA instead.
 *
 * Note that a shape check alone is not enough: the acceptance database has the
 * same product tables. Only the data fingerprints and the host rule separate
 * them.
 *
 * It deliberately does NOT read any .env file. The connection string must be
 * supplied by the operator on the command line, so this script can never be
 * the thing that loads the wrong environment.
 *
 * DELIBERATELY NOT REUSABLE
 * -------------------------
 * This asserts that the target is THIS production environment, today. Do not
 * relax a check to make it pass elsewhere -- that removes the only thing it is
 * for. A different environment needs its own fingerprints, not weaker ones.
 *
 * Every probe fails closed. An unexpected database makes queries throw (a
 * missing schema, a missing table); if that aborted the script the operator
 * would see a stack trace rather than a verdict, and a stack trace reads like a
 * tooling glitch you retry instead of a refusal you obey. A failed probe is a
 * FAILED CHECK, and the script always prints a verdict and exits non-zero.
 */
import { Pool } from "pg";

/**
 * Pinned. If a probe is ever removed or silently skipped, the run fails rather
 * than reporting success over a smaller set of evidence.
 */
const EXPECTED_CHECKS = 8;

const stop = (message) => {
  console.error(`\n  STOP — ${message}\n`);
  process.exit(1);
};

const url = process.env.PRODUCT_DATABASE_URL;
if (!url)
  stop(
    "PRODUCT_DATABASE_URL is not set. Supply it explicitly; this script reads no .env file.",
  );

let host, database;
try {
  const parsed = new URL(url);
  host = parsed.hostname;
  database = parsed.pathname.slice(1);
} catch {
  stop("PRODUCT_DATABASE_URL is not a parseable connection string");
}

/** Databases this command must never migrate, by host fragment. */
const FORBIDDEN = [
  {
    fragment: "ep-bold-darkness-auk5wz7m",
    name: "steam-acceptance (silent-butterfly-32405129)",
  },
];

const checks = [];
const check = (name, ok, detail) =>
  checks.push({ name, ok, detail: String(detail) });

const forbidden = FORBIDDEN.find((f) => host.includes(f.fragment));
check(
  "host is not a known non-production database",
  !forbidden,
  forbidden ? `REFUSED: ${forbidden.name}` : host,
);

const pool = new Pool({
  connectionString: url,
  max: 2,
  connectionTimeoutMillis: 15000,
});
const q = async (text, params) => (await pool.query(text, params)).rows;

/** Runs one probe. Any failure becomes a failed check, never an exception. */
const probe = async (name, fn) => {
  try {
    const { ok, detail } = await fn();
    check(name, ok, detail);
  } catch (error) {
    check(
      name,
      false,
      `probe failed: ${error?.code ?? ""} ${error?.message ?? error}`.trim(),
    );
  }
};

try {
  await probe(
    "co-located streams present (drizzle, drizzle_product, drizzle_steam)",
    async () => {
      const want = ["drizzle", "drizzle_product", "drizzle_steam"];
      const got = (
        await q(
          `select schema_name from information_schema.schemata where schema_name = any($1)`,
          [want],
        )
      ).map((r) => r.schema_name);
      return {
        ok: want.every((s) => got.includes(s)),
        detail: got.sort().join(", ") || "none",
      };
    },
  );

  await probe(
    "market and product tables co-located (production shape)",
    async () => {
      const [t] = await q(`select
        (select count(*)::int from information_schema.tables
          where table_schema='public'
            and table_name in ('assets','market_observations','collector_runs')) as market,
        (select count(*)::int from information_schema.tables
          where table_schema='public'
            and table_name in ('auth_users','auth_accounts','app_users')) as product`);
      return {
        ok: t.market === 3 && t.product === 3,
        detail: `${t.market}/3 market, ${t.product}/3 product`,
      };
    },
  );

  await probe("tracked universe is the production universe (150)", async () => {
    const [r] = await q(`select count(*)::int n from assets where is_tracked`);
    return { ok: r.n === 150, detail: `${r.n} tracked assets` };
  });

  await probe(
    "substantial observation history (not an empty or seeded database)",
    async () => {
      const [r] = await q(`select count(*)::int n from market_observations`);
      return { ok: r.n > 100000, detail: `${r.n} observations` };
    },
  );

  await probe("expected production auth_user boundary", async () => {
    const ids = (
      await q(`select id::text from auth_users order by created_at`)
    ).map((r) => r.id);
    const expect = ["28e9", "9ca0"];
    return {
      ok: ids.length === 2 && expect.every((p, i) => ids[i]?.startsWith(p)),
      detail:
        ids.map((i) => `${i.slice(0, 4)}…${i.slice(-4)}`).join(", ") || "none",
    };
  });

  await probe("expected provider identities present", async () => {
    const rows = await q(
      `select provider_id, account_id from auth_accounts order by created_at`,
    );
    const want = [
      ["credential", null],
      ["google", "1015"],
      ["steam", "7656"],
    ];
    return {
      ok:
        rows.length === 3 &&
        want.every(
          ([provider, subject], i) =>
            rows[i]?.provider_id === provider &&
            (subject === null || rows[i].account_id.startsWith(subject)),
        ),
      detail:
        rows
          .map((r) => `${r.provider_id}:${r.account_id.slice(0, 4)}…`)
          .join(" ") || "none",
    };
  });

  await probe(
    "product stream at the pre-0006 revision (4 applied)",
    async () => {
      const [r] = await q(
        `select count(*)::int n from drizzle_product.__drizzle_migrations`,
      );
      return { ok: r.n === 4, detail: `${r.n} recorded` };
    },
  );
} finally {
  await pool.end().catch(() => {});
}

console.log(`\n  target host : ${host}`);
console.log(`  database    : ${database}\n`);
for (const c of checks)
  console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}\n        ${c.detail}`);

const failed = checks.filter((c) => !c.ok);
if (checks.length !== EXPECTED_CHECKS)
  stop(
    `expected ${EXPECTED_CHECKS} checks but ran ${checks.length}. ` +
      `The verifier itself is wrong; do NOT migrate on this result.`,
  );
console.log(
  failed.length
    ? `\n  STOP — ${failed.length} of ${checks.length} checks failed. Do NOT migrate this database.\n`
    : `\n  PROVEN — all ${checks.length} checks passed. Safe to run the product migration plan.\n`,
);
process.exit(failed.length ? 1 : 0);
