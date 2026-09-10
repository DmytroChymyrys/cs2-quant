# Observation provenance

An observation's required `collector_run_id` links to `collector_runs.metadata.provenance`, written atomically with the observations and terminal run status by the existing store.

The manifest records:

- provider: `SKINPORT_DIRECT`
- venue: `SKINPORT`
- transformerVersion: `skinport@1`
- endpoints: Items `/v1/items` and Sales History `/v1/sales/history`
- rawSemantics: listing/ask statistics, listing quantity, independent rolling sales statistics, source timestamp meaning and USD currency policy

`collectedAt` is the run's existing `started_at`, also included in new run metadata. `observed_at` remains the existing post-fetch/post-index clock read shared by that batch. Items `created_at` and `updated_at` remain seconds-to-Date mappings. The observation's `source_updated_at` refers to Items, not a made-up History timestamp. `itemsFetch` and `historyFetch` metadata retain request start, body receive/parse completion, exact body hash and byte count independently.

Every existing price column keeps its meaning: Items suggested/min/max/mean/median are distinct from History's 24h/7d/30d/90d min/max/avg/median. Transformer MEAN represents History's published `avg`; it does not compute a new mean. Ask price represents Items `min_price`; bids remain unavailable. No statistic or currency is derived from another statistic. Monetary values retain decimal strings and numeric(20,8) persistence. Missing History's optional fields remain undefined before the existing database conversion to NULL; zero sales remains zero.

Raw per-asset Items/History payloads are unchanged. Their parsed price values and unknown numeric metadata remain lossless decimal text in JSONB, as before. Whole-response hashes identify byte-identical upstream responses; unchanged hashes/values do not suppress later observations.

## Legacy compatibility

Rows without a manifest are not rewritten. `provenanceFromRun` recognizes only the known legacy `source='SKINPORT'` path and returns an explicit `skinport@legacy` version with `inferredLegacy=true`. This is a compatibility interpretation, not a claim that those rows originally stored a transformer version. Unknown sources and malformed present manifests fail visibly rather than inheriting Skinport defaults.

The new version is persisted per run, so it remains traceable for all rows even after future transformer changes. Do not change a manifest for a completed run or update existing observations during future normalization changes. The existing observation table remains append-only; the operational run table is mutable and its manifest is application audit metadata, not a new cryptographic immutability guarantee.

## Inspection (read-only)

```sql
SELECT o.id, o.asset_id, o.source, o.observed_at,
       o.source_updated_at, r.started_at AS collected_at,
       r.metadata -> 'provenance' AS normalization,
       r.metadata -> 'itemsFetch' AS items_fetch,
       r.metadata -> 'historyFetch' AS history_fetch
FROM market_observations o
JOIN collector_runs r ON r.id = o.collector_run_id
ORDER BY o.observed_at DESC
LIMIT 100;
```

No migration is required. There is no backfill and no bulk update of production history.
