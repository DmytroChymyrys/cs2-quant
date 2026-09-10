# Derived market read model V1

## Scope and preflight

Inspected the active collector, protected cron endpoint, five-minute schedule, raw schema/indexes, provenance/History storage, prepared experiment report and collector/database tests before implementation. The working tree already contained an uncommitted provider-adapter refactor; it was preserved, not adopted as new work here. `reports/derived-market/protected-before.json` records hashes of the collector, raw schema, cron, schedule, configuration, universe, prepared report and provider modules at the start of this task.

The successful production day establishes collection reliability, not predictive performance. Ops V1 and catalog V1 remain frozen. This phase introduces no UI, public API, telemetry, prediction, trading, recommendation or scheduled invocation.

The chosen implementation is a deterministic TypeScript feature engine plus an explicit idempotent job writing to a **separate analytics database**. A large live view would recompute rolling windows on customer reads and require DDL on the raw database; this bounded snapshot job avoids that coupling. Raw observations and History storage remain unchanged. Reports can run without any destination database or migration.

New files:

- `src/lib/derived-market/{model,prepare,features}.ts`: input contract, duplicate/boundary handling, calculations and scoped History dimension.
- `src/lib/derived-market/{source,report,store}.ts`: read-only PostgreSQL source, operational/descriptive report, transactional destination writes.
- `scripts/derived-market/{run,migrate}.ts`: explicit CLI execution and isolated migration.
- `db/derived-market/001_read_model.sql`: one additive migration in the analytics database.
- `tests/derived-market.test.ts`, `tests/fixtures/derived-market/*`: realistic deterministic sequences and an optional guarded local seed.
- Package scripts and documentation/configuration examples. No production collector file is changed.

## Five distinct concepts

1. **Raw observation:** a persisted venue snapshot linked to a collector run; a new row is not proof of market change.
2. **Items source update:** `source_updated_at` supplied by Items; age is observation time minus that timestamp.
3. **Market change:** a numeric difference in observed listing price/count relative to an eligible preceding observation. Unchanged snapshots are valid.
4. **History version change:** an observed change of the complete decompressed response's stored SHA-256. The response includes untracked/versioned items, so a provider-wide hash change need not change a particular tracked asset. Byte hashes are not semantic hashes immune to JSON formatting/reordering.
5. **Derived feature:** a deterministic calculation with method, bounded dataset and raw observation provenance. Not an independent upstream measurement or a trading signal.

## Snapshot and History contracts

A content-addressed snapshot ID hashes the method (`listing-features-v2`), normalized scope/universe and sorted bounded input. Identical input, including reordered rows, yields the same ID and features. Later raw arrivals/corrections yield a different immutable snapshot instead of overwriting a previous result. Consumers select an explicit snapshot; there is no mutable global "latest" pointer in V1.

All calculations use only rows whose scheduled window **and observed timestamp** lie in `[from,to)`. No pre-window warmup data is silently imported into a report. First observations therefore lack some horizon features, even if older data exists elsewhere in the source database. Scope endpoints must be five-minute aligned, positive, and at most seven days apart. The CLI rejects an end after the latest closed bucket. The offline CLI requires Node.js 22+ (tested with the local Node.js 24 runtime). Reports accept explicit from/to; health defaults to the last 24 hours of closed buckets. The approved universe comes from the experiment manifest, not whatever happens to be tracked today.

Ambiguous duplicate claimed windows and duplicate raw run/asset pairs are excluded from calculations and reported as operational failures. They are never arbitrarily selected or merged. Publishing a snapshot with duplicate ambiguity is refused. An observation outside its own scheduled bucket is excluded and fails operational health; the live collector's maximum duration is below one bucket. Missing assets/windows are not interpolated. Safely suppressed unclaimed `DUPLICATE_WINDOW` attempts do not fail health, unless they improperly own observations.

Four destination tables:

| Table | Meaning |
| --- | --- |
| `derived_market_snapshots` | Method, scope, report, content-addressed identity |
| `derived_history_versions` | One row per contiguous **observed hash episode** within the snapshot; source/hash, first/last seen, fetch count, left-censoring |
| `derived_history_values` | One raw asset History payload per `(snapshot, version, asset)` |
| `derived_market_features` | One feature row per raw observation, referencing the scoped History version; no sales-volume measurements |

History version ordinals are **snapshot-scoped**, not universal provider version numbers. Always join with `snapshot_id`. Hashes provide content identity across snapshots; an observed A→B→A sequence produces three episodes, with the first and third sharing a hash. Identical repeated hashes retain one episode/version. Missing hash metadata produces a null version for that run; unknown intervals cannot prove the provider did not change and revert between fetches. The report exposes missing hashes. Its longest unchanged sequence counts observed identical hashed fetches, not a guarantee of continuous upstream immutability.

Every feature retains raw observation/asset/run ID, scheduled window, observation time, Items source timestamp/age, History hash/version, `history_changed`, and `history_age_seconds`. The first observed History version has `history_changed=null`, not a fabricated change; subsequent known versions change only on a different hash. `history_age_seconds` is elapsed time since first seen in this bounded input, **always a lower bound on upstream age**. The first version is left-censored. History has no separate authoritative source timestamp; `source_timestamp` stays NULL rather than borrowing Items timestamps.

Published rolling-period sales values are deliberately **absent from the five-minute feature payload**. Their only new analytical home is the version/asset dimension. Use that dimension directly for History measurement counts and comparisons. Do not sum published 24h volumes across versions or interpret them as five-minute transactions. A dimension join can repeat a value for display, but does not create more measurements. Database checks reject common attempts to put volume fields directly into the feature table, and generated feature types/engine never do so.

This contract prevents the new feature path from supplying repeated five-minute volume measurements. It cannot make arbitrary SQL against the intentionally preserved legacy raw tables impossible; legacy analytics consumers must explicitly adopt the versioned contract. No existing consumer was silently switched in this phase.

## Feature definitions

Prices/changes/means use decimal arithmetic and return decimal strings (12 decimal places for feature arithmetic). Logarithms and standard deviation use double precision after a decimal price ratio; outputs are fixed to 12 places. No annualization, risk-free rate, normality assumption or CS2 execution-price assumption is introduced.

**Historical endpoints:** choose the nearest valid earlier observation within ±90 seconds of `current observed_at − horizon`; ties choose the earlier candidate. Only observations before the current one are eligible. The tolerance is under half the five-minute cadence, so a missing immediate bucket cannot be replaced by a ten-minute-old row. Clock jitter does not require exact timestamp equality. Price baseline observation IDs are emitted for auditability. Null prices skip the endpoint; zero prices are observations, but a zero denominator yields NULL percentage return.

| Features | Definition |
| --- | --- |
| `min_price_change_abs_5m`, `median_price_change_abs_5m` | Current minus eligible prior listing statistic |
| Corresponding `*_change_pct_5m` | `100 × (current/prior − 1)`; NULL for absent/zero prior |
| `min_price_return_{15m,1h,6h,24h}`, median equivalents | Same percentage formula at the named eligible horizon; values are percent, not fractions |
| `listing_qty_delta_{5m,1h}` | Current minus eligible previous venue listing count |
| `listing_qty_pct_change_{5m,1h}` | `100 × delta/prior`; NULL for zero prior |
| `listing_qty_rolling_{min,max,avg}_{1h,6h,24h}` | Statistics of available observations in `(current scheduled window − horizon, current scheduled window]` |
| `rolling_observation_count_*`, `rolling_expected_count_*` | Expose actual/expected coverage of those listing averages; partial samples are not disguised as complete |
| `market_activity_score` | `100 × (minimum-price transition count + listing-count transition count)/(2 × valid adjacent pairs)` over 1h; range 0–100; NULL unless all 12 pairs exist |
| `realized_volatility_{1h,6h,24h}` | `100 × sample_stddev(log(current min_price / prior min_price))` over respectively 12, 72, 288 adjacent five-minute pairs |

Volatility uses **minimum listing price**, not executions. A valid pair requires adjacent scheduled buckets, increasing observation time with at most 90s interval jitter, and two positive minimum prices. Unchanged positive prices contribute log return zero and remain in the sample. Zero/nonpositive prices, missing rows, and gaps invalidate that pair. Volatility is NULL unless the entire horizon's expected number of pairs is present; `volatility_return_count_*` discloses coverage. Sample standard deviation divides by `n−1`. Thus a 24h value needs 289 correctly spaced observations (24 hours of returns), not just 288 rows at the left edge of a 24-hour report.

Activity uses observed transitions, not bid/ask spread, traded depth, circulating supply or execution liquidity. One constant positive percentage price trend can have zero standard deviation of returns; that does not mean zero price movement. No forward-looking claim is attached to rankings.

## Commands / migration

Environment variables are explicit and have no fallback to the application's credentials:

- `MARKET_ANALYTICS_SOURCE_URL`: existing raw database to **read**, preferably via a read-only database role. Driver sets default read-only and opens REPEATABLE READ READ ONLY. Pool max 1, 60s statement timeout, 10s connection timeout.
- `DERIVED_MARKET_DATABASE_URL`: separate writable destination, required only for migration or `--persist`. Do not point at a production raw/product/catalog database. A same-host/database source/target configuration is rejected for the job; operators must also account for alternate host aliases.

The migration uses the repository's isolated SQL/checksum migration pattern, an advisory transaction lock and a checksum ledger. It only creates the four derived tables and one `(snapshot_id,asset_id,observed_at)` index. Primary keys index snapshot/observation and History references. No raw-table index changes, rewriting, deduplication, compression or retention are performed. Existing source/time, run/asset and observation/time indexes are reused; benchmark before adding a source-window index.

After reviewing the explicit destination:

```sh
DERIVED_MARKET_DATABASE_URL='<isolated derived database>' npm run db:migrate:derived
```

Read-only last-24h health:

```sh
MARKET_ANALYTICS_SOURCE_URL='<raw database read-only URL>' npm run analytics:health
```

Frozen experiment seven-day report, **only after 2026-09-16 17:55 UTC**:

```sh
MARKET_ANALYTICS_SOURCE_URL='<raw database read-only URL>' npm run analytics:report -- \
  --from 2026-09-09T17:55:00Z --to 2026-09-16T17:55:00Z \
  --universe reports/collection-experiment.json \
  --out reports/derived-market/production-seven-day-2026-09-16
```

Add `--persist` and the explicit destination URL to generate a persisted read model from that same bounded input. Without `--persist`, no destination connection or write occurs. Parent insertion serializes concurrent identical jobs; the parent, versions, payloads and features commit atomically. Reruns perform no duplicate inserts. Changed input creates a different snapshot; retention/garbage collection is deliberately deferred.

For the shortest useful persisted dataset with a complete 24h feature horizon, provide more than 24 hours of observations. The same commands can run with an explicit historical `--from`/`--to` for reproducibility. Do not reschedule the collector or add these commands to its request handler. No background job is enabled by this implementation.

## Operational report and exit contract

Reports include expected/claimed/successful windows, run statuses/errors, missing windows, duplicate integrity, per-window assets and per-asset coverage; collector duration p50/p95/p99/max and daily trends; Items freshness p50/p95/p99/max with outlier observation IDs; History hashes/observed change timestamps/intervals/version fetch counts/longest observed unchanged sequence; per-asset min/median price and listing transitions, unchanged percentages and min/max/mean prices/quantities; and descriptive rankings.

Transition frequencies use adjacent **scheduled** buckets only. Price frequencies exclude pairs with a missing price; unchanged percentages require both price statistics on both endpoints. The report discloses these denominators, and numeric-equivalent decimal strings do not count as changes. Unchanged percentage compares the three observed fields (minimum price, median price, listing quantity); it is not a claim that every possible market attribute stayed unchanged. Ranking frequency is whole-scope; activity and volatility rankings use the final observation's rolling value (NULL is omitted). Daily buckets split at UTC midnight, with partial first/last days explicitly bounded.

Health command exit codes:

- **0:** no defined operational failure.
- **1:** missing expected windows; non-success claimed runs; duplicate windows/run-asset rows; wrong per-window asset coverage; observations attached to unclaimed runs; observations outside their own bucket; HTTP ≥400/schema errors; Items age outside 0–900 seconds; missing/negative/≥300000ms collector duration.
- **2:** invalid configuration/scope, future boundary, query/write failure, safety/input limit, or inconsistent History payload under an unchanged hash. These mean the command could not successfully complete, not that unchanged market data is unhealthy.

Ordinary `analytics:report` writes its PASS/FAIL assessment and exits 0 when the report completed, even when it describes operational failures. Automation requiring health semantics must use `analytics:health`. Unchanged assets, identical History, missing historical feature endpoints and absence of predictive evidence are never health failure criteria.

## Storage methodology

`npm run analytics:storage` writes a timestamped measurement without creating a destination connection. The report command includes the same measurement separately from its historical observation window.

Measurements contain repeatable-read logical snapshot time, physical measurement time, total row count, heap bytes, table bytes including TOAST, TOAST including its index, observation index bytes, total observation bytes, collector-run total bytes, sum of metadata datum sizes, and total bytes per observation row. TOAST is a subset of table storage: do not add it twice. Metadata datum size is not its complete physical storage allocation.

Keep snapshots at explicit recorded times to compare future measurements. Row counts within each capture are transaction-consistent, but physical relation size functions are non-MVCC and concurrent writers can move them. Therefore a precise physical delta at an arbitrary historical boundary cannot be reconstructed from the current database without stronger isolation/measurement infrastructure. V1 does not block collector writes to pretend otherwise. Compare actual capture timestamps, retain duration/uncertainty and never label the capture time as an earlier report-end timestamp. Whole-table growth also includes any legitimate rows outside a bounded report.

The original production baseline and 24-hour report are preserved unchanged under `reports/collection-24h-2026-09-10/`. No dollar projections are produced. Provider metering/pricing, actual storage costs and future daily growth trends are not inferred from local fixtures.

## Validation and examples

- **196 tests pass across 23 files**, including 13 new derived-market tests: decimal/zero/NULL changes, jitter/endpoints, missing windows/assets, complete rolling volatility and quantity statistics, unchanged rows, hundreds of identical History fetches, one change, A→B→A, unknown hashes, payload/hash conflicts, duplicate raw/window safety, scheduled-bucket validity, freshness, bounded seven-day output and idempotent migration/persistence.
- Full TypeScript and ESLint pass.
- Actual local PostgreSQL source/destination verification: additive migration applied locally; repeated identical job produced one snapshot, 864 features and three History payload rows (one unchanged version for each of three assets).
- CLI exit verification: healthy=0, missing-window=1, future report=2, storage measurement=0. `reports/derived-market/cli-verification.json` preserves results.
- `reports/derived-market/seven-day-fixture-example.json`: complete **synthetic**, not production, seven-day example; 2016 runs, 6048 observations, three assets, two observed History versions.
- `reports/derived-market/local-cli-example.json`: PostgreSQL command example over a completed 24-hour slice of the synthetic source; it is NOT additional production evidence.

The seven-day fixture deliberately spans future dates relative to implementation day; direct pure-function tests use it to exercise boundaries. The actual CLI correctly refuses to call that future interval a completed report. A complete real production seven-day report cannot exist before September 16 at 17:55 UTC.

For a repeatable optional local demonstration, create an empty local database named `floatalpha_derived_fixture` on the existing local test server, then set `DERIVED_FIXTURE_URL` and run `node --import tsx tests/fixtures/derived-market/seed.ts`. This script requires loopback and the exact fixture database name, refuses an existing schema, and is never called by the collector or normal tests. All displayed fixture names are explicitly synthetic.

## Limits and deliberately deferred work

The job bounds input to seven days, at most 1000 named assets, 10000 run records and 250000 observations. At the approved 100 assets, seven days is 201600 observations and fits the record bound. It loads that bounded input into memory and computes per asset; this is an offline job, not a request-path view. Full-scale seven-day CPU/memory/egress has not been benchmarked on production, so increasing the universe is not authorized by this implementation. The existing source read includes repeated raw History payloads for consistency checks; SQL/streaming optimizations can follow measurement rather than modifying proven collection/storage now.

No global History surrogate IDs, upstream refresh scheduler, raw retention migration, new cron, normalized production raw tables, legacy-screen integration, feature-serving API, trading signals, forecasting, telemetry, or Ops redesign was added. An arbitrary consumer of legacy raw rows can still misuse them; use the explicit versioned contract for new analytics.

**No production data was read or written during this implementation phase.** Local fixtures were seeded and the migration applied only to the isolated local derived database. No production migration, manual backfill, provider setting, universe, deployment or collector cadence was changed. Nothing has been committed or deployed automatically.

## Product integration compatibility

The product integration increments the method from `listing-features-v1` to `listing-features-v2` to include `min_price`, `median_price`, and `listing_qty` in each feature. All existing descriptive calculations and raw collector semantics are preserved. Regeneration produces a new immutable snapshot ID; no existing snapshot is rewritten and no SQL migration is needed. Product readers require v2 and an explicitly selected snapshot. See [Product intelligence](../product/INTELLIGENCE.md) for configuration and validation.
