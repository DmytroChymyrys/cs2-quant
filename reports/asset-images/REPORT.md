> Historical implementation report. For current loading, geometry and caching behavior, see [the visual polish report](polish/REPORT.md) and [current documentation](../../docs/asset-images/README.md).

# FloatAlpha asset imagery implementation

Implemented the default-ON opt-out configuration, independent server-side provider health, same-origin validated thumbnail delivery, shared client effective state and text-only fallback.

Source: exact-name mapping from ByMykel's public CS2 metadata to Steam CDN. Coverage: 100/100 approved names, zero missing or ambiguous mappings. All five representative URLs returned HTTP 200 and valid images in the live check. No cs2.sh or Skinport imagery API was enabled.

Configuration: `value?.trim().toLowerCase() !== 'false'`; missing/empty values are ON. Manual false skips probes and image resolution. Effective imagery still requires HEALTHY.

Health: two five-image rounds, at least four successes per round; one missing sample tolerated. Five-minute server Data Cache buckets and one-minute open-page polls support degradation/recovery. See the documented eventual-propagation and multi-region verification limits; no instantaneous global-switch claim is made.

Surfaces: Explorer table and inspection rail, public Asset Intelligence, Watchlist, Portfolio, and restrained thumbnails in the shared Screener table. Search results use Explorer. Terminal unchanged.

Evidence: [actual imagery ON](explorer-on.png), [provider-degraded OFF](explorer-off.png), [catalog validation](catalog-validation.json). Browser assertions verify exact text/table geometry after disable and individual failure and successful provider recovery on desktop/mobile.

Validation: 128 tests (105 existing + 23 new); 8 browser checks (6 existing + 2 new); typecheck, lint, production build. The first browser run exposed cached fixture images masking a simulated 404; the fixture was corrected to use no-store responses. The existing desktop chart hydration-sensitive check passed on rerun. An npm optional-binary installation issue was resolved by restoring the locked tree; package changes are limited to declaring Sharp as a direct dependency.

No collector, source adapter, transformer, scheduling, source provenance, observation or market-data semantics changes. No production migration, deployment or commit. Prior work remains uncommitted separately.

Full design/operations notes: `docs/asset-images/README.md`.
