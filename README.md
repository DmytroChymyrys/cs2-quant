# cs2-quant

A data feasibility POC: can we collect, validate, persist and audit CS2 market snapshots reliably and cheaply enough to justify a larger product? This is an internal backend with a minimal landing page. It has no trading, portfolio, accounts, AI or recommendation features.

## Architecture

```text
cron-job.org (POST every five minutes, Bearer secret)
  -> Next.js / Vercel Node.js route
  -> create audited run and claim source/window
  -> Skinport items + sales/history (two concurrent market-wide requests)
  -> lossless JSON -> Zod -> canonical name matching -> numeric normalization
  -> Neon HTTP / Drizzle atomic batch
       -> append-only market_observations
       -> collector_runs final status
  -> protected health and asset-history JSON endpoints
```

External fetches run outside database transactions. No persistent connection pool, internal scheduler, Vercel Cron or WebSocket worker is needed. Adapter code lives in `src/lib/sources/skinport`; core tables represent observations from a source, not a canonical fair market value.

## Setup

Use Node.js 22.12+ (tested with 24.7) and npm. Dependencies are locked in `package-lock.json`.

```bash
npm ci
cp .env.example .env
```

Create a Neon PostgreSQL project and copy its connection string, including `sslmode=require`, into `DATABASE_URL`. Use a dedicated POC database. Generate a random `CRON_SECRET`, for example with `openssl rand -hex 32`, and put it in `.env`. Never put secrets in query strings or `NEXT_PUBLIC_*` variables.

| Variable | Default / purpose |
| --- | --- |
| `DATABASE_URL` | Required for database operations; Neon PostgreSQL URL |
| `CRON_SECRET` | Required for authenticated HTTP requests; use a long random token without whitespace |
| `SKINPORT_CURRENCY` | `USD`; other currencies are rejected to prevent mixing datasets |
| `SKINPORT_REQUEST_TIMEOUT_MS` | `20000`, allowed 1000–30000 ms per source request |
| `SOURCE_STALE_AFTER_MINUTES` | `15`; observation freshness threshold |

Configuration is validated on use, so building does not require production secrets. CLI scripts load `.env`; Next.js also supports `.env.local`. Put CLI variables in `.env` or export them in the shell.

```bash
npm run db:migrate
npm run discover -- Case
# Review config/candidates.json; copy roughly 100 approved entries into
# config/tracked-assets.json. Then:
npm run seed
npm run dev
```

Migrations are checked in. For schema changes run `npm run db:generate -- --name=descriptive_change`, review generated SQL, then `npm run db:migrate`. The second migration adds database protection against updating, deleting or truncating observations. Migrations are explicit deployment steps, never request-time synchronization.

### Selecting assets

`config/tracked-assets.json` intentionally starts empty. Discovery performs one market-wide items request, searches a keyword, displays the top 100 matches by quantity, and exports all matching **unversioned** candidates to a gitignored file. It never tracks assets automatically. Wait at least five minutes between discovery, seed and collection requests, since these tools share the upstream rate budget.

Each approved entry contains `marketHashName` copied exactly from discovery and optional nullable `category`. Aim for about 20 cases, 20 capsules/stickers, 30 liquid weapon skins, 15 knives and 15 gloves. Category labels are manually supplied; naming conventions are not heuristically parsed. Seed accepts 1–200 unique names, verifies them against a fresh unversioned and unambiguous items snapshot, and atomically upserts assets and Skinport mappings. The list is authoritative: removed entries become untracked, preserving their UUIDs and history. An empty list is rejected to prevent accidental untracking of everything.

Collection with no tracked assets remains auditable and reports `PARTIAL / NO_TRACKED_ASSETS`; it is not evidence of successful coverage. Do not schedule until the list is approved and seeded.

## Discovery report before deployment

The generated [discovery summary](reports/discovery-summary.md) covers both saved Skinport snapshots, including exact row/name counts, duplicate-name groups versus excess duplicate rows, versioned and ambiguous exclusions, heuristic category counts, representative duplicate groups, and snapshot hashes. [Complete duplicate details](reports/discovery-details.json) preserve all original source fields and numeric tokens for every duplicate group.

```bash
npm run discovery:report -- /tmp/cs2-quant-items.json /tmp/cs2-quant-history.json
# Optional third argument selects the output directory.
```

This command reads saved snapshots and does not fetch or track anything. Categories are name heuristics, not authoritative Skinport taxonomy. `market_hash_name` is not unique across the full snapshots. The observed `(market_hash_name, version)` pairs have no collisions, but that alone does not establish a durable identifier. Discovery and seeding exclude all versioned rows and names with multiple unversioned rows; the collector deliberately fails visibly if unversioned duplicates appear. The initial POC can retain its restricted identity model while variant identity remains a separate decision.

## Proposed 100-asset universe

The full [100-asset proposal](reports/poc-100-assets.md) is for review, not automatic activation. It contains 20 cases, 20 stickers/capsules, 30 weapons, 15 knives and 15 gloves, retaining all five smoke-test names. Each explicitly selected name has a reason and live snapshot price, quantity and sales-volume evidence. Activity labels are disclosed category-relative sales-volume bands, not a liquidity score. All candidates are checked for exactly one unversioned Items and History row.

The proposal lives in `config/poc-100-proposed.json`; the active seed input `config/tracked-assets.json` still contains only five names. To regenerate the offline report from its recorded snapshots:

```bash
npm run poc:report -- /tmp/cs2-quant-poc-items.json /tmp/cs2-quant-poc-history.json
```

The report validates source hashes against `reports/poc-100-snapshot-provenance.json` and performs no database writes. After explicit approval, revalidate names against fresh source data before changing the seed input. The earlier finding about `(market_hash_name, version)` remains unchanged; no versioned rows are enabled.

## Source behavior and live verification

The adapter uses Skinport's public [items](https://docs.skinport.com/items) and [sales history](https://docs.skinport.com/sales/history) documentation. Both requests use `app_id=730`, `currency=USD`, `Accept-Encoding: br` and no authorization. Items explicitly uses `tradable=1`; this experiment measures tradable listings. History omits `market_hash_name` to retrieve the market-wide dataset. Node fetch decompresses Brotli. No retry loop hides rate limits or multiplies requests. HTTP 429, other HTTP failures, timeouts, malformed JSON and schema drift receive distinct diagnostics.

**Live discrepancy verified September 9, 2026:** both endpoints include `version`, and multiple rows can share a `market_hash_name`. The observed items response had 25,425 rows, including 25,065 unversioned rows. History had 36,864 rows, including 35,890 unversioned rows. Named variants included Doppler phases, Ruby and Blue Gem. Counts are observations, not guaranteed universe sizes.

The POC uses only null/absent-version rows; it does not combine variant prices, invent weighted aggregates or select an arbitrary variant. Excluded row counts are recorded per run. Discovery and seed use the same rule. If an approved name later appears only as a variant, coverage becomes partial. Supporting variants requires a deliberate identity extension in a future phase. Duplicate names remaining after filtering fail visibly. Both full live payloads passed the implemented runtime schemas; raw downloads stayed outside the repository. The first curl attempt returned HTTP 200 but local curl lacked Brotli decompression; Node fetch successfully verified both payloads.

Zod validates critical field presence and types, nonnegative counts, USD currency, URL metadata, timestamps and all four history periods. Unknown metadata is retained. Legitimate null prices and zero listings remain valid. A malformed required row fails the entire payload, including an untracked row, so schema drift cannot silently pass. Named variants still undergo validation before exclusion.

### Money, timestamps and provenance

Money uses PostgreSQL `numeric(20,8)`, exposed to TypeScript as fixed-scale decimal **strings**. `lossless-json` preserves numeric tokens before conversion; `decimal.js` validates and performs percentage calculations. Values beyond the chosen range/scale fail instead of rounding. Counts and epoch seconds are validated integers before conversion to JS numbers. Never convert monetary strings to JS numbers for arithmetic.

`observed_at` is our time after both responses arrive. `source_created_at` / `source_updated_at` are Skinport epoch-second metadata. Per-endpoint fetch start/end times are stored in run metadata so request skew is inspectable. The two cached upstream datasets are approximately synchronized, not an atomic market snapshot.

Each observation stores the matched item and history JSONB, including extra metadata; prices in this provenance are normalized exact decimal strings and unknown numeric metadata is retained as decimal text. These are faithful field-level provenance, not byte-for-byte original HTTP bodies. We store only matched rows, not the entire universe per asset. Raw history is null when absent. This modest duplication is intentional for the 100-asset audit experiment; measure its storage cost before changing retention.

## Database schema

| Table | Purpose / constraints |
| --- | --- |
| `assets` | Stable UUID, unique market hash name, nullable category/weapon/skin/wear/StatTrak/Souvenir/rarity/collection metadata, tracked flag, audit timestamps |
| `asset_source_mappings` | Asset FK, source, source item ID/name, timestamps; unique asset/source, source/name and source/item ID |
| `collector_runs` | UUID, source/window claim, start/end/status, both HTTP statuses and counts, tracked/matched/missing/inserted counts, latency, safe errors, JSONB diagnostics |
| `market_observations` | Asset/run FKs, source, observed time, USD, five market prices, quantity, two source timestamps, min/max/avg/median/volume for 24h/7d/30d/90d, matched provenance, creation time |

See `src/lib/db/schema.ts` and `drizzle/` for complete definitions. History access uses `(asset_id, source, observed_at DESC)`, source/time and source/run-time indexes. The unique `(collector_run_id, asset_id)` index also serves run inspection. Foreign keys do not cascade-delete history.

## Collection and duplicate handling

```bash
# Export the same CRON_SECRET configured in the application, then:
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/internal/collect/skinport
```

Authorization requires an exact Bearer token; SHA-256 token digests are compared in constant time. Missing, incorrect or malformed authorization returns 401 before database/source work. Secrets, headers, upstream bodies and raw driver exceptions are never logged or returned.

Each authenticated invocation first tries to insert a `RUNNING` run with a unique `SKINPORT:<UTC five-minute window>` claim. Concurrent duplicates create their own `PARTIAL / DUPLICATE_WINDOW` audit row with no claim and no source requests or observations. Only one claimant can own a logical window, including after failure; retrying a failed window does not replay it. Distinct windows keep snapshots even if prices are unchanged. Keep the cron schedule fixed at five-minute spacing; the window claim is an idempotency guard, not a rolling rate limiter for arbitrary manual calls at window boundaries.

Both endpoints must fetch and validate successfully to persist observations. Missing items or unversioned history yields PARTIAL with exact names in metadata; existing no-listing states can yield SUCCESS. Observation insertion and terminal status/counts use one atomic Neon HTTP batch. After that batch is acknowledged, the collector captures `finished_at` and `duration_ms` and writes those telemetry fields once. The duration includes the final observation/status database write; it excludes the subsequent write that stores the timing measurement itself and HTTP response delivery. FAILED runs are timed after their failure-status persistence; duplicate attempts are timed after their audit insertion. Completion timestamps are immutable on retry. If the process dies between data commit and telemetry stamping, the terminal run can have null timing fields; the stored data/status remain authoritative. The application never updates observation rows, and a database trigger rejects UPDATE/DELETE/TRUNCATE. A database owner can deliberately alter that protection; it is an accident guard, not tamper-proof archival storage.

Run start/end logs contain structured JSON with run ID, timestamps, duration, source statuses and all coverage/write counts. Failed writes are followed by an attempt to mark a still-RUNNING run FAILED. Terminal run status cannot be overwritten by that fallback: if a batch committed but its HTTP acknowledgement was lost, the collector reads the persisted outcome and preserves SUCCESS/PARTIAL. If the database itself is unavailable, durable auditing is necessarily unavailable; the endpoint returns 503 with a safe error. A killed Vercel invocation can leave RUNNING behind. Health exposes old RUNNING runs as `abandoned`; inspect Vercel logs and the run before manually marking it FAILED. Claims are not automatically recycled.

### cron-job.org / Vercel

1. Deploy this repository as a Next.js project on Vercel with the five environment settings above. No `vercel.json` cron entry is needed.
2. Apply migrations and seed the approved list using the same Neon database before enabling collection.
3. In cron-job.org create a job for `https://YOUR-DEPLOYMENT/api/internal/collect/skinport`.
4. Select **POST**, add `Authorization: Bearer <your configured secret>` as a header, and schedule every five minutes.
5. Set a scheduler request timeout compatible with the function's 60-second maximum and available cron-job.org plan. Disable rapid automatic retries. Deployment protection, if enabled, must allow the scheduler through separately.

SUCCESS and PARTIAL return HTTP 200, with JSON such as `{"collectorRunId":"…","status":"SUCCESS","trackedAssets":100,"itemsMatched":100,"itemsMissing":0,"observationsInserted":100,...}`. A duplicate includes `"skipped":true` and `"errorCode":"DUPLICATE_WINDOW"`. FAILED source/collection runs return 502; unavailable infrastructure returns 503. Cron HTTP success alone does not establish data quality: inspect JSON statuses and health.

## Inspection and metrics

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/internal/data-health
curl -H "Authorization: Bearer $CRON_SECRET" \
  'http://localhost:3000/api/internal/assets/ASSET_UUID/history?from=2026-09-09T00:00:00Z&to=2026-09-10T00:00:00Z'
```

Health returns the last claimed run, 24h status counts/fractions, mean/p95 latency, runs with 429/5xx/malformed payloads, RUNNING/abandoned counts, expected and missing scheduled windows, current tracked/stale counts, last-run coverage, recent row count and total observation table/index bytes. Duplicate audit attempts are excluded from scheduled-run denominators. Empty denominators return null. Missing-window count assumes a full day of scheduling; during initial deployment or planned pauses it overstates missed work. HTTP metrics count affected runs, not individual failing requests.

An asset is stale only when its newest marketplace observation is strictly older than the configured threshold; never-observed tracked assets are stale. This is collector freshness, distinct from Skinport source freshness or missing history. Health has latest-run missing names in metadata. Table bytes include all historical data and indexes; differences between successive readings estimate growth, not the 24h byte footprint directly.

The asset endpoint returns latest observation, history and POC summary. History defaults to 24h, allows at most 31 days and caps at 10,000 rows (above the maximum five-minute snapshots for that range). Internal functions `getLatestObservation`, `getAssetHistory` and `getAssetPocSummary` are in `src/lib/analytics.ts`. Summary compares the **first and latest minimum listing prices**, quantities and latest 24h sales volume. Null prices remain null; percentage changes with a zero/null baseline are undefined (null). Missing intervals count gaps between first and latest occupied five-minute windows; they exclude time before the first/after the latest observation and treat deliberate untracking inside that span as a gap. They are not an uptime SLA.

### Inspect the first real collection

After the first authenticated POST against the deployment, run:

```bash
npm run inspect:collection
# For the explicitly approved five-asset smoke test only:
npm run inspect:smoke
```

This executes the two review queries in [sql/inspect-collection.sql](sql/inspect-collection.sql): the ten latest collector runs, then observation counts and first/last observed times grouped by asset. It prints results and saves `reports/collection-inspection.json`. An empty result is not a successful smoke test. Verify a real SUCCESS/PARTIAL run, the source statuses, matched/inserted counts, and an observation for each approved asset before considering a commit. The script is read-only and never triggers collection.

### Useful SQL

```sql
-- Find tracked UUIDs.
SELECT id, market_hash_name, category FROM assets WHERE is_tracked ORDER BY market_hash_name;

-- Inspect one asset (replace the literal UUID).
SELECT observed_at, min_price, quantity, sales_24h_volume, source_updated_at
FROM market_observations
WHERE asset_id = '00000000-0000-4000-8000-000000000001' AND source = 'SKINPORT'
ORDER BY observed_at;

-- Diagnose partial/failed/unfinished runs, including duplicate attempts.
SELECT id, started_at, status, error_code, items_http_status, history_http_status, metadata
FROM collector_runs WHERE status <> 'SUCCESS' ORDER BY started_at DESC LIMIT 100;

-- Daily growth and measured average row bytes (sampling all rows here; use a time range as it grows).
SELECT date_trunc('day', observed_at) AS day, count(*) AS observations,
       avg(pg_column_size(o)) AS average_row_bytes
FROM market_observations o GROUP BY 1 ORDER BY 1;

-- Source freshness, separate from collector freshness.
SELECT a.market_hash_name, o.observed_at, o.source_updated_at,
       o.observed_at - o.source_updated_at AS source_age
FROM assets a JOIN LATERAL (
  SELECT observed_at, source_updated_at FROM market_observations
  WHERE asset_id=a.id AND source='SKINPORT' ORDER BY observed_at DESC LIMIT 1
) o ON true WHERE a.is_tracked;

-- Verify that one source/window has at most one claimant.
SELECT source, window_start, count(*) FROM collector_runs
WHERE claim_key IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;
```

At five-minute intervals there are 288 snapshots/day/asset:

| Assets | Rows/day | Rows/30 days |
| --- | ---: | ---: |
| 100 | 28,800 | 864,000 |
| 1,000 | 288,000 | 8,640,000 |
| 10,000 | 2,880,000 | 86,400,000 |

Health also projects using the latest received universe size (including excluded variants, therefore an upper-bound scenario for this identity model). Multiply measured row/index growth by projected counts to estimate storage; account separately for Vercel duration, Neon compute, indexes, retained provenance and network transfer. Row counts alone do not establish service capacity or cost. Validate actual bills and latency over several days.

## Validation

```bash
npm test
npm run typecheck
npm run lint
npm run build

git status --short
```

Vitest uses mocked HTTP only. Embedded PostgreSQL (PGlite, a development-only dependency) applies the real migrations and checks exact numeric storage, unique claims, transaction rollback and append-only protections. Unit tests cover authorization, schema/money/timestamp normalization, missing data, HTTP/network errors, matching, variant exclusion, unchanged snapshots, concurrent duplicates, write counts, health fractions and staleness boundaries. Live payload inspection is separate from tests. A successful local build requires neither a Neon connection nor source credentials. The dependency audit reports four moderate findings in the development-only Drizzle Kit / legacy esbuild loader chain; production dependencies have no reported findings. The suggested automatic fix downgrades Drizzle Kit incompatibly, so it was not applied. No esbuild development server is used by this POC.

## Experiment criteria and limitations

Run for several days and investigate every failed or partial interval. Targets are approximately ≥99% successful or explainably partial scheduled cycles (known external outages reported separately), ≥98% configured asset coverage, no unexplained duplicate windows/overwrites/malformed money, actionable failure diagnostics, and measured cost extrapolations. Report unscheduled gaps and abandoned runs alongside status percentages. Do not count empty-universe or duplicate PARTIAL rows as proof of reliability.

Skinport REST is cached for approximately five minutes and documented at eight requests per five minutes per endpoint. This does not capture every market event. We track a selected unversioned subset of tradable listings; history is aggregated by Skinport. A single marketplace does not establish fair value, and listing quantity is a supply proxy. No trading conclusions are produced.

WebSocket collection is intentionally deferred: Skinport's [live feed](https://docs.skinport.com/websocket/sale-feed) provides `listed` and `sold`, not price changes/cancellations, and requires a persistent Socket.IO connection with a msgpack parser. A future external worker can contribute source events alongside these snapshots; no speculative infrastructure is implemented. Additional sources and derived analytics require their own verified adapters and identity decisions.

Neon migrations and Vercel deployment are complete. The approved 100-asset universe passed fresh identity validation, production collection, and duplicate-window checks; see [manual acceptance](reports/poc-100-manual-acceptance.md). cron-job.org job 8416189 was saved by the user and its scheduled production execution was observed. The experiment begins 2026-09-09 at 17:55 UTC and its first 24-hour period ends 2026-09-10 at 17:55 UTC; see [experiment record](reports/collection-experiment.json). Scheduler management API access remains unavailable (401), so configuration readback is not independently verified. Historical five-asset reports describe earlier checkpoints, not the current tracked universe.

## Approved 100-asset collection experiment

`config/tracked-assets.json` contains the approved, explicit 100-asset universe from
`config/poc-100-proposed.json`. `node --import tsx scripts/seed.ts --promote-poc`
fetches fresh Items and History together and requires exactly one unversioned row
in each response for every name before promoting the configuration or writing Neon.
Any failed identity check stops activation; no name is replaced or dropped.
The discovered `(market_hash_name, version)` identity finding still applies to the
full source universe. This experiment tracks one canonical unversioned row per asset.

The production collector remains a protected POST at
`/api/internal/collect/skinport`; cron-job.org uses the `CRON_SECRET` bearer header.
`CRON_JOB_ORG_API_KEY` is only needed locally to administer the external scheduler.
After the 100-asset manual test passes, `scripts/configure-cron.ts prepare` creates
or updates a disabled job and records its planned first five-minute UTC boundary.
Set that `COLLECTION_SCHEDULE_STARTED_AT` in Vercel production, redeploy, then run
`scripts/configure-cron.ts enable`. Enablement checks deployed health, the secret
header, POST method, five-minute schedule, and scheduler next execution time.
The experiment record includes actual enablement time and the first scheduled window.
Do not create a second schedule for this endpoint.

Health reports zero expected/missing scheduled windows before configuration. After
configuration it counts only closed windows since the first scheduled boundary,
limited to a rolling 24 hours. The active bucket is excluded while it may still be
running. Manual runs before the experiment and duplicate audit rows do not count
as scheduled claims. Startup part-days therefore do not create fictitious misses.

Successful upstream fetch metadata includes body receipt time, completion of
validation, decompressed response bytes, and SHA-256 of the complete response text.
This measures HTTP/body latency separately from parsing/validation and allows
byte-identical full History responses to be compared across windows. Unchanged
values are valid observations and never fail a run solely because they repeat.

Run `node --import tsx scripts/experiment-report.ts` after the report due time in
`reports/collection-experiment.json`. It performs read-only inspection and writes
`reports/experiment-latest.json` and `.md`. Early reports are labelled interim and
only cover closed windows; the first-day report stops at start + 24 hours. The
report distinguishes claimed-window success rate from expected-window success,
per-endpoint HTTP errors, coverage, nulls, zero sales, value changes, source
freshness, History hashes, and physical database size. Database bytes are not a
substitute for actual Neon billing/usage, which is marked unavailable unless
provider measurements have been supplied. During the first 24 hours collect only;
change behavior only for an actual correctness or reliability problem.
