# Release 1 — Eliminating the duplicate `provider_assets` read

Implemented, not deployed. Five-minute collection and the market-data contract
are unchanged.

**The honest headline: this saves less than my previous report implied.** The
$26/month figure assumed every removed block was a physical read. Measured, the
table runs a 64.6% cache-hit ratio, so the conservative saving is **$9–21/month
of transfer and nothing of compute** until autoscaling is enabled separately.
The refactor is still worth shipping — it halves the catalogue reads and closes
a real correctness gap — but it is not the main lever.

---

## 1 · What changed

`collectUniverse()` read the whole `provider_assets` catalogue **twice** per
five-minute run:

1. `currentState()` — identity + fingerprint, joined to `provider_asset_state`
2. `registerAssets()` — the identical rows again, purely to map identity → `id`

The second read exists only because `currentState` did not return `a.id`, which
was already on every row it read.

### After

Every id now comes from one of three sources, none of which scans the
catalogue:

| Source | Covers |
|---|---|
| `currentState`'s existing scan, now selecting `a.id` | every asset that has state |
| `INSERT … ON CONFLICT DO NOTHING **RETURNING**` | rows this run actually created |
| A targeted lookup on the unique identity index | the remainder, normally empty |

### The third source is load-bearing, not defensive

An asset registered by an earlier run whose state write then failed sits in
`provider_assets` with **no** row in `provider_asset_state`. `currentState`'s
inner join cannot see it, and `ON CONFLICT DO NOTHING` will not re-insert it.
Without the targeted lookup that asset becomes permanently unresolvable —
observed every run, filtered out of the write set every run, never recovered.

The old full-table read-back happened to cover this case by brute force.
Removing it without replacing that path would have introduced a silent,
permanent data gap. There is a regression test for exactly this.

### Diff

```
 src/lib/collectors/universe-collection.ts |   5 +-
 src/lib/db/universe-store.ts              | 166 +++++++++++++++-------
 tests/universe-store-reads.test.ts        | 219 +++++ (new, 9 tests)
```

Preserved unchanged: provider→asset mapping by `market_hash_name`, unmapped
assets keeping a null `asset_id`, universe coverage, delta semantics,
append-only history, and the `KnownState` fingerprint contract — ids are
returned in a **separate map** rather than widening `KnownState`, so storage
identity can never become something a market change is attributed to.

---

## 2 · Tests

**This code path had no test coverage at all.** That is how a redundant
full-table scan survived in the five-minute hot path: the refactor initially
passed all 1,595 existing tests without any of them touching it.

`tests/universe-store-reads.test.ts` — 9 tests:

| Test | Pins |
|---|---|
| reads the catalogue once per run | no second scan; the regression itself |
| resolves a known asset without lookup | source 1 |
| resolves a brand-new asset from the insert | source 2 |
| **recovers an asset whose state write never landed** | source 3, the correctness gap |
| idempotent across a retry of the same run | retry safety |
| one entry per distinct identity when a key repeats | duplicate keys |
| separates identities differing only by version | `NULL` version handling |
| describes only the identities it was asked about | partial provider response |
| issues no statement for an empty response | empty response |

**Verified to have teeth by mutation:**

| Mutation | Result |
|---|---|
| Remove the gap lookup | 1 failed — the stranded-asset test |
| Ignore the caller's known ids | 4 failed |

```
Test Files  96 passed (96)
Tests       1604 passed (1604)      (+9)
Typecheck   clean
Lint        0 errors, 10 warnings (pre-existing)
Build       ✓ Compiled successfully
```

---

## 3 · Before / after, measured on production

### The query this release removes

```
Seq Scan on provider_assets (rows=25838)
  Filter: provider = 'SKINPORT_DIRECT' AND venue = 'SKINPORT'
  Rows Removed by Filter: 40087
  Buffers: shared hit=836  read=9270     <- cold
  Buffers: shared hit=9205 read=901      <- warm, same query minutes later
```

**Both readings are the same query.** The difference is cache state, and it is
the single most important fact in this report: the cost of this scan varies by
an order of magnitude depending on whether the table is resident.

~10,100 blocks (79 MB) are *touched* either way. How many of those are
*physical* reads — the ones that cost money — depends on cache warmth.

### The query that remains

```
Hash Join (rows=25838)
  ->  Seq Scan on provider_asset_state  (hit=1263)
  ->  Seq Scan on provider_assets       (hit=9240 read=866)
Execution Time: 36 ms
```

Adding `a.id` changes neither the plan nor the buffer count — the column is on
rows already being read.

### Why the plan is a sequential scan, and stays one

`provider_assets` holds **both** venues: 25,838 Skinport rows and 40,087 Steam.
`provider + venue` is therefore only 39% selective and the planner correctly
prefers a scan. Even selecting only indexed columns still scans. That is the
subject of the (unapproved) partial-index proposal, not of this release.

---

## 4 · Reconciling 294.8 MB with 236 MB — they are not the same quantity

You asked me not to assume equivalence. They are not equivalent.

| Figure | What it is |
|---|---|
| **294.8 MB** | `provider_assets` physical reads over a **6.7-minute** window (~1.34 collection cycles) → ~220 MB per run |
| **236 MB** | derived from a different 11-minute window (520 MB across ~2.2 runs) |
| **269 MB** | billed transfer, 77.5 GB/day ÷ 288 runs |

Measured physical reads across **all** tables were ~224 MB/run against 269 MB/run
billed — **83%**. Same order, consistently correlated, but not the same thing:

- `blks_read` counts blocks not found in **shared_buffers**. Neon then serves
  some of those from the compute's **Local File Cache** (1,461 MB limit) without
  crossing the network, so `blks_read` is an **upper bound** on
  compute↔storage traffic, not a measurement of it.
- Neon's billed "data transfer" line may also include client egress and WAL,
  neither of which appears in `blks_read`.

The two earlier per-run figures differ from each other simply because they were
sampled over different windows with different cache states. **The correct
reading is that transfer tracks block reads closely enough to predict direction
and rough magnitude, and not closely enough to predict a precise saving.**

---

## 5 · Expected cost impact, conservatively

`provider_assets` lifetime cache behaviour: **126,053,079 blocks read against
230,446,040 hits — a 64.6% hit ratio.** During the sampled window it was far
colder (14%). The honest estimate is therefore a range, not a number.

| Cache assumption | Physical MB/run saved | GB/day | **$/month** |
|---|---:|---:|---:|
| Cold, as sampled (14% hits) | 68 | 19.1 | **$20.97** |
| Lifetime average (64.6% hits) | 28 | 7.9 | **$8.63** |

### Transfer versus compute, separated

- **Transfer: $9–21/month.** This is the whole of the saving.
- **Compute: $0.** The removed query takes ~20 ms of an ~8-second run. More
  importantly, billed compute is 98.5% consistent with both endpoints pinned at
  their ceiling continuously — **on a fixed-size compute, doing less work costs
  exactly the same.** Release 1 cannot reduce the compute line on its own.

Against a $318/month bill this is a **3–7% reduction**. I am stating that
plainly because my previous report's $26 figure implied more, and because the
decision about what to do next should not rest on an inflated number.

The refactor's better justifications are that it halves catalogue reads
(reducing cache pressure on everything else sharing the endpoint), and that it
closes the stranded-asset gap.

---

## 6 · Neon autoscaling — measured workload and proposal

I could not read the current settings; there is no Neon API key available and I
would not change billing infrastructure without approval. What the database does
report:

| Signal | Value |
|---|---|
| Compute uptime (product) | **14 days 13 hours** without suspending |
| Billed compute vs both ceilings running 24/7 | **98.5%** |
| `max_connections` | 901 → sized for a **2 CU** ceiling |
| LFC limit | 1,461 MB |
| Concurrent connections observed | **1** |
| Hot set (`provider_assets` + `provider_asset_state`) | **114 MB** |
| Longest query measured | 57 ms |
| Largest hash-join working memory | 3.4 MB |
| Collection run duration | ~8 s |

A single connection, a 114 MB hot set and a 57 ms worst query do not need 2 CU.
The 98.5% figure is consistent with autoscaling being off or pinned at maximum.

**Proposal — change the minimum only:**

| Endpoint | Minimum | Maximum |
|---|---|---|
| `ep-noisy-scene` (product) | 2 CU → **0.25 CU** | 2 CU — **unchanged** |
| `ep-hidden-river` (derived, images, catalog) | 1 CU → **0.25 CU** | 1 CU — **unchanged** |

Lowering only the minimum is purely additive: if load needs more, autoscaling
provides it. Leaving the maxima alone preserves headroom for the derivation's
441 MB source read. 0.25 CU still gives an LFC comfortably larger than the
114 MB hot set.

**This is the change that converts Release 1 into money.** Until the compute can
scale down, reduced work produces no reduced cost. I have not made it — it is
yours to make in the console, and I would suggest doing it *before* Release 1 so
the deployment's effect is measurable.

---

## 7 · Deployment and rollback

**Deployment.** Ordinary application deploy via the Git integration. No
migration, no schema change, no index, no scheduler change, no configuration
change. The first collector run after deploy exercises the new path.

**Watch on the first run** (`/api/internal/data-health`, or `collector_runs`):

| Signal | Expected | Abort if |
|---|---|---|
| Run status | `PARTIAL` (unchanged — two delisted assets) | `FAILED` |
| `items_received` | ~25,165 | materially lower |
| Universe log line `collector.universe` | present, `rowsWritten` in normal range | `collector.universe_failed` |
| `statesChanged` + `statesCreated` | comparable to prior runs | a step change |
| `provider_asset_state` row count | continues tracking the catalogue | stops growing |

A failure in the universe path is already caught and swallowed by its caller and
**cannot fail the run that feeds the intelligence pipeline** — that isolation is
pre-existing and unchanged, so the blast radius of a defect here is broad-catalogue
accumulation, not the tracked product.

**Rollback.** `git revert` the commit and deploy. No data migration to undo and
nothing to clean up: the change alters only which statements are issued, not
what is stored. Any asset registered under the new path is indistinguishable
from one registered under the old. Rollback is safe at any point, including
mid-run.

---

## 8 · What is measured, and what is not

**Measured:** both query plans and their buffer counts, cold and warm; the
64.6% lifetime hit ratio; the 83% ratio between physical reads and billed
transfer; the per-table I/O attribution; the workload envelope in section 6;
all test and mutation results.

**Estimated:** the $9–21/month range, which depends on cache state the sampling
shows to be variable. I would treat the lower bound as the planning number.

**Unverified:** the current autoscaling configuration (section 6 — console),
and therefore whether any compute saving follows from this at all.
