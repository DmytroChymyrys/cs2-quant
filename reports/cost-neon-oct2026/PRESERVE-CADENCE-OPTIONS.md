# Preserving Five-Minute Collection — Ranked Options

**Headline: five-minute collection is affordable.** The cost is not caused by
collecting every five minutes. It is caused by two full sequential scans of a
65,925-row table on every run, and by a derived ticker that wakes a database 288
times a day to do 24 jobs. Both are fixable without touching cadence.

Nothing deployed. No production change, no scheduler change, no plan change.

---

## 1 · Where the 236 MB per run actually goes

Measured per table across a full collection cycle (`pg_statio_user_tables`
delta, 6.7 minutes):

| Table | Physical reads | Buffer hits | Path |
|---|---:|---:|---|
| **`provider_assets`** | **294.8 MB** | 342.9 MB | universe |
| `provider_asset_state` | 0 | 1,682.1 MB | universe |
| `collector_runs` | 0 | 788.0 MB | both |
| `market_observations` | **2.2 MB** | 36.0 MB | **tracked (the product)** |
| everything else | ~4.8 MB | — | — |
| **Total** | **299.8 MB** | 2,887.6 MB | |

**The 150 tracked assets that feed the intelligence product cost 2.2 MB per
run.** Essentially the entire bill belongs to `collectUniverse()`, the broad
accumulation of the other ~25,000 catalogue items.

### The specific defect

Production query plan for `universeStore.currentState()`:

```
Seq Scan on provider_assets (rows=25838)
  Filter: provider = 'SKINPORT_DIRECT' AND venue = 'SKINPORT'
  Rows Removed by Filter: 40087
  Buffers: shared hit=836 read=9270          <- 72 MB, every run
```

Three compounding causes:

1. **No usable index for this access path.** `provider_assets` holds Skinport
   (25,838) *and* Steam (40,087) rows, so `provider + venue` is only 39%
   selective and the planner correctly prefers a sequential scan. Even selecting
   only indexed columns still seq-scans.
2. **The same rows are read twice per run.** `currentState()` selects
   `external_asset_key, version, market_hash_name, state_hash, present`; a
   second query then re-reads the identical rows purely to map key → `id`.
   `currentState` could return `a.id` and the second query could be deleted.
3. **The scan reads 65,925 rows to use 25,838**, discarding the Steam rows every
   time.

| Breakdown of ~236 MB/run | |
|---|---:|
| `currentState()` seq scan | ~72 MB |
| id-lookup seq scan (same rows again) | ~72 MB |
| index/heap re-reads, state, history writes | ~90 MB |
| tracked-asset path (the actual product) | **2.2 MB** |

### Provider response size is not the problem

Each run fetches 25,165 items + 37,383 history entries from Skinport. That is
provider→application traffic over the internet and **does not appear on the Neon
bill at all.** Neon's billed "data transfer" tracks database I/O: measured
storage reads were 68.5 GB/day against 77.5 GB/day billed (88%).

---

## 2 · Options, ranked

Costs use the invoice's own effective rates (compute $0.106/CU-h — confirmed as
Neon's **Launch** rate; transfer $0.0366/GB). Today: **$318/month**
(compute $225, transfer $85, other $8).

| # | Option | Monthly | Effort | Data quality | Provider risk | Rollback |
|---|---|---:|---|---|---|---|
| **1** | **Merge the duplicate `provider_assets` read** | **$292** | ~1 h | **none** | none | revert commit |
| **2** | **Partial covering index** | **$239** | ~2 h + migration | **none** | none | drop index |
| **3** | **Neon autoscaling min 0.25 CU** | varies | minutes | none | none | console |
| **4** | **Self-chained derived continuation** | **$260** | ~4 h | none | none | revert + cron |
| — | **1+2+3+4 combined** | **≈$51** | ~7 h | **none** | **none** | per item |
| 5 | Fifteen-minute collection | ≈$38 | ~3 h | **−9.6% of movement signal** | **unknown** | cron + revert |
| 6 | Hourly collection (withdrawn) | ≈$98 | ~2 days | **−24% of asset-hours** | resolves request | cron + revert |
| 7 | Pause universe accumulation | ≈$120 | **0 — env var** | cross-venue degrades | none | env var |
| 8 | Pause collector entirely | ≈$95 | 0 — dashboard | no new observations | none | dashboard |

### 1 · Merge the duplicate read — do this first

`currentState()` adds `a.id` to its select list; the second query is deleted.
One full scan per run disappears. **Measured, not estimated**: −72 MB of the
236 MB, immediately, with no cadence, schema or semantic change.

Transfer 66.5 → 46 GB/day. **−$26/month.**

### 2 · Partial covering index

```sql
CREATE INDEX CONCURRENTLY provider_assets_skinport_state
  ON provider_assets (external_asset_key, version)
  INCLUDE (id, market_hash_name)
  WHERE provider = 'SKINPORT_DIRECT' AND venue = 'SKINPORT';
```

A partial index whose predicate exactly matches the WHERE clause removes the
selectivity problem — it contains only the 25,838 Skinport rows (~1.5 MB) and
can serve the query index-only.

**This is an expectation, not a measurement.** I did not create the index,
because that is a production change: even a transactional build takes a SHARE
lock that would briefly block the collector. **Step 1 of implementing this is to
verify the plan** with `BEGIN; CREATE INDEX …; EXPLAIN …; ROLLBACK;` at a quiet
moment. If the planner does not choose it, this option drops out and options 1,
3 and 4 still stand.

If it works: transfer 46 → ~5 GB/day. **−$53/month.**

### 3 · Neon autoscaling minimum

Billed compute is 98.5% of both endpoints running at their ceiling continuously
(product 2 CU, shared 1 CU), and the product compute has been up **14 days
13 hours** without suspending. That is consistent with autoscaling being off or
pinned.

Options 1, 2 and 4 cut the *work* dramatically — but on a fixed-size compute,
less work costs exactly the same. **Autoscaling is what converts the other three
into money.** Set minimum 0.25 CU on both endpoints; leave maxima alone.

Contingent and unverified — I cannot read the setting from the database. Please
check the console. If autoscaling is already on with a low minimum, the combined
estimate improves; if it is off, this is the single highest-leverage change on
the list.

### 4 · Self-chained derived continuation

Measured build behaviour: **134 of 135 builds take exactly 3 ticks**, and
`461 of 576` ticks are 0.1-second cooldown no-ops that exist only to wake a
database.

Instead of waiting 5 minutes for cron between ticks, a tick returning
`CONTINUES` invokes the route again immediately. A build then completes in
~272 s of wall time rather than 15 minutes, and cron's only remaining jobs are
to *start* a build and to *recover* a broken chain.

| | Today | Proposed |
|---|---|---|
| Cron | `*/5` — 288/day | `*/20` — 72/day |
| Build span | ~15 min | ~5 min |
| Publication cycle | 70–75 min | **65–85 min** |
| Headroom to the 90-minute allowance | 15–20 min | **5–25 min** |

To preserve retry headroom rather than assume reliability, the chain retries
once in-process before giving up; a hard failure is recovered by the next cron
tick within 20 minutes. **I am explicitly not proposing `*/10` on the grounds
that the last seven days had no failures** — the chain carries the work, and
cron is insurance.

Shared compute 100% → ~25% uptime. **−$58/month.**

### 5 · Fifteen-minute collection — measured, and better than expected

| Sampling | Asset-hours showing movement |
|---|---:|
| Five-minute (today) | **24.0%** |
| Fifteen-minute | **21.7%** |
| Hourly | 0% intra-hour by construction |

Over 24,833 asset-hours. **Fifteen-minute sampling retains 90% of the movement
signal** and loses 2.3 percentage points, against hourly which loses all 24.0.

**On provider permission: I do not know, and I will not assume.** The recorded
note asks for the full response **once an hour**. Fifteen minutes is four times
more frequent than that. Nothing in the repository records Skinport agreeing to
fifteen minutes, and reducing frequency is not the same as complying. **This
needs an explicit conversation with Skinport before it is treated as an option**
— which is also true of the five-minute cadence we run today.

Note that options 1–4 remove the cost argument for changing cadence at all, so
this becomes purely a provider-relations decision rather than a financial one.

---

## 3 · Priority 4 — immediate containment

Both are reversible and **lose no stored observations.**

### Containment A — pause universe accumulation (0 effort, no deploy)

`SKINPORT_UNIVERSE_COLLECTION=false` in Vercel. Currently unset, so it defaults
to enabled. Changing it needs **no deploy and no code change**.

- Removes ~99% of data transfer and most product-database work immediately
- **All 150 tracked assets keep collecting at five minutes** — the intelligence
  product is untouched
- Nothing stored is deleted; accumulation simply stops
- **Cost:** `provider_asset_state` stops updating, so Skinport observations age
  past `SKINPORT_STALE_AFTER_MS` (30 min) and the **cross-venue panel, clearance
  and velocity metrics go unavailable** within the hour. Observed-asset pages
  and inventory matching degrade too.
- Reverse by removing the variable.
- Estimated **$318 → ~$120/month.**

### Containment B — read-only historical mode

Disable the cron-job.org job. Collection stops entirely; the site serves stored
observations.

- Every observation is preserved; nothing is deleted
- **Freshness labelling already handles this correctly** — the work shipped last
  week means snapshots past the 90-minute allowance are labelled `Stale`, and the
  Terminal states the rule. The product will say it is stale rather than imply
  it is current, without any new code.
- Estimated **~$95/month** (computes still wake for the derived ticker until
  that is also paused).
- Reverse from the dashboard within one cycle.

**I recommend neither unless options 1–4 cannot be scheduled**, because they
trade visible product capability for savings that option 1 alone partly
delivers with no downside.

---

## 4 · Recommendation

**Do options 1 + 3 this week, then 2 and 4.**

| Step | Why first |
|---|---|
| **1 · Merge the duplicate read** | Measured, ~1 hour, no schema or cadence change, nothing to roll back but a commit. |
| **3 · Autoscaling minimum** | Minutes of console work, and without it the other options reduce work without reducing cost. |
| **2 · Partial index** | Verify the plan first; largest transfer win if confirmed. |
| **4 · Self-chained continuation** | Largest compute win, but the most code and the only one touching a safety-critical path. |

Combined: **~$318 → ~$51/month, with five-minute collection fully intact and no
change to market-data semantics.** That is within reach of the $30–40 target
without degrading anything, and it reaches it outright if the autoscaling
minimum behaves as expected.

**The 24% signal loss is not a price we need to pay.** The cost was never the
cadence — it was two sequential scans and an idle ticker.

### What is measured and what is not

**Measured:** the per-table I/O breakdown; the production query plan and its
9,270-block scan; the duplicate query; 134-of-135 three-tick builds and zero
failures in 7 days; 24.0% / 21.7% movement at five- and fifteen-minute sampling;
the Launch plan rate; the 14-day compute uptime.

**Not measured:** that the partial index will be chosen (option 2 — verify
first); the current autoscaling configuration (option 3 — console); the exact CU
reduction that follows from less work, which depends on option 3. Cost figures
for options 2, 3 and 4 are projections built on the measured I/O, not
observations.

**Unknown and not assumable:** whether Skinport permits any cadence faster than
hourly, including the one we run today.
