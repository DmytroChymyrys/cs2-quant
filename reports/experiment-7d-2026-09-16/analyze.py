"""FloatAlpha 7-day experiment - Phases 3-7 analysis over the frozen series.

Reads only reports/experiment-7d-2026-09-16/series.csv.gz (the frozen export).
Writes analysis.json plus machine-readable CSVs. No database access, no writes
outside the report directory.
"""
import csv, gzip, json, math, statistics, collections
from pathlib import Path

OUT = Path('reports/experiment-7d-2026-09-16')
WINDOWS = 2016           # scheduled five-minute windows in the experiment
H1, H6, H24 = 12, 72, 288
HORIZONS = [('1h', H1), ('6h', H6), ('24h', H24)]

# ---------------------------------------------------------------- utilities
def pct(x, n):
    return None if not n else 100.0 * x / n

def percentile(vals, p):
    s = sorted(vals)
    if not s:
        return None
    i = (len(s) - 1) * p
    lo, hi = math.floor(i), math.ceil(i)
    return s[lo] + (s[hi] - s[lo]) * (i - lo)

def describe(vals):
    if not vals:
        return {'n': 0}
    return {
        'n': len(vals), 'mean': statistics.fmean(vals), 'median': percentile(vals, .5),
        'p05': percentile(vals, .05), 'p25': percentile(vals, .25), 'p75': percentile(vals, .75),
        'p95': percentile(vals, .95), 'min': min(vals), 'max': max(vals),
        'stdev': statistics.stdev(vals) if len(vals) > 1 else 0.0,
    }

def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sxy = sxx = syy = 0.0
    for a, b in zip(xs, ys):
        da, db = a - mx, b - my
        sxy += da * db; sxx += da * da; syy += db * db
    if sxx <= 0 or syy <= 0:
        return None
    return sxy / math.sqrt(sxx * syy)

def ranks(vals):
    order = sorted(range(len(vals)), key=lambda i: vals[i])
    r = [0.0] * len(vals)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and vals[order[j + 1]] == vals[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            r[order[k]] = avg
        i = j + 1
    return r

def spearman(xs, ys):
    if len(xs) < 3:
        return None
    return pearson(ranks(xs), ranks(ys))

def fisher_ci(r, n, z=1.959963985):
    """Approximate 95% CI for a correlation. Valid only for independent samples."""
    if r is None or n is None or n < 4 or abs(r) >= 1:
        return None
    f = 0.5 * math.log((1 + r) / (1 - r))
    se = 1.0 / math.sqrt(n - 3)
    lo, hi = f - z * se, f + z * se
    return [math.tanh(lo), math.tanh(hi)]

# ---------------------------------------------------------------- load
rows = 0
assets = {}
categories = {}
with gzip.open(OUT / 'series.csv.gz', 'rt', encoding='utf-8') as fh:
    for rec in csv.DictReader(fh):
        rows += 1
        a = rec['asset']
        if a not in assets:
            assets[a] = [None] * WINDOWS
            categories[a] = rec['category']
        w = int(rec['w'])
        assets[a][w] = (
            float(rec['min_price']), float(rec['median_price']), float(rec['max_price']),
            float(rec['mean_price']), float(rec['suggested_price']), int(rec['quantity']),
            int(rec['sales_24h_volume']), float(rec['lag_s']), rec['history_state'],
        )
MIN, MED, MAX, MEAN, SUG, QTY, V24, LAG, HST = range(9)
ASSETS = sorted(assets)

# ---------------------------------------------------------------- Phase 3
def field_stats(arr, idx, numeric=True):
    pres = [(w, r[idx]) for w, r in enumerate(arr) if r is not None]
    if not pres:
        return None
    vals = [v for _, v in pres]
    st = {
        'observations': len(pres), 'first': vals[0], 'last': vals[-1],
        'distinct_states': len(set(vals)),
    }
    if numeric:
        st.update({'min': min(vals), 'max': max(vals),
                   'absolute_change': vals[-1] - vals[0],
                   'percent_change': (100.0 * (vals[-1] - vals[0]) / vals[0]) if vals[0] else None,
                   'observed_range_pct': (100.0 * (max(vals) - min(vals)) / min(vals)) if min(vals) else None})
        rng = max(vals) - min(vals)
        st['position_in_range_pct'] = (100.0 * (vals[-1] - min(vals)) / rng) if rng else None
    # adjacent comparisons only across contiguous five-minute steps
    adj = up = down = 0
    trans = 0
    for i in range(1, len(pres)):
        if pres[i][0] - pres[i - 1][0] != 1:
            continue
        adj += 1
        if pres[i][1] != pres[i - 1][1]:
            trans += 1
            if numeric:
                if pres[i][1] > pres[i - 1][1]:
                    up += 1
                else:
                    down += 1
    st['adjacent_comparisons'] = adj
    st['transitions'] = trans
    st['percent_adjacent_changed'] = pct(trans, adj)
    if numeric:
        st['increases'] = up
        st['decreases'] = down
    return st

per_asset = {}
for a in ASSETS:
    arr = assets[a]
    pres_w = [w for w, r in enumerate(arr) if r is not None]
    market_states = {(r[MIN], r[MED], r[MAX], r[MEAN], r[SUG], r[QTY]) for r in arr if r is not None}
    lags = [r[LAG] for r in arr if r is not None]
    per_asset[a] = {
        'asset': a, 'category': categories[a],
        'observations': len(pres_w),
        'coverage_pct': pct(len(pres_w), WINDOWS),
        'first_window': pres_w[0] if pres_w else None,
        'last_window': pres_w[-1] if pres_w else None,
        'window_gaps': sum(1 for i in range(1, len(pres_w)) if pres_w[i] - pres_w[i - 1] != 1),
        'min_price': field_stats(arr, MIN),
        'median_price': field_stats(arr, MED),
        'quantity': field_stats(arr, QTY),
        'sales_24h_volume': field_stats(arr, V24),
        'history_state': field_stats(arr, HST, numeric=False),
        'distinct_market_states': len(market_states),
        'freshness': {'median_s': percentile(lags, .5), 'p95_s': percentile(lags, .95),
                      'max_s': max(lags) if lags else None,
                      'over_7m': sum(1 for x in lags if x > 420),
                      'over_10m': sum(1 for x in lags if x > 600),
                      'over_15m': sum(1 for x in lags if x > 900)},
    }

# ---------------------------------------------------------------- Phase 4
def ret(arr, t, h, idx=MIN):
    a, b = arr[t - h], arr[t]
    if a is None or b is None or a[idx] <= 0:
        return None
    return b[idx] / a[idx] - 1.0

def delta(arr, t, h, idx=QTY):
    a, b = arr[t - h], arr[t]
    if a is None or b is None:
        return None
    return b[idx] - a[idx]

def rel_delta(arr, t, h, idx=QTY):
    a, b = arr[t - h], arr[t]
    if a is None or b is None or a[idx] == 0:
        return None
    return (b[idx] - a[idx]) / a[idx]

derived = {}
for a in ASSETS:
    arr = assets[a]
    pres_w = [w for w, r in enumerate(arr) if r is not None]
    last = pres_w[-1]
    # five-minute log returns on minimum listing price, contiguous steps only
    logrets, qrels = [], []
    for i in range(1, len(pres_w)):
        if pres_w[i] - pres_w[i - 1] != 1:
            continue
        p0, p1 = arr[pres_w[i - 1]][MIN], arr[pres_w[i]][MIN]
        if p0 > 0 and p1 > 0:
            logrets.append(math.log(p1 / p0))
        q0, q1 = arr[pres_w[i - 1]][QTY], arr[pres_w[i]][QTY]
        if q0:
            qrels.append((q1 - q0) / q0)
    rv5 = statistics.stdev(logrets) if len(logrets) > 1 else None
    prices = [r[MIN] for r in arr if r is not None]
    qtys = [r[QTY] for r in arr if r is not None]
    steps_q = sum(1 for i in range(1, len(pres_w)) if pres_w[i] - pres_w[i - 1] == 1)
    contr = sum(1 for i in range(1, len(pres_w))
                if pres_w[i] - pres_w[i - 1] == 1 and arr[pres_w[i]][QTY] < arr[pres_w[i - 1]][QTY])
    expan = sum(1 for i in range(1, len(pres_w))
                if pres_w[i] - pres_w[i - 1] == 1 and arr[pres_w[i]][QTY] > arr[pres_w[i - 1]][QTY])
    derived[a] = {
        'asset': a, 'category': categories[a],
        'price_return_1h': ret(arr, last, H1) if last >= H1 else None,
        'price_return_6h': ret(arr, last, H6) if last >= H6 else None,
        'price_return_24h': ret(arr, last, H24) if last >= H24 else None,
        'price_return_observed_period': (prices[-1] / prices[0] - 1.0) if prices and prices[0] > 0 else None,
        'realized_vol_5m': rv5,
        'realized_vol_daily_scaled': rv5 * math.sqrt(288) if rv5 is not None else None,
        'realized_vol_period_scaled': rv5 * math.sqrt(len(logrets)) if rv5 is not None else None,
        'nonzero_5m_return_steps': sum(1 for x in logrets if x != 0.0),
        'price_steps': len(logrets),
        'observed_low': min(prices) if prices else None,
        'observed_high': max(prices) if prices else None,
        'observed_range_pct': (100.0 * (max(prices) - min(prices)) / min(prices)) if prices and min(prices) else None,
        'position_in_range_pct': (100.0 * (prices[-1] - min(prices)) / (max(prices) - min(prices)))
                                 if prices and max(prices) > min(prices) else None,
        'listing_change_1h': delta(arr, last, H1) if last >= H1 else None,
        'listing_change_6h': delta(arr, last, H6) if last >= H6 else None,
        'listing_change_24h': delta(arr, last, H24) if last >= H24 else None,
        'listing_change_observed_period': (qtys[-1] - qtys[0]) if qtys else None,
        'listing_change_observed_period_pct': (100.0 * (qtys[-1] - qtys[0]) / qtys[0]) if qtys and qtys[0] else None,
        'listing_low': min(qtys) if qtys else None,
        'listing_high': max(qtys) if qtys else None,
        'contraction_steps': contr, 'expansion_steps': expan, 'listing_steps': steps_q,
        'contraction_frequency_pct': pct(contr, steps_q),
        'expansion_frequency_pct': pct(expan, steps_q),
        'listing_volatility_5m': statistics.stdev(qrels) if len(qrels) > 1 else None,
        'sales_24h_volume_first': arr[pres_w[0]][V24], 'sales_24h_volume_last': arr[last][V24],
        'history_state_transitions': per_asset[a]['history_state']['transitions'],
        'distinct_history_states': per_asset[a]['history_state']['distinct_states'],
    }

# ---------------------------------------------------------------- Phase 5
def classify(pr, lc):
    if pr > 0 and lc < 0: return 'PRICE UP + LISTINGS DOWN'
    if pr > 0 and lc > 0: return 'PRICE UP + LISTINGS UP'
    if pr < 0 and lc < 0: return 'PRICE DOWN + LISTINGS DOWN'
    if pr < 0 and lc > 0: return 'PRICE DOWN + LISTINGS UP'
    if pr == 0 and lc == 0: return 'PRICE FLAT + LISTINGS FLAT'
    if pr == 0: return 'PRICE FLAT + LISTINGS MOVED'
    return 'PRICE MOVED + LISTINGS FLAT'

FOUR = ['PRICE UP + LISTINGS DOWN', 'PRICE UP + LISTINGS UP',
        'PRICE DOWN + LISTINGS DOWN', 'PRICE DOWN + LISTINGS UP']

states = {}
for label, h in HORIZONS:
    counts = collections.Counter()
    assets_in = collections.defaultdict(set)
    fwd = collections.defaultdict(list)      # forward price return after each state
    persist_hit = collections.Counter()
    persist_tot = collections.Counter()
    for a in ASSETS:
        arr = assets[a]
        for t in range(h, WINDOWS):
            pr, lc = ret(arr, t, h), delta(arr, t, h)
            if pr is None or lc is None:
                continue
            s = classify(pr, lc)
            counts[s] += 1
            assets_in[s].add(a)
            if t + h < WINDOWS:
                f = ret(arr, t + h, h)
                if f is not None:
                    fwd[s].append(f)
                fl = delta(arr, t + h, h)
                if fl is not None:
                    persist_tot[s] += 1
                    if classify(f, fl) == s if f is not None else False:
                        persist_hit[s] += 1
    total = sum(counts.values())
    states[label] = {
        'horizon_windows': h, 'total_observed_periods': total,
        'overlapping': True,
        'states': {s: {
            'count': counts[s], 'share_pct': pct(counts[s], total),
            'assets_represented': len(assets_in[s]),
            'persistence_pct': pct(persist_hit[s], persist_tot[s]),
            'persistence_sample': persist_tot[s],
            'forward_price_return': describe(fwd[s]),
        } for s in sorted(counts, key=lambda k: -counts[k])},
    }

# ---------------------------------------------------------------- Phase 6
def pairs(h, mode, overlap):
    """mode 'listing_to_price': listing change over [t-h,t] vs price return over [t,t+h].
       mode 'price_to_listing': price return over [t-h,t] vs listing change over [t,t+h]."""
    pooled_x, pooled_y, by_asset = [], [], {}
    step = 1 if overlap else h
    for a in ASSETS:
        arr = assets[a]
        xs, ys = [], []
        t = h
        while t + h < WINDOWS:
            if mode == 'listing_to_price':
                x, y = rel_delta(arr, t, h), ret(arr, t + h, h)
            else:
                x, y = ret(arr, t, h), rel_delta(arr, t + h, h)
            if x is not None and y is not None:
                xs.append(x); ys.append(y)
            t += step
        if xs:
            pooled_x.extend(xs); pooled_y.extend(ys)
            by_asset[a] = (xs, ys)
    return pooled_x, pooled_y, by_asset

leadlag = {}
for mode in ('listing_to_price', 'price_to_listing'):
    leadlag[mode] = {}
    for label, h in HORIZONS:
        entry = {}
        for overlap in (True, False):
            px, py, ba = pairs(h, mode, overlap)
            per = {}
            for a, (xs, ys) in ba.items():
                r = pearson(xs, ys)
                if r is not None:
                    per[a] = r
            rs = list(per.values())
            key = 'overlapping' if overlap else 'non_overlapping'
            entry[key] = {
                'pooled_n': len(px),
                'pooled_pearson': pearson(px, py),
                'pooled_spearman': spearman(px, py),
                'pooled_pearson_ci95_if_independent': fisher_ci(pearson(px, py), len(px)),
                'assets_with_correlation': len(rs),
                'per_asset_pearson': describe(rs),
                'assets_positive': sum(1 for r in rs if r > 0),
                'assets_negative': sum(1 for r in rs if r < 0),
                'assets_abs_gt_0_10': sum(1 for r in rs if abs(r) > 0.10),
                'samples_per_asset_median': percentile([len(v[0]) for v in ba.values()], .5),
            }
        leadlag[mode][label] = entry

# contemporaneous (descriptive, not lead/lag)
contemp = {}
for label, h in HORIZONS:
    px, py, per = [], [], {}
    for a in ASSETS:
        arr = assets[a]
        xs, ys = [], []
        for t in range(h, WINDOWS):
            x, y = rel_delta(arr, t, h), ret(arr, t, h)
            if x is not None and y is not None:
                xs.append(x); ys.append(y)
        if xs:
            px.extend(xs); py.extend(ys)
            r = pearson(xs, ys)
            if r is not None:
                per[a] = r
    rs = list(per.values())
    contemp[label] = {'pooled_n': len(px), 'pooled_pearson': pearson(px, py),
                      'pooled_spearman': spearman(px, py),
                      'per_asset_pearson': describe(rs),
                      'assets_negative': sum(1 for r in rs if r < 0),
                      'assets_positive': sum(1 for r in rs if r > 0)}

# ---------------------------------------------------------------- Phase 7 inputs
def safe(v, d=0.0):
    return d if v is None else v

case_inputs = []
for a in ASSETS:
    d, p = derived[a], per_asset[a]
    case_inputs.append({
        'asset': a, 'category': d['category'],
        'observations': p['observations'],
        'period_return_pct': 100.0 * safe(d['price_return_observed_period']),
        'listing_change_pct': safe(d['listing_change_observed_period_pct']),
        'listing_change_abs': safe(d['listing_change_observed_period']),
        'realized_vol_daily_pct': 100.0 * safe(d['realized_vol_daily_scaled']),
        'observed_range_pct': safe(d['observed_range_pct']),
        'price_transitions': p['min_price']['transitions'],
        'listing_transitions': p['quantity']['transitions'],
        'listing_activity_pct': safe(p['quantity']['percent_adjacent_changed']),
        'price_activity_pct': safe(p['min_price']['percent_adjacent_changed']),
        'sales_transitions': p['sales_24h_volume']['transitions'],
        'history_transitions': p['history_state']['transitions'],
        'first_price': p['min_price']['first'], 'last_price': p['min_price']['last'],
        'first_qty': p['quantity']['first'], 'last_qty': p['quantity']['last'],
        'lead_lag_1h_pearson': leadlag['listing_to_price']['1h']['overlapping'].get('_', None),
    })
for c in case_inputs:
    c.pop('lead_lag_1h_pearson')

# ---------------------------------------------------------------- aggregates
def count_assets(pred):
    return sum(1 for a in ASSETS if pred(per_asset[a]))

aggregate = {
    'assets': len(ASSETS), 'rows_loaded': rows,
    'any_change': {
        'min_price': count_assets(lambda p: p['min_price']['transitions'] > 0),
        'median_price': count_assets(lambda p: p['median_price']['transitions'] > 0),
        'quantity': count_assets(lambda p: p['quantity']['transitions'] > 0),
        'sales_24h_volume': count_assets(lambda p: p['sales_24h_volume']['transitions'] > 0),
        'history_state': count_assets(lambda p: p['history_state']['transitions'] > 0),
        'any_market_field': count_assets(lambda p: p['distinct_market_states'] > 1),
    },
    'material_change': {
        'min_price_abs_pct_ge_0_5': count_assets(
            lambda p: p['min_price']['percent_change'] is not None and abs(p['min_price']['percent_change']) >= 0.5),
        'median_price_abs_pct_ge_0_5': count_assets(
            lambda p: p['median_price']['percent_change'] is not None and abs(p['median_price']['percent_change']) >= 0.5),
        'quantity_abs_ge_1': count_assets(lambda p: abs(p['quantity']['absolute_change']) >= 1),
        'quantity_abs_pct_ge_5': count_assets(
            lambda p: p['quantity']['percent_change'] is not None and abs(p['quantity']['percent_change']) >= 5),
        'sales_24h_volume_changed': count_assets(lambda p: p['sales_24h_volume']['absolute_change'] != 0),
        'history_state_ge_2_states': count_assets(lambda p: p['history_state']['distinct_states'] >= 2),
    },
    'transitions_total': {
        'min_price': sum(per_asset[a]['min_price']['transitions'] for a in ASSETS),
        'median_price': sum(per_asset[a]['median_price']['transitions'] for a in ASSETS),
        'quantity': sum(per_asset[a]['quantity']['transitions'] for a in ASSETS),
        'sales_24h_volume': sum(per_asset[a]['sales_24h_volume']['transitions'] for a in ASSETS),
        'history_state': sum(per_asset[a]['history_state']['transitions'] for a in ASSETS),
        'adjacent_comparisons': sum(per_asset[a]['min_price']['adjacent_comparisons'] for a in ASSETS),
    },
    'direction_first_to_last': {
        'min_price_up': count_assets(lambda p: p['min_price']['last'] > p['min_price']['first']),
        'min_price_down': count_assets(lambda p: p['min_price']['last'] < p['min_price']['first']),
        'min_price_flat': count_assets(lambda p: p['min_price']['last'] == p['min_price']['first']),
        'quantity_up': count_assets(lambda p: p['quantity']['last'] > p['quantity']['first']),
        'quantity_down': count_assets(lambda p: p['quantity']['last'] < p['quantity']['first']),
        'quantity_flat': count_assets(lambda p: p['quantity']['last'] == p['quantity']['first']),
    },
    'distributions': {
        'period_return_pct': describe([100.0 * derived[a]['price_return_observed_period'] for a in ASSETS
                                       if derived[a]['price_return_observed_period'] is not None]),
        'realized_vol_daily_pct': describe([100.0 * derived[a]['realized_vol_daily_scaled'] for a in ASSETS
                                            if derived[a]['realized_vol_daily_scaled'] is not None]),
        'observed_range_pct': describe([derived[a]['observed_range_pct'] for a in ASSETS
                                        if derived[a]['observed_range_pct'] is not None]),
        'listing_change_period_pct': describe([derived[a]['listing_change_observed_period_pct'] for a in ASSETS
                                               if derived[a]['listing_change_observed_period_pct'] is not None]),
        'listing_activity_pct': describe([per_asset[a]['quantity']['percent_adjacent_changed'] for a in ASSETS]),
        'price_activity_pct': describe([per_asset[a]['min_price']['percent_adjacent_changed'] for a in ASSETS]),
        'contraction_frequency_pct': describe([derived[a]['contraction_frequency_pct'] for a in ASSETS
                                               if derived[a]['contraction_frequency_pct'] is not None]),
        'expansion_frequency_pct': describe([derived[a]['expansion_frequency_pct'] for a in ASSETS
                                             if derived[a]['expansion_frequency_pct'] is not None]),
        'distinct_history_states': describe([float(derived[a]['distinct_history_states']) for a in ASSETS]),
        'history_transitions': describe([float(derived[a]['history_state_transitions']) for a in ASSETS]),
    },
    'feature_availability': {
        label: sum(1 for a in ASSETS if derived[a]['price_return_%s' % label] is not None)
        for label, _ in HORIZONS
    },
}

result = {
    'window': {'startInclusive': '2026-09-09T17:55:00.000Z', 'endExclusive': '2026-09-16T17:55:00.000Z',
               'scheduledWindows': WINDOWS, 'assets': len(ASSETS), 'observationsLoaded': rows},
    'aggregate': aggregate, 'perAsset': per_asset, 'derived': derived,
    'priceListingStates': states, 'leadLag': leadlag, 'contemporaneous': contemp,
    'caseInputs': case_inputs,
    'notes': [
        'Adjacent comparisons use contiguous five-minute steps only; observation gaps are not compared across.',
        'Overlapping horizon samples are serially correlated; non-overlapping figures are reported alongside.',
        'Published rolling 24h sales values are provider snapshots, not independent transactions.',
    ],
}
(OUT / 'analysis.json').write_text(json.dumps(result, indent=1, default=str) + '\n')

# ------------------------------------------------------------- CSV outputs
with (OUT / 'asset-detail.csv').open('w', newline='') as fh:
    cols = ['asset', 'category', 'observations', 'coverage_pct', 'window_gaps',
            'min_price_first', 'min_price_last', 'min_price_low', 'min_price_high',
            'min_price_abs_change', 'min_price_pct_change', 'min_price_transitions',
            'min_price_pct_adjacent_changed', 'min_price_distinct_states',
            'median_price_first', 'median_price_last', 'median_price_pct_change', 'median_price_transitions',
            'quantity_first', 'quantity_last', 'quantity_low', 'quantity_high',
            'quantity_abs_change', 'quantity_pct_change', 'quantity_transitions',
            'quantity_pct_adjacent_changed', 'quantity_distinct_states',
            'sales_24h_first', 'sales_24h_last', 'sales_24h_min', 'sales_24h_max',
            'sales_24h_abs_change', 'sales_24h_transitions', 'sales_24h_distinct_states',
            'history_state_transitions', 'history_state_distinct', 'distinct_market_states',
            'realized_vol_daily_pct', 'observed_range_pct', 'position_in_range_pct',
            'contraction_frequency_pct', 'expansion_frequency_pct', 'listing_volatility_5m',
            'price_return_1h', 'price_return_6h', 'price_return_24h', 'price_return_period',
            'listing_change_1h', 'listing_change_6h', 'listing_change_24h', 'listing_change_period',
            'freshness_median_s', 'freshness_p95_s', 'freshness_max_s', 'freshness_over_10m']
    w = csv.writer(fh); w.writerow(cols)
    for a in ASSETS:
        p, d = per_asset[a], derived[a]
        w.writerow([a, p['category'], p['observations'], round(p['coverage_pct'], 4), p['window_gaps'],
                    p['min_price']['first'], p['min_price']['last'], p['min_price']['min'], p['min_price']['max'],
                    p['min_price']['absolute_change'], p['min_price']['percent_change'], p['min_price']['transitions'],
                    p['min_price']['percent_adjacent_changed'], p['min_price']['distinct_states'],
                    p['median_price']['first'], p['median_price']['last'], p['median_price']['percent_change'],
                    p['median_price']['transitions'],
                    p['quantity']['first'], p['quantity']['last'], p['quantity']['min'], p['quantity']['max'],
                    p['quantity']['absolute_change'], p['quantity']['percent_change'], p['quantity']['transitions'],
                    p['quantity']['percent_adjacent_changed'], p['quantity']['distinct_states'],
                    p['sales_24h_volume']['first'], p['sales_24h_volume']['last'], p['sales_24h_volume']['min'],
                    p['sales_24h_volume']['max'], p['sales_24h_volume']['absolute_change'],
                    p['sales_24h_volume']['transitions'], p['sales_24h_volume']['distinct_states'],
                    p['history_state']['transitions'], p['history_state']['distinct_states'],
                    p['distinct_market_states'],
                    None if d['realized_vol_daily_scaled'] is None else 100.0 * d['realized_vol_daily_scaled'],
                    d['observed_range_pct'], d['position_in_range_pct'],
                    d['contraction_frequency_pct'], d['expansion_frequency_pct'], d['listing_volatility_5m'],
                    d['price_return_1h'], d['price_return_6h'], d['price_return_24h'],
                    d['price_return_observed_period'],
                    d['listing_change_1h'], d['listing_change_6h'], d['listing_change_24h'],
                    d['listing_change_observed_period'],
                    p['freshness']['median_s'], p['freshness']['p95_s'], p['freshness']['max_s'],
                    p['freshness']['over_10m']])

with (OUT / 'price-listing-states.csv').open('w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['horizon', 'state', 'count', 'share_pct', 'assets_represented', 'persistence_pct',
                'persistence_sample', 'forward_return_n', 'forward_return_mean_pct',
                'forward_return_median_pct', 'forward_return_p05_pct', 'forward_return_p95_pct'])
    for label, _ in HORIZONS:
        for s, v in states[label]['states'].items():
            f = v['forward_price_return']
            w.writerow([label, s, v['count'], v['share_pct'], v['assets_represented'], v['persistence_pct'],
                        v['persistence_sample'], f.get('n'),
                        None if f.get('mean') is None else 100.0 * f['mean'],
                        None if f.get('median') is None else 100.0 * f['median'],
                        None if f.get('p05') is None else 100.0 * f['p05'],
                        None if f.get('p95') is None else 100.0 * f['p95']])

with (OUT / 'lead-lag.csv').open('w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['direction', 'horizon', 'sampling', 'pooled_n', 'pooled_pearson', 'pooled_spearman',
                'ci95_low_if_independent', 'ci95_high_if_independent', 'assets_with_r',
                'assets_positive', 'assets_negative', 'assets_abs_r_gt_0_10',
                'per_asset_r_median', 'per_asset_r_p05', 'per_asset_r_p95', 'samples_per_asset_median'])
    for mode in ('listing_to_price', 'price_to_listing'):
        for label, _ in HORIZONS:
            for key in ('overlapping', 'non_overlapping'):
                e = leadlag[mode][label][key]
                ci = e['pooled_pearson_ci95_if_independent'] or [None, None]
                pa = e['per_asset_pearson']
                w.writerow([mode, label, key, e['pooled_n'], e['pooled_pearson'], e['pooled_spearman'],
                            ci[0], ci[1], e['assets_with_correlation'], e['assets_positive'],
                            e['assets_negative'], e['assets_abs_gt_0_10'],
                            pa.get('median'), pa.get('p05'), pa.get('p95'), e['samples_per_asset_median']])

print(json.dumps({
    'rows': rows, 'assets': len(ASSETS),
    'coverage_min_pct': min(per_asset[a]['coverage_pct'] for a in ASSETS),
    'any_change': aggregate['any_change'], 'material_change': aggregate['material_change'],
    'transitions': aggregate['transitions_total'],
    'direction': aggregate['direction_first_to_last'],
    'states_1h': {s: v['count'] for s, v in states['1h']['states'].items()},
    'leadlag_1h_overlap': leadlag['listing_to_price']['1h']['overlapping']['pooled_pearson'],
    'leadlag_1h_nonoverlap': leadlag['listing_to_price']['1h']['non_overlapping']['pooled_pearson'],
}, indent=1))
