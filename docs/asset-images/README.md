# Optional asset imagery

Imagery is presentation-only. Product pages now receive canonical metadata/media through a batched catalog database lookup; see [Catalog V1](../catalog/ARCHITECTURE.md). They fetch supplied source URLs directly and no longer use the name-based resolver. `config/asset-images/catalog.json` and the old proxy remain only for compatibility. Asset identity, market observations, collectors, transformers and watchlist endpoint authentication are unchanged.

## Configuration and first render

Only trimmed, case-insensitive `ASSET_IMAGES_ENABLED=false` disables configuration; absent means enabled. Effective state is configuration AND a fresh persisted HEALTHY decision. Manual false skips persistence reads and probing. Missing, expired or unavailable health fails closed to text-only.

The market layout reads a cached persistence snapshot before rendering. It never probes Steam. Enabled HTML includes image wells and stable image src URLs immediately; browser artwork downloads do not block HTML. The client uses that initial decision without a redundant hydration fetch; status polling starts after one minute and reads the same snapshot, with no external probes. The Next Data Cache caches these small reads for 30 seconds. Cold reads may include database latency; warm reads avoid it.

## Independent health refresh

Local `next dev` bootstraps provider health in a background startup timer and refreshes every ten minutes. This timer does not delay server readiness or run on page requests; persistence errors retry after one minute. Set `ASSET_IMAGES_DATABASE_URL` to a migrated local imagery database. The timer is development-only; production still requires the external schedule below. Timer writes become visible through the normal 30-second read cache expiry.

`POST /api/internal/asset-images/health` requires `Authorization: Bearer <CRON_SECRET>`. Only this endpoint performs provider probes. It keeps the previous threshold: two five-image rounds, one second apart, at least four successful samples in each round. It stores the report in `asset_image_cache`, then invalidates the health-read cache. Individual delivery failures never write provider health.

Configure a separate cron-job.org POST every **10 minutes**, with a 30-second request timeout, using that endpoint and header. Do not alter the existing Skinport collection schedule. Bootstrap with one successful protected POST before routing traffic to the updated build. Health snapshots expire after 20 minutes; a stopped schedule therefore fails closed instead of retaining HEALTHY forever. Client propagation remains eventual (one-minute poll plus cache/platform propagation); it is not an instantaneous global kill switch.

The endpoint and migration are implemented and tested locally. The production migration, bootstrap, deployment and separate schedule have **not** been performed in this pass. Without bootstrap/scheduling, imagery correctly stays or becomes text-only.

## Persistence and rollout

A single optional-imagery table holds health and resolution metadata, never artwork bytes or market data. Runtime connection precedence is `ASSET_IMAGES_DATABASE_URL`, then `PRODUCT_DATABASE_URL`, then `DATABASE_URL`. This allows an isolated imagery database in development and reuse of the application database in production.

Apply the idempotent `db/asset-images/001_cache.sql` using:

```sh
ASSET_IMAGES_DATABASE_URL='<intended migration target>' npm run db:migrate:imagery
```

The migration script requires an explicit target and never silently falls back to the collector database. This scoped migration is separate from the existing Drizzle market/product migration chain. Supply the same target to the deployed runtime if it differs from its normal application database. No new API secret is required: refresh uses the existing CRON_SECRET. Use a direct database URL for migration.

Rollout order: migrate intended target → deploy with the matching database URL and CRON_SECRET → bootstrap protected refresh → verify status is HEALTHY and HTML contains wells → enable the independent 10-minute POST schedule. Check the refresh job and checkedAt timestamp operationally.

## Legacy proxy resolution caching and delivery

The retained `/api/asset-images/[name]` compatibility route persists resolution states under exact, versioned name keys. Normal product pages do not use this route:

| State | Retry interval | Meaning |
| --- | --- | --- |
| AVAILABLE | Successful bytes cached 24 hours | Usable decoded artwork |
| MISSING | 24 hours | Upstream 404/410, or no catalog entry |
| UNUSABLE | 24 hours | Source exceeds the existing 2 MB bound |
| TEMPORARY_FAILURE | 60 seconds | Transport, upstream or other validation failure |

Catalog misses need no resolver request. Persisted negative states suppress upstream fetches across navigation, processes and deployments until expiry. Negative HTTP responses also carry matching browser/CDN cache TTLs. Successful transformed bytes use the Next Data Cache and browser/CDN caching (one day / seven days, one-day stale-while-revalidate). URLs use stable `?v=2`, never timestamps. Simultaneous first-ever requests can duplicate work before a result is persisted; subsequent requests honor the stored retry time.

The three reported capsule failures were actually Steam HTTP 200 PNGs of approximately 6 MB, rejected by the existing 2 MB proxy bound. The legacy route records UNUSABLE/SIZE_LIMIT for them. Catalog V1 pages use exact mapped source URLs and all three now load directly. The proxy limit was not raised. No negative resolution updates global health. Public cached bytes are not revoked by turning the feature off; UI effective state still removes all wells.

Legacy proxy delivery rejects redirects and non-allowlisted hosts, has a four-second upstream timeout, validates content/signature and full decoding, and caps decoded input at 16 million pixels. Only fully transparent exterior padding is trimmed; even alpha=1 edges survive. WebP output fits 320×208 without enlargement or aspect distortion. Direct catalog source media is not transformed; its optional sync-time inspection and limits are documented in [canonical media](../catalog/MEDIA.md).

## Presentation and authentication

Tables retain 44×36 neutral wells; details use 160×104. A slightly lighter slate background and subtle border separate dark artwork without colored glow. Loading fades opacity over 120ms (disabled for reduced motion). Individual failures hide artwork inside the reserved well; global off removes the entire well. Cached loads/errors completed before hydration are handled explicitly.

Server-verified session state is passed to watch buttons. Anonymous rendering performs no watchlist GET; an anonymous click navigates directly to login. Authenticated requests continue using the existing protected endpoint.

See `reports/asset-images/performance/REPORT.md` for timings, acceptance evidence and deployment limits.
