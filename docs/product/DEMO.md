# Local realistic demo

`PRODUCT_ANALYTICS_MODE=demo` selects 32 canonical CS2 market names with existing Steam artwork and seven days of **synthetic** five-minute observations. This is the normal local preview on port 3338. Prices, quantities, acquisition references, and relationships are invented demonstration values, not estimates of current market prices or evidence of predictability.

| Mode | Purpose | Evidence | Production |
| --- | --- | --- | --- |
| `demo` | Realistic interactive preview | SYNTHETIC, preview DEMO | Rejected |
| `fixture` | Original ten QA edge cases | SYNTHETIC, preview QA | Rejected |
| `database` | Explicitly reviewed derived snapshot | Existing database boundary | No fallback |

The generator also rejects direct invocation in production, including access to a previously warmed cache. It never opens a database connection, calls a provider, or writes an observation/export. Both generator input and derived demo result carry literal SYNTHETIC evidence. The server adapter preserves this on datasets and asset details. No demo export command exists. Account mutation controls remain disabled for synthetic previews.

## Identity and media

`src/lib/product/intelligence/demo-universe.ts` selects exact names and original URLs from the existing `config/asset-images/catalog.json`, the media map used before the canonical-catalog milestone. It creates no new artwork resolver or replacement artwork store. The source map remains unchanged. Canonical market identities include explicit wear, star and weapon names. Demo UUIDs intentionally occupy a separate deterministic namespace instead of borrowing production tracked-asset IDs.

Media stays externally hosted, unaltered and unrehosted, following [existing media conventions](../catalog/MEDIA.md). These are third-party CS2 representations, not artwork owned by FloatAlpha. Browser delivery uses the existing AssetImage wells, cached provider health and manual enable/disable controls. Demo generation needs no network; displaying original artwork needs browser connectivity to Steam. URL provenance is reused, not reverified by generator calls.

## Generation and adapter

Fixed default seed `7302026`, fixed clock `2026-09-09T17:55:00.000Z`, 2016 buckets per item, 64,512 observations. Asset configurations specify reference level, listing depth and archetype. Independent per-asset seeded streams generate irregular quiet/normal/burst regimes with persistent pressure. Conditional price/listing events preserve flat stretches. Latent price accumulation precedes cent rounding so inexpensive items retain realistic occasional steps. Median references adjust in steps and never fall below minimum.

Archetypes: liquid weapon skin, premium knife, premium gloves, liquid case, momentum, mean reversion, volatility, quiet, listing contraction and expansion. Reference-scaled changes and integer depth-scaled quantities distinguish classes. Only one contraction example has a weak delayed upward drift; the other does not. No universal inverse-price/supply law or new analytics is introduced.

`demo.ts` generates observations, calls the unchanged `derive()` engine, and caches its result in memory. `server.ts` uses the same `summary()` and `seriesPoint()` adapter as other modes. All displayed returns, activity, volatility and chart values come from that path. First access has a one-time generation/derivation cost; subsequent reads reuse the cached result. A code reload or mode switch may regenerate it.

Terminal defaults to Bloodsport at 24h in demo mode. Portfolio and Watchlist contain eight deliberately varied example items. QA selection and production defaults are unchanged. Full main-demo coverage is intentional; versioned provider History is unavailable rather than fabricated. The QA dataset still demonstrates gaps, stale sources and insufficient history.

## Validation

`npm run check:demo` requires the local server on 3338 in demo mode. It verifies artwork, labels, all five product pages at desktop/mobile widths, four asset horizons, pagination and search. Screenshots/results go to `reports/demo-repair`.

`npm run check:qa` requires local demo or fixture mode. It temporarily switches only the local mode setting, runs the existing product-intelligence, waiting-week, visual-restoration and snapshot workflow browser checks, and restores the original `.env.local` bytes in `finally`. Do not run it concurrently with demo screenshot capture. No production selection is performed.

`tests/demo-market.test.ts` covers deterministic seeds, validity, five-minute ordering, profile distinctions, flat/clustered activity, artwork reuse, derived/product consistency, no database reads, production rejection and retained QA access. Run the full suite with `npm test -- --maxWorkers=2` on memory-constrained local machines.
