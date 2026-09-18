# Collection health: two checks, two questions

There are two independent endpoints. Neither replaces the other, and both must
be polled by a monitor that is **not** the scheduler which invokes the
collector — a watchdog triggered by the failing scheduler is silent exactly when
it matters.

| | Endpoint | Question |
| --- | --- | --- |
| **Invocation health** | `/api/internal/collection-watchdog` | Was the collector invoked? |
| **Collection health** | `/api/internal/collection-progress` | Did it actually persist anything? |

Both require `Authorization: Bearer $CRON_SECRET` and both return **503 at ALERT
or CRITICAL**, so a plain uptime monitor can alert on the status code alone.

## Why two

On 2026-09-18 the collector persisted nothing for **6h10m** (08:10:16 →
14:20:18 UTC). The outage had two halves:

- **08:00–10:20** — invoked on schedule, claimed every window, then died before
  writing. 18 `RUNNING` rows with no `finished_at`, zero observations.
- **10:20–14:10** — not invoked at all.

Invocation health was **OK for the whole first half**, correctly by its own
definition: a run existed for every window. Nothing reported that no evidence
was being produced. That is the gap collection health closes.

Replayed against the real rows from that day
(`tests/fixtures/collection/incident-2026-09-18.json`):

```
time    INVOCATION             COLLECTION
09:00   OK       missing=0     ALERT    noObs=9   stale=2   STALE_RUNNING
10:00   OK       missing=0     CRITICAL noObs=21  stale=12  STALE_RUNNING
11:30   CRITICAL missing=13    CRITICAL noObs=39  stale=18  STALE_RUNNING
14:05   CRITICAL missing=44    CRITICAL noObs=70  stale=18  STALE_RUNNING
14:50   OK       missing=0     OK       noObs=0   stale=18  NONE
```

Collection health fires at **09:00**, roughly ninety minutes before invocation
health could have known anything was wrong, and the invocation watchdog's
behaviour is unchanged.

## What collection health detects

**Stale RUNNING runs.** A run that claimed its window and never finished. This
is worse than a missing run: the claim key blocks any retry, so the window is
lost permanently. Grace period is two windows (10 min) before a live run is
called stale.

**Windows with no persisted observation.** Counted back from the latest closed
window, regardless of whether a run exists. Thresholds match the watchdog's
shape — WARN 2, ALERT 4, CRITICAL 12 consecutive windows.

A stale run raises severity only while it is **recent** (last 12 windows). Older
ones stay in `staleRunningRuns` as evidence but stop alerting, because a check
that remains red for 24 hours after recovery cannot answer "is it broken now?".
`recentStaleRunningRuns` is the subset driving severity.

## Reading the `cause`

The cause is diagnosed from the **current gap**, so it describes what is wrong
now rather than what started it a day ago.

| `cause` | Meaning | Where to look |
| --- | --- | --- |
| `STALE_RUNNING` | Runs claimed windows and died | Collector runtime, market DB |
| `RUNS_WITHOUT_OBSERVATIONS` | Runs completed but wrote nothing | Collector, provider payloads |
| `NO_RUNS` | Nothing ran | Scheduler — this is the watchdog's to own |
| `NONE` | Healthy | — |

A gap can contain more than one kind of failure. When part of it had no run at
all, `windowsWithoutRunsInCurrentGap` says how many and the reason text names
the watchdog explicitly, so nobody is sent to the wrong system.

## Configuring the external monitor

Two HTTP checks, both **independent of cron-job.org**, which is what invokes the
collector:

```
GET https://cs2-quant.vercel.app/api/internal/collection-watchdog
GET https://cs2-quant.vercel.app/api/internal/collection-progress
Header: Authorization: Bearer <CRON_SECRET>
Interval: 5-15 minutes
Alert on: HTTP status != 200
```

Do not point these at cron-job.org. Any independent uptime service works
(Better Stack, Healthchecks.io, UptimeRobot, Pingdom); the only requirement is
that it is not the system being watched.

## What neither check does

Neither backfills, retries, or alters any collector run or observation. Both are
read-only. A window lost to a stale claim stays lost — that is a property of the
append-only experiment, not a bug in these checks.
