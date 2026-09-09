# cs2-quant production readiness — 2026-09-09

Production: https://cs2-quant.vercel.app
Deployment: dpl_CvtRnuxAvYnczqjcyhNKyVrWnyQH (iad1).

- All six runtime/schedule environment variables exist in Vercel production and match the verified local values. Secret values are omitted from reports.
- Both migration hashes and journal timestamps match production. No pending migrations; no schema writes were needed.
- Four application tables, required indexes, unique window claims, source mappings, and enabled append-only observation trigger verified.
- Exactly 100 approved assets are tracked. Scheduled 17:55 and 18:00 UTC runs both succeeded and each persisted 100 observations.
- Root 200; unauthorized health and collector 401; GET collector 405; authenticated health and asset history 200. Protected successful JSON responses use no-store.
- 55 tests, typecheck, lint, local production build, and Vercel build passed. Production dependency audit: zero reported vulnerabilities.
- Experiment starts 2026-09-09T17:55:00Z. First-day reporting ends 2026-09-10T17:55:00Z. The first closed window reports one expected, one claimed, zero missing, 100 expected/inserted observations, and no anomalies.
- No changes to collection behavior during this audit. Earlier five-asset documentation is retained as historical evidence; README current status was corrected.

Known limitations: cron-job.org management API returns 401; saved settings cannot be independently read back, although scheduled production execution and five-minute cadence were observed. Its API key is not required by the collector runtime. Actual Neon provider usage has not been retrieved. The 24-hour period has not elapsed; interim results are not a reliability conclusion. The report script is ready, but no automatic assistant follow-up has been scheduled.

Evidence: production-env-audit.json, production-db-audit.json, production-endpoint-audit.json, collection-experiment.json, experiment-latest.json.
