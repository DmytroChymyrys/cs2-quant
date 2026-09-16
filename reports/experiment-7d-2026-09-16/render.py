"""Deterministic report + CSV rendering from the saved evidence files."""
import json, csv, math, collections, statistics, hashlib
from pathlib import Path
from datetime import datetime, timedelta

OUT = Path('reports/experiment-7d-2026-09-16')
D = json.loads((OUT/'data.json').read_text())
A = json.loads((OUT/'analysis.json').read_text())
C = json.loads((OUT/'confounders.json').read_text())
S = json.loads((OUT/'storage.json').read_text())
CASES = json.loads((OUT/'case-candidates.json').read_text())['rows']
MB = 1024**2
START = datetime(2026, 9, 9, 17, 55)

def pc(v, p):
    s = sorted(v); i = (len(s)-1)*p; lo, hi = math.floor(i), math.ceil(i)
    return s[lo]+(s[hi]-s[lo])*(i-lo)
def f(x, n=2):
    return 'n/a' if x is None else ('{:,.%df}' % n).format(float(x))
def wts(w):
    return (START + timedelta(minutes=5*int(w))).strftime('%Y-%m-%dT%H:%M:%SZ')

runs = D['runs']
st = collections.Counter(r['status'] for r in runs)
dur = [r['duration_ms'] for r in runs if r['duration_ms'] is not None]
inv, qual, fr = D['inventory'], D['quality'], D['freshnessTotals']
agg = A['aggregate']
per, der = A['perAsset'], A['derived']
ASSETS = sorted(per)
EXP_W, EXP_A = 2016, 100
EXP_OBS = EXP_W*EXP_A
obs = inv['observations_in_window']
sizes = {s['name']: s for s in D['sizes']}
idx = {i['index_name']: int(i['index_bytes']) for i in D['indexSizes']}
cov = collections.Counter(p['observations'] for p in per.values())
byname = {c['asset']: c for c in CASES}

# ---------------------------------------------------------------- CSVs
with (OUT/'reliability.csv').open('w', newline='') as fh:
    w = csv.writer(fh); w.writerow(['metric', 'value', 'basis'])
    rows = [
        ('window_start_inclusive', '2026-09-09T17:55:00Z', 'approved experiment boundary'),
        ('window_end_exclusive', '2026-09-16T17:55:00Z', 'approved experiment boundary'),
        ('first_scheduled_window', '2026-09-09T17:55:00Z', 'collector_runs'),
        ('last_included_scheduled_window', '2026-09-16T17:50:00Z', 'collector_runs'),
        ('scheduled_windows_expected', EXP_W, '7 days x 288'),
        ('scheduled_windows_observed', inv['windows_with_claimed_runs'], 'distinct claimed window_start'),
        ('missing_windows', EXP_W-inv['windows_with_claimed_runs'], 'expected minus observed'),
        ('duplicate_windows', len(D['duplicateWindows']), 'claimed runs per window > 1'),
        ('off_grid_windows', len(D['offGrid']), 'window_start not on a 300s boundary'),
        ('successful_windows', st['SUCCESS'], 'status=SUCCESS'),
        ('partial_windows', st['PARTIAL'], 'status=PARTIAL'),
        ('failed_windows', st['FAILED'], 'status=FAILED'),
        ('observations_expected', EXP_OBS, '2016 x 100'),
        ('observations_actual', obs, 'rows in claimed windows'),
        ('observation_completeness_pct', round(100.0*obs/EXP_OBS, 4), 'actual / expected'),
        ('duplicate_asset_window_pairs', len(D['duplicatePairs']), 'group by window,asset having count>1'),
        ('missing_asset_window_pairs', len(D['missingPairs']), 'grid cross tracked assets minus present'),
        ('distinct_assets', inv['distinct_assets'], 'distinct asset_id'),
        ('source', inv['source'], 'market_observations.source'),
        ('currency', inv['currency'], 'market_observations.currency'),
        ('distinct_currencies', inv['distinct_currencies'], 'market_observations.currency'),
        ('earliest_provider_updated_at', inv['first_source_updated_at'], 'min(source_updated_at)'),
        ('latest_provider_updated_at', inv['last_source_updated_at'], 'max(source_updated_at)'),
        ('earliest_provider_created_at', inv['first_source_created_at'], 'min(source_created_at)'),
        ('latest_provider_created_at', inv['last_source_created_at'], 'max(source_created_at)'),
        ('first_observed_at', inv['first_observed_at'], 'min(observed_at)'),
        ('last_observed_at', inv['last_observed_at'], 'max(observed_at)'),
        ('freshness_min_s', round(float(fr['min_s']), 3), 'observed_at - source_updated_at'),
        ('freshness_median_s', round(float(fr['median_s']), 3), 'observed_at - source_updated_at'),
        ('freshness_mean_s', round(float(fr['mean_s']), 3), 'observed_at - source_updated_at'),
        ('freshness_p95_s', round(float(fr['p95_s']), 3), 'observed_at - source_updated_at'),
        ('freshness_p99_s', round(float(fr['p99_s']), 3), 'observed_at - source_updated_at'),
        ('freshness_max_s', round(float(fr['max_s']), 3), 'observed_at - source_updated_at'),
        ('freshness_over_7m_observations', fr['over_7m'], 'lag > 420s'),
        ('freshness_over_10m_observations', fr['over_10m'], 'lag > 600s'),
        ('freshness_over_15m_observations', fr['over_15m'], 'lag > 900s'),
        ('freshness_affected_windows', len(D['freshnessByWindow']), 'windows with max lag > 420s'),
        ('job_duration_median_s', round(pc(dur, .5)/1000, 3), 'collector_runs.duration_ms'),
        ('job_duration_p95_s', round(pc(dur, .95)/1000, 3), 'collector_runs.duration_ms'),
        ('job_duration_max_s', round(max(dur)/1000, 3), 'collector_runs.duration_ms'),
        ('provider_http_429', 0, 'items/history status codes recorded'),
        ('provider_http_5xx', 0, 'items/history status codes recorded'),
        ('provider_http_4xx', 1, 'items endpoint HTTP 400 at 2026-09-15T19:35:00Z'),
        ('invalid_values', 0, 'currency/quantity/price-order/identity checks'),
        ('future_timestamps', qual['future_source_time']+qual['future_observed_time'], 'source/observed time > now'),
        ('timestamp_anomalies', qual['source_time_after_observation']+qual['created_after_updated']
            + qual['observed_before_window']+qual['observed_after_window'], 'ordering checks'),
        ('missing_values', qual['null_min_price']+qual['null_median_price']+qual['null_sales_24h_volume']
            + qual['null_history_payload'], 'NULL price/volume/history payload'),
        ('database_bytes', S['measured']['database_bytes'], 'pg_database_size'),
        ('observation_relation_bytes', S['measured']['observation_relation_bytes'], 'pg_total_relation_size'),
        ('observation_index_bytes', int(sizes['market_observations']['index_bytes']), 'pg_indexes_size'),
        ('observation_growth_mb_per_day', round(S['measured']['measured_observation_growth_mb_per_day'], 3), 'measured over the 7 days'),
    ]
    w.writerows(rows)

with (OUT/'freshness-anomalies.csv').open('w', newline='') as fh:
    w = csv.writer(fh); w.writerow(['window_start_utc', 'observations', 'source_lag_s', 'band', 'classification'])
    for x in D['freshnessByWindow']:
        lag = float(x['max_s'])
        band = '>15m' if lag > 900 else ('>10m' if lag > 600 else '>7m')
        w.writerow([x['window_start'], x['observations'], round(lag, 3), band, 'PROVIDER DATA BEHAVIOR'])

with (OUT/'storage-projection.csv').open('w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['universe_assets', 'kind', 'rows_per_day', 'observation_mb_per_day', 'rows_30d',
                'observation_gb_30d', 'rows_365d', 'observation_gb_365d'])
    for u, v in S['projected'].items():
        w.writerow([u, 'MEASURED' if u == '100' else 'PROJECTED', v['rows_per_day'],
                    round(v['observation_mb_per_day'], 2), v['rows_30d'], round(v['observation_gb_30d'], 3),
                    v['rows_365d'], round(v['observation_gb_365d'], 2)])

SCREENER = [
    ('Most Active', 'SUPPORTED NOW', 'Rank by observed listing-quantity and minimum-price transitions per asset. '
     '6,145 listing transitions and 3,747 minimum-price transitions are recorded over 201,035 adjacent five-minute comparisons; '
     '91 assets show at least one listing change and 94 at least one price change.'),
    ('Price Movers', 'SUPPORTED NOW', 'Absolute observed return over 1h/6h/24h/7d is computable for all 100 assets. '
     'Rank on median listing price as well as minimum price: minimum price is the single cheapest listing and is the noisier of the two.'),
    ('Price Up', 'SUPPORTED NOW', '27 assets closed the period above their first minimum price; horizon-level counts are available for every asset.'),
    ('Price Down', 'SUPPORTED NOW', '65 assets closed below their first minimum price.'),
    ('Listings Contracting', 'SUPPORTED NOW', 'Listing-quantity change over 1h/6h/24h/7d is observed directly; 55 assets ended with fewer listings. '
     'This is Skinport venue supply, not global circulating supply.'),
    ('Listings Expanding', 'SUPPORTED NOW', '30 assets ended with more listings. Same venue-scope caveat.'),
    ('High Volatility', 'EXPERIMENTAL', 'Realized volatility of five-minute minimum-price returns is computable for all 100 assets and non-zero for 94, '
     'but the ranking is dominated by price granularity: 7 of the 10 highest-volatility assets trade under USD 2, where a one-cent tick is a multi-percent move, '
     'while only 22 of 100 assets are under USD 2. Needs a price-level control or a median-price basis before it is shipped as a ranking.'),
    ('Quiet Markets', 'SUPPORTED NOW', '6 assets recorded zero minimum-price transitions and 9 recorded zero listing-quantity transitions across the full seven days; '
     'no asset was quiet on both. The absence of change is directly observed rather than inferred.'),
    ('Fresh Changes', 'SUPPORTED NOW', 'Every observation carries observed_at and provider source_updated_at. Median source age is 302.99s and p95 311.82s, '
     'so "changed in the last N minutes" is answerable. Label it as observation age, not real-time.'),
    ('price rising + listings contracting', 'SUPPORTED NOW (descriptive only)', 'The most common joint state: 5.20% of 1h periods, 12.98% of 6h, 19.77% of 24h, spanning 80-81 assets. '
     'Ship as a descriptive state filter. It must not be labelled a buy signal - see the mechanical confounder in the price x listing-supply section.'),
    ('price falling + listings expanding', 'SUPPORTED NOW (descriptive only)', '3.20% of 1h periods, 9.71% of 6h, 18.17% of 24h, spanning 73-75 assets. Same caveat.'),
    ('price stable + listings contracting', 'EXPERIMENTAL', 'Representable, but at 1h it is largely inside the 11.61% "price flat, listings moved" bucket, '
     'which is dominated by sub-tick supply churn. Needs a stated price-stability tolerance rather than exact equality before it is useful.'),
    ('high volatility + high listing activity', 'EXPERIMENTAL', 'Both inputs exist per asset, but volatility inherits the price-granularity bias above and '
     'the two rankings correlate through market size. Usable as an exploratory view, not a headline preset.'),
    ('Published 24h sales ranking / "most traded"', 'NOT YET SUPPORTED', 'The provider republishes rolling 24h sales roughly once a day: 468 value changes across 89 assets in seven days, '
     'median 1,450 minutes between changes per asset. Repeated snapshots are not independent transactions and cannot be summed. '
     'Usable as a slow daily context series only.'),
    ('Lead/lag or predictive screens', 'NOT YET SUPPORTED', 'Listing change then forward price return is effectively uncorrelated across the universe '
     '(pooled Pearson +0.025 at 1h, +0.035 at 6h, -0.003 at 24h; non-overlapping 24h n=500, 95% CI -0.083 to +0.093). No predictive content is established.'),
]
with (OUT/'screener-feasibility.csv').open('w', newline='') as fh:
    w = csv.writer(fh); w.writerow(['preset', 'classification', 'evidence'])
    w.writerows(SCREENER)

summary = {
    'window': {'startInclusive': '2026-09-09T17:55:00Z', 'endExclusive': '2026-09-16T17:55:00Z',
               'firstScheduledWindow': '2026-09-09T17:55:00Z', 'lastIncludedScheduledWindow': '2026-09-16T17:50:00Z',
               'scheduledWindows': EXP_W, 'assets': EXP_A, 'expectedObservations': EXP_OBS},
    'collection': {'observedWindows': inv['windows_with_claimed_runs'], 'missingWindows': EXP_W-inv['windows_with_claimed_runs'],
                   'duplicateWindows': len(D['duplicateWindows']), 'success': st['SUCCESS'], 'partial': st['PARTIAL'],
                   'failed': st['FAILED'], 'observations': obs, 'completenessPct': 100.0*obs/EXP_OBS,
                   'duplicateAssetWindowPairs': len(D['duplicatePairs']), 'missingAssetWindowPairs': len(D['missingPairs']),
                   'jobDurationMedianS': pc(dur, .5)/1000, 'jobDurationP95S': pc(dur, .95)/1000, 'jobDurationMaxS': max(dur)/1000},
    'quality': qual, 'freshness': fr,
    'providerEvents': [
        {'at': '2026-09-15T19:35:00Z', 'type': 'PROVIDER HTTP 400 on items endpoint',
         'effect': '1 failed window, 100 missing asset/window pairs', 'classification': 'PROVIDER DATA BEHAVIOR'},
        {'from': '2026-09-15T19:50:00Z', 'through': '2026-09-16T17:50:00Z',
         'type': 'Souvenir AWP | Dragon Lore (Factory New) left the Skinport items feed',
         'effect': '265 partial windows, 265 missing asset/window pairs', 'classification': 'PROVIDER DATA BEHAVIOR / MARKET EVENT'},
    ],
    'marketUsefulness': agg, 'storage': S,
    'priceListingStates': {h: {s: {'count': v['count'], 'sharePct': v['share_pct'], 'assets': v['assets_represented']}
                               for s, v in A['priceListingStates'][h]['states'].items()} for h in ('1h', '6h', '24h')},
    'leadLagHeadline': {m: {h: {'pooledPearsonOverlapping': A['leadLag'][m][h]['overlapping']['pooled_pearson'],
                                'pooledPearsonNonOverlapping': A['leadLag'][m][h]['non_overlapping']['pooled_pearson'],
                                'nonOverlappingN': A['leadLag'][m][h]['non_overlapping']['pooled_n'],
                                'ci95NonOverlapping': A['leadLag'][m][h]['non_overlapping']['pooled_pearson_ci95_if_independent']}
                            for h in ('1h', '6h', '24h')} for m in ('listing_to_price', 'price_to_listing')},
    'contemporaneous': A['contemporaneous'], 'confounders': C,
}
(OUT/'summary.json').write_text(json.dumps(summary, indent=1, default=str)+'\n')
print(json.dumps({'reliability_rows': len(rows), 'screener_rows': len(SCREENER),
                  'coverage_distribution': {str(k): v for k, v in cov.items()}}, indent=1))
