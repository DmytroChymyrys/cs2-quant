# Optional Steam account connection

FloatAlpha keeps email/password and the existing optional Google login as the primary account flow. A signed-in user may attach a verified Steam identity from onboarding or Settings. Steam is never required for account creation, the Terminal, Assets, Screener, watchlists or a manual portfolio.

This release verifies identity only. It does not import inventories, read trade history, change entitlements, enable Steam-only signup/login, or promise future inventory capabilities. Steam OpenID does not supply a verified email address; no synthetic email or second FloatAlpha user is created.

## Existing architecture and integration

Better Auth owns `auth_users`, sessions, provider accounts and verification records through its existing Drizzle adapter. `app_users.auth_user_id` links that identity to FloatAlpha preferences, watchlist, portfolio and subscriptions. The existing `(provider_id, account_id)` unique index prevents one Steam identity from belonging to multiple users.

`src/lib/product/steam.ts` is a Better Auth plugin, installed behind the existing `/api/auth/[...all]` handler. It reuses Better Auth sessions, signed HttpOnly cookies, single-use verification records, rate limiting and account-link adapter methods. It never creates users or sessions. `src/lib/product/steam-openid.ts` contains only the Steam-specific OpenID 2.0 protocol bridge. Better Auth's native OAuth/OIDC linking endpoint cannot directly perform Steam OpenID 2.0.

Disconnect uses Better Auth's native `POST /api/auth/unlink-account` with the account row ID and a fresh primary session. A plugin guard prevents unlinking the last usable primary login method while a link-only Steam identity remains. No auth tokens are stored for Steam.

Sources checked against the installed Better Auth package and current primary documentation:

- [Steam browser authentication and account linking](https://partner.steamgames.com/doc/features/auth)
- [Better Auth plugins and endpoint/session extension points](https://better-auth.com/docs/concepts/plugins)
- [Better Auth account linking and native unlinking](https://better-auth.com/docs/concepts/users-accounts)
- [OpenID 2.0 assertion verification](https://openid.net/specs/openid-authentication-2_0.html#verification)

## Flow and failure handling

1. `POST /api/auth/steam/link` requires a recently authenticated primary session and the application's own Origin. Its return destination is an enum: onboarding or Settings.
2. A random challenge is stored for ten minutes, bound to both the auth user and session ID. A signed, HttpOnly, SameSite=Lax cookie binds the browser. HTTPS deployments use Better Auth's secure-cookie settings. The browser navigates to Steam's fixed HTTPS login endpoint.
3. `GET /api/auth/steam/callback` verifies the cookie and atomically consumes the challenge. It requires the same still-valid session and user. A cancellation returns to the original screen without changing the account.
4. The server checks the OpenID namespace, endpoint, exact return URL, identity/claimed ID, signed fields, duplicates and nonce freshness. It performs discovery only under Steam's pinned HTTPS identity namespace, accepts Steam's known XRDS service, and directly verifies the signature at Steam. Redirects, arbitrary external endpoints and oversized responses are rejected.
5. The session is checked again after provider verification. An atomic nonce reservation prevents replay. Its deterministic UUID primary key preserves uniqueness under the installed UUID adapter; the generic Better Auth reservation helper's base64 ID would otherwise be replaced. The marker outlives the accepted nonce window, including provider clock skew. The verified SteamID is linked through Better Auth's adapter to the existing auth user.
6. Database uniqueness constraints handle concurrent callbacks. Same-user reconnects are idempotent. Another user's existing link is never moved; the UI offers recovery through the owning account or support. A user must disconnect an existing Steam identity before replacing it.

Next.js may expose its internal listener origin in `Request.url`. The callback reconstructs the configured public origin only when the actual Host header matches that origin, explicitly clearing internal ports. Untrusted Host and forwarded headers cannot select the return origin.

Provider failures, expired/replayed state, changed/revoked sessions and malformed assertions produce a recoverable message. Email auth and saved FloatAlpha data remain available. Callback errors do not log assertions, signatures, state, cookies or raw provider payloads.

## Configuration and migration

Required existing account configuration:

- `PRODUCT_DATABASE_URL`: the intended account database; use an isolated local database or development branch for development.
- `BETTER_AUTH_URL`: the canonical application origin, such as `http://localhost:3338` for local development and HTTPS for a hosted environment.
- `BETTER_AUTH_SECRET`: the existing strong auth secret, stable across instances.
- Existing email/Google configuration continues to control the primary login flow.

New flag: `STEAM_ACCOUNT_LINKING_ENABLED=true`. It is disabled when absent/false, and always disabled in the read-only public demo. No Steam API key, OAuth client secret, user token, trade URL or inventory permission is needed for this identity-only flow. The callback is `${BETTER_AUTH_URL}/api/auth/steam/callback`; its realm is the canonical origin with a trailing slash. Steam credentials are entered only on Steam's site.

Before enabling the flag, run `npm run db:migrate:steam` with an explicit direct `PRODUCT_DATABASE_URL`. The generated full-product migration and the dedicated `drizzle-steam` account-only migration add only a partial unique index on `auth_accounts(user_id) WHERE provider_id='steam'`. The account-only command uses its own `drizzle_steam` migration journal and does not replay market or billing migrations. Both paths use the same idempotent index definition; the generated product snapshot includes it so later schema generation will not propose a duplicate. The script never falls back to `DATABASE_URL`. If conflicting legacy links exist, migration fails; it does not silently delete or reassign them.

Test the migration and account flow in isolation before a hosted rollout. No production migration or Steam feature deployment was performed as part of this implementation. Disabling the flag stops new links but leaves existing connection display and native disconnect available.

## UI and data handling

Onboarding adds an optional/recommended connection card and **Maybe later** action. Skipping moves focus to the existing market preferences; completing onboarding never depends on Steam. Settings adds Connected Accounts with the verified SteamID, connection date, recoverable outcomes, reauthentication prompt and a disconnect confirmation.

The connection card explains the actual data received and its use. It includes expanded privacy/removal details. There are no claims about automated portfolio setup, inventory monitoring, private data or trade history. No contributor/data-sharing consent is inferred.

Stored persistent fields are the existing account row's user ID, provider `steam`, verified SteamID and timestamps. Display names, avatars, permissions/scopes, credentials and provider payloads are not collected. Disconnect deletes the account row; deleting the FloatAlpha auth user also removes it by the existing cascade. Watchlist, manual portfolio, preferences and subscription remain when Steam alone is disconnected.

Temporary challenge records contain the auth/session identifiers and a fixed return destination; accepted nonce markers contain only a hash and `used`. Challenges become invalid after ten minutes; nonce markers expire within eleven minutes to cover the permitted one-minute provider clock skew. Later Steam connection attempts remove expired Steam records through the existing adapter; Better Auth may also remove expired records during its normal verification lookups; expiry is an authorization deadline, not a promise of immediate physical deletion during inactivity. Infrastructure backups/log retention follow the account database/hosting policy; this code does not erase provider-owned records or backups.

## Verification

Automated tests run the actual Better Auth handler and Drizzle adapter against disposable PGlite databases. Steam network responses are mocked. Coverage includes primary signup/login, successful linking without duplicate users/tokens, cancellation, same-user reconnect, conflicts, native disconnect, recovery-method protection, request origin, session binding/revocation/freshness, atomic replay handling, unique-index races, malformed assertions, discovery and provider failures.

Browser validation uses a separate local database and app with simulated Steam responses and email delivery blocked. It exercises optional onboarding, completion without Steam, cancellation, connected Settings, confirmation/disconnect, errors and mobile layout. It does not claim a real Steam sign-in. A consenting user's end-to-end sign-in on Steam remains a manual rollout check.

No collector, provider transformer, observation schema, collection cadence, pricing, Stripe implementation, hero or production environment change is included in this task.
