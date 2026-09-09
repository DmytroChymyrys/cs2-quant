# cs2-quant — first live smoke collection

The five explicitly approved assets were seeded in the real Neon database. Two sequential authenticated POSTs were sent to https://cs2-quant.vercel.app/api/internal/collect/skinport in the same 2026-09-09 17:05 UTC bucket, after waiting more than five minutes after seed validation's source request. No other assets were tracked, no schedule was enabled, and no commit was created.

## Result

| Measurement | Actual result |
| --- | --- |
| Primary run | 3cb5685b-33cd-405b-9cd9-6416bcf75586 |
| Status | SUCCESS |
| Stored duration | 5946 ms |
| Client HTTP round trip | 6870 ms |
| Items | HTTP 200; 25413 rows |
| History | HTTP 200; 36864 rows |
| Matched / missing | 5 / 0 |
| Inserted observations | 5 |
| Excluded variant item rows | 361 |
| Excluded variant history rows | 974 |
| Duplicate invocation | 223a951d-027c-49f2-84e8-197f8282ec0c; PARTIAL / DUPLICATE_WINDOW; 63 ms; zero observations |

Both source payload names exactly match each asset's market_hash_name, both versions are null/absent, and all five history rows were present. All 105 persisted monetary fields (five marketplace fields plus sixteen history price fields per asset) matched their stored source provenance as exact eight-decimal strings. Listing quantities and all twenty history-volume fields also matched. All source_created_at/source_updated_at values matched source epoch seconds converted to timestamps. No null price fields or zero listing quantities occurred in this sample; this live sample therefore does not exercise those legitimate edge states (covered separately by mocked tests).

All five observations have observed_at = 2026-09-09 17:05:28.71+00; Skinport source_updated_at = 2026-09-09 17:00:14+00. The upstream timestamp is 314.71 seconds older than observation time. This is source freshness, not a normalization error. Items/history requests began 1 ms apart; those separately cached datasets are not an atomic market snapshot.

Timing caveat: the current collector sets finished_at and duration_ms immediately before its final database batch. Database row creation followed finished_at by about 46 ms, and the HTTP round trip was longer. The stored duration is not full request latency; source timestamp normalization is correct.

The duplicate was skipped before loading tracked assets or calling Skinport, so its default tracked_assets=0 does not mean the catalog became empty. Its claim_key is null, it shares the same window_start as the primary run, and every stored observation belongs to the primary run. Two audit rows exist, with only five observations and one claimed window.

## One normalized observation for each approved asset

All normalized database columns are shown below, excluding only the two provenance JSONB fields. Full rows with both provenance payloads are in [smoke-observations.json](smoke-observations.json).

### Danger Zone Case

```json
{
  "market_hash_name": "Danger Zone Case",
  "id": "40f2275c-6a42-4691-998f-d717bb1ea99e",
  "asset_id": "709d75f8-d6b8-46fc-abd7-64bf2aa16cf4",
  "source": "SKINPORT",
  "collector_run_id": "3cb5685b-33cd-405b-9cd9-6416bcf75586",
  "observed_at": "2026-09-09 17:05:28.71+00",
  "currency": "USD",
  "suggested_price": "1.61000000",
  "min_price": "1.06000000",
  "max_price": "123.96000000",
  "mean_price": "2.50000000",
  "median_price": "1.86000000",
  "quantity": 93634,
  "source_created_at": "2019-01-23 17:00:58+00",
  "source_updated_at": "2026-09-09 17:00:14+00",
  "sales_24h_min": "0.93000000",
  "sales_24h_max": "1.08000000",
  "sales_24h_avg": "1.04000000",
  "sales_24h_median": "1.04000000",
  "sales_24h_volume": 205,
  "sales_7d_min": "0.93000000",
  "sales_7d_max": "1.09000000",
  "sales_7d_avg": "1.05000000",
  "sales_7d_median": "1.05000000",
  "sales_7d_volume": 1864,
  "sales_30d_min": "0.90000000",
  "sales_30d_max": "1.45000000",
  "sales_30d_avg": "1.10000000",
  "sales_30d_median": "1.10000000",
  "sales_30d_volume": 19141,
  "sales_90d_min": "0.90000000",
  "sales_90d_max": "2.01000000",
  "sales_90d_avg": "1.19000000",
  "sales_90d_median": "1.21000000",
  "sales_90d_volume": 56201,
  "created_at": "2026-09-09 17:05:28.756737+00"
}
```

### SSG 08 | Acid Fade (Factory New)

```json
{
  "market_hash_name": "SSG 08 | Acid Fade (Factory New)",
  "id": "ae1463f8-0220-4f1c-8c68-ce4ea9567d8a",
  "asset_id": "57ecf55e-93fc-4c3c-99a1-99869a0ea43f",
  "source": "SKINPORT",
  "collector_run_id": "3cb5685b-33cd-405b-9cd9-6416bcf75586",
  "observed_at": "2026-09-09 17:05:28.71+00",
  "currency": "USD",
  "suggested_price": "0.90000000",
  "min_price": "0.74000000",
  "max_price": "470.83000000",
  "mean_price": "4.57000000",
  "median_price": "2.30000000",
  "quantity": 3145,
  "source_created_at": "2018-09-03 15:24:21+00",
  "source_updated_at": "2026-09-09 17:00:14+00",
  "sales_24h_min": "0.66000000",
  "sales_24h_max": "0.74000000",
  "sales_24h_avg": "0.73000000",
  "sales_24h_median": "0.74000000",
  "sales_24h_volume": 7,
  "sales_7d_min": "0.65000000",
  "sales_7d_max": "3.79000000",
  "sales_7d_avg": "0.83000000",
  "sales_7d_median": "0.73000000",
  "sales_7d_volume": 103,
  "sales_30d_min": "0.65000000",
  "sales_30d_max": "127.36000000",
  "sales_30d_avg": "2.09000000",
  "sales_30d_median": "1.01000000",
  "sales_30d_volume": 310,
  "sales_90d_min": "0.60000000",
  "sales_90d_max": "127.36000000",
  "sales_90d_avg": "1.65000000",
  "sales_90d_median": "1.09000000",
  "sales_90d_volume": 1050,
  "created_at": "2026-09-09 17:05:28.756737+00"
}
```

### Sticker | Team Liquid | Paris 2023

```json
{
  "market_hash_name": "Sticker | Team Liquid | Paris 2023",
  "id": "7169e76e-6d00-48e0-a2fd-b7981698abcc",
  "asset_id": "5cdb7fa8-3c4b-48d9-8c37-4652e61af8db",
  "source": "SKINPORT",
  "collector_run_id": "3cb5685b-33cd-405b-9cd9-6416bcf75586",
  "observed_at": "2026-09-09 17:05:28.71+00",
  "currency": "USD",
  "suggested_price": "0.03000000",
  "min_price": "0.02000000",
  "max_price": "0.24000000",
  "mean_price": "0.04000000",
  "median_price": "0.04000000",
  "quantity": 12222,
  "source_created_at": "2023-05-12 07:01:09+00",
  "source_updated_at": "2026-09-09 17:00:14+00",
  "sales_24h_min": "0.02000000",
  "sales_24h_max": "0.02000000",
  "sales_24h_avg": "0.02000000",
  "sales_24h_median": "0.02000000",
  "sales_24h_volume": 1,
  "sales_7d_min": "0.02000000",
  "sales_7d_max": "0.02000000",
  "sales_7d_avg": "0.02000000",
  "sales_7d_median": "0.02000000",
  "sales_7d_volume": 7,
  "sales_30d_min": "0.02000000",
  "sales_30d_max": "0.02000000",
  "sales_30d_avg": "0.02000000",
  "sales_30d_median": "0.02000000",
  "sales_30d_volume": 62,
  "sales_90d_min": "0.02000000",
  "sales_90d_max": "0.02000000",
  "sales_90d_avg": "0.02000000",
  "sales_90d_median": "0.02000000",
  "sales_90d_volume": 202,
  "created_at": "2026-09-09 17:05:28.756737+00"
}
```

### ★ Bowie Knife | Tiger Tooth (Factory New)

```json
{
  "market_hash_name": "★ Bowie Knife | Tiger Tooth (Factory New)",
  "id": "bfa70bb2-2327-4bed-ba57-e49eb642d0b0",
  "asset_id": "a33d580e-7123-41af-a0d9-e1b2688d3098",
  "source": "SKINPORT",
  "collector_run_id": "3cb5685b-33cd-405b-9cd9-6416bcf75586",
  "observed_at": "2026-09-09 17:05:28.71+00",
  "currency": "USD",
  "suggested_price": "151.01000000",
  "min_price": "123.17000000",
  "max_price": "1257.82000000",
  "mean_price": "191.33000000",
  "median_price": "155.08000000",
  "quantity": 82,
  "source_created_at": "2018-09-03 15:24:57+00",
  "source_updated_at": "2026-09-09 17:00:14+00",
  "sales_24h_min": "119.01000000",
  "sales_24h_max": "120.40000000",
  "sales_24h_avg": "119.71000000",
  "sales_24h_median": "119.71000000",
  "sales_24h_volume": 2,
  "sales_7d_min": "109.48000000",
  "sales_7d_max": "125.50000000",
  "sales_7d_avg": "117.57000000",
  "sales_7d_median": "116.44000000",
  "sales_7d_volume": 19,
  "sales_30d_min": "109.48000000",
  "sales_30d_max": "139.58000000",
  "sales_30d_avg": "124.22000000",
  "sales_30d_median": "122.77000000",
  "sales_30d_volume": 59,
  "sales_90d_min": "109.48000000",
  "sales_90d_max": "157.99000000",
  "sales_90d_avg": "132.29000000",
  "sales_90d_median": "133.75000000",
  "sales_90d_volume": 181,
  "created_at": "2026-09-09 17:05:28.756737+00"
}
```

### ★ Driver Gloves | Imperial Plaid (Field-Tested)

```json
{
  "market_hash_name": "★ Driver Gloves | Imperial Plaid (Field-Tested)",
  "id": "354a65b5-05bf-48a1-aa60-9c7a29965e9d",
  "asset_id": "dd8ae66b-43b7-404e-b8de-88389036d58a",
  "source": "SKINPORT",
  "collector_run_id": "3cb5685b-33cd-405b-9cd9-6416bcf75586",
  "observed_at": "2026-09-09 17:05:28.71+00",
  "currency": "USD",
  "suggested_price": "186.44000000",
  "min_price": "144.45000000",
  "max_price": "690.33000000",
  "mean_price": "245.54000000",
  "median_price": "212.30000000",
  "quantity": 156,
  "source_created_at": "2018-09-03 15:24:58+00",
  "source_updated_at": "2026-09-09 17:00:14+00",
  "sales_24h_min": "144.36000000",
  "sales_24h_max": "177.00000000",
  "sales_24h_avg": "156.93000000",
  "sales_24h_median": "154.93000000",
  "sales_24h_volume": 6,
  "sales_7d_min": "127.95000000",
  "sales_7d_max": "256.54000000",
  "sales_7d_avg": "165.98000000",
  "sales_7d_median": "158.48000000",
  "sales_7d_volume": 51,
  "sales_30d_min": "127.95000000",
  "sales_30d_max": "302.40000000",
  "sales_30d_avg": "173.93000000",
  "sales_30d_median": "165.13000000",
  "sales_30d_volume": 215,
  "sales_90d_min": "127.95000000",
  "sales_90d_max": "329.38000000",
  "sales_90d_avg": "191.54000000",
  "sales_90d_median": "186.09000000",
  "sales_90d_volume": 653,
  "created_at": "2026-09-09 17:05:28.756737+00"
}
```

## Actual SQL inspection results

The two queries are reproduced verbatim from sql/inspect-collection.sql. Outputs below are actual Neon results, not fixtures. COUNT(*) is returned as a string by the database driver.

~~~sql
SELECT *
FROM collector_runs
ORDER BY started_at DESC
LIMIT 10;
~~~

```json
[
  {
    "id": "223a951d-027c-49f2-84e8-197f8282ec0c",
    "source": "SKINPORT",
    "window_start": "2026-09-09 17:05:00+00",
    "claim_key": null,
    "started_at": "2026-09-09 17:05:29.062+00",
    "finished_at": "2026-09-09 17:05:29.125+00",
    "status": "PARTIAL",
    "items_http_status": null,
    "history_http_status": null,
    "items_received": 0,
    "history_items_received": 0,
    "tracked_assets": 0,
    "items_matched": 0,
    "items_missing": 0,
    "observations_inserted": 0,
    "duration_ms": 63,
    "error_code": "DUPLICATE_WINDOW",
    "error_message": "Window already claimed; no upstream requests made.",
    "metadata": {},
    "created_at": "2026-09-09 17:05:29.15754+00"
  },
  {
    "id": "3cb5685b-33cd-405b-9cd9-6416bcf75586",
    "source": "SKINPORT",
    "window_start": "2026-09-09 17:05:00+00",
    "claim_key": "SKINPORT:2026-09-09T17:05:00.000Z",
    "started_at": "2026-09-09 17:05:22.765+00",
    "finished_at": "2026-09-09 17:05:28.711+00",
    "status": "SUCCESS",
    "items_http_status": 200,
    "history_http_status": 200,
    "items_received": 25413,
    "history_items_received": 36864,
    "tracked_assets": 5,
    "items_matched": 5,
    "items_missing": 0,
    "observations_inserted": 5,
    "duration_ms": 5946,
    "error_code": null,
    "error_message": null,
    "metadata": {
      "itemsFetch": {
        "startedAt": "2026-09-09T17:05:22.942Z",
        "finishedAt": "2026-09-09T17:05:28.536Z"
      },
      "historyFetch": {
        "startedAt": "2026-09-09T17:05:22.943Z",
        "finishedAt": "2026-09-09T17:05:26.861Z"
      },
      "missingAssets": [],
      "missingHistory": [],
      "upstreamErrors": [],
      "excludedVariantItemRows": 361,
      "excludedVariantHistoryRows": 974
    },
    "created_at": "2026-09-09 17:05:22.843394+00"
  }
]
```

~~~sql
SELECT
    a.market_hash_name,
    COUNT(*) observations,
    MIN(o.observed_at),
    MAX(o.observed_at)
FROM market_observations o
JOIN assets a ON a.id = o.asset_id
GROUP BY a.id, a.market_hash_name
ORDER BY observations DESC;
~~~

```json
[
  {
    "market_hash_name": "Sticker | Team Liquid | Paris 2023",
    "observations": "1",
    "min": "2026-09-09 17:05:28.71+00",
    "max": "2026-09-09 17:05:28.71+00"
  },
  {
    "market_hash_name": "SSG 08 | Acid Fade (Factory New)",
    "observations": "1",
    "min": "2026-09-09 17:05:28.71+00",
    "max": "2026-09-09 17:05:28.71+00"
  },
  {
    "market_hash_name": "★ Bowie Knife | Tiger Tooth (Factory New)",
    "observations": "1",
    "min": "2026-09-09 17:05:28.71+00",
    "max": "2026-09-09 17:05:28.71+00"
  },
  {
    "market_hash_name": "★ Driver Gloves | Imperial Plaid (Field-Tested)",
    "observations": "1",
    "min": "2026-09-09 17:05:28.71+00",
    "max": "2026-09-09 17:05:28.71+00"
  },
  {
    "market_hash_name": "Danger Zone Case",
    "observations": "1",
    "min": "2026-09-09 17:05:28.71+00",
    "max": "2026-09-09 17:05:28.71+00"
  }
]
```

## Actual /api/internal/data-health response

HTTP 200; inspected at 2026-09-09T17:05:52.266Z.

The duplicate attempt is intentionally excluded from the scheduled-run denominator, so health reports one SUCCESS and no PARTIAL runs even though the audit table contains the duplicate PARTIAL. missingScheduledWindows=287 is the existing full-day projection minus one claimed window; it is not evidence of 287 missed jobs, since cron-job.org is not enabled. The monthly estimate and capacity entries are projections, not measured operating rates; only five assets are tracked.

```json
{
  "source": "SKINPORT",
  "asOf": "2026-09-09T17:05:52.059Z",
  "lastRun": {
    "id": "3cb5685b-33cd-405b-9cd9-6416bcf75586",
    "source": "SKINPORT",
    "window_start": "2026-09-09 17:05:00+00",
    "claim_key": "SKINPORT:2026-09-09T17:05:00.000Z",
    "started_at": "2026-09-09 17:05:22.765+00",
    "finished_at": "2026-09-09 17:05:28.711+00",
    "status": "SUCCESS",
    "items_http_status": 200,
    "history_http_status": 200,
    "items_received": 25413,
    "history_items_received": 36864,
    "tracked_assets": 5,
    "items_matched": 5,
    "items_missing": 0,
    "observations_inserted": 5,
    "duration_ms": 5946,
    "error_code": null,
    "error_message": null,
    "metadata": {
      "itemsFetch": {
        "startedAt": "2026-09-09T17:05:22.942Z",
        "finishedAt": "2026-09-09T17:05:28.536Z"
      },
      "historyFetch": {
        "startedAt": "2026-09-09T17:05:22.943Z",
        "finishedAt": "2026-09-09T17:05:26.861Z"
      },
      "missingAssets": [],
      "missingHistory": [],
      "upstreamErrors": [],
      "excludedVariantItemRows": 361,
      "excludedVariantHistoryRows": 974
    },
    "created_at": "2026-09-09 17:05:22.843394+00"
  },
  "health24h": {
    "runs": 1,
    "successful": 1,
    "partial": 0,
    "failed": 0,
    "running": 0,
    "abandoned": 0,
    "averageLatencyMs": "5946.0000000000000000",
    "p95LatencyMs": 5946,
    "http429Runs": 0,
    "http5xxRuns": 0,
    "malformedPayloadRuns": 0,
    "successRate": 1,
    "successOrPartialRate": 1,
    "expectedScheduledWindows": 288,
    "missingScheduledWindows": 287
  },
  "coverage": {
    "trackedAssets": 5,
    "staleAssets": 0,
    "latestRunCoverage": 1
  },
  "observations": {
    "last24h": 5,
    "tableAndIndexesBytes": "81920",
    "estimatedRowsMonthAtObservedRate": 150
  },
  "capacity": [
    {
      "assets": 100,
      "rowsDay": 28800,
      "rowsMonth": 864000
    },
    {
      "assets": 1000,
      "rowsDay": 288000,
      "rowsMonth": 8640000
    },
    {
      "assets": 10000,
      "rowsDay": 2880000,
      "rowsMonth": 86400000
    },
    {
      "assets": 25413,
      "rowsDay": 7318944,
      "rowsMonth": 219568320
    }
  ]
}
```

## Verification artifacts

- [Raw endpoint responses](live-collection-responses.json)
- [Exact SQL results](collection-inspection.json)
- [Normalized rows and provenance comparisons](smoke-observations.json)
- [Live smoke assertions](smoke-assertions.json)
- [Full health response](post-collection-health.json)

All ten live assertions passed. This establishes a clean first five-asset collection and same-bucket idempotency behavior; it does not establish multi-day reliability or coverage for a larger universe.
