# Post-7-Day Architecture — Design Only

Design pass for the Post-7-Day Execution Plan §19, based on the frozen seven-day
experiment ([reports/experiment-7d-2026-09-16/REPORT.md](../../reports/experiment-7d-2026-09-16/REPORT.md),
commit `4f6c7ea`).

**This document proposes. It implements nothing.** No production schema, migration,
retention, collector, cron, universe, cadence, Screener, derived-intelligence, API/MCP
or contributor code is changed by this pass. The 100-asset / five-minute collector
continues unchanged toward the 30-day dataset.

Every statement is labelled:

| Label | Meaning |
| --- | --- |
| **CURRENT** | What the repository does today, verified by inspection or measurement |
| **PROPOSED** | Recommended in this design pass, for review |
| **LATER** | Deliberately deferred beyond this design |
| **NOT SUPPORTED** | Evidence does not support it; do not build |
| **REQUIRES SEPARATE APPROVAL** | Must not proceed on this document alone |

---

## 1. Current-state findings

### 1.1 The product is not connected to the evidence

**CURRENT.** This is the central finding, and it reframes the whole workstream.

`src/lib/product/intelligence/server.ts` reads from a **separate analytics database**
(`DERIVED_MARKET_DATABASE_URL`) holding pre-computed, content-addressed snapshots, selected
by an explicit `PRODUCT_ANALYTICS_SNAPSHOT_ID`. It never reads `market_observations`.

- `DERIVED_MARKET_DATABASE_URL` is **unset**; `.env.example` ships `PRODUCT_ANALYTICS_SNAPSHOT_ID=` empty.
- `syntheticDataAllowed()` in `src/lib/preview.ts` returns `false` when `VERCEL_ENV === "production"`.
- Therefore production currently resolves to `unavailable("A reviewed analytics snapshot has not been configured.")`, and local/preview renders fixture or demo data.

**The 201,235 real observations have never reached the Screener or Asset Intelligence.**
Closing that gap — not inventing new analytics — is the substance of the next engineering pass.

### 1.2 The derived engine is strong, and capped at seven days

**CURRENT.** `src/lib/derived-market/features.ts` is a careful, deterministic feature engine:
Decimal arithmetic, ±90s nearest-baseline selection, full-coverage-only realized volatility,
content-addressed snapshot IDs, history versioning with explicit left-censoring. It is good work
and should be kept.

Two hard limits block the 30-day program:

| Limit | Location | Consequence |
| --- | --- | --- |
| `to - from > 7 * 86400000` throws `SCOPE_MUST_BE_ALIGNED_POSITIVE_AND_AT_MOST_SEVEN_DAYS` | `model.ts` `validateScope` | A 30-day snapshot is impossible |
| `derive()` loads all observations in scope into memory | `features.ts` | 30 days × 100 assets = 864,000 rows in one pass |

Also **CURRENT**: `derived_market_features` stores **one jsonb row per raw observation** — a
second full copy of the dataset. At 30 days that is 864,000 feature rows in addition to
864,000 raw rows.

### 1.3 Screener thresholds do not survive contact with real data

**CURRENT.** `THRESHOLDS` in `src/lib/product/intelligence/screener.ts` were calibrated against
synthetic data. Replaying the **production formulas** (`market_activity_score` over 12 complete
five-minute pairs, `realized_volatility_1h`, `listing_qty_pct_change_1h`) across the frozen
seven-day series gives:

| Preset | Current rule | Assets selected at the final window | Verdict |
| --- | --- | --- | --- |
| Most Active | `activity >= 50` | **0 / 100** | Effectively dead |
| Quiet Markets | `activity <= 10` | **91 / 100** | Not a filter |
| Listings Contracting | `listingPct1h <= -2%` | 2 / 100 | Very narrow |
| Listings Expanding | `listingPct1h >= +2%` | 2 / 100 | Very narrow |
| High Volatility | `volatility != null` | **99 / 100** | No discrimination |
| Fresh Changes | changed 5m + fresh | 1 / 100 | Very narrow |

Across all 198,845 observations with a complete 1h window, the activity score has **median 0.00,
p95 12.50, p99 25.00, maximum 58.33**. Only **17 observations in the entire week (0.0085%)** reach 50.

The score is also quantised: with 12 pairs over 2 fields its granularity is 100/24 = 4.167, so it
takes discrete steps and is 0 for the median asset. Empirical percentiles: p75 = 4.17, p90 = 8.33,
p95 = 12.50, p99 = 25.00, p99.9 = 37.50.

### 1.4 Minimum price is surfaced; median price is computed but hidden

**CURRENT.** `features.ts` computes `median_price_return_1h/6h/24h`, but `summary()` in
`map.ts` maps only `min_price_return_*` into `MarketAssetSummary.returns`. `median` is exposed as a
level, never as a return. Every Screener preset that ranks on return, and the entire volatility
calculation (`logReturns` is built from `minPrice`), therefore runs on the noisiest available series
— exactly the bias quantified in the seven-day report.

### 1.5 Availability evidence already exists — no collector change needed

**CURRENT.** `src/lib/collectors/skinport-collector.ts` already records
`metadata.missingAssets` and distinguishes failure modes. Verified against production:

| Window | `status` | `error_code` | `metadata.missingAssets` | True meaning |
| --- | --- | --- | --- | --- |
| 2026-09-15T19:45Z | SUCCESS | — | `[]` | Asset actively listed |
| 2026-09-15T19:50Z | PARTIAL | INCOMPLETE_COVERAGE | `["Souvenir AWP \| Dragon Lore (Factory New)"]` | Feed fetched; asset absent |
| 2026-09-16T17:50Z | PARTIAL | INCOMPLETE_COVERAGE | same | Still absent |
| 2026-09-15T19:35Z | FAILED | HTTP_ERROR | `null` | Feed never arrived; state unknown |

This is a clean three-way discriminator, already persisted. §8 builds on it **without touching the
collector**.

### 1.6 `market_observations` is append-only by trigger

**CURRENT.** `drizzle/0001_protect_observation_history.sql` installs
`observations_append_only`, a statement-level trigger that raises on `UPDATE`, `DELETE` **and**
`TRUNCATE`.

This is a significant and welcome constraint on the storage design: **retention can never be
implemented as `DELETE`.** It must be partition detach/drop (DDL, which the trigger does not
intercept). The trigger must be re-established on any new partitioned parent.

### 1.7 Measured storage composition

**CURRENT.** Measured on the live relation; column split sampled at 4% (n = 7,973).

| Component | Bytes/row | Share of row |
| --- | --- | --- |
| `raw_history_payload` | 793.3 | **50.6%** |
| `raw_item_payload` | 494.2 | 31.5% |
| Scalar columns (prices, quantity, timestamps, ids) | 281.7 | 18.0% |
| Row total (`pg_column_size`) | 1,569.2 | 100% |
| Tuple/page overhead | 71.4 | — |
| **Heap per row** | **1,640.7** | — |
| Indexes per row | 243.2 | — |
| **Total per observation** | **1,884.4** | — |

And the decisive fact: for `AK-47 | Redline (Field-Tested)`, the 2,015 observations in the frozen
window contain **13 distinct `raw_history_payload` values**. The largest column in the schema is
**99.35% redundant**.

### 1.8 Other current-state notes

- **CURRENT.** `src/market-data/ingestion/raw-snapshot-retention.ts` already defines a
  `RawSnapshotSink` interface with `expiresAt`, explicitly "not wired into the production collector".
  A designed extension point exists.
- **CURRENT.** `db/derived-market/001_read_model.sql` already implements content-addressed history
  dedup via `derived_history_versions` / `derived_history_values`, plus `CHECK` constraints that
  reject sales-volume fields in feature rows. The pattern this design recommends for raw storage is
  **already proven in this repository**.
- **CURRENT.** `Evidence` is `"DATABASE" | "SYNTHETIC" | "UNAVAILABLE"` — a provenance axis, not the
  plan's `OBSERVED / DERIVED / EXPERIMENTAL / UNAVAILABLE` confidence axis. The two are orthogonal
  and both are needed.
- **CURRENT.** `Horizon` is `"1h" | "6h" | "24h"`; `readAssetDetail` separately accepts `"7d"`.

---

## 2. Storage architecture proposal

**PROPOSED.** Four layers, in dependency order. Each is independently valuable and independently
revertible.

```
market_observations (partitioned by month, append-only)
  ├── scalars + FK to history version          ← hot, served
  ├── raw_item_payload (bounded retention)     ← provenance
  │
  ├──> market_history_versions / _values       ← content-addressed dedup (L1)
  ├──> market_observations_hourly              ← rollup (L2)
  ├──> market_observations_daily               ← rollup (L2)
  └──> archived partitions in object storage   ← Parquet/NDJSON (L4)
```

### L1 — Content-addressed history dedup (largest single win, zero information loss)

**PROPOSED.** Replace the per-observation `raw_history_payload` copy with a foreign key into a
content-addressed table, mirroring the proven `derived_history_*` pattern.

This is not downsampling. Every observation still resolves to the exact payload it saw, via join.
**No information is lost.** It exploits the measured fact that the payload changes ~13 times per
asset per week while being stored 2,015 times.

### L2 — Hourly and daily rollups

**PROPOSED.** Materialise per-asset aggregates sufficient to serve every SUPPORTED Screener preset
and the Asset Intelligence chart, so serving never scans raw rows. Every Phase 3–5 measure in the
seven-day report is computable from the hourly rollup.

Rollups are **derived and rebuildable** — they are a cache, never the system of record, and may be
dropped and recomputed from raw or from archive.

### L3 — Bounded raw-payload retention

**REQUIRES SEPARATE APPROVAL.** Once L1 and L2 are in place and archive replay is proven, drop
`raw_item_payload` from partitions older than the retention window while keeping scalars.

Not part of this design's approval. Listed for sequencing only.

### L4 — Partitioning and archival

**PROPOSED (partitioning).** Range-partition `market_observations` by month. Weekly partitions only
above ~1,000 assets.

**REQUIRES SEPARATE APPROVAL (archival + drop).** Export an expired partition to object storage as
compressed Parquet or NDJSON, verify row counts and checksums, and only then detach and drop.

### Separation of slow and fast data

**PROPOSED.** The 20 published-sales columns (`sales_24h_*`, `sales_7d_*`, `sales_30d_*`,
`sales_90d_*`) update roughly once per asset per day (measured median gap 1,450 minutes) but are
written 288 times per day. L1 already removes the redundant *payload*; the redundant *scalar
columns* are the natural follow-on, folded into the same versioned dimension.

**LATER.** Moving the sales scalars is deferred until after the 30-day dataset closes, so the 7-day
and 30-day raw shapes stay comparable — an explicit trade of some storage for research integrity.

---

## 3. Canonical derived-intelligence architecture

**PROPOSED.** One calculation layer, four consumers, no analytics in components.

```
market_observations + rollups + history versions
        ↓
src/lib/intelligence/  (canonical, pure, no React, no HTTP)
        ↓
   ├── web UI (server components)
   ├── LATER: developer API
   ├── LATER: MCP tools
   └── LATER: B2B feeds
```

### Relationship to the existing engine

**PROPOSED.** Extend `src/lib/derived-market/`, do not replace it. Specifically:

1. Raise the seven-day scope cap to a configurable maximum (35 days) so a 30-day snapshot is
   expressible. This is the single blocking change for the 30-day program.
2. Add streaming/chunked derivation so `derive()` does not hold 864,000 rows in memory.
3. Promote median-price returns into the summary contract alongside minimum-price returns.
4. Add a `basis: "min" | "median"` dimension to return and volatility features.

### Evidence classification

**PROPOSED.** Add a confidence axis orthogonal to the existing provenance axis:

```ts
type Provenance = "DATABASE" | "SYNTHETIC" | "UNAVAILABLE";   // CURRENT, keep
type EvidenceClass = "OBSERVED" | "DERIVED" | "EXPERIMENTAL" | "UNAVAILABLE";  // PROPOSED, add
```

Every value carries basis, horizon, observation timestamp, source age, coverage and evidence class,
so UI, API and MCP can all explain provenance identically.

---

## 4. Proposed schema

All DDL below is **PROPOSED** and unapplied. Names are indicative.

### 4.1 History dedup (L1)

```sql
-- PROPOSED. Content-addressed; one row per distinct payload per asset.
CREATE TABLE market_history_payloads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      uuid NOT NULL REFERENCES assets(id),
  source        text NOT NULL,
  payload_sha256 char(64) NOT NULL,
  payload       jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  observation_count integer NOT NULL DEFAULT 1,
  CONSTRAINT history_payload_identity UNIQUE (asset_id, source, payload_sha256)
);
CREATE INDEX history_payload_asset_seen ON market_history_payloads(asset_id, first_seen_at DESC);

-- PROPOSED. Additive, nullable during dual-write; NOT NULL only after backfill verifies.
ALTER TABLE market_observations
  ADD COLUMN history_payload_id uuid REFERENCES market_history_payloads(id);
```

`raw_history_payload` is **retained and untouched** through the whole migration. Dropping it is a
separate, later, individually approved step.

### 4.2 Rollups (L2)

```sql
-- PROPOSED. Derived, rebuildable, never the system of record.
CREATE TABLE market_observations_hourly (
  asset_id uuid NOT NULL REFERENCES assets(id),
  source   text NOT NULL,
  bucket   timestamptz NOT NULL,              -- hour start, UTC
  observations integer NOT NULL,
  expected_observations integer NOT NULL,      -- 12
  complete boolean NOT NULL,

  min_price_open numeric(20,8), min_price_high numeric(20,8),
  min_price_low  numeric(20,8), min_price_close numeric(20,8),
  median_price_open numeric(20,8), median_price_high numeric(20,8),
  median_price_low  numeric(20,8), median_price_close numeric(20,8),

  listing_qty_open integer, listing_qty_high integer,
  listing_qty_low  integer, listing_qty_close integer,

  min_price_transitions    integer NOT NULL,
  median_price_transitions integer NOT NULL,
  listing_qty_transitions  integer NOT NULL,
  listing_contractions     integer NOT NULL,
  listing_expansions       integer NOT NULL,
  adjacent_pairs           integer NOT NULL,

  source_age_median_seconds numeric(12,3),
  source_age_max_seconds    numeric(12,3),

  availability text NOT NULL,                  -- see §8
  PRIMARY KEY (asset_id, source, bucket)
);
CREATE INDEX observations_hourly_bucket ON market_observations_hourly(bucket DESC, asset_id);

-- PROPOSED. Same shape at daily grain, plus published-sales change counts
-- (daily is the honest cadence for that field).
CREATE TABLE market_observations_daily ( /* ...as above, bucket = day... */ );
```

`complete` is explicit so a partial bucket is never silently treated as a full one — the same
discipline `realized_volatility_*` already applies.

### 4.3 Partitioning (L4)

**PROPOSED.** `market_observations` becomes `PARTITION BY RANGE (observed_at)` with monthly
partitions.

Three constraints inherited from current state:

1. The `observations_append_only` trigger must be re-created on the new parent.
2. `observations_run_asset UNIQUE (collector_run_id, asset_id)` must include the partition key, or
   become a per-partition constraint. **This is the main schema risk** and needs a decision at
   review: either add `observed_at` to the uniqueness tuple (weakens the global guarantee) or
   enforce per-partition uniqueness plus a periodic global audit. Recommendation: **per-partition
   uniqueness + a scheduled global duplicate audit**, preserving the current semantics that the
   seven-day report verified.
3. The FK from `market_observations` to `assets` is unaffected; a FK *into* a partitioned table
   would not be, and none exists.

### 4.4 Indexes

**PROPOSED.** Preserve all four current indexes per partition. Add
`market_observations(history_payload_id)` only if the join plan requires it — measure first;
it costs ~8–12 MB/week at 100 assets.

---

## 5. Files that would change

**PROPOSED.** Nothing in this table has been edited.

| File | Change | Risk |
| --- | --- | --- |
| `drizzle/0006_history_payload_dedup.sql` | NEW — L1 table + nullable FK | Low, additive |
| `drizzle/0007_observation_rollups.sql` | NEW — L2 tables | Low, additive |
| `drizzle/0008_observation_partitioning.sql` | NEW — L4, **REQUIRES SEPARATE APPROVAL** | **High** |
| `src/lib/db/schema.ts` | Add `historyPayloads`, `observationsHourly`, `observationsDaily`; add nullable `historyPayloadId` | Low |
| `src/lib/derived-market/model.ts` | Raise 7-day scope cap to configurable 35-day max | Medium — changes a validated invariant |
| `src/lib/derived-market/features.ts` | Chunked derivation; `basis` dimension for returns/volatility | Medium |
| `src/lib/derived-market/source.ts` | Read from rollups where sufficient | Medium |
| `src/lib/intelligence/` | NEW — canonical calculation layer | Medium |
| `src/lib/product/intelligence/contract.ts` | Add `EvidenceClass`, `availability`, median returns, `basis` | Low, additive |
| `src/lib/product/intelligence/map.ts` | Surface median returns; map availability | Low |
| `src/lib/product/intelligence/screener.ts` | Recalibrate `THRESHOLDS`; add combined state presets; horizon-aware listing change | Medium — changes what users see |
| `src/components/advanced-screener.tsx` | Render listing depth beside price moves; availability badge | Low |
| `src/components/asset-inspection.tsx`, `intelligence-market.tsx`, `observation-chart.tsx` | Median series; availability state | Low |
| `scripts/derived-market/backfill-history-payloads.ts` | NEW — idempotent, resumable backfill | Medium |
| `scripts/derived-market/build-rollups.ts` | NEW — idempotent rollup builder | Low |
| `tests/derived-market.test.ts`, `product-intelligence.test.ts` | Extend | Low |
| `tests/storage-migration.test.ts`, `tests/availability-semantics.test.ts` | NEW | Low |
| `docs/derived-market/README.md`, `docs/product/DATA_SEMANTICS.md` | Update after implementation | Low |

**Explicitly unchanged:** `src/lib/collectors/skinport-collector.ts`, `src/market-data/**`,
`src/app/api/internal/collect/**`, `vercel.json`, `src/lib/config.ts` (`WINDOW_MS`), the tracked
asset universe, and `drizzle/0001_protect_observation_history.sql`.

---

## 6. Screener integration mapping

**PROPOSED.** Preset → canonical function → evidence class. Thresholds are the empirical
percentiles from §1.3, not the current synthetic-tuned values.

| Preset | Canonical function | Proposed rule | Class |
| --- | --- | --- | --- |
| Most Active | `activityScore(asset, 1h)` | `>= 12.5` (p95), was `>= 50` → 0 results | OBSERVED |
| Quiet Markets | `activityScore(asset, 1h)` | `== 0` over a **24h** window, was `<= 10` → 91/100 | OBSERVED |
| Price Movers | `priceReturn(asset, h, basis)` | non-null, ranked by absolute return, **both bases** | DERIVED |
| Price Up / Down | `priceReturn(asset, h, basis)` | `> 0` / `< 0`, horizon and basis stated | DERIVED |
| Listings Contracting | `listingChange(asset, h)` | `<= -2%` **at the selected horizon** (currently hardcoded 1h) | DERIVED |
| Listings Expanding | `listingChange(asset, h)` | `>= +2%` at the selected horizon | DERIVED |
| Fresh Changes | `freshness(asset)` | changed in last window AND source age ≤ 900s; labelled *observation age* | OBSERVED |
| High Volatility | `realizedVolatility(asset, h, basis)` | **rank within price decile**, or median basis | **EXPERIMENTAL** |
| Price rising + listings contracting | `marketState(asset, h)` | `PRICE UP + LISTINGS DOWN` | DERIVED (descriptive) |
| Price falling + listings expanding | `marketState(asset, h)` | `PRICE DOWN + LISTINGS UP` | DERIVED (descriptive) |
| Price stable + listings contracting | `marketState(asset, h, tolerance)` | needs explicit stability tolerance | **EXPERIMENTAL** |
| Most Traded / published sales | — | daily context only | **NOT SUPPORTED** intraday |
| Predictive / lead-lag | — | pooled correlations +0.025 / +0.035 / −0.003 | **NOT SUPPORTED** |

Two product rules carried from the evidence:

1. **Listing depth must render beside every price-mover result.** The largest gainer in the dataset
   (+67.2%) had four listings and one listing change in seven days.
2. **The two combined state filters ship as descriptive market states.** Their forward-return profile
   is minimum-price bounce, reproducible without listing data at all. No signal language.

---

## 7. Asset Intelligence changes

**PROPOSED.**

- Plot **median listing price alongside minimum**, both labelled. `AK-47 | Crane Flight` is the
  reference case: median rose 17.93 → 23.34 monotonically while minimum oscillated 11.54–17.83.
- Show the **listing-quantity series on the same time axis** as price.
- Surface **availability state** (§8) prominently, not as a footnote.
- Label published sales **"Published 24h sales (updated ~daily)"** with the provider's last-change
  timestamp, never as intraday volume.
- Show **observation age and coverage** for the displayed window.
- **LATER:** a price × listing-supply state ribbon under the chart.

**NOT SUPPORTED:** any forward-looking annotation, target, projection or score.

---

## 8. Availability semantics

**PROPOSED.** Derived entirely from evidence the collector already writes (§1.5). **No collector
change.**

| State | Derivation | UI |
| --- | --- | --- |
| `ACTIVE` | Latest window `SUCCESS`/`PARTIAL`, asset present, `quantity > 0` | Price shown as current |
| `NO_ACTIVE_LISTING_OBSERVED` | Items feed fetched successfully; asset absent from `metadata.missingAssets`-bearing run | "No active listing observed — last observed $X at *timestamp*" |
| `PROVIDER_OR_COVERAGE_UNKNOWN` | Run `FAILED`, items fetch failed, or no run for the window | "Market state unknown — last successful observation *timestamp*" |

Three rules:

1. **Absence is never converted to `listing_quantity = 0`.** Absent and zero are different facts.
2. **Last observed price is a separate field from current available supply**, both in the contract
   and in the UI.
3. A provider fetch failure is **never** collapsed into a market statement.

Worked example — `Souvenir AWP | Dragon Lore (Factory New)`: `ACTIVE` at $12,747.52 through
2026-09-15T19:30Z; `PROVIDER_OR_COVERAGE_UNKNOWN` at 19:35Z (HTTP 400);
`NO_ACTIVE_LISTING_OBSERVED` from 19:50Z onward.

---

## 9. Migration sequence

**PROPOSED.** Each stage is independently revertible and separately approved.

| # | Stage | Approval | Reversible |
| --- | --- | --- | --- |
| 0 | Clone production to staging; measure baseline | This design | n/a |
| 1 | Add L1 tables + nullable FK (additive DDL) | This design | Drop column/table |
| 2 | Backfill history payloads; dual-read verify | This design | Ignore FK |
| 3 | Build L2 rollups from raw; verify against frozen report | This design | Drop tables |
| 4 | Point serving at rollups, raw as fallback | This design | Config flip |
| 5 | Partition `market_observations` | **SEPARATE APPROVAL** | Restore from backup |
| 6 | Archive expired partitions to object storage | **SEPARATE APPROVAL** | Re-import |
| 7 | Bounded raw-payload retention | **SEPARATE APPROVAL** | Irreversible without archive |
| 8 | Drop `raw_history_payload` | **SEPARATE APPROVAL** | Irreversible without archive |

Stages 1–4 are additive and touch no existing row. Stages 5–8 are where risk lives.

**Gate on rollup correctness:** stage 3 must reproduce the frozen seven-day report's headline
numbers from rollups alone — 6,145 listing transitions, 3,747 minimum-price transitions, 201,235
observations, 99.819% completeness. If the rollup cannot reproduce the committed report, it is wrong.

**Collector continuity:** every stage runs with the collector live. Stage 5 is the only one
requiring a write pause, and it must be scheduled inside a single five-minute window with a verified
rollback, or performed via a new-table-plus-swap that never blocks writes.

---

## 10. Rollback strategy

**PROPOSED.**

| Stage | Rollback | Data loss |
| --- | --- | --- |
| 1–2 | Stop writing FK; drop column; `raw_history_payload` still authoritative | None |
| 3–4 | Config flip to raw-only reads; drop rollups | None (derived) |
| 5 | Restore from pre-migration backup; or keep old table until verified and swap back | None if old table retained |
| 6–8 | Re-import from archive | **None only if archive verified first** |

Preconditions for any production migration: a verified Neon backup/branch immediately prior;
pre/post row-count reconciliation per asset and per window; proof the collector wrote and committed
successfully during and after; and the frozen seven-day report still reproducible. Any failure →
stop and roll back, never patch forward.

Stages 6–8 must not proceed until an archived partition has been **re-imported into staging and
verified byte-identical**. Archive-then-drop without a proven restore path is not acceptable.

---

## 11. Test strategy

**PROPOSED.** Extending `tests/derived-market.test.ts` and `tests/product-intelligence.test.ts`.

| Area | Cases |
| --- | --- |
| Rollup correctness | Hourly/daily reproduce frozen report totals; partial buckets flagged `complete = false`; DST/UTC boundaries |
| Gap handling | Missing window never bridges a 5m return (the ±90s tolerance rule); 19:35Z failed window is a gap, not a zero |
| Thin markets | 4-listing asset (+67.2%) surfaces with depth; 1-listing and 0-listing assets |
| Zero/absent supply | `ACTIVE` vs `NO_ACTIVE_LISTING_OBSERVED` vs `PROVIDER_OR_COVERAGE_UNKNOWN`; absence never becomes 0; asset returning to the feed |
| Provider failure | HTTP 400 run yields UNKNOWN, not a market claim; 429/5xx paths |
| Stale data | 904.67s source age → stale labelling; >7m/>10m/>15m bands |
| Low-price volatility | USD 0.02 asset (zero transitions) and USD 0.20 asset do not dominate the volatility ranking |
| Median vs minimum | Both bases computed; `AK-47 \| Crane Flight` divergence asserted |
| Published sales | Never summed across snapshots; daily cadence labelling; repeated value ≠ new sale |
| History dedup | FK resolves to byte-identical payload for all 201,235 rows; A→B→A produces three episodes sharing two hashes |
| Migration | Idempotent and resumable backfill; row counts preserved; append-only trigger still fires after partitioning |
| Evidence language | Automated scan rejecting forbidden strings (alpha, buy, sell, bullish, bearish, real-time, guaranteed) in UI/API surfaces |

The strongest available test asset is the **committed frozen report**: any rollup or migration must
reproduce it exactly.

---

## 12. Expected storage impact

Derived from §1.7 measurements. **Measured** and **projected** are separated.

### Per-observation cost

| Scenario | Heap B/obs | Index B/obs | Total B/obs | vs today |
| --- | --- | --- | --- | --- |
| **CURRENT (measured)** | 1,640.7 | 243.2 | **1,884.4** | — |
| PROPOSED L1 (history dedup) | ~863 | ~243 | **~1,110** | **−41%** |
| PROPOSED L1 + L3 aged item drop | ~369 | ~243 | **~612** | **−67%** |
| PROPOSED L2 hourly rollup only | ~21 equiv. | — | **~21** | **−99%** |

L1 arithmetic: 1,569.2 − 793.3 (payload) + ~16 (FK) + 71.4 (overhead) ≈ 863 B/row, plus a history
side table of ~1.1 MB per 7 days at 100 assets (13 versions × 100 assets).

### Universe projections

| Universe | Window | CURRENT | + L1 | + L1 + L3 |
| --- | --- | --- | --- | --- |
| 100 | per day | 51.80 MB *(measured)* | ~30.5 MB | ~16.8 MB |
| 100 | 30 days | 1.52 GB | ~0.90 GB | ~0.49 GB |
| 1,000 | 30 days | 15.16 GB | ~8.93 GB | ~4.93 GB |
| 10,000 | 30 days | 151.63 GB | ~89.3 GB | ~49.3 GB |

All non-measured figures are **projections** scaling measured bytes/observation linearly at
unchanged cadence, coverage and payload size. They exclude other tables, backups, WAL/branch history,
transfer and provider costs.

**Neon caveat.** These are Postgres logical sizes (`pg_total_relation_size`). Neon meters
copy-on-write storage including page history, and will report more. Size any plan decision against
the Neon dashboard, not this table.

**The L1 recommendation is unusually safe:** ~41% reduction with **zero information loss**, using a
dedup pattern already implemented and proven in `db/derived-market/001_read_model.sql`.

---

## 13. Production risks

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| 1 | Partitioning needs a table rewrite/swap while the collector writes every 5 min | **High** | Staging rehearsal; execute inside one window; new-table-plus-swap; verified backup; SEPARATE APPROVAL |
| 2 | `observations_run_asset` global uniqueness weakens under partitioning (§4.3) | **High** | Per-partition uniqueness + scheduled global duplicate audit; decide at review |
| 3 | Raising the 7-day scope cap removes a validated invariant | Medium | Configurable max, not unbounded; keep 7-day assertion in the frozen report path |
| 4 | Recalibrated thresholds change what users see | Medium | Publish percentile basis in the UI; current values return 0 or 91 of 100, so change is required |
| 5 | Rollup drift from raw | Medium | Rollups derived and rebuildable; reconciliation job; gate on reproducing the frozen report |
| 6 | Backfill load on the live database | Medium | Chunked, resumable, rate-limited, off-peak; Neon branch first |
| 7 | 30-day `derive()` memory (864k rows) | Medium | Chunked derivation before any 30-day snapshot |
| 8 | Archive-then-drop without proven restore | **High** | Re-import to staging and verify before any drop; SEPARATE APPROVAL |
| 9 | Availability state misread as a market claim | Medium | Three explicit states; never absence → 0; explicit test coverage |
| 10 | Storage limit reached during the 30-day run | Medium | 23 further days ≈ 1.16 GB; verify Neon headroom **before** stage 5, not after |
| 11 | Append-only trigger silently lost on the new parent | Medium | Assert trigger presence in migration test and post-migration check |
| 12 | Evidence-language regression as surfaces multiply | Low | Automated forbidden-term scan in CI |

---

## 14. Recommended implementation order

| # | Work | Approval | Why here |
| --- | --- | --- | --- |
| 1 | Chunked derivation + configurable scope cap | This design | Blocks the 30-day snapshot; no schema change |
| 2 | L1 history dedup: tables, nullable FK, backfill, dual-read verify | This design | Largest win, additive, zero information loss |
| 3 | L2 rollups + reconciliation against the frozen report | This design | Prerequisite for serving and for safe expiry |
| 4 | Canonical `src/lib/intelligence/` layer + evidence classes | This design | Single source for UI/API/MCP |
| 5 | Wire real data to Screener + Asset Intelligence; recalibrate thresholds; median price first-class | This design | **Highest product value** — closes the §1.1 gap |
| 6 | Availability semantics end-to-end | This design | Depends on 4; no collector change |
| 7 | Staging clone: rehearse partitioning, measure actual savings | This design | Evidence for the stage-5 decision |
| 8 | **Partition `market_observations`** | **SEPARATE APPROVAL** | Highest-risk DDL |
| 9 | **Archive expired partitions; verify restore** | **SEPARATE APPROVAL** | Must precede any drop |
| 10 | **Bounded raw retention; drop `raw_history_payload`** | **SEPARATE APPROVAL** | Irreversible |
| 11 | 30-day research report at cutoff | This design | Gates expansion |
| 12 | Universe expansion decision | **SEPARATE APPROVAL** | After 30-day + storage proof |
| 13 | Developer API / MCP | **LATER** | After intelligence maturity |
| 14 | Contributor network pilot | **LATER** | After permissions and value model |

Steps 1–7 are additive, revertible and touch no existing row. **Step 5 is where the user-visible
value lands**, and it needs no risky DDL — it depends only on steps 1–4.

---

## 15. Acceptance criteria mapping

| Plan §18 criterion | Addressed in |
| --- | --- |
| Collector continues uninterrupted | §9, §13.1 — no collector file changes |
| Frozen report reproducible and unchanged | Committed `4f6c7ea`; §9 gate; §11 |
| No universe/cadence expansion | §14.12 — separate approval |
| Storage design has measured projections and rollback | §12, §10 |
| Explicit formulas, horizons, evidence classes | §3, §6 |
| Median and minimum treated as distinct | §1.4, §6, §7 |
| Listing depth accompanies price movers | §6 rule 1 |
| Provider failure distinguishable from no-listing | §8 |
| Sales/history never a 5-minute feed | §2, §6, §7, §11 |
| No unsupported predictive language | §6, §11 evidence-language scan |
| One canonical layer for Web/API/MCP | §3 |

---

## 16. Open questions for review

1. **Partition uniqueness (§4.3, risk 2).** Weaken `observations_run_asset` to per-partition plus a
   global audit, or add `observed_at` to the tuple? Recommendation: per-partition + audit.
2. **Scope cap.** Is 35 days the right configurable maximum, or should 30-day research use a
   separate non-snapshot path?
3. **Quiet Markets.** Is `activity == 0` over 24h the right definition, or a low non-zero percentile?
4. **Volatility control.** Rank within price decile, or switch the basis to median price? The seven-day
   data supports either; decile ranking preserves the existing metric.
5. **Sales-scalar separation.** Defer until after the 30-day cutoff to protect comparability
   (recommended), or take the storage win now?
6. **Neon headroom.** Actual metered storage and plan limit need confirming before stage 5.

---

**Status: DESIGN ONLY. No implementation performed. Awaiting review.**
