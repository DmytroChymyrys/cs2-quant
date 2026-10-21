# Cost Optimisation — Track A validation and Track B readiness

**Nothing was deployed.** Track A's proposed scheduling changes did not survive
validation: both would have broken production, and neither would have saved
money. The levers that do work are Neon console settings you control, plus the
Track B cutover. Details and exact settings below.

No code, schedule, or production data was changed. The pulled production
environment file was deleted after use.

---

## Headline: the investigation's two estimates are now measured, and both root
## causes are the same job

| | Investigation said | Now measured |
|---|---|---|
| Compute | "~2.95 CU continuous" (estimate) | **98.5% of two computes pinned at ceiling, 24/7** |
| Transfer | "441 MB scope reads" (≈11%, rest unattributed) | **236 MB × 288 Skinport runs = 66.5 GB/day = 86% of the bill** |

**Both are caused by the five-minute Skinport collector.** It is why the product
compute never suspends, and it is 86% of data transfer. Track B is not the
second priority — it is the whole fix.

### Two corrections to the investigation

1. **There are two computes, not four.** `derived`, `asset-images` and
   `catalog` all share `ep-hidden-river-awljcdfl`; only the product database has
   its own (`ep-noisy-scene-aum078ox`). This matters: slowing one job on the
   shared endpoint saves nothing while another job keeps it awake.
2. **Transfer is dominated by storage reads, not the derivation scope.** The
   7-day scope read is real but is ~11% of the bill.

---

## Track A

### A.1 — Compute settings and scale-to-zero: **measured, conclusive**

`pg_postmaster_start_time()` is decisive, because a Neon compute restarts when
it resumes from suspend:

| Endpoint | Databases | Uptime | `max_connections` | Ceiling |
|---|---|---|---|---|
| `ep-noisy-scene-aum078ox` | product | **14 days 13 h** | 901 | 2 CU |
| `ep-hidden-river-awljcdfl` | derived, asset-images, catalog | **1 day 23 h** | 450 | 1 CU |

The product compute **has not suspended once in 14½ days** — it covers almost
the whole billing period.

```
(2 CU + 1 CU) x 504 h = 1,512 CU-h
billed                = 1,488.77 CU-h   = 98.5%
```

Both computes run at their ceiling, continuously. This is not autoscaling that
happens to stay high; 98.5% means **scale-to-zero is off and the computes are
effectively fixed-size.** The $225/month compute line is two idle machines.

### A.2 — Derived refresh schedule: **the proposed change was wrong**

Measured from `derived_refresh_runs`, last 48 h:

| Result | Stage | Runs | Avg |
|---|---|---:|---:|
| COOLDOWN | cooldown | 461 | 0.1 s |
| CONTINUES | plan | 38 | 33.1 s |
| CONTINUES | derive | 38 | 110.7 s |
| ACTIVATED | activate | 39 | 127.9 s |

A build is **three consecutive ticks, ~272 s of work**. 80% of invocations are
0.1-second no-ops that exist only to wake the compute.

**My proposed `0,5,10,15,20` would stall builds.** Activation lands at minute
M; the cooldown expires at M+60, so the next build starts at minute M of the
following hour and finishes at M+10. M drifts +10 minutes every cycle, and once
M exceeds 25 the build has no ticks left and stalls until the next hour.

The general constraint: with ticks every T minutes, the publication cycle is
`60 + 3T` minutes. The freshness allowance shipped last week is **90 minutes**,
so `3T ≤ 30` and **T ≤ 10** — and T=10 has exactly zero margin. Observed today
at T=5: 19.5 builds/day, a ~74-minute cycle, which matches `60 + 15`.

**Conclusion: the ticker must stay at `*/5`.** Slowing it would push snapshots
past the staleness threshold and reintroduce the "Stale" wall we just fixed.

### A.3 — Asset-images health: **the proposed change would have broken the site**

`HEALTH_MAX_AGE_MS` is 20 minutes, and the route documents why `*/10` was
chosen:

> it has to run on a schedule tighter than that TTL or the icons go dark on
> their own. The Vercel Cron entry runs it every ten minutes, leaving room for
> one failed probe before the record lapses.

At `*/20` the probe would run exactly at the TTL; one failed or delayed probe
turns artwork off site-wide. And because this endpoint shares a compute with the
derived database — woken every five minutes regardless — **changing it saves
nothing.** No change.

### A.4 / A.5 — Implementation: **nothing to deploy**

All three candidate scheduling changes failed validation. Deploying any of them
would have cost availability and saved approximately zero. Existing data,
schedules and rollback paths are untouched.

**The Track A lever is in the Neon console, and needs you.** I have no Neon API
key and would not change billing infrastructure without approval regardless.

For **both** endpoints:

| Setting | Now (inferred from uptime + 98.5% match) | Set to |
|---|---|---|
| Scale to zero | disabled | **enabled** |
| Scale-to-zero delay | n/a | **60 s** (shortest available) |
| Autoscaling minimum | = maximum | **0.25 CU** |
| Autoscaling maximum | product 2 CU / shared 1 CU | leave |

Why 60 seconds matters more than it looks: the collector runs every 300 s. At
the default 300-second suspend delay the compute **can never suspend**, no
matter what else we do. At 60 s it sleeps ~4 minutes of every 5.

Projected compute, holding today's schedules: **$225 → ~$28/month.** This is a
projection, not a measurement — it depends on actual burst CU during the 8-second
collection runs. A.6 below measures it.

### A.6 — Baseline for post-change measurement

Captured today so the effect is measurable rather than assumed:

```
product  compute uptime 14d13h   blks_read 66.50 GB/day   rows 91.3 M/day
derived  compute uptime  1d23h   blks_read  1.95 GB/day   rows 316.8 M/day
         measured storage reads  68.5 GB/day  vs  77.5 GB/day billed  (88%)
Skinport 288 runs/day, 8.1 s avg, 236 MB storage reads per run
derived  19.5 builds/day, ~74-minute publication cycle
```

Re-run the same probes 48 h after the console change. The signal to look for is
`pg_postmaster_start_time()` moving — that is proof of suspension.

---

## Track B — hourly Skinport / V4 cutover

### B.1 — V4 audit

`V4_HOURLY` (`listing-features-v4-1h`) is complete and coherent: its own method
string, hourly step, horizons collapsed to 1h/6h/24h with sample counts
1/6/24, and `scopeFloor` set. 22 tests in `tests/cadence-profiles.test.ts` cover
profile identity, horizon retirement, expected-window counts, scope clamping and
reader compatibility.

**Gap:** the tests are unit-level. Nothing exercises a full derive → validate →
activate cycle under V4 against real evidence. That is the main pre-release task.

**Also found — a third option the investigation missed.** `V4_FIFTEEN_MINUTE`
exists, described as *"a quarter of the five-minute request volume while keeping
most intra-hour resolution"*:

| Profile | Runs/day | 24 h volatility samples | Transfer |
|---|---:|---:|---:|
| V3 five-minute (today) | 288 | 288 | 66.5 GB/day |
| **V4_FIFTEEN_MINUTE** | 96 | 96 | ~22 GB/day |
| **V4_HOURLY** | 24 | **24** | ~5.5 GB/day |

Hourly collapses 24-hour realised volatility from a 288-sample statistic to a
24-sample one — `cadence.ts` calls this *"a different statistic wearing the same
name"*. Fifteen-minute keeps four times the resolution at a third of the saving.

**I recommend hourly anyway**, because Skinport asked for hourly and we have been
ignoring that for a month. But the statistical cost is real and the choice is
yours.

### B.2 / B.3 — **Blocking defect in the cutover path**

`HOURLY_REGIME_FROM = 2026-09-22T14:00:00.000Z` records a regime change **that
never happened.** Collection has been five-minute continuously through today.

The scope floor therefore does not protect the cutover. Proven by running the
real `applyScopeFloor` against today's scope:

```
HOURLY_REGIME_FROM   : 2026-09-22T14:00:00.000Z
requested scope from : 2026-10-14T13:00:00.000Z   (7-day default)
after scope floor    : 2026-10-14T13:00:00.000Z
floor applied?       : false
```

The floor only clamps scopes reaching back **before** 22 September. Today's
7-day window sits entirely after it — and is entirely five-minute evidence. A V4
switch today would put **twelve collector runs in every hourly window and trip
DUPLICATE_INTEGRITY**, which is blocking. The guard exists and is correct; the
constant it depends on is stale.

**Remedy, verified:** set `HOURLY_REGIME_FROM` to the actual cutover instant and
switch the scheduler and `ACTIVE_PROFILE` **together**. Re-run with the floor at
a real cutover:

```
t+  1h  scope starts <cutover>   (1h of hourly evidence)
t+  6h  scope starts <cutover>   (6h of hourly evidence)
t+ 24h  scope starts <cutover>   (24h of hourly evidence)
t+168h  scope starts <cutover>   (168h of hourly evidence)
```

The floor fires at every point, so no five-minute evidence can enter a V4 scope.

**A staged cutover is worse, not safer.** Switching the scheduler first and the
profile later leaves V3 deriving over hourly evidence — 1 sample where it expects
12 — which suppresses volatility and activity for the entire gap. Simultaneous is
correct.

### B.4 — Expected product behaviour after cutover

Unavoidable, and it must be disclosed rather than discovered:

| Horizon | Available from |
|---|---|
| 1h | cutover + 1 h |
| 6h | cutover + 6 h |
| 24h | cutover + 24 h |

Until then those metrics read **Unavailable**, which is the honest rendering —
`volatility()` returns null when the sample count does not match the contract.
Screener returns, Terminal volatility and Asset Intelligence charts will be
sparse for the first day. Freshness indicators are unaffected: the 90-minute
observation allowance and the 900-second provider-lag budget are both cadence-
independent by design after last week's fix.

### B.5 — Scheduler change: **prepared, not applied**

The job lives at cron-job.org (job configured by `scripts/configure-cron.ts`,
currently minutes `[0,5,10,...,55]`). **I could not reach `api.cron-job.org`** —
outbound requests to it fail in this sandbox — so the schedule must be changed
from the cron-job.org dashboard or from an unsandboxed shell. Change the job's
minutes from twelve entries to a single `[0]`.

### B.6 — Deployment sequence

| # | Step | Verify |
|---|---|---|
| 1 | Neon console: scale-to-zero 60 s, autoscale min 0.25 CU, both endpoints | `pg_postmaster_start_time()` starts moving |
| 2 | Wait 48 h; re-measure compute and transfer | A.6 baseline vs new |
| 3 | Set `HOURLY_REGIME_FROM` to the chosen cutover instant | unit tests |
| 4 | Add a V4 end-to-end derive test against captured evidence | green |
| 5 | **At the cutover instant:** change cron-job.org to `[0]` **and** deploy `ACTIVE_PROFILE = V4_HOURLY` | — |
| 6 | Watch first build: no DUPLICATE_INTEGRITY, snapshot activates | `derived_refresh_runs` |
| 7 | t+1h / t+6h / t+24h: horizons populate in order | Screener, Terminal |
| 8 | t+48h: re-measure cost | target $30–40 |

**Rollback:** revert `ACTIVE_PROFILE` to `V3_FIVE_MINUTE` and restore the
twelve-minute cron entry. V3 snapshots are untouched and the active pointer still
references one, so reverting restores the previous contract without data loss.
Historical observations are preserved throughout — no step deletes anything.

### B.7 — Release gate

**Blockers before activation:**

1. `HOURLY_REGIME_FROM` must be updated (B.2). **Hard blocker.**
2. A V4 end-to-end derive/validate/activate test (B.1 gap). **Should block.**
3. Choice between `V4_HOURLY` and `V4_FIFTEEN_MINUTE` (B.1). **Your decision.**
4. Confirmation that a 24-hour window of Unavailable 24h-horizon metrics is
   acceptable on a live site (B.4). **Your decision.**

---

## Projected cost, separated from measurement

**Measured:** everything in A.1, A.2, A.3, A.6, B.2 — uptimes, the 98.5%
reconciliation, build anatomy, per-run storage reads, the scope-floor failure.

**Projected:** the figures below. They assume a 60-second suspend delay and
0.25 CU idle, neither of which I can read or set.

| Stage | Compute | Transfer | Other | **Total** |
|---|---:|---:|---:|---:|
| Today | $225 | $85 | $8 | **$318** |
| After Neon console change only | ~$28 | $85 | $8 | **~$121** |
| After console + hourly cutover | ~$12 | ~$7 | ~$6 | **~$25** |
| After console + 15-minute cutover | ~$18 | ~$24 | ~$7 | **~$49** |

Hourly reaches the $30–40 target with margin. Fifteen-minute does not, which is
the practical argument for hourly on top of the provider's request.

---

## Risks needing your approval

1. **Neon console changes** — I cannot and should not make billing-infrastructure
   changes. Settings specified in A.4.
2. **Cutover is simultaneous, not staged** — scheduler and profile must change
   together (B.3). This is a single coordinated moment, not a gradual rollout.
3. **24 hours of degraded horizon metrics** on a live site (B.4).
4. **The 24h volatility statistic changes meaning** under hourly collection
   (B.1) — permanently, not just during transition.
5. **cron-job.org is unreachable from here** (B.5) — you or an unsandboxed shell
   must make the scheduler change, and it must be timed with the deploy.

## Not done, as instructed

No AWS migration work, no Neon database consolidation, no destructive cleanup.
All 1,440,935 historical observations are intact.
