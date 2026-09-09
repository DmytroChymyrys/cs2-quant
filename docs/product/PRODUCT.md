# FloatAlpha Product Specification

## 1. Product identity

**Brand:** FloatAlpha  
**Descriptor:** CS2 Market Intelligence  
**Core promise:** **See what price alone does not show.**

FloatAlpha is a market-intelligence product for Counter-Strike 2 assets. It observes changes in price, listing quantity/supply, and aggregated sales activity, then helps users investigate unusual market conditions without presenting trading advice or predictive certainty.

## 2. Primary user workflow

The application should support this mental model:

- **Terminal** — What is happening across the tracked universe?
- **Screener** — What should I investigate?
- **Asset Intelligence** — Why is this asset behaving unusually?
- **Assets Explorer** — Find or browse a specific asset.
- **Watchlist** — What changed in assets I care about?
- **Alerts** — Evaluate market conditions for me and notify me when they newly become true.
- **Portfolio** — What exposure, concentration, and observed-price-confidence risk do I carry?

## 3. Product principles

1. **Grounded before impressive.** Never invent data to satisfy a mockup.
2. **Observational, not advisory.** Describe market conditions; do not label them as investment recommendations.
3. **Price is only one dimension.** Supply/listings and activity are first-class dimensions.
4. **Price Confidence is reliability, not direction.** A HIGH confidence label means the observed price is relatively well-supported by available observations; it does not predict an increase or decrease.
5. **History has to exist before it can be shown.** Historical metrics should display collecting/insufficient-history states until enough observations are actually stored.
6. **One source is acceptable for the MVP.** The initial product is Skinport-grounded. Do not imply multi-market consensus or cross-market coverage.
7. **Personalization should improve relevance, not alter truth.** Onboarding preferences change defaults/emphasis only.
8. **Free remains useful.** The Free plan should expose the product's core identity rather than being a crippled demo.

## 4. Initial tracked universe

The current experiment tracks **100 deliberately selected assets** spanning:

- cases
- capsules/stickers
- weapon skins
- knives
- gloves

This universe is a pilot/stress-test sample, not a statistically representative benchmark of all CS2 assets. UI copy should say **100 tracked assets**, **pilot universe**, or equivalent. Avoid “benchmark items” unless such a benchmark methodology is later defined.

## 5. Approved observational conditions

Examples of acceptable descriptive labels:

- `SUPPLY CONTRACTING`
- `SUPPLY EXPANDING`
- `ACTIVITY ACCELERATING`
- `ACTIVITY DECLINING`
- `VOLUME SPIKE`
- `PRICE MOMENTUM`
- `LOW ACTIVITY`
- `LOW PRICE CONFIDENCE`
- `SPARSE MARKET CONDITION`

These describe observed conditions. They are not recommendations.

## 6. Prohibited recommendation language

Do not use these as product signals or analytical conclusions:

- BUY / SELL
- BULLISH / BEARISH
- UNDERVALUED / OVERVALUED
- ACCUMULATION / DISTRIBUTION
- FAIR VALUE
- MOON / breakout hype language

## 7. MVP exclusions

Do not implement or claim these simply because a Stitch mockup or historical concept contains them:

- order book / L2 depth
- bid/ask walls
- execution venues
- cross-market consensus
- cross-market arbitrage
- synchronized venue data
- tick/trade tape or individual-sale event history when only aggregate history exists
- AI price predictions
- fair-value models
- “true market cap”
- Steam inventory sync/import
- institutional customer claims
- enterprise/API tiers
- webhook alert delivery
- arbitrary 0–1 Price Confidence scores before methodology is validated

## 8. Brand tone

FloatAlpha should feel like professional financial analytics adapted to CS2 assets, not a gaming dashboard or crypto casino. Dense, calm, quantitative, and transparent.
