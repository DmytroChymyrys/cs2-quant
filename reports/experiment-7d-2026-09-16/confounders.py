"""Confounder tests for the observed price x listing-supply relationship, plus
case-study candidate ranking. Reads the frozen series only."""
import csv, gzip, json, math, statistics, collections
from pathlib import Path

OUT = Path('reports/experiment-7d-2026-09-16')
WINDOWS = 2016
H1, H6, H24 = 12, 72, 288

def percentile(vals, p):
    s = sorted(vals)
    if not s: return None
    i = (len(s)-1)*p; lo, hi = math.floor(i), math.ceil(i)
    return s[lo] + (s[hi]-s[lo])*(i-lo)

def pearson(xs, ys):
    n = len(xs)
    if n < 3: return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sxy = sxx = syy = 0.0
    for a, b in zip(xs, ys):
        da, db = a-mx, b-my; sxy += da*db; sxx += da*da; syy += db*db
    return None if sxx <= 0 or syy <= 0 else sxy/math.sqrt(sxx*syy)

def ranks(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0]*len(v); i = 0
    while i < len(o):
        j = i
        while j+1 < len(o) and v[o[j+1]] == v[o[i]]: j += 1
        a = (i+j)/2.0+1.0
        for k in range(i, j+1): r[o[k]] = a
        i = j+1
    return r

def spearman(xs, ys):
    return None if len(xs) < 3 else pearson(ranks(xs), ranks(ys))

assets, categories = {}, {}
with gzip.open(OUT/'series.csv.gz', 'rt', encoding='utf-8') as fh:
    for rec in csv.DictReader(fh):
        a = rec['asset']
        if a not in assets:
            assets[a] = [None]*WINDOWS; categories[a] = rec['category']
        assets[a][int(rec['w'])] = (float(rec['min_price']), float(rec['median_price']),
                                    int(rec['quantity']), int(rec['sales_24h_volume']), rec['history_state'])
MIN, MED, QTY, V24, HST = range(5)
ASSETS = sorted(assets)

# ---- (A) five-minute step microstructure: what accompanies a minimum-price move?
step = collections.Counter()
qdelta_when_price_up = collections.Counter()
qdelta_when_price_down = collections.Counter()
both_moved = 0
for a in ASSETS:
    arr = assets[a]
    for t in range(1, WINDOWS):
        p, c = arr[t-1], arr[t]
        if p is None or c is None: continue
        dp = c[MIN]-p[MIN]; dq = c[QTY]-p[QTY]
        step['steps'] += 1
        if dp > 0: step['price_up'] += 1
        elif dp < 0: step['price_down'] += 1
        else: step['price_flat'] += 1
        if dq != 0: step['qty_moved'] += 1
        if dp != 0 and dq != 0:
            both_moved += 1
            step['opposite' if dp*dq < 0 else 'same'] += 1
        if dp > 0: qdelta_when_price_up[max(-3, min(3, dq))] += 1
        if dp < 0: qdelta_when_price_down[max(-3, min(3, dq))] += 1
step['both_moved'] = both_moved

# ---- (B) same-horizon correlation using MIN vs MEDIAN price
def corr_table(price_idx, exclude_unit_moves=False):
    out = {}
    for label, h in (('1h', H1), ('6h', H6), ('24h', H24)):
        px, py, per = [], [], []
        for a in ASSETS:
            arr = assets[a]; xs, ys = [], []
            for t in range(h, WINDOWS):
                p, c = arr[t-h], arr[t]
                if p is None or c is None or p[QTY] == 0 or p[price_idx] <= 0: continue
                dq = c[QTY]-p[QTY]
                if exclude_unit_moves and abs(dq) <= 1: continue
                xs.append(dq/p[QTY]); ys.append(c[price_idx]/p[price_idx]-1.0)
            if len(xs) > 2:
                px.extend(xs); py.extend(ys)
                r = pearson(xs, ys)
                if r is not None: per.append(r)
        out[label] = {'n': len(px), 'pearson': pearson(px, py), 'spearman': spearman(px, py),
                      'assets_with_r': len(per), 'assets_negative': sum(1 for r in per if r < 0),
                      'per_asset_median_r': percentile(per, .5)}
    return out

confounders = {
    'five_minute_steps': dict(step),
    'quantity_delta_when_min_price_rose': {str(k): v for k, v in sorted(qdelta_when_price_up.items())},
    'quantity_delta_when_min_price_fell': {str(k): v for k, v in sorted(qdelta_when_price_down.items())},
    'min_price_vs_listing_change': corr_table(MIN),
    'median_price_vs_listing_change': corr_table(MED),
    'min_price_vs_listing_change_excluding_moves_of_1_or_less': corr_table(MIN, True),
    'median_price_vs_listing_change_excluding_moves_of_1_or_less': corr_table(MED, True),
}

# ---- (C) forward-return asymmetry check: is state-conditional forward return a
# reversal of the same minimum-price move (mechanical) rather than new information?
rev = {}
for label, h in (('1h', H1), ('6h', H6), ('24h', H24)):
    buckets = collections.defaultdict(list)
    for a in ASSETS:
        arr = assets[a]
        for t in range(h, WINDOWS-h):
            p0, p1, p2 = arr[t-h], arr[t], arr[t+h]
            if p0 is None or p1 is None or p2 is None or p0[MIN] <= 0 or p1[MIN] <= 0: continue
            r_past = p1[MIN]/p0[MIN]-1.0
            r_fwd = p2[MIN]/p1[MIN]-1.0
            if r_past > 0: buckets['price_up'].append((r_past, r_fwd))
            elif r_past < 0: buckets['price_down'].append((r_past, r_fwd))
            else: buckets['price_flat'].append((r_past, r_fwd))
    entry = {}
    for k, v in buckets.items():
        f = [y for _, y in v]
        entry[k] = {'n': len(v), 'forward_mean_pct': 100*statistics.fmean(f),
                    'forward_median_pct': 100*percentile(f, .5),
                    'past_vs_forward_pearson': pearson([x for x, _ in v], f)}
    rev[label] = entry
confounders['price_move_reversal_ignoring_listings'] = rev

# ---- (D) published rolling 24h sales: independence check
sales = {'assets_any_change': 0, 'total_transitions': 0, 'distinct_values': [],
         'median_seconds_between_changes': None, 'change_gaps_minutes': []}
gaps = []
for a in ASSETS:
    arr = assets[a]; pres = [(w, r) for w, r in enumerate(arr) if r is not None]
    vals = [r[V24] for _, r in pres]
    sales['distinct_values'].append(len(set(vals)))
    last_change = None; tr = 0
    for i in range(1, len(pres)):
        if pres[i][0]-pres[i-1][0] != 1: continue
        if pres[i][1][V24] != pres[i-1][1][V24]:
            tr += 1
            if last_change is not None: gaps.append((pres[i][0]-last_change)*5)
            last_change = pres[i][0]
    sales['total_transitions'] += tr
    if tr > 0: sales['assets_any_change'] += 1
sales['change_gaps_minutes'] = {'n': len(gaps), 'median': percentile(gaps, .5),
                                'p05': percentile(gaps, .05), 'p95': percentile(gaps, .95),
                                'min': min(gaps) if gaps else None, 'max': max(gaps) if gaps else None}
sales['distinct_values'] = {'median': percentile(sales['distinct_values'], .5),
                            'min': min(sales['distinct_values']), 'max': max(sales['distinct_values'])}
confounders['published_24h_sales_cadence'] = sales

# history-state change cadence
hgaps = []
for a in ASSETS:
    arr = assets[a]; pres = [(w, r) for w, r in enumerate(arr) if r is not None]
    last = None
    for i in range(1, len(pres)):
        if pres[i][0]-pres[i-1][0] != 1: continue
        if pres[i][1][HST] != pres[i-1][1][HST]:
            if last is not None: hgaps.append((pres[i][0]-last)*5)
            last = pres[i][0]
confounders['history_state_change_gaps_minutes'] = {
    'n': len(hgaps), 'median': percentile(hgaps, .5), 'p05': percentile(hgaps, .05),
    'p95': percentile(hgaps, .95), 'min': min(hgaps) if hgaps else None, 'max': max(hgaps) if hgaps else None}

(OUT/'confounders.json').write_text(json.dumps(confounders, indent=1, default=str)+'\n')
print(json.dumps(confounders, indent=1, default=str))
