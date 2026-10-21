# Neon Cost Investigation — October 2026

**Audit only.** Nothing was migrated, deleted, or changed in production. Every
figure below is measured from the production database or the invoice, except
where explicitly marked as an estimate.

---

## 1. The bill, and what it actually means

| Resource | Usage (21 days) | Cost | Effective rate | Per day |
|---|---:|---:|---:|---:|
| Compute | 1,488.77 CU-h | $157.81 | $0.1060 / CU-h | 70.9 CU-h |
| Data transfer | 1,626.50 GB | $59.58 | $0.0366 / GB | 77.5 GB |
| History | 14.71 GB | $3.75 | $0.2549 / GB | — |
| Storage | 9.40 GB | $1.64 | $0.1745 / GB | — |
| **Total** | | **$222.78** | | |

**The headline number is not $222.78 — it is $318/month.** The invoice covers
1–21 October; at the same rate the full month lands at **$318.26**, and nothing
in the workload varies by day of month.

Two numbers define the problem:

- **1,488.77 CU-h ÷ 504 hours = 2.95 compute units running continuously, 24/7.**
- **1,626.5 GB ÷ 21 days = 77.5 GB/day of egress**, for two registered users.

Storage and history together are $5.39 of $222.78. **They are not the problem
and should not be optimised first.** Compute and transfer are 97.6% of the bill.

---

## 2. What is actually running

Production uses **four separate Neon databases**, each billing its own compute:
`DATABASE_URL` (product), `DERIVED_MARKET_DATABASE_URL`, `ASSET_IMAGES_DATABASE_URL`,
`CATALOG_DATABASE_URL`. Confirmed via `vercel env ls production`.

Four schedules wake them **744 times a day**:

| Job | Schedule | Runs/day | Database |
|---|---|---:|---|
| Skinport collect (cron-job.org) | `*/5` | 288 | product |
| Derived refresh ticker (Vercel) | `*/5` | 288 | derived |
| Asset-images health (Vercel) | `*/10` | 144 | asset-images |
| Steam collect (Vercel) | `40 * * * *` | 24 | product |

### Finding A — the schedules are tuned exactly to defeat scale-to-zero

Neon suspends a compute after **300 seconds** of inactivity. The product and
derived databases are woken **every 300 seconds**. They can therefore never
suspend, and are billed 24/7 whether or not anyone is using the product.

This is the whole compute bill. It is not that the database is working hard —
sampled live over two minutes, it was nearly idle at **14.8 index scans/second
and 49 rows/second**. We are paying for a database that is awake, not busy.

The product endpoint reports `max_connections = 901` and
`shared_buffers = 238 MB`, which Neon sizes to the **autoscaling maximum** —
so this endpoint is provisioned to scale to **2 CU**, for a workload that is
idle almost all of the time.

### Finding B — Skinport collection still runs every five minutes

Measured directly from `collector_runs`: **12 runs per hour, every hour,
288 per day.**

`src/lib/derived-market/cadence.ts` says this should already have stopped:

> Collection ran at five minutes until 2026-09-22T13:30Z and hourly from
> 2026-09-22T14:00Z, after Skinport asked that the full response be fetched
> once an hour rather than polled, to avoid rate limiting.

**That change was never applied to the scheduler.** A month later the
five-minute job is still running. The same file also records why it was not
simply switched — the derivation contract still expects five-minute evidence:

> NOT YET IN PRODUCTION. ACTIVE_PROFILE is still the five-minute v3 contract.

So the product has been paying for five-minute collection, against the
provider's explicit request, while the code documents hourly as the intent.

Each run fetches the **entire** Skinport catalogue — `items_received: 25165`
plus `history_items_received: 37383` — to extract **150 tracked assets**. That
is 288 full-catalogue fetches a day, and every one of them diffs against
`provider_asset_state` in the database.

### Finding C — the derived refresh wakes the database 288 times to do 24 jobs

The refresh ticker runs every five minutes, but activation is rate-limited to
once an hour by `DERIVED_ACTIVATION_COOLDOWN_MS`. The cooldown is checked
*before* any source read — the route records *"No source evidence was read"* —
so **264 of 288 daily invocations do nothing except wake the compute.**

The 24 that do work are expensive. Measured: a seven-day derivation scope is
**299,059 rows / 441 MB**, read from the product database per build, across two
to three continuation ticks.

### Finding D — raw observations have never been pruned

`market_observations` holds **1,440,935 rows / 2.58 GB spanning 41 days** —
back to 2026-09-09, the day collection started. Nothing has ever been deleted.
Retention runs only as a stage of the derived refresh lifecycle and covers the
derived database; the raw collector table on the product database has no
retention at all.

At 42,912 observations/day this grows ~2.4 GB/month. Storage is cheap, so this
is a minor direct cost — **but it is the input to the 441 MB scope read**, so
it inflates transfer on every build.

### Finding E — every collection run reports PARTIAL

`successRate: 0` over the last 24 hours: 288 runs, 0 successful, 288 partial.
The cause is two tracked assets with no current listings:

| Asset | Last observed |
|---|---|
| `Souvenir AWP \| Dragon Lore (Factory New)` | 2026-09-15 (36 days ago) |
| `★ Sport Gloves \| Vice (Factory New)` | 2026-10-19 |

This is not a cost problem and the data is not wrong — a delisted asset is
genuinely absent. But it means the success-rate signal is permanently zero and
tells us nothing, which is the same class of defect as the stale-threshold
issue fixed last week.

---

## 3. Where the money goes

| Driver | Mechanism | Share |
|---|---|---|
| 5-minute wakeups on two databases | prevents scale-to-zero → 24/7 compute | **~$225/mo** |
| 441 MB derivation scope, re-read per build tick | dominant egress | **~$85/mo** |
| Everything else | storage + history | $7.70/mo |

The two root causes are **one scheduling decision** (five-minute cadence that
was supposed to become hourly a month ago) and **one sizing decision** (four
always-awake databases provisioned to 2 CU).

---

## 4. Options, with expected savings

Rates below are the effective $/unit derived from this invoice, so the
comparison is plan-agnostic.

| Scenario | Monthly | Saving | Risk |
|---|---:|---:|---|
| Current | $318.26 | — | — |
| **A** — scheduling only | ~$160 | −50% | **low** |
| **B** — A + hourly collection | ~$34 | −89% | medium |
| **C** — B + consolidate to one project | ~$28 | −91% | medium |

### Scenario A — safe, reversible, no data-contract change

1. **Derived ticker `*/5` → `0,5,10,15,20 * * * *`** (288 → 120/day). Activation
   is hourly anyway; five consecutive ticks after the hour still complete a
   build, and the derived database gets a 40-minute idle window to suspend.
2. **Asset-images health `*/10` → `*/20`** (144 → 72/day). Stays inside
   `HEALTH_MAX_AGE_MS` (20 min) and creates a 15-minute idle window.
3. **Cap the product endpoint's autoscale maximum at 1 CU** (from 2) and confirm
   scale-to-zero is enabled with the shortest suspend the plan allows.

Scenario A cannot fix the product database, because Skinport collection still
wakes it every five minutes. That is why it only reaches ~50%.

### Scenario B — the real fix

4. **Move Skinport collection to hourly** (288 → 24/day). This is the change
   `cadence.ts` already documents as intended and the provider asked for.

   It is not a one-line scheduler edit. `ACTIVE_PROFILE` is still the
   five-minute V3 contract, and `cadence.ts` warns that deriving hourly
   snapshots over five-minute evidence *"would put twelve claimed runs in one
   window and trip DUPLICATE_INTEGRITY"*. The V4 hourly profiles already exist
   and are described as *"complete and tested but unused"*, with a `scopeFloor`
   designed for exactly this cutover. **This needs its own gate**, not a
   drive-by change.

   Compounding effect: ingest drops 12× (42,912 → 3,576 rows/day) **and** the
   seven-day derivation scope drops 12× (441 MB → ~37 MB), so it cuts the
   dominant compute driver and the dominant transfer driver at once.

5. **Add retention to `market_observations`** — bound it to the derivation
   window plus margin rather than letting it accumulate indefinitely.

### Scenario C — consolidation

6. **Collapse four Neon projects into one project with four databases.** Each
   project currently pays its own suspend-timeout overhead on every wake; one
   project pays it once. Mechanical but touches four connection strings.

**Secondary saving not counted above:** the derived refresh is a 3,009 MB
Vercel function running 288×/day for a job that executes 24×/day. Scenario A
cuts that Vercel compute by ~58% as a side effect.

---

## 5. Neon versus AWS

Modelled at Scenario-B volumes (~250 GB egress/month, ~13 GB storage):

| Option | Compute | Storage | Egress | **Total** |
|---|---:|---:|---:|---:|
| **Optimised Neon (B)** | $21 | $2 | $9 | **~$34** |
| **Optimised Neon (C)** | $16 | $2 | $9 | **~$28** |
| RDS db.t4g.micro, single-AZ | $11.68 | $3.45 | $13.50 | **$28.63** |
| EC2 t4g.small, self-managed | $12.26 | $3.45 | $13.50 | **$29.21** |
| RDS db.t4g.small, single-AZ | $23.36 | $3.45 | $13.50 | **$40.31** |

### The finding that decides this

**Migrating without optimising first would make the bill worse.** AWS charges
**$0.09/GB** egress after a 100 GB monthly free allowance. Neon's effective rate
on this invoice is **$0.0366/GB** — roughly 2.5× cheaper. At the current
2,323 GB/month, AWS egress alone would be **$200/month**, against Neon's $85.

The optimisation work is therefore required under either platform, and it is
the step that delivers essentially all of the saving. Once it is done, AWS and
optimised Neon land within a few dollars of each other.

### What AWS would cost beyond the invoice

- **db.t4g.micro has 1 GB RAM.** The product database is 5.1 GB and the
  derivation reads a 441 MB scope (~37 MB after Scenario B). 1 GB is tight and
  would likely force db.t4g.small, at which point AWS is **more expensive** than
  optimised Neon.
- **No scale-to-zero.** You pay 24/7 for two users. Neon's suspend is precisely
  the feature this workload should be exploiting, and currently is not.
- **You take on** backups, patching, version upgrades, failover and monitoring.
- **You lose** branching, point-in-time restore and instant provisioning.
- Migration of four databases and ~5 GB, plus a cutover, is multi-day work.

---

## 6. Recommendation

**Do not migrate. Optimise Neon, in this order.**

The saving comes almost entirely from fixing the schedule, not from changing
provider. Migration before optimisation increases the bill; migration after
optimisation saves at most a few dollars a month and costs real operational
burden.

| # | Action | Effect | Risk | Gate |
|---|---|---|---|---|
| 1 | Confirm scale-to-zero on; cap product autoscale at 1 CU | enables everything else | low | console only, reversible |
| 2 | Derived ticker → `0,5,10,15,20` | 288 → 120 wakes/day | low | one-line, reversible |
| 3 | Asset-images health → `*/20` | 144 → 72 wakes/day | low | one-line, reversible |
| 4 | **Measure for 7 days** | confirms model before riskier work | — | — |
| 5 | Skinport collection → hourly, with V4 profile cutover | the 89% saving | medium | **own gate** |
| 6 | Retention on `market_observations` | bounds growth and scope size | low | own gate |
| 7 | Re-measure; only then reconsider AWS | — | — | — |

Steps 1–3 are config changes with no data-contract implications and should land
this week. Step 5 is where the money is and deserves the same treatment the
freshness fix got: feasibility, implementation, controlled release.

**Separately, and not a cost issue:** the permanent `PARTIAL` / `successRate: 0`
state (Finding E) should be resolved so the signal means something — either by
untracking the delisted Dragon Lore or by distinguishing "absent from feed" from
"collection failed".

### Numbers I am confident in, and numbers I am not

**Measured:** every figure in sections 1 and 2 — collector cadence, scope size,
row counts, table sizes, idle query rate, retention span, run status, the four
databases, the effective unit rates.

**Estimated:** the Scenario A/B/C compute figures. They depend on how long each
database stays awake per wake cycle and on the suspend timeout actually
configured, which I cannot read from the database. I modelled active time plus
a 300-second suspend window per wake. If the suspend timeout is longer than the
default, Scenario A saves less; if it can be shortened, all scenarios save more.
**This is why step 4 measures before step 5 commits.**

AWS prices are current list rates from third-party aggregators, not AWS's own
price list — confirm before committing. Sources:
[RDS t4g.micro pricing](https://www.bytebase.com/dbcost/rds/instance/db.t4g.micro/),
[Spare Cores db.t4g.micro](https://sparecores.com/database/aws/db.t4g.micro),
[AWS RDS PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing),
[AWS data transfer pricing](https://egresscost.com/aws/data-transfer-pricing).
