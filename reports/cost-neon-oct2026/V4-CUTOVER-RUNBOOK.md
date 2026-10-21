# V4 Hourly Cutover — Operator Runbook

**Not ready to deploy.** Item 6 uncovered that the cutover is far larger than
changing `ACTIVE_PROFILE`: a dry run switching the profile and the collector
window produced **74 failing tests across 16 files**. Those failures are the
work, not a formality. The runbook below is complete and the preparation is
done and committed-ready, but step 5 cannot be executed until that work lands.

Nothing was deployed. No production data, schedule or infrastructure changed.

---

## 1 · Regime transition verified against a real future cutover

`tests/v4-cutover.test.ts` (new, 7 tests) builds genuine mixed-regime evidence —
48 hours of five-minute collection ending at the cutover, then hourly collection
after it — and derives across the seam using a **November cutover instant**, not
the obsolete September constant.

Proved:

| Property | Result |
|---|---|
| Every 7-day scope clamps to the cutover for 7 days afterwards | pass |
| The floor stops applying on day 8, when the window clears the seam | pass |
| A scope ending at the cutover derives nothing rather than something meaningless | pass |
| No five-minute observation enters a V4 snapshot | pass — 24 rows, all ≥ cutover |
| No blocking operational failure across the seam | pass |

**The tests have teeth.** Re-running the same derivation with the obsolete
constant:

```
obsolete floor -> scope.from = 2026-10-26   (floor never fires)
feature rows             : 600   (correct hourly grid = 24)
rows from BEFORE cutover : 576   five-minute evidence leaked in
```

---

## 2 · How five-minute history is isolated

By the scope floor, and only by it. `applyScopeFloor` raises any scope start to
`scopeFloor`; `prepare()` then filters runs and observations to
`[from, to)`. Nothing before the cutover can be read.

**The seven-day scope is the reason this matters.** The default derivation
window reaches back seven days, so for the first week after cutover *every*
scope would reach into five-minute evidence if the floor were wrong.

This is why the constant was the blocker. It has been renamed to
`HOURLY_COLLECTION_FROM`, documented with the measured consequence of getting it
wrong, and pinned by a test that fails if it drifts from `V4_HOURLY.scopeFloor`.
**Its value is still the obsolete September date** and must be set to the real
cutover instant at release — step 5 below.

Historical observations are untouched throughout. Isolation is by read scope,
never by deletion.

---

## 3 · DUPLICATE_INTEGRITY and misleading statistics

**Neither occurs. The mechanism is not what `cadence.ts` claimed.**

`cadence.ts` warned that hourly derivation over five-minute evidence "would put
twelve claimed runs in one window and trip DUPLICATE_INTEGRITY". Reading
`prepare.ts`, duplicates are grouped by the run's **stored** `window` value, not
by a recomputed hourly bucket. Five-minute windows (`:00, :05, …`) are all
distinct, so **DUPLICATE_INTEGRITY never fires.** Measured on the seam:
`duplicateClaimedWindows: []`, `duplicateRunAssetPairs: []`.

The protection that actually holds is stronger and lives in the derivation:

```ts
if (sample.length !== steps) return null;      // features.ts
count(values[`volatility_return_count_${h}`]) === expectedFor(method)[h]
  ? value : null                               // map.ts
```

Every rolling statistic is gated on an **exact** sample count. Given the wrong
number of samples it returns null. Confirmed even in the bad case: with the
obsolete floor and 576 leaked rows, `realized_volatility_24h` was still `null`
and `min_price_return_1h` was 0.45% — because baselines are selected by **time
offset** (`nearest(h * step)`), not array index.

**So the failure mode of a wrong floor is a 25× bloated, mixed-regime snapshot —
which destroys the entire cost saving — not silently wrong numbers.** That is a
materially better risk profile than the investigation assumed, and it is the
reason this cutover is safe to attempt at all.

---

## 4 · Behaviour while hourly evidence accumulates

| Surface | During transition |
|---|---|
| **Screener** | Prices, listing counts, venue divergence, days-to-clear: **unaffected**. Return and Volatility columns read `Unavailable` until their window completes. Sorting by an unavailable column places those rows last, as it already does. |
| **Terminal** | Same. "Volatility available" and "Price returns available" counts drop until recovery. |
| **Asset Intelligence** | Chart renders from observations, so it draws from the first hourly point; the series is sparse, not wrong. Cross-venue and liquidity panels **unaffected** — they read live provider state, not the snapshot. |
| **Freshness indicators** | **Unaffected.** The 90-minute observation allowance and 900-second provider-lag budget are cadence-independent by construction after the freshness fix. Rows will not show "Stale" because of the cutover. |

**UI messaging (implemented).** `cadenceTransition()` resolves the transition
from the snapshot's own method and scope — no hard-coded date — and
`EvidenceNotice` renders it inside the existing freshness strip:

> Collection moved to a one-hour grid at &lt;cutover&gt;. Statistics over longer
> windows are still accumulating samples and read Unavailable until their window
> is complete: 6h from …, 24h from …. Published prices and listing counts are
> unaffected.

It appears only while the scope is pinned to the floor **and** a horizon is
short of samples, and disappears by itself. Covered by
`tests/cadence-transition.test.ts` (8 tests).

---

## 5 · Exactly what becomes unavailable, and when it returns

Recovery is uniform: **horizon H returns H after the cutover.**

| Metric | Unavailable for | Returns at |
|---|---|---|
| Volatility · 1h, Activity · 1h, Return · 1h | 1 hour | cutover + 1h |
| Volatility · 6h, Return · 6h | 6 hours | cutover + 6h |
| Volatility · 24h, Activity · 24h, Return · 24h | 24 hours | cutover + 24h |
| Minimum / median price, listing counts | **never** | — |
| Cross-venue divergence, clearance, velocity | **never** | — |
| Freshness indicators | **never** | — |

Permanent change, not transitional: 24-hour realised volatility becomes a
**24-sample** statistic instead of 288-sample. `cadence.ts` calls this "a
different statistic wearing the same name". It is why V4 carries its own method
string.

---

## 6 · Deployment sequence

### Prerequisite work — NOT DONE, blocks step 5

A dry run switching `ACTIVE_PROFILE` to `V4_HOURLY` and `WINDOW_MS` to one hour:

```
Test Files  16 failed | 79 passed (95)
Tests       74 failed
```

Most affected: `resumable-build` (17), `intelligence-refresh` (12),
`derived-market` (11), `intelligence-freshness` (9), `derived-market-chunked` (6),
`cadence-profiles` (6).

**`WINDOW_MS` is a second, independent cadence constant** (`src/lib/config.ts`)
that the profile does not control. It drives the collector's window claim
(`skinport-collector.ts:16`), `scheduledInterval()`, analytics expected counts,
the collection watchdog and the ops dashboard. Leaving it at five minutes after
the cutover makes health reporting expect 288 windows a day and see 24. Two
tests also assert the literal string `WINDOW_MS = 5 * 60 * 1000`.

So the cutover is a coordinated change to: `ACTIVE_PROFILE`, `WINDOW_MS`,
`HOURLY_COLLECTION_FROM`, the `COLLECTION_SCHEDULE_STARTED_AT` environment value
(it must satisfy `start % WINDOW_MS === 0`), and ~74 test expectations. **This is
its own implementation gate.**

### Ordering — and the one direction that is dangerous

| Order | Consequence |
|---|---|
| Scheduler hourly **first**, profile later | V3 derives over hourly evidence: 1 sample where 12 expected, so volatility and activity suppress. **Degraded, safe.** |
| Profile **first**, scheduler later | V4 scope floored at the cutover admits five-minute evidence collected after it. **25× bloated snapshot. Avoid.** |

**Therefore: change the scheduler first, deploy the profile second.** The gap
should be short but need not be instantaneous, which removes the need for a
risky simultaneous change.

### In-flight collector runs

Safe without intervention. The collector claims `SKINPORT:<window>` where the
window is floored to `WINDOW_MS`. A run in flight when the schedule changes
completes and writes observations against its own claimed window; if that window
is before the cutover the floor excludes it, and if two schedules briefly
produce the same window the second claim is rejected as `DUPLICATE_WINDOW` and
counted in `suppressedDuplicateAttempts`. Choose a cutover on an exact hour so
the two grids coincide rather than interleave.

### Steps

| # | Action | Expected | Abort if |
|---|---|---|---|
| 0 | Complete the prerequisite work above | suite green | any test still failing |
| 1 | Choose cutover instant T, on an exact hour, ≥ 24 h ahead | — | — |
| 2 | Set `HOURLY_COLLECTION_FROM = T`; deploy. Inert while `ACTIVE_PROFILE` is V3 | suite green, production unchanged | snapshot behaviour changes at all |
| 3 | Neon console settings (§8) | per §8 | settings unavailable on plan |
| 4 | **At T:** change cron-job.org minutes from twelve entries to `[0]` | next execution on the hour | job disabled or schedule not saved |
| 5 | Immediately after: deploy `ACTIVE_PROFILE = V4_HOURLY` + `WINDOW_MS = 3_600_000` | build green | deploy fails → scheduler stays hourly, V3 degrades safely |
| 6 | Watch first build in `derived_refresh_runs` | `ACTIVATED`, no blocking failure | `operationalStatus: FAIL` with a blocking failure |
| 7 | T+1h / T+6h / T+24h | horizons populate in order; notice retires itself | a horizon missing past its time |
| 8 | T+48h | cost measurements (§9) | transfer not down ~12× |

---

## 7 · Rollback

**Application.** `git revert` the step-5 commit and deploy. `ACTIVE_PROFILE`
returns to V3 and `WINDOW_MS` to five minutes. V3 snapshots are never deleted
and the active pointer still references one, so the previous contract resumes
with no data loss. Snapshots produced under V4 remain readable — `profileForMethod`
resolves by method string — so nothing published becomes unreadable.

**Scheduler.** Restore the cron-job.org job's minutes to
`[0,5,10,15,20,25,30,35,40,45,50,55]`. Collection returns to five minutes within
one cycle.

**Order matters on the way back too.** Revert the **application first**, then the
scheduler. Reverting the scheduler first would leave V4 reading five-minute
evidence — the bloat case. Between the two reverts V3 reads hourly evidence,
which is the safe degraded state.

Rollback is non-destructive at every point. No step deletes observations,
snapshots or history.

---

## 8 · Neon settings — verified, and it changes the economics

Checked rather than assumed. Per Neon's own documentation and FAQ:

| Plan | Scale-to-zero delay | Autoscaling |
|---|---|---|
| Free | **fixed at 5 minutes** | up to 2 CU |
| Launch | 5 minutes default; can be **turned off**, not shortened | up to 16 CU |
| Scale | **configurable, 1 minute to always-on** | up to 16 CU |

Minimum autoscale size is **0.25 CU** (shared compute); the max autoscaling
range is 8 CU between min and max.

**The 60-second delay I recommended requires the Scale plan. Confirm which plan
this org is on before step 3** — I could not read it from the database, and the
invoice does not show a plan line.

What this means, given your decision to leave the derived ticker at `*/5`:

| Compute | Woken every | Suspends on 5-min delay? | Suspends on 1-min delay? |
|---|---|---|---|
| product (`ep-noisy-scene`) | 1 hour after cutover | **yes**, ~55 min/hour | yes |
| shared (`ep-hidden-river`) | 5 minutes (ticker) | **no, never** | yes, ~70% |

| Scenario | Compute | Transfer | Other | **Total** |
|---|---:|---:|---:|---:|
| Today | $225 | $85 | $8 | **$318** |
| Cutover, **Launch** plan (5-min delay) | ~$82 | ~$7 | ~$6 | **~$95** |
| Cutover, **Scale** plan (1-min delay) | ~$28 | ~$7 | ~$6 | **~$41** |

**On Launch the $30–40 target is not reachable while the derived ticker stays at
`*/5`**, because that compute can never suspend. Reaching the target needs either
the Scale plan's 1-minute delay, or revisiting the ticker — which I previously
showed cannot go beyond `*/10` without pushing publication past the 90-minute
freshness allowance. That is a decision for you; I have not acted on it.

---

## 9 · Post-release checks

| Check | Command / source | Expected |
|---|---|---|
| Collection cadence | `select count(*) from collector_runs where source='SKINPORT' and started_at > now()-interval '24 hours'` | **24**, was 288 |
| Collection health | `/api/internal/data-health` | `lastRun.status` present; `expectedWindows` 24 |
| Database suspension | `select pg_postmaster_start_time()` on both endpoints | **moves between checks** — proof of suspend |
| CU-hours | Neon console, per endpoint | product ≪ 730/mo |
| Transfer | `blks_read` delta over 11 min, both endpoints | ~5.5 GB/day total, was 68.5 |
| Observation volume | `select count(*) from market_observations where observed_at > now()-interval '24 hours'` | **~3,576**, was 42,624 |
| User-facing freshness | Screener quality column | `Partial`/`Full`, **no Stale** |
| Transition notice | Screener freshness strip | present, retires by T+24h |
| Snapshot size | `select count(*) from derived_market_features group by snapshot_id` | **~24 rows/asset**, not 299k total |

**Baseline for comparison** (measured 2026-10-21):

```
product  uptime 14d13h  blks_read 66.50 GB/day  Skinport 288 runs/day, 236 MB/run
derived  uptime  1d23h  blks_read  1.95 GB/day  19.5 builds/day, ~74-min cycle
observations 42,624/day   snapshot 299,080 rows / 474 MB
```

---

## What is ready, and what is not

**Ready and green** (1,595 tests, typecheck clean, lint 0 errors, build passes):

- `tests/v4-cutover.test.ts` — 7 tests proving items 1–3 against mixed evidence
- `tests/cadence-transition.test.ts` — 8 tests for the UI messaging
- `src/lib/product/intelligence/cadence-transition.ts` — transition resolution
- `EvidenceNotice` — renders the notice in the freshness strip
- `HOURLY_COLLECTION_FROM` — renamed, documented, pinned by test

**Blocking step 5:**

1. **74 failing tests** under the profile + `WINDOW_MS` switch. Own gate.
2. **`HOURLY_COLLECTION_FROM` still holds the obsolete September value.** Set at
   release.
3. **Neon plan unconfirmed** — decides whether the target is reachable (§8).

**Decision needed from you:** on the Launch plan the cutover lands at ~$95/month,
not $30–40. Either move to Scale for the 1-minute scale-to-zero delay, or accept
~$95, or reopen the derived ticker question.

**Awaiting your approval before any deployment, as instructed.**
