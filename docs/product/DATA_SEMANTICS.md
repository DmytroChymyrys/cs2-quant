# FloatAlpha Data Semantics

This document governs how stored data is named, interpreted, displayed, and transformed. It overrides copy found in screenshots when the screenshot implies unsupported source capabilities.

## 1. Current source model

The MVP is grounded primarily in **Skinport** public market-wide REST data.

Verified source semantics used by the current collector include:

- item/pricing/availability snapshots
- listing quantity
- aggregated sales-history statistics over published source windows

The collector does **not** establish that FloatAlpha has a live order book, trade tape, individual execution stream, bid/ask depth, or multi-venue consensus.

## 2. Observation terminology

Use:

- `observation`
- `market observation`
- `observed at`
- `observation history`
- `collector run`
- `listing quantity`
- `sales activity`
- `aggregated sales activity`
- `observed median price`
- `observed minimum price`
- `observed mean price`
- `observed maximum price`
- `observed price dispersion`

Avoid unless a future source actually supports it:

- tick / market tick
- transaction event
- trade event
- execution
- trade tape
- realized trade feed
- order book
- bid/ask depth
- venue consensus

## 3. Time semantics

- `observed_at` means the time FloatAlpha collected/stored the observation.
- Source-provided update times, when available, should be stored separately as source timestamps.
- Separate source endpoints/caches are not atomic. Do not describe a combined observation as a perfectly synchronized market snapshot unless that guarantee is established.
- Source age and staleness are different from normalization or collector errors.

## 4. Null versus zero

A null value is not the same thing as zero.

Examples:

- `0` sales means a source explicitly represented zero activity for the relevant field/window.
- `null` means unavailable/not published/not applicable/unknown according to the source mapping.
- zero listings, if explicitly observed, is a legitimate data value and must not render as `UNAVAILABLE`.

UI components must preserve this distinction.

## 5. History windows

Never infer historical windows merely because a UI asks for them.

For a derived metric requiring N days of FloatAlpha observation history:

- if enough history exists: calculate and display the metric;
- if collection is still progressing: render `COLLECTING` and, when useful, show the accumulated coverage;
- if a calculation needs more valid observations than are available: render `INSUFFICIENT HISTORY`;
- do not backfill fabricated values from a mockup.

Source-published aggregate windows may be displayed as source facts if the field truly comes from the source, but they must not be falsely presented as FloatAlpha's own event-level history.

## 6. Price Confidence

Price Confidence measures **the reliability/support of an observed market price**, not future direction.

Initial labels:

- `HIGH`
- `MEDIUM`
- `LOW`

The eventual formula may consider grounded evidence such as observation availability, listing quantity, sales activity, price-field completeness, and dispersion/stability where actually derivable.

Rules:

- no directional interpretation;
- no “chance price goes up” interpretation;
- no arbitrary numerical score until the formula and calibration are explicitly validated;
- no order-book-depth inputs unless an order-book source actually exists;
- expose enough explanation in Asset Intelligence for a user to understand why a classification was assigned.

## 7. Data semantic state badges

Supported global data states:

- `GROUNDED` — directly sourced/faithfully normalized observation
- `DERIVED` — calculated from grounded observations using documented logic
- `EXPERIMENTAL` — exploratory model/metric not yet canonical
- `COLLECTING` — insufficient elapsed history but data collection is progressing
- `UNAVAILABLE` — source/capability/data is not available
- `STALE` — latest observation is older than the product's freshness threshold

`EXPERIMENTAL` must not visually masquerade as grounded truth.

## 8. Supply semantics

Use `listing quantity`, `listings`, `supply`, and `listing change` only according to what the source actually publishes.

Supply contraction or expansion is not inherently positive or negative. Do **not** automatically color contraction red or expansion green as if they were price P&L.

## 9. Activity semantics

Activity is based on source-supported aggregated sales statistics or derived changes in those statistics. Use wording such as `sales activity`, not `transactions` or `executions`, unless source-level individual transaction data is later introduced.

## 10. Money and precision

Persist monetary truth using exact numeric/minor-unit representations. Never persist floating-point values as the authoritative monetary representation.

Frontend formatting may round for display, but calculations should use exact stored values or an appropriate decimal library.
