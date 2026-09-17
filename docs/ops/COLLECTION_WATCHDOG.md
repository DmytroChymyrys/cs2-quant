# Collection gap watchdog

Detects whether the collector was **invoked** for every expected scheduled
window. That is not the same question as whether collection succeeded.

| Evidence | Meaning | Watchdog treatment |
| --- | --- | --- |
| `SUCCESS` or `PARTIAL` run exists | Invoked, evidence produced | Not a gap |
| `FAILED` run exists | Invoked; collection or provider failed | **Not a gap.** Counted separately as `invokedButFailedPrevious24h` |
| No `collector_run` row at all | Invocation / scheduler-path gap | **Gap** |

A gap is never reported as a provider failure. A `FAILED` run proves the
scheduler path worked and belongs to a different incident class.

## The independence requirement

**The watchdog must not be invoked by the scheduler that drives the collector.**

On 2026-09-17 the collector received no invocation for six consecutive windows.
A health check triggered by that same scheduler would have been equally silent.
A watchdog that shares its subject's failure mode is close to no watchdog at all.

The detector lives in this application because that is where the evidence is.
**Invocation must come from outside.**

## Endpoint

```
GET /api/internal/collection-watchdog
Authorization: Bearer <CRON_SECRET>
```

Read-only. Touches no collector, cadence, provider or universe setting.

| Severity | Consecutive missing completed windows | HTTP |
| --- | --- | --- |
| `OK` | 0–1 | 200 |
| `WARN` | 2–3 | 200 |
| `ALERT` | 4–11 | **503** |
| `CRITICAL` | 12+ | **503** |

`WARN` deliberately stays 200: ten minutes of silence should be visible in the
body without paging. A monitor that only understands status codes will alert
from `ALERT` upward, which is 20 minutes of missed collection.

If the watchdog cannot read its evidence it returns **503** with
`WATCHDOG_UNAVAILABLE`. A watchdog that cannot see must not report health.

### Response fields

| Field | Meaning |
| --- | --- |
| `latestExpectedCompletedWindow` | Newest window that has closed and should have a run |
| `currentIncompleteWindow` | Window currently open; never counted as missing |
| `latestActualRunWindow` | Newest window with any run row |
| `windowsBehind` | How many windows behind the latest closed window |
| `consecutiveMissingCompletedWindows` | Drives severity |
| `missingWindowsPrevious24h` / `expectedWindowsPrevious24h` | Historical rate |
| `mostRecentMissingInterval` | `{ from, to, windows }`, inclusive |
| `invokedButFailedPrevious24h` | Invoked but failed — not a gap |
| `cadenceSeconds` | 300 |
| `severity`, `reason` | State and a grounded explanation |

### The in-progress window

The newest window that *should* have a run is the one **before** the currently
open window, so a run that has not happened yet is never reported as missing.
Covered by tests at one second and ninety seconds into a window.

## Connecting an independent monitor

Any external uptime service works. It must not be cron-job.org, since that is
the scheduler currently invoking the collector.

| Setting | Value |
| --- | --- |
| URL | `https://<deployment>/api/internal/collection-watchdog` |
| Method | `GET` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Interval | 5–10 minutes |
| Alert on | any non-2xx (the endpoint returns 503 at ALERT and above) |
| Timeout | ≥ 15s |
| Retries before alerting | 1 (avoid paging on a single network blip) |

Optional, for services that can assert on the body: alert when
`severity` is `ALERT` or `CRITICAL`, or when `consecutiveMissingCompletedWindows`
is at least 4.

**Nothing in cron-job.org is configured or modified by this work.** Connecting a
monitor is a manual step, deliberately left to an operator so the independence
requirement is a conscious choice rather than an implementation detail.

### Suggested services

Any of UptimeRobot, Better Stack, Healthchecks.io, Pingdom or a Grafana/Datadog
HTTP check. The only hard requirement is that it is **not** the collector's
scheduler and not hosted on the same platform whose failure it must detect.

## What this does not cover

- It cannot distinguish "the scheduler did not fire" from "the request never
  reached the platform". Both look like an absent run. Resolving that needs the
  scheduler's own execution history, which is currently unavailable (its API
  returns 401).
- It says nothing about data quality. Coverage, freshness and provider errors
  remain the job of `/api/internal/data-health`.
