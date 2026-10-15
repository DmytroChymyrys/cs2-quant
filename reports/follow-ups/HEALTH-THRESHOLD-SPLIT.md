# Follow-up: split the internal stuck-run and observation-age health thresholds

**Status:** recommendation only. Not implemented, and deliberately excluded from
the freshness release (`ca522cf`).

**Origin:** found while diagnosing the Screener freshness defect. It is the same
root cause on a different surface, which is why it is worth fixing before it is
rediscovered from an alert nobody trusts.

## The problem

`SOURCE_STALE_AFTER_MINUTES` (default `15`, set to `15` in production) is used
for two unrelated measurements:

| Use | Location | What it measures | Is 15 minutes right? |
|---|---|---|---|
| `abandoned` | `src/lib/health.ts:20` | collector runs still `RUNNING` since before the cutoff | **yes** — a run-duration bound, independent of how often we collect |
| `staleAssets` | `src/lib/health.ts:29` | tracked assets whose newest observation predates the cutoff | **no** — an observation-age bound, which must track collection cadence |
| "Stale / missing observations" | `src/lib/ops/data.ts:102` | same observation-age query, on the ops dashboard | **no** — same reason |

Collection moved from five-minute to hourly on **2026-09-22T14:00Z**
(`src/lib/derived-market/cadence.ts`). A 15-minute observation-age bound is
shorter than the interval at which new observations can arrive, so the two
observation-age uses report **nearly every tracked asset as stale for most of
every hour**, regardless of health.

This is the identical fault the product-facing fix corrected: one constant
answering two questions, one of which is cadence-dependent and one of which is
not.

## Why it was not fixed in that release

- It governs **internal** health and ops alerting; no customer-facing surface
  reads it.
- The value is environment-configurable rather than compiled in, so the
  remediation is partly a configuration decision, not purely a code change.
- Changing an alerting threshold without being able to observe the effect on
  real alert volume is how alerting gets quietly broken. It deserves its own
  verification, not a ride-along.

## Recommendation

Split the single variable into the two concepts, mirroring the product fix:

1. **Keep 15 minutes for stuck-run detection.** Rename to something like
   `STUCK_RUN_AFTER_MINUTES`. A collector run that has been `RUNNING` for 15
   minutes is stuck whatever the cadence. Cadence-independent, so no further
   calibration is needed.

2. **Move the observation-age checks onto the shared publication allowance** —
   `OBSERVATION_STALE_AFTER_SECONDS` (90 minutes), added in `ca522cf` and
   already aliased to `DERIVED_STALE_AFTER_SECONDS`. Both `staleAssets` and the
   ops "Stale / missing observations" tile then answer the same question the
   product does, with the same number, from one source of truth.

3. **Add the invariant as a test**, as the product fix did: the observation-age
   bound must exceed the collection interval. That is the assertion whose
   absence allowed this to drift unnoticed for three weeks.

## Verification this change would need

- Alert volume before and after over at least one full collection cycle —
  the expectation is `staleAssets` falling from ~all tracked assets to ~0 while
  collection is healthy.
- A deliberately missed collection run still raises the alert.
- A run stuck beyond 15 minutes is still reported as abandoned.

## Scope

`src/lib/config.ts`, `src/lib/health.ts`, `src/lib/ops/data.ts`, the production
environment variable, and `tests/database.test.ts` (which reads the config
value and would follow the rename). No schema, no provider integration, no
collector cadence.
