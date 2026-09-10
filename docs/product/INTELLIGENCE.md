# Product intelligence integration

Local implementation, September 10, 2026. Production has not been deployed or modified. The real seven-day experiment remains incomplete until September 16 at 17:55 UTC.

## Existing surfaces

Terminal, Screener, Assets, Asset Intelligence, Portfolio and Watchlist reuse the existing routes, shell, panels, tables, typography and chart styles. `ObservationChart` remains the shared chart entry point; its new `series` input accepts the product contract while existing `points` callers retain their behavior. Authenticated mutations retain their existing endpoints and session checks. The existing Pro advanced screener remains separately labeled as the previous tool.

## Read contract and boundaries

`src/lib/product/intelligence/contract.ts` defines summaries, detail, price/listing series, screener results, quality and snapshot-scoped History metadata. The allowlisted mapper never passes provider payloads or database rows to React. Prices and derived arithmetic retain decimal strings; unknown values remain null. Volatility requires 12/72/288 consecutive return pairs for 1h/6h/24h. Activity requires 12 complete pairs. Zero is a valid observed value for quiet markets.

`server.ts` is server-only. RSC pages consume the same request-cached dataset; there is no extra browser analytics fetch. The database pool uses read-only transactions, three connections and a five-second query timeout. Three bulk analytics queries load snapshot metadata, latest summaries with counts, and History metadata. One optional bulk catalog lookup preserves existing canonical artwork. List pages do not load every asset's time series. Terminal loads one focus asset; asset detail loads only its selected horizon. There is no provider request, collector database fallback, new raw index, or SQL migration.

Readers accept at most a seven-day snapshot, 1,000 summaries and 2,016 detail points. Screening/filtering happens on the server with 25-row pages. Sorting always puts null last in both directions, then breaks ties by name and ID. Numeric filters exclude unavailable values. Chart timestamps are clipped to both the selected horizon and snapshot scope; missing windows/nulls break the line. Metrics at a displayed point retain the engine's trailing-window semantics within the underlying snapshot, which can include earlier snapshot points outside the display horizon.

## Configuration

Normal local preview on port 3338 now uses `PRODUCT_ANALYTICS_MODE=demo` in ignored `.env.local`; see [DEMO.md](DEMO.md). Dedicated QA uses `PRODUCT_ANALYTICS_MODE=fixture`. Ten deterministic synthetic assets cover activity, quiet markets, upward/downward prices, contracting/expanding listings, volatility, gaps, stale sources and short history. The simulation clock is fixed at September 9, 2026 17:55 UTC. All preview pages label their synthetic evidence. Example portfolio/watchlist entries are synthetic, with account mutations disabled.

For database-backed reads, configure:

```dotenv
PRODUCT_ANALYTICS_MODE=database
DERIVED_MARKET_DATABASE_URL=<separate analytics database; preferably a read-only role>
PRODUCT_ANALYTICS_SNAPSHOT_ID=<reviewed 64-character snapshot ID>
```

Fixture mode is explicitly rejected when `NODE_ENV=production`. Missing configuration, older methods and failed reads show unavailable states. No fixture fallback is used. The reader requires `listing-features-v2`, which adds absolute minimum/median listing price and listing quantity to the existing JSON feature payload. Regenerate a reviewed snapshot with the existing offline report CLI and select its new ID. Existing v1 snapshots remain immutable; no database migration is needed for this addition.

There is no automatic snapshot refresh or global latest pointer in this phase. An operator must generate/persist a new reviewed snapshot and update the selected ID. Until then, the product shows that snapshot's timestamp and computes its current source/observation age at read time. This is not a live market feed. The existing source collector, cadence and universe remain the control system.

## Presets and explanations

Thresholds live in `screener.ts` and are visible in the UI:

| Preset | Rule and default ordering |
| --- | --- |
| Most Active | Activity >= 50; descending activity |
| Price Movers | Available return; descending absolute selected-horizon return |
| Price Up / Down | Positive / negative selected-horizon return; largest increase/decrease first |
| Listings Contracting / Expanding | At least 2% venue quantity change over 1h; largest contraction/expansion first |
| High Volatility | Available complete-horizon volatility, descending |
| Quiet Markets | Activity <= 10, ascending |
| Fresh Changes | Nonzero price/listing change over 5m; source and observation ages <= 900 seconds; source age ascending |

Filters cover price, selected-horizon return direction/absolute move, listing range/direction/change, activity, volatility, coverage and source age. Explicit sort overrides are available. Explanations deterministically report displayed metrics, coverage and freshness. Venue listing quantity is not circulating supply. Activity is not causality or a recommendation.

## Portfolio, provenance and unavailable states

Portfolio values use minimum listing references and user quantities. Missing holdings prevent a complete portfolio total or complete 24h change; known subtotals are labeled. Concentration uses the known subtotal. Reconstructed 24h changes use rounded observed returns and are not realized profit or guaranteed liquidation value. Account queries remain user-scoped.

Coverage is measured across the selected snapshot, separately from chart point count. Current source and observation age are computed at read time; chart source age is the captured age at each observation. Unchanged prices are valid data. History is shown as snapshot-scoped hash episodes, with first/last seen and left censoring. No authoritative publication timestamp is invented, and no repeated rolling sales volume appears as five-minute observations.

## Validation and evidence

- `tests/product-intelligence.test.ts`: nulls, completeness, stable sorting/filtering, thresholds, descriptive explanations, History separation, unchanged observations, real timestamp staleness, shared contracts, production fixture rejection, horizon clipping, chart gaps and incomplete portfolio totals.
- `tests/product-intelligence-reader.test.ts`: read-only/bulk queries, method and scope guards, parameterized bounded detail queries and visible detail failures.
- `node scripts/check-product-intelligence.mjs`: local-only browser checks against port 3338, including desktop/mobile routes, presets, chart metrics and insufficient history. Requires fixture mode. No account mutation is performed.
- `reports/product-intelligence/browser.json` and PNGs: explicitly synthetic desktop/mobile evidence, no page overflow, hydration errors or anonymous watchlist requests. Browser timings include the network-idle wait and are not production request benchmarks.
- `local-v2-snapshot.json`: successful local-only generation/persistence of 864 feature rows from the existing isolated three-asset fixture database.
- `local-reader.json`: actual read-only database adapter check, three summaries and twelve 1h points; approximately 18ms initial summary read on the local database. Not production performance evidence.
- `protected-verification.json`: 36 collector/provider/raw-schema/schedule/universe files unchanged from this phase's preflight hashes; existing unrelated working-tree changes preserved.

No production seven-day report, deployment, collection expansion or predictive analysis is claimed by these fixtures. The next real checkpoint is the prepared September 9–16 production report after its end boundary closes.

## Waiting-week follow-up

See [Waiting-week implementation and operator runbook](WAITING_WEEK.md) for the snapshot transparency, explicit review/select CLI, broader browser QA, and dormant offline research tools.
