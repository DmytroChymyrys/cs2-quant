/**
 * Side-effect-free helper shared by both migration runners.
 *
 * The ./drizzle directory and its journal are consumed by two logically separate
 * databases, so the shared journal always lists migrations that are "pending"
 * for the wrong database. This computes what a given target would actually apply
 * and refuses when any of it belongs to another family.
 *
 * See docs/ops/MIGRATIONS.md. Stopgap until the migration streams are split.
 */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  assertMigrationFamily,
  type DatabaseFamily,
  type PendingMigration,
} from "../src/lib/db/migration-guard";

type QueryFn = (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;

export async function guardFamily(family: DatabaseFamily, query: QueryFn) {
  const tables = (
    await query(
      "select table_name from information_schema.tables where table_schema='public'",
    )
  ).rows.map((r) => String(r.table_name));
  const applied = await query(
    "select hash from drizzle.__drizzle_migrations",
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const appliedHashes = new Set(applied.rows.map((r) => String(r.hash)));
  const journal = JSON.parse(
    await readFile("./drizzle/meta/_journal.json", "utf8"),
  ) as { entries: { tag: string }[] };
  const files = await readdir("./drizzle");
  const pending: PendingMigration[] = [];
  for (const entry of journal.entries) {
    if (!files.includes(`${entry.tag}.sql`)) continue;
    const sql = await readFile(`./drizzle/${entry.tag}.sql`, "utf8");
    // Drizzle records the raw file SHA-256; verified against production.
    if (!appliedHashes.has(createHash("sha256").update(sql).digest("hex")))
      pending.push({ tag: entry.tag, sql });
  }
  assertMigrationFamily(family, tables, pending);
}
