# 30-day research protocol — DESIGN ONLY

**Status: PROPOSED. Nothing here is implemented.** This fixes the method before
the data exists, so the cutoff analysis is reproducible and cannot be shaped by
what the data turns out to say.

Written 2026-09-17, at day 7.99 of 30. It is deliberately written **before** the
outcome is knowable.

---

## 1. The boundary is immutable

```
2026-09-09T17:55:00Z  <=  scheduled_window  <  2026-10-09T17:55:00Z
```

| | |
| --- | --- |
| Duration | exactly 30 days |
| Scheduled windows | **8,640** |
| Assets | **100**, unchanged |
| Expected observations | **864,000** |
| Cadence | 5 minutes, unchanged |
| Provider | Skinport, USD, unchanged |

The start instant is the same one the 7-day report used, so the 7-day window is a
strict prefix of the 30-day window.

**The boundary may not move for any reason**, including: a collection gap near
the cutoff, an incomplete final window, a provider incident, or an analysis that
would "look better" over a different interval. If something goes wrong near the
cutoff it is **reported**, not corrected by shifting the boundary. A moved
boundary invalidates comparison with the frozen 7-day result and is the single
easiest way to make this analysis worthless.

If the collector is materially degraded near the cutoff, the correct response is
to report reduced completeness and, if warranted, **schedule a separate later
window** — never to stretch this one.

---

## 2. Pre-registration, and why it is the core of this protocol

Days 1–7 were used to **form the hypotheses and calibrate the thresholds** now in
the product: the activity p95 of 12.5, the quiet p25 of 0.3472, the price-stable
tolerance, the volatility caveat, and the descriptive price × listing finding.

Those choices make days 1–7 **training data**. The 30-day dataset is not
independent of them.

Therefore:

| Period | Status | Use |
| --- | --- | --- |
| Days 1–7 (2026-09-09 → 09-16) | **in-sample** | consistency check only |
| Days 8–30 (2026-09-16 → 10-09) | **out-of-sample** | the only honest test of anything chosen on days 1–7 |
| Days 1–30 | full period | headline descriptive statistics |

Anything calibrated on days 1–7 is evaluated on days 8–30 **without refitting**.
Re-tuning a threshold on the full 30 days and then reporting how well it performs
on the full 30 days is circular, and this protocol forbids it.

### Pre-registered decision rules

These numbers are fixed now. The report states the measured value against each,
and the verdict follows mechanically.

| Question | Pre-registered rule | If not met |
| --- | --- | --- |
| Does listing supply lead price? | Non-overlapping pooled Spearman with abs value ≥ 0.10, **and** 95% CI excluding zero, **and** consistent sign in ≥ 65% of assets with ≥ 20 samples each | Report **NOT ESTABLISHED**. Do not soften, do not re-slice, do not report a sub-group that happens to clear the bar |
| Does price lead listing supply? | Same rule, same direction of proof | Same |
| Does the median-price / multi-unit-supply relationship persist? | Per-asset median Spearman ≤ −0.40 on days 8–30 alone | Report as weaker than the 7-day result and say so plainly |
| Is the mechanical explanation still dominant? | Share of opposite-direction 5-minute steps where both moved stays ≥ 85% | Report the change; it would be a genuinely new finding |
| Do the screener thresholds still select sensibly? | Most Active selects 2–25 of 100; Quiet selects 5–35 of 100, measured on days 8–30 | Recalibrate **for the next period**, and report both old and new values |
| Is collection reliable at 30 days? | ≥ 99.0% observation completeness and zero collector-caused failures | Report the shortfall and its attribution |

Sub-group analysis (by category, price tier, liquidity) is **permitted for
description and forbidden for establishing a relationship**. If the universe-wide
rule fails, no sub-group rescues it.

---

## 3. Readiness checks, to run at day 29

Run one day before the cutoff so problems are visible while there is still time
to record context. None of these may change the boundary.

1. Collector cadence healthy; watchdog severity `OK`.
2. Count missing windows to date and the reason for each, from the runs table and
   the watchdog's interval report.
3. Confirm the universe is still exactly the 100 approved assets and that none
   was added, removed or re-tracked mid-experiment.
4. Confirm cadence, provider and currency unchanged for the whole window.
5. Confirm `market_observations` is still append-only and no row was updated or
   deleted.
6. Confirm the L1 link invariant still holds: 0 byte-identical mismatches,
   0 unlinked observations.
7. Record database size and growth for the storage section.
8. Confirm the frozen 7-day artifacts at commit `4f6c7ea` are unchanged, by
   re-verifying the SHA-256 manifest.

---

## 4. Freeze procedure, at the cutoff

Same shape as the 7-day freeze, which is the reason it is reusable.

1. **Wait** until wall-clock time is past `2026-10-09T17:55:00Z`. Assert the
   boundary is closed in SQL before extracting anything.
2. **Extract** in one repeatable-read, read-only transaction with the boundary
   asserted to be exactly 8,640 windows.
3. **Export** the frozen per-asset series to a compressed CSV, exactly as
   `series.csv.gz` was produced, so later analysis needs no database.
4. **Hash** every artifact into `manifest.json`.
5. **Commit** the whole directory in one commit before any interpretation is
   written, so the evidence cannot be revised to fit the narrative.
6. Only then run the analysis, which reads the frozen export and never the live
   database.

The extraction must not modify anything, must not backfill, must not interpolate,
and must not exclude a window to improve a statistic.

---

## 5. Consistency gate — the 7-day prefix must reproduce

Before any 30-day result is interpreted, recompute the 7-day statistics from the
**30-day extract**, restricted to the original prefix window, and compare against
the frozen 7-day report:

| Statistic | Must equal |
| --- | --- |
| Observations | 201,235 |
| Adjacent comparisons | 201,035 |
| Minimum-price transitions | 3,747 |
| Median-price transitions | 2,918 |
| Listing-quantity transitions | 6,145 |
| Published 24h sales changes | 468 |
| Assets | 100 |
| Completeness | 99.819% |

**Any mismatch stops the analysis.** It would mean the underlying data or the
method changed, and every 30-day number would be uninterpretable. Do not
rationalise a mismatch, do not adjust the expected values, and do not proceed
while explaining it away.

---

## 6. Analysis plan

Tiers 1–3 are mandatory and use the **same method as the 7-day report**, so the
two are directly comparable. Tier 4 is what 30 days newly permits.

### Tier 1 — Reliability and data quality
Same table as the 7-day report: scheduled/successful/failed/missing/duplicate
windows, observations, per-asset coverage, duplicate and missing asset-window
pairs, currency, provider timestamps, invalid values, timestamp anomalies,
freshness distribution with the >7/>10/>15 minute bands, collector duration,
provider HTTP outcomes. Plus, new for 30 days: **invocation gaps**, separated
from provider failures, using the watchdog's classification.

### Tier 2 — Descriptive market structure
Per-asset first/last/min/max/change/transitions/distinct-states for minimum
price, median price, listing quantity, published 24h sales and history state;
cross-asset distributions; direction counts; the price × listing state
classification at 1h/6h/24h; and the three mechanical-confounder tests, repeated
unchanged.

### Tier 3 — Out-of-sample evaluation of the 7-day findings
Evaluated on **days 8–30 only**, against the §2 rules, with no refitting.

### Tier 4 — What 30 days newly enables
Only these. Each is listed because 7 days could not support it, not because it is
interesting.

| Analysis | Why 30 days is the threshold |
| --- | --- |
| Non-overlapping 24h lead/lag with a usable sample | 7 days gave 5 samples per asset; 30 days gives ~28 |
| Weekday and time-of-day effects in collection and in provider refresh | needs ≥ 4 of each weekday |
| Published-sales cadence stability | ~30 updates per asset instead of ~7 |
| Volatility with a price-level control | enough complete 24h windows per price decile |
| Position-within-range on a reference period that is not trivially short | 7-day range was too short to be meaningful |
| Persistence of the delisting and any recovery | a 22-day continuation is a different observation from a 1-day one |

### Explicitly out of scope

Not because they are wrong, but because they are not justified by this dataset
and adding them would dilute the result:

- any predictive model, score, or ranking presented as forward-looking;
- cross-venue or cross-source comparison (one provider, one currency);
- inference about global CS2 supply (these are Skinport venue listings);
- per-trade or intraday volume (the provider publishes rolling aggregates);
- new derived features invented during the analysis;
- universe expansion analysis (the universe is fixed at 100 by design).

---

## 7. Statistical discipline

1. **Non-overlapping samples for every forward-looking test.** Overlapping
   windows are serially correlated; their confidence intervals are invalid and
   must be labelled as such wherever they appear.
2. **Report effective sample size per asset**, not just the pooled count. A
   pooled n of 500 across 100 assets is 5 per asset and proves nothing.
3. **Report both Pearson and Spearman.** A sign disagreement between them is
   evidence of noise and must be stated, not resolved by choosing one.
4. **Adjacent comparisons use contiguous cadence steps only.** Gaps are never
   bridged.
5. **Complete-window metrics stay strict.** Current semantics are unchanged for
   this analysis; the confidence-aware alternative stays a proposal.
6. **No market-factor control is claimed unless one is actually computed.** If
   cross-asset common movement is not removed, say so.
7. **Distinguish DESCRIPTIVE from PREDICTIVE** in every conclusion, as the 7-day
   report did.

---

## 8. Known-events register

These are already recorded and must appear in the 30-day report so the numbers
are interpretable. The list is appended to, never edited.

| Date (UTC) | Event | Class |
| --- | --- | --- |
| 2026-09-15T19:35 | Provider HTTP 400 on items; 1 failed window | provider |
| 2026-09-15T19:50 → | `Souvenir AWP \| Dragon Lore (Factory New)` left the feed | market |
| 2026-09-16T22:20 | Collector TIMEOUT, 1 failed window | collector |
| 2026-09-17T14:35–15:00 | 6 windows never invoked | scheduler |
| various | 15 windows of source age > 7 min in the first 7 days | provider |

---

## 9. Coverage rules, fixed in advance

**The delisted asset.** It has 1,752 observations against 2,297 for every other
asset and will diverge further if it never returns. Rule, fixed now:

- it remains in the universe and is never dropped to tidy an aggregate;
- every cross-asset statistic reports **n** alongside the value, so a statistic
  computed over 99 assets is never presented as covering 100;
- its availability state is reported as a finding in its own right;
- if it returns to the feed, the return timestamp is recorded and the gap is
  **not** interpolated across.

**Collection gaps.** Reported, never backfilled, never interpolated, never
excluded to improve a statistic. Completeness is reported as measured.

**Partial windows.** A window with 99 of 100 assets is partial, is counted as
partial, and is not rounded up to complete.

---

## 10. Deliverables

Mirroring the 7-day report so the two can be read side by side:

1. 30-day experiment summary with the exact boundary and counts
2. Reliability and data-quality table, with invocation gaps separated
3. Market-usefulness analysis
4. Derived-feature analysis
5. Price × listing-supply analysis, including the confounder tests
6. Lead/lag exploration, judged against the §2 pre-registered rules
7. Out-of-sample evaluation of every 7-day finding
8. Screener feasibility matrix, re-measured
9. Storage and scale, measured
10. Machine-readable CSV/JSON for every headline number
11. A short section recording **which pre-registered rules were met and which
    were not**, stated before any interpretation

Language rules are unchanged: OBSERVED / DERIVED / EXPERIMENTAL / UNAVAILABLE,
and no claim of predictive alpha, buy/sell, real-time, or proven forecasting.

---

## 11. Decision gates at the cutoff

The report answers these and nothing more:

1. Was collection reliable over 30 days?
2. Did any 7-day finding survive out-of-sample evaluation?
3. Which derived features are now defensible that were not at 7 days?
4. Does listing supply carry information beyond price, descriptively?
5. Does any lead/lag relationship meet the pre-registered bar?
6. At what cadence is published sales data useful?
7. What are the measured storage economics at 30 days?
8. Should the universe expand, and to what, on what evidence?
9. What changes before any further scaling?

Universe expansion, partitioning, retention and raw-payload removal remain
**out of scope for the analysis** and are decisions taken separately on its
evidence.

---

## 12. Stop conditions

Stop and request review, rather than proceeding, if any of these occur:

- the 7-day prefix does not reproduce (§5);
- the universe, cadence, provider or currency changed during the window;
- an append-only violation is detected;
- completeness falls below 95%;
- a pre-registered rule is met only after a change of method;
- the analysis requires a boundary change to be interpretable.

The last one is the important one. If the honest answer needs a different window,
that is a finding to report, not a parameter to adjust.
