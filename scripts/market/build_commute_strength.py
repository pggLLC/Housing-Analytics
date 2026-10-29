#!/usr/bin/env python3
"""Build data/market/commute-strength.json for the public "Commuting and jobs" page.

For every Colorado town and Census community with 200 or more primary jobs, and
for every county, from the LEHD LODES 2023 origin-destination file (primary
jobs, JT01, so each worker counts once; home block to work block):

- jobs: primary jobs located in the place.
- in_commuters: those jobs held by people who live outside the place.
- far / far_low: in-commuters living 20 to 60 straight-line miles away, and
  the ones among them earning $3,333 a month or less (LODES bands SE01 + SE02).
  This is the band a daily drive can plausibly cover.
- long: in-commuters recorded 60 or more miles away. Many of these are not
  daily trips (see below), so they are counted apart and never costed.
- median_far_miles: the median straight-line distance of the far in-commuters.
  Roads are longer, so any cost built on it is a floor.
- residents / out_commuters: working residents, and those whose primary job is
  in another Colorado place (jobs in other states are not in this file).
- from / to: the five places sending the most in-commuters, and the five
  places employing the most out-commuters, with counts.

Distances are block centroid to block centroid (LEHD crosswalk blklatdd /
blklondd). LODES places some workers at an employer's main office, so long
distances include some people who do not drive that far every day.

Usage:
  python3 scripts/market/build_commute_strength.py --cache /path/to/cache
"""
import argparse
import collections
import csv
import datetime
import gzip
import json
import math
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'market', 'commute-strength.json')
RANKING = os.path.join(ROOT, 'data', 'hna', 'ranking-index.json')

YEAR = 2023
FAR_MILES = 20.0
LONG_MILES = 60.0
MIN_JOBS = 200
LODES = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/'
FILES = {'od': f'od/co_od_main_JT01_{YEAR}.csv.gz', 'xwalk': 'co_xwalk.csv.gz'}
NO_PLACE = ('', '9999999', '0899999')


def fetch(cache):
    paths = {}
    for k, rel in FILES.items():
        path = os.path.join(cache, os.path.basename(rel))
        if not os.path.exists(path):
            tmp = path + '.part'
            with urllib.request.urlopen(LODES + rel, timeout=300) as r, open(tmp, 'wb') as f:
                f.write(r.read())
            os.replace(tmp, path)
        paths[k] = path
    return paths


def miles(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def median(pairs):
    """Weighted median of (value, weight) pairs."""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    if not total:
        return None
    run = 0
    for v, w in pairs:
        run += w
        if run * 2 >= total:
            return v
    return pairs[-1][0]


def build(cache):
    paths = fetch(cache)
    blk, names, cnames = {}, {}, {}
    with gzip.open(paths['xwalk'], 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            p = r['stplc'].strip()
            p = None if p in NO_PLACE or p.endswith('99999') else p
            if p:
                names[p] = r['stplcname'].replace(', CO', '')
            cnames['08' + r['cty'][-3:]] = r['ctyname'].replace(', CO', '')
            blk[r['tabblk2020']] = (p, '08' + r['cty'][-3:], float(r['blklatdd']), float(r['blklondd']))

    ranking_names = {}
    try:
        with open(RANKING, encoding='utf-8') as f:
            for row in json.load(f).get('rankings', []):
                ranking_names[str(row.get('geoid'))] = row.get('name')
    except FileNotFoundError:
        # Without the ranking index, places keep their LEHD crosswalk names.
        ranking_names = {}

    geo = collections.defaultdict(collections.Counter)
    far_d = collections.defaultdict(list)
    src = collections.defaultdict(collections.Counter)
    dst = collections.defaultdict(collections.Counter)
    cen = collections.defaultdict(lambda: [0.0, 0.0, 0])
    with gzip.open(paths['od'], 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            w, h = blk.get(r['w_geocode']), blk.get(r['h_geocode'])
            if not w or not h:
                continue
            n = int(r['S000'])
            low = int(r['SE01']) + int(r['SE02'])
            d = miles(w[2:], h[2:])
            for key, home_key in ((w[0], h[0]), (w[1], h[1])):
                if not key:
                    continue
                c = geo[key]
                c['jobs'] += n
                cc = cen[key]
                cc[0] += w[2] * n; cc[1] += w[3] * n; cc[2] += n
                if home_key == key:
                    continue
                c['in_commuters'] += n
                c['in_low'] += low
                if home_key:
                    src[key][home_key] += n
                if d >= LONG_MILES:
                    c['long'] += n
                elif d >= FAR_MILES:
                    c['far'] += n
                    c['far_low'] += low
                    far_d[key].append((d, n))
            for key, work_key in ((h[0], w[0]), (h[1], w[1])):
                if not key:
                    continue
                geo[key]['residents'] += n
                if work_key != key:
                    geo[key]['out_commuters'] += n
                    if work_key:
                        dst[key][work_key] += n

    def label(k):
        if len(k) == 5:
            return cnames.get(k, k)
        return ranking_names.get(k) or names.get(k, k)

    places, counties = {}, {}
    for k, c in geo.items():
        if c['jobs'] < MIN_JOBS:
            continue
        cc = cen[k]
        rec = {
            'name': label(k),
            'lat': round(cc[0] / cc[2], 4), 'lon': round(cc[1] / cc[2], 4),
            'jobs': c['jobs'], 'in_commuters': c['in_commuters'], 'in_low': c['in_low'],
            'far': c['far'], 'far_low': c['far_low'], 'long': c['long'],
            'median_far_miles': None if not far_d[k] else round(median(far_d[k]), 1),
            'residents': c['residents'], 'out_commuters': c['out_commuters'],
            'from': [[label(g), n] for g, n in src[k].most_common(5)],
            'to': [[label(g), n] for g, n in dst[k].most_common(5)],
        }
        if len(k) == 7:
            places[k] = rec
        else:
            counties[k] = rec

    out = {
        'meta': {
            'generated': datetime.date.today().isoformat(),
            'generator': 'scripts/market/build_commute_strength.py',
            'lodes_year': YEAR,
            'source': LODES + FILES['od'],
            'crosswalk': LODES + FILES['xwalk'],
            'far_miles': [FAR_MILES, LONG_MILES],
            'min_jobs': MIN_JOBS,
            'low_paid': 'LODES earnings bands SE01 + SE02: $3,333 a month or less',
            'note': 'Primary jobs (JT01), in Colorado only, home block to work block. Distances are straight-line; roads are longer. LODES assigns some workers to an employer main office, so long distances include some people who do not make that trip daily. Places with fewer than 200 primary jobs are left out.',
        },
        'places': dict(sorted(places.items())),
        'counties': dict(sorted(counties.items())),
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
        f.write('\n')
    print(f'{OUT}: {len(places)} places, {len(counties)} counties')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True, help='folder for the downloaded LODES files')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    build(args.cache)
