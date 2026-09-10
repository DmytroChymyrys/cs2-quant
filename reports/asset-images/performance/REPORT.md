# Asset imagery performance/polish fix

Implemented and verified locally on 2026-09-10. No production deployment, Neon mutation, collection/schedule change or commit.

## Changes

- Normal page/status requests read persisted health through a 30-second Next Data Cache. Cache misses read the database only; no Steam probes occur on this path.
- Protected `POST /api/internal/asset-images/health` performs the existing two five-sample rounds, one second apart, requiring at least four successes in each. It persists the report and invalidates the read cache. Manual false wins everywhere.
- A small optional-imagery table persists health and resolution metadata. Missing upstream 404/410 responses retry after 24 hours; temporary failures after 60 seconds; deterministic size-limit rejections are UNUSABLE for 24 hours. Successful transformed bytes also use shared caching. Individual failures never update global health.
- Watch buttons receive server-verified authentication state. Anonymous pages skip watchlist GET requests and anonymous clicks navigate to login without issuing a mutation. Endpoint authentication is unchanged.
- The neutral well is slightly lighter with a stronger slate border. Table geometry remains 44×36, detail imagery 160×104. No redesign or colored glow.

## Timings

Same local Next development preview on port 3012; full-response wall times, sequential requests. Before: three samples per route. After: five. Local imagery persistence uses isolated Postgres; market pages continue their existing read path. These are not production measurements or a controlled statistical benchmark.

| Route | Before median | After median |
| --- | ---: | ---: |
| `/assets` | 1,654.2 ms | 1,078.0 ms |
| `/screener` | 1,119.3 ms | 1,042.0 ms |
| `/api/asset-images/status` | 4.9 ms | 2.4 ms |

The old status cache was warm for the latter baseline samples, so this comparison does not reproduce the reported 2.2-second probe miss. Both old and new cached reads were already fast. The architectural correction is that a new cache miss can no longer invoke the ten Steam probes. The first status request included development route compilation (301.3 ms before, 227.6 ms after); subsequent new reads were 1.9–3.6 ms. Database/network/serverless cold starts can still exceed the warm target.

The separate protected refresh took **1,805 ms** and returned **HEALTHY, 10 successes / 10 samples**. That work is now independent of navigation. The user's reported 200–300 ms base-page timings came from a different environment; the local pages remained around one second, so no claim is made that all page latency was caused by imagery.

Raw evidence: [before](before.json), [after](after.json), [refresh](refresh.json).

## Reported capsule failures

All three source URLs returned HTTP 200 PNGs. They were not absent from Steam; the previous proxy converted its validation failures into generic 404 responses.

| Asset | Source bytes | New state | Repeated local delivery |
| --- | ---: | --- | --- |
| Antwerp 2022 Legends Sticker Capsule | 6,134,823 | UNUSABLE / SIZE_LIMIT | 422, 4 ms |
| Paris 2023 Contenders Sticker Capsule | 6,309,174 | UNUSABLE / SIZE_LIMIT | 422, 4 ms |
| Stockholm 2021 Legends Sticker Capsule | 6,256,143 | UNUSABLE / SIZE_LIMIT | 422, 4 ms |

The existing 2 MB limit remains. State is retained for 24 hours and negative responses are browser/CDN-cacheable for that interval. Tests prove the second resolution makes no upstream fetch. Actual local persistence records retain source HTTP 200 and the size-limit reason. Provider remained HEALTHY after all six delivery requests. Artwork is hidden inside reserved wells without changing layout. A simultaneous first-ever request can duplicate work before persistence; subsequent navigations honor the retry timestamp.

## Acceptance

- Initial `/assets` HTML contains the reserved wells and stable image src URLs before client hydration.
- No external URL probes in status/page health reads, verified on both absent and populated state in tests.
- Reload and desktop/mobile individual failure, global degradation and recovery checks pass.
- Anonymous Assets → detail → reload → watchlist click produces zero watchlist API requests; click reaches login on desktop/mobile.
- Actual `ASSET_IMAGES_ENABLED=false` yields DISABLED and HTML with no image wells or artwork source URLs; local configuration was then restored.
- [Dark-item screenshot](dark-item.png) confirms neutral separation without increased table geometry.
- [Browser evidence](browser.json), [manual-off evidence](manual-off.json).

139 unit/integration tests pass, including real PGlite migration/upsert/expiry isolation and the original market-data regression coverage. Four targeted desktop/mobile browser tests pass. Typecheck, lint, production build and git whitespace checks pass.

## Refresh and rollout

Refresh is currently verified through the protected endpoint locally. Production requires:

1. Apply the scoped `db/asset-images/001_cache.sql` migration to the intended database using `npm run db:migrate:imagery` with explicit `ASSET_IMAGES_DATABASE_URL`.
2. Deploy with the matching runtime database connection and existing CRON_SECRET.
3. Bootstrap with one protected POST and verify HEALTHY status and initial HTML wells.
4. Configure a **separate cron-job.org POST every 10 minutes**, 30-second timeout, `Authorization: Bearer <CRON_SECRET>`, to `/api/internal/asset-images/health`. Leave the Skinport collector schedule unchanged.

Snapshots expire after 20 minutes, so missed refreshes fail closed. No request-triggered probes are used as a recovery fallback. With no bootstrap/schedule, imagery stays or becomes text-only. The existing two-round health threshold and global fallback behavior remain; snapshot expiry is now the freshness bound for independent scheduling. Production migration/bootstrap/scheduling were not executed in this pass.

Full configuration and rollout details: [imagery documentation](../../../docs/asset-images/README.md). Existing unrelated uncommitted work remains in the working tree; [git status](git-status.txt).
