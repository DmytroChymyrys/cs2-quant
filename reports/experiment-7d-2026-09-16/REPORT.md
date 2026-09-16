# FloatAlpha — Seven-Day Collection Experiment Report

Generated **2026-09-16T18:21:16.904Z**. Source **Skinport**, currency **USD**, five-minute scheduled cadence.

Experiment boundary, applied exactly: **2026-09-09T17:55:00Z ≤ scheduled_window < 2026-09-16T17:55:00Z**.
First scheduled window **2026-09-09T17:55:00Z**; last included scheduled window **2026-09-16T17:50:00Z**.
2,016 scheduled windows · 100 assets · 201,600 observations expected if every window carried every asset.

This is a read-only analysis. No collector, cron, provider, schema, universe, cadence, environment or production row was changed, and nothing was backfilled, interpolated or deleted.

---

## Assessment

Collection ran for seven days without a single missed, duplicated or off-grid scheduled window: **2,016 of 2,016 windows were claimed and executed**, and **201,235 of 201,600 possible observations** were persisted — **99.819% completeness**. Every one of the 365 absent observations traces to **two upstream events**, not to the collector.

The dataset supports **descriptive market intelligence that price-only CS2 trackers do not expose**: a continuous, timestamped listing-supply series alongside price. Across the universe, listing quantity changed more often than price (6,145 versus 3,747 transitions over 201,035 adjacent comparisons), and price and listing supply move in **opposite directions in 94.9% of the five-minute steps where both move**. That inverse structure is real and consistently observed — but a large part of it is a **mechanical property of an order book snapshot**, not independent information, and the report quantifies exactly how much.

**No predictive relationship was established.** Listing change followed by forward price return is effectively uncorrelated across the universe at every horizon tested (pooled Pearson +0.025 at 1h, +0.035 at 6h, −0.003 at 24h; the non-overlapping 24h estimate has a 95% interval of −0.083 to +0.093). Apparent state-conditional forward returns are explained by minimum-price bounce that is present **with or without** listing information.

Storage is the binding constraint: the observation relation grew **51.80 MB/day measured**, reaching **363.09 MB** and a **373.78 MB** database in seven days.

### Gate summary

| Gate | Result | Evidence |
| --- | --- | --- |
| Scheduling | PASS | 2,016/2,016 windows claimed; 0 missing, 0 duplicate, 0 off-grid |
| Collector reliability | PASS | 0 collector-caused failures; both incomplete-data events are upstream and were recorded correctly |
| Coverage | PASS with two upstream gaps | 201,235/201,600 = 99.819%; 365 missing pairs, all attributable |
| Data quality | PASS | 0 invalid values, 0 timestamp anomalies, 0 future timestamps, 0 missing values, 0 duplicate pairs |
| Freshness | PASS with spikes | Median 302.99s, p95 311.82s, max 904.67s; 15 windows >7 min, 2 windows >15 min |
| Descriptive usefulness | SUPPORTED | All 100 assets changed in at least one recorded field; 1h/6h/24h/7d features available for all 100 |
| Predictive usefulness | NOT ESTABLISHED | Lead/lag correlations indistinguishable from zero across the universe |
| Storage | ACTION NEEDED BEFORE SCALING | 51.80 MB/day at 100 assets; 1,884 bytes/observation including indexes |

---

## Phase 1 — Frozen seven-day dataset

### Scheduling and window inventory

| Measure | Value |
| --- | --- |
| Expected scheduled windows | 2,016 |
| Windows with a claimed run | 2,016 |
| Missing windows | 0 |
| Duplicate windows (>1 claimed run) | 0 |
| Off-grid windows | 0 |
| Successful windows | 1,750 |
| Partial windows | 265 |
| Failed windows | 1 |

Only the invocation that claims a window owns its unique key, so duplicate attempts cannot double-insert. No duplicate attempt occurred inside the experiment window.

### Observations

| Measure | Value |
| --- | --- |
| Observations expected | 201,600 |
| Observations persisted | 201,235 |
| Completeness | 99.819% |
| Duplicate asset/window pairs | 0 |
| Missing asset/window pairs | 365 |
| Distinct assets observed | 100 |
| Observations per asset | 2,015 for 99 assets; 1,750 for 1 asset |
| Source / provider | SKINPORT (1 distinct value) |
| Currency | USD (1 distinct value) |
| Earliest provider `source_updated_at` | 2026-09-09T17:50:12Z |
| Latest provider `source_updated_at` | 2026-09-16T17:45:13Z |
| Earliest provider `source_created_at` | 2018-09-03T15:24:13Z |
| Latest provider `source_created_at` | 2026-06-16T02:59:10Z |
| First observation written | 2026-09-09T17:55:13.883Z |
| Last observation written | 2026-09-16T17:50:15.686Z |

99 assets have 2,015 rather than 2,016 observations because one window produced no rows at all. `source_created_at` is the provider's item-listing creation timestamp and legitimately predates the experiment.

### Reconciliation against the whole database

The database holds **202,034 observations** in total: **201,235** inside this frozen window, **205** from three successful pre-experiment setup runs (first attempt 2026-09-09T17:05:22.765Z), and **594** written after the cutoff by six windows that are correctly excluded from every experiment statistic. Two pre-experiment attempts were suppressed as `DUPLICATE_WINDOW`, claimed nothing and inserted nothing.

Every run's `observations_inserted` counter matched its actual persisted row count. **0 reconciliation discrepancies.**

### Storage at the close of the experiment

| Relation | Table + TOAST | Indexes | Total |
| --- | --- | --- | --- |
| `market_observations` | 316.23 MB | 46.86 MB | 363.09 MB |
| `collector_runs` | 2.02 MB | 0.39 MB | 2.41 MB |
| `asset_source_mappings` | 0.05 MB | 0.06 MB | 0.11 MB |
| `assets` | 0.05 MB | 0.03 MB | 0.08 MB |
| **Whole database** | | | **373.78 MB** |

Observation indexes in detail: `observations_asset_source_time` 20.05 MB, `observations_run_asset` 15.92 MB, `market_observations_pkey` 8.21 MB, `observations_source_time` 2.67 MB.

**Measured growth:** the observation relation went from 0.46 MB at experiment start to 363.09 MB over exactly seven days — **51.80 MB/day**. The whole database grew **52.19 MB/day**. Average cost is **1,884 bytes per observation including indexes and TOAST**, of which 1,641 bytes is heap.

---

## Phase 2 — Reliability and data quality

### Data-quality table

All checks below run over the 201,235 frozen observations.

| Check | Result |
| --- | --- |
| Coverage (windows) | 2,016 / 2,016 = 100.000% |
| Completeness (observations) | 201,235 / 201,600 = 99.819% |
| Duplicate rate (asset/window) | 0 / 201,235 = 0.000% |
| Missing minimum price | 0 |
| Missing median / max / mean / suggested price | 0 / 0 / 0 / 0 |
| Missing published 24h/7d/30d/90d sales volume | 0 / 0 / 0 / 0 |
| Missing raw history payload | 0 |
| Non-USD currency | 0 |
| Negative listing quantity | 0 |
| Zero listing quantity | 0 |
| Non-positive minimum price | 0 |
| Minimum price above median price | 0 |
| Minimum price above maximum price | 0 |
| Provider timestamp after observation time | 0 |
| Future provider timestamp | 0 |
| Future observation timestamp | 0 |
| `source_created_at` after `source_updated_at` | 0 |
| Observation outside its own five-minute window | 0 |
| Payload identity mismatch (`market_hash_name`) | 0 |
| Unexpected payload `version` field | 0 |
| Foreign source rows | 0 |
| Run counter vs. actual rows | 0 discrepancies |

70,599 observations carry a published 24h sales volume of zero. **Zero is valid data and is not counted as missing.**

### Collector reliability

Whole-job duration across all 2,016 runs: minimum **3.978s**, median **6.529s**, p95 **7.756s**, p99 **8.010s**, maximum **14.284s**. These cover provider download, validation, processing and persistence end to end; they are not database CPU time.

Per-run payloads were stable: the items endpoint returned 25,386–25,442 items (~10.0 MB) and the history endpoint 36,864–36,975 items (~19.9 MB) on every run.

| UTC date | Windows | Success | Partial | Failed | Observations | Job p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-09 (partial day) | 73 | 73 | 0 | 0 | 7,300 | 7.47s |
| 2026-09-10 | 288 | 288 | 0 | 0 | 28,800 | 7.86s |
| 2026-09-11 | 288 | 288 | 0 | 0 | 28,800 | 7.88s |
| 2026-09-12 | 288 | 288 | 0 | 0 | 28,800 | 7.71s |
| 2026-09-13 | 288 | 288 | 0 | 0 | 28,800 | 7.82s |
| 2026-09-14 | 288 | 288 | 0 | 0 | 28,800 | 6.85s |
| 2026-09-15 | 288 | 237 | 50 | 1 | 28,650 | 7.04s |
| 2026-09-16 (partial day) | 215 | 0 | 215 | 0 | 21,285 | 7.67s |

**The collector produced zero failures of its own.** Every non-SUCCESS window is a faithful recording of an upstream condition.

### Provider data behaviour

Two distinct upstream events account for all 365 missing observations.

**Event 1 — provider HTTP 400, 2026-09-15T19:35:00Z.** The Skinport items endpoint returned HTTP 400 while the history endpoint returned 200. The run recorded `HTTP_ERROR`, logged the upstream error, inserted nothing, and finished in 3.978s. Cost: **1 failed window, 100 missing asset/window pairs**. The next window at 19:40 succeeded fully. This is the only 4xx in seven days.

**Event 2 — an asset left the market, 2026-09-15T19:50:00Z onward.** `Souvenir AWP | Dragon Lore (Factory New)` stopped appearing in the Skinport items feed and never returned before the cutoff. Every subsequent window recorded `INCOMPLETE_COVERAGE` with exactly 99 of 100 assets matched. Cost: **265 partial windows, 265 missing asset/window pairs**. The asset had held **exactly one listing for all 1,750 of its observations**; that single listing disappeared. This is a market event, correctly surfaced as a coverage warning — and it is discussed as a case study in Phase 7.

Across all 2,016 runs: **0 HTTP 429 responses**, **0 HTTP 5xx responses**, **1 HTTP 400**. The history endpoint returned 200 on every single run. Database records cannot evidence a request that failed before writing any run row; the complete 2,016-window schedule coverage is the independent check against that.

### Freshness (provider data age)

Observation time minus provider `source_updated_at`, over all 201,235 observations:

| Statistic | Value |
| --- | --- |
| Minimum | 238.392s |
| Median | 302.990s |
| Mean | 306.076s |
| p95 | 311.818s |
| p99 | 314.908s |
| Maximum | 904.672s |
| Standard deviation | 32.833s |
| Observations >7 minutes | 1,494 (0.742%) |
| Observations >10 minutes | 1,394 (0.693%) |
| Observations >15 minutes | 199 (0.099%) |
| Negative lag | 0 |

**Every asset in an affected window shares the identical lag**, which confirms these are upstream publication delays rather than per-asset or collector effects. 15 windows out of 2,016 (0.744%) were affected.

| Window start (UTC) | Source lag | Band | Observations |
| --- | --- | --- | --- |
| 2026-09-12T22:00:00Z | 611.031s | >10m | 100 |
| 2026-09-13T19:05:00Z | 600.021s | >10m | 100 |
| 2026-09-13T19:55:00Z | 601.373s | >10m | 100 |
| 2026-09-14T13:15:00Z | 599.159s | >7m | 100 |
| 2026-09-14T13:45:00Z | 604.374s | >10m | 100 |
| 2026-09-14T14:20:00Z | 604.202s | >10m | 100 |
| 2026-09-14T15:20:00Z | 601.013s | >10m | 100 |
| 2026-09-15T19:40:00Z | 605.071s | >10m | 100 |
| **2026-09-15T19:45:00Z** | **904.672s** | **>15m** | 100 |
| 2026-09-16T11:40:00Z | 603.201s | >10m | 99 |
| **2026-09-16T11:45:00Z** | **903.550s** | **>15m** | 99 |
| 2026-09-16T14:25:00Z | 600.874s | >10m | 99 |
| 2026-09-16T16:00:00Z | 616.454s | >10m | 99 |
| 2026-09-16T16:30:00Z | 607.627s | >10m | 99 |
| 2026-09-16T16:35:00Z | 899.933s | >10m | 99 |

Two observations matter. First, the excursions **cluster in the back half of the experiment**: days 1–3 never exceeded 315s, while 9 of the 15 events fall on 09-15 and 09-16. Second, the 19:40 and 19:45 spikes on 09-15 **bracket the HTTP 400 at 19:35 and immediately precede the delisting at 19:50** — the provider's items feed was visibly unhealthy for roughly twenty minutes. Whether this is a trend or a coincidence is exactly what a 30-day window would settle.

**Separation of concerns.** Collector reliability: 2,016/2,016 windows executed, 0 self-inflicted failures, job duration stable at a ~6.5s median. Provider data behaviour: 1 HTTP 400, 1 asset removed from the feed, 15 windows of stale upstream data. The two categories do not overlap.

---

## Phase 3 — Market-data usefulness

Per-asset descriptive statistics for minimum listing price, median listing price, listing quantity, published 24h sales and market/history state are in [asset-detail.csv](asset-detail.csv) — first, last, minimum, maximum, absolute change, percentage change, transitions, percentage of adjacent observations changed, and distinct observed states for all 100 assets.

Adjacent comparisons use **contiguous five-minute steps only**; the observation gaps from the two upstream events are never compared across.

### Transition rates across 201,035 adjacent comparisons

| Field | Transitions | Share of comparisons | Assets with ≥1 transition |
| --- | --- | --- | --- |
| Listing quantity | 6,145 | 3.057% | 91 |
| Minimum listing price | 3,747 | 1.864% | 94 |
| Median listing price | 2,918 | 1.452% | 95 |
| History state (all 20 sales fields) | 980 | 0.487% | 94 |
| Published 24h sales volume | 468 | 0.233% | 89 |

**Listing quantity is the most active observed field — it changes 1.6× as often as minimum price.** This is the single clearest answer to what a price-only tracker misses.

All 100 assets changed in at least one recorded market field over the seven days.

### Direction over the full observed period

| Field | Up | Down | Unchanged |
| --- | --- | --- | --- |
| Minimum listing price | 27 | 65 | 8 |
| Listing quantity | 30 | 55 | 15 |

Endpoint comparison hides intermediate movement; the transition counts above are the better activity measure.

### Assets exhibiting meaningful change

"Any change" means at least one transition. "Material" applies a stated threshold.

| Field | Any change | Material change |
| --- | --- | --- |
| Minimum price | 94 | 84 (first→last move ≥0.5%) |
| Median price | 95 | 75 (first→last move ≥0.5%) |
| Listing quantity | 91 | 85 (≥1 listing), 36 (≥5%) |
| Published 24h sales | 89 | 71 (first ≠ last) |
| History state | 94 | 94 (≥2 distinct states) |
| Any market field | 100 | — |

### Cross-asset distributions

| Measure | p05 | p25 | Median | p75 | p95 | Min | Max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Period return (%) | −13.82 | −4.02 | **−0.87** | +0.27 | +10.44 | −24.87 | +67.18 |
| Listing change over period (%) | −18.12 | −4.43 | **−0.40** | +1.04 | +16.72 | −60.58 | +50.00 |
| Observed price range (%) | 0.00 | 9.54 | **16.72** | 25.02 | 73.60 | 0.00 | 160.00 |
| Realized volatility, daily-scaled (%) | 0.00 | 3.92 | **8.86** | 16.56 | 45.53 | 0.00 | 68.01 |
| Listing activity (% adjacent changed) | 0.00 | 0.35 | **1.47** | 3.66 | 11.34 | 0.00 | 26.93 |
| Price activity (% adjacent changed) | 0.00 | 0.55 | **1.27** | 2.50 | 5.87 | 0.00 | 15.20 |
| Distinct history states | 1 | 10 | **12** | 13 | 13 | 1 | 13 |

The median asset drifted slightly down in both price and listings over the week.

### Published sales history is a daily series, not a five-minute one

This is the most important cadence finding in Phase 3, and it constrains the product.

- 468 published-24h-sales changes across 89 assets in seven days.
- **Median gap between changes for an asset: 1,450 minutes ≈ 24.2 hours** (p05 1,365 min, p95 2,895 min, max 7,250 min).
- Median 4 distinct published values per asset over the whole week (range 1–8).
- The complete history payload changed **13 times in 2,016 windows**, clustering near 00:00–01:00 and 04:00–05:00 UTC, i.e. roughly twice daily.
- History state per asset: median 12 distinct states and 11 transitions over seven days — median gap 1,200 minutes.

**Repeated published rolling-sales values are the same provider snapshot re-observed. They must never be summed across snapshots or treated as independent transactions.** Sampling this field 288 times a day yields roughly one genuine update per day.

---

## Phase 4 — Derived market features

Availability: 1h, 6h and 24h returns and listing changes are computable for **all 100 assets**; the seven-day observed-period figures likewise.

### Price

| Feature | Status | Notes |
| --- | --- | --- |
| 1h / 6h / 24h return | **DERIVED — available** | Minimum and median listing price bases both available for all 100 assets |
| 7d observed-period return | **DERIVED — available** | Median −0.87%, range −24.87% to +67.18% |
| Realized volatility | **DERIVED — use with a caveat** | Std. dev. of five-minute log returns; non-zero for 94 assets |
| Observed range | **DERIVED — available** | Median 16.72% |
| Position within observed range | **DERIVED — available** | Seven days is a short reference range; it will shift materially with more history |

**Volatility caveat — price granularity.** The volatility ranking is dominated by cheap assets: **7 of the 10 highest-volatility assets trade under USD 2**, though only 22 of 100 assets do. On a USD 0.20 case, the minimum one-cent tick is a 5% move. Dreams & Nightmares Case (USD 1.13) shows 68.0% daily-scaled volatility with 306 price transitions; Kilowatt Case (USD 0.20) shows 65.3% on just 35 transitions. Realized volatility on minimum price is **EXPERIMENTAL** until it is controlled for price level or computed on median price.

**Minimum price is noisy by construction.** It tracks the single cheapest listing, so it jumps whenever that one listing is taken or undercut. Median listing price is the steadier read on the book — `AK-47 | Crane Flight (Field-Tested)` moved its median from 17.93 to 23.34 almost monotonically while its minimum price oscillated between 11.54 and 17.83.

### Listing supply

| Feature | Status | Notes |
| --- | --- | --- |
| 1h / 6h / 24h / 7d listing change | **DERIVED — available** | All 100 assets |
| Contraction frequency | **DERIVED — available** | Median 0.82% of five-minute steps; max 15.45% |
| Expansion frequency | **DERIVED — available** | Median 0.65% of steps; max 11.48% |
| Listing volatility | **DERIVED — available** | Std. dev. of five-minute relative quantity change |

Contractions outnumber expansions in the median asset, matching the 55-down / 30-up endpoint split. **Listing counts are Skinport venue listings, not global circulating supply**, and the 100 assets are a selected sample rather than an unbiased index.

### Activity

| Feature | Status | Notes |
| --- | --- | --- |
| Published 24h sales changes | **DERIVED — daily cadence only** | ~1 genuine update per asset per day |
| History-state transitions | **DERIVED — daily cadence only** | Median 11 transitions in 7 days |
| Freshness / availability | **OBSERVED — available** | Every row carries observation and provider timestamps |
| Per-trade or intraday volume | **UNAVAILABLE** | The provider publishes rolling aggregates, not a trade feed |

**Limitations of the activity signal.** Published 24h sales is a rolling aggregate refreshed about once a day. It cannot support intraday "most traded" rankings, cannot be differenced at five-minute resolution to infer trades, and cannot be summed. Its legitimate use is as a slow daily context series — "roughly how liquid is this asset" — not as an activity feed. No intraday transaction-level data exists in this dataset.

---

## Phase 5 — Price × listing-supply structure

These are **market states**. They are not labelled bullish, bearish, buy, sell, alpha or signal, and the evidence below does not support such labels.

Classification compares the price return and the listing change over the same trailing horizon. Samples overlap heavily and are strongly serially correlated.

### State frequencies

| Horizon | State | Count | Share | Assets | Persistence |
| --- | --- | --- | --- | --- | --- |
| **1h** | PRICE FLAT + LISTINGS FLAT | 144,979 | 72.51% | 100 | 81.0% |
| | PRICE FLAT + LISTINGS MOVED | 23,203 | 11.61% | 88 | 28.1% |
| | PRICE MOVED + LISTINGS FLAT | 11,715 | 5.86% | 92 | 9.3% |
| | **PRICE UP + LISTINGS DOWN** | **10,405** | **5.20%** | 81 | 7.9% |
| | **PRICE DOWN + LISTINGS UP** | **6,401** | **3.20%** | 74 | 4.8% |
| | **PRICE DOWN + LISTINGS DOWN** | **2,217** | **1.11%** | 48 | 3.5% |
| | **PRICE UP + LISTINGS UP** | **1,016** | **0.51%** | 38 | 2.8% |
| **6h** | PRICE UP + LISTINGS DOWN | 25,181 | 12.98% | 81 | 14.1% |
| | PRICE DOWN + LISTINGS UP | 18,824 | 9.71% | 75 | 11.3% |
| | PRICE DOWN + LISTINGS DOWN | 11,127 | 5.74% | 63 | 6.2% |
| | PRICE UP + LISTINGS UP | 5,518 | 2.85% | 56 | 7.4% |
| **24h** | PRICE UP + LISTINGS DOWN | 34,090 | 19.77% | 80 | 19.9% |
| | PRICE DOWN + LISTINGS UP | 31,339 | 18.17% | 73 | 23.2% |
| | PRICE DOWN + LISTINGS DOWN | 23,004 | 13.34% | 73 | 15.5% |
| | PRICE UP + LISTINGS UP | 10,809 | 6.27% | 57 | 8.0% |

Full detail including forward-return distributions: [price-listing-states.csv](price-listing-states.csv).

### The headline structure

Among the four two-sided states, **opposing moves dominate**: at 1h they account for 16,806 of 20,039 periods (**83.9%**), at 6h 44,005 of 60,650 (**72.6%**), at 24h 65,429 of 99,242 (**65.9%**). The contemporaneous relationship is consistently negative and broadly distributed across the universe:

| Horizon | Pooled Pearson | Pooled Spearman | Assets with negative r | Assets with positive r |
| --- | --- | --- | --- | --- |
| 1h | −0.209 | −0.384 | 79 | 6 |
| 6h | −0.256 | −0.346 | 75 | 10 |
| 24h | −0.259 | −0.338 | 72 | 13 |

### How much of this is mechanical

This question decides whether the structure is worth shipping as intelligence. Three tests were run.

**Test 1 — five-minute microstructure.** Of 201,035 five-minute steps, price moved in 3,747 and listing quantity in 6,145; both moved in 2,253. Of those 2,253, **2,139 (94.9%) moved in opposite directions and only 114 (5.1%) in the same direction**. The conditional distributions are decisive:

| When minimum price **rose** (1,654 steps) | When minimum price **fell** (2,093 steps) |
| --- | --- |
| Quantity fell: 1,446 (87.4%) — **−1 exactly in 941** | Quantity rose: 693 (33.1%) — **+1 exactly in 428** |
| Quantity unchanged: 179 (10.8%) | Quantity unchanged: 1,315 (62.8%) |
| Quantity rose: 29 (1.8%) | Quantity fell: 85 (4.1%) |

This is the order book's own arithmetic. The cheapest listing being taken or withdrawn removes one listing and raises the minimum; a new cheaper listing arriving adds one and lowers it. **At five-minute resolution the inverse relationship is largely a mechanical identity, not two independent measurements.**

**Test 2 — does it survive removing the mechanism?** Restricting to horizons where listing count moved by **more than one unit**, and using **median** listing price (which is not the cheapest listing), the negative relationship **strengthens rather than disappears**:

| Basis | 1h Spearman | 6h Spearman | 24h Spearman | Per-asset median r (24h) |
| --- | --- | --- | --- | --- |
| Min price, all moves | −0.384 | −0.346 | −0.338 | −0.344 |
| Median price, all moves | −0.468 | −0.479 | −0.510 | −0.560 |
| Min price, moves >1 listing | −0.446 | −0.383 | −0.377 | −0.362 |
| **Median price, moves >1 listing** | **−0.590** | **−0.612** | **−0.589** | **−0.575** |

So the structure is **not only** the cheapest-listing identity: broad supply expansion coincides with a lower median listing price across the whole book, and contraction with a higher one, consistently across 49–62 of the assets with enough data. This is a genuine, repeatedly observed property of these markets — but it remains **contemporaneous and partly compositional**: adding cheap listings both raises the count and lowers the median within the same snapshot. It describes what the book looks like right now. It does not forecast.

**Test 3 — are state-conditional forward returns informative?** The forward-return column looks striking: after PRICE UP + LISTINGS DOWN at 24h, the mean next-24h return is **−1.81%**; after PRICE DOWN + LISTINGS DOWN it is **+2.20%**. This is **not** listing information. Conditioning on the price move alone, ignoring listings entirely, reproduces it:

| Horizon | After price down (ignoring listings) | After price up (ignoring listings) | Past vs. forward correlation |
| --- | --- | --- | --- |
| 1h | +1.13% mean | −0.68% mean | −0.52 (down) / −0.11 (up) |
| 6h | +1.11% mean | −1.04% mean | −0.51 / −0.18 |
| 24h | +0.90% mean | −1.59% mean | −0.54 / −0.17 |

This is minimum-price bounce: the cheapest listing is taken, the minimum jumps to the next one up, a new cheap listing arrives and it falls back. **Every forward-return median in the 1h and 6h state tables is exactly 0.00%** — the means are entirely tail-driven. The apparent state-conditional edge is a restatement of mechanical price reversal and carries no evidence of listing-supply predictive content.

---

## Phase 6 — Lead/lag exploration

Tested across the whole 100-asset universe, not on selected examples. Both overlapping samples (every window) and non-overlapping samples (one per horizon block) are reported; overlapping samples are serially correlated and their confidence intervals are not valid. Full output: [lead-lag.csv](lead-lag.csv).

### Listing change(t) → price return(t + h)

| Horizon | Sampling | n | Pearson | Spearman | 95% CI (if independent) | Assets + / − | Per-asset median r |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1h | overlapping | 198,637 | +0.025 | +0.043 | [+0.021, +0.030] | 64 / 21 | +0.015 |
| 1h | non-overlapping | 16,578 | +0.022 | +0.030 | [+0.007, +0.038] | 51 / 33 | +0.007 |
| 6h | overlapping | 186,637 | +0.035 | +0.044 | [+0.031, +0.040] | 56 / 29 | +0.043 |
| 6h | non-overlapping | 2,597 | +0.033 | +0.048 | [−0.006, +0.071] | 50 / 34 | +0.030 |
| 24h | overlapping | 143,635 | −0.003 | +0.058 | [−0.008, +0.002] | 61 / 24 | +0.180 |
| 24h | non-overlapping | **500** | +0.005 | −0.014 | [−0.083, +0.093] | 47 / 36 | +0.139 |

### Price return(t) → listing change(t + h)

| Horizon | Sampling | n | Pearson | Spearman | 95% CI (if independent) | Assets + / − | Per-asset median r |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1h | overlapping | 198,637 | +0.028 | +0.046 | [+0.023, +0.032] | 72 / 13 | +0.045 |
| 1h | non-overlapping | 16,578 | +0.026 | +0.039 | [+0.010, +0.041] | 57 / 27 | +0.014 |
| 6h | overlapping | 186,637 | +0.047 | +0.041 | [+0.043, +0.052] | 60 / 25 | +0.047 |
| 6h | non-overlapping | 2,597 | +0.018 | +0.004 | [−0.020, +0.056] | 48 / 36 | +0.009 |
| 24h | overlapping | 143,635 | +0.034 | +0.054 | [+0.029, +0.039] | 54 / 30 | +0.089 |
| 24h | non-overlapping | **500** | +0.034 | −0.034 | [−0.054, +0.122] | 46 / 37 | +0.080 |

### Reading

Every pooled correlation in both directions is **between −0.01 and +0.05** — smaller than the contemporaneous correlations by roughly a factor of ten. The sign flips between Pearson and Spearman at 24h in both directions, which is what noise looks like. Non-overlapping confidence intervals straddle zero at 6h and 24h in both directions.

The per-asset medians at 24h (+0.180, +0.089) look larger, and they are an artefact of sample size: the non-overlapping 24h test yields **500 pairs across 100 assets — five per asset**. A correlation from five points is noise, so the "76 assets with |r| > 0.10" figure at that horizon carries no information. Sign consistency is likewise unimpressive: at the best-sampled non-overlapping horizon (1h, 166 samples per asset) the split is 51 positive to 33 negative, close to chance.

**Confounders.** (a) Overlapping windows inflate apparent significance and are the reason the overlapping CIs exclude zero while non-overlapping ones do not. (b) Both variables are computed from the same order-book snapshots, so the contemporaneous mechanical link partly leaks across adjacent horizons. (c) Minimum-price bounce (Phase 5, Test 3) creates strong negative autocorrelation in the price series that any forward-return test must be read against. (d) Market-wide common movement is uncontrolled — no market factor was removed. (e) Seven days spans only 7 independent 24h observations per asset.

### DESCRIPTIVE RELATIONSHIP vs. PREDICTIVE EVIDENCE

**DESCRIPTIVE — established.** Price and listing supply move inversely, at the same time, consistently across 72–79 of 100 assets, and the relationship strengthens on median price and multi-unit supply moves. This is a robust, repeatedly observed property of the dataset.

**PREDICTIVE — not established, in either direction.** Neither listing change leading price nor price leading listing change shows a relationship distinguishable from zero across the universe. Seven days is not sufficient evidence of predictive alpha, and this dataset does not provide it.

**Worth studying for 30 days?** Yes — but as a **descriptive** research question, and specifically the one that survived the confounder tests: does the median-price-versus-multi-unit-supply relationship persist, and does it vary systematically by asset class, price level or liquidity? Thirty days would also give roughly 30 independent 24h observations per asset instead of 7, which is the minimum for any honest forward-looking test. Nothing here justifies building a predictive feature.

---

## Phase 7 — Case studies

Selected for analytically interesting structure, not for dramatic percentages. Supporting data for all 100 assets: [case-candidates.csv](case-candidates.csv).

### 1. `AK-47 | Crane Flight (Field-Tested)` — sustained supply drawdown with a clean price trend

Listings **104 → 41 (−60.6%)**, the largest contraction in the universe. Median listing price **17.93 → 23.34 (+30.2%)**, rising almost monotonically over seven days. Minimum price 13.20 → 17.31 but oscillating violently between 11.54 and 17.83. Published 24h sales held steady at 17–27 throughout. 198 listing transitions, 6h Spearman between quantity and median price **−0.78**.

**Why it matters:** this is the clearest demonstration of what a price-only tracker cannot show. A minimum-price chart alone reads as noise around USD 13–17. The listing series shows a book steadily draining while ordinary sales continued, and the median price shows the whole book repricing upward. The two series together tell a coherent story that neither tells alone. It is also the best argument for putting **median** listing price in front of users rather than minimum.

### 2. `Souvenir AWP | Dragon Lore (Factory New)` — supply reaching zero

Exactly **one listing for all 1,750 observations**, 10 distinct minimum prices, final observed price **USD 12,747.52** (down from 14,163.91). At 2026-09-15T19:50:00Z the asset left the Skinport feed entirely and had not returned by the cutoff, producing 265 partial windows.

**Why it matters:** a price-only tracker would keep displaying "USD 12,747.52" indefinitely with no indication that the market has no supply at all. The listing-count series distinguishes *the last price* from *a price you can act on* — arguably the highest-value distinction in the entire dataset. It also shows that a coverage warning and a market event can be the same thing, which has a direct product consequence: an asset disappearing from the feed must be surfaced to users, not merely logged as a collector anomaly.

### 3. `Sticker | Crown (Foil)` — the mirror case

Listings **15 → 22 (+46.7%)**, minimum price **505.01 → 379.40 (−24.9%)**, median price −25.8%, 6h Spearman **−0.82**. Only 13 listing transitions across the week, so this is not churn — it is a small number of decisive supply additions into a falling price.

**Why it matters:** it is the clean inverse of case 1 in a thin, high-value market, and the low transition count rules out the mechanical five-minute churn explanation. With 13 supply events moving a USD 400–500 asset by a quarter of its value, the relationship here is visible at a human scale.

### 4. `Operation Breakout Weapon Case` — high listing activity, stable price

**253 listing transitions — 12.57% of adjacent comparisons, the highest of any asset whose price moved less than 2%** — on 36,015 → 37,141 listings, while the price moved −1.84% with an 18.45% observed range.

**Why it matters:** enormous supply turnover with essentially no price consequence. It is the counterexample to any naive reading of the Phase 5 inverse relationship, and it defines what "liquid and stable" looks like in the data. `Spectrum 2 Case` (228 transitions, −0.37%) and `Desert Eagle | Printstream (Field-Tested)` (232 transitions, +0.35%) behave the same way.

### 5. `AUG | Contractor (Field-Tested)` and `AUG | Storm (Field-Tested)` — genuinely quiet markets

**Zero minimum-price transitions in 2,015 observations.** Price fixed at USD 0.02, roughly 7,800 listings, 44 and 38 listing transitions respectively, 2–3 published-sales updates.

**Why it matters:** these assets sit at the price floor, where a one-cent tick is 50% of the value, so price cannot move meaningfully at all. Every derived price feature is degenerate here. They are the case for excluding floor-priced assets from price-based rankings — and they show that "no change" is itself a directly observed fact rather than missing data. Notably **no asset was quiet in both price and listings**: 6 assets had zero price transitions and 9 had zero listing transitions, with no overlap.

### 6. `Dreams & Nightmares Case` — volatility that is really granularity

Highest daily-scaled realized volatility in the universe at **68.0%**, on a USD 1.13 asset, with 306 price transitions and 542 listing transitions, yet a period return of only −3.42% and a 52.4% observed range.

**Why it matters:** it is the concrete demonstration of the volatility caveat. The asset is highly active, but a large share of its measured volatility is one-cent ticks on a one-dollar price. Shipping a "High Volatility" ranking without a price-level control would put this and three other sub-USD-1 cases at the top of the list, and users would reasonably read that as a market claim rather than a rounding artefact.

### 7. `Glock-18 | Sand Dune (Field-Tested)` — why thin markets need a warning label

**+67.2% period return**, the largest in the universe, on a market with **4 listings falling to 3**, driven by **6 price transitions and 1 listing transition** across the entire week.

**Why it matters:** it would top any "Price Up" ranking while representing almost no market activity. A screener that surfaces it without showing listing depth is actively misleading. The listing-count series is precisely what lets the product qualify or suppress this result — another capability price-only trackers lack.

---

## Phase 8 — Screener feasibility

Full matrix with evidence: [screener-feasibility.csv](screener-feasibility.csv).

| Preset | Classification | Basis |
| --- | --- | --- |
| Most Active | **SUPPORTED NOW** | 6,145 listing and 3,747 price transitions observed; 91 and 94 assets respectively |
| Price Movers | **SUPPORTED NOW** | 1h/6h/24h/7d returns for all 100 assets; rank on median price as well as minimum |
| Price Up | **SUPPORTED NOW** | 27 assets up over the period; horizon-level counts for every asset |
| Price Down | **SUPPORTED NOW** | 65 assets down over the period |
| Listings Contracting | **SUPPORTED NOW** | Direct observation; 55 assets ended lower |
| Listings Expanding | **SUPPORTED NOW** | Direct observation; 30 assets ended higher |
| Quiet Markets | **SUPPORTED NOW** | 6 assets with zero price transitions, 9 with zero listing transitions |
| Fresh Changes | **SUPPORTED NOW** | Median observation age 302.99s, p95 311.82s — label as observation age, never real-time |
| Price rising + listings contracting | **SUPPORTED NOW** (descriptive only) | 5.20% / 12.98% / 19.77% of 1h / 6h / 24h periods, 80–81 assets |
| Price falling + listings expanding | **SUPPORTED NOW** (descriptive only) | 3.20% / 9.71% / 18.17% of periods, 73–75 assets |
| High Volatility | **EXPERIMENTAL** | Computable for all 100, non-zero for 94, but 7 of the top 10 are sub-USD-2 granularity artefacts |
| Price stable + listings contracting | **EXPERIMENTAL** | Needs a stated price-stability tolerance; exact equality puts it inside the 11.61% sub-tick churn bucket |
| High volatility + high listing activity | **EXPERIMENTAL** | Inherits the volatility bias; the two rankings also correlate through market size |
| Published sales / "most traded" | **NOT YET SUPPORTED** | Provider refreshes rolling 24h sales ~daily (median 1,450 min between changes); snapshots are not transactions |
| Lead/lag or predictive screens | **NOT YET SUPPORTED** | Pooled correlations +0.025 / +0.035 / −0.003; no predictive content established |

Two product rules follow directly from the evidence. First, the two supported combined filters must ship as **descriptive state filters** with the mechanical explanation visible to the user — they describe the current shape of the order book, and Phase 5 Test 3 shows their forward-return profile is price bounce, not information. Second, any price-based ranking should display **listing depth alongside the price move**, because the largest percentage movers in this dataset are the thinnest markets (case 7).

---

## Phase 9 — Storage and scale

### Measured (100 assets, seven days)

| Measure | Value |
| --- | --- |
| Whole database | 373.78 MB |
| Observation relation (table + TOAST + indexes) | 363.09 MB |
| Observation table + TOAST | 316.23 MB |
| Observation indexes | 46.86 MB |
| `collector_runs` | 2.41 MB |
| Observations stored (all time) | 202,034 |
| **Bytes per observation, including indexes** | **1,884** |
| Bytes per observation, heap only | 1,641 |
| **Measured observation growth** | **51.80 MB/day** |
| Measured whole-database growth | 52.19 MB/day |

Growth is measured against the recorded experiment-start baseline of 0.46 MB at 205 rows, over exactly seven days. Indexes are 12.9% of the observation relation, and `observations_asset_source_time` alone is 20.05 MB.

### Projected (unchanged cadence, payload size and schema)

| Universe | Kind | Rows/day | Observations/day | 30 days | 365 days |
| --- | --- | --- | --- | --- | --- |
| 100 | **MEASURED** | 28,800 | **51.76 MB** | 1.52 GB | 18.45 GB |
| 1,000 | PROJECTED | 288,000 | 517.58 MB | 15.16 GB | 184.49 GB |
| 10,000 | PROJECTED | 2,880,000 | 5,175.80 MB | 151.63 GB | 1,844.89 GB |

Projections scale the measured 1,884 bytes/observation linearly. They assume the current five-minute cadence, full coverage, comparable payload sizes and no compression, rollup or retention change. **They exclude** other tables, provider costs, backups and restore history, transfer, and any index changes. Larger universes have not been load-tested and are not authorised by this report. Machine-readable: [storage-projection.csv](storage-projection.csv).

At the measured rate, **10,000 assets would exceed a 100 GB budget in about twenty days.** The dominant cost is the raw JSON payloads: 1,641 of 1,884 bytes per row are heap, and the schema stores the full `raw_item_payload` and `raw_history_payload` on every observation.

### Recommended post-experiment architecture

Nothing below has been implemented. Retention and storage are unchanged, as instructed.

- **Raw retention.** Keep full raw payloads for a bounded recent window (7–30 days) rather than indefinitely. This is the single largest lever: raw payloads dominate the 1,641 heap bytes per row, and they are needed for provenance and replay, not for serving.
- **Rollups.** Materialise hourly and daily per-asset aggregates (open/high/low/close on minimum and median price, first/last/min/max listing quantity, transition counts, freshness). Every Phase 3–5 measure in this report is computable from such a rollup, at roughly 1/12 and 1/288 of the rows.
- **Downsampling.** After the raw window expires, keep five-minute resolution only for fields that actually change at that resolution — minimum price, median price, listing quantity. The 20 published-sales fields update about once a day and are stored 288 times a day; downsampling them to daily is nearly lossless and removes a large share of each row.
- **Partitioning.** Range-partition `market_observations` by month (or by week at 1,000+ assets). This makes expiry a partition drop instead of a delete-and-vacuum, and keeps per-asset index sizes bounded.
- **Compression.** Evaluate column-level compression on the JSON payloads and, if the platform supports it, compressed columnar storage on older partitions. Measure before committing — the current payloads are already TOAST-compressible and TOAST usage is near zero, which suggests they are being compressed inline.
- **Archival.** Export expired raw partitions to object storage as compressed Parquet or NDJSON before dropping them, preserving full replay capability at a fraction of database cost.
- **Sequencing.** Partitioning and rollups first (they are prerequisites for safe expiry), then raw retention limits, then archival. None of this should change while the current experiment continues, so that the 7-day and 30-day datasets stay comparable.

---

## Phase 10 — 30-day decision

**1. Did the seven-day experiment prove reliable collection?**
Yes, for the collector. 2,016 of 2,016 scheduled windows executed with zero missing, duplicate or off-grid windows, zero counter discrepancies, zero invalid values and zero timestamp anomalies. Job duration was stable at a 6.53s median. The only two incomplete-data events were upstream, were recorded faithfully, and did not corrupt anything. Coverage was 99.819%.

**2. Is the dataset useful enough for descriptive market intelligence?**
Yes. All 100 assets changed in at least one recorded field; 1h/6h/24h/7d price and listing features are available for all 100; and the listing-supply series is more active than price (6,145 versus 3,747 transitions), which is precisely the dimension price-only trackers lack.

**3. Which derived features are already defensible?**
Price returns at 1h/6h/24h/7d on both minimum and median listing price; observed range and position within it; listing-quantity change at all horizons; contraction and expansion frequency; listing volatility; transition counts and activity rates; observation freshness; and the four descriptive price × listing states.

**4. Which features require substantially more history?**
Realized volatility needs a price-level control before it can be ranked. Position-within-range needs a reference period longer than seven days to be meaningful. Any trend, seasonality, weekday or event-window analysis needs 30 days minimum. Anything forward-looking needs far more than 30 days — the non-overlapping 24h test currently yields five samples per asset.

**5. Is listing supply providing information beyond price alone?**
Yes, descriptively — and this is the report's central finding. Listing quantity changes 1.6× as often as price; it distinguishes a thin market from a liquid one (case 7); it distinguishes a last price from an actionable price when supply reaches zero (case 2); it identifies sustained book drawdowns that minimum-price charts render as noise (case 1); and the median-price-versus-multi-unit-supply relationship (Spearman −0.59 to −0.61) survives the mechanical confounder tests. It is **not** providing predictive information about future price.

**6. Does any lead/lag relationship deserve further investigation?**
No relationship currently merits investment. Every pooled correlation in both directions lies between −0.01 and +0.05, signs flip between Pearson and Spearman, and non-overlapping intervals straddle zero. What deserves a 30-day look is the **descriptive** question — whether the median-price/supply structure persists and varies by asset class, price level and liquidity — plus enough independent 24h observations to make any future forward-looking test honest.

**7. Is published sales/history data useful, and at what cadence?**
Useful, at **daily** cadence only. The provider refreshes rolling 24h sales roughly once per asset per day (median 1,450 minutes between changes; 468 changes across 89 assets in seven days) and the full payload changes about twice daily. It is a legitimate slow liquidity-context series. It cannot support intraday activity rankings, cannot be differenced at five-minute resolution, and must never be summed across snapshots. Collecting it 288 times a day to capture ~1 update is also a clear storage inefficiency.

**8. Should the same 100-asset experiment continue to 30 days?**
Yes — unchanged in universe and cadence, so the 7-day and 30-day datasets stay comparable — **conditional on resolving storage capacity first**. At 51.80 MB/day, another 23 days adds roughly 1.16 GB.

**9. Should the universe remain at 100 assets or expand now?**
Remain at 100. Expanding now would break comparability with the seven-day baseline, multiply storage before the architecture work is done, and add nothing the current sample does not already answer — the descriptive findings are consistent across 72–94 of the existing assets, so the limiting factor is history length, not universe width. Expand after 30 days, after partitioning and rollups are in place, and after the provider-side behaviour observed on 09-15 and 09-16 is understood.

**10. What storage architecture needs to change before scaling?**
In order: range-partition `market_observations` by month; add hourly and daily rollups sufficient to serve every screener preset; downsample the 20 published-sales fields to daily, since they update daily but are stored 288 times a day; bound raw-payload retention to a recent window; then archive expired partitions to object storage before dropping them. At the measured 1,884 bytes/observation, 1,000 assets costs 15.16 GB per 30 days and 10,000 assets costs 151.63 GB — neither is viable on the current raw-everything-forever design.

---

## What FloatAlpha can extract that price-only CS2 trackers do not expose

1. **Whether a price is actionable.** Listing count distinguishes a real market from one listing or none. `Souvenir AWP | Dragon Lore (Factory New)` shows a USD 12,747.52 price with zero available supply — a price-only tracker cannot represent that state.
2. **Whether a price move is a market or an accident.** The largest gainer in the universe (+67.2%) has four listings and one listing change in seven days. Depth alongside the move is the qualifier.
3. **Whether the whole book is repricing or just the cheapest listing.** Median listing price plus listing count separates a genuine trend (`AK-47 | Crane Flight`: median +30.2%, supply −60.6%) from minimum-price bounce, which Phase 5 Test 3 shows dominates naive price-change statistics.
4. **Supply direction as an observed series.** Contraction and expansion frequency, listing volatility and multi-horizon supply change — none of which exist in a price-only feed.
5. **Activity where price is flat.** 11.61% of 1h periods show listings moving with price unchanged, spanning 88 assets. `Operation Breakout Weapon Case` turned over 253 listing changes for a −1.84% move.
6. **Silence as a measured fact.** Six assets recorded zero price transitions across 2,015 observations. Observed stability is data, not absence of data.
7. **Provenance and age on every data point.** Observation and provider timestamps on all 201,235 rows, with a measured median age of 302.99s and every excursion identified by exact timestamp.

None of the above is a predictive claim. All of it is OBSERVED or DERIVED from the frozen dataset.

---

## Reproducibility, evidence and limits

| File | Contents |
| --- | --- |
| [extract.mjs](extract.mjs) | Read-only Phase 1–2 SQL over the fixed boundary |
| [series.mjs](series.mjs) | Read-only export of the frozen per-asset five-minute series |
| [analyze.py](analyze.py) | Phases 3–7 computation from the frozen series |
| [confounders.py](confounders.py) | Mechanical-confounder tests and cadence analysis |
| [cases.py](cases.py) | Case-study ranking and storage arithmetic |
| [render.py](render.py) | Deterministic CSV and summary generation |
| [data.json](data.json) | Complete Phase 1–2 query results |
| [series.csv.gz](series.csv.gz) | The frozen dataset: 201,235 rows |
| [analysis.json](analysis.json) | Per-asset, derived, state and lead/lag results |
| [confounders.json](confounders.json) | Confounder test output |
| [summary.json](summary.json) | Machine-readable report summary |
| [asset-detail.csv](asset-detail.csv) | All 100 assets, 54 measured columns |
| [daily-collection.csv](daily-collection.csv) | Per-day reliability and freshness |
| [reliability.csv](reliability.csv) | Phase 1–2 metrics with basis for each |
| [freshness-anomalies.csv](freshness-anomalies.csv) | All 15 freshness excursions with exact timestamps |
| [price-listing-states.csv](price-listing-states.csv) | State frequencies and forward-return distributions |
| [lead-lag.csv](lead-lag.csv) | All lead/lag results, both sampling schemes |
| [case-candidates.csv](case-candidates.csv) | Case-study selection inputs for all 100 assets |
| [screener-feasibility.csv](screener-feasibility.csv) | Phase 8 matrix with evidence |
| [storage-projection.csv](storage-projection.csv) | Measured and projected storage |
| [manifest.json](manifest.json) | SHA-256 of every evidence file |

**Method.** Extraction used a repeatable-read, read-only transaction with `default_transaction_read_only=on` and a statement timeout, over `2026-09-09T17:55:00Z ≤ window_start < 2026-09-16T17:55:00Z`. Only claimed (window-owning) runs contribute observations. The boundary was asserted in SQL to be exactly 2,016 windows and to be closed before the report ran. Phases 3–7 read only the frozen export, never the live database, so they are reproducible without database access. Total extraction time 5.6s; series export 6.9s.

**Limits.** Listing counts are Skinport venue listings, not global circulating supply. The 100 assets are a selected sample, not an unbiased CS2 index. A listing-price change is not an executed trade and not a realisable return. Published rolling sales are provider snapshots and are never treated as independent transactions. Overlapping horizon samples are serially correlated and their confidence intervals are reported as invalid. No market factor was removed, so cross-asset common movement is uncontrolled. Physical database sizes are not interchangeable with platform storage metering. Seven days is not sufficient evidence of predictive alpha, and none is claimed.

**Changes made.** None. No database rows, schemas, provider settings, cron schedules, environments, deployments or application source files were modified, and no collector endpoint was invoked. The collector continued operating normally throughout — six windows ran after the cutoff and are excluded from every experiment statistic.
