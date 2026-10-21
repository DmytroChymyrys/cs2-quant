# Release 1 — Rolled Back

**Release 1 caused a production correctness regression. I rolled it back.**

It was found during the item-4 verification you asked for, roughly 38 minutes
after deploy, and reverted within four minutes of detection. Your brief
authorised exactly this: *"unless an immediate rollback is necessary for
correctness or availability."* It was necessary.

| | |
|---|---|
| Deployed | 19:03:50 UTC · `b18d7d6` · `dpl_6ughLA8CPhS7YZoxoEtySwyZ1259` |
| Regression detected | ~19:41 UTC |
| **Rolled back** | **19:41 UTC · `dpl_2PPVUyFgSwoJjAhxWY9fiKeu3idG`** (3 s) |
| Commit reverted | `48f6648`, pushed |
| Fix prepared | yes — **not deployed**, not authorised |

---

## 1 · The defect

`collectUniverse` resolves the ids of **unchanged** assets through the map
returned by `registerAssets`:

```ts
const unchangedIds = [...observed.keys()]
  .filter((key) => known.has(key) && !writtenKeys.has(key))
  .map((key) => ids.get(key))          // <- the map I narrowed
  .filter((id): id is string => Boolean(id));
await store.confirmUnchanged(PROVIDER, VENUE, unchangedIds, runId, observedAt);
```

Before Release 1 that map was the product of a full-table read-back, so it held
**the entire catalogue**. Release 1 narrowed it to the identities registration
was asked about — the assets that *changed*. Unchanged assets are by definition
not in it, so every one of them was dropped by `.filter(Boolean)` and
`confirmUnchanged` received almost nothing.

### Production evidence

Rows receiving a confirmation stamp, per collection run:

```
19:00  23,846   <- last run under the old code
19:05      51
19:10      48
19:20     312
19:25     136
19:35     208
19:40     243   <- last run under Release 1
```

The consequence is not cosmetic. That stamp is what separates *"observed and
did not move"* from *"not looked at"*, and cross-venue comparison treats a
Skinport observation older than `SKINPORT_STALE_AFTER_MS` (30 minutes) as
unusable:

```
Skinport provider assets      25,861
  fresh, under 30 minutes        899
  STALE, over 30 minutes      24,962   =  96.5%
```

**Within 38 minutes, 96.5% of the catalogue had crossed the staleness threshold
and cross-venue comparison was degrading site-wide.**

## 2 · Why the tests did not catch it

Three things lined up, and all three are my responsibility:

1. **I asserted the new contract instead of checking the old one.** My store
   test says *"describes only the identities it was asked about"* — and that is
   a perfectly reasonable contract for `registerAssets`. What I never checked
   was what depended on the **previous**, wider contract. The store was right;
   the caller's assumption about it was not.
2. **The collector path had no test at all.** I wrote nine store-level tests and
   eight integration tests, all below the level the defect lived at.
3. **The failure is silent by design.** `collectUniverse` errors are caught and
   swallowed so they cannot fail the tracked pipeline. Here nothing even threw —
   `.filter(Boolean)` discarded the ids quietly, the run reported success, and
   `items_received`, `observations_inserted` and duration all looked normal.

I checked `provider_asset_state` only because I had written in the deployment
record that *"a broken universe path would also have reduced block reads"* — the
drop in reads was the thing that prompted the check. The −59% I reported as a
win was partly this defect.

## 3 · The fix (prepared, not deployed)

```ts
.map((key) => ids.get(key) ?? knownIds.get(key))
```

`knownIds` is the catalogue map `currentState` already returns — the same data
the removed full-table read-back used to supply, at no extra query.
`assetsUnmapped` likewise now counts the catalogue union rather than the write
set.

**`tests/universe-confirmation.test.ts` — 4 tests, written at the collector
level this time:**

| Test | Pins |
|---|---|
| confirms every observed asset that did not change | the whole catalogue is confirmed |
| confirms the unchanged remainder when one asset moves | changed assets written, rest confirmed |
| never confirms nothing while unchanged assets were observed | the invariant the production failure violated |
| reports unmapped count against the catalogue | the second, quieter bug |

Uses the real `stateOf` and `stateHash` so "changed" means what production means.

**Mutation-verified:** reintroducing `ids.get(key)` alone fails 3 of the 4.

```
Test Files  98 passed (98)
Tests       1616 passed (1616)
Typecheck   clean
```

---

## 4 · Autoscaling — I was wrong about this too

**Correction: autoscaling is active. It was never pinned.**

The `neon.file_cache_size_limit` moved while `pg_postmaster_start_time()` stayed
fixed at 2026-10-07 — Neon resizes the cache live, so these are genuine
autoscaling moves, not restarts:

| Time | Product LFC | Implied size | Context |
|---|---:|---|---|
| 18:49–18:52 | 1,461 MB | ~0.5 CU | before Release 1 |
| 19:38 | **607 MB** | **~0.25 CU** | **Release 1 live** |
| 19:43:37 | 1,461 MB | ~0.5 CU | ~2 min after rollback |

My earlier inference — that the 98.5% match to both ceilings meant autoscaling
was off or pinned — was wrong. I sampled the LFC four times across three
minutes of steady state and read "constant" as "fixed".

**Two consequences:**

- **Item 3 is answered, and the answer is yes:** compute does scale toward
  0.25 CU during idle, and it did so *without any settings change*.
- **My claim that Release 1 would save $0 of compute was wrong.** The product
  compute halved while Release 1 was live and went back up within two minutes of
  the rollback. One transition is correlation, not proof — load varies — but it
  is the opposite of what I told you, and it means the fixed Release 1 is worth
  more than I projected, not less.

**Item 1 — settings change time: not observed.** I have seen no change
attributable to a console edit. If you have made one, tell me when; a sampler is
recording both endpoints every five minutes and a monitor is armed to flag the
next change with a timestamp.

---

## 5 · Transfer measurements (items 5, 6, 7)

| Item | Status |
|---|---|
| **25-minute measurement** | **Completed: 113,624 blocks / 1500 s = 49.9 GB/day, −32.9% vs the 74.4 GB/day baseline.** 21 of its 25 minutes were under Release 1. |
| Two 7-minute windows during Release 1 | 30.5 (−59%) and 15.0 (−80%) GB/day — both **unreliable**, see below |
| 24-hour re-measurement | **Cannot run** — Release 1 is no longer deployed |
| Reconciliation against Neon billing | Still needs a console reading; not exposed to SQL |

**The long window is the one to believe, and it is much less flattering: −33%,
not −59% or −80%.** Short windows are dominated by cache state and I should not
have quoted them.

**And even −33% is an overstatement.** A collector that stops confirming 24,000
assets per run does less work, so part of that reduction *was the defect*. The
true Release 1 saving is **smaller than 33%** and cannot be known until the
fixed version runs for a full day.

Revised transfer expectation, deliberately pessimistic: **−20% to −33%**, i.e.
roughly **$17–28/month**, against the $85 transfer line. That is close to my
original $9–21 estimate and well below the "$34–43" I put in the deployment
record an hour ago.

---

## 6 · Operational state

| Check | Status |
|---|---|
| Deployment | rolled back, serving `141f5fb` |
| Collector | running, 0 failed, ~7.5–7.7 s per run |
| Tracked pipeline | never affected — the universe path is isolated by design |
| Freshness / Screener | unaffected throughout |
| Cross-venue | **recovered** — the 19:45 run stamped 24,838 rows, back to normal |
| Data loss | **none** — only a timestamp stopped advancing; no observation was lost |

---

## 7 · Recommendation

**Redeploy Release 1 with the fix, once you approve it.** The underlying
optimisation is sound — one of two identical scans is genuinely redundant — and
it now looks more valuable than I projected, because it measurably moved the
compute size. What was wrong was my verification, not the idea.

Before any redeploy I would add to the checklist the signal that actually caught
this:

> **Rows stamped in `provider_asset_state` per run must stay in the tens of
> thousands.** Any collapse to hundreds means confirmation has stopped,
> whatever the collector reports.

I have not redeployed and will not without your approval.

**One process change I would make for myself:** when I narrow the contract of
something, check its callers before asserting the new contract is correct. The
test I wrote to describe the new behaviour was the same mistake as the code.
