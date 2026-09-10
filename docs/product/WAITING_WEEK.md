# Waiting-week implementation and operator runbook

September 10–16, 2026. All work and evidence here are local. Production collection remains unchanged. This phase adds no migration, scheduler, automatic snapshot pointer, prediction, or deployment.

## Product changes

Screener shows a compact qualification line beside each asset, the applied sort and direction, and the actual page count. Out-of-range pages clamp after filtering. Tables retain horizontal scrolling and are keyboard-focusable on small screens. Preset thresholds remain visible; unavailable metrics stay unavailable.

Terminal, Screener, Assets, Asset Intelligence, Portfolio and Watchlist share a snapshot strip: data-as-of scope end, snapshot age, stale state, method, creation/persistence timestamp, read-time clock and explicit snapshot ID. A snapshot is stale after 900 seconds past its scope end. This is independent of an individual asset's source freshness. Quality panels distinguish **current source age**, **observation age**, and **captured source age at collection**. Fixture mode uses a labeled fixed simulation clock.

The product reader and operator tools share method/scope/metadata validation. Unsupported methods, missing creation/universe metadata and malformed feature timestamps fail visibly. Detail reads enforce supported horizons and reject rows outside their asset/horizon scope. No database failure falls back to fixtures.

Watchlist now supports the same search/filter/sort controls, an empty-state instruction, and a separate missing-data notice that does not confuse filtered-out entries with unavailable assets. Portfolio explicitly labels partial valuations. Editing an existing holding keeps its identity fixed and remains possible when its current market reference is unavailable. Authentication and mutation endpoints are unchanged.

## Local manual snapshot workflow

Prerequisites: local analytics database already migrated with the existing derived schema; `DERIVED_MARKET_DATABASE_URL` points to that database. These CLI review/selection commands refuse remote hosts. The receipt is an operator checkpoint, not a signed authorization credential.

1. Generate and persist a bounded candidate using `npm run analytics:report`. Source and destination must be separate databases. The report CLI uses a read-only source transaction. For local rehearsal, use the existing isolated `floatalpha_derived_fixture` source and `floatalpha_derived_v1` destination on port 55438.
2. Review the candidate and optionally export its feature contract. Explicitly label the evidence:

```sh
npm run analytics:snapshot -- \
  --id <candidate-id> --evidence SYNTHETIC \
  --out reports/waiting-week/candidate-review.json \
  --export reports/waiting-week/candidate-export.json
```

The receipt includes scope, expected/observed assets and rows, coverage, method, generation/persistence time, review time, current snapshot/source/observation age, captured source-age distribution, History-version count, warnings and a candidate-content fingerprint. Stale or partial data is reported, not silently promoted to full/fresh data. Missing required metadata and unsupported methods fail.

3. Inspect the receipt and warnings. Select that exact ID explicitly:

```sh
npm run analytics:snapshot -- \
  --id <candidate-id> --evidence SYNTHETIC \
  --select-reviewed reports/waiting-week/candidate-review.json \
  --env-file .env.local
```

Selection re-reads the candidate and checks the receipt's ID, evidence and content fingerprint. A mismatch does not change configuration. The command writes only the local analytics URL, database mode and selected ID, preserving other environment settings. It accepts `.env.local` or `.env.snapshot.local`; the latter is an operator configuration snippet, not automatically loaded by Next. Credentials are not printed. Reload/restart the local server as necessary.

4. Open `/screener` and Asset Intelligence. Check that the displayed ID/scope match the receipt, metrics render, and stale/partial states remain visible.
5. For a newer candidate, repeat generation and review; explicitly select its ID. There is no query for a mutable latest snapshot. Rollback means explicitly selecting the previously reviewed ID again.
6. Restore local synthetic preview by restoring the previous `.env.local`, or explicitly setting `PRODUCT_ANALYTICS_MODE=fixture` for development. Production rejects fixture mode.

Rehearsal artifacts: `older-review.json` (864 observations), `newer-review.json` (867 observations), and `operator-workflow.json`. The local workflow test switches older → newer → older → newer, renders Screener and asset detail after each change, rejects a mismatched receipt, and restores the original `.env.local` and fixture preview. It is opt-in:

```sh
node scripts/check-snapshot-workflow.mjs
```

Database-backed evidence means a selected database snapshot, not proof that its contents are production observations. The operator must label exported research evidence accurately. Rehearsal database contents and all current screenshots are synthetic.

## September 16 reporting path

Do not execute the real seven-day analysis before **2026-09-16 17:55 UTC**. After that boundary, use the existing approved 100-asset manifest and read-only production source connection to generate the bounded report into an isolated local analytics database:

```sh
npm run analytics:report -- \
  --from 2026-09-09T17:55:00Z --to 2026-09-16T17:55:00Z \
  --universe reports/collection-experiment.json \
  --out reports/derived-market/production-seven-day --persist
```

Set `MARKET_ANALYTICS_SOURCE_URL` to the explicitly approved read-only source and `DERIVED_MARKET_DATABASE_URL` to the isolated destination before running. No production migration or write is part of that command. Inspect operational failures and data coverage before interpretation.

Review/export the resulting local snapshot using `analytics:snapshot --evidence OBSERVED`. Export contains method/scope/evidence, feature rows and History-version count, not provider History payloads. Then:

```sh
npm run analytics:research -- --input <observed-export.json> \
  --mode rank --out reports/derived-market/seven-day-rankings

npm run analytics:research -- --input <observed-export.json> \
  --mode explore --horizon 1h --out reports/derived-market/seven-day-exploration
```

Observed research input is rejected before the boundary and unless its scope exactly matches the September 9–16 experiment. Synthetic tests bypass the date gate with explicit synthetic output labels. Research commands are offline file readers; they have no network, database writes, schedule or product import.

Rank output includes JSON plus CSV: activity and volatility means with eligible sample counts; price/listing transition frequencies with exact consecutive-pair denominators; coverage; captured source-age p95; deterministic rankings with unavailable values last. Gaps do not count as unchanged pairs.

Comparison requires two explicit exports of the same evidence class:

```sh
npm run analytics:research -- --input <older-export.json> \
  --against <newer-export.json> --mode compare \
  --out reports/derived-market/snapshot-comparison
```

Both scopes are retained. Missing metrics produce null differences, not zeros. Different scopes and sample completeness must be considered when interpreting differences.

## Dormant exploratory methodology

Supported future horizons: 1h, 6h, 24h. Relationships are calculated per asset:

- Trailing 1h listing percentage change at T → minimum listing-price return from T to T+n.
- Activity score at T minus its score at T−1h → sample standard deviation of price log returns over the subsequent n-hour window.
- Trailing 1h minimum-price return at T → listing-quantity percentage change from T to T+n.

Features at T contain no future outcome input. Outcomes require exact consecutive scheduled buckets through T+n, remain inside the exported scope, and are not interpolated. Missing anchor metrics, missing/invalid future data, and captured source ages over 900 seconds at the anchor/outcome points are excluded and counted. Zero is retained when valid; nonpositive prices cannot support log returns.

Outputs report per-asset Pearson correlations and sample counts for all eligible overlapping outcomes and for a non-overlapping subset anchored to the snapshot start. Fewer than three pairs or zero variance returns null. Even non-overlapping outcomes may retain serial dependence. These are exploratory associations, without p-values, causal claims, forecasts, cross-asset pooling or product classifications. Synthetic values only test the implementation; they provide no market evidence.

## Validation

- Semantic tests cover read-time ages, invalid metadata, scope limits, duplicate windows, exact review fingerprints, explicit selection, pagination, qualification text, observed-data time gates, missing metrics, future-data isolation, gaps, stale exclusions and correlation completeness.
- `scripts/check-waiting-week.mjs` exercises 40 asset/horizon/viewport combinations and four major list/personal routes at both widths. Active, quiet, gapped, stale and insufficient-history cases are explicitly synthetic.
- `reports/waiting-week/browser.json`: no document overflow, hydration errors or anonymous watchlist requests.
- `reports/waiting-week/protected-verification.json`: original collector/provider/raw-schema/schedule/universe hashes are unchanged from this workstream's preflight.
- Full test/build/lint results and workflow status are recorded in `validation.json`.

No real seven-day report or production research conclusion is claimed by this phase.
