# Full Skinport Catalog Sizing Experiment

Measurement only. No production collection, schema, snapshot, pointer, cron,
threshold or universe was changed. No production write was made. Capture ran at
the authorized five-minute cadence, offset from production's grid, and returned
no rate limiting.

Every figure is labelled **MEASURED** (observed directly), **CALCULATED**
(arithmetic on measurements) or **ESTIMATED** (an assumption was applied).
Storage units are GB = 10⁹ bytes.

## Executive summary

| Metric                                         |                                              Measured result |            |
| ---------------------------------------------- | -----------------------------------------------------------: | ---------- |
| Total Skinport assets (`/v1/items?tradable=1`) |         **25,031** canonical (25,375 raw − 344 variant rows) | MEASURED   |
| Assets with active listings                    |                                           **25,031 — 100 %** | MEASURED   |
| Complete response size                         | **10,426,997 B raw · 1,031,439 B gzip · brotli on the wire** | MEASURED   |
| % changing per 5 m                             |                         **0.384 % mean** (0.092 % – 0.691 %) | MEASURED   |
| % changing at least once / 30 m                |                                    **2.0 %** (500 of 25,031) | MEASURED   |
| Current-style projected storage / year         |                                                 **1,987 GB** | CALCULATED |
| Normalized projected storage / year            |                                                   **295 GB** | CALCULATED |
| Change-only projected storage / year           |                                                  **1.09 GB** | CALCULATED |

Two findings dominate everything below.

**The catalog barely moves.** 0.384 % of assets change in a five-minute window,
and only 2 % changed at all across thirty minutes. Storing a full snapshot every
five minutes writes ~260 identical rows for every row that carries new
information.

**Derived intelligence, not raw storage, is the expensive thing.** A derived
feature row costs **2,964 B** against **112 B** for a normalized observation —
26× — and the refresh already peaks at 1,849 MB for 100 assets inside a 3,009 MB
function.

---

## 1. Catalog composition

MEASURED from one complete response, sample 0, 2026-09-23T15:22:30Z.

| Property                                  |                          Value |
| ----------------------------------------- | -----------------------------: |
| Raw rows                                  |                         25,375 |
| Variant rows excluded (`version != null`) |                            344 |
| Canonical rows                            |                         25,031 |
| Duplicate names, raw                      |                            250 |
| Duplicate names, after variant filter     |                          **0** |
| Unique `market_hash_name`                 |                         25,031 |
| Raw response bytes                        |                     10,426,997 |
| gzip bytes                                |  1,031,439 (10.1× compression) |
| Wire encoding                             | brotli (`Accept-Encoding: br`) |

Null rates across every field the code parses: **zero**, except
`suggested_price` on **2 of 25,031** rows. `min_price`, `median_price`,
`mean_price`, `quantity`, both timestamps and both URLs are complete.

### `tradable=1` makes "zero listings" unobservable

The collector requests `tradable=1`, so the feed contains **only items currently
for sale**. Every row has `quantity >= 1`; there are **no zero-listing rows and
there cannot be**. This is not a property of the market, it is a property of the
request.

Consequences, all of which matter for the decisions at the end:

- "Assets with no active listings" cannot be counted from this endpoint.
- Disappearance from the feed means _no active listing_, never `quantity = 0` —
  which is exactly what production's `NO_ACTIVE_LISTING_OBSERVED` already
  encodes. The brief's instruction here matches existing behaviour.
- **Catalog coverage for Portfolio cannot come from this endpoint.** An item
  nobody is currently selling is invisible.

### Category distribution

Weapon classification uses production's own weapon→category map
(`src/lib/catalog/browsing.ts`). Knives/gloves/stickers/cases are matched by
explicit name rules stated in the analysis script. Anything not matched
confidently is reported as `unclassified` rather than guessed — so category
counts are **ESTIMATED**, while the counts and depths within each are MEASURED.

| Category            | Assets | % of catalog | Median depth | Median price |
| ------------------- | -----: | -----------: | -----------: | -----------: |
| Stickers & capsules |  9,778 |       39.1 % |           11 |        $1.22 |
| Pistols             |  3,242 |       13.0 % |           27 |        $2.70 |
| Rifles              |  2,536 |       10.1 % |           23 |        $9.23 |
| SMGs                |  2,317 |        9.3 % |           28 |        $1.37 |
| Knives              |  1,959 |        7.8 % |            3 |      $146.11 |
| _unclassified_      |  1,575 |        6.3 % |            2 |        $2.12 |
| Shotguns            |  1,227 |        4.9 % |           22 |        $1.34 |
| Snipers             |  1,134 |        4.5 % |           25 |        $3.88 |
| Other collectibles  |    413 |        1.7 % |           17 |        $4.09 |
| Gloves              |    404 |        1.6 % |            9 |      $167.90 |
| Machine guns        |    382 |        1.5 % |         27.5 |        $0.70 |
| Cases               |     64 |        0.3 % |    **2,906** |        $7.36 |

Stickers are 39 % of the catalog. Cases are 64 assets but carry by far the
deepest books.

---

## 2. Market-depth distribution

MEASURED across all 25,031 listed assets. Total listings in the catalog:
**3,696,439**.

| Statistic | Listings |
| --------- | -------: |
| min       |        1 |
| p10       |        1 |
| p25       |        4 |
| median    |   **14** |
| p75       |       50 |
| p90       |      214 |
| p95       |      616 |
| p99       |    1,429 |
| max       |   89,730 |

| Bucket    | Assets |
| --------- | -----: |
| 0         |      0 |
| 1         |  3,050 |
| 2–5       |  5,012 |
| 6–10      |  3,223 |
| 11–25     |  4,525 |
| 26–50     |  2,994 |
| 51–100    |  2,213 |
| 101–500   |  2,556 |
| 501–1,000 |    999 |
| >1,000    |    459 |

Price (minimum listing, USD): min $0.02 · p25 $0.43 · **median $2.56** ·
p75 $18.94 · p90 $115.83 · p99 $1,013.53 · max $81,119.83.

A third of the catalog has five listings or fewer. Half is under $2.56.

---

## 3. Five-minute change rate

MEASURED. Seven complete responses, 15:22:30 → 15:52:30 UTC, five minutes
apart, offset 2.5 minutes from production's grid. All seven succeeded; **no
rate limiting**. All seven response hashes differ.

Fields compared: `quantity`, `min_price`, `median_price`, `mean_price`,
`suggested_price`.

| Pair  | In both | Added |  Gone | Changed | % changed | qty | min | median | mean | suggested |
| ----- | ------: | ----: | ----: | ------: | --------: | --: | --: | -----: | ---: | --------: |
| s0→s1 |  25,031 |     0 |     0 |     173 |    0.69 % |  66 |  66 |     60 |  138 |         0 |
| s1→s2 |  25,031 |     0 |     0 |      45 |    0.18 % |  32 |  21 |     22 |   41 |         0 |
| s2→s3 |  25,031 |     0 |     0 |      23 |    0.09 % |  14 |  16 |      3 |   16 |         0 |
| s3→s4 |  25,030 |     0 | **1** |      53 |    0.21 % |  29 |  28 |     16 |   33 |         0 |
| s4→s5 |  25,030 |     0 |     0 |     138 |    0.55 % |  63 |  71 |     43 |  103 |         0 |
| s5→s6 |  25,030 |     0 |     0 |     145 |    0.58 % |  57 |  93 |     49 |  116 |         0 |

- **Mean 0.384 % per five-minute window**, range 0.092 %–0.691 %.
- **Union of change over 30 minutes: 500 assets — 2.0 % of the catalog.**
- Unchanged per window: 99.6 % mean.
- One asset disappeared; none appeared. Treated as loss of active listing, not
  as `quantity = 0`.
- `suggested_price` **never changed** in any pair — it is not a five-minute
  quantity.

Supporting MEASURED evidence from production: the `/v1/sales/history` response
was **byte-identical across 26 consecutive runs** (21,018,933 B, same hash),
while the items response changed on all 26. Sales history is not a
five-minute quantity either.

---

## 4. Measured row and response sizes

All MEASURED by Postgres (`pg_relation_size` / `pg_indexes_size`) on real
catalog rows loaded into a throwaway local database — not from JavaScript
object sizes.

| Design                                      | Heap/row | Index/row | **Total/row** |
| ------------------------------------------- | -------: | --------: | ------------: |
| Model 1 — current style, items payload only |    701 B |      53 B |     **755 B** |
| Model 2 — normalized observation            |     75 B |      37 B |     **112 B** |
| Model 3 — change-only state row             |        — |         — |     **108 B** |
| Model 2/3 static asset row (one-off)        |        — |         — |         346 B |

Production's existing rows, for comparison (MEASURED on the live market DB):
361,163 rows in 650 MB total (566 MB heap + 85 MB indexes) = **1,886 B/row**,
averaging 1,569 B of content — `raw_item_payload` 494 B **plus
`raw_history_payload` 793 B**. The history payload roughly doubles the row, and
an items-only full-catalog ingest would not have it. That is why Model 1 is
measured at 755 B rather than 1,886 B.

Derived intelligence, MEASURED on the production derived database: 683,951
feature rows in 1,933 MB (1,539 MB heap + 394 MB indexes) = **2,964 B per
feature row**. Index overhead there is 25.6 % of heap, against 7.6 % for
Model 1 and 49 % for Model 2 (whose rows are small enough that the primary key
is a large fraction of the total).

---

## 5. Storage formulas

```
rows/day, full snapshot      = assets × 288
rows/day, change-only        = assets × 288 × change_rate
bytes/day                    = rows/day × bytes_per_row
static catalog (one-off)     = assets × 346 B
run ledger                   = 288 rows/day  (negligible, <10 MB/yr)
derived intelligence/snapshot = assets × scope_windows × 2,964 B
```

Assumptions applied:

- `change_rate = 0.384 %` — MEASURED mean over six pairs in one 30-minute
  window, on a Wednesday afternoon UTC. **ESTIMATED** as representative of other
  hours; it is not. Ranges below use the measured 0.092 %–0.691 % spread.
- Index overhead is included in the per-row measurements, not added separately.
- Row sizes assume no TOAST compression change at scale; Model 1's JSONB
  payloads are already TOAST-eligible at these sizes and were measured as
  stored.
- No vacuum/bloat allowance. Real databases carry dead tuples between vacuums;
  production's derived database currently shows ~15 % bloat after retention
  deletes. **ESTIMATED** +15 % should be applied to any figure used for
  provisioning.

---

## 6. Projections — full catalog (25,031 assets, 288 windows/day)

CALCULATED from the measurements above. Raw market-state layer only; derived
intelligence is separate and appears in §7.

| Model                          |     /day |    30 d |    90 d |      **1 y** |      3 y |
| ------------------------------ | -------: | ------: | ------: | -----------: | -------: |
| 1 — current style (items-only) |  5.44 GB |  163 GB |  490 GB | **1,987 GB** | 5,960 GB |
| 2 — normalized every 5 min     |  0.81 GB | 24.2 GB | 72.7 GB |   **295 GB** |   884 GB |
| 3 — change-only state          | 0.003 GB | 0.09 GB | 0.27 GB |  **1.09 GB** |  3.27 GB |

Change-only, using the measured rate range rather than the mean:
**0.26 GB – 1.96 GB per year**. Even the worst observed five-minute window,
sustained for a year, stays under 2 GB.

Model 3 is **270× smaller than Model 2** and **1,820× smaller than Model 1**.

Model 3 requires the run ledger to prove a collection happened when no state row
was written, and must answer "latest known state of asset X at time T" via
`select … where asset_id = X and valid_from <= T order by valid_from desc limit 1`
— which the measured primary key `(asset_id, valid_from)` serves directly.

---

## 7. Universe scenarios at five-minute cadence

CALCULATED. Derived column is **per 7-day snapshot**, not per year — and the
hourly refresh rewrites it in full each time.

| Universe         |   Obs/day | Changed rows/day | Raw M2 /mo | Raw M2 /yr | Raw M3 /yr | Derived /snapshot |
| ---------------- | --------: | ---------------: | ---------: | ---------: | ---------: | ----------------: |
| 100 (current)    |    28,800 |              111 |    0.10 GB |    1.18 GB |   0.004 GB |           0.60 GB |
| 500              |   144,000 |              553 |    0.48 GB |    5.89 GB |   0.022 GB |           2.99 GB |
| 1,000            |   288,000 |            1,106 |    0.97 GB |    11.8 GB |   0.044 GB |           5.98 GB |
| 2,500            |   720,000 |            2,766 |    2.42 GB |    29.4 GB |   0.109 GB |           14.9 GB |
| 5,000            | 1,440,000 |            5,532 |    4.84 GB |    58.9 GB |   0.218 GB |           29.9 GB |
| **25,031 (all)** | 7,208,928 |           27,697 |    24.2 GB |     295 GB |    1.09 GB |        **150 GB** |

The derived column is the constraint, not the raw column. At 1,000 assets a
single snapshot is 5.98 GB and three retained snapshots are 18 GB; at the full
catalog one snapshot is 150 GB and the retained set is 449 GB — rewritten
hourly.

**Derived intelligence does not scale linearly in the dimension that matters.**
Storage does scale linearly with assets, but the refresh process does not fit:
MEASURED peak 1,849 MB resident for 100 assets in a 3,009 MB function. Ten times
the assets exceeds the function; 250 times is not addressable at all. Any
expansion of the derived universe beyond roughly 150 assets requires re-architecting
the refresh into a streaming or chunked job before storage is even relevant.

---

## 8. Eligibility thresholds

MEASURED. Depth threshold applied to the single captured response. No threshold
is recommended here.

| Threshold  | Eligible | % of catalog | Median depth | Median price | Leading categories                             |
| ---------- | -------: | -----------: | -----------: | -----------: | ---------------------------------------------- |
| ≥1 listing |   25,031 |        100 % |           14 |        $2.56 | stickers 39.1 %, pistols 13.0 %, rifles 10.1 % |
| ≥2         |   21,981 |       87.8 % |           18 |        $2.03 | stickers 39.5 %, pistols 14.0 %, rifles 10.9 % |
| ≥5         |   17,850 |       71.3 % |           27 |        $1.39 | stickers 38.3 %, pistols 15.7 %, rifles 11.7 % |
| ≥10        |   14,293 |       57.1 % |           40 |        $1.03 | stickers 36.2 %, pistols 17.1 %, rifles 12.5 % |
| ≥25        |    9,406 |       37.6 % |           79 |        $0.51 | stickers 34.2 %, pistols 18.3 %, SMGs 13.0 %   |
| ≥50        |    6,316 |       25.2 % |          149 |        $0.27 | stickers 35.8 %, pistols 17.8 %, SMGs 13.3 %   |
| ≥100       |    4,043 |       16.2 % |          294 |        $0.09 | stickers 40.4 %, pistols 16.4 %, SMGs 12.5 %   |

Median price _falls_ as the depth threshold rises: deep books are cheap, high-volume
items. Depth is a liquidity filter, not a value filter, and filtering on it
selects **against** the expensive knives and gloves (median $146 and $168, median
depth 3 and 9) that a portfolio user is most likely to care about.

---

## 9. Architecture comparison

Three distinct coverages, which the current system conflates because all three
are the same 100 assets:

- **catalog coverage** — can FloatAlpha name and recognise the asset?
- **historical market-state coverage** — is there a price/depth series?
- **derived-intelligence coverage** — returns, volatility, activity, the screener.

|                            | Option A — curated / curated    | Option B — full ingest / curated intelligence                        | Option C — full / full                     |
| -------------------------- | ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| Catalog coverage           | 100                             | 25,031 listed (+37,136 via history)                                  | same as B                                  |
| Market-state coverage      | 100                             | 25,031                                                               | 25,031                                     |
| Derived coverage           | 100                             | curated subset                                                       | 25,031                                     |
| Raw storage / yr           | 1.18 GB (M2)                    | 295 GB (M2) or **1.09 GB (M3)**                                      | same as B                                  |
| Derived / snapshot         | 0.60 GB                         | 0.60–6 GB                                                            | **150 GB**                                 |
| Refresh feasibility        | proven                          | proven                                                               | **not feasible on current infrastructure** |
| Screener / Terminal        | works                           | works                                                                | works, on a much larger candidate set      |
| Asset Intelligence         | 100 assets only                 | curated only; others show price/depth history but no derived metrics | all assets                                 |
| Search                     | 100 names                       | 25,031 names                                                         | 25,031 names                               |
| Watchlist                  | curated only                    | any ingested asset, with history                                     | any                                        |
| Manual portfolio           | 100                             | 25,031                                                               | 25,031                                     |
| **Steam portfolio import** | **fails for almost everything** | recognises any currently-listed item; unlisted items still unknown   | same as B                                  |

Option C is eliminated by measurement, not by preference: 150 GB per snapshot
rewritten hourly, and a refresh that needs ~250× the memory of a function that
is already at 61 % utilisation.

Option B's cost depends entirely on the storage model. At Model 2 it is 295 GB/yr
— real money and real operational weight. At **Model 3 it is 1.09 GB/yr**, which
is less than the current derived database holds today.

---

## 10. Risks and unknowns

1. **The change rate is a single 30-minute sample** on a Wednesday afternoon.
   Trading is not uniform across the day or week. A weekend evening could be
   materially higher. This is the single most load-bearing measurement and the
   least sampled. MEASURED range 0.092 %–0.691 % already spans 7.5×.
2. **`tradable=1` hides the unlisted catalog.** Neither the size of the full CS2
   item universe nor the recognition rate for a real Steam inventory is measured
   here. The 37,136 history names are a floor, not the answer.
3. **Change-only history has no proven read path in this codebase.** Every
   product query today assumes a row per window. Interval queries are a
   different access pattern, and the derived pipeline's complete-window
   semantics (`N consecutive observations or null`) would need redefining
   against intervals.
4. **Bloat is excluded.** Change-only writes little but still needs vacuum;
   production's derived database currently carries ~15 % dead space.
5. **No index tuning was explored.** Model 2's index overhead is 49 % of heap
   because the composite primary key is large relative to a 75-byte row.
6. **The 25,031 count moved during the capture** (25,375 → 25,374 raw). The
   catalog is not fixed; a full-ingest design must handle continuous
   appearance/disappearance, and one asset disappeared within 30 minutes.

---

## 11. Recommendation, strictly from the evidence

### Should FloatAlpha ingest the entire Skinport catalog into its market-state / history layer?

**Yes — but only under a change-only model.**

The evidence is one-sided. The full catalog changes 0.384 % per five-minute
window, so full-snapshot persistence writes ~260 redundant rows per informative
one. Change-only storage of the entire 25,031-asset catalog costs a
**MEASURED-derived 1.09 GB/year** (0.26–1.96 GB across the observed rate range),
against 295 GB/year for normalized snapshots and 1,987 GB/year for the current
row shape. Ingesting everything change-only is cheaper than ingesting 1,000
assets as full snapshots.

That single decision also unlocks the Portfolio requirement: catalog coverage
goes from 100 to 25,031 recognised assets, each with a real price/depth history,
without committing to derived intelligence for any of them.

The qualifier is §10.3 — change-only has no proven read path here. This should
be a designed migration with the interval query and the run-ledger proof
built and tested first, not a switch.

### Should FloatAlpha calculate full derived intelligence for the entire catalog?

**No. Measurement rules it out.**

150 GB per snapshot, rewritten hourly, with a retained set of 449 GB — against a
derived database that holds 1.9 GB today. And it cannot execute: the refresh
peaks at 1,849 MB for 100 assets inside a 3,009 MB function, so the full catalog
needs roughly 250× the memory available. Expanding the derived universe even to
1,000 assets requires re-architecting the refresh first.

Depth is also the wrong filter to widen on. Raising the threshold _lowers_ median
price ($2.56 → $0.09 at ≥100) and selects against knives and gloves — the
expensive items a portfolio user cares about most.

**The two decisions are genuinely separable, and the evidence separates them:**
ingest broadly and cheaply via change-only state; derive narrowly and
deliberately. Option B with Model 3 storage is what the measurements support.
