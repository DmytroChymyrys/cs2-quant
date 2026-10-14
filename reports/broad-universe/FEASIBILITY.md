# Broad Universe Access — Feasibility and Rollout Proposal

Research only. **No implementation, commit, push or deployment.** HEAD `9ee19c1`.
Production reads only. Figures taken 2026-10-14.

---

## Decision recorded

Market Pulse stays on the existing tracked Skinport sample. No broad Steam
pulse, no collector cadence change, no aggregate query added to page rendering.
This document covers only the broad-universe **list and detail** experience.

---

## 1. Are the ~24,400 assets reachable today? **No.**

All three product routes read the same source:

```
screener/page.tsx:46        readMarketDataset()
assets/page.tsx:33          readMarketDataset()
asset/[slug]/page.tsx:70    readMarketDataset()
```

`readMarketDataset()` is the **derived snapshot — 150 assets**. Nothing in the
Screener, the asset directory or an asset page can return anything else.

### The real blocker is identity, not volume

The product `assets` table holds **150 rows**. Every route keys off
`assets.id`, and `assetPath(name, id)` builds a slug from that UUID. A
broad-universe item exists in `provider_assets` but has **no FloatAlpha asset
id — therefore no slug, and no page to link to.**

Authentication today changes **depth, not universe**: a guest sees 10 rows of
150, a signed-in user sees all 150. There is no mechanism by which signing in
could reveal a 151st asset.

### One bridge already exists

`recognizeAsset()` (`recognition.ts:58`) already queries `provider_assets`
directly. When a search matches nothing in the tracked set, the Screener
already tells the reader the item is *seen but not analysed*. The broad
universe is therefore already acknowledged in the product — just not browsable.

## 2. What the data would support

Measured on production:

| | Assets |
|---|---|
| Priced on Skinport | **24,815** |
| Priced on Steam | **34,883** |
| **Priced on both** (cross-venue possible) | **24,408** |
| Trading velocity computable | **33,579** |
| Clearance estimate publishable (≥10 sales) | **21,518** |
| Steam bid present | **32,924** |

### Pagination and sorting — measured, 24,413-asset join

| Paginated query (`LIMIT 25`) | Time |
|---|---|
| Sort by price | **49 ms** |
| Sort by clearance | **61 ms** |
| Sort by **cross-venue divergence** | **1,300 ms** |

The slow case is not volume and not arithmetic. The query plan shows a sort key
spanning **two tables** forces a full hash join and full sort —
`Buffers: shared hit=111,199 read=9,323` — while a single-table key uses an
incremental sort and stops after 26 rows — `Buffers: shared hit=3,916`. A 30×
difference in pages touched.

**Consequence:** every sort except cross-venue divergence is already fast
enough. Divergence would need materialising into one table before it could be
a sortable column at this scale.

### Filtering and sorting coverage — the honest limit

Only **3 of the 10** current sort keys exist outside the tracked set:

| Available broad | Tracked-only (needs the 5-minute series) |
|---|---|
| price, listings | return, absReturn, listingChange |
| venueDelta\*, clearance | activity, volatility, freshness, coverage |

\* needs materialising, per above.

The same applies to filters: the numeric screen presets (volatility, activity,
contracting) have no inputs outside the 150. **A broad-universe screener is a
thinner instrument, not the same one with more rows** — and that is the central
product fact in this document.

## 3. Deployed vs. would-require-implementation

| Capability | Status |
|---|---|
| Broad data collected, stored, fresh | **deployed** — 24,815 / 34,883 rows, hourly + 5-minute |
| Cross-venue + liquidity logic that ignores `is_tracked` | **deployed** — `crossVenueFor` never mentions it, by design and by test |
| Search acknowledging untracked items | **deployed** — `recognizeAsset` |
| Broad assets reachable in Screener / `/assets` | **not built** |
| Broad asset detail pages | **not built — blocked on identity** |
| SQL-side pagination, sorting, filtering | **not built** — paging is in memory (`screener.ts:414`) |
| Materialised divergence for sorting | **not built** |

Nothing about the broad universe is *advertised* anywhere today, which is the
correct position until the above exists.

## 4. Recommended access model — no paid tier

Three tiers of **universe**, not of payment:

| | Guest | Signed in (free) |
|---|---|---|
| Analysed universe (150) | 10 rows, gated | **all 150, full depth** |
| Observed universe (~24,400) | not offered | **browsable, paginated** |
| Derived intelligence | preview | full, on the 150 |
| Cross-venue + liquidity | on the preview rows | on everything observed |

The honest framing is **analysed vs observed**, which is already true:

- **Analysed** — 150 assets, sampled every five minutes, carrying returns,
  volatility, activity, history and Market Pulse.
- **Observed** — ~24,400 assets with current prices from both venues plus
  liquidity, but no time series and therefore no derived metrics.

Signing in should unlock *breadth* (the observed universe) while the *depth*
stays where the data actually supports it. That is a real, defensible free-tier
benefit and needs no subscription.

**Market Pulse keeps its current scope and label in both states**, per the
decision above — tracked Skinport assets, one-hour minimum-listing-price
change, sampled every five minutes.

## 5. Rollout, if approved

Four gates, each independently shippable and each verifiable before the next.

**B1 — Identity for observed assets.** The blocker, and the only one with a
design choice: mint ids for `provider_assets` rows, or key observed routes on
the normalised market hash name. Recommend the latter — the normalisation is
already shared and test-pinned by the inventory matcher, and it avoids writing
24,000 rows into a table whose 150 rows currently mean "analysed".

**B2 — Observed list, SQL-paginated.** A separate read path against the
provider tables with `ORDER BY … LIMIT … OFFSET`. Reuses the existing
pagination contract; sorts limited to the four columns that exist. Measured at
~50–60 ms.

**B3 — Materialise divergence.** A stored value maintained on the existing
collector cadence, so it becomes a single-table sort key. Removes the 1,300 ms
case. No new provider calls.

**B4 — Observed asset detail.** Price, cross-venue and liquidity only, with the
absence of derived metrics stated rather than rendered as empty panels.

**Not in scope:** any caption claiming broad coverage. Per the decision, that
copy lands only when B2 and B4 are live.

## 6. Risks

1. **"More assets" reads as "better", and it is thinner.** The observed
   universe has no returns, volatility or history. If the UI does not make
   analysed-vs-observed obvious, signing in will feel like a downgrade in
   quality while being an upgrade in breadth.
2. **Identity choice is hard to reverse.** B1 decides URLs, which decide
   indexable surface. It interacts with the SEO freeze and wants its own gate.
3. **Clearance publishes for 21,518 of 34,883** observed assets — the
   suppression rules will be far more visible at this scale than on the 150.
4. **Cold-query cost on Neon.** All timings above are against a warm compute.
   Neon scales to zero, and the broad joins touch far more pages than the
   current derived read.
5. **The 150 keep every expensive property.** Nothing here reduces the derived
   pipeline cost; it adds a second, cheaper read path beside it.

---

**Recommendation: proceed to B1 as its own gate.** The data, the matching and
the indicator logic are already deployed and already universe-agnostic. Identity
is the only genuine blocker, and it is a design decision rather than a volume
problem.
