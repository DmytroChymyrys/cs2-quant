# Free / Pro Entitlements

## Pricing direction

Initial public model:

- **Free** — genuinely useful
- **Pro** — approximately `$14.99/month`; annual pricing around `$149/year` is acceptable as a launch direction

Exact price IDs and production price points must come from Stripe/configuration, not hard-coded mockup text.

## Product principle

Price Confidence is part of FloatAlpha's identity and should remain visible on Free.

## Suggested Free capabilities

- Terminal access to the tracked universe
- Assets Explorer
- Asset Intelligence with core grounded metrics
- Price Confidence HIGH/MEDIUM/LOW
- limited screener/basic filters
- one default watchlist with a reasonable item cap
- basic portfolio holdings/valuation
- limited available history

## Suggested Pro capabilities

- advanced multi-condition screener
- saved screens
- extended observation history
- substantially larger/unlimited watchlist
- alerts
- advanced derived analytics once validated
- CSV export
- richer portfolio analysis

## Implementation rule

Treat this document as capability policy, not a reason to fake unavailable features. A paid entitlement only unlocks features that actually exist and have sufficient data.

## Centralized capability model

Keep a single entitlement policy layer and expose a typed capability object to server/client code.
