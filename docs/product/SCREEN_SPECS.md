# Screen Specifications

All screens should visually follow the final PNGs in `mockups/`. Where the mockup contains unsupported semantics, this document and `DATA_SEMANTICS.md` override the copy/metric while preserving the visual structure.

## 01 — Landing `/`

Visual reference: `mockups/01-landing.png`

Purpose: explain FloatAlpha's thesis with more whitespace than the app.

Core hero:

- **SEE WHAT PRICE ALONE DOESN'T SHOW.**
- Explain price + supply/listings + sales activity.
- Example condition may show Price, Listings, Sales Activity, Confidence if grounded/demo-labeled appropriately.

Required themes:

- three market dimensions
- workflow from Terminal → investigation → monitoring
- Price Confidence education
- data-source/provenance transparency
- Free/Pro teaser
- analytics/not-investment-advice disclaimer

Remove/replace any order-book, institutional customer, multi-venue, or unsupported performance claims.

## 02 — Pricing `/pricing`

Visual reference: `mockups/02-pricing.png`

Only Free + Pro initially. No fake Enterprise/Institutional/API tier.

Actual production price text must be driven by configuration/Stripe product metadata where possible.

## 03 — Sign In `/login` or repository-consistent auth route

Visual reference: `mockups/03-sign-in.png`

Google OAuth + email/password. Implement only truthful security copy.

## 04 — Create Account `/signup`

Visual reference: `mockups/04-create-account.png`

Minimal friction. Google OAuth + email/password. No unsupported methods.

## 05 — Reset Password `/forgot-password` and reset route

Visual reference: `mockups/05-reset-password.png`

Do not expose account existence. Reset lifetime only if verified in config.

## 06 — Onboarding `/onboarding`

Visual reference: `mockups/06-onboarding.png`

Two lightweight preference steps plus completion/skip.

Categories:

- Cases
- Weapon Skins
- Knives
- Gloves
- Stickers & Capsules

Monitoring interests:

- Price Movement
- Supply Changes
- Activity Anomalies
- Volatility
- Price/Supply Divergence

Optional 0–5 starter watchlist assets. Skip to Terminal always available. Preferences affect defaults/emphasis only.

## 07 — Terminal `/terminal`

Visual reference: `mockups/07-terminal.png`

Primary macro view over tracked assets.

Use grounded metrics only. Candidate summary cells include tracked asset count, median observed price change, sales activity, listing delta, observed volatility/dispersion when available, and coverage/freshness.

A sample-weighted/index-like chart must be clearly labeled as prototype/derived/experimental until methodology is canonical.

Sections may include:

- market overview chart
- breadth
- movers
- supply contraction monitor
- activity anomalies

Replace unsupported “engine”, venue, execution, quorum, or order-book status copy.

## 08 — Screener `/screener`

Visual reference: `mockups/08-screener.png`

Dense quantitative query interface.

Supported filter families when data/history exists:

- category
- price
- price change
- listing change
- sales activity
- activity change
- volatility/dispersion
- drawdown only after methodology/history exists
- Price Confidence
- history/data state

Advanced condition builder can support AND-based multi-condition queries first.

Example:

```text
Listing Δ 7D < -15%
AND Activity Δ > +50%
AND Price Δ 7D BETWEEN -5% AND +5%
AND Confidence IS NOT LOW
```

Use `Sales Activity`, not `Tx`. Use `Observed Price Dispersion`, not verified order-book metrics.

## 09 — Asset Intelligence `/asset/[id]`

Visual reference: `mockups/09-asset-intelligence.png`

This is the deepest analytical screen.

Target composition:

- asset identity/header
- headline observed metrics
- multi-series historical chart for observed price + listing quantity + sales activity when enough history exists
- observed market condition explanation
- Price Confidence explanation/breakdown
- price structure
- supply
- activity
- risk/statistics grounded in available observations
- derived observation timeline
- comparable assets only if comparison methodology/data exists

Remove/replace:

- L1/L2 order book
- bid/ask walls
- Absorption Speed
- Replacement Ratio
- cross-market metrics
- individual trade timeline
- arbitrary confidence numeric score

Prefer `Observed Median` / `Observed Minimum` over misleading `floor` terminology where appropriate.

## 10 — Assets Explorer `/assets`

Visual reference: `mockups/10-assets-explorer.png`

Canonical searchable asset directory.

Clearly identify the pilot scope, e.g. `100 TRACKED ASSETS · PILOT UNIVERSE · SKINPORT GROUNDED`.

Table should support:

- Asset
- Category
- Observed Median
- available source/derived change windows
- Listings
- Sales Activity
- Confidence
- Last Observed
- Watch control

Right rail gives quick inspection and links to Asset Intelligence.

No multi-venue/order-book wording.

## 11 — Watchlist `/watchlist`

Visual reference: `mockups/11-watchlist.png`

This is a monitoring terminal, not a favorites list.

Important feature: **Since Last Visit**.

Examples of changes to show when enough stored/checkpoint data exists:

- new observed condition
- listings 42 → 34
- activity +31% → +84%
- confidence MEDIUM → HIGH

Include Needs Attention treatment and an inspection rail.

Avoid unsupported Z-scores until baseline/history methodology exists. Replace “liquidity anomaly” with grounded sparse-market / low-confidence language.

## 12 — Alerts `/alerts`

Visual reference: `mockups/12-alerts.png`

Show recent conditions satisfied, active rules, collecting rules, and rule inspection/evaluation matrix.

False→true transition semantics are mandatory; see `ALERTS.md`.

MVP delivery: email + in-app.

No webhook, order-book, bid-wall, or multi-market triggers unless separately implemented.

## 13 — Portfolio `/portfolio`

Visual reference: `mockups/13-portfolio.png`

Manual holdings MVP.

Primary analytical ideas:

- total observed value
- concentration
- value/exposure by Price Confidence
- active observed conditions
- top/category holdings
- Needs Attention
- optional cost basis/P&L only when user supplies cost basis
- portfolio history only after enough history exists

No arbitrary diversification score, accumulation signal, cross-market valuation, or Steam inventory dependency.

## 14 — Account & Billing `/settings`

Visual reference: `mockups/14-account-billing.png`

Sections:

- Account Identity
- Market & Monitoring Preferences
- Subscription & Billing
- Security & Sessions
- Danger Zone

Use Stripe Customer Portal for billing. Show only session/device information Better Auth can actually supply.

## 15 — System States board

Visual reference: `mockups/15-system-states.png`

This is a reusable component/behavior specification, not a route.

Implement the states defined in `COMPONENTS.md` and ensure every product screen can correctly render collecting, unavailable, stale, degraded, empty, locked, validation, error, and responsive states without inventing replacement data.
