# Product database inspection — read-only findings

Inspected 2026-09-17 in a `REPEATABLE READ READ ONLY` transaction. Nothing was
created, altered, dropped, migrated, inserted, updated or deleted.

## Which database was inspected, and which was not

`PRODUCT_DATABASE_URL` is **not configured in Vercel at all**. The deployment has
only `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (Production and Development).
There is no `PRODUCT_DATABASE_URL`, `DERIVED_MARKET_DATABASE_URL`,
`PRODUCT_ANALYTICS_SNAPSHOT_ID`, `CATALOG_DATABASE_URL` or
`ASSET_IMAGES_DATABASE_URL` in the deployment environment.

Two local files define one:

| File | Target |
| --- | --- |
| `.env.billing-sandbox.local` | `127.0.0.1` local sandbox — not inspected |
| `.env.steam-preview.local` | a Neon endpoint distinct from the market database — **inspected** |

**There is therefore no production product database to inspect.** The database
below is a preview/development instance. Every conclusion is about that
instance, not about a production product database, because none is configured.

## State

| | |
| --- | --- |
| PostgreSQL | **18.6** (the market database is also 18.6) |
| Schemas | `public`, `drizzle`, `drizzle_steam` |
| Public tables | **18** |
| Rows in every product table | **0** |

### It contains BOTH families

```
market : assets, asset_source_mappings, collector_runs, market_observations
product: admin_audit, alert_events, alert_rules, app_users, auth_accounts,
         auth_rate_limits, auth_sessions, auth_users, auth_verifications,
         billing_events, billing_subscriptions, portfolio_holdings,
         saved_screens, watchlist_entries
```

`assets` = **0 rows**, `market_observations` = **0 rows**. The market tables
exist as empty schema, not as duplicated market data.

This is exactly the `MIGRATION_FAMILY_MIXED` state the guard added in `d3eb585`
detects and refuses. The hazard has already occurred on this database — almost
certainly because the shared migrator was run against it and applied both
families, which is the behaviour the guard now prevents.

### Applied migrations (`drizzle.__drizzle_migrations`)

| id | created_at | Resolves to |
| --- | --- | --- |
| 1 | 1788968470562 | `0000_initial_market_snapshots` |
| 2 | 1788968586983 | `0001_protect_observation_history` |
| 3 | 1788996195484 | `0002_product_accounts_monitoring_billing` |
| 4 | 1789060508388 | `0003_ops_application_role` |
| 5 | 1789060609372 | `0004_ops_audit` |

Every hash resolved to a repository migration file; none was unrecognised.

- `0002` **was** applied here. `0003` and `0004` **were** applied.
- `0005_steam_account_link` was **not** applied in this schema.

### A second, independent migration stream already exists

`drizzle_steam.__drizzle_migrations` holds one row, `created_at`
`1789420200000`, matching `drizzle-steam/meta/_journal.json` entry `0000`.
It is applied by `scripts/migrate-steam.ts` with
`migrationsFolder: "./drizzle-steam"` and `migrationsSchema: "drizzle_steam"`.

**This is already the Option A pattern**, implemented for one stream: its own
folder, its own journal, its own migrations schema, its own runner, and an
explicit target guard that refuses a pooler connection.

### Duplicate Steam migration across the two streams

| File | SHA-256 | Applied |
| --- | --- | --- |
| `drizzle-steam/0000_steam_account_link.sql` | `07a17f06…` | yes (`drizzle_steam`) |
| `drizzle/0005_steam_account_link.sql` | `b7b8461a…` | no |

Both create the same partial unique index `auth_one_steam_per_user` on
`auth_accounts`; one is hand-written, one drizzle-generated. Semantically
equivalent, textually different, so different hashes. Both use
`IF NOT EXISTS`, so applying the second would be a no-op that nonetheless
records a second migration for the same object.

`steam_account_links` does not exist and is not created by either file — the
Steam link lives on `auth_accounts` via `provider_id = 'steam'`. The guard's
family table list names `steam_account_links` speculatively; that entry never
matches anything and should be dropped.

### Cross-family foreign keys are real and enforced

19 foreign keys exist; 9 cross from product tables into market tables:

| Constraint | From | To |
| --- | --- | --- |
| `alert_events_observation_id_market_observations_id_fk` | `alert_events` | `market_observations` |
| `alert_rules_asset_id_assets_id_fk` | `alert_rules` | `assets` |
| `alert_rules_last_observation_id_market_observations_id_fk` | `alert_rules` | `market_observations` |
| `portfolio_holdings_asset_id_assets_id_fk` | `portfolio_holdings` | `assets` |
| `watchlist_entries_asset_id_assets_id_fk` | `watchlist_entries` | `assets` |
| `watchlist_entries_checkpoint_observation_id_market_observations` | `watchlist_entries` | `market_observations` |
| `asset_source_mappings_asset_id_assets_id_fk` | `asset_source_mappings` | `assets` |
| `market_observations_asset_id_assets_id_fk` | `market_observations` | `assets` |
| `market_observations_collector_run_id_collector_runs_id_fk` | `market_observations` | `collector_runs` |

They exist **because the market tables are co-located**. They are enforced.

## Does the state match the repository migration history?

Partly, and the mismatches matter:

| Question | Answer |
| --- | --- |
| Applied set matches journal 0000–0004? | Yes, hash for hash |
| Is it a product-only database? | **No.** It holds both families |
| Are market tables populated? | No — 0 rows, schema only |
| Is `0005` applied? | Not in `drizzle`; an equivalent index was applied via `drizzle_steam` |
| Is there a production product database? | **No.** None is configured in Vercel |

## Consequence for Option A

The blocking question is answered, and the answer changes the design:

**The product schema genuinely depends on market tables being co-located.** Six
product tables hold enforced foreign keys into `assets` and
`market_observations`. Splitting the *migration streams* does not split the
*schema dependency*. A product database will still need the market tables to
exist, so `0000` is not purely a market migration from the product stream's
point of view — it is a shared prerequisite.
