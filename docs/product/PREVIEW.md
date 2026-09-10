# Isolated visual Preview

The approved visual baseline is commit `e637af5` on `preview/demo-baseline-sep10`. It preserves the earlier local product, analytics and provider work; it is not a production collector release.

The visual Preview requires all three settings: platform `VERCEL_ENV=preview`, `FLOATALPHA_DEMO_PREVIEW=true`, and `PRODUCT_ANALYTICS_MODE=demo`. Keep `NODE_ENV=production` for the optimized build. Actual Vercel production always rejects synthetic data, and a promoted demo configuration fails startup.

Only those two custom demo variables belong in the Preview deployment. No database, collector, scheduler, provider, payment, email or authentication secrets are needed. Startup and request checks reject credential contamination. The Preview proxy blocks API routes except read-only image status, all non-GET/HEAD requests (including server actions), and Ops access. The existing collector route and guard are untouched.

Demo artwork uses 32 checked-in copies of the existing original PNG bytes, with source URLs and SHA-256 hashes in `config/asset-images/demo-bundle.json`. Only isolated Preview maps those images to local static paths. Its image status describes bundled demo delivery; the production provider health cache and circuit breaker are unchanged. `ASSET_IMAGES_ENABLED=false` still disables imagery.

No new design or market-data transformations are included. Demo values remain labeled DEMO / SYNTHETIC. Account, watchlist, portfolio and billing writes are unavailable; sample portfolio/watchlist views are for design review only.

Deploy from a clean committed checkout/archive with no local environment files. Use an explicit Preview target and deployment-scoped build/runtime demo variables; never promote, push to main, change project-wide settings, or redirect cron. No migration, seed, health probe, collector or analytics job belongs in the build. Preserve the production target/environment inventory and a read-only collector baseline immediately before deployment. Verify subsequent scheduled windows after deployment.

Vercel Authentication may protect generated URLs. Share only this immutable preview deployment using a deployment-specific share link. Do not create a project-wide bypass or weaken production security.
