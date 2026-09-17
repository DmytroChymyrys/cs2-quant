/**
 * Fail-closed database-family validation for a migration stream.
 *
 * Streams are isolated by directory and journal (see migration-streams.ts), so a
 * runner cannot read another stream's migrations. This guard is defence in
 * depth: it refuses when the TARGET DATABASE does not match the stream's family,
 * or when a migration in the stream's own folder would touch another family's
 * tables.
 */
export type { DatabaseFamily } from "./migration-streams";
export { FAMILY_TABLES } from "./migration-streams";
import { FAMILY_TABLES, type DatabaseFamily } from "./migration-streams";

/**
 * Objects a migration OWNS: tables it creates or alters, and tables it attaches
 * an index or trigger to. Deliberately not "tables mentioned anywhere": the
 * product migrations declare foreign keys INTO market tables, so a mention-based
 * classifier reads them as ambiguous.
 */
const OWNERSHIP = [
  /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi,
  /alter\s+table\s+(?:only\s+)?"?([a-z0-9_]+)"?/gi,
  /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[a-z0-9_"]*\s+on\s+"?([a-z0-9_]+)"?/gi,
  /create\s+trigger\s+[a-z0-9_"]+\s+(?:before|after|instead\s+of)[\s\S]*?\bon\s+"?([a-z0-9_]+)"?/gi,
];

/** Which family a migration's SQL belongs to, by the objects it owns. */
export function classifyMigration(sql: string): DatabaseFamily | "UNKNOWN" {
  const owned = new Set<string>();
  for (const pattern of OWNERSHIP)
    for (const match of sql.matchAll(pattern))
      owned.add(match[1].toLowerCase());
  const market = [...owned].filter((t) =>
    (FAMILY_TABLES.MARKET as readonly string[]).includes(t),
  ).length;
  const product = [...owned].filter((t) =>
    (FAMILY_TABLES.PRODUCT as readonly string[]).includes(t),
  ).length;
  if (market && !product) return "MARKET";
  if (product && !market) return "PRODUCT";
  return "UNKNOWN";
}

/** Which family a live database belongs to, by the tables it already has. */
export function classifyDatabase(
  existingTables: readonly string[],
): DatabaseFamily | "EMPTY" | "MIXED" {
  const present = new Set(existingTables.map((t) => t.toLowerCase()));
  const market = FAMILY_TABLES.MARKET.some((t) => present.has(t));
  const product = FAMILY_TABLES.PRODUCT.some((t) => present.has(t));
  if (market && product) return "MIXED";
  if (market) return "MARKET";
  if (product) return "PRODUCT";
  return "EMPTY";
}

export type PendingMigration = { tag: string; sql: string };

/**
 * Throws unless every pending migration belongs to `expected`.
 *
 * An EMPTY database cannot be classified from its contents, so the caller must
 * state the family explicitly; a MIXED database means the hazard has already
 * occurred and is never safe to migrate automatically.
 */
export function assertMigrationFamily(
  expected: DatabaseFamily,
  existingTables: readonly string[],
  pending: readonly PendingMigration[],
): void {
  const actual = classifyDatabase(existingTables);
  if (actual === "MIXED")
    throw new Error(
      `MIGRATION_FAMILY_MIXED: this database contains both market and product tables. ` +
        `The shared migration directory has already been applied across families. ` +
        `Do not migrate; reconcile the schema first.`,
    );
  if (actual !== "EMPTY" && actual !== expected)
    throw new Error(
      `MIGRATION_FAMILY_MISMATCH: expected a ${expected} database but the target looks like ${actual}.`,
    );
  const foreign = pending
    .map((m) => ({ tag: m.tag, family: classifyMigration(m.sql) }))
    .filter((m) => m.family !== "UNKNOWN" && m.family !== expected);
  if (foreign.length)
    throw new Error(
      `MIGRATION_FAMILY_REFUSED: ${foreign.length} pending migration(s) belong to another database family and would be applied to this ${expected} database: ` +
        foreign.map((m) => `${m.tag} (${m.family})`).join(", ") +
        `. The ./drizzle directory is shared by two databases; see docs/ops/MIGRATIONS.md. ` +
        `Apply reviewed SQL directly instead, or split the migration streams first.`,
    );
}

/** Journal entries whose hash is not recorded in the target database. */
export function pendingFromJournal(
  journalTags: readonly string[],
  appliedHashes: readonly string[],
  hashOf: (tag: string) => string,
): string[] {
  const applied = new Set(appliedHashes);
  return journalTags.filter((tag) => !applied.has(hashOf(tag)));
}
