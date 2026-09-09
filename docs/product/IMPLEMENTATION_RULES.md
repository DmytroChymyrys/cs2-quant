# Implementation Rules

These are non-negotiable unless explicitly revised in a later task.

## 1. Do not redesign

The final mockups and `DESIGN.md` define the visual product. Implementation should reproduce them with reusable components, not reinterpret them into a generic SaaS dashboard.

## 2. Audit before modifying

Before coding:

- inspect current git branch/status
- inspect package.json and framework versions
- inspect app/router layout and route structure
- inspect Drizzle schema/migrations
- inspect collector jobs/endpoints
- inspect tests and CI scripts
- inspect current environment variable conventions
- run the existing typecheck/lint/test/build baseline

Record any conflicts between this handoff and current code before changing behavior.

## 3. Protect the collector

Do not modify collector semantics, source identity, market normalization, cadence, duplicate-window behavior, provenance, append-only constraints, or current experiment behavior as collateral work.

## 4. Never fabricate data

If a mockup requires data that does not exist:

- render `COLLECTING`, `INSUFFICIENT HISTORY`, `UNAVAILABLE`, or another appropriate state;
- do not invent placeholder production values;
- development fixtures/storybook data may be synthetic only when clearly isolated from production runtime.

## 5. Terminology is enforced

Prohibit unsupported current terminology including:

- multi-venue / cross-market
- order book / orderbook
- execution venue
- liquidity quorum
- synchronized venues
- market consensus
- live tick / trade tape / telemetry ticks
- individual realized trades when only aggregate source history exists
- accumulation/distribution
- absorption speed
- replacement ratio
- cross-market arbitrage
- arbitrary 0–1 confidence score
- fake historical windows
- fake institutional customers/security certifications
- unsupported latency/engine/quorum metrics
- Steam sync/import unless implemented

## 6. Server truth over client decoration

Authorization, entitlements, alert state, billing state, and user-owned data mutations must be enforced server-side. Client-side disabling/hiding is not sufficient.

## 7. Exact money

Do not use JS floating-point values as persisted financial truth.

## 8. Accessible interaction

Preserve keyboard navigation, focus-visible states, labels, semantic table structure, and sufficient contrast. Dense UI is not an excuse for inaccessible UI.

## 9. Responsive implementation

Do not implement desktop screenshots as fixed 1440px canvases. Preserve desktop density while using intentional responsive behavior from the System States board.

## 10. Build in vertical slices

Do not generate the entire application in one unreviewed pass. Commit coherent phases with tests/checkpoints.
