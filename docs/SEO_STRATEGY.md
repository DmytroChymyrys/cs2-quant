# FloatAlpha SEO Strategy

Organic authority in the CS2 skin-market research space, built on what
FloatAlpha actually observes.

**Scope of the evidence.** Production tracks **100 explicitly selected Skinport
assets**, collected on a five-minute cadence. Every claim on every indexable
page must stay inside that: observed listing prices, listing quantity,
source-published sales aggregates, and the timestamps attached to them. This
document never asks a page to say more than the data supports.

**Positioning.** FloatAlpha is *market intelligence*, not marketplace price
comparison. Competitors answer "where is this cheapest right now". We answer
"what has this market been doing, how well supported is that reading, and how
fresh is the evidence". Every title, heading and description below is written
to hold that line.

---

## 1. Keyword clusters

Seven clusters, grouped by the question the searcher is asking rather than by
string similarity.

### C1 — Price lookup (highest volume, lowest intent depth)
`CS2 skin prices`, `CS2 prices`, `CS2 skins`
Searcher wants a number for an item, or a list of items with numbers.

### C2 — Price tracking over time
`CS2 skin price tracker`, `CS2 skin price history`
Searcher wants change, not a snapshot. This is where FloatAlpha's collected
history is the differentiator, and where a marketplace listing page cannot
compete.

### C3 — Market-wide view
`CS2 market`, `CS2 skin market`, `CS2 market data`
Searcher wants the state of the market, not one item.

### C4 — Analytics and methodology
`CS2 market analytics`, `CS2 skin analytics`
Searcher wants derived measures and wants to know how they were produced. The
highest-authority cluster and the one most aligned with our positioning.

### C5 — Movement and discovery
`CS2 market trends`, `CS2 skin trends`, `CS2 trending skins`,
`CS2 skin gainers`, `CS2 skin losers`
Searcher wants what is moving. Maps to screener presets that already exist.

### C6 — Supply and liquidity
`CS2 skin listings`, `CS2 skin supply`, `CS2 skin liquidity`
Searcher wants availability and depth. FloatAlpha observes listing quantity and
its change directly, so this is defensible and under-served.

### C7 — Holdings *(no public surface — see §10)*
`CS2 inventory value`, `CS2 portfolio tracker`, `CS2 inventory tracker`
Searcher wants to value what they own. **Portfolio and watchlist are
account-specific and noindex**, so FloatAlpha has no indexable answer to this
cluster today. This is a genuine gap, recorded here rather than papered over by
pointing the keywords at a page that cannot rank or convert.

---

## 2. Search-intent mapping

| Intent | Question behind the query | Cluster | Surface |
| --- | --- | --- | --- |
| Item lookup | "What is X worth?" | C1, C2 | Asset page |
| Item history | "Has X gone up?" | C2 | Asset page (chart, horizons) |
| Category browse | "What are knife prices like?" | C1, C6 | Category page |
| Directory | "Show me CS2 skin prices" | C1 | `/assets` |
| Market state | "What is the CS2 market doing?" | C3 | `/terminal` |
| Movement | "What is trending / gaining?" | C5 | `/screener` |
| Liquidity | "What is actually available?" | C6 | `/screener`, asset page |
| Methodology | "Where does this data come from?" | C4 | `/`, asset provenance |
| Commercial | "What does this cost?" | — | `/pricing` |

---

## 3. Route → keyword mapping

| Route | Primary theme | Secondary terms | Index |
| --- | --- | --- | --- |
| `/` | CS2 skin market intelligence | market data, analytics, observed listings | Yes |
| `/terminal` | CS2 market | market data, live listing data, market state | Yes |
| `/assets` | CS2 skin prices | price tracker, listing supply, directory | Yes |
| `/screener` | CS2 market trends | trending skins, gainers, losers, liquidity | Yes |
| `/cs2-skins` | CS2 skins | skin categories, price by type | Yes |
| `/cs2-skins/{category}` | CS2 {category} prices | {category} supply, {category} market data | Yes, if substantive (§6) |
| `/asset/{slug}` | {item} price | {item} price history, listing supply, market data | Yes, if observed |
| `/pricing` | FloatAlpha pricing | free, pro, plans | Yes |
| `/portfolio`, `/watchlist`, `/alerts`, `/settings`, `/onboarding` | — | — | **No** — account-specific |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | — | — | **No** |
| `/ops-c8e4`, `/dev/*`, `/api/*` | — | — | **No** |

---

## 4. Title / H1 / meta strategy

**Title.** `%s | FloatAlpha` applied by template from the root layout. The home
page carries the brand itself, because Next applies the template to child
segments only. Target 50–60 characters before the suffix.

**H1.** One per page, matching the title's promise in natural language rather
than repeating it verbatim. Headings below H1 name the factual sections the
page actually renders, so the document has a structure a crawler can read.

**Meta description.** 140–160 characters, describing what the page shows and
the evidence behind it. Descriptions are not ranking factors; they are the
click decision, so they state the concrete thing on offer ("observed listing
prices, supply and collected history") rather than adjectives.

**Prohibited across all copy.** No `guaranteed profit`, `best CS2 investment`,
`what skin should I buy`, `buy signal`, `sell signal`, `predict`, `forecast`,
`undervalued`, `alpha` as a return claim. FloatAlpha describes observations; it
does not advise, and it does not forecast. Also prohibited: any claim of
complete or global CS2 market coverage, since production tracks 100 assets on
one venue.

---

## 5. Asset-page template

The public unit of item-level search intent, and the most scalable surface.

**URL.** `/asset/{name-slug}-{id8}` — implemented. Slugification is lossy, so
the eight-hex suffix makes each URL unique and permanent regardless of
catalogue growth or renames. Legacy UUID URLs 308-redirect. UUIDs remain the
internal identity.

**Title.** `{name} Price, History & Market Data`
**H1.** `{name} CS2 Market Data`
**Description.** Observed listing prices, available supply and market activity
for `{name}`, with source timestamps and collected history.

**Sections** — rendered only when the underlying data exists, never as empty
scaffolding:

| Section | Backing data |
| --- | --- |
| Current market price | minimum and median listing price |
| Price history | observation chart over the selected horizon |
| Price change | returns per horizon (1h / 6h / 24h / 7d) |
| Listing supply | listing quantity |
| Listing change | listing delta and percentage per horizon |
| Market activity | source-published sales aggregate |
| Historical observations | observation count, history versions |
| Data freshness | observed-at, provider age at capture, coverage |

An asset with no observed median is `noindex` and absent from the sitemap. It
has nothing to rank on, and indexing it would be a thin page.

---

## 6. Category-page architecture

Routes are designed for the full taxonomy; pages are created only where the
data is substantive.

```
/cs2-skins                  hub, links to every live category
/cs2-skins/rifles
/cs2-skins/knives
/cs2-skins/gloves
/cs2-skins/cases
/cs2-skins/stickers
```

**Threshold: 12 or more assets with an observed median.** Below that the page
is a short list dressed as a category, which is the thin-content failure this
architecture exists to avoid. Measured against the current 100-asset universe:

| Category | Assets | Page |
| --- | --- | --- |
| Stickers & capsules | 20 | Create and index |
| Cases | 20 | Create and index |
| Rifles | 18 | Create and index |
| Knives | 15 | Create and index |
| Gloves | 15 | Create and index |
| Snipers | 6 | **Route designed, page not created** |
| Pistols | 6 | **Route designed, page not created** |

**Weapon-level routes** (`/cs2-skins/ak-47`, `/cs2-skins/awp`) are deliberately
**not** created. The deepest weapon holding is AK-47 at 8 assets, AWP and
M4A1-S at 5. These are the highest-intent queries in C1, and they are worth
building — but only once coverage supports them. Shipping them now would
generate exactly the thin programmatic pages this section forbids.

A category page carries: an H1 naming the category, a factual lead describing
what is tracked in it, a table of its assets with observed price, supply and
change, and links to each asset page. Its content is the same observed data as
the asset pages, aggregated — nothing new is computed or claimed.

---

## 7. Internal-link architecture

Discovery must not depend on client-side search or filtering. Every indexable
page is reachable through ordinary `<a>` links.

```
/ ──────────────► /terminal, /assets, /screener, /cs2-skins
/cs2-skins ─────► /cs2-skins/{category}          (hub → category)
/cs2-skins/{c} ─► /asset/{slug}                  (category → items)
/assets ────────► /asset/{slug}, /cs2-skins/{c}  (directory → items, categories)
/terminal ──────► /asset/{slug}                  (movers → items)
/screener ──────► /asset/{slug}                  (results → items)
/asset/{slug} ──► /cs2-skins/{category}          (item → its category, breadcrumb)
```

**Rules.**
- Every asset page links up to its category. This is the link that turns a flat
  set of item pages into a graph.
- Category pages link down to every asset they contain, as real anchors.
- No page links to a `noindex` surface from public navigation where avoidable.
- "Related assets" is limited to same-category items. Anything stronger — "these
  move together" — would be a correlation claim the data has not been validated
  to support.

---

## 8. Structured-data strategy

Only what can be substantiated. No ratings, review counts, user counts, awards
or availability we do not have.

| Type | Where | Justification |
| --- | --- | --- |
| `Organization` | site-wide | Identity |
| `WebSite` | site-wide | Identity |
| `WebApplication` | site-wide | What the product is |
| `BreadcrumbList` | category, asset | Mirrors the real link path |
| `ItemList` | category | The assets listed, in the order shown |

**Explicitly excluded.** No `Product` or `Offer` markup on asset pages. Those
assert a purchasable item at a price from *this* site; FloatAlpha observes a
third-party venue and sells nothing. No `AggregateRating` anywhere. No `offers`
on `WebApplication` while Pro is not purchasable during Preview.

---

## 9. Sitemap and indexing rules

- Sitemap contains public canonical URLs only, rooted at `https://floatalpha.com`.
- An asset appears only with an observed median.
- A category appears only above the §6 threshold.
- `lastmod` reflects a real data or content update: per-asset observation time
  for asset pages, a pinned content date for editorial pages. Never generation
  time.
- Built once per deployment. It reads the derived database, and doing that per
  request made Googlebot wait on a cold compute — measured at 11.97 s, which
  Search Console reported as "Couldn't fetch".
- Indexing requires **both** `VERCEL_ENV=production` **and** a resolved origin
  of `https://floatalpha.com`. Preview deployments return `Disallow: /` and an
  empty sitemap, so they cannot compete with the branded origin.
- Canonicals are always the bare path. Query parameters — `horizon`, `preset`,
  `category`, `page` — render the same document and must not fork the index.

---

## 10. Programmatic-SEO expansion plan

Ordered by value per unit of risk. Each stage is gated on evidence, not on
calendar time.

**Stage 1 — Weapon-level categories.** `/cs2-skins/ak-47`, `/cs2-skins/awp`.
The highest-intent C1 queries. Gate: 12+ observed assets for that weapon.
Currently AK-47 has 8.

**Stage 2 — Exterior-qualified pages.** `AK-47 | Redline (Field-Tested)` versus
`(Minimal Wear)` is a real distinction searchers make. Gate: the same item
tracked across 3+ exteriors with enough history to show the spread.

**Stage 3 — The holdings cluster (C7).** The only cluster with no surface at
all. Needs a *public* page explaining inventory valuation — methodology,
worked example, what the tool does — not an indexable version of someone's
portfolio. Gate: product decision, not data.

**Stage 4 — Market reports.** Periodic observed summaries: what moved over a
window, supply shifts, activity changes. Directly serves C3/C4 and is the
strongest authority play available, because it is writing that only someone
holding this data could produce. Gate: 90+ days of continuous collection, so
the window is long enough to be worth reading.

**Never.** Auto-generated pages per item-per-day, per price point, or per
speculative query. They would be thin, near-duplicate, and would put
FloatAlpha's whole domain at risk of a quality action.

**Every stage inherits the §4 prohibitions.** Growth in surface area must not
become growth in claims.
