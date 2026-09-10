# Ops V1 frozen milestone

This milestone contains the approved read-only Ops console, role/audit migrations, authorization helper, explicit owner-role CLI, and associated tests/documentation. It contains no product telemetry or attribution implementation and no production operations.

The exact staged snapshot was exported independently of the working tree and verified:

- 141 unit/integration tests passed across 19 files.
- Full ESLint passed.
- Production webpack build and TypeScript passed.
- Three Ops browser tests passed against that production build, with temporary local identities. Tests covered anonymous/USER/unverified-ADMIN denial, verified-ADMIN access, revocation, private/noindex responses, navigation exposure, and responsive containment.

The original README, timing report, screenshot and browser report describe the earlier complete working-tree verification (183 tests and seven browser checks). Those historical counts include uncommitted work outside this milestone. They are retained as implementation evidence, not claimed as results from this commit's isolated snapshot. See `reports/ops/milestone-browser.json` for the separate milestone browser run. Health sources were intentionally unconfigured in this final isolated browser run; SQL coverage remains in the database tests.

Existing visual work, market-data refactoring, auth copy, and the separately requested development-port change remain uncommitted and untouched. In particular, the README's port-3338 note describes the current local working tree; this Ops-only commit does not change package.json or the existing Playwright server port. FloatAlpha continues running locally on 3338.

Production migrations, deployment and owner ADMIN assignment still require the documented explicit deployment procedure. No owner role was assigned as part of this milestone.
