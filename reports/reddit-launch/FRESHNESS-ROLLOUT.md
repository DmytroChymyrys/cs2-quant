# Freshness Fix — Controlled Release

Released and verified against production. No invariant failed; no rollback.

| | |
|---|---|
| Commit | `ca522cf` — *fix(intelligence): freshness thresholds that match the collection cadence* |
| Deployment ID | `dpl_7KPm3dBMemYSPSKwJX8yUk6ZmfTh` |
| Deployment URL | `cs2-quant-qavzgs8qk-dmytro-chymyrys-projects.vercel.app` |
| Target / status | Production · Ready · build 26s |
| Released via | Git integration (`git push origin main`) |
| Released at | 2026-10-15 15:14 UTC |
| **Rollback target** | commit `16be7a5` · deployment `dpl_EDkjUCoKze6mkptFTeThG4vJDM4n` |

---

## Pre-release

| # | Check | Result |
|---|---|---|
| 1 | Diff reviewed; only the freshness correction, its tests and docs staged | 16 files — 7 source, 3 test, 6 documentation |
| 2 | No collector cadence, provider, cross-venue or liquidity change | confirmed, see below |
| 3 | Tests / typecheck / lint / build | 1580 passed · clean · 0 errors · ✓ compiled |
| 4 | Observation age vs provider lag distinction explicit | `map.ts:154-156`, two named constants |
| 5 | 90-minute allowance matches derived snapshot policy | identical by construction |

**Check 2** — every threshold compared against `HEAD` and byte-identical:

```
SAME  SKINPORT_STALE_AFTER_MS          SAME  CLEARANCE_MIN_SALES
SAME  STEAM_STALE_AFTER_MS             SAME  LIQUIDITY_WINDOW_DAYS
SAME  DIVERGENCE_MIN_BASE              SAME  DERIVED_ACTIVATION_COOLDOWN_MS
                                       SAME  DERIVED_STALE_AFTER_MS
```

No changed file matches `cadence|collector|provider|cross-venue|liquidity|skinport|steam`.

**Check 5** — asserted at runtime, not merely by eye:

```
observation allowance : 5400 s
derived snapshot stale: 5400 s  ( 90 min )
identical             : true
provider lag budget   :  900 s  (strictly smaller: true)
exceeds cooldown      : true
```

### Staging isolation

Three untracked files from unrelated in-progress work — `formula-contract.ts`,
`tests/fixtures/derived-market/adversarial.ts`, `tests/formula-contract.test.ts`
— sit in the working tree. They were explicitly excluded and the exclusion was
verified by name after staging.

To prove the commit stands alone rather than depending on that uncommitted
work, the unrelated files were stashed and the suite re-run against the staged
tree only: **1557 passed**, the exact total minus the 23 tests belonging to the
excluded work. The stash was then restored and all 942 untracked files
confirmed present.

---

## Production verification

All checks against `floatalpha.com` with real production data, signed out.

| # | Check | Before | After | Result |
|---|---|---|---|---|
| 1 | Screener rows not Stale in a healthy cycle | `Stale` ×10 | `Partial` ×10, **zero Stale** | **pass** |
| 2 | Partial still reported where coverage incomplete | — | `99.85% · Partial` | **pass** |
| 3 | Fresh Changes returns eligible assets | `0 matching assets` | **3 matching assets** | **pass** |
| 4 | Terminal counts reflect real observations | Stale 149, Fresh 0 | **Stale 0, Fresh 149 / 149** | **pass** |
| 5 | Asset Intelligence uses corrected classification | `STALE SOURCE` | `PARTIAL COVERAGE` | **pass** |
| 5 | Watchlist | — | shared code path | **see note** |
| 6 | Genuine stale conditions still detectable | — | — | **see note** |
| 7 | Cross-venue and liquidity unchanged | — | panel renders, values move normally | **pass** |

Terminal, verbatim after release:

```
STALE OBSERVATIONS  0     Observation > 90m, or venue feed > 900s behind at capture
FRESH OBSERVATIONS  149 / 149
TRACKED ASSETS      149
```

Cross-venue on `AK-47 | Vulcan (Field-Tested)` after release — Skinport
$167.49 observed 03:25 PM UTC, Steam $230.13 observed 02:40 PM UTC, divergence
37.4%, clearance ≈20.9 days, velocity 143.8%, bid/ask distance 12.6%. The
figures moved from the pre-release capture because the market moved; the
calculation is unchanged.

### Two checks I could not observe directly

**Watchlist** requires authentication and I verified production signed out. It
filters on `quality.state === "STALE_SOURCE"` from the same `summary()` that
the Screener and Asset Intelligence use, so it is corrected by the same code
path — but I am recording this as *inferred from shared code*, not observed.

**Genuine stale detection** cannot be forced in production without degrading
the pipeline, which I will not do. It is covered by `tests/freshness-policy.test.ts`
(stale past the allowance; stale on provider lag however fresh the read) and by
the pre-existing "Stale source" fixture, whose venue feed was an hour behind at
capture and which **still classifies as stale** after this change.

### An unplanned live confirmation

During verification the snapshot aged out and a new one activated, which
exercised the threshold across a full publication cycle:

```
15:18 → 15:23   Data as of 13:55 UTC   evidence 86 → 87m   Partial ×10
15:24 → 15:29   Data as of 15:10 UTC   evidence 19 → 24m   Partial ×10
```

The 87-minute reading was the tail of a healthy cycle, not degradation — the
publication landed and the age reset. It is close to the 90-minute allowance,
which is the margin behaving as designed rather than a problem, but it is worth
knowing that a healthy cycle can reach 87 minutes. **Under the old 15-minute
rule both readings would have been "Stale"** — including the fresh 19-minute
snapshot.

---

## Reddit screenshots

Both recaptured from production after verification. No application code was
changed for them.

**`screener.png`** — `/screener?sort=venueDelta&direction=desc&min=10`, the
$10 floor preserved. Snapshot 15:10 UTC, evidence 25m. Every visible row reads
`99.85% · Partial`; the inspection rail reads `PARTIAL COVERAGE` where it
previously read `STALE SOURCE`. **No Stale indicator appears anywhere in the
frame.**

It also improved in a way the fix did not aim at: one row now shows real
movement — `Sticker | iBUYPOWER | Cologne 2014`, minimum −20.4%, listings
+4.0%, activity 8.33 — where the pre-release capture showed `0.00%` and `0`
across every row. Name truncation dropped from 3-of-10 to 1-of-4.

**`asset-intelligence.png`** — recaptured rather than kept. The previous image
was accurate when taken but is no longer: the prices have moved, and the page
carried a `STALE SOURCE` badge just below the captured frame. The new capture
shows the full Cross-Venue Observation panel with nothing clipped, and
`PARTIAL COVERAGE` on the page. Verified: no `STALE SOURCE` anywhere in the DOM.

The limitation recorded in `SCREENSHOT-REVIEW.md` stands — the asset name is
in an `<h1>` 780px above the panel and cannot share a 1440 × 900 frame, so the
post caption must name the item.

---

## Not in this release

Internal health-monitoring thresholds were deliberately left alone, as
instructed. The follow-up is written up separately in
`reports/follow-ups/HEALTH-THRESHOLD-SPLIT.md`.

## Rollback

Not required. Should it become necessary:

```
vercel rollback dpl_EDkjUCoKze6mkptFTeThG4vJDM4n   # or: git revert ca522cf && git push
```

That deployment serves commit `16be7a5`, the last revision before this change.
Reverting restores the single 900-second threshold and with it the wall of
"Stale" badges; it touches no data, no schema and no provider integration, so
it is safe at any time.
