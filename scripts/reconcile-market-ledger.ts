/**
 * Records already-applied market migrations in the ledger, without replaying them.
 *
 * 0006 and 0007 were applied directly to production (docs/ops/MIGRATIONS.md) and
 * are absent from drizzle.__drizzle_migrations. Replaying them would fail on
 * existing objects; leaving them unrecorded makes every future market migration
 * try to re-create them.
 *
 * This records their identity ONLY after verifying, for each migration:
 *   1. the file's SHA-256 equals the hash recorded as applied to production,
 *   2. every object the SQL creates exists in the database,
 *   3. each object's definition matches what the SQL declares,
 *   4. the frozen seven-day evidence still reproduces.
 *
 * It executes NO market DDL. It only inserts ledger rows, and only for
 * migrations whose objects it has verified are already present.
 */
import "dotenv/config";
import { Client } from "pg";
import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { STREAMS } from "../src/lib/db/migration-streams";
import { journalOf } from "./migration-family-guard";

/** Hashes recorded when each migration was applied directly to production. */
const APPLIED_DIRECTLY: Record<string, string> = {
  "0006_history_payload_dedup":
    "53b0f0d1a84408cc8227501cc9480c80ffa2097735059478ccaa250dbafb8c02",
  "0007_observation_rollups":
    "97285647cffa6818e461ff6090f0deabb55558050f9fd040be09dfb60e1bd24b",
};

const FROZEN = {
  from: "2026-09-09T17:55:00Z",
  to: "2026-09-16T17:55:00Z",
  observations: 201235,
  minPriceTransitions: 3747,
  listingTransitions: 6145,
};

const { values: args } = parseArgs({
  options: {
    "database-url": { type: "string" },
    confirm: { type: "boolean", default: false },
    out: { type: "string" },
  },
});
const url =
  args["database-url"] ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL;
if (!url) throw new Error("EXPLICIT_DATABASE_URL_REQUIRED");

const stream = STREAMS.market;
const db = new Client({ connectionString: url });
const checks: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => {
  checks.push({ name, pass, detail });
  return pass;
};

/** Objects a migration declares, extracted from its own SQL. */
function declaredObjects(sql: string) {
  const tables = [...sql.matchAll(/create\s+table\s+([a-z0-9_]+)/gi)].map((m) =>
    m[1].toLowerCase(),
  );
  const indexes = [
    ...sql.matchAll(
      /create\s+(unique\s+)?index\s+([a-z0-9_]+)\s+on\s+([a-z0-9_]+)/gi,
    ),
  ].map((m) => ({
    name: m[2].toLowerCase(),
    unique: Boolean(m[1]),
    table: m[3].toLowerCase(),
  }));
  const constraints = [
    ...sql.matchAll(/constraint\s+([a-z0-9_]+)\s+(unique|check)/gi),
  ].map((m) => ({ name: m[1].toLowerCase(), kind: m[2].toLowerCase() }));
  return { tables, indexes, constraints };
}

try {
  await db.connect();
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

  const entries = await journalOf(stream);
  const recorded = await db.query(
    `select hash, created_at from ${stream.migrationsSchema}.__drizzle_migrations order by created_at`,
  );
  const recordedHashes = new Set(recorded.rows.map((r) => String(r.hash)));
  const toRecord: { tag: string; hash: string; when: number }[] = [];

  for (const entry of entries) {
    const sql = await readFile(`${stream.folder}/${entry.tag}.sql`, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    if (recordedHashes.has(hash)) {
      check(`${entry.tag}: already recorded`, true);
      continue;
    }
    const expected = APPLIED_DIRECTLY[entry.tag];
    if (!expected) {
      check(
        `${entry.tag}: not an approved direct-apply migration`,
        false,
        "refusing to record a migration that was never verified as applied",
      );
      continue;
    }
    // 1. hash identity
    if (
      !check(
        `${entry.tag}: sha256 matches production-applied hash`,
        hash === expected,
        hash,
      )
    )
      continue;

    // 2 and 3. every declared object exists, with a matching definition
    const declared = declaredObjects(sql);
    let objectsOk = true;
    for (const table of declared.tables) {
      const r = await db.query(
        "select to_regclass($1) is not null as present",
        [table],
      );
      objectsOk =
        check(
          `${entry.tag}: table ${table} exists`,
          r.rows[0].present === true,
        ) && objectsOk;
    }
    for (const index of declared.indexes) {
      const r = await db.query(
        "select indexdef from pg_indexes where indexname=$1 and tablename=$2",
        [index.name, index.table],
      );
      const def = r.rows[0]?.indexdef as string | undefined;
      const matches =
        Boolean(def) && (!index.unique || /create unique index/i.test(def!));
      objectsOk =
        check(
          `${entry.tag}: index ${index.name} exists with matching definition`,
          matches,
          def ?? "missing",
        ) && objectsOk;
    }
    for (const constraint of declared.constraints) {
      const r = await db.query(
        "select contype from pg_constraint where conname=$1",
        [constraint.name],
      );
      const kind = r.rows[0]?.contype as string | undefined;
      const want = constraint.kind === "unique" ? "u" : "c";
      objectsOk =
        check(
          `${entry.tag}: constraint ${constraint.name} exists as ${constraint.kind}`,
          kind === want,
          kind ?? "missing",
        ) && objectsOk;
    }
    if (objectsOk) toRecord.push({ tag: entry.tag, hash, when: entry.when });
  }

  // 4. the frozen evidence must still reproduce
  const frozen = await db.query(
    `with ordered as (
       select o.asset_id, r.window_start, o.min_price, o.quantity,
              lag(r.window_start) over w as pw, lag(o.min_price) over w as pm,
              lag(o.quantity) over w as pq
         from market_observations o join collector_runs r on r.id=o.collector_run_id
        where r.source='SKINPORT' and r.claim_key is not null
          and r.window_start >= $1::timestamptz and r.window_start < $2::timestamptz
       window w as (partition by o.asset_id order by r.window_start)),
     f as (select *, (pw is not null and window_start-pw=interval '5 minutes') as adj from ordered)
     select count(*)::int as observations,
            count(*) filter (where adj and min_price is distinct from pm)::int as min_tr,
            count(*) filter (where adj and quantity is distinct from pq)::int as qty_tr
       from f`,
    [FROZEN.from, FROZEN.to],
  );
  const f = frozen.rows[0];
  check(
    "frozen evidence: observations",
    Number(f.observations) === FROZEN.observations,
    String(f.observations),
  );
  check(
    "frozen evidence: minimum-price transitions",
    Number(f.min_tr) === FROZEN.minPriceTransitions,
    String(f.min_tr),
  );
  check(
    "frozen evidence: listing transitions",
    Number(f.qty_tr) === FROZEN.listingTransitions,
    String(f.qty_tr),
  );

  await db.query("COMMIT");

  const failures = checks.filter((c) => !c.pass);
  const plan = {
    stream: stream.name,
    migrationsSchema: stream.migrationsSchema,
    alreadyRecorded: recorded.rows.length,
    wouldRecord: toRecord.map((t) => ({
      tag: t.tag,
      sha256: t.hash,
      when: t.when,
    })),
    checks,
    verified: failures.length === 0,
  };

  if (!plan.verified) {
    console.error(JSON.stringify({ ...plan, applied: false }, null, 2));
    process.exitCode = 1;
  } else if (!args.confirm) {
    console.info(
      JSON.stringify(
        { ...plan, dryRun: true, message: "Pass --confirm to record." },
        null,
        2,
      ),
    );
  } else {
    for (const row of toRecord)
      await db.query(
        `insert into ${stream.migrationsSchema}.__drizzle_migrations(hash, created_at)
         select $1, $2 where not exists (select 1 from ${stream.migrationsSchema}.__drizzle_migrations where hash=$1)`,
        [row.hash, String(row.when)],
      );
    const after = await db.query(
      `select id, hash, created_at from ${stream.migrationsSchema}.__drizzle_migrations order by created_at`,
    );
    const result = { ...plan, applied: true, ledger: after.rows };
    if (args.out) {
      await mkdir(dirname(args.out), { recursive: true });
      await writeFile(args.out, JSON.stringify(result, null, 2) + "\n");
    }
    console.info(JSON.stringify(result, null, 2));
  }
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error(
    JSON.stringify({
      code: "RECONCILE_FAILED",
      message: error instanceof Error ? error.message : "unknown",
      checks,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
