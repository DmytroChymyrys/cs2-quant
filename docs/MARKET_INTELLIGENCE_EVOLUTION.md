# FloatAlpha — Market Intelligence Product Evolution

Audit and strategy. **No product behaviour has been changed by this document.**
Findings come from reading the repository and production, not from assumption.

---

## 1. Executive summary

FloatAlpha already contains more of this strategy than the brief assumes. The
audit's main finding is that the *intelligence exists and is largely hidden*,
not that it is missing.

Specifically, already built and working:

- **An evidence-safe explanation engine.** `explain(asset, screen)` produces
  qualified lines — "Min changed −4.31% over 24h", "Venue listing quantity
  decreased 21.60%" — and `screenAssets` already computes it **for every row**,
  not just the inspected one. Section 6 of the brief asks for something that
  exists; it is simply not rendered outside the inspection panel.
- **Divergence presets.** `risingContracting` and `fallingExpanding` are exactly
  the "price appreciation coincided with listing contraction" concept, already
  named non-causally in code.
- **Watchlist is not a bookmark list.** It runs the same `screenAssets` +
  `IntelligenceTable` as the Screener, filtered to watched ids.
- **Portfolio computes P&L.** `portfolio_holdings` stores `quantity` and
  `unit_cost`; `valueHolding()` returns `{ value, cost, pnl }`.
- **Alert infrastructure exists** end to end: `alert_rules`, `alert_events`,
  `/api/product/alerts`, `evaluateAlerts()`, and a false-to-true transition
  model with re-arm semantics.
- **A "since last visit" primitive exists**: `watchlist_entries.checkpoint_observation_id`.

Genuinely missing, and worth building:

- **Market Pulse.** The Terminal's metric grid measures *coverage* — "Tracked
  assets", "Price returns available", "Full coverage", "Volatility available".
  These answer "how much data do we have", not "what is the market doing".
  Every input needed for breadth already sits on `MarketAssetSummary`.
- **CS2-native screener dimensions.** `MarketIdentity` carries `weapon`,
  `exterior` and `variant` (StatTrak™/Souvenir) and the Screener filters on
  `category` only.
- **Related assets.** No implementation of any kind.
- **Row-level "why did this surface".** Computed, discarded at render.

The smallest coherent Phase 1 is therefore **presentation of existing
computation**, requiring no schema change, no API change, no collection change
and no new derived pipeline. See §16.

---

## 2. Current FloatAlpha product model

Verified against the repository.

**Public surfaces:** `/` (landing), `/terminal`, `/assets`, `/screener`,
`/cs2-skins`, `/cs2-skins/{category}`, `/asset/{slug}`, `/pricing`.
**Private surfaces (noindex):** `/watchlist`, `/portfolio`, `/alerts`,
`/settings`, `/onboarding`, auth routes, `/ops-c8e4`.

**One derivation path.** `readMarketDataset()` reads an activated snapshot from
the derived database and returns `MarketAssetSummary[]`. Terminal, Assets,
Screener, Watchlist and Asset Intelligence all consume that one function.
`screenAssets(assets, screen)` is the single filter/sort/paginate engine behind
four of those pages.

**The contract** (`MarketAssetSummary`) carries per asset: `minimum`, `median`,
`listings`, `returns` and `medianReturns` per horizon, `listingDelta` /
`listingPct` per horizon, `activity`, `activity24h`, `volatility` and
`medianVolatility` per horizon, `volatilitySamples`, `changed5m`, `quality`
(coverage, observation counts, `observedAt`, state), `history`, `availability`,
`identity` and `artwork`.

**Evidence model in place:** `evidence` is `DATABASE | SYNTHETIC | UNAVAILABLE`;
availability is `ACTIVE | NO_ACTIVE_LISTING_OBSERVED | PROVIDER_OR_COVERAGE_UNKNOWN`;
coverage state is `FULL_COVERAGE | PARTIAL_COVERAGE | STALE_SOURCE | UNAVAILABLE`.
Horizons are `1h | 6h | 24h`, with `7d` accepted as a presentation window.

**Production scope:** 100 assets, five-minute cadence, `V3_FIVE_MINUTE`,
`listing-features-v3`. Unchanged.

---

## 3. Lessons adopted

- **Answer the question above the fold.** Mature tools lead with market state.
  FloatAlpha leads with data-inventory counts. Adopt the posture, not the
  layout.
- **Discovery needs the domain's own vocabulary.** Users think "AWP",
  "Factory New", "StatTrak", not only "rifles". Our identity data supports
  this today.
- **Surfacing needs a reason.** A row that appears without saying why reads as
  arbitrary. Our `explain()` already produces the reason.
- **Speed and quiet are features.** Reinforces §12 of the brief.

## 4. Lessons explicitly rejected

- **Float, pattern, seed, instance-level data.** FloatAlpha does not collect
  it. `browsing.ts` already carries the instruction: *"Read only literal
  weapon/exterior tokens; do not infer float/rarity."*
- **Marketplace affordances** — buy buttons, listing tables, price comparison,
  checkout. FloatAlpha observes a venue; it is not one.
- **3D inspect / screenshot galleries.** No data, no thesis fit.
- **Signal language** — Buy/Sell/Strong Buy/target/undervalued. Prohibited by
  §3 and already enforced by `tests/seo-architecture.test.ts`.
- **Dashboard proliferation.** Market Pulse must replace weak metrics, not
  stack on top of them.

---

## 5. Market Pulse concept

**The gap.** Terminal answers "how complete is our data". It should first answer
"what is the market doing", then let coverage recede into provenance.

**Computable today, per horizon, with zero new data:**

| Measure | Source on `MarketAssetSummary` |
| --- | --- |
| % rising / falling / flat | `returnsFor(asset, basis)[horizon]` sign |
| Listing breadth | `listingPct[horizon]` sign |
| Elevated activity count | `activity` vs `SCREEN_THRESHOLDS.activity` |
| Category breadth | `identity.category` + the above |
| Freshness | `freshness.marketEvidence.observedAt` |

**Non-negotiables.** "Flat" must be an explicit band, not "not rising" —
a zero return and an unobserved return are different facts, and `null` must
stay out of every bucket rather than silently counting as flat. Any percentage
must state its denominator (assets with a return at that horizon), because that
denominator is smaller than 100 and varies by horizon.

**Presentation.** A single compact strip above the existing content, replacing
the weakest coverage metrics rather than adding a row of cards. Coverage moves
into progressive disclosure (§10).

---

## 6. Screener evolution

**Present filters** (from `Screen`): `category`, `q`, `preset` (12), `horizon`,
`basis`, `sort`, `direction`, `page`, `min`, `max`, `absMove`, `listingMin`,
`listingMax`, `listingPct`.

The financial dimension is well covered. The CS2-native dimension is not.

**Available now, unused as filters:** `identity.weapon`, `identity.exterior`
(wear), `identity.variant` (StatTrak™ / Souvenir). All three are already on
every summary and already rendered by `identityText()`.

**Not available in the derived contract:** rarity, collection. These exist in
the *catalog* database (`CatalogMetadata.rarity`, `.collections`) but are not
plumbed into `MarketAssetSummary`. Adding them is a contract change, not a
filter change — deferred, and honestly labelled as such in §14.

**Never:** float, pattern, seed, sticker contents, owner.

---

## 7. Asset Intelligence evolution

**Do not build an explanation engine — one exists.** `explain()` returns
qualified lines per asset, and `marketStory()` returns the structured header
story (`priceChange`, `medianChange`, `minimumChange`, `listingChangePct`,
`listingFromTo`, `listings`, `depth`, `depthNote`, `current`).

Two things stand out from the audit:

1. **`explanations` is computed for every row and rendered for one.**
   `screenAssets` builds `Object.fromEntries(rows.map(a => [a.id, explain(a, s)]))`,
   and only `result.explanations[focus.id]` reaches the UI. The cost is already
   paid.
2. **`marketStoryLine()` already produces a compact one-liner** suited to a
   table row.

The evolution is rendering, not computation. It must respect §12: a full
explanation on every row is clutter. The defensible version is a single
qualified line, or a divergence marker shown only when the joint condition the
`risingContracting` / `fallingExpanding` presets already define is true.

---

## 8. Watchlist evolution

**Already an intelligence surface**, contrary to the brief's assumption: it
filters `dataset.assets` to watched ids and renders `IntelligenceTable` and
`IntelligenceInspection`, with the same filters as the Screener.

Its four metrics are coverage-oriented — Watched assets, Available references,
Full coverage, Stale observations — the same weakness as Terminal.

**The real opportunity is "what changed since you last looked".**
`watchlist_entries.checkpoint_observation_id` exists and the `PATCH
/api/product/watchlist` route sets it. That is the primitive for the
`WATCHLIST → WHAT CHANGED` loop, and it is currently stored without being
surfaced.

**Alerts are not a future capability — the infrastructure is built:**
`alert_rules`, `alert_events`, condition evaluation with false-to-true
transitions and re-arm semantics, `evaluateAlerts()`, an internal evaluation
endpoint, and a UI at `/alerts`. Scope for this work is *not* to build alerts;
at most it is to connect discovery to them.

---

## 9. Portfolio future

**Already supported:** manual holdings (`quantity`, nullable `unit_cost`),
exact decimal valuation via `valueHolding()` returning `{ value, cost, pnl }`,
per-holding 24h observed reference change, most-active holding, and a portfolio
total.

**Requires user-entered acquisition price:** cost basis, unrealized P&L,
return %. Already possible — `unit_cost` is nullable, so holdings without it
must degrade to value-only rather than implying a zero basis.

**Requires new persistence:** allocation history, portfolio time series,
contributors/detractors over a window. There is no per-user historical
valuation table; computing history would mean either storing snapshots or
recomputing against observation history.

**Requires Steam integration:** automatic inventory import. Steam account
linking exists as flag-gated code held out of `main` by a fail-closed absence
guard. Out of scope.

Portfolio stays private and `noindex`. The public holdings-keyword gap is a
separate landing page (`docs/SEO_STRATEGY.md` §10, Stage 3).

---

## 10. Trust and provenance UX

**Currently exposed:** `EvidenceNotice` per page, a `Quality` component,
coverage percentage, observation counts, `observedAt`, availability state and
detail, history versions, depth notes ("thin market" qualification), and the
three-way freshness model (market evidence / provider evidence / intelligence).

This is already strong — arguably too prominent for a first-time visitor and
too shallow for someone asking "should I trust this number".

**The change is disclosure level, not new data.** Normal state shows the metric;
expansion answers "why am I seeing this". Coverage metrics displaced from
Terminal and Watchlist by Market Pulse land here rather than disappearing.

**Must not surface:** snapshot ids, report hashes, method strings, migration or
pointer internals. `history.hash` is engineering provenance and must stay out
of the product surface.

---

## 11. Catalog breadth vs intelligence breadth

Three states, to be documented and respected:

| State | Meaning | Today |
| --- | --- | --- |
| **Catalog asset** | Recognised; name, type, artwork | 48,412 in the catalog database |
| **Observed asset** | Market observations exist | 100 |
| **Intelligence asset** | Enough history for full analysis | 99 (those with an observed median) |

Search and recognition may legitimately span the catalog. Intelligence may not
pretend to. Any surface that shows a catalog asset without observations must
say so rather than rendering empty metrics.

**No collection or derived-scope expansion is proposed here.** The
full-catalog/change-only architecture stays unbuilt.

---

## 12. Existing-system audit

| Area | Finding |
| --- | --- |
| Routes | 8 public, 9 private. Frozen by `tests/seo-freeze.test.ts` |
| Dataset | One `readMarketDataset()`, request-cached |
| Screening | One `screenAssets()`, used by Assets, Screener, Watchlist, Category |
| Explanation | `explain()` per row (computed, under-rendered); `marketStory()` per asset |
| Presets | 12, including two divergence presets |
| Identity | `category`, `weapon`, `exterior`, `variant` |
| Watchlist | `watchlist_entries` with `checkpoint_observation_id` |
| Portfolio | `portfolio_holdings` with `quantity`, `unit_cost`; `valueHolding()` |
| Alerts | `alert_rules`, `alert_events`, `evaluateAlerts()`, UI — complete |
| APIs | 9 product routes incl. `screener`, `screens`, `watchlist`, `portfolio`, `alerts` |
| Boundaries | Pages are server components; `AssetImage`, `WatchButton`, `TrackEvent` are client |

---

## 13. Capability matrix

| Capability | Exists | Partial | Missing | Data available | UI change | Backend change | Risk |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| Market Pulse | | | ✅ | Yes | Yes | No | Low — presentation of existing fields |
| Market breadth | | | ✅ | Yes | Yes | No | Low; denominator must be stated |
| Category breadth | | ✅ | | Yes | Yes | No | Low; small per-category counts |
| Listing breadth | | | ✅ | Yes | Yes | No | Low |
| Activity discovery | ✅ | | | Yes | No | No | Preset `active` exists |
| Screener market filters | ✅ | | | Yes | No | No | None |
| Screener CS2 metadata filters | | ✅ | | Yes (weapon/wear/variant) | Yes | No | Low |
| Screener rarity/collection | | | ✅ | **No** — catalog only | Yes | **Yes** | Contract change; deferred |
| Why-is-this-interesting | | ✅ | | Yes, computed already | Yes | No | Clutter risk |
| Related assets | | | ✅ | Partial (category/weapon) | Yes | No | Similarity claims |
| Watchlist intelligence table | ✅ | | | Yes | No | No | None |
| Watchlist "since last visit" | | ✅ | | Checkpoint stored | Yes | Maybe | Medium |
| Watchlist alerts | ✅ | | | Yes | No | No | Already shipped |
| Portfolio value | ✅ | | | Yes | No | No | None |
| Portfolio cost basis | ✅ | | | User-entered | No | No | Null basis must degrade |
| Portfolio P/L | ✅ | | | Yes | No | No | None |
| Portfolio history | | | ✅ | **No** | Yes | **Yes** | New persistence |
| Trust/provenance | ✅ | | | Yes | Yes (disclosure) | No | Low |
| Broad catalog recognition | | ✅ | | 48,412 catalog | Yes | Maybe | Must not imply intelligence |

## 14. Data availability matrix

| Field | Where | Usable now |
| --- | --- | --- |
| `minimum`, `median`, `listings` | Summary | Yes |
| `returns`, `medianReturns` per horizon | Summary | Yes |
| `listingDelta`, `listingPct` per horizon | Summary | Yes |
| `activity`, `activity24h` | Summary | Yes |
| `volatility`, `volatilitySamples` | Summary | Yes, where non-null |
| `quality.*`, `availability` | Summary | Yes |
| `identity.category` | Summary | Yes — already filtered |
| `identity.weapon` / `.exterior` / `.variant` | Summary | **Yes — unused as filters** |
| `artwork` | Summary | Yes |
| rarity, collection | Catalog DB only | **No** — needs contract plumbing |
| float, pattern, seed, stickers | — | **No, and never** |
| Portfolio `unit_cost` | Product DB | Yes, nullable |
| Watchlist checkpoint | Product DB | Yes, stored, unsurfaced |
| Per-user valuation history | — | **No** — new persistence |

---

## 15. UX integration plan

- **Terminal.** Market Pulse strip replaces the weakest coverage metrics.
  Coverage moves to disclosure. No navigation or route change.
- **Screener.** CS2-native filters join the existing `IntelligenceFilters`
  control group, in its existing visual language. No new panel.
- **Rows.** At most one qualified line, or a divergence marker on the joint
  condition already defined by presets. Not a paragraph per row.
- **Watchlist.** Same table; its metric strip gains change-oriented rather than
  coverage-oriented measures.
- **No new page templates, no new navigation entries, no visual redesign.**

---

## 16. Phase 1 proposal

Smallest coherent improvement to **Pulse → Screener → Asset → Watchlist**.
Presentation of computation that already runs.

**P1-A — Market Pulse strip on Terminal.** Breadth (rising/falling/flat with an
explicit flat band and a stated denominator), listing breadth, elevated-activity
count, freshness. Computed from the existing dataset in the page. Replaces the
weakest coverage metrics.

**P1-B — Surface why a row surfaced.** Render the already-computed
`explanations` entry compactly, or a divergence marker keyed to the existing
joint presets. Zero new computation.

**P1-C — CS2-native screener filters.** `weapon`, `exterior`, `variant` from
`identity`, added to `screenInput`/`screenAssets` and the existing filter
control. Pure filter logic over fields already present.

**Explicitly not in Phase 1:** related assets, watchlist checkpoint surfacing,
portfolio history, rarity/collection, catalog-wide search, alerts work.

### Files Phase 1 would modify

| File | Change |
| --- | --- |
| `src/lib/product/intelligence/pulse.ts` | **New** — breadth computation, pure function |
| `src/app/(market)/terminal/page.tsx` | Render pulse; demote coverage metrics |
| `src/components/intelligence-market.tsx` | Compact reason in `IntelligenceTable` |
| `src/lib/product/intelligence/screener.ts` | `weapon`/`exterior`/`variant` in `Screen`, `screenInput`, `screenAssets` |
| `src/components/intelligence-filters.tsx` | Three filter controls |
| `tests/` | New tests for pulse maths and the new filters |

**Schema changes:** none. **API changes:** none — filters are query parameters
on existing routes. **Derived pipeline changes:** none. **Collection changes:**
none. **Migration:** none.

**Visual impact:** one strip on Terminal replacing existing metrics; three
controls in an existing filter group; one compact line or marker in an existing
table. No new page, route, navigation entry or visual language.

---

## 17. Later phases

- **Phase 2 — Watchlist "what changed".** Surface the stored checkpoint.
  Requires deciding what "since last visit" means when observations are
  five-minutely.
- **Phase 3 — Related assets.** Start deterministic and explainable: same
  weapon, same category. Behavioural similarity is an EXPERIMENT and must not
  ship as "these move together" without validation.
- **Phase 4 — Rarity and collection.** Plumb catalog metadata into the derived
  contract, then filter on it.
- **Phase 5 — Portfolio history.** Needs new persistence; design first.
- **Phase 6 — Public holdings methodology page.** Closes the SEO gap without
  exposing anyone's portfolio.

## 18. Risks

- **Breadth percentages mislead at n=100.** A stated denominator is mandatory,
  and per-category breadth on 6-asset categories should not be shown as a
  percentage.
- **Null is not flat.** An unobserved return must never be bucketed.
- **Row explanations become clutter**, violating §12. Mitigate by showing a
  marker on a defined joint condition, not prose per row.
- **A divergence marker reads as a signal.** Wording must stay coincidental;
  `risingContracting`'s existing comment is the standard to match.
- **Displacing coverage metrics could look like hiding data quality.** They must
  move into disclosure, not disappear.
- **Filter surface growth** conflicts with "simple by default".

## 19. Non-goals

No collection or cadence change. No derived-scope expansion. No full-catalog
migration. No predictive model or signal language. No marketplace features. No
float/pattern/seed. No visual redesign, navigation change or new route family
(the SEO freeze pins route families). No alerts rebuild. No portfolio Steam
import. No second explanation engine, screening engine or derived pipeline.

## 20. Acceptance criteria

Phase 1 is done when:

1. Terminal answers "what is the market doing" above the fold, with every
   percentage carrying its denominator and no null bucketed as flat.
2. Coverage information remains reachable, in disclosure rather than as
   headline metrics.
3. A user can tell why a row surfaced, in one line or one marker, without prose
   per row.
4. Weapon, wear and StatTrak/Souvenir are filterable, and combine with existing
   market filters.
5. No schema, API, derived-pipeline, collection or cadence change was made.
6. All §18 production invariants verify unchanged.
7. The SEO freeze, GA4 and Search Console tests still pass, and no new
   indexable route family exists.
8. No copy asserts causation, prediction or recommendation; the keyword-safety
   tests still pass.
9. Full suite, typecheck, lint and build pass.
