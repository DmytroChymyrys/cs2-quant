/**
 * MARKET migration stream runner.
 *
 * Reads only ./drizzle/market and records history in the `drizzle` schema, which
 * is the schema production already uses, so the existing ledger stays valid.
 *
 * Pass --plan to report what would be applied without applying anything.
 */
import "dotenv/config";
import { Client } from "pg";
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { STREAMS } from "../src/lib/db/migration-streams";
import { guardStream } from "./migration-family-guard";

const { values: args } = parseArgs({
  options: { plan: { type: "boolean", default: false } },
});
const stream = STREAMS.market;
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("EXPLICIT_DATABASE_URL_REQUIRED");

const client = new Client({ connectionString: url });
try {
  await client.connect();
  const { pending } = await guardStream("market", (sql) => client.query(sql));
  if (args.plan) {
    console.info(
      JSON.stringify(
        {
          stream: stream.name,
          folder: stream.folder,
          migrationsSchema: stream.migrationsSchema,
          pending: pending.map((p) => ({ tag: p.tag, sha256: p.sha256 })),
        },
        null,
        2,
      ),
    );
  } else {
    await migrate(drizzle(client), {
      migrationsFolder: stream.folder,
      migrationsSchema: stream.migrationsSchema,
    });
    console.info("cs2-quant market migrations complete");
  }
} catch (error) {
  const message =
    error instanceof Error && error.message.startsWith("MIGRATION_FAMILY")
      ? error.message
      : "Market migration failed; check database connectivity and migration state.";
  console.error(message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
