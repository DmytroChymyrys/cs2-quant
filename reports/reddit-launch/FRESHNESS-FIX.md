# Screener Freshness Semantics — Root Cause and Fix

Production labelled **every one of 149 tracked assets "Stale"**, reported
**"Full coverage 0"**, and returned **"0 matching assets"** for the Fresh
Changes preset. None of that reflected unhealthy data. This corrects the
semantics without relaxing any genuine safeguard.

Implemented locally. Not committed, not pushed, not deployed.

---

## Root cause

It is not simply "15 minutes is too short". The constant encoded an assumption
about the *collection cadence* that stopped being true.

```
freshSeconds: spec(900, "three cadence steps; p99 source age is 314.9s")
                   ^^^              ^^^^^^^^^^^^^^^^^^
```

`900` was calibrated as **three steps of a five-minute collection grid**.
Collection moved to hourly on **2026-09-22T14:00Z**, after Skinport asked that
the full response be fetched once an hour rather than polled
(`src/lib/derived-market/cadence.ts`). Three steps became three *hours*; the
constant stayed at fifteen minutes. Nothing failed, because the number still
looked plausible.

Two separate faults followed from it.

### Fault 1 — one threshold answering two different questions

`map.ts` compared a single 900-second budget against two unrelated quantities:

| Quantity | Meaning | Does it grow after capture? |
|---|---|---|
| `observedAge = now − observed_at` | how long since we observed the asset | **yes**, with every second the snapshot sits on the shelf |
| `age = now − items_source_timestamp` | provider lag **plus** elapsed time | **yes** |
| `items_source_age_seconds` | provider lag measured **at capture** | no — fixed when written |

Only the third is a stable measure of provider quality, and it was already
computed correctly — `server.ts` even carries a comment warning that
recomputing provider age against the present "would silently convert *the
venue's feed was 40s behind when we read it* into *the venue is now hours
behind*". The state classification did exactly that anyway.

### Fault 2 — the budget was smaller than the publication interval

The derived pipeline publishes at most once an hour
(`DERIVED_ACTIVATION_COOLDOWN_MS = 60m`). A freshness budget of 15 minutes is
shorter than the interval at which new data can possibly arrive, so healthy
data was stale **45 minutes out of every 60** by construction.

`policy.ts` had already reasoned this through for the snapshot-level threshold
and rejected it in writing:

> A threshold at or near sixty minutes would therefore flag healthy operation
> as degraded for most of every cycle, which trains a reader to ignore the one
> signal that means the refresh job has stopped.

That argument was correct and simply had not been applied to the per-asset
threshold, which lived in a different module.

---

## The fix

Two concepts, two constants, each compared against the quantity it describes.

| Concept | Constant | Value | Applied to |
|---|---|---|---|
| Observation age | `OBSERVATION_STALE_AFTER_SECONDS` (`derived-market/policy.ts`) | 5400s (90m) | `observedAge`, at read time |
| Provider lag at capture | `THRESHOLDS.sourceLagSeconds` (`intelligence/thresholds.ts`) | 900s | `items_source_age_seconds`, fixed at capture |

**Observation age is now shared with the publication policy**, as an alias by
identity rather than a coincidence of value:

```ts
export const OBSERVATION_STALE_AFTER_SECONDS = DERIVED_STALE_AFTER_SECONDS;
```

This is the one place the module defines one constant in terms of another, and
deliberately so: the newest observation in a snapshot is what fixes that
snapshot's own age, so answering the two questions with different numbers would
let the Screener call an asset stale while the Terminal called the snapshot
containing it healthy. The 60-minute cooldown remains independent of both.

**Provider lag keeps the strict 900-second bound**, because the quantity it
measures genuinely is small — p99 is 314.9s, so 900s is roughly 3× headroom —
and because it does not grow with time, a strict bound on it is meaningful.
Its recorded basis no longer claims a cadence-step derivation.

### Files changed

| File | Change |
|---|---|
| `src/lib/derived-market/policy.ts` | adds `OBSERVATION_STALE_AFTER_SECONDS` |
| `src/lib/intelligence/thresholds.ts` | `freshSeconds` → `sourceLagSeconds`; basis corrected to the p99 measurement |
| `src/lib/product/intelligence/contract.ts` | removes `STALE_SECONDS`; records where each threshold now lives |
| `src/lib/product/intelligence/map.ts` | classifies against both thresholds; provider lag read from the captured value |
| `src/lib/product/intelligence/screener.ts` | Fresh Changes preset tests each age against its matching budget |
| `src/components/intelligence-market.tsx` | preset prose states both rules |
| `src/app/(market)/terminal/page.tsx` | freshness notes derive their minutes from the constant instead of hard-coding "15m" |

---

## Affected surfaces

| Surface | Before | After |
|---|---|---|
| **Screener** quality badge | `99.85% · Stale` on every row | `99.85% · Partial` — the honest reading of 99.85% coverage |
| **Screener** Fresh Changes preset | `0 matching assets`, permanently | matches assets that changed and were observed this cycle |
| **Terminal** "Stale observations" | `149` of 149 | `0` while publication is on schedule |
| **Terminal** "Full coverage" | `0` | reflects real coverage |
| **Watchlist** "Stale observations" | same defect | same fix |
| **Asset Intelligence** | quality state shared with the Screener | same fix |
| **Cross-Venue / Liquidity** | — | **unchanged**, see below |

### Cross-venue and liquidity were left alone, deliberately

`SKINPORT_STALE_AFTER_MS` (30m) and `STEAM_STALE_AFTER_MS` (3h) read **live
provider state**, not the hourly derived snapshot, and each is derived from its
own collector's cadence. Production confirms they are correctly calibrated: at
capture the panel showed a Skinport ask observed 5 minutes earlier and a Steam
ask observed 55 minutes earlier, both inside their budgets and both rendering.
A regression test now pins both values so this fix cannot drift into them.

---

## Before / after

### Terminal freshness metrics

`freshness/before-terminal-freshness.png` — **production**, real data:
`STALE OBSERVATIONS 149`, `Full coverage 0`, note "Source or observation > 15m".

`freshness/after-terminal-freshness.png` — **local build**:
`STALE OBSERVATIONS 0`, `Full coverage 32`, note "Observation > 90m, or venue
feed > 900s behind at capture".

> **Read the counts with care.** The local build cannot reach the derived
> database — `DERIVED_MARKET_DATABASE_URL` is Vercel-only by design, and that
> isolation is deliberate — so the "after" image renders the 32-asset demo
> universe rather than production's 149. Its observations are only minutes old,
> so they would have read `0 stale` under the old rule too. **That screenshot
> proves the corrected note text, not the corrected behaviour.** The
> behavioural proof is the table below, which runs production's own measured
> values through the shipped classifier.

### Screener preset definitions

`freshness/before-preset-definitions.png` (production) — "…change over 5m and
source/observation ages ≤ 900s."

`freshness/after-preset-definitions.png` (local) — "…change over one step, an
observation no more than 90m old, and a venue feed no more than 900s behind
when it was read."

### Classification on production's measured values

Production's freshness strip at capture read *"Market evidence 50m ago · Venue
data was 5m old when captured"*. Those are the inputs below, run through the
real `summary()` in both rules. Reproduce with
`npx tsx reports/reddit-launch/freshness/verify-freshness.mts`:

```
observation budget 5400s · provider lag budget 900s

case                      obsAge  lag     old            new            verdict
just published               1m   300s  FULL_COVERAGE  FULL_COVERAGE  unchanged
production at capture       50m   300s  STALE_SOURCE   FULL_COVERAGE  FIXED
end of a healthy cycle      75m   300s  STALE_SOURCE   FULL_COVERAGE  FIXED
past the allowance         100m   300s  STALE_SOURCE   STALE_SOURCE   unchanged
venue feed behind            5m  3600s  STALE_SOURCE   STALE_SOURCE   unchanged
```

The two `unchanged` rows at the bottom are the point: **genuinely old data and
a genuinely lagging venue feed are still flagged.** Only the healthy middle of
the publication cycle changed.

Applying production's actual 99.85% coverage, the Screener badge moves from
`99.85% · Stale` to `99.85% · Partial` — not to "Full". The rows do not start
claiming perfection they do not have.

---

## Tests

`tests/freshness-policy.test.ts` (new, 9 tests) covers the brief's acceptance
criteria directly:

- a healthy snapshot at 16, 30, 45 and 59 minutes is **not** stale
- exactly at the allowance is healthy; one minute past it is stale
- a lagging provider feed is stale **however fresh the read**, and its captured
  lag does not drift with read time
- all three ages remain reported separately and exactly
- an unparseable timestamp is `UNAVAILABLE`, never "fresh"
- observation and snapshot thresholds are the same value, the lag budget is
  strictly smaller, and the allowance **must exceed the publication interval** —
  the invariant whose violation caused this defect
- Fresh Changes matches mid-cycle and still rejects unchanged assets, overly old
  observations, and lagging feeds
- cross-venue thresholds are unchanged
- the Terminal prose cannot re-hard-code a threshold

Two existing tests asserted the defective behaviour and were updated:

| Test | Was | Now |
|---|---|---|
| `product-intelligence.test.ts` "calculates staleness at read time…" | asserted `STALE_SOURCE` one hour after capture | asserts healthy at +1h **and** stale past the allowance; renamed to describe the real distinction |
| `waiting-week.test.ts` "distinguishes scope age from captured lag…" | asserted `STALE_SOURCE` at 65-minute observation age | asserts the asset and its snapshot agree — both healthy, then both stale past the allowance |

Note that the "Stale source" fixture — whose venue feed was an hour behind at
capture — **still classifies as stale**, unchanged. The safeguard works.

```
Tests       1580 passed (93 files)
Typecheck   clean
Lint        0 errors, 10 warnings (all pre-existing, none in changed files)
Build       ✓ Compiled successfully
```

---

## Related finding, not fixed here

`SOURCE_STALE_AFTER_MINUTES=15` has the same shape of defect on **internal**
surfaces, and one variable again serves two concepts:

- `src/lib/health.ts` — `abandoned`: collector runs stuck in RUNNING. A
  **run-duration** measure; 15 minutes is correct and cadence-independent.
- `src/lib/health.ts` — `staleAssets`, and `src/lib/ops/data.ts` — "Stale /
  missing observations": tracked assets whose latest observation is older than
  15 minutes. An **observation-age** measure, so under hourly collection this
  reports nearly every asset as stale for most of each hour.

I have not changed it. It governs internal health and ops alerting rather than
anything a customer sees, the value is environment-configurable rather than
compiled in, and I cannot observe the effect of changing an alerting threshold
without deploying. **Recommendation:** split it as this change splits the
product threshold — keep 15 minutes for stuck-run detection, and move the
observation-age check onto the shared publication allowance.

---

## Before this ships

The Reddit launch screenshots in this directory were captured from production
**before** this fix and still show the wall of "Stale" badges. Once this is
deployed, `screener.png` should be recaptured — it was the open question left
in `SCREENSHOT-REVIEW.md`, and this change answers it.
