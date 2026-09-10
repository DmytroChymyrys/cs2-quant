# FloatAlpha craft polish validation

Baseline: `e2a26dfd3d9a8341ba46906c1b4f56a5e8d9e967`. Final implementation: `4c8b05b`, branch `polish/aaa-craft`.

Review locally at http://localhost:3338. Open [the side-by-side comparison](comparison.html) to compare all seven surfaces at desktop and mobile widths. PNG evidence is retained locally in `before/` and `after/`; images are not added to Git.

The approved public Preview remains https://cs2-quant-2aqh66eq2-dmytro-chymyrys-projects.vercel.app/. This task did not deploy a replacement or change Vercel settings, production, collection infrastructure, credentials, database state, schedules, analytics contracts, or the demo generator. `protected-paths.diff` is empty.

## Changes

- Tabular figures, fixed two-decimal price/percentage presentation, right-aligned numeric headers and values; existing semantic colors retained.
- Readable secondary/provenance text, nearly imperceptible neutral panel depth, distinguishable row hover/focus/selection without movement.
- Accessible metric explanations using existing methodology. Tooltip portals avoid clipping by table scroll containers. Labels remain compact; availability counts do not receive a misleading formula tooltip.
- Three keyboard-accessible landing showcase tabs use actual artwork, metric and chart components. Frozen examples are exported from the unchanged seeded demo with `scripts/build-product-showcase.ts`; they are explicitly synthetic and generate no runtime data queries. The frame remains fixed while tabs switch.
- Quiet chart grids, appropriate zero references, and pointer/keyboard readouts selecting actual timestamped observations. Gaps and nulls remain intact; observed, derived and synthetic readouts remain distinguished.
- Slash search, safe typing guards, Escape dismissal, restrained keycaps, reduced-motion support and a neutral modal backdrop.

## Validation

- **35 route/viewport captures:** landing, Terminal, Screener, Assets, Asset Intelligence, Portfolio and Watchlist at **1440, 1280, 1024, 768 and 390px**. All HTTP 200, no page errors or document horizontal overflow. Local skin artwork loaded.
- **14 baseline screenshot comparisons:** all 12 application-page comparisons retain sampled metric-card and table-row heights at 1440 and 390px. The landing showcase replaces images with actual components, so its new DOM metrics have no baseline metric counterpart. Other widths were tested after the change; before screenshots were captured at desktop/mobile only.
- **Five interaction passes:** three showcase tabs, arrow-key tab navigation, stable frame height, search typing, Escape, tooltip viewport fit after entrance animation, stable row hover geometry, and chart keyboard inspection.
- **Five modal/reduced-motion checks:** native dialog geometry/backdrop and Escape through a browser-only fixture using the shared dialog classes. Authenticated forms are deliberately unavailable in anonymous demo mode; this is a CSS/native-dialog check, not an authenticated submission test.
- **275 existing tests passed**, plus **2 focused craft tests passed** for actual-point selection and methodology wording. Final lint and isolated optimized build (including TypeScript) passed.
- No new runtime dependencies or animation library. Existing server/client composition retained; landing examples are prepared server-side and passed into the existing interactive showcase boundary.

## Local optimized performance

Two isolated clean Git archives, explicit demo Preview mode, no database/provider/auth secrets, same host and Next production server. Nine warm requests per route after one warm-up; medians below measure receipt of the complete HTML/JSON body. These are local samples, not deployed latency or a production SLO.

| Route | Baseline | Polish |
| --- | ---: | ---: |
| `/` | 8.39 ms | 12.45 ms |
| `/assets` | 20.55 ms | 31.98 ms |
| `/screener` | 19.34 ms | 19.74 ms |
| `/api/asset-images/status` | 1.28 ms | 1.45 ms |

The Assets sample increased by 11.43 ms; this is a small local sample and does not establish a production regression. The landing HTML grows from 70,544 to 179,501 uncompressed bytes to carry real, inspectable showcase components and series. At 1440px, measured encoded JS stays approximately 172.5 KB on landing; Screener JS grows from 164.6 to 168.2 KB, and CSS grows by 2.2 KB. Initial landing image downloads after scrolling to the showcase decrease from 141.4 to 83.9 KB. Resource counts reflect the measured initial views, not every lazy-loaded tab.

Observed layout-shift sums on optimized landing/Screener at all five widths remain **0–0.000113** before and after. This is not a claim of strictly zero CLS or a field Core Web Vitals result. Showcase tab changes separately retain identical frame geometry. `performance.json` contains raw timings and resource/layout measurements.

Provider health refresh behavior is unchanged in this visual pass: no image-provider, status endpoint, resolver, or circuit-breaker implementation was modified.

## Reproduce and review

- `capture.mjs`: local screenshot and geometry capture (`STAGE=after`, port 3338).
- `interactions.mjs`: browser interaction checks and screenshots, port 3338.
- `performance.mjs`: optimized before/after builds on temporary ports 3340/3339.
- `overlay-check.mjs`: anonymous browser-only modal fixture and reduced motion, port 3339.
- `comparison.html`: desktop/mobile side-by-side viewer using the retained PNGs.

Changes were committed individually in the requested order: typography/alignment; contrast; panel depth; row states; tooltips; showcase; charts; keyboard behavior; compact geometry/semantic-color correction; category context; and explicit chart provenance.
