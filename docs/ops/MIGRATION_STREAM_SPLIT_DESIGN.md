# Option A — Splitting the migration streams — DESIGN ONLY

**Status: PROPOSED. Nothing in this document is implemented.** No migration file
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

## 2. Blocking unknown — the product database must be inspected first

`PRODUCT_DATABASE_URL` was not available during this work, so the product
database's real state is **unknown**. The design cannot be finalised without it.

Before implementation, capture (read-only):

```sql
select id, hash, created_at from drizzle.__drizzle_migrations order by id;
select table_name from information_schema.tables where table_schema='public' order by 1;
select conname, conrelid::regclass::text as on_table,
       confrelid::regclass::text as references_table
  from pg_constraint where contype='f' order by 1;
```

Three questions must be answered from that output:

1. **Which migrations has it actually applied?** Match recorded hashes against
   the raw SHA-256 of each `.sql` file. Do not assume `0002`–`0005`.
2. **Does it contain market tables?** `0002` declares foreign keys from
   `alert_rules`, `alert_events`, `portfolio_holdings` and `watchlist_entries`
   into `assets` and `market_observations`. PostgreSQL cannot enforce a foreign
   key across databases, so either the product database holds its own copies of
   those tables, or those constraints were never created. **Both outcomes change
   the design.**
3. **Is it actually a separate database at all?** If `PRODUCT_DATABASE_URL` and
   `DATABASE_URL` resolve to the same database in some environments, the
   "families" are a deployment convention rather than a physical split, and the
   correct fix is different — likely schemas rather than directories.

**If question 2 shows the product database contains market tables, the split is
not a file move.** It becomes a question of whether market tables are duplicated
across databases, which is a data-architecture decision well beyond migration
housekeeping.

---

## 3. Target layout

```
drizzle/
  market/
    0000_initial_market_snapshots.sql
    0001_protect_observation_history.sql
    0002_history_payload_dedup.sql        (today's 0006, renumbered)
    0003_observation_rollups.sql          (today's 0007, renumbered)
    meta/_journal.json                    (market only)
  product/
    0000_product_accounts_monitoring_billing.sql   (today's 0002)
    0001_ops_application_role.sql                  (today's 0003)
    0002_ops_audit.sql                             (today's 0004)
    0003_steam_account_link.sql                    (today's 0005)
    meta/_journal.json                             (product only)
```

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

## 5. Migration-history reconciliation

Only needed if §3's renumbering option is chosen. **With the recommended
filenames-preserved approach, no reconciliation is required at all** — every
hash already recorded stays valid, and each database simply stops seeing the
other family's entries.

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
