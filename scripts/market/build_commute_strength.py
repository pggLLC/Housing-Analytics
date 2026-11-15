#!/usr/bin/env python3
"""Build data/market/commute-strength.json for the public "Commuting and jobs" page.

For every Colorado town and Census community with 200 or more primary jobs, and
for every county, from the LEHD LODES 2024 origin-destination files (primary
jobs, JT01, so each worker counts once; home block to work block). Colorado's
"main" file holds jobs whose worker lives in Colorado; its "aux" file holds the
Colorado jobs whose worker lives in another state, and every other state's aux
file holds the jobs there whose worker lives in Colorado. All three are read,
so places on the state line (Durango and San Juan County, New Mexico; Fort
Collins and Cheyenne) are not cut off at the line:

- jobs: primary jobs located in the place, whoever holds them.
- in_commuters: those jobs held by people who live outside the place.
- in_other_state: the in-commuters who live in another state (included above).
- far / far_low: in-commuters living 20 to 60 straight-line miles away, and
  the ones among them earning $3,333 a month or less (LODES bands SE01 + SE02).
  This is the band a daily drive can plausibly cover.
- long: in-commuters recorded 60 or more miles away. Many of these are not
  daily trips (see below), so they are counted apart and never costed.
- median_far_miles: the median straight-line distance of the far in-commuters.
  Roads are longer, so any cost built on it is a floor.
- residents / out_commuters: working residents, and those whose primary job is
  in another place, in Colorado or another state.
- out_other_state: the out-commuters whose primary job is in another state.
- from / to: the five places sending the most in-commuters, and the five
  places employing the most out-commuters, with counts. Homes and jobs in
  another state are named by county, such as "San Juan County, NM".

Distances are block centroid to block centroid (LEHD crosswalk blklatdd /
blklondd). Homes in the seven neighbouring states use their own state's
crosswalk; homes farther away use the county's internal point from the Census
2024 county Gazetteer, and all of them are well past 60 miles. LODES places some workers at an employer's main office, so long
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
import io
import os
import sys
import urllib.error
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'market', 'commute-strength.json')
RANKING = os.path.join(ROOT, 'data', 'hna', 'ranking-index.json')

YEAR = 2024
FAR_MILES = 20.0
LONG_MILES = 60.0
MIN_JOBS = 200
LODES = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/'
LODES_ROOT = 'https://lehd.ces.census.gov/data/lodes/LODES8/'
FILES = {'od': f'od/co_od_main_JT01_{YEAR}.csv.gz', 'aux': f'od/co_od_aux_JT01_{YEAR}.csv.gz',
         'xwalk': 'co_xwalk.csv.gz'}
GAZETTEER = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip'
# States that touch Colorado: their homes can sit within a daily drive, so they get block coordinates.
NEIGHBORS = ['az', 'ks', 'ne', 'nm', 'ok', 'ut', 'wy']
# Every other state's aux file names its jobs held by Colorado residents.
STATES = ['ak', 'al', 'ar', 'az', 'ca', 'ct', 'dc', 'de', 'fl', 'ga', 'hi', 'ia', 'id', 'il', 'in', 'ks', 'ky', 'la', 'ma',
          'md', 'me', 'mi', 'mn', 'mo', 'ms', 'mt', 'nc', 'nd', 'ne', 'nh', 'nj', 'nm', 'nv', 'ny', 'oh', 'ok', 'or', 'pa',
          'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'va', 'vt', 'wa', 'wi', 'wv', 'wy']
NO_PLACE = ('', '9999999', '0899999')
CT_OLD_COUNTIES = {'09001': 'Fairfield County', '09003': 'Hartford County', '09005': 'Litchfield County',
                   '09007': 'Middlesex County', '09009': 'New Haven County', '09011': 'New London County',
                   '09013': 'Tolland County', '09015': 'Windham County'}


def download(url, path):
    """Fetch url into path through a temp name, so a cut-off transfer never looks cached."""
    if os.path.exists(path):
        return path
    tmp = path + '.part'
    with urllib.request.urlopen(url, timeout=300) as r, open(tmp, 'wb') as f:
        f.write(r.read())
    os.replace(tmp, path)
    return path


def fetch(cache):
    paths = {}
    for k, rel in FILES.items():
        paths[k] = download(LODES + rel, os.path.join(cache, os.path.basename(rel)))
    paths['gazetteer'] = download(GAZETTEER, os.path.join(cache, os.path.basename(GAZETTEER)))
    paths['xwalks'] = {st: download(f'{LODES_ROOT}{st}/{st}_xwalk.csv.gz', os.path.join(cache, f'{st}_xwalk.csv.gz'))
                       for st in NEIGHBORS}
    paths['work_aux'] = {}
    for st in STATES:
        url = f'{LODES_ROOT}{st}/od/{st}_od_aux_JT01_{YEAR}.csv.gz'
        try:
            paths['work_aux'][st] = download(url, os.path.join(cache, os.path.basename(url)))
        except urllib.error.HTTPError as e:
            # Only a file LEHD has not published (404) is skipped, and meta lists the states read.
            # Any other failure stops the build rather than publish counts with workers missing.
            if e.code != 404:
                sys.exit(f'{url}: HTTP {e.code}; rerun, the cache keeps what was downloaded')
            print('no aux file for', st, flush=True)
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

    # Counties in other states: name ("San Juan County, NM") and internal point.
    gaz = {}
    with zipfile.ZipFile(paths['gazetteer']) as z:
        name = [n for n in z.namelist() if n.endswith('.txt')][0]
        with z.open(name) as raw:
            for r in csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8'), delimiter='\t'):
                r = {k.strip(): v.strip() for k, v in r.items()}
                gaz[r['GEOID']] = (r['NAME'] + ', ' + r['USPS'], float(r['INTPTLAT']), float(r['INTPTLONG']))
    # LODES still uses Connecticut's eight old counties, which the 2024 Gazetteer
    # replaced with planning regions. They take a point in their own state (every
    # one is far past 60 miles) and their old names.
    by_state = {}
    for k, g in gaz.items():
        by_state.setdefault(k[:2], g)
    for k, n in CT_OLD_COUNTIES.items():
        if k not in gaz and '09' in by_state:
            gaz[k] = (n + ', CT',) + by_state['09'][1:]
    for k, (n, _, _) in gaz.items():
        if not k.startswith('08'):
            cnames[k] = n
    oos_blk = {}
    for path in paths['xwalks'].values():
        with gzip.open(path, 'rt', encoding='utf-8') as f:
            for r in csv.DictReader(f):
                oos_blk[r['tabblk2020']] = (float(r['blklatdd']), float(r['blklondd']))

    def other_state(geocode):
        """An out-of-state block as (county, county, lat, lon); the county stands in for the place."""
        cty = geocode[:5]
        ll = oos_blk.get(geocode)
        if ll is None:
            g = gaz.get(cty)
            if g is None:
                return None
            ll = g[1:]
        return (cty, cty, ll[0], ll[1])

    geo = collections.defaultdict(collections.Counter)
    far_d = collections.defaultdict(list)
    src = collections.defaultdict(collections.Counter)
    dst = collections.defaultdict(collections.Counter)
    cen = collections.defaultdict(lambda: [0.0, 0.0, 0])

    def add_job(w, h, n, low, home_out_of_state):
        """A Colorado job at block w held by a worker living at h."""
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
            if home_out_of_state:
                c['in_other_state'] += n
            if home_key:
                src[key][home_key] += n
            if d >= LONG_MILES:
                c['long'] += n
            elif d >= FAR_MILES:
                c['far'] += n
                c['far_low'] += low
                far_d[key].append((d, n))

    def add_resident(h, w, n, work_out_of_state):
        """A Colorado resident at block h whose primary job is at w."""
        for key, work_key in ((h[0], w[0]), (h[1], w[1])):
            if not key:
                continue
            geo[key]['residents'] += n
            if work_key != key:
                geo[key]['out_commuters'] += n
                if work_out_of_state:
                    geo[key]['out_other_state'] += n
                if work_key:
                    dst[key][work_key] += n

    with gzip.open(paths['od'], 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            w, h = blk.get(r['w_geocode']), blk.get(r['h_geocode'])
            if not w or not h:
                continue
            n = int(r['S000'])
            add_job(w, h, n, int(r['SE01']) + int(r['SE02']), False)
            add_resident(h, w, n, False)

    # Colorado jobs held by people who live in another state.
    oos_in = oos_missing = 0
    with gzip.open(paths['aux'], 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            w = blk.get(r['w_geocode'])
            h = other_state(r['h_geocode'])
            n = int(r['S000'])
            if not w or not h:
                oos_missing += n
                continue
            oos_in += n
            add_job(w, h, n, int(r['SE01']) + int(r['SE02']), True)

    # Jobs in other states held by people who live in Colorado.
    oos_out = 0
    for path in paths['work_aux'].values():
        with gzip.open(path, 'rt', encoding='utf-8') as f:
            for r in csv.DictReader(f):
                if not r['h_geocode'].startswith('08'):
                    continue
                h = blk.get(r['h_geocode'])
                w = other_state(r['w_geocode'])
                if not h or not w:
                    continue
                n = int(r['S000'])
                oos_out += n
                add_resident(h, w, n, True)

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
            'in_other_state': c['in_other_state'],
            'far': c['far'], 'far_low': c['far_low'], 'long': c['long'],
            'median_far_miles': None if not far_d[k] else round(median(far_d[k]), 1),
            'residents': c['residents'], 'out_commuters': c['out_commuters'],
            'out_other_state': c['out_other_state'],
            'from': [[label(g), n] for g, n in src[k].most_common(5)],
            'to': [[label(g), n] for g, n in dst[k].most_common(5)],
        }
        if len(k) == 7:
            places[k] = rec
        else:
            counties[k] = rec

    # A map point for each out-of-state county named in a "from" list, so the
    # page can draw its flow line (the county's Gazetteer internal point).
    named = {g for k in list(places) + list(counties) for g, _ in src[k].most_common(5) if not g.startswith('08')}
    points = {label(g): [round(gaz[g][1], 4), round(gaz[g][2], 4)] for g in sorted(named) if g in gaz}

    out = {
        'meta': {
            'generated': datetime.date.today().isoformat(),
            'generator': 'scripts/market/build_commute_strength.py',
            'lodes_year': YEAR,
            'source': LODES + FILES['od'],
            'source_out_of_state_homes': LODES + FILES['aux'],
            'source_out_of_state_jobs': f'{LODES_ROOT}<state>/od/<state>_od_aux_JT01_{YEAR}.csv.gz',
            'states_read': sorted(paths['work_aux']),
            'county_points': GAZETTEER,
            'out_of_state_totals': {'colorado_jobs_held_by_other_state_residents': oos_in,
                                    'colorado_residents_with_jobs_in_other_states': oos_out,
                                    'not_matched': oos_missing},
            'crosswalk': LODES + FILES['xwalk'],
            'far_miles': [FAR_MILES, LONG_MILES],
            'min_jobs': MIN_JOBS,
            'low_paid': 'LODES earnings bands SE01 + SE02: $3,333 a month or less',
            'note': 'Primary jobs (JT01), home block to work block, including Colorado jobs held by people who live in another state and Colorado residents whose job is in another state; those homes and jobs are named by county. Distances are straight-line; roads are longer. LODES assigns some workers to an employer main office, so long distances include some people who do not make that trip daily. Places with fewer than 200 primary jobs are left out.',
        },
        'places': dict(sorted(places.items())),
        'counties': dict(sorted(counties.items())),
        'other_state_points': points,
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
