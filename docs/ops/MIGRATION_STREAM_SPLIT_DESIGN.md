# Option A — Splitting the migration streams — DESIGN ONLY

**Status: PROPOSED, REVISED 2026-09-17 after inspecting the real product
database. Nothing in this document is implemented.** No migration file
has been moved, no journal rewritten, no migration history reconciled. Approval
is required before any of it happens.

Companion to [MIGRATIONS.md](MIGRATIONS.md), which records the hazard and the
current stopgap.

---

## 1. The problem being fixed

One `./drizzle` directory and one `meta/_journal.json` serve two logically
separate databases whose applied histories have diverged:

| | Market database | Product database |
| --- | --- | --- |
| Runner | `scripts/migrate.ts` | `scripts/migrate-product.ts` |
| Applied (verified) | `0000`, `0001` only | **UNVERIFIED** |
| Tables (verified) | 4 market tables | unverified |

Because the journal is shared, each database permanently sees the other's
migrations as pending. Running either runner applies the wrong family's schema.
The guard added in `d3eb585` refuses that, but the shared stream remains.

---

## 2. Blocking unknown — RESOLVED by inspection

The product database was inspected read-only on 2026-09-17
([FINDINGS](../../reports/product-db-inspection/FINDINGS.md)). The three
questions are answered, and two of the answers change this design.

### 2.1 There is no production product database

`PRODUCT_DATABASE_URL` is **not configured in Vercel at all**. The deployment
carries only `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. The database inspected
is a preview instance from `.env.steam-preview.local`, and every product table
in it has **0 rows**.

Consequence: there is no populated production product database whose history
must be preserved. The reconciliation risk that dominated the previous draft is
largely hypothetical, and the split can be designed for correctness rather than
for migrating live bookkeeping.

### 2.2 The product database contains both families

18 public tables: the four market tables alongside all product/auth/billing
tables. `assets` and `market_observations` exist with **0 rows** — schema, not
duplicated data.

This is the `MIGRATION_FAMILY_MIXED` state the guard now refuses. It is direct
evidence the hazard already happened once, on this database.

### 2.3 Cross-family foreign keys are real and enforced

Nine foreign keys cross from product tables into market tables, and they exist
because the market tables are co-located.

**This is the finding that reshapes the design.** Splitting the migration
streams does not split the schema dependency: a product database still requires
`assets`, `market_observations` and `collector_runs` to exist. `0000` is not a
market-only migration from the product stream's point of view — it is a **shared
prerequisite**.

### 2.4 Applied state

| Migration | Market DB | Product DB |
| --- | --- | --- |
| `0000_initial_market_snapshots` | applied | applied |
| `0001_protect_observation_history` | applied | applied |
| `0002_product_accounts_monitoring_billing` | not applied | **applied** |
| `0003_ops_application_role` | not applied | **applied** |
| `0004_ops_audit` | not applied | **applied** |
| `0005_steam_account_link` | not applied | not applied in `drizzle` |
| `0006_history_payload_dedup` | applied directly, unrecorded | not applied |
| `0007_observation_rollups` | applied directly, unrecorded | not applied |

### 2.5 A second stream already exists and works

`drizzle-steam/` has its own folder, its own journal, its own migrations schema
(`drizzle_steam`), its own runner (`scripts/migrate-steam.ts`) and an explicit
target guard refusing pooler connections. Its single migration is applied and
recorded in the product database.

**Option A is therefore not a new pattern; it is generalising one this
repository already uses.** The split should follow `drizzle-steam` rather than
invent a different convention.

### 2.6 A duplicate Steam migration exists across streams

`drizzle-steam/0000_steam_account_link.sql` (applied) and
`drizzle/0005_steam_account_link.sql` (not applied) create the same partial
unique index with different text and therefore different hashes. Applying the
second would be a no-op that records a second migration for the same object.
**One of the two should be removed as part of the split**, and the shared-journal
copy is the one to drop.

## 3. Target layout — REVISED

Following the `drizzle-steam` precedent: sibling directories, each with its own
journal and its own **migrations schema**, so bookkeeping cannot collide even if
two streams ever share a database.

```
drizzle/          market stream   -> migrationsSchema "drizzle"        (unchanged)
drizzle-product/  product stream  -> migrationsSchema "drizzle_product"
drizzle-steam/    steam stream    -> migrationsSchema "drizzle_steam"  (already exists)
```

Keeping the market stream in `drizzle/` with the existing `drizzle` schema means
the market database's recorded history stays valid untouched — no hash changes,
no reconciliation, nothing written to production bookkeeping.

The product stream gets a **new** migrations schema. Because the product
database's existing rows live in the `drizzle` schema, the product stream would
initially see its migrations as unapplied. §5 handles that, and §2.1 makes it
low-stakes: the only product database is empty.

**The shared prerequisite (§2.3) must be explicit.** A product database needs the
market tables. Options, to be decided at review:

- **Prerequisite migration.** `drizzle-product/0000_market_prerequisite.sql`
  creates the market tables the product foreign keys require. Honest about the
  dependency; duplicates market DDL across two streams, which can drift.
- **Documented precondition.** The product stream refuses to run unless the
  market tables already exist. No duplication, but a product database can no
  longer be bootstrapped from empty on its own.
- **Drop the cross-family foreign keys.** Removes the dependency entirely and
  makes the two families genuinely independent. The cleanest end state and the
  largest change, since it alters the product schema and weakens referential
  integrity that is currently enforced.

Recommendation: **documented precondition** for the split itself, with dropping
the cross-family foreign keys raised as a separate architectural decision. It
avoids duplicating DDL and avoids changing integrity guarantees inside a
migration-plumbing change.

**Renumbering changes each file's SHA-256, and drizzle matches applied
migrations by hash.** Every renamed file would therefore look unapplied. §5
addresses this; it is the crux of the whole migration.

An alternative that avoids the problem entirely: **keep the existing filenames
and hashes**, and split only the journals. Gaps in numbering
(market: 0000, 0001, 0006, 0007) are cosmetic. Drizzle applies journal entries
in order and does not require contiguous numbering.

**Recommendation: keep filenames, split journals only.** It preserves every
hash, needs no history reconciliation, and removes the entire class of risk in
§5. Renumbering buys tidiness at the cost of rewriting production migration
bookkeeping, which is a poor trade.

---

## 4. Independent runners and config

`drizzle.config.ts` currently emits both schemas to one `out`. It would become
two configs, each with its own schema list and output directory, so newly
generated migrations land in the right stream by construction:

| Config | schema | out |
| --- | --- | --- |
| `drizzle.market.config.ts` | `src/lib/db/schema.ts` | `./drizzle/market` |
| `drizzle.product.config.ts` | `src/lib/product/schema.ts` | `./drizzle/product` |

Each runner points at its own folder and keeps the family guard as defence in
depth. The guard stops being the only protection and becomes a backstop.

---

## 5. Migration-history reconciliation — REVISED

The market stream needs **no reconciliation**: it keeps its directory, its
schema and its hashes.

The product stream moves to a new migrations schema, so its four applied
migrations (`0002`–`0004`, plus `0000`/`0001` as prerequisites) would appear
unapplied. Because the only product database is **empty** (§2.1), the simplest
correct answer is to **recreate it from the product stream** rather than
reconcile bookkeeping at all: drop and rebuild a database with 0 rows, or point
at a fresh one.

That removes the entire hash-rewriting risk that dominated the previous draft.
If a populated product database ever appears before the split, reconciliation
becomes necessary again and should be re-designed then, against that database.

If renumbering is chosen anyway, then for each database and each renamed file:

1. Compute old and new raw SHA-256.
2. In a transaction, `UPDATE drizzle.__drizzle_migrations SET hash = <new> WHERE hash = <old>`.
3. Verify the row count updated equals the number of renamed applied migrations.
4. Verify a dry-run migrate reports zero pending.

This rewrites production migration bookkeeping and is the single most dangerous
step in the whole design. It is the reason the recommendation is to avoid it.

### `0006` and `0007` are already applied but unrecorded

Both were applied directly to production and deliberately left out of
`__drizzle_migrations` (see MIGRATIONS.md). When the market journal is created it
must list them, and the market database must record them as applied, or the first
market migrator run will try to re-create existing tables and fail.

Two ways to record them, to be decided at review:

- **Insert the two rows** with each file's real SHA-256 and its journal `when`
  value. Honest and minimal, but it is a manual write to migration bookkeeping,
  which is currently forbidden and would need explicit approval.
- **Bootstrap-mark**: run the market migrator once against a database where the
  objects already exist, using a mode that records without executing. Drizzle
  has no first-class support for this, so it would need a small custom runner.

Either way it must be a reviewed, single-purpose operation, never a side effect
of the split.

---

## 6. Safety guards

Keep and extend the family guard:

1. `assertMigrationFamily` stays, now as a backstop rather than the only defence.
2. Each runner asserts its folder matches its family: the market runner refuses a
   non-`MARKET` migration even if present in the market folder.
3. Each runner asserts the target database's identity, not just its table shape:
   a market runner requires `market_observations` to exist (or an explicit
   `--bootstrap` flag for a fresh database), so a typo in a connection string
   cannot silently migrate the wrong database.
4. The `--bootstrap` flag must be explicit and never inferred, because an empty
   database is exactly what a mistyped database name looks like.

---

## 7. Test plan

| Test | Proves |
| --- | --- |
| Market migrations rejected against a product database | Guard blocks cross-family by database shape |
| Product migrations rejected against a market database | The exact production hazard cannot recur |
| Market folder contains only `MARKET`-classified files | Streams cannot drift by misfiling |
| Product folder contains only `PRODUCT`-classified files | Same, other direction |
| Fresh bootstrap, market stream | A new market database reaches the current schema from empty |
| Fresh bootstrap, product stream | Same for product |
| Existing-database upgrade, market | A database at `0000`+`0001`+applied-`0006`/`0007` reports zero pending and is not re-migrated |
| Existing-database upgrade, product | Same against the verified real product baseline from §2 |
| Append-only trigger survives both bootstraps | The `0001` protection is never lost |
| Hash stability | Every committed migration's SHA-256 matches what its journal expects |

Bootstrap and upgrade tests run against PGlite, as `tests/history-dedup.test.ts`
and `tests/rollups.test.ts` already do, so they need no live database in CI.

The upgrade tests are the important ones: a fresh bootstrap passing proves very
little, because the failure mode being fixed only exists on a database with
history.

---

## 8. Rollback and recovery

Nothing in the recommended approach mutates data or existing schema, so rollback
is mostly file-level:

| Step | Rollback |
| --- | --- |
| Split journals, move nothing | Restore the single journal from git |
| Two configs, two runners | Revert the commit |
| Record `0006`/`0007` as applied | Delete exactly those two rows, identified by hash |
| Renumbering + hash rewrite (not recommended) | Restore `__drizzle_migrations` from a pre-change backup |

Preconditions for the reconciliation step, if taken: a verified Neon backup or
branch immediately before, the exact old-hash → new-hash mapping written down
and reviewed, and a post-change assertion that both runners report zero pending.

Recovery from the worst case — a database that has received the wrong family's
schema — is not a migration problem but a restore: take the pre-incident backup.
The `MIGRATION_FAMILY_MIXED` guard exists so this never gets that far.

---

## 9. Sequence

1. **Inspect the product database** (§2). Blocking; nothing else starts first.
2. Decide filenames-preserved versus renumbering. Recommendation: preserved.
3. Split journals; add two configs and two runner entry points.
4. Add guards (§6) and tests (§7).
5. Decide and execute how `0006`/`0007` are recorded (§5), as its own reviewed step.
6. Verify both runners report zero pending against their real databases.
7. Remove the "do not run the migrator" warning from MIGRATIONS.md only after 6 passes.

Steps 1–2 are analysis. Steps 3–4 touch no database. Step 5 is the only one that
writes to production bookkeeping and needs separate approval.

---

## 10. Open questions for review

1. Product database state — all three questions in §2, unanswerable from here.
2. Filenames preserved or renumbered? Recommendation: preserved.
3. How are `0006`/`0007` recorded, given hand-editing `__drizzle_migrations` is
   currently forbidden?
4. If the product database turns out to contain market tables, is that intended
   duplication or drift? That answer may change the whole architecture.
5. Should the two streams live in one repository at all, or does the product
   database deserve its own migration lifecycle?
