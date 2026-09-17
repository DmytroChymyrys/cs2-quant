# Production intelligence refresh — DESIGN ONLY

**Nothing here is implemented.** No collector, provider, cadence, universe,
`market_observations`, rollup, feature, threshold, protocol, retention or
migration change. All measurements below were taken read-only against the
production market database on 2026-09-17.

**Headline: the architecture already supports safe refresh.** Generation is
deterministic and content-addressed, persistence is already atomic, and
snapshots are already immutable. What is missing is scheduling, a database-side
active pointer, a validation gate and snapshot retention. This is a small
addition, not new infrastructure.

---

## A. Exact current data flow

```
market_observations + collector_runs        (market DB, append-only)
  │  loadSource() — read-only, REPEATABLE READ
  ▼
Input { scope, runs[], observations[] }     in memory
  │  prepare()  — excludes duplicate windows / pairs / out-of-window rows
  │  derive()   — per-asset features, Decimal, ±90s baselines
  ▼
Derived { snapshotId, features[], historyVersions[], historyValues[] }
  │  makeReport() — operational report + per-asset availability map
  │  persistSnapshot() — ONE transaction
  ▼
derived_market_snapshots / _history_versions / _history_values / _features
  │                                          (derived DB, separate database)
  │  PRODUCT_ANALYTICS_SNAPSHOT_ID  ← env var selects the active snapshot
  ▼
readMarketDataset()  → Terminal, Screener       (latest feature per asset)
readAssetDetail()    → Asset Intelligence       (feature series, clamped to scope)
```

Entry point: `scripts/derived-market/run.ts --mode report --persist`.

## B. Why snapshots become stale

There is **no scheduler**. A snapshot is produced only when someone runs the
CLI, and it is activated only by setting an environment variable. Nothing
refreshes it, so its age grows without bound. The UI reporting "25h ago" is the
symptom, and it is reporting correctly.

## C. Measured generation cost

Real production data, 100 assets, laptop → Neon `us-east-1`. Runtime includes
network round-trip; in-region would be faster. Memory would not be.

| Scope | Feature rows | Wall time | Peak RSS | Snapshot storage |
| --- | --- | --- | --- | --- |
| 6h | 6,525 | **3.0s** | 388 MB | 8.7 MB |
| 24h | 27,810 | **9.6s** | 585 MB | 39 MB |
| 72h | 85,027 | **42.5s** | 964 MB | 123 MB |
| 7d | 200,227 | **99.8s** | 1,824 MB | 295 MB |

Product read latency is not a constraint: the dataset query runs in
**0.03–0.31s** even against a 200,227-row snapshot.

### The scope floor — measured, and it decides the design

A scope must be **longer than the longest horizon it serves**:

| Scope | 1h returns | 6h returns | 24h returns |
| --- | --- | --- | --- |
| 6h | 99/100 | **0** | **0** |
| 24h | 99/100 | 99/100 | **0** |
| 72h | 100/100 | 100/100 | **100/100** |
| 7d | 100/100 | 100/100 | 100/100 |

A 24-hour scope yields **zero** 24-hour returns, because the last window has no
observation exactly 288 steps behind it. The minimum useful scope for a product
offering 1h/6h/24h is therefore meaningfully more than 24h; **72h is the first
measured scope that fully populates every horizon.**

Two consequences also measured:

- **24h volatility is 0/100 at every scope**, because the 2026-09-17 scheduler
  gap sits inside every recent 24h window. That is the strict complete-window
  rule behaving correctly, not a scope problem, and it is unchanged here.
- **A short scope silently drops assets that left the feed.** At 6h and 24h only
  99 assets appear: the delisted asset has no recent observations, so it has no
  feature rows and vanishes from the UI entirely. Its availability state *is*
  still carried — the report's availability map has all 100 entries at every
  scope — but the product builds its asset list from feature rows, so it is
  never rendered. Any rolling-window refresh must address this or it will
  silently undo the availability work.

## D. Current failure and concurrency behaviour

| Property | Current state | Verdict |
| --- | --- | --- |
| Deterministic | Yes. Identical input gives an identical snapshot ID; proven by generating the same ID from a staging clone and from production | Good |
| Immutable | Yes. Content-addressed ID; a changed input produces a new snapshot rather than mutating one | Good |
| Atomic persistence | Yes. `persistSnapshot` runs inside one `BEGIN`/`COMMIT` in `run.ts` | Good |
| Partially visible snapshot | **No.** The parent row and all children commit together | Good |
| Duplicate concurrent run, same input | Safe. `insert … on conflict do nothing` on the parent; the loser writes no children | Good |
| Concurrent runs, different input | Both proceed. No lock. Wasted compute, no corruption | **Gap** |
| Activation | `PRODUCT_ANALYTICS_SNAPSHOT_ID` env var. On Vercel this needs a **redeploy** | **Gap** |
| Validation before publish | Only `DUPLICATE_INTEGRITY` blocks publishing. Every measurement run reported `operationalStatus: FAIL` and still persisted | **Gap** |
| Retention | None. Snapshots accumulate forever | **Gap** |
| Missing snapshot row | `validateSnapshotHead` throws; product reports UNAVAILABLE with the reason | Good |
| Derived DB unreachable | Caught; product reports UNAVAILABLE | Good |
| Local/staging dependency | None. The job needs only the two connection strings | Good |

Credentials required: read-only `MARKET_ANALYTICS_SOURCE_URL` (market DB) and
read-write `DERIVED_MARKET_DATABASE_URL` (derived DB). No collector credential,
no provider key.

## E. Proposed architecture — smallest safe change

```
append-only observations        (unchanged, read-only)
        ↓
refresh job on its OWN schedule (new: scheduled runner + advisory lock)
        ↓
new complete immutable snapshot (already: deterministic, atomic, immutable)
        ↓
validation gate                 (new: publish/activate criteria)
        ↓
atomic activation               (new: pointer row, replacing the env var)
        ↓
product reads the active pointer (small change in server.ts)
        ↓
retention                       (new: prune all but the last N snapshots)
```

Four additions. Everything else already exists.

### The activation pointer

```sql
-- PROPOSED. Single-row pointer in the DERIVED database only.
CREATE TABLE derived_active_snapshot (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  snapshot_id text NOT NULL REFERENCES derived_market_snapshots(id),
  activated_at timestamptz NOT NULL DEFAULT now()
);
```

Activation becomes one `UPDATE`, which is atomic and instant. A reader either
sees the old snapshot or the new one, never a mixture, because the new snapshot
is already fully committed before the pointer moves.

`PRODUCT_ANALYTICS_SNAPSHOT_ID` is kept as an **override**: when set it wins, so
the reviewed-snapshot workflow and the frozen evidence path still work exactly
as today, and a bad refresh can be pinned out of the way without a code change.

## F. Cadence

Do not inherit the collector's 5 minutes. Derived from the measured cost:

| Cadence | Runs/day | 72h-scope compute/day | Snapshot churn/day |
| --- | --- | --- | --- |
| 5 min | 288 | 3.4 h | 35 GB |
| 10 min | 144 | 1.7 h | 17.7 GB |
| **15 min** | **96** | **1.1 h** | **11.8 GB** |
| 30 min | 48 | 0.6 h | 5.9 GB |

**Recommended: 15 minutes with a 72h scope.** Worst-case snapshot age becomes
~15 min + 42 s generation, against 25 h today. Churn is write volume, not
steady-state size: with retention of the last 3 snapshots the derived database
settles at roughly **370 MB**.

30 minutes is the conservative fallback if Neon write churn proves expensive.
5 minutes is not recommended: it triples the cost to shave ten minutes off an
age the UI already reports honestly.

**The scope choice is the real lever**, and it is a product decision:

| Scope | Cost/refresh | What the product gets |
| --- | --- | --- |
| 30h | ~12 s, ~50 MB | 1h/6h/24h populated; chart capped at 30h |
| **72h** | **42 s, 123 MB** | all horizons; 3-day chart; delisted assets retained |
| 7d | 100 s, 295 MB | as today; too slow and too large to refresh often |

At 72h the Asset Intelligence 7d tab would display 72h of history. The chart
already labels its own horizon, so this is honest, but it is a visible change
and should be an explicit decision rather than a side effect.

**Where it runs:** not a Vercel function. A 72h refresh needs 42 s and ~964 MB,
against a 60 s `maxDuration` and tighter memory. A scheduled CI job (GitHub
Actions cron or equivalent) running the existing
`npm run analytics:report -- --persist` plus an activation step is sufficient and
adds no new service.

## G. Atomic activation

1. Generate into the derived DB — one transaction, fully committed, not yet active.
2. Validate the committed snapshot by reading it back.
3. `UPDATE derived_active_snapshot SET snapshot_id = …` — one atomic statement.
4. The product reads the pointer per request.

A failure at any step leaves the pointer untouched, so the product keeps serving
the last known good snapshot. A failed refresh can never partially replace it,
because a snapshot is only reachable through the pointer and the pointer only
moves after the snapshot is complete and validated.

## H. Locking and idempotency

- `pg_try_advisory_lock` on the derived DB for the duration of a refresh.
  A second run exits immediately rather than duplicating work.
- Content addressing already makes a duplicate run harmless: identical input
  produces the identical ID and `on conflict do nothing` skips it.
- The job is naturally idempotent: re-running for the same closed window is a
  no-op that ends by re-activating the same ID.
- The lock lives in the **derived** database. It cannot affect the collector.

## I. Freshness semantics — three distinct values

These are three different facts and must never collapse into one number.

| Concept | Meaning | Proposed label |
| --- | --- | --- |
| Observation freshness | How long since the collector last stored an observation | **Market evidence · latest observation 4m ago** |
| Provider/source freshness | How old the provider's own data was when captured (`source_updated_at`) | **Provider evidence · source captured 5m before observation** |
| Snapshot generation time | When the derived intelligence was computed | **Intelligence · computed 12m ago** |

Today the UI shows the first two and calls the whole snapshot "stale" from the
third. After a refresh, all three are short but they are still different
questions, and a user debugging "why is this number old" needs to know which one
is old. Exact timestamps and exact seconds stay in the provenance disclosure,
as they do now.

## J. Failure behaviour

| Failure | Job behaviour | What the user sees |
| --- | --- | --- |
| Refresh timeout | Abort, release lock, pointer unmoved | Previous snapshot, its true computed age |
| Market DB unavailable | Abort before any write | Previous snapshot |
| Derived DB unavailable | Abort; nothing written | Previous snapshot; if the DB is down for reads too, UNAVAILABLE with a reason |
| Incomplete derivation | Transaction rolls back; no snapshot exists | Previous snapshot |
| Validation failure | Snapshot persists but is **never activated**; alert | Previous snapshot |
| Concurrent refresh | Second run exits on the lock | No effect |
| Scheduler gap | No refresh; snapshot ages | Honest increasing age — the same watchdog pattern already used for the collector |
| Snapshot older than a stated bound | Pointer unmoved | Existing STALE treatment, which already works |
| Pointer references a missing snapshot | — | UNAVAILABLE with the validation reason, as today |

No failure path substitutes zero for an unavailable value, and no path makes an
old snapshot appear current: age is always computed from the snapshot's own
generation time.

### The validation gate needs a decision

`operationalStatus` was `FAIL` on **all four** measurement runs, for
`MISSING_SCHEDULED_WINDOWS`, `NON_SUCCESS_CLAIMED_RUNS`, `ASSET_COVERAGE`,
`PROVIDER_ERRORS` and `ITEMS_FRESHNESS_OUTSIDE_0_900_SECONDS`. These are routine
and expected — the delisted asset alone guarantees `ASSET_COVERAGE` forever. A
gate that blocks on `FAIL` would never activate anything.

Proposed split, for review:

- **Blocking:** `DUPLICATE_INTEGRITY`; zero assets; zero features; scope not
  closed; fewer assets than the previous snapshot by more than a stated margin.
- **Non-blocking, recorded and surfaced:** missing windows, non-success runs,
  asset coverage, provider errors, freshness excursions.

## K. 30-day experiment isolation

The refresh cannot affect the experiment, and this is structural rather than a
matter of care:

1. **Read-only source.** `loadSource` runs inside `BEGIN ISOLATION LEVEL
   REPEATABLE READ READ ONLY`. The connection cannot write.
2. **Different database.** All writes go to the derived database. The market
   database is a separate Neon instance; nothing in the job holds a writable
   handle to it.
3. **Append-only enforced independently.** `market_observations` rejects
   UPDATE, DELETE and TRUNCATE at the database level, regardless of caller.
4. **No collector contact.** The job calls no collector endpoint, reads no
   provider, and touches no cron entry. The collector's schedule, cadence,
   universe and provider are untouched.
5. **Boundary untouched.** The 30-day boundary is a constant in the analysis
   scripts and the protocol. The refresh chooses its own rolling window for
   product display and writes nothing that any analysis reads.
6. **7-day prefix unaffected.** The frozen artifacts are committed files hashed
   in a manifest. Refreshing product intelligence does not read or write them.
7. **Methodology unchanged.** The refresh calls the same `derive()` with the
   same thresholds and the same 1h/6h/24h horizons. No 7-day derived feature is
   added.

The only new writes are to derived/product snapshot storage, plus one pointer
row and snapshot pruning — all inside the derived database.

## L. Storage impact

| | |
| --- | --- |
| Per 72h snapshot | **123 MB** |
| Retention of last 3 | **~370 MB** steady state |
| Without retention at 15 min | ~11.8 GB/day — not viable |
| Pointer table | negligible |

Retention applies **only to derived snapshots**. It is not `market_observations`
retention, which remains not approved and untouched.

## M. Compute impact

~42 s per refresh, 96 refreshes/day ≈ **1.1 h/day** of job compute, on a runner
with at least 1.5 GB available. Market-DB impact is one read-only repeatable-read
transaction per refresh, concurrent with a collector that writes for ~7 s every
5 minutes. Derived-DB impact is ~85k row inserts plus a pruning delete per cycle.
Product read latency is unchanged (0.03–0.31 s).

## N. Components implementation would affect

| Path | Change |
| --- | --- |
| `db/derived-market/002_active_snapshot.sql` | NEW — pointer table |
| `src/lib/derived-market/active-snapshot.ts` | NEW — read/set pointer, advisory lock |
| `src/lib/derived-market/validation.ts` | NEW — blocking vs non-blocking criteria |
| `scripts/derived-market/refresh.ts` | NEW — generate, validate, activate, prune |
| `src/lib/product/intelligence/server.ts` | Read the pointer; keep the env var as an override |
| `src/lib/product/intelligence/contract.ts` | Add snapshot generation time beside observation/source ages |
| `src/components/intelligence-market.tsx` | Three-way freshness labels |
| `.github/workflows/intelligence-refresh.yml` | NEW — schedule |
| `docs/ops/INTELLIGENCE_REFRESH.md` | NEW — runbook |

**Unchanged:** collector, provider, cron, `market_observations`, rollups,
`features.ts`, thresholds, protocol, migrations, retention of raw data.

## O. Tests required

Determinism (same input → same ID); atomicity (a killed refresh leaves no
partial snapshot); pointer atomicity (readers see old or new, never mixed);
failed validation never activates; advisory lock prevents overlap; idempotent
re-run; scope floor (a 24h scope yields no 24h returns — guard the regression);
delisted-asset retention at the chosen scope; retention prunes only inactive
snapshots and never the active one; env-var override still wins; three freshness
values computed independently; market connection is read-only; no failure path
substitutes zero.

## P. Rollout

1. Pointer table and reader, with the env var still winning. No behaviour change.
2. Refresh job runnable manually against the derived DB; verify determinism and
   atomicity by hand.
3. Enable the schedule at **30 minutes**; observe a day.
4. Move to 15 minutes if cost is as measured.
5. Switch the product to the pointer by clearing the env var override.
6. Enable retention once several cycles have been observed.
7. Ship three-way freshness labels.

Each step is independently reversible and none touches the market database.

## Q. Rollback

| Step | Rollback |
| --- | --- |
| Pointer table | Drop it; the env var path is untouched |
| Refresh job | Disable the schedule; snapshots stop updating and age honestly |
| Pointer activation | Set `PRODUCT_ANALYTICS_SNAPSHOT_ID` to a known good ID; it overrides |
| Bad snapshot activated | Move the pointer back; snapshots are immutable so the previous one is intact |
| Retention | Disable; no snapshot is recoverable once pruned, so enable last |

The decisive property: because snapshots are immutable and content-addressed,
rollback is always "point at the previous one", never "repair the current one".

## R. Remaining risks

1. **Scope choice is a product decision, not a technical one.** 72h makes the
   7d chart show 3 days. Must be decided, not defaulted.
2. **Short scopes silently drop delisted assets** from the UI while still
   carrying their availability state in the report. If a scope under ~72h is
   chosen, the product must render in-scope assets that have no feature rows.
3. **The validation gate needs its blocking list agreed**, or it will either
   block everything or nothing.
4. **Retention is irreversible.** Enable it last, after the cadence is proven.
5. **The refresh job has the same watchdog problem as the collector** — if its
   scheduler dies the snapshot silently ages. The existing watchdog pattern
   applies and should be reused rather than reinvented.
6. **Measurements are from a laptop over the public internet.** In-region
   runtime should be better; memory will not change. Re-measure on the real
   runner before fixing the cadence.
7. **24h volatility stays 0/100** while any recent 24h window contains a
   collection gap. Refresh does not change this, and must not be expected to.
