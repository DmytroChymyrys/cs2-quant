# cs2-quant product implementation

This branch implements the supplied product handoff with the user's current FloatAlpha product name (repository and deployment identifiers remain cs2-quant). The original mockups are retained as visual references, not claims about source capability.

## Implemented

- Reusable dark theme, local Inter/JetBrains Mono fonts, responsive public/auth/terminal shells, semantic badges, panel/table/metric primitives, dialog confirmation, skeletons, chart container and explicit data states. Development component gallery returns 404 in production.
- Landing and Free/Pro pricing; actual Pro prices are retrieved from configured Stripe prices. No invented launch prices.
- Better Auth email/password, Google configuration, email verification/reset, database-backed rate limits, optional Turnstile, UUID auth tables and app-owned identity bridge. Reset emails use a Resend adapter; no email has been sent during implementation.
- Terminal, searchable explorer, asset intelligence, basic and advanced AND screener, saved screens, entitlement-guarded CSV export. Market queries are server-side and bounded. Source aggregates, collector observations, nulls and zeros remain distinct.
- One default watchlist; persisted observation-ID checkpoints drive Since Last Visit comparisons. Users acknowledge the observations actually displayed, not an unseen newer collector snapshot.
- Durable alert rules, previous truth state, false-to-true event creation, re-arm, source/collecting states, in-app events, idempotent email delivery and separate protected evaluator endpoint. It has not been scheduled.
- Manual portfolio with exact-decimal value/cost/P&L, concentration, category exposure, missing-price subtotal and attention states. No Steam sync.
- Free/Pro server-side capability policy, Stripe Checkout, Customer Portal, signature-verified idempotent subscription webhook, account preferences, session details, sign-out and confirmed account deletion. Active subscriptions block account deletion.

## Semantic corrections and limitations

Price Confidence classification and advanced statistical models have no validated methodology in the handoff; they remain UNAVAILABLE. No arbitrary confidence number/label, composite market index, volatility estimate, fake baseline, order book, or trade feed is generated. The main chart displays a named asset's actual observation history. Source age and collection age remain separate.

Free limits: 20 watched assets/holdings and up to 7 days of available history. Pro: 100 watched assets/holdings, advanced/saved screens, CSV, alerts, up to 30 days. These are centralized policy values. History is bounded to 10,000 rows per asset. Personal settings currently initialize Terminal category only when one category is selected; monitoring interests are persisted for future emphasis and do not change metrics.

No product schema migrations, feature deployment, auth-provider actions, subscriptions, emails, or alert scheduling have been performed against production. The 100-asset collector, source normalization, original migrations, schedule and append-only protections are unchanged.

## Required integration setup

1. Create an isolated Neon development branch/database. Set `PRODUCT_DATABASE_URL`; `npm run db:migrate:product` requires this explicit URL and applies all checked-in migrations to it. Do not point it at production during validation. Market pages read the existing `DATABASE_URL`; product-domain operations use `PRODUCT_DATABASE_URL` when present. For complete local workflows, the isolated database must contain the tracked catalog/observation data (a Neon branch provides that).
2. Set `BETTER_AUTH_URL` to the exact app origin and generate `BETTER_AUTH_SECRET` (at least 32 characters). Use HTTPS for deployed environments.
3. Configure Google OAuth, with redirect URI `<origin>/api/auth/callback/google`; set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Configure a verified Resend sender; set `RESEND_API_KEY` and `EMAIL_FROM`. Email authentication stays disabled without delivery configuration. If a different provider is preferred, replace the small email adapter before enabling signup.
5. Configure Cloudflare Turnstile for the intended host; set both `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Set them together.
6. Configure Stripe test mode first, USD recurring Pro prices and Customer Portal. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_MONTHLY_PRICE_ID`, and optional annual ID. Deliver customer.subscription.created/updated/deleted to `<origin>/api/stripe/webhook`. Checkout return URLs do not grant access; signed webhooks synchronize it.
7. Validate Google, email delivery, Turnstile and Stripe end-to-end against the isolated database. These services were not configured in the provided environment, so real provider integration tests remain pending.
8. After accepting the isolated tests, apply migration 0002 and product environment values to the intended production database/deployment. Product and collector data must share the canonical assets/observation IDs.
9. Schedule `/api/internal/alerts/evaluate` separately with POST and the existing `CRON_SECRET` bearer header, after collection. Set `ALERT_SCHEDULE_ENABLED=true` only after verifying executions. Do not change the collector's schedule or endpoint. Alert email retries use event UUID idempotency keys within 23 hours; older pending deliveries expire rather than risking duplicate sends after provider retention.

## Validation

Baseline: 55 original tests. Product tests exercise real additive migrations with PGlite, ownership, limits, exact arithmetic, checkpoints, durable alert transitions, Better Auth signup/verification/reset/sign-out, Stripe signature verification/replays and entitlement expiry. Browser checks cover desktop/mobile navigation, real asset filtering/inspection, chart controls, auth gates, and protected mutations. Screenshots are in `reports/product/`.

The absence of production provider credentials is an integration blocker, not evidence that those providers have passed. This is implemented code with local verification, not a claim of a launched paid product.

Final local checks (2026-09-09): clean `npm ci`, 63 tests across 9 files, typecheck, lint and production build passed. All six desktop/mobile Playwright checks also passed against `next start`; `/dev/components` returned HTTP 404. Five screenshots were refreshed from the production build. `git diff` confirms no changes to collector/source modules, core market schema or original migrations.

Dependency audit retains the pre-existing four moderate development-tool findings in the Drizzle Kit / legacy esbuild chain. The suggested fix is an incompatible Drizzle Kit downgrade; it was not applied. No new runtime advisory was reported.
