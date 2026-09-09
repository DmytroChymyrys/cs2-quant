# Astra Implementation Brief — FloatAlpha

You are implementing FloatAlpha inside the existing `cs2-quant` repository.

**Do not design a new product. Implement the product specified in this handoff.**

## 0. Read order

Read before coding:

1. `README.md`
2. `docs/product/IMPLEMENTATION_RULES.md`
3. `docs/product/DATA_SEMANTICS.md`
4. `docs/product/PRODUCT.md`
5. `docs/product/BACKEND_ARCHITECTURE.md`
6. `docs/product/AUTH.md`
7. `docs/product/ALERTS.md`
8. `docs/product/ENTITLEMENTS.md`
9. `docs/product/SCREEN_SPECS.md`
10. `docs/product/COMPONENTS.md`
11. `docs/product/DESIGN.md`
12. final PNG mockups
13. Stitch HTML only as implementation reference

## 1. Branching

Start from the latest clean `main` after verifying repository state.

Suggested branch:

```bash
git checkout main
git pull --ff-only
git checkout -b feat/floatalpha-product
```

If the working tree is not clean or main cannot be safely updated, stop and report the exact state rather than discarding changes.

## 2. Mandatory preflight audit

Before implementing features:

- identify Next.js/React/TypeScript versions;
- identify styling setup and existing component library;
- inspect all app routes/layouts;
- inspect Drizzle schema and migration history;
- locate market collector code and protected cron endpoints;
- locate tests and validation commands;
- locate deployment/env conventions;
- document what already exists versus what must be added;
- run baseline typecheck, lint, tests, and build.

Do **not** modify the collector during preflight.

If this handoff conflicts with verified production code/data capability, follow the source-of-truth precedence and preserve production truth.

## 3. Implementation plan

### Phase 1 — Design foundation

Implement only the reusable UI system and app shells:

- FloatAlpha design tokens
- Inter + JetBrains Mono setup
- public shell
- auth shell
- terminal/app shell
- navigation
- buttons/inputs/selects/tabs/tooltips
- tables
- metrics/panels
- semantic/confidence/signal badges
- inspection rail
- chart containers
- skeletons
- all core System States
- responsive behavior primitives

Create a private development route/storybook-like component gallery only if it fits the existing repo conventions; do not expose it publicly in production.

Acceptance gate:

- visual comparison against System States and Terminal primitives;
- responsive behavior works;
- existing test/build baseline remains green;
- no collector changes.

### Phase 2 — Public + Auth

Implement:

- Landing
- Pricing
- Sign In
- Create Account
- Forgot/Reset Password
- Better Auth integration
- Google OAuth
- email/password
- durable rate limiting where supported
- Turnstile where appropriate
- onboarding

Create necessary migrations carefully. Keep application-owned identity boundaries suitable for future auth-provider migration.

Acceptance gate:

- complete auth lifecycle tested;
- no unsupported security claims;
- onboarding preferences persist;
- unauthenticated/auth-required states behave correctly.

### Phase 3 — Core Market Intelligence

Implement against real current market observations:

- Terminal
- Assets Explorer
- Asset Intelligence
- Screener

Where history is insufficient, show canonical data states instead of mock values.

Prefer server-side query/services for data derivation. Avoid browser-side scans of large observation datasets.

Acceptance gate:

- all displayed production metrics trace to grounded or documented derived data;
- no order-book/cross-market/tick semantics;
- null vs zero preserved;
- freshness/provenance rendered correctly.

### Phase 4 — Watchlist

Implement one default watchlist and **Since Last Visit** state/checkpoint logic.

Acceptance gate:

- add/remove/watch controls work from Assets/Asset Intelligence;
- watchlist comparisons are based on stored observations/checkpoints, not fabricated deltas;
- empty and auth states work.

### Phase 5 — Alerts

Implement:

- alert rule persistence
- rule builder
- evaluation worker/cron path consistent with current infrastructure
- durable previous-state storage
- false→true trigger semantics
- re-arm after false
- in-app notification
- email notification
- collecting/degraded/unavailable states

Acceptance gate:

- duplicate cron runs do not duplicate alert events;
- true→true does not notify again;
- false→true does;
- history-dependent rules stay COLLECTING until evaluable.

### Phase 6 — Portfolio

Implement manual holdings:

- asset
- quantity
- optional cost basis
- observed valuation
- confidence exposure
- concentration
- Needs Attention

No Steam sync.

### Phase 7 — Stripe + Entitlements

Implement:

- Free / Pro
- Stripe customer/subscription integration
- Customer Portal
- webhook synchronization if needed for Stripe state
- centralized server-side entitlement service
- Pro gates/locked states

Do not create Enterprise/API tiers.

### Phase 8 — Hardening

- responsive pass
- accessibility pass
- route/error-state pass
- performance/query review
- cache/revalidation review
- security review
- end-to-end tests for critical workflows
- remove development fixtures/dead concepts

## 4. Commit discipline

Prefer small coherent commits, e.g.:

```text
docs: add FloatAlpha implementation contract
feat(ui): add FloatAlpha tokens and primitives
feat(ui): add app shells and system states
feat(auth): add Better Auth flows
feat(market): add terminal and assets explorer
feat(market): add asset intelligence and screener
feat(watchlist): add monitoring and since-last-visit
feat(alerts): add transition-based alert engine
feat(portfolio): add manual portfolio intelligence
feat(billing): add Stripe entitlements and customer portal
```

Do not hide unrelated refactors inside feature commits.

## 5. Visual implementation rule

Use PNGs for final appearance and layout. Use Stitch HTML as a helpful measurement/style reference, **not** as production code to paste wholesale.

Avoid fixed screenshot replication. Build reusable, accessible React components that naturally produce the same composition.

## 6. Stop conditions

Stop and report rather than guess when:

- repository state is dirty/ambiguous;
- a migration conflicts with existing production data;
- a mockup requires a capability not supported by current source/schema;
- a proposed collector change appears necessary;
- auth/billing environment requirements are absent and block integration;
- data semantics conflict with current verified collector behavior.

## 7. Definition of success

The finished product should look like the approved FloatAlpha mockups while being more truthful than the mockup copy. Every production metric should be grounded or documented as derived, every unavailable history window should say so, and product logic should remain simple enough for the current Vercel + Neon MVP architecture.
