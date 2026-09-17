# Migrations — shared-directory hazard

> **DO NOT RUN `npm run db:migrate` AGAINST PRODUCTION.**
>
> It is unsafe until the migration streams are split. Reviewed SQL must be
> applied directly instead. This warning is removed only when the permanent fix
> below is implemented and verified.

## The hazard

Two logically separate databases are migrated from the **same** `./drizzle`
directory and the **same** `drizzle/meta/_journal.json`:

| Runner | Target | Connection variable |
| --- | --- | --- |
| `npm run db:migrate` | market database | `DATABASE_URL` |
| `npm run db:migrate:product` | product database | `PRODUCT_DATABASE_URL` |

Each database records only the migrations it has actually applied, in its own
`drizzle.__drizzle_migrations` table. Because the journal is shared, every
journal entry belonging to the *other* family is permanently "pending" for each
database. A migrator run therefore tries to apply the other family's schema.

## Verified state (2026-09-17)

- The production **market** database has recorded and applied **only** `0000`
  and `0001`. Its public schema contains exactly four tables: `assets`,
  `asset_source_mappings`, `collector_runs`, `market_observations`.
- Journal entries `0002`–`0005` are **product-family** migrations
  (accounts, auth, billing, alerts, portfolio, ops audit, Steam link). They are
  not recorded against the market database.
- Running `npm run db:migrate` against the market database would attempt to
  create roughly **fourteen product tables** there: `app_users`, `auth_users`,
  `auth_accounts`, `auth_sessions`, `auth_verifications`, `auth_rate_limits`,
  `billing_subscriptions`, `billing_events`, `alert_rules`, `alert_events`,
  `portfolio_holdings`, `saved_screens`, `watchlist_entries`, `admin_audit`,
  plus the Steam link table.
- Conversely, market migrations `0006`–`0007` must never run against the product
  database: they reference `assets` and `market_observations`, which do not
  exist there, and would fail partway.

Drizzle records the **raw SQL file SHA-256** in `__drizzle_migrations.hash`.
This was confirmed by reproducing the recorded hash of
`0000_initial_market_snapshots.sql` exactly.

### Cross-family foreign keys

`0002_product_accounts_monitoring_billing.sql` declares foreign keys **from**
product tables **into** market tables:

| Constraint | References |
| --- | --- |
| `alert_rules.asset_id` | `assets.id` |
| `alert_events.observation_id` | `market_observations.id` |
| `alert_rules.last_observation_id` | `market_observations.id` |
| `portfolio_holdings.asset_id` | `assets.id` |
| `watchlist_entries.asset_id` | `assets.id` |

PostgreSQL cannot enforce a foreign key across separate databases, so the
generated product schema assumes the market tables are co-located. Whether the
product database actually carries those constraints must be **verified against
the real product database**, not assumed, before the permanent split is
designed. This is the single biggest unknown in that work.

## Rules until the permanent fix lands

1. **Never** run `npm run db:migrate` against production.
2. **Never** run `npm run db:migrate:product` against the market database.
3. Apply reviewed market SQL **directly**, statement by statement, against the
   market database.
4. Do **not** hand-write rows into `drizzle.__drizzle_migrations`. The migration
   history is reconciled as part of the permanent fix, not by hand.
5. Do **not** add market migrations to the shared journal. Doing so makes them
   pending for the product database too.

## Fail-closed guard

`scripts/migration-family-guard.ts` computes what a given target would actually
apply and refuses when any pending migration belongs to another family. Both
runners call it before migrating. It raises one of:

| Error | Meaning |
| --- | --- |
| `MIGRATION_FAMILY_REFUSED` | Pending migrations belong to another family |
| `MIGRATION_FAMILY_MISMATCH` | The target database looks like the other family |
| `MIGRATION_FAMILY_MIXED` | The database already contains both families; reconcile before migrating |

The guard is a **stopgap**. It prevents the accident; it does not fix the shared
stream. A database with no recognised tables cannot be classified from its
contents, so the caller must state the family explicitly.

## Migrations applied directly (outside the migrator)

| Migration | Family | Applied to production market DB | In shared journal |
| --- | --- | --- | --- |
| `0006_history_payload_dedup.sql` | MARKET | yes, directly | **no** |
| `0007_observation_rollups.sql` | MARKET | yes, directly | **no** |

Both are additive. Neither is recorded in `drizzle.__drizzle_migrations`, so a
future migrator run would try to re-create their objects and fail. That is
intentional: the migrator must not be run against production at all until the
streams are split, and the reconciliation is part of that work.

## Permanent fix

Split the directory and journal per family, with independent runners and
migration histories that reflect what each database has actually applied:

```
drizzle/
  market/   migrations + meta/_journal.json
  product/  migrations + meta/_journal.json
```

The design must transition without replaying already-applied migrations, must
verify the real product-database history rather than assuming it, and must ship
with CI tests proving each stream cannot run against the other family.

See [MIGRATION_STREAM_SPLIT_DESIGN.md](MIGRATION_STREAM_SPLIT_DESIGN.md).
