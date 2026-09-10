# Follow-up review — 2026-09-10

## Missing-icons correction

The local previews lost imagery because health expired without an active refresh job. Port 3001 also lacked the explicit imagery database connection and its protected refresh returned 503. Configured `.env.local` to use the existing migrated local imagery database (no shared market database mutation).

Added development-only startup instrumentation that launches an asynchronous health refresh, then repeats every ten minutes. Persistence errors retry after one minute; timers never execute from page/status reads or delay server readiness. Production remains on the protected external scheduler. Background writes skip request-only tag invalidation and propagate through the existing 30-second cache expiry.

Restarted localhost:3001 and observed an automatic HEALTHY report with 10/10 successful samples. Chromium at `http://localhost:3001/assets?q=Black%20Laminate` confirmed both table and detail images decoded successfully (naturalWidth 207) and rendered at opacity 1. Screenshot: `restored-icons.png`. The 127.0.0.1 alias is rejected for development resources by this Next version; verification used the advertised localhost origin.

141 tests, typecheck, and lint passed after this correction, including timer bootstrap, duplicate prevention, and retry coverage.

The working tree already contained the persisted health/read split, negative resolution persistence, neutral wells, server initial image state, and anonymous watch-button guard. This review retained those changes and corrected the authenticated watchlist page to pass its verified authentication state to each button. It also removed the redundant status request at hydration; subsequent one-minute polling still propagates circuit-breaker changes.

## Timings

Full-response HTTP 200 timings from the local development server on port 3012. Before values come from the existing `before.json` artifact, not a newly recreated baseline. Current values are medians of three sequential warm requests. No production timing claim is made.

| Route | Recorded before median | Current median | Current samples (ms) |
| --- | ---: | ---: | --- |
| /assets | 1654.2 ms | 1115.9 ms | 1115.935, 1020.123, 1139.111 |
| /screener | 1119.3 ms | 1014.2 ms | 1011.927, 1014.242, 1033.957 |
| /api/asset-images/status | 4.9 ms | 4.1 ms | 4.698, 2.894, 4.142 |

The recorded before status median was already warm; it does not capture the reported 2.2-second synchronous probe. Inspection and regression tests establish that current cold and warm status reads cannot call the CDN. An initial development status request during this review took 765.7 ms; cold database/framework work can still exceed the warm target.

The local snapshot was expired and returned DEGRADED throughout these measurements. No health bootstrap or database mutation was performed in this follow-up. Enabled initial HTML and actual provider probe evidence from the earlier pass remain in REPORT.md and browser.json. No new recording was supplied with this request.

## Refresh and validation

Only protected POST /api/internal/asset-images/health probes the provider: two five-image rounds, one second apart, requiring four successes in each round. It persists the result for 20 minutes and invalidates the 30-second read cache. Configure a separate ten-minute POST job and bootstrap once; production migration/bootstrap/scheduling remain outstanding as documented in README.md. Manual false wins; individual negative resolutions never write health.

139 tests, TypeScript, ESLint, and whitespace checks passed. All four targeted desktop/mobile browser checks passed, covering individual failure geometry, global degradation/recovery, and zero anonymous watchlist requests. Browser tests intercept provider responses; they are not evidence of current upstream availability. The changes do not touch collectors, market data, provider transformers, image scale, or endpoint authentication.
