# FloatAlpha Backend Architecture

This is the intended MVP architecture. Before coding, Astra must audit the current repository and reconcile this proposal with the actual code/schema. Existing production collector behavior wins when there is a discrepancy.

## 1. Platform

Keep the current simple stack:

- **Next.js + TypeScript**
- **Vercel** for application deployment
- **Neon Postgres** for persistent data
- **Drizzle ORM** for schema/query access
- **cron-job.org** calling guarded scheduled endpoints
- **Skinport REST** as the initial market-data source

Do not introduce AWS, Redis, Kafka, Redshift, ClickHouse, or a separate microservice topology for the MVP unless a demonstrated scaling requirement requires it.

## 2. Existing market-data boundary

The market collector is an independent production concern.

Existing core concepts include:

- `assets`
- `asset_source_mappings`
- `collector_runs`
- append-only `market_observations`

Astra must inspect actual migrations/schema before assuming column names.

**Rule:** frontend/product work must not silently rewrite collector semantics, market identity logic, source matching, cadence, provenance, or append-only guarantees.

## 3. Product-domain additions

Prefer separate application-owned tables/modules for:

- users
- auth identities/accounts/sessions as required by Better Auth
- user market/monitoring preferences
- watchlist entries
- watchlist visit/checkpoint state
- alert rules
- alert evaluation state
- alert events/deliveries
- portfolio holdings
- optional portfolio cost basis
- Stripe customer/subscription references
- centralized entitlement state/cache if needed
- in-app notifications

Use internal UUID primary keys for application domain entities.

## 4. Authentication

Use **Better Auth** backed by Neon/Postgres for the initial product.

Initial methods:

- Google OAuth
- email + password

Do not add Steam, Discord, SMS, passkeys, MFA, enterprise SSO, or magic-link variants unless separately requested.

### Identity boundary

Domain records should reference an application-owned UUID, not a provider-specific subject.

Recommended conceptual model:

```text
app_users
  id UUID PK
  ...application profile fields

auth_identities
  id UUID PK
  app_user_id UUID FK -> app_users.id
  provider
  provider_subject
  unique(provider, provider_subject)
```

If Better Auth's own schema should remain canonical for auth internals, add an application identity bridge rather than coupling every domain table to a third-party/provider identifier.

## 5. Auth abuse protection

- use durable/database-backed rate-limit state where Better Auth supports it in this deployment model;
- add Cloudflare Turnstile to high-risk public auth flows where appropriate;
- do not advertise exact rate limits, reset lifetimes, “bank-grade” protection, or cryptographic guarantees unless configured and verified in code.

## 6. Billing

Use **Stripe** for subscriptions.

Initial product tiers:

- Free
- Pro

Use Stripe-hosted/official flows where practical:

- Checkout or equivalent subscription creation flow
- Stripe Customer Portal for billing method/subscription management

Store Stripe identifiers and billing state; do not store card details.

## 7. Entitlements

Entitlement decisions must be centralized server-side.

Avoid scattered UI/business logic such as:

```ts
if (user.plan === 'PRO') { ... }
```

Prefer a capability model, for example:

```ts
entitlements.canUseAdvancedScreener
entitlements.canCreateAlerts
entitlements.maxWatchlistAssets
entitlements.historyWindowDays
```

Client gating is for UX only. Server actions/API routes must enforce entitlements independently.

## 8. Watchlist

MVP: one default watchlist per user is sufficient.

Store when an asset was added and enough checkpoint/visit state to support **Since Last Visit** comparisons without manufacturing historical values.

## 9. Alerts

Rules operate on canonical derived/grounded metrics. Alert evaluation state must persist across cron invocations so condition transitions can be detected reliably.

See `ALERTS.md`.

## 10. Portfolio

MVP holdings are entered manually.

Do not require Steam inventory integration. A holding should reference a canonical internal asset and user-supplied quantity; cost basis is optional.

Observed valuation must make clear when one or more holdings have LOW/UNAVAILABLE/STALE price confidence/data.

## 11. Derived analytics

Initially compute simple derived metrics from stored observations using straightforward server queries/services.

As history grows, avoid repeatedly scanning all raw observations for every screener or dashboard request. Introduce precomputed/rollup tables/materialized aggregates only when actual query patterns justify them.

Do not create a speculative data warehouse architecture for the MVP.

## 12. Scheduling

Continue using the existing guarded cron endpoint approach where appropriate. Alert evaluation and maintenance jobs can follow the same pragmatic model initially, but must be idempotent and safe against duplicate delivery/evaluation.

## 13. Error and degradation model

Backend responses should allow the UI to distinguish:

- source degraded
- source unavailable
- stale data
- collecting history
- insufficient history
- legitimate zero
- unavailable/null
- network/application error

Do not collapse all of these into an empty value or generic 500 page.
