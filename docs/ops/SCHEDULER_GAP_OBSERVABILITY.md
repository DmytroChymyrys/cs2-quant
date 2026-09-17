# Scheduler gap: findings and observability proposal — PROPOSAL ONLY

**Nothing here is implemented.** No collector, cadence, provider or universe
change. The proposal is returned for approval first, as requested.

---

## 1. What happened on 2026-09-17 14:35–15:00 UTC

Six consecutive scheduled windows produced nothing: `14:35`, `14:40`, `14:45`,
`14:50`, `14:55`, `15:00`.

### Evidence gathered

| Source | Result |
| --- | --- |
| `collector_runs` | **No row of any kind** for those six windows. 0 rows with `started_at` inside the gap. The windows either side (`14:30`, `15:05`) are normal `PARTIAL` runs of ~6.5s |
| Vercel runtime logs, gap window (14:33–15:03) | **0 invocations. "No logs found" — no entry of any kind** |
| Vercel runtime logs, control window (15:30–16:00) | **6 invocations**, exactly matching the five-minute cadence |
| cron-job.org API (`GET /jobs/8416189/history`) | **HTTP 401** — history not retrievable, consistent with earlier reports that the management API is inaccessible |

The control window proves the log query returns every invocation when they
exist, so zero entries in the gap is a positive finding rather than missing
retention.

### What this rules out

The route is:

```ts
if (!authorized(request)) return json({ error: 'UNAUTHORIZED' }, 401);
```

An unauthorised request still executes the function and is still logged by
Vercel as a `λ POST` entry. Because **no log entry of any kind** exists:

| Candidate cause | Verdict |
| --- | --- |
| Authentication/guard rejected the request | **Ruled out** — would have logged an invocation |
| Request failed after reaching the handler | **Ruled out** — would have logged |
| Vercel executed and the function errored | **Ruled out** — would have logged |
| `collector_run` creation failed | **Ruled out** — no invocation occurred at all |
| **The endpoint was never invoked** | **Consistent with all evidence** |

### What this does not establish

Whether cron-job.org failed to fire, or fired and its request never reached
Vercel's edge, **cannot be distinguished** from available evidence, because the
cron-job.org history API returns 401. Both remain open. No cause is asserted
beyond "no invocation reached Vercel".

To close that last gap, someone with console access should read the job's
execution history for 14:35–15:00 UTC directly, or the API token should be
renewed so history becomes queryable.

---

## 2. Why the existing health check did not surface this

`getDataHealth()` already reports `missingScheduledWindows` as a **count over
24 hours**. Six missing windows in 288 is a 97.9% success rate, which does not
look like an incident in an aggregate. Nothing reports that the six were
**consecutive**, which is what distinguishes a scheduler outage from scattered
noise.

---

## 3. Proposed check: consecutive missing invocation windows

Read-only, over `collector_runs`. Entirely outside the collector.

```sql
-- Contiguous runs of scheduled windows with no collector_run row.
with grid as (
  select generate_series(
    date_trunc('minute', now()) - ($1 || ' hours')::interval,
    date_trunc('minute', now()) - interval '5 minutes',
    interval '5 minutes') as window_start
),
aligned as (
  select window_start from grid
   where extract(epoch from window_start)::bigint % 300 = 0
),
marked as (
  select a.window_start, (r.id is null) as missing
    from aligned a
    left join collector_runs r
      on r.window_start = a.window_start and r.source = 'SKINPORT'
),
grouped as (
  select window_start, missing,
         sum(case when missing then 0 else 1 end)
           over (order by window_start) as island
    from marked
)
select min(window_start) as gap_start,
       max(window_start) as gap_end,
       count(*)::int      as consecutive_missing_windows
  from grouped
 where missing
 group by island
 having count(*) >= $2
 order by gap_start desc;
```

Two parameters: lookback hours, and the consecutive threshold.

Note it deliberately joins on **any** `collector_run` row, not only claimed or
successful ones. A `FAILED` run means the endpoint *was* invoked, which is a
different incident class. This check answers exactly one question: **did the
invocation happen at all?**

### Proposed alert condition

| Condition | Severity | Rationale |
| --- | --- | --- |
| ≥ 2 consecutive missing windows | **WARN** | 10 minutes of silence; one miss is noise, two is a pattern |
| ≥ 4 consecutive missing windows | **ALERT** | 20 minutes; the 2026-09-17 incident was 6 |
| ≥ 12 consecutive missing windows | **CRITICAL** | one hour of no collection |
| Most recent window missing **and** latest run older than 15 minutes | **ALERT** | catches an outage still in progress, which the gap query alone reports only after recovery |

Thresholds are proposals, not measurements. With one observed incident there is
no base rate to calibrate against; they should be revisited once more history
exists, exactly as the screener thresholds are.

---

## 4. Implementation proposal

It can be implemented entirely outside the collector, with no change to
cadence, provider or universe.

### 4.1 Files

| File | Change |
| --- | --- |
| `src/lib/schedule-health.ts` | NEW. The query above plus gap classification. Pure and unit-testable |
| `src/lib/health.ts` | Add `invocationGaps` to the existing payload. Additive |
| `src/app/api/internal/schedule-health/route.ts` | NEW. Read-only, `internal()`-guarded, returns non-200 when the alert condition is met so any uptime monitor can consume it |
| `tests/schedule-health.test.ts` | NEW. PGlite fixtures for: no gaps, one isolated miss, the real six-window gap, an in-progress outage, and a `FAILED` run counting as invoked |

No collector file is touched. No schema change. No write of any kind.

### 4.2 The watchdog must not share the failure mode

**This is the part that matters most.** The thing that failed is the scheduler.
A health check invoked by that same scheduler would have been equally silent on
2026-09-17 and reported nothing.

Options, in order of preference:

1. **External uptime monitor** polling `/api/internal/schedule-health` and
   alerting on a non-200. Independent of cron-job.org and of Vercel cron.
   Requires one external monitor and a shared secret.
2. **A second, different scheduler** (for example Vercel Cron) running the check
   on a slower cadence, e.g. every 15 minutes. Independent of cron-job.org but
   not of Vercel.
3. **Same scheduler, separate job.** Cheapest, and the weakest: it fails exactly
   when the thing it is watching fails. Acceptable only as a stopgap.

Recommendation: **option 1**. A watchdog sharing its subject's failure mode is
close to no watchdog at all.

### 4.3 Risk

Low. Read-only, additive, outside the collector, no schema change. The only
operational consideration is alert noise if the thresholds are too tight, which
is why the recommendation starts at two consecutive windows rather than one.

---

## 5. Recommendation

1. Approve the read-only check and the endpoint (§4.1).
2. Decide the watchdog transport (§4.2). Recommend an external monitor.
3. Separately, restore cron-job.org API access so invocation history becomes
   evidence rather than a blind spot. Without it, the distinction between "the
   scheduler did not fire" and "the request never arrived" stays unresolvable —
   which is precisely the ambiguity that made this incident hard to attribute.
