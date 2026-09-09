# cs2-quant deployment verification

Verified September 9, 2026. No commit was created.

- Production: https://cs2-quant.vercel.app
- Vercel project: `cs2-quant`, existing personal team `dmytro-chymyrys-projects`.
- Deployment: `dpl_3fFeBxdPiQ4CxdHuc1MFvNQPsC19`, status READY.
- Database: new Neon `cs2-quant`, free plan, `iad1`, Neon Auth disabled; connected to production and development.
- Both checked-in Drizzle migrations applied successfully to the real Neon database.
- Collector secret and source settings configured on Vercel; credentials are only in gitignored local environment files and Vercel configuration.
- Landing page returned 200; unauthenticated collection and health returned 401; authenticated health returned 200 and queried Neon successfully. See [deployment-checks.json](deployment-checks.json).
- First deployment attempt failed because the newly created project was treated as a static site. Explicit `framework: nextjs` in `vercel.json` corrected the issue; the second deployment succeeded.
- 43 local tests, typecheck, lint and production build passed. Vercel's production build also passed.

## First populated collection verified

The user approved exactly five smoke-test assets. They were seeded in Neon, and the deployed collector was invoked twice in the 2026-09-09 17:05 UTC bucket. The first run was SUCCESS (5,946 ms), both source HTTP statuses were 200, all five assets matched, and five observations were inserted. The second request was audited as PARTIAL / DUPLICATE_WINDOW and inserted nothing.

Both requested SQL queries were executed after collection. They returned two collector audit rows and exactly one observation for each of the five assets. The authenticated health endpoint returned 200, one successful claimed run, five tracked/fresh assets and five observations. Full actual results, normalized rows and provenance checks are in [the live smoke report](smoke-test-report.md).

cron-job.org has not been configured or enabled. Multi-day reliability, coverage and operating costs remain unmeasured.
