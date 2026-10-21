# V4 Hourly Cadence — Implementation Status

**Read section 0 first.** It corrects a factual error in my three previous
reports that materially shaped this plan.

Nothing deployed. `ACTIVE_PROFILE` remains `V3_FIVE_MINUTE`, production is
untouched, and all 1,440,935 historical observations are intact.

---

## 0 · Correction: hourly was already tried, and deliberately reverted

I reported in the cost investigation and twice since that the move to hourly
"was never applied to the scheduler" and that we had been "ignoring the
provider for a month." **That is wrong.** `src/lib/config.ts` records the
actual history, and production data confirms it:

```
2026-09-20   288 runs   five-minute
2026-09-21   288 runs   five-minute
2026-09-22   173 runs   switched to hourly mid-day
2026-09-23   123 runs   hourly
2026-09-24   288 runs   RESTORED to five-minute
```

Gap analysis over 22–24 September: **25 gaps of exactly 60 minutes**, bracketed
by five-minute collection. Hourly ran for about a day and was reverted.

The reason is recorded in `config.ts`, and I re-measured it independently on the
last seven days of production:

| Measure | `config.ts` claim | My measurement |
|---|---:|---:|
| Asset-hours with movement inside the hour | 24.5% | **24.0%** |
| — price moved | — | 11.9% |
| — listing quantity moved | — | 20.0% |

Over 24,982 asset-hours. **Hourly sampling aliases away real movement in
roughly a quarter of asset-hours.** That is the product cost of this cutover,
and it is considerably larger than the "24-sample volatility statistic" I
described earlier.

The provider's request is also narrower than I represented: their note asks that
the *full response* be fetched once an hour as a **rate-limit policy**. The
team's recorded position is that this is not a claim the feed is static. We are
currently fetching the full catalogue every five minutes, which is the behaviour
they asked us to change — so the tension is real, but it is a question about
request volume, not about data quality.

**You approved hourly partly on my incorrect framing. Section 5 revises the
economics; section 6 lays out the decision I think you should now make.**

---

## 1 · Priority 1 — hourly cadence compatibility

### Root cause of the 74 failures

`WINDOW_MS` (`src/lib/config.ts`) and `ACTIVE_PROFILE.stepMs` described the same
thing from two directions and nothing kept them in step. The collector's window
claim, `scheduledInterval()`, analytics, the watchdog, the ops dashboard and the
rollups each carried their own copy of the five-minute grid.

**The fix is one source of truth, not 74 edits.**

### Audit of every consumer of the collection interval

| Location | Was | Now |
|---|---|---|
| `derived-market/cadence.ts` | — | **owns** `ACTIVE_STEP_MS`, `WINDOWS_PER_DAY`, `WINDOWS_PER_HOUR` |
| `config.ts` `WINDOW_MS` | `5 * 60 * 1000` | `ACTIVE_STEP_MS` (re-export) |
| `derived-market/model.ts` `STEP` | — | already derived — no change needed |
| `derived-market/rollups.ts` | `{hourly:12, daily:288}`, `interval '5 minutes'` | `WINDOWS_PER_HOUR` / `WINDOWS_PER_DAY`, step-derived interval |
| `intelligence/contract.ts` `HORIZON_STEPS` | `12/72/288/2016` | derived from windows-per-hour/day |
| `intelligence/metrics.ts` `STEP_MS` | `300_000` | `ACTIVE_STEP_MS` |
| `derived-market/exploratory.ts` | `[12, 72, 288]` | derived research horizons |
| `health.ts` capacity | `assets * 288` | `assets * WINDOWS_PER_DAY` |
| `collectors/skinport-collector.ts` | uses `WINDOW_MS` | follows automatically |
| `schedule.ts`, `collection-watchdog.ts`, `collection-progress.ts`, `ops/founder.ts` | use `WINDOW_MS` | follow automatically |

### Behaviour-preserving at the current cadence

Verified by value, not by inspection:

```
WINDOW_MS        300000   (was 300000)
WINDOWS_PER_DAY     288   (was 288)
WINDOWS_PER_HOUR     12   (was 12)
HORIZON_STEPS    {"1h":12,"6h":72,"24h":288,"7d":2016}   (unchanged)
```

```
Test Files  95 passed (95)
Tests       1595 passed (1595)
Typecheck   clean      Lint  0 errors (10 pre-existing warnings)      Build  ✓
```

### Tests strengthened, not weakened

Two guards asserted the **source text** `"WINDOW_MS = 5 * 60 * 1000"`. That
check would have missed a cadence change made through `ACTIVE_PROFILE` — the
exact change it existed to catch. Both now assert the **value**
(`WINDOW_MS === 300000`, `WINDOWS_PER_DAY === 288`, `ACTIVE_PROFILE === V3`),
so they fail whichever end moves.

One shared fixture (`tests/fixtures/derived-market/sequence.ts`) generated on a
hard-coded five-minute grid starting at `17:55`, which is a multiple of five
minutes but not of an hour. `validateScope` requires both scope boundaries to be
exact multiples of the step, so **56 of the failures were fixture alignment, not
system behaviour.** The fixture now generates on the active grid.

### Measured progress

| Stage | Failing tests |
|---|---:|
| Before (profile + `WINDOW_MS` switched by hand) | 74 |
| After unifying the cadence source | **91** |
| After aligning the shared fixture | **53** |

The count rose to 91 first because the refactor made the cadence *actually
propagate* — `rollups` and `intelligence-metrics` began responding to it instead
of ignoring it. That is the refactor working, not a regression.

### The remaining 53, categorised

| Category | Count | Nature |
|---|---:|---|
| Intentional tripwires | ~9 | Tests asserting production is on V3. **Supposed to fail** on a deliberate cutover; updated in the same commit that flips it. |
| Fixture scope alignment | 11 | Other fixtures with their own hard-coded dates. Mechanical. |
| Research horizon literals | 6 | Tests passing `288` where the active horizon is now derived. Mechanical. |
| Five-minute semantics | ~27 | Assertions like "12 of 12 price transitions in an hour". These need **judgement**, not mechanical edits — several have no hourly analogue and the test's meaning has to be decided, not translated. |

**I stopped here deliberately.** The last category is where the real work is, and
section 0 makes it reasonable to ask whether it should be done at all before you
decide.

---

## 2 · Priority 2 — coordinated transition

### Two systems cannot change atomically, and do not need to

| Order | Consequence |
|---|---|
| Scheduler hourly **first**, application second | V3 derives over hourly evidence: 1 sample where 12 expected, so volatility and activity suppress themselves. **Degraded, safe, reversible.** |
| Application **first**, scheduler second | V4 scope floored at the cutover admits five-minute evidence collected after it. Measured: **600 feature rows where 24 are correct.** |

**Scheduler first.** The window between them is a safe degraded state, so they
need not be simultaneous — which removes the need to pretend two systems can
change at once.

### Recording the cutover

`HOURLY_REGIME_FROM` is renamed `HOURLY_COLLECTION_FROM`, documented with the
measured consequence of getting it wrong, and pinned by a test against
`V4_HOURLY.scopeFloor`. **It still holds the obsolete September value** and is
set at release. It is inert while `ACTIVE_PROFILE` is V3, so it can be deployed
ahead of the cutover.

### In-flight collector runs

Safe without intervention. The collector claims `SKINPORT:<window>` floored to
`WINDOW_MS`. A run in flight when the schedule changes completes against its own
claimed window; if that window precedes the cutover the scope floor excludes it.
If two schedules briefly yield the same window, the second claim is rejected as
`DUPLICATE_WINDOW` and counted in `suppressedDuplicateAttempts`. Choose a cutover
on an exact hour so the grids coincide rather than interleave.

### Mixed-regime correctness and bounded volume

`tests/v4-cutover.test.ts` (7 tests) derives across a genuine seam — 48 hours of
five-minute evidence ending at the cutover, then hourly after it:

- every scope clamps to the cutover for seven days, then releases on day 8
- **24 feature rows, all at or after the cutover** — bounded volume
- no blocking operational failure; `duplicateClaimedWindows: []`
- statistics short of samples are **absent, never approximated**

`DUPLICATE_INTEGRITY` cannot fire here: `prepare.ts` groups duplicates by the
run's **stored** window value, and five-minute marks are all distinct. The real
protection is the exact sample-count gate in `features.ts`
(`if (sample.length !== steps) return null`), which held even in the bad case.

---

## 3 · Priority 3 — product experience

| Surface | During transition |
|---|---|
| Screener | Prices, listings, venue divergence, days-to-clear **unaffected**. Return/Volatility read `Unavailable` until their window completes. |
| Terminal | Same; "volatility available" counts drop until recovery. |
| Asset Intelligence | Chart sparse from the first hourly point, not wrong. Cross-venue and liquidity **unaffected** — they read live provider state. |
| Freshness indicators | **Unaffected** — cadence-independent since the freshness fix. No "Stale" wall. |
| Operational health | `expectedWindows` now follows the cadence (24/day, not 24-of-288). |

Recovery is uniform: **horizon H returns H after cutover** (1h→1h, 6h→6h,
24h→24h). Prices, listing counts, cross-venue metrics and freshness never go
unavailable.

**Explicit labelling, implemented.** `cadenceTransition()` resolves the state
from the snapshot's own method and scope — no hard-coded date — and renders in
the freshness strip: *"Collection moved to a one-hour grid at &lt;cutover&gt;.
Statistics over longer windows are still accumulating samples and read
Unavailable until their window is complete: 6h from …, 24h from …. Published
prices and listing counts are unaffected."* It appears only while a horizon is
short of samples and retires itself. 8 tests.

---

## 4 · Priority 4 — the derived pipeline's five-minute wakeups

**Build behaviour is now proven** (7 days, production):

```
builds by tick count:  3 ticks -> 134 builds,  1 tick -> 1
failures / retries  :  0
```

The build is deterministic: three ticks, no recovery path ever exercised. So the
ticker must supply three ticks after the cooldown expires, and the publication
cycle is `60 + U(0,T) + 2T` minutes.

| Ticker | Wakes/day | Cycle (min) | Against the 90-minute allowance |
|---|---:|---|---|
| `*/5` (today) | 288 | 70–75 | comfortable; observed 74 |
| `*/10` | 144 | **80–90** | **consumes the entire margin** |
| `*/15` | 96 | 90–105 | exceeds it |

**`*/10` is feasible on build behaviour and halves the wakeups, but its worst
case lands exactly on the freshness threshold we shipped last week.** I have not
changed it, per your instruction. If pursued, it should be paired with either
raising the allowance (90→105) or lowering the cooldown (60→45), and re-verified.

The alternative — moving the cooldown gate off the derived database so the 80%
of ticks that are 0.1-second no-ops stop waking it — needs state outside both
Neon databases (Edge Config or similar). That is new infrastructure and a
correctness-sensitive change to a safety property. Not attempted here.

---

## 5 · Revised cost, with plan fees

**The plan is confirmed, not assumed.** The invoice's effective compute rate is
`$157.81 ÷ 1,488.77 = $0.10600/CU-h`, which is exactly Neon's published **Launch**
rate. Launch and Scale both have **no monthly fee** — usage only. Scale is
**$0.222/CU-h**, more than double.

| Scenario | CU-h | Rate | **Monthly** |
|---|---:|---:|---:|
| Today | 2,127 | $0.106 | **$318** |
| Hourly cutover, ticker `*/5`, **Launch** | 800 | $0.106 | **$98** |
| Hourly cutover, ticker `*/10`, **Launch** | 440 | $0.106 | **$60** |
| Hourly cutover, ticker `*/5`, **Scale** (1-min suspend) | 255 | $0.222 | **$70** |

**The $30–40 target is not reachable by the hourly cutover alone.** On Launch the
shared compute (derived + asset-images + catalog) is woken every five minutes by
the ticker and the suspend delay cannot be shortened below five minutes, so it
never sleeps. Moving to Scale buys a 1-minute delay but at 2.1× the rate, and
lands *worse* than Launch with a `*/10` ticker.

**The ticker, not the collector, is now the binding constraint.** After the
cutover it is roughly 80% of the remaining bill.

One caveat on the transfer line: the billed rate ($0.0366/GB) is well below
Neon's list egress rate ($0.10/GB after 100 GB), which supports my earlier
measurement that this line tracks **compute↔storage block reads** rather than
internet egress. It should still fall ~12× with hourly collection, because block
reads fall with collection frequency — but treat the transfer projection as the
softer half of these numbers.

---

## 6 · Where this leaves the decision

The hourly cutover costs **~24% of asset-hours of real intra-hour movement** —
the thing the team measured and reverted for a month ago — and gets the bill from
$318 to **$98**, not to $30–40.

Three honest options:

1. **Stop the cutover; take the ticker instead.** Changing the derived ticker to
   `*/10` plus enabling scale-to-zero costs no data quality at all and reaches
   roughly $150/month. Pairing it with a modest freshness-allowance change gets
   further. **No aliasing, no 27 judgement-call test rewrites, no provider
   tension resolved — but also none created.**
2. **Proceed with hourly.** Accept 24% aliasing, reach ~$98, and honour the
   provider's rate-limit request. Remaining work: ~27 semantic test decisions
   plus 17 mechanical ones.
3. **V4_FIFTEEN_MINUTE instead.** 96 runs/day (−67%), keeps 4× the intra-hour
   resolution, and still reduces full-catalogue fetches substantially. The
   profile exists and is tested. Lands between the two on both cost and quality.

**My recommendation is 3 if the provider relationship is the driver, and 1 if
cost is.** Neither requires accepting a known 24% loss of signal for a saving
that the ticker can deliver more cheaply.

---

## 7 · Remaining blockers

1. **~27 tests encoding five-minute semantics** need decisions, not edits.
2. **`HOURLY_COLLECTION_FROM` still holds the September value.** Set at release.
3. **Target unreachable as scoped** — section 5.
4. **The 24% aliasing decision** — section 0.

## 8 · Production verification checklist

| Check | Source | Expected |
|---|---|---|
| Collection cadence | `collector_runs`, 24 h | 24, was 288 |
| Observation volume | `market_observations`, 24 h | ~3,576, was 42,624 |
| Snapshot size | `derived_market_features` per snapshot | ~3,600 rows, was 299,080 |
| No regime leakage | `min(observed_at)` per snapshot | ≥ cutover |
| Build health | `derived_refresh_runs` | `ACTIVATED`, no blocking failure |
| Horizon recovery | Screener | 1h/6h/24h populate at +1h/+6h/+24h |
| Transition notice | freshness strip | present, retires by +24h |
| Freshness indicators | Screener quality column | `Partial`/`Full`, no `Stale` |
| Database suspension | `pg_postmaster_start_time()` | **moves** between checks |
| CU-hours / transfer | Neon console; `blks_read` delta | per section 5 |

Baseline (2026-10-21): product uptime 14d13h, 66.50 GB/day block reads, 288 runs/day
at 236 MB each; derived 19.5 builds/day, ~74-min cycle; 42,624 observations/day.

---

## 9 · Diff

```
 src/lib/derived-market/cadence.ts         | +52  owns cadence constants
 src/lib/config.ts                         | +22  WINDOW_MS derives from profile
 src/lib/derived-market/rollups.ts         | +20  expected counts, step interval
 src/lib/intelligence/contract.ts          | +20  HORIZON_STEPS derived
 src/components/intelligence-market.tsx    | +20  transition notice
 src/lib/derived-market/exploratory.ts     |  +7  research horizons
 src/lib/intelligence/metrics.ts           |  +4  STEP_MS
 src/lib/health.ts                         |  +4  capacity projection
 tests/first-users.test.ts                 | +16  value not source text
 tests/fixtures/derived-market/sequence.ts | +10  generates on active grid
 tests/steamwebapi-provider.test.ts        |  +6  value not source text
 (plus, from the prior gate, not yet committed)
 tests/v4-cutover.test.ts                  | 7 tests
 tests/cadence-transition.test.ts          | 8 tests
 src/lib/product/intelligence/cadence-transition.ts
```

Sources for plan rates: [Neon pricing](https://neon.com/pricing),
[Neon pricing analysis](https://www.jetadmin.io/blog/neon-pricing/amp/),
[scale-to-zero FAQ](https://neon.com/faqs/postgres-services-capping-monthly-spend-autoscaling).
