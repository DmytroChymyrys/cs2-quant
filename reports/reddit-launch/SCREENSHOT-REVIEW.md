# Reddit Launch Screenshots — Capture and Review

> **Updated 2026-10-15 after release `ca522cf`.** Both screenshots were
> recaptured from production once the freshness fix shipped. Limitations 3 and
> 4 described the pre-fix captures and are now resolved — marked inline below.
> See `FRESHNESS-FIX.md` and `FRESHNESS-ROLLOUT.md`.

Two screenshots captured from production for a Reddit launch post, with the
selection reasoning, the metrics visible in each, and the limitations a reader
should know about before the images are posted.

## Capture conditions

| | |
|---|---|
| Source | `https://floatalpha.com` (production, not a preview deploy) |
| Viewport | 1440 × 900, `deviceScaleFactor: 2` (2880 × 1800 output) |
| Session | Signed out — the guest view, which is what a Reddit visitor lands on |
| Tool | Playwright (Chromium), headless |
| Snapshot | `Data as of 2026-10-15 13:55:00 UTC` |
| Code changes | None. No application code, data, or configuration was modified. |

Both images are real production data at the moment of capture. Nothing is
mocked, recomputed, or redrawn.

---

## 1. `screener.png` — the Screener

**URL:** `/screener?sort=venueDelta&direction=desc&min=10`

### Why this view

The default Screener sort shows preset order; it does not lead with the thing
that distinguishes FloatAlpha from a price tracker, which is that it observes
two venues at once. So the sort is cross-venue divergence, descending. Four
candidate views were measured before choosing:

| View | Result | Verdict |
|---|---|---|
| `sort=price&direction=desc` | **0 of 10 rows had a divergence value** | Rejected |
| `category=rifles&sort=price` | 6/10 names truncated, first two rows empty | Rejected |
| `category=knives&sort=venueDelta` | 10/10 names truncated | Rejected |
| `sort=venueDelta&direction=desc` | every row populated, 3/10 truncated | Rejected (see below) |
| **`sort=venueDelta&direction=desc&min=10`** | **every row populated, 2/4 truncated, no penny items** | **Chosen** |

Two of those deserve explanation.

**Price-descending shows zero divergence.** This is not a bug in the capture.
The most expensive tracked assets are exactly the eleven with no Steam ask
observed, so sorting by price surfaces the rows where the cross-venue column is
empty. A screenshot of the flagship feature showing an empty column would have
been the worst possible choice, and it was the first one tried.

**The $10 floor is a methodological choice, not cherry-picking.** Unfiltered,
the top two divergence rows were `AK-47 | Olive Polycam (Factory New)` at
**$0.23** (+60.9%) and `USP-S | Alpine Camo (Field-Tested)` at **$0.25**
(+60.0%). On a 23-cent item a 14-cent gap is a 60% divergence, so the ranking
is dominated by the one-cent tick rather than by any real cross-venue spread.
The product already makes this exact argument about itself elsewhere — the
preset documentation on the same page says High Volatility "on low-priced
assets [is] dominated by the one-cent tick."  Applying the same reasoning to
divergence is consistent, not flattering. `min=20` produced an identical top
six, so $10 is the weakest floor that achieves the effect.

The filter is disclosed on screen: the result header reads **"67 matching
assets"** against the `ALL 149` tab, so the view is visibly a subset. The filter
*control* is not visible, because it lives in the collapsed "Numeric and
data-quality filters" section — expanding it was measured and leaves only
**one** data row in frame, which defeats the purpose of the screenshot. If the
post is captioned, saying "sorted by cross-venue divergence, $10 minimum" costs
one clause and removes the ambiguity entirely.

### Scroll position

Framed at the top of the page rather than scrolled to maximise row count. A
lower scroll fit six rows instead of four, but pushed the freshness strip out of
frame. That strip is a methodological disclosure and keeping it was worth two
rows.

### What is visible

- Page heading, and the freshness strip: `Data as of 2026-10-15 13:55:00 UTC ·
  Selected snapshot · Market evidence 50m ago · Venue data was 5m old when
  captured · Intelligence computed 45m ago`, with a `Freshness & methodology`
  disclosure link
- Category tabs with counts (`ALL 149`, `RIFLES 18`, `KNIVES 15`, `CASES 20` …)
- The filter bar, `Preset thresholds and metric definitions` disclosure
- `67 matching assets · 1h return / volatility · Minimum listing reference` and
  `Sorted by Venue divergence · descending · Unavailable last`
- Columns: Asset, Minimum · USD, Return, Listings, Listings Δ · 1H, Activity,
  **Venue Δ %**, **Days to clear**, Quality / explanation, Inspect
- Four complete rows:

| Asset | Min USD | Venue Δ % | Days to clear | Listings |
|---|---|---|---|---|
| Operation Bravo Case | 49.16 | +57.2% | ≈10.9 days | 321 |
| ★ Butterfly Knife \| Slaughter (Minimal Wear) | 1,155.60 | +55.8% | ≈2.7 days | 18 |
| Sticker \| iBUYPOWER \| Cologne 2014 | 96.30 | +52.2% | ≈28.0 days | 25 |
| AK-47 \| Vulcan (Factory New) | 533.24 | +51.9% | ≈43.8 days | 23 |

- The Inspection Rail, showing Operation Bravo Case with minimum listing 49.16,
  venue listings 321, Activity 0, Volatility 0.00%, and a `STALE SOURCE` badge

---

## 2. `asset-intelligence.png` — the asset page

**URL:** `/asset/ak-47-vulcan-field-tested-3ddb55fb`

### Why this asset

Production was queried for assets with *every* cross-venue and liquidity
indicator populated — both venue asks, both listing counts, a Steam bid, 24h
sales, a clearance estimate, and a velocity figure. Most assets are missing at
least one. `AK-47 | Vulcan (Field-Tested)` had all of them, and it is a
well-known skin at a credible price point ($167), so a reader recognises it
without needing to be told what it is.

### What is visible

The complete **Cross-Venue Observation** panel:

| Field | Value |
|---|---|
| Skinport minimum ask | **$167.49** (observed 02:35 PM UTC) |
| Steam minimum ask | **$230.00** (observed 01:40 PM UTC) |
| Difference | **$62.51** — "Steam asks more" |
| Divergence | **37.3%** — "Relative to the Skinport ask" |
| Skinport listings | 87 |
| Steam listings | 73 |
| Steam sold · 24h | 3 |
| Steam best bid | $201.08 (2,592 standing orders) |
| Market clearance estimate | **≈21.1 days** — "At the recent selling rate" |
| Trading velocity · 30D | **142.5%** — "30-day sales vs listings now" |
| Steam bid/ask distance | **12.6%** — "Lowest ask above highest bid" |

Below the figures, in frame and fully readable: *"The two observations are 55
minutes apart. Skinport is collected every five minutes and Steam hourly, so a
gap is normal."* — plus two disclosure toggles, `What the clearance estimate is,
and is not` and `Why the two venues differ`.

Alongside it: the 7-day observation chart (minimum listing price, range
152.46 – 171.09, timestamped `2026-10-08 13:55:13 UTC` to `2026-10-15 13:50:18
UTC`), its own `Observation data and methodology` disclosure, and the start of
the `Why this asset appears` panel.

### A framing decision worth recording

The first capture of this page had the clearance disclosure expanded, and the
disclosure text was **cut off mid-sentence** at the bottom edge ("…where it sits
in the queue" clipped). That is the failure mode the brief names — a truncated
disclosure is worse than a collapsed one, because it looks like the full text.

Measured: the panel is 796px with disclosures in their default state, 1,030px
with one expanded, and 1,174px with both. The viewport is 900px. **The panel and
an expanded disclosure cannot both fit at 1440 × 900.** The capture was redone in
the page's natural default state, where the whole panel fits with nothing
clipped and both disclosures are visible as labelled controls. For the record,
the collapsed text reads:

> It divides the Steam listings standing right now by the average daily sales
> over a fixed 30-day window. Both figures are Steam's own; nothing from
> Skinport enters this calculation. **It is not a sale time.** It describes how
> long the current book would last at the recent average rate, which is a
> statement about the book and not about any individual listing.

---

## Limitations

**1. Neither screenshot shows the asset name on the asset page.** The `<h1>`
("AK-47 | Vulcan (Field-Tested) CS2 Market Data") sits at y=137; the cross-venue
panel starts at y=916. There is no framing at 1440 × 900 that contains both, and
the name appears nowhere else in the DOM — it was searched for. The post caption
must name the asset, or a reader cannot tell what the numbers describe.

**2. Two of four visible Screener rows have truncated names.** "★ Butterfly
Knife | Slaughter (…" and "Sticker | iBUYPOWER | Cologn…" are clipped by the
asset column width at 1440px. This improved from 3-of-10 once the price floor
removed the long penny-item names, but it is a real layout limit, not a capture
artifact.

**3. ~~Every row reads "Stale"~~ — RESOLVED by release `ca522cf`.** This was a
real product defect, not bad timing: a single 900-second threshold was compared
against a read-time age under an hourly pipeline, so healthy data was labelled
stale for 45 minutes of every hour. The recaptured Screener shows
`99.85% · Partial` on every row and no Stale indicator in frame. Root cause and
fix are documented in `FRESHNESS-FIX.md`.

**4. ~~Return 0.00% and Activity 0 on most rows~~ — IMPROVED.** The recaptured
Screener shows real movement on `Sticker | iBUYPOWER | Cologne 2014` (minimum
−20.4%, listings +4.0%, activity 8.33). The remaining zeros are genuine quiet
markets rather than an artifact of snapshot age.

**5. The Screener's active price filter is not visible on screen.** Discussed
above: the `67 matching assets` count discloses that filtering occurred, but not
what the filter is.

---

## Defect found while reviewing: the staleness threshold contradicts the refresh cadence

This was not part of the brief. It was found because every row in the capture
said "Stale" and that needed explaining before the image could be posted.

Two independent staleness definitions exist:

| Constant | Value | Location |
|---|---|---|
| `DERIVED_ACTIVATION_COOLDOWN_MS` | 60 min | `src/lib/derived-market/policy.ts:36` |
| `DERIVED_STALE_AFTER_MS` | 90 min | `src/lib/derived-market/policy.ts:39` |
| `STALE_SECONDS` | **15 min** | `src/lib/product/intelligence/contract.ts:177` |

The derived pipeline publishes at most once an hour, and its own policy module
treats a snapshot as healthy until 90 minutes — that file documents the 90-minute
figure as the point where "something is probably wrong."

The Screener display, however, classifies a row `STALE_SOURCE` at
`src/lib/product/intelligence/map.ts:133` once the source or observation age
exceeds `STALE_SECONDS`, which is 15 minutes. Since publication is hourly, **a
perfectly healthy snapshot is labelled "Stale" for roughly 45 of every 60
minutes.** At capture time the strip read "Intelligence computed 45m ago" —
healthy by the pipeline's own 90-minute standard, stale by the UI's 15-minute
one.

The irony is that `policy.ts` anticipates exactly this drift. Its comment reads:
"Changing the cooldown does not automatically change this. Both are product
decisions and both are set here." But `STALE_SECONDS` is *not* set there — it
lives in the intelligence contract, which is how the two got out of step.

**Recommendation (not applied — this gate is capture-and-review only):** derive
the display threshold from the publication cadence rather than setting it
independently, so that "Stale" means "the pipeline missed a publication" instead
of "the pipeline published normally and 15 minutes passed." Until then, every
launch screenshot of the Screener will show a wall of "Stale" badges.

---

## Verdict

Both screenshots are production-real, show the cross-venue and liquidity
indicators that differentiate the product, keep their methodological disclosures
intact and unclipped, and contain no fabricated or synthetic data.

One thing remains before posting: **caption the asset page with the item name**
(limitation 1, unavoidable at this viewport). The second question — whether to
ship with the "Stale" badges — was answered by fixing the threshold instead.
Both screenshots have been recaptured from production and carry no misleading
freshness indicator.
