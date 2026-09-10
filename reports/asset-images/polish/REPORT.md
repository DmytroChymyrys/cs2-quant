> Superseded health-refresh and caching details: see [performance fix](../performance/REPORT.md).

# FloatAlpha asset imagery — visual polish

Verified locally on 2026-09-10. No deployment or commit.

## Result

Enabled imagery now reserves neutral wells in the initial server render: 44×36 pixels in tables, 160×104 in detail panels. Artwork uses a 120ms opacity transition, with no movement or size transition. Reduced-motion preferences disable the transition. Dark artwork has subtle neutral silhouette separation; bright artwork retains its original colors.

The delivery path crops only alpha-zero exterior padding, preserving even alpha=1 edge pixels and the complete visible item. It preserves aspect ratio and produces WebP within 320×208 without enlargement. Detail images are eager/high priority; table images remain lazy.

Individual failures retain the empty well without a broken-image icon. Global off/degradation removes all wells and restores text-only geometry. Cached image completion, including failure before React hydration, is handled explicitly. Market-data logic, identities and provider-health thresholds/polling were not changed.

## Evidence

- [Explorer with artwork delayed](explorer-loading.png)
- [Explorer fully loaded](explorer-loaded.png)
- [Asset Intelligence after reload](asset-intelligence.png)
- [Dark Black Laminate example](dark-item.png)
- [Bright Tiger Tooth example](bright-item.png)
- [Long table](long-table.png)
- [Global imagery off](global-off.png)

The loading capture intentionally delays image responses to make the reserved surface reviewable. Exact bounding rectangles for table headers, cells and asset-name links are identical before and after artwork loads; see [geometry measurements](checks.json). This measures image-induced layout changes, not unrelated whole-page font or data rendering.

Explorer reload, detail reload, long-table scrolling and Assets → Asset Intelligence → browser back were exercised. [Cache/navigation evidence](cache-navigation.json) records a repeated Danger Zone Case image with zero transfer bytes and a 10,382-byte decoded response body, plus successful back navigation. A generic network-idle wait timed out in the development preview; verification instead waited for the expected route, visible content and completed artwork.

## Caching and limits

Stable image URLs use `?v=2`. Successful image responses allow browser caching for one day and CDN caching for seven days, with one day stale-while-revalidate; errors remain no-store. Public cached bytes are not revoked by switching imagery off. The effective UI state still removes wells globally, and uncached image delivery checks configuration/health.

Initial server layout awaits the existing cached health decision. A cold health-cache miss can add the existing bounded probe latency; individual asset downloads do not block the page. Production CDN/multi-region behavior was not tested or deployed in this pass.

## Validation

- 129 unit/integration tests passed, including transparent-bounds preservation.
- All eight desktop/mobile browser checks passed across the initial run and targeted reruns. The imagery checks cover individual failure, stable reserved geometry, global degradation and recovery.
- Typecheck, lint and production build passed.
- Git whitespace validation passed.

The working tree contains earlier uncommitted UI, auth and market-data work as well as imagery. This pass does not commit or deploy that combined tree. See [git status](git-status.txt).
