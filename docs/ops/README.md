# FloatAlpha Ops V1

> **Migrations:** `npm run db:migrate` is UNSAFE against production. The
> `./drizzle` directory is shared by two separate databases. See
> [MIGRATIONS.md](MIGRATIONS.md) before running any migration.

## Preflight / existing architecture

Started from milestone `e071a16`, on `feat/cs2-quant-product`, with substantial uncommitted visual/auth-copy and market-data work. That work was preserved. Auth configuration, session helper, product routes, billing mirror, schemas/migrations, health readers, and design primitives were inspected before implementation.

Better Auth uses the Drizzle PostgreSQL adapter with `auth_users`, sessions, accounts, verifications, and durable auth rate limits. `currentUser()` resolves the session and lazily links an `app_users` profile by `auth_user_id`. Existing email/password auth requires email verification; Google OAuth is configured only when its credentials exist. Existing session freshness is 300 seconds. No admin role, MFA plugin, admin audit log, or general product-event history existed.

Authorization previously consisted of authenticated product requests plus subscription entitlements, with same-origin validation for product mutations. Collector/internal bearer credentials are unrelated to Ops and are not accepted by Ops. Stripe webhooks maintain `billing_subscriptions`; `billing_events` only retains webhook IDs for deduplication, not a subscription lifecycle history. Watchlists, holdings, saved screens, alert rules and alert events provide current usage and limited retained history. `src/lib/analytics.ts` computes market analytics; it is not user-visit telemetry.

## Security boundary

`Better Auth session → linked app user → verified email + database ADMIN role → requireAdmin()`.

`src/lib/ops/auth.ts` exports the one authoritative check. It uses the existing `currentUser()`, reloads the application role from the database using the authenticated identity ID, and returns only `{ id }`. It does not trust role claims in cookies or client state. React cache is request-scoped, not a persisted role cache. Unknown/missing roles fail closed. Role revocation applies on the next request.

The route is `/ops-c8e4`; `src/lib/ops/config.ts` centralizes links/configuration (the filesystem directory necessarily also names it). **The route obscurity is not used as authorization.** There is no email allowlist, URL backdoor, special cookie, admin secret header, or environment bypass. There are no public Ops navigation links. Sitemap/robots endpoints do not advertise the path.

The optional catch-all server page, API handler, and data-access function each require ADMIN. All five sections use the same protected page. No server actions or web mutations exist. Future actions must call `requireAdmin()` independently; a layout check is never sufficient. Anonymous page requests redirect to `/login`; APIs return 401. Non-admin/unverified page and API requests return minimal 403s. Next's documented `authInterrupts` option enables `forbidden()`; no existing auth/session settings were changed.

Pages are force-dynamic; route headers specify private/no-store and X-Robots-Tag noindex/nofollow. Metadata also supplies noindex. No admin data is stored in public Next caches. DTOs explicitly select operational fields: no auth accounts, passwords, tokens, session contents, Stripe customer/subscription identifiers, raw collector payloads, or raw error messages. Persisted public image health may retain its existing cache; user/admin responses do not.

The existing `auth_rate_limits` database table is reused with independent `ops:<app UUID>` keys. Fixed 60-second windows allow 120 authorization checks. Server render checks are request-memoized; APIs can consume two checks (entry point + DAL), yielding approximately 60 complete API reads/minute. Rate-limit failures return API 429; page failures fail closed through the framework error boundary. Existing Better Auth limits remain unchanged.

## Pages and definitions

| Section | Contents |
| --- | --- |
| Overview | Registered users, signup window, current activation, retained watch additions and alert rules; explicit unsupported funnel stages |
| Users | Email/UUID search, 25-row pages with one lookahead, app ID, email, role, signup time, verified state, plan/status, last watchlist checkpoint, current watch/alert counts |
| Product | Current watchlists/holdings/saved screens, unpaused rules, windowed alert triggers and expired email deliveries, top 20 currently watched assets |
| System | Latest 20 collector runs and latest success/failure per provider in 30 days, freshness, catalog/media counts, current tracked mapping/media coverage, persisted imagery state |
| Billing | Current Free/Pro counts by mirrored subscription status and scheduled cancellations; no Stripe requests |

Today starts at UTC midnight. Seven/thirty-day windows are rolling intervals ending at database `now()`. All timestamps are displayed in UTC; no selectable arbitrary date ranges.

Exact SQL lives in `src/lib/ops/queries.ts` and `src/lib/ops/data.ts`:

- **Signup:** `count(auth_users)` where `created_at >= window_start`; unverified accounts count as registrations. Registered users is all existing auth accounts, including those without an app profile.
- **Current activation:** count linked `app_users` for which a current `watchlist_entries` row exists. Asset views are not required because they are not tracked. Removing the last entry removes current activation. This is not historical first activation.
- **Window signup activation:** auth accounts created in the window that currently retain at least one watchlist entry. It is a current property of that signup cohort, not an activation-event count within the window.
- **Active user:** UNAVAILABLE; no trustworthy meaningful-activity history. Session timestamps and the single watchlist checkpoint timestamp are not presented as active-user counts.
- **Returning user:** UNAVAILABLE; no stored daily visits or distinct-session product events. No invented historical funnel/conversion rates.
- **Pro:** mirrored subscription status is `active` or `trialing`, `price_id` equals one of the configured monthly/annual Pro IDs, and `period_end > now()`. Matches existing entitlement logic.
- **Free:** every registered auth user who does not meet Pro criteria, including missing profile/subscription, unsupported price, expired period, past-due, or canceled subscription.
- **Watchlist additions / alerts created:** rows currently retained with creation time in the window; deletions are not recoverable historical events.
- **Alert triggers:** retained `alert_events.created_at` in window. Delivery failures use actual `DELIVERY_EXPIRED`, not a fabricated FAILED state.
- **Most watched assets:** current watchlist rows grouped by asset, count descending then name, limit 20.
- **Freshness:** latest SKINPORT observation per currently tracked asset; missing or older than existing `SOURCE_STALE_AFTER_MINUTES` is stale.
- **Media coverage:** available/missing/unverified/invalid media among nondeprecated catalog records. Counts are read, never hardcoded. Mapping coverage joins current tracked UUIDs AND exact names to persisted mappings; stale renamed mappings do not count.

Reused event data: `alert_events`, and current persisted product records. **No new telemetry events were added.** Public/asset views, screener-filter use, history-range changes, checkout starts, historical subscription starts/cancellations, general application errors and failed catalog sync attempts remain explicitly unavailable. Last committed catalog sync is evidence of successful sync only. Current subscription statuses and collector failures remain visible.

Imagery is read through existing `assetImageState()` and persisted `asset_image_cache` health. No probes run from Ops. `effectiveEnabled = configuredEnabled && providerHealthy`, expiry/circuit-breaker behavior, manual false, and existing independently scheduled health endpoint are unchanged. Catalog, collectors, observations, transformers, schedules, Price Confidence, and signals were not modified.

## Forward migrations and deployment (not executed in production)

- `0003_ops_application_role`: `app_users.role` defaults to USER with a USER/ADMIN database check.
- `0004_ops_audit`: minimal audit table with actor, action, target type/UUID, timestamp and safe metadata.
- Generated Drizzle journal/snapshots accompany both. Historical migrations are unchanged.

Review and approve the target environment before production operations. Deployment order:

1. Confirm the existing **product** database and its migration history, take the normal backup, and rehearse in an isolated environment. Never point this at a collector database by accident. No new role becomes ADMIN by migration.
2. Run `PRODUCT_DATABASE_URL='<explicit direct target URL>' npm run db:migrate:product` using the normal deployment secret mechanism. This runs registered forward migrations; existing recorded migrations are skipped. Review lock/maintenance implications for the role column on a large user table.
3. Deploy the reviewed application version. Existing Better Auth, verified-email delivery, billing mirror, and separate catalog/image database configuration must be provided. Do not switch the auth system or weaken cookie settings. The role migration must precede code that selects the new column.
4. Identify the existing verified owner identity operationally, using a bound parameter in a trusted database console: `SELECT id, email_verified FROM auth_users WHERE email = $1;`. Verify the intended account. Email is used ONLY for operator lookup.
5. Explicitly assign the selected UUID:

   ```sh
   PRODUCT_DATABASE_URL='<explicit direct target URL>' \
     node --import tsx scripts/ops-role.ts '<existing auth-user UUID>' ADMIN '<operator identifier>' --apply
   ```

   The CLI requires an existing verified auth identity, creates its linked app profile if absent, locks rows, assigns the role, and inserts a `SET_ROLE` audit record in the same transaction. No first-user/domain inference. Use the same command with USER to revoke. Audit metadata is restricted to previous/new role; no secret values or request bodies are recorded.
6. Sign in using existing Better Auth and visit `/ops-c8e4`; verify non-admin denial and private headers in the deployed environment.

Future mutation audit contract: actor = authenticated admin app UUID; action = explicit allowlisted operation; target type/UUID; database timestamp; narrowly allowlisted safe metadata. CLI bootstrap uses `cli:<operator>` as actor because it is an operator database procedure, not an HTTP admin session. Do not add web writes without independent authorization, origin checking, audit review and appropriate re-authentication for sensitive actions.

**Production was not touched or deployed.** Migrations were applied only to PGlite tests and local `127.0.0.1:55438/floatalpha_ops_review`. No owner account was assigned ADMIN. Temporary test identities exercised ADMIN and were deleted, along with their test audit/limit records. Current development auth credentials are not configured; the owner must complete existing auth setup and explicit assignment before accessing Ops. No credentials were fabricated for the real app.

## Validation and query cost

- 183 unit/integration tests pass (22 files), including 8 new Ops tests using real SQL/migrations in PGlite.
- Authorization: anonymous, USER despite stale ADMIN claims, unverified ADMIN, verified ADMIN, revocation, default-role constraint, API 429.
- Privacy, parameterized search, bounded inputs, real activation/entitlement queries, and all System SQL readers tested.
- Existing actual Better Auth adapter tests cover signup, verification, sign-in, session, password reset and logout. Billing/entitlement and product regression tests pass. Live Google OAuth was not exercised: no external credentials/account round trip; its implementation is unchanged.
- Production webpack build/TypeScript and full ESLint pass.
- Three Ops production-browser tests pass; four existing public-page/auth-boundary regressions pass across desktop/mobile. Screenshot inspected at tablet width; tables scroll within their container. All five pages carry private/no-store and noindex; sitemap/robots/public navigation exposure checks pass.
- CLI grant/revoke and transactional audit verified on a temporary local identity, then removed.

Measured local production-browser run: three synthetic identities, no production data. Product overview/users/product/billing SQL took 0–1 ms; catalog aggregate against the existing local catalog took 46 ms. Navigation plus its subsequent API verification took overview 94 ms, users 55 ms, product 47 ms, system 192 ms, billing 48 ms. These are combined verification durations, not pure server response timings or production-scale benchmarks. See `reports/ops/timings.json` and browser report.

Most expensive queries are catalog/media aggregate scans, current product totals/top watched ranking, and paginated user search. Exact current totals necessarily scan current membership tables; no product-event history is loaded into Node. Product SQL has a 5-second statement timeout; catalog uses its existing 5-second timeout. User list returns at most 26 rows, limits search to 100 characters, caps pages at 400, and performs indexed per-user counts only on the selected page. Email substring search is a scan at V1 scale; consider a trigram index only when measured production volume warrants it. Provider queries use existing source/time and asset/source/time indexes and 30-day windows. Mapping reconciliation reads at most 10,000 tracked identities; exceeding that fails to UNAVAILABLE rather than truncating a reported percentage.

The isolated browser environment deliberately had no market DATABASE_URL; collector/freshness/mapping panels correctly showed UNAVAILABLE, so no market-production timing is claimed. Their SQL was executed successfully in isolated database tests. No production performance claim is made. Failed health readers return generic unavailable states independently; successful panels remain usable.

To rerun browsers, apply migrations to an isolated local database named `floatalpha_ops_review`, start a separate app build at `http://127.0.0.1:3014` with that PRODUCT_DATABASE_URL and a disposable Better Auth secret/URL, then run:

```sh
OPS_TEST_DATABASE_URL='postgresql://<local user>@127.0.0.1:55438/floatalpha_ops_review' \
OPS_TEST_AUTH_SECRET='<same disposable server secret>' \
  npx playwright test --config playwright.ops.config.ts
```

The suite rejects non-loopback/database-name targets and deletes its temporary identities. No auth bypass is added to the application. Normal `npm run dev` now uses port 3338 at the user's request; existing product Playwright configuration explicitly retains port 3000.

## Deferred

Mandatory admin MFA (no existing plugin), sensitive-action re-authentication, expanded audit/support tools, feature flags, first-party visit events/cohorts, materialized aggregates, and richer application error history are optional future work, not V1 additions.
