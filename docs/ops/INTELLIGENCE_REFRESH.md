# Intelligence refresh runbook

How a new derived snapshot is generated, validated, published and rolled back.

The product never reads the market database. It reads one immutable derived
snapshot, chosen by the resolution order below. Publishing new intelligence
therefore means generating a snapshot and moving a pointer — never editing data
the product is already serving.

## Resolution order

The product picks the snapshot it serves in this order, and stops at the first
that resolves:

1. **`PRODUCT_ANALYTICS_SNAPSHOT_ID`** — an explicit pinned snapshot. Outranks
   everything. Use it to pin a reviewed snapshot, or to bypass a bad activation
   without touching the database. Requires a redeploy to change, which is why it
   is not the normal mechanism.
2. **The active pointer** — the single row in `derived_active_snapshot`. This is
   what a refresh moves. No redeploy is needed.
3. **Neither** — the product reports UNAVAILABLE. It never substitutes synthetic
   data, a stale default, or zero.

The page footer states which of these chose the snapshot it is showing.

## The three ages

Three different things are routinely called "freshness". They fail
independently and the product names them separately:

| Concept | Question it answers | Breaks when |
| --- | --- | --- |
| **Market evidence** | How recently did we observe the venue? | Collection stops |
| **Venue data age at capture** | How stale were the venue's own figures when we read them? | The venue's feed lags |
| **Intelligence computed** | When were these derived figures computed? | The refresh job stops |

Venue age at capture is a lag between two past instants. It is never recomputed
against the present, so a healthy 5-minute feed lag does not grow into an
alarming number as the snapshot ages.

## Running a refresh

```
MARKET_ANALYTICS_SOURCE_URL=<read-only market URL> \
DERIVED_MARKET_DATABASE_URL=<derived URL> \
npm run analytics:refresh
```

Useful flags: `--from` / `--to` for an explicit scope (default: the trailing
seven days up to the last fully elapsed five-minute bucket), `--no-activate` to
persist and validate without publishing, `--note` to record why.

The job:

1. takes a session advisory lock in the **derived** database,
2. opens the market database `REPEATABLE READ READ ONLY`, with the connection
   additionally pinned read-only at the server,
3. derives,
4. persists the snapshot and all of its rows in one transaction,
5. reads the snapshot back out,
6. validates it,
7. activates it with a single-statement pointer update,
8. releases the lock,
9. writes a structured report to `reports/derived-market/refresh-*.json` and one
   summary line to stdout.

Every failure before step 7 leaves the previously active snapshot serving. There
is no partial publication: the snapshot either committed completely or not at
all, and the pointer's foreign key can only name a snapshot that exists.

### Before a refresh can run against a new derived database

```
DERIVED_MARKET_DATABASE_URL=<derived URL> npm run db:migrate:derived
```

Migrations are checksum-pinned. A derived database created before the migration
ledger existed is adopted automatically, but only when every table a migration
owns is already present; a partially applied migration stops the run rather than
being guessed at.

## Validation: what blocks publication and what does not

`operationalStatus === "FAIL"` is **not** a gate, and must not become one. It is
set by any operational imperfection, and a seven-day window of real collection
almost always contains some. The distinction that matters is between evidence
that is *incomplete* and evidence that is *contradictory*.

**Blocking — the snapshot is persisted for inspection but never activated:**

- duplicate claimed windows or duplicate run/asset pairs
- observations timestamped outside their scheduled window
- observations belonging to a run that never claimed its window
- zero assets, zero features, or no asset with any feature row
- a scope whose final five-minute bucket has not elapsed
- the snapshot cannot be read back
- persisted counts differ from what was derived
- orphaned feature rows or history values, or features with no values object
- recomputed snapshot identity differs from the persisted identity
- the persisted report differs from the computed one, or carries no availability
- a method or report contract this build cannot read
- an operational failure code this build does not recognise

**Non-blocking — recorded in the report and in the refresh log, then published:**

- missing scheduled collection windows
- FAILED, PARTIAL or RUNNING collector runs
- provider HTTP errors and malformed payloads
- provider evidence age outside the expected 0–900 second band
- asset coverage gaps
- invalid or overrun run durations
- assets with no active listing observed, or with undeterminable availability

Refusing to publish degraded-but-coherent evidence does not produce better
intelligence. It produces *older* intelligence that is degraded in exactly the
same ways and additionally out of date, while the product already renders these
states truthfully through availability and evidence classes.

## Concurrency

The refresh holds a session advisory lock in the derived database. A second
refresh finds it taken, exits within milliseconds, generates nothing and does not
touch the pointer:

```
{"event":"derived.refresh","result":"LOCK_HELD_ELSEWHERE","stage":"lock", ...}
```

`npm run analytics:activate` takes the same lock, so a rollback cannot land
between a running refresh's validation and its activation.

## Rollback

Snapshots are immutable and are never pruned, so any previously generated
snapshot remains a valid target.

```
# see what exists and what is live
DERIVED_MARKET_DATABASE_URL=... npm run analytics:activate -- --list

# publish a specific snapshot
DERIVED_MARKET_DATABASE_URL=... npm run analytics:activate -- \
  --snapshot <id> --note "why"
```

Activation is one statement against a one-row table. Readers see the old snapshot
or the new one, never a mixture, and no redeploy is involved.

If the pointer itself is the problem, set `PRODUCT_ANALYTICS_SNAPSHOT_ID` to the
known-good snapshot; it outranks the pointer entirely.

## Retention

Retention deletes **derived snapshots only**. No statement in the retention
module or its CLI references `market_observations`, `collector_runs`, raw
evidence or frozen research artifacts, and none of them can: the derived
database is a different database and the market tables are not reachable from
it.

### What is kept, and why

Eligibility is decided by what a snapshot *is*, never by how old it is. Age is a
property of every snapshot including the one currently serving traffic, and says
nothing about whether deleting it would cost a rollback.

| Disposition | Meaning |
| --- | --- |
| `ACTIVE` | Serving the product now. Always implicitly protected. |
| `ROLLBACK` | One of the previous *N* activated snapshots (default 2), read from the activation ledger. |
| `PROTECTED` | Recorded in `derived_protected_snapshots` with a reason. |
| `PINNED` | Named by the caller with `--protect` on this run. |
| `DELETE` | None of the above. |

A snapshot that was generated but never activated **is a candidate**. If a
rejected or `--no-activate` snapshot is being held for inspection, protect it.

The rollback set comes from `derived_snapshot_activations`, not from creation
order: what we would roll back to is what we previously *published*, which is
not necessarily what was built most recently.

### Running it

Dry run is the default. Deletion requires `--execute`.

```
# classify and report; writes nothing
DERIVED_MARKET_DATABASE_URL=... npm run analytics:retention

# same classification, then delete
DERIVED_MARKET_DATABASE_URL=... npm run analytics:retention -- --execute

# keep a wider rollback set for this run
... npm run analytics:retention -- --keep-previous 4
```

Retention takes the refresh advisory lock, so it cannot classify snapshots while
a refresh is between validating a candidate and activating it. It refuses to run
at all when no snapshot is active (`NO_ACTIVE_SNAPSHOT`) or when the pointer
names a snapshot that does not exist (`ACTIVE_SNAPSHOT_MISSING`) — retention is
only ever legitimate *after* a successful activation, and that is enforced in
code rather than left to operator discipline.

The refresh can run it in the same lifecycle with `--retain-dry-run` or
`--retain`. Those flags only take effect when the run actually activated and the
pointer was read back naming the snapshot it just built; otherwise the report
says `"retention": {"mode": "SKIPPED"}`.

### **If `PRODUCT_ANALYTICS_SNAPSHOT_ID` is pinned, protect it**

A pinned snapshot is invisible to the database: the pin lives in the deployment
environment. Retention cannot see it and **will delete it** if it is not in the
rollback set.

Whenever an override is configured, protect that snapshot durably:

```
npm run analytics:protect -- --snapshot <id> --reason "PRODUCT_ANALYTICS_SNAPSHOT_ID pin"
```

`--protect <id>` on the retention command does the same thing for one run, and
is the right tool for a one-off. The durable table is the safer of the two and
is the recommended mechanism for anything that must survive: a flag only
protects a snapshot on the runs where somebody remembers to type it, whereas the
foreign key on `derived_protected_snapshots` makes the deletion physically
impossible until the protection is retired on purpose. Retire one with
`--remove`; list them with `--list`.

### Storage behaviour

Deleting rows does not immediately return disk to the operating system. The
logical bytes reported as reclaimed are freed for reuse; the database file
shrinks only after a `VACUUM FULL`, which takes an exclusive lock and is **not**
run automatically. In steady state the physical size settles at roughly
(snapshots retained + 1 in flight) × snapshot size, because each new snapshot
reuses the space the last deletion freed.

## Scheduling

The hourly refresh runs on **Vercel Cron**, declared in `vercel.json`:

```json
"crons": [{ "path": "/api/internal/refresh", "schedule": "20 * * * *" }],
"functions": {
  "src/app/api/internal/refresh/route.ts": { "memory": 3009, "maxDuration": 300 }
}
```

`:20` rather than the hour boundary, to stay clear of the crowd of jobs that
run exactly on the hour. The cadence is under evaluation and is **not**
permanent; do not change it to 30 minutes without a separate decision.

The endpoint authenticates with `CRON_SECRET` through the same `authorized()`
helper as every other internal route; Vercel Cron sends it automatically.

It calls the same lifecycle as the CLI — `src/lib/derived-market/refresh-run.ts`
— so there is one implementation of the derivation path and its guarantees hold
however the refresh is invoked.

### Function sizing

Measured in production on 2026-09-21: **149.8 s wall, 1,849.5 MB peak RSS** for
a seven-day scope. Against the configured 300 s and 3009 MB that is 50 % time
headroom and 38 % memory headroom. The default `standard` size (1769 MB) is
**below** the measured peak and would be killed, which is why the function
carries an explicit `memory` setting.

### `.github/workflows/intelligence-refresh.yml`

Kept, with **no schedule**, as manual recovery tooling: explicit scopes,
`--no-activate`, and a path that works when the production deployment is itself
broken. Two schedulers running the same refresh would contend for the advisory
lock, so only one owns the cadence.

### Retries

**There are none, deliberately.** A failed hour waits for the next scheduled
hour. Nothing in the workflow, the CLI, or the driver retries a refresh:

- GitHub Actions does not re-run a failed scheduled job automatically.
- `concurrency: intelligence-refresh` with `cancel-in-progress: false` queues
  rather than parallelises, and the derived advisory lock makes an overlapping
  run exit in milliseconds.
- `pg` is configured with `maxNetworkRetries` nowhere in this path.

That is the intended behaviour: a persistent fault must not become a hot loop
against the market database, and an hour of staleness is cheap. The product
keeps serving the last good snapshot throughout.

A scheduled run may be **delayed or dropped** by GitHub under load, so attempted
runs can be fewer than expected runs. That is measured, not corrected for.

### Measured cost

| Scope | Wall | Source read | Derive | Derived write | Validate | Activate | Peak RSS | Feature rows | Stored |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7 days (Neon) | 121s | 37.8s | 24.0s | 53.8s | 4.8s | 54ms | 1,851 MB | 192,605 | 310 MB |
| 24 hours (Neon) | 14s | 4.1s | 2.7s | 3.3s | 0.5s | 1ms | 596 MB | 20,917 | 31.8 MB |

With retention active the retained set is the active snapshot, two rollback
snapshots, and anything durably protected. Deleted space is freed for reuse but
is not returned to the operating system without `VACUUM FULL`, which takes an
exclusive lock and is **never run automatically**.

## What this job can never do

- write to the market database: it holds no writable market handle, and the one
  connection it opens is `READ ONLY` at both the transaction and the connection
- modify or delete an existing snapshot: snapshots are insert-only and
  content-addressed
- publish a snapshot that is incomplete, unreadable, or not the one it computed
- leave the pointer in an in-between state: activation is a single statement
- run retention before a successful activation and pointer verification
