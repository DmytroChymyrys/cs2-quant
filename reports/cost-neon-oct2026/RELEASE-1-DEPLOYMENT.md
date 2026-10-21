# Release 1 — Deployment Record

| | |
|---|---|
| Commit | `b18d7d6` — *perf(universe): stop reading the catalogue twice per collection run* |
| Deployment | `dpl_6ughLA8CPhS7YZoxoEtySwyZ1259` · Production · Ready · build 25s |
| Deployed at | 2026-10-21 19:03:50 UTC |
| **Rollback target** | `dpl_2PPVUyFgSwoJjAhxWY9fiKeu3idG` (commit `141f5fb`) |
| **Phase 2 (autoscaling)** | **NOT EXECUTED — requires your console access** |

---

## Phase 1 — Predeployment

### 1.1 Staging verification ✓

PGlite with the real market migrations applied (`0000`–`0009`), running the
actual store code against the actual schema — `tests/universe-store-integration.test.ts`,
8 tests:

| Verified | |
|---|---|
| New asset registered, real row id returned | matches the row in the table |
| Known asset resolved from `currentState` | no re-read |
| **Stranded asset recovered** | row exists, no state row, insert conflicts — only the targeted lookup resolves it |
| Stranded recovery creates no duplicate | count stays 1 |
| `NULL` version vs real version | two distinct rows, two distinct ids |
| Retry of the same run | idempotent, no duplicate |
| Mixed batch (known + new + stranded) | all three resolved in one call |
| Provider→FloatAlpha mapping by name | `asset_id` set correctly |
| Unmapped asset | `asset_id` null, still observed |

The stranded case matters because it depends on a genuine inner join and a real
`NULLS NOT DISTINCT` unique index — neither reproducible in a stub. Both suites
were verified by mutation: removing the gap lookup fails the stranded test;
ignoring the caller's known ids fails four.

### 1.2 Gate ✓

```
Test Files  97 passed (97)
Tests       1612 passed (1612)
Typecheck   clean
Lint        0 errors, 10 warnings (pre-existing)
Build       ✓ Compiled successfully
```

The staged tree was also verified **in isolation** — unrelated uncommitted work
stashed — at 1,574 tests, confirming the commit does not depend on anything
uncommitted.

### 1.3 Baseline recorded ✓

```
collector, last 24h   288 runs   0 failed   288 partial
                      avg 8,148 ms   p95 9,033 ms   max 22,977 ms
block reads           40,645 blocks / 360 s  ->  318 MB  ->  74.4 GB/day
provider_assets       126,053,079 read / 230,446,040 hit  =  64.60% hit ratio
product endpoint      uptime 14d 18h   max_connections 901
shared endpoint       uptime  2d 04h   max_connections 450
LFC limit             product 1,461 MB   shared 3,276 MB (constant across 4 samples, 3 min)
```

### 1.4 Autoscaling minimum and maximum — **NOT CONFIRMED**

I could not confirm these, and I will not report inferred values as confirmed.

- No Neon API key exists in any environment file or in the Vercel production
  environment (only `NEON_PROJECT_ID` and `DERIVEDDB_NEON_PROJECT_ID`).
- `neonctl` is not installed and has no stored credentials; authenticating it
  needs an interactive browser flow.
- Autoscaling bounds are not exposed to SQL. `neon.compute_size`,
  `neon.autoscaling_min` and `neon.autoscaling_max` are all unrecognised.

**What the database does show, as inference only:**

| Signal | Reading | Inference |
|---|---|---|
| `max_connections` | 901 / 450 | Neon sizes this to the autoscale **maximum** → 2 CU / 1 CU |
| Billed compute vs both ceilings 24/7 | 98.5% | consistent with min = max, or autoscaling off |
| Product uptime | 14d 18h unbroken | has not suspended once |
| LFC limit across 4 samples, 3 min | constant | no observed scaling movement |

The **minimum is not observable from inside Postgres.** Please read it from the
Neon console.

---

## Phase 2 — Neon autoscaling: not executed

I have no Neon console or API access, so I could not lower the minimum. This is
your action.

**Console → Project → Branch → Compute → Edit:** set the minimum to **0.25 CU**
on both endpoints, leaving the maxima unchanged (2 CU product, 1 CU shared).

Workload evidence supporting 0.25 CU: 1 concurrent connection, a 114 MB hot set
against a 1,461 MB local file cache, longest query 57 ms, largest join working
memory 3.4 MB, collection run ~8 s. Lowering only the minimum is additive — if
load needs more, autoscaling supplies it.

**One useful consequence of this being blocked:** because autoscaling was not
touched, every number in Phase 4 is attributable to Release 1 alone. The
attribution you asked for is clean by accident.

---

## Phase 3 — Deployment ✓

Deployed via the Git integration. **Unchanged as required:** five-minute
cadence, V3 profile, database schema, external scheduler, universe collection
behaviour.

### Verification

| Check | Result |
|---|---|
| Collection runs succeed | 4 runs post-deploy, **0 failed**, 25,167 items, 148 observations each |
| Universe assets remain resolvable | **0 stranded** of 25,848 Skinport provider assets |
| No unexpected missing-state errors | `provider_asset_state` updated **24,828 rows in 15 minutes**; last write 2.4 min old |
| Physical reads decrease | see Phase 4 |
| No freshness regression | Screener 10/10 `Partial`, **no Stale**; strip normal |
| No market-data regression | Cross-venue live: Skinport $153.51 observed 19:00 UTC, Steam $195.00 — panel populated |

The `provider_asset_state` check is the one that matters most: `collectUniverse`
failures are caught and swallowed by design so they cannot fail the tracked
pipeline, which means **a broken universe path would also have reduced block
reads.** A drop in reads is only good news if the universe is still being
written, and it is.

Steam's 40,092 provider assets show no `provider_asset_state` row. That is not a
defect — the Steam collector uses a separate store and `steam_market_state`
(40,092 rows, updating). It is unrelated to this release.

---

## Phase 4 — Measurement

### Collector

| | Baseline (24h) | Post-deploy | Change |
|---|---:|---:|---|
| Runs failed | 0 of 288 | 0 of 4 | unchanged |
| Status | all PARTIAL | all PARTIAL | unchanged — two delisted assets, pre-existing |
| Duration, mean | 8,148 ms | 7,966 ms | −2.2% |
| Duration, p95 | 9,033 ms | 8,328 ms | −7.8% |
| Items received | ~25,165 | 25,167 | unchanged |
| Observations inserted | 148 | 148 | unchanged |

Only four runs — directionally right, not yet a reliable mean.

### Physical reads

| Window | Blocks | GB/day | vs baseline |
|---|---:|---:|---:|
| Baseline, 6 min, pre-deploy | 40,645 | **74.4** | — |
| Window 1, 7 min, post-deploy | 19,443 | **30.5** | **−59.0%** |
| Window 2, 7 min, post-deploy | 9,558 | **15.0** | **−79.8%** |

**The spread between the two post-deploy windows is as large as the saving**, so
neither should be read as the result. Short windows are dominated by cache
state: the same query measured minutes apart earlier gave `read=9270` cold and
`read=901` warm. A longer window is running and will tighten this.

Direction and rough magnitude are clear and consistent with removing one of two
identical scans. A conservative reading is **−50% to −60%**, not −80%.

### CU usage and billed transfer

**Neither is readable from here.**

- CU-hours are a Neon billing metric, not a Postgres one. The database reports
  uptime, and both endpoints remain continuously up — expected, since nothing in
  this release touches scale-to-zero.
- Billed transfer is not exposed. Block reads are the best available proxy, and
  an imperfect one: they correlated at **83%** with billed transfer when I
  reconciled the two earlier, because some block reads are served by the
  compute's local file cache without crossing the network.

Please read both from the Neon console for the period after 19:03 UTC.

### Revised projection

| Line | Before | After Release 1 | Basis |
|---|---:|---:|---|
| Compute | $225 | **$225** | unchanged — computes are pinned; less work on a fixed size costs the same |
| Transfer | $85 | **$34–43** | −50% to −60% of block reads, discounted for the 83% correlation |
| Storage + history | $8 | $8 | unchanged |
| **Total** | **$318** | **≈$267–276** | **−13% to −16%** |

This **beats the $9–21/month I projected**, which assumed the lifetime 64.6%
hit ratio applied to the removed blocks. Measured, the removed scan was colder
than average — it ran immediately after the other scan had already evicted what
it needed.

**Compute remains the larger line and is untouched.** Phase 2 is what moves it;
until the minimum is lowered, Release 1's reduced work produces no compute
saving at all.

### Attribution

| Source | Saving |
|---|---|
| **Release 1** | all of the above — autoscaling was not changed |
| **Autoscaling** | $0 — not executed |

---

## Rollback

**Application:** `git revert b18d7d6` and deploy, or roll back to
`dpl_2PPVUyFgSwoJjAhxWY9fiKeu3idG`. Nothing stored changes — the commit alters
only which statements are issued — so rollback is safe at any point including
mid-run, with no cleanup.

**Trigger:** collection correctness regression — a `FAILED` run, `collector.universe_failed`
in the logs, `provider_asset_state` ceasing to update, or stranded Skinport
assets appearing.

**Autoscaling:** nothing to restore; it was not changed.

---

## Open items

1. **Phase 2 needs you** — the autoscaling minimum, and reading the current
   min/max to close Phase 1.4.
2. **CU-hours and billed transfer** need a console reading for the period after
   19:03 UTC.
3. **Re-measure after 24 hours** — four collector runs and three short windows
   are a direction, not a result.

No further optimization work started, and no V4 work resumed.
