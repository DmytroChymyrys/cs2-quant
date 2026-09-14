# Stripe Sandbox subscriptions

Implementation is on `feat/stripe-sandbox`. Real Stripe validation and a billing staging deployment are pending credentials and approved Pro pricing. The existing public visual demo and production collector are unchanged.

## Existing architecture

FloatAlpha already uses Better Auth (verified email/password or Google), Drizzle/Postgres account records, Free/Pro capabilities, `/pricing`, and `/settings`. Stripe SDK 22.6.2 was already installed. This change extends those components rather than introducing a second account system. Checkout and Portal are Stripe-hosted; no card fields or payment details enter FloatAlpha.

`POST /api/product/billing/checkout` authenticates the session and checks the request origin. It takes only a monthly/yearly interval, validates the configured Sandbox price, serializes creation per user, links the Stripe customer, and reuses a pending matching Checkout. User metadata comes from the server. Return destinations derive from `BETTER_AUTH_URL`.

`POST /api/stripe/webhook` validates the signature against the raw body and rejects live-mode events. It retrieves current subscription state, verifies customer/account ownership, and commits the subscription plus unique event receipt in one transaction. Failed synchronization returns 503 without a receipt so Stripe can retry. Retries and out-of-order deliveries cannot overwrite newer subscription state. Stripe API calls have bounded timeouts/retries; ordinary entitlement requests never call Stripe.

`entitlements(userId)` remains the single server-side Free/Pro capability function used by product APIs. Pro requires a configured Pro price, active/trialing status, and a future current-period end. Pending, past-due, unpaid, paused, incomplete, expired, or canceled subscriptions are Free. Scheduling cancellation preserves Pro only while those access conditions hold. No new trials are offered. Multiple subscription items do not grant Pro.

`GET /api/product/billing/status` exposes only the authenticated account's plan/status/end/cancellation/manage availability. A Checkout success return polls this saved state for at most 30 seconds; the redirect never grants access. `/settings` displays the saved subscription and opens the own-customer Portal through `POST /api/product/billing/portal`.

## Environment and database isolation

Use a **separate clean checkout and dedicated account-only database** for billing staging. Do not launch this mode in a directory containing this workstation's existing `.env` / `.env.local`: Next loads those files, and the isolation guard correctly rejects their collector credentials. Do not edit or delete those existing environment files.

Copy `config/billing-sandbox.env.example` to `.env.billing-sandbox.local` in the clean checkout. The completed file is gitignored. Configure secrets there or in an equivalent staging secret store, never in source or browser code. `STRIPE_SECRET_KEY` must start with `sk_test_`. Hosted Checkout needs no publishable key.

Required staging configuration:

- `FLOATALPHA_BILLING_SANDBOX=true`, `PRODUCT_ANALYTICS_MODE=demo`, and `VERCEL_ENV=preview` for a production build.
- `PRODUCT_DATABASE_URL` for an isolated account database, plus `BILLING_DATABASE_NAME` matching its database name exactly.
- `BETTER_AUTH_URL` equal to the actual billing staging origin and a dedicated `BETTER_AUTH_SECRET`.
- Real test-account sign-in configuration: existing Resend email delivery/from address or Google OAuth. Email verification remains required; no bypass was added.
- Sandbox Stripe secret, webhook signing secret, configured monthly and/or annual Price IDs, and the setup-created Portal configuration ID.

Do not set `FLOATALPHA_DEMO_PREVIEW`: that is the existing credential-free, read-only visual demo mode. Billing mode rejects production, collector/provider credentials, generic `DATABASE_URL`, and market database URLs. Its request routing permits only auth, billing, and image-status APIs; it refuses internal APIs and Ops. Product market pages display the existing demonstration data. Market mutations are intentionally unavailable in this staging environment; feature entitlement enforcement is covered by the existing server tests.

The dedicated migration entry point is:

```sh
npm run db:migrate:billing-sandbox
```

It loads only `.env.billing-sandbox.local`, verifies the actual database name and public relations, refuses non-account tables and pooled migration connections, and runs only `drizzle-billing`. Start with an empty dedicated database. Do not use the general/product migration commands here: their history includes market tables. An existing account schema without this separate migration ledger requires deliberate migration-baseline reconciliation, not a blind rerun.

The migration creates eight public tables: `app_users`, `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_rate_limits`, `billing_subscriptions`, `billing_events`; Drizzle also tracks its migration in its own schema. No account-column expansion or market-schema changes were needed.

## Prices and Portal setup

The checked-in Pricing page has Free at $0 and Pro unavailable; it contains no approved monthly/yearly amount. **Do not invent prices.** First supply approved amounts or matching existing Sandbox Price IDs:

- `STRIPE_PRO_MONTHLY_PRICE_ID`
- `STRIPE_PRO_ANNUAL_PRICE_ID`

With existing IDs configured, run `npm run billing:setup:sandbox`. To create prices, pass `--monthly-cents=<approved integer>` and/or `--yearly-cents=<approved integer>` after `--`. No fallback/default amount exists. Unconfigured intervals remain unavailable. The setup validates USD recurring Sandbox prices, creates/reuses FloatAlpha Pro, creates an end-of-period cancellation Portal configuration, and writes only the resulting mappings into the gitignored file. It enables cadence changes only when both prices exist. Setup uses test credentials exclusively and prints no secrets.

Use a dedicated Vercel Preview deployment or separate staging project. Supply only explicitly selected billing/auth variables; do not inherit this project's production collector configuration. Leave the existing visual demo and production aliases untouched. Deploy only after the remote account-only migration, then establish the stable staging origin for auth redirects. The webhook must be reachable by Stripe without Vercel SSO; adjust access only for that staging deployment or use an approved staging domain. Do not disable project-wide protection.

After a real HTTPS staging origin is configured, run the setup with `--register-webhook`. It registers `${BETTER_AUTH_URL}/api/stripe/webhook` for the installed SDK API version (`2026-08-26.dahlia`), saves the signing secret, and checks an existing endpoint's API-version compatibility. Existing endpoint secrets must be supplied because Stripe will not return them again. Sync the resulting webhook secret and price/Portal IDs into the same staging deployment and redeploy that staging environment only.

No remote billing deployment exists yet, so there is **no registered deployed webhook URL to report**. The local prepared endpoint is `http://localhost:3342/api/stripe/webhook`; Stripe CLI forwarding is required for local delivery. Do not register the public visual demo or production collector URL.

Handled events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

## Remaining real Sandbox acceptance

Using real Sandbox credentials and a verified test account, check Pricing → Checkout → return → signed webhook → Pro in Settings. Open Portal, cancel at period end, confirm Pro persists and cancellation appears; then advance a suitable Stripe test clock or wait for period end and confirm Free. Verify payment-failure state, replay the same event, switch cadence when configured, and log out/in to confirm persisted state. Preserve event IDs and redacted evidence, never keys or card data. Automated tests with mocked Stripe API reads are not a substitute for these checks.

After staging deployment, use only the existing read-only collector status/report mechanism to confirm experiment continuity. Never invoke collection as a billing test.

Stripe references: [subscription webhook behavior](https://docs.stripe.com/billing/subscriptions/webhooks), [Sandbox subscription testing](https://docs.stripe.com/billing/testing), [Customer Portal](https://docs.stripe.com/customer-management).
