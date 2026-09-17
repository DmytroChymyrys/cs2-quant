/**
 * Side-effect-free helpers shared by every migration runner.
 *
 * Streams are isolated by directory and journal, so a runner can only read its
 * own migrations. These helpers add fail-closed validation on top: the target
 * database must belong to the stream's family, and the stream's own migrations
 * must not touch another family's tables.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  assertMigrationFamily,
  type PendingMigration,
} from "../src/lib/db/migration-guard";
import { STREAMS, type MigrationStream } from "../src/lib/db/migration-streams";

type QueryFn = (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;

export type JournalEntry = { idx: number; when: number; tag: string };

export async function journalOf(stream: MigrationStream) {
  const journal = JSON.parse(
    await readFile(`${stream.folder}/meta/_journal.json`, "utf8"),
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

/** Drizzle records the raw SQL file SHA-256; verified against production. */
export async function hashOf(stream: MigrationStream, tag: string) {
  return createHash("sha256")
    .update(await readFile(`${stream.folder}/${tag}.sql`))
    .digest("hex");
}

/**
 * What this stream would apply to this database.
 *
 * Drizzle decides by timestamp, not hash: it applies every journal entry whose
 * `when` is greater than the newest recorded `created_at`. This mirrors that
 * rule so a plan matches what a real run would do.
 */
export async function pendingFor(stream: MigrationStream, query: QueryFn) {
  const applied = await query(
    `select hash, created_at from ${stream.migrationsSchema}.__drizzle_migrations order by created_at desc`,
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const newest = applied.rows.length
    ? Number(applied.rows[0].created_at)
    : null;
  const entries = await journalOf(stream);
  const pending: (PendingMigration & { when: number; sha256: string })[] = [];
  for (const entry of entries) {
    if (newest !== null && newest >= entry.when) continue;
    pending.push({
      tag: entry.tag,
      when: entry.when,
      sha256: await hashOf(stream, entry.tag),
      sql: await readFile(`${stream.folder}/${entry.tag}.sql`, "utf8"),
    });
  }
  return { pending, newestRecorded: newest, recorded: applied.rows.length };
}

/** Throws unless this database is a safe target for this stream. */
export async function guardStream(
  streamName: keyof typeof STREAMS,
  query: QueryFn,
) {
  const stream = STREAMS[streamName];
  const tables = (
    await query(
      "select table_name from information_schema.tables where table_schema='public'",
    )
  ).rows.map((r) => String(r.table_name));
  const { pending } = await pendingFor(stream, query);
  // Product and steam legitimately target a co-located database that also holds
  // the market schema, so their family check tolerates the market tables being
  // present; only the market stream requires a market-shaped database.
  const visible =
    stream.family === "PRODUCT"
      ? tables.filter(
          (t) =>
            !STREAMS.market.owns.includes(
              t as (typeof STREAMS.market.owns)[number],
            ),
        )
      : tables;
  assertMigrationFamily(stream.family, visible, pending);
  return { stream, pending, tables };
}
