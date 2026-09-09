# FloatAlpha — Astra Implementation Handoff

This package is the implementation contract for building the FloatAlpha product from the approved Google Stitch mockups on top of the existing `cs2-quant` application and market-data collector.

## Core instruction

**Implement this product; do not redesign it.**

The PNG mockups define visual intent. The Markdown specifications define product behavior and data semantics. The existing repository, schema, migrations, collector behavior, and verified source capabilities define what is actually true.

## Source-of-truth precedence

When sources conflict, use this order:

1. Existing production code, database schema, migrations, tests, and verified collector/source capabilities
2. `docs/product/DATA_SEMANTICS.md`
3. `docs/product/PRODUCT.md`
4. `docs/product/ENTITLEMENTS.md`
5. Feature-specific specs: `AUTH.md`, `ALERTS.md`
6. `docs/product/SCREEN_SPECS.md`
7. `docs/product/COMPONENTS.md`
8. `docs/product/DESIGN.md`
9. PNG mockups and Stitch HTML

Screenshots are authoritative for layout, hierarchy, density, spacing, visual composition, typography, and component placement. They are **not** authoritative evidence that a metric, backend capability, market source, security property, or historical window exists.

## Package contents

- `ASTRA_IMPLEMENTATION_BRIEF.md` — coding-agent entry point and phased execution plan
- `docs/product/PRODUCT.md` — product scope and principles
- `docs/product/DATA_SEMANTICS.md` — market-data truth, terminology, confidence, and history rules
- `docs/product/DESIGN.md` — canonical Stitch design system
- `docs/product/SCREEN_SPECS.md` — route-by-route behavior and implementation corrections
- `docs/product/COMPONENTS.md` — reusable UI/component contract
- `docs/product/ENTITLEMENTS.md` — Free/Pro capability policy
- `docs/product/AUTH.md` — proposed Better Auth architecture
- `docs/product/ALERTS.md` — condition engine and false→true transition semantics
- `docs/product/BACKEND_ARCHITECTURE.md` — current/proposed application architecture boundaries
- `docs/product/IMPLEMENTATION_RULES.md` — non-negotiable engineering rules
- `docs/product/mockups/` — final visual references
- `docs/product/stitch-html/` — generated Stitch HTML for implementation reference only
- `docs/product/STITCH_AUDIT_SOURCE.md` — original Stitch audit/export source, retained for provenance only

## Important

Do not alter collector semantics as part of frontend implementation unless an explicit task requires it and the change is separately reviewed. Do not fabricate unavailable analytics to make a screen look complete; render the appropriate `COLLECTING`, `INSUFFICIENT HISTORY`, `UNAVAILABLE`, or degraded state instead.
