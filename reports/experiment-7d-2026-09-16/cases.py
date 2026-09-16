"""Phase 7 case-study candidate selection + Phase 9 storage arithmetic."""
import csv, gzip, json, math, statistics, collections
from pathlib import Path
OUT = Path('reports/experiment-7d-2026-09-16')
WINDOWS = 2016; H6 = 72

an = json.loads((OUT/'analysis.json').read_text())
dat = json.loads((OUT/'data.json').read_text())
per, der = an['perAsset'], an['derived']
ASSETS = sorted(per)

def percentile(v, p):
    s = sorted(v)
    if not s: return None
    i = (len(s)-1)*p; lo, hi = math.floor(i), math.ceil(i)
    return s[lo]+(s[hi]-s[lo])*(i-lo)
def pearson(xs, ys):
    if len(xs) < 3: return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys); sxy=sxx=syy=0.0
    for a,b in zip(xs,ys):
        da,db=a-mx,b-my; sxy+=da*db; sxx+=da*da; syy+=db*db
    return None if sxx<=0 or syy<=0 else sxy/math.sqrt(sxx*syy)
def ranks(v):
    o=sorted(range(len(v)),key=lambda i:v[i]); r=[0.0]*len(v); i=0
    while i<len(o):
        j=i
        while j+1<len(o) and v[o[j+1]]==v[o[i]]: j+=1
        a=(i+j)/2.0+1.0
        for k in range(i,j+1): r[o[k]]=a
        i=j+1
    return r
def spearman(xs,ys): return None if len(xs)<3 else pearson(ranks(xs),ranks(ys))

# reload series for per-asset 6h supply/price structure
series = {}
with gzip.open(OUT/'series.csv.gz','rt',encoding='utf-8') as fh:
    for rec in csv.DictReader(fh):
        series.setdefault(rec['asset'], [None]*WINDOWS)[int(rec['w'])] = (
            float(rec['min_price']), float(rec['median_price']), int(rec['quantity']))
MIN, MED, QTY = 0, 1, 2

struct = {}
for a in ASSETS:
    arr = series[a]; xs, ys, xm = [], [], []
    for t in range(H6, WINDOWS):
        p, c = arr[t-H6], arr[t]
        if p is None or c is None or p[QTY] == 0 or p[MIN] <= 0: continue
        xs.append((c[QTY]-p[QTY])/p[QTY]); ys.append(c[MIN]/p[MIN]-1.0)
        xm.append(c[MED]/p[MED]-1.0 if p[MED] > 0 else 0.0)
    struct[a] = {'n': len(xs),
                 'spearman_qty_vs_minprice_6h': spearman(xs, ys),
                 'spearman_qty_vs_medprice_6h': spearman(xs, xm)}

rows = []
for a in ASSETS:
    p, d, s = per[a], der[a], struct[a]
    rows.append({
        'asset': a, 'category': p['category'], 'observations': p['observations'],
        'period_return_pct': 100*d['price_return_observed_period'],
        'listing_change_pct': d['listing_change_observed_period_pct'],
        'listing_first': p['quantity']['first'], 'listing_last': p['quantity']['last'],
        'price_first': p['min_price']['first'], 'price_last': p['min_price']['last'],
        'realized_vol_daily_pct': 100*d['realized_vol_daily_scaled'] if d['realized_vol_daily_scaled'] else 0.0,
        'observed_range_pct': d['observed_range_pct'],
        'price_transitions': p['min_price']['transitions'],
        'listing_transitions': p['quantity']['transitions'],
        'listing_activity_pct': p['quantity']['percent_adjacent_changed'],
        'price_activity_pct': p['min_price']['percent_adjacent_changed'],
        'sales_transitions': p['sales_24h_volume']['transitions'],
        'sales_24h_first': p['sales_24h_volume']['first'], 'sales_24h_last': p['sales_24h_volume']['last'],
        'sales_24h_max': p['sales_24h_volume']['max'],
        'spearman_qty_minprice_6h': s['spearman_qty_vs_minprice_6h'],
        'spearman_qty_medprice_6h': s['spearman_qty_vs_medprice_6h'],
        'median_price_pct_change': p['median_price']['percent_change'],
    })
by = lambda k, rev=True, f=None: sorted([r for r in rows if f is None or f(r)], key=lambda r: (r[k] is None, r[k]), reverse=rev)

def show(title, lst, keys, n=8):
    print('\n== %s ==' % title)
    for r in lst[:n]:
        print('  ' + ' | '.join('%s=%s' % (k, ('%.3f' % r[k]) if isinstance(r[k], float) else r[k]) for k in ['asset']+keys))

show('price up + listings down (period)', by('period_return_pct', True, lambda r: r['listing_change_pct'] is not None and r['listing_change_pct'] < 0),
     ['period_return_pct','listing_change_pct','listing_first','listing_last','realized_vol_daily_pct'])
show('price down + listings up (period)', by('period_return_pct', False, lambda r: r['listing_change_pct'] is not None and r['listing_change_pct'] > 0),
     ['period_return_pct','listing_change_pct','listing_first','listing_last'])
show('high listing activity, stable price', by('listing_activity_pct', True, lambda r: abs(r['period_return_pct']) < 2),
     ['listing_activity_pct','listing_transitions','period_return_pct','observed_range_pct','listing_first','listing_last'])
show('highest realized volatility', by('realized_vol_daily_pct'), ['realized_vol_daily_pct','observed_range_pct','period_return_pct','price_transitions'])
show('quietest markets', by('price_transitions', False), ['price_transitions','listing_transitions','sales_transitions','period_return_pct','listing_first'])
show('strongest supply/median-price structure', sorted([r for r in rows if r['spearman_qty_medprice_6h'] is not None], key=lambda r: r['spearman_qty_medprice_6h']),
     ['spearman_qty_medprice_6h','spearman_qty_minprice_6h','listing_transitions','listing_first','listing_last','period_return_pct'], 10)
show('largest listing contraction', sorted([r for r in rows if r['listing_change_pct'] is not None], key=lambda r: r['listing_change_pct']),
     ['listing_change_pct','listing_first','listing_last','period_return_pct','median_price_pct_change'], 8)
show('largest listing expansion', by('listing_change_pct'), ['listing_change_pct','listing_first','listing_last','period_return_pct','median_price_pct_change'])
show('most published-sales activity', by('sales_transitions'), ['sales_transitions','sales_24h_first','sales_24h_last','sales_24h_max','listing_first'])

(OUT/'case-candidates.json').write_text(json.dumps({'rows': rows}, indent=1, default=str)+'\n')
with (OUT/'case-candidates.csv').open('w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

# ---------------- Phase 9 storage ----------------
sizes = {s['name']: s for s in dat['sizes']}
obs_total = int(sizes['market_observations']['total_bytes'])
obs_table = int(sizes['market_observations']['table_bytes'])
obs_index = int(sizes['market_observations']['index_bytes'])
runs_total = int(sizes['collector_runs']['total_bytes'])
db_bytes = int(dat['allTime']['database_bytes'])
rows_all = int(dat['allTime']['observations_all_time'])
baseline = 483328  # observation relation bytes at experiment start (experiment-config.json)
baseline_rows = 205
days = 7.0
MB = 1024**2; GB = 1024**3
measured = {
 'database_bytes': db_bytes, 'database_mb': db_bytes/MB,
 'observation_relation_bytes': obs_total, 'observation_relation_mb': obs_total/MB,
 'observation_table_mb': obs_table/MB, 'observation_index_mb': obs_index/MB,
 'collector_runs_mb': runs_total/MB,
 'observations_all_time': rows_all,
 'bytes_per_observation_incl_indexes': obs_total/rows_all,
 'bytes_per_observation_table_only': obs_table/rows_all,
 'experiment_growth_bytes': obs_total-baseline,
 'measured_observation_growth_mb_per_day': (obs_total-baseline)/MB/days,
 'measured_database_growth_mb_per_day': (db_bytes-8830976)/MB/days,
}
bpr = measured['bytes_per_observation_incl_indexes']
proj = {}
for universe in (100, 1000, 10000):
    rpd = universe*288
    proj[str(universe)] = {
        'rows_per_day': rpd,
        'observation_bytes_per_day': rpd*bpr, 'observation_mb_per_day': rpd*bpr/MB,
        'rows_30d': rpd*30, 'observation_gb_30d': rpd*30*bpr/GB,
        'rows_365d': rpd*365, 'observation_gb_365d': rpd*365*bpr/GB,
    }
storage = {'measured': measured, 'projected': proj,
           'basis': 'bytes/observation measured from the live relation including indexes and TOAST; '
                    'projections assume unchanged 5-minute cadence, full coverage, identical payload sizes '
                    'and no compression or retention change.'}
(OUT/'storage.json').write_text(json.dumps(storage, indent=1, default=str)+'\n')
print('\n== STORAGE ==')
print(json.dumps(storage, indent=1, default=str))
