#!/usr/bin/env python3
"""Build data/policy/job-access.json for the gated "Where to build" page.

For every town and Census community in the HNA ranking:

1. Jobs within a 30-minute drive. LEHD LODES workplace counts (all jobs,
   JT00: a second job is a job a resident could take) are grouped by town, and jobs outside any town by census tract; each
   group sits at its job-weighted centre. A town's trip starts at the centre of
   its working residents (LODES residence file), not the geographic centre,
   which puts some mountain communities on ski-area roads. Drive times are
   OSRM free-flow times on OpenStreetMap roads, routed to every job group
   within ROUTE_MILES straight-line miles. A town's own jobs always count.
   Counties get the population-weighted average of their towns and communities.

2. Where working residents work (context, no points): the share of the town's
   working residents whose job is in the one other named town that employs the
   most of them. Primary jobs only (JT01), so each worker counts once. The
   denominator also counts residents whose primary job is in another state,
   read from every other state's LODES "aux" file.

Drive times are slow to fetch, so they are cached (--cache) and only missing
origins are routed. The LODES files are downloaded into the cache folder.

Usage:
  python3 scripts/policy/build_job_access.py --cache /path/to/cache
"""
import argparse
import collections
import csv
import datetime
import gzip
import json
import math
import os
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'policy', 'job-access.json')

YEAR = 2023
MINUTES = 30
ROUTE_MILES = 40.0
LODES = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/'
FILES = {
    'wac': f'wac/co_wac_S000_JT00_{YEAR}.csv.gz',
    'rac': f'rac/co_rac_S000_JT00_{YEAR}.csv.gz',
    'od': f'od/co_od_main_JT01_{YEAR}.csv.gz',
    'xwalk': 'co_xwalk.csv.gz',
}
# Every other state's residents-elsewhere file: Colorado residents whose primary job is there.
STATES = ['ak', 'al', 'ar', 'az', 'ca', 'ct', 'dc', 'de', 'fl', 'ga', 'hi', 'ia', 'id', 'il', 'in', 'ks', 'ky', 'la', 'ma',
          'md', 'me', 'mi', 'mn', 'mo', 'ms', 'mt', 'nc', 'nd', 'ne', 'nh', 'nj', 'nm', 'nv', 'ny', 'oh', 'ok', 'or', 'pa',
          'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'va', 'vt', 'wa', 'wi', 'wv', 'wy']
OSRM = 'https://router.project-osrm.org/table/v1/driving'
NO_PLACE = ('', '9999999', '99999')


def _load(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return json.load(f)


def miles(a, b):
    p = math.pi / 180
    x = (b[1] - a[1]) * p * math.cos((a[0] + b[0]) / 2 * p)
    y = (b[0] - a[0]) * p
    return 3958.8 * math.hypot(x, y)


def fetch_lodes(cache):
    paths = {}
    for k, rel in FILES.items():
        path = os.path.join(cache, os.path.basename(rel))
        if not os.path.exists(path):
            print('downloading', LODES + rel, flush=True)
            urllib.request.urlretrieve(LODES + rel, path)
        paths[k] = path
    paths['aux'] = {}
    for st in STATES:
        url = f'https://lehd.ces.census.gov/data/lodes/LODES8/{st}/od/{st}_od_aux_JT01_{YEAR}.csv.gz'
        path = os.path.join(cache, os.path.basename(url))
        if not os.path.exists(path):
            try:
                urllib.request.urlretrieve(url, path)
            except Exception as e:
                print('no aux file for', st, e, flush=True)
                continue
        paths['aux'][st] = path
    return paths


def rows(path):
    with gzip.open(path, 'rt', newline='') as f:
        yield from csv.DictReader(f)


def read_lodes(paths):
    blk, names = {}, {}
    for r in rows(paths['xwalk']):
        p = r['stplc'].strip()
        p = None if p in NO_PLACE else p
        blk[r['tabblk2020']] = (p, r['trct'], float(r['blklatdd']), float(r['blklondd']))
        if p:
            names[p] = r['stplcname'].replace(', CO', '')

    # Job groups: one per town, one per tract for jobs outside any town.
    acc = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for r in rows(paths['wac']):
        n = int(r['C000'])
        p, t, la, lo = blk[r['w_geocode']]
        a = acc['P' + p if p else 'T' + t]
        a[0] += n
        a[1] += la * n
        a[2] += lo * n
    groups = {k: (a[0], a[1] / a[0], a[2] / a[0]) for k, a in acc.items() if a[0] > 0}

    # Trip origins: the centre of each town's working residents.
    acc = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for r in rows(paths['rac']):
        n = int(r['C000'])
        p, _, la, lo = blk[r['h_geocode']]
        if p:
            a = acc[p]
            a[0] += n
            a[1] += la * n
            a[2] += lo * n
    homes = {p: (a[1] / a[0], a[2] / a[0]) for p, a in acc.items() if a[0] > 0}

    # Where each town's working residents work (primary jobs; '' = outside any town, '*' = another state).
    flows = collections.defaultdict(collections.Counter)
    for r in rows(paths['od']):
        h = blk[r['h_geocode']][0]
        if h:
            w = blk[r['w_geocode']][0]
            flows[h][w or ''] += int(r['S000'])
    for path in paths['aux'].values():
        for r in rows(path):
            if r['h_geocode'].startswith('08'):
                h = blk[r['h_geocode']][0]
                if h:
                    flows[h]['*'] += int(r['S000'])
    return groups, homes, flows, names, sorted(paths['aux'])


def route(origins, groups, cache_file):
    """Drive seconds from each origin to every job group within ROUTE_MILES, cached by origin."""
    done = {}
    if os.path.exists(cache_file):
        with open(cache_file, encoding='utf-8') as f:
            done = json.load(f)
    todo = [o for o in origins if o[0] not in done]
    cells = collections.defaultdict(list)
    for o in todo:
        cells[(round(o[1] / 0.25), round(o[2] / 0.25))].append(o)
    dest = [(k, g[1], g[2]) for k, g in groups.items()]
    for key in sorted(cells):
        cell = cells[key]
        for i in range(0, len(cell), 20):
            srcs = cell[i:i + 20]
            near = [d for d in dest if any(miles((s[1], s[2]), (d[1], d[2])) <= ROUTE_MILES for s in srcs)]
            got = {s[0]: {} for s in srcs}
            ok = True
            for j in range(0, len(near), 80):
                dd = near[j:j + 80]
                coords = '/' + ';'.join(f'{s[2]:.5f},{s[1]:.5f}' for s in srcs) + ';' + ';'.join(f'{d[2]:.5f},{d[1]:.5f}' for d in dd)
                url = (OSRM + coords + '?sources=' + ';'.join(str(n) for n in range(len(srcs))) +
                       '&destinations=' + ';'.join(str(n) for n in range(len(srcs), len(srcs) + len(dd))) +
                       '&annotations=duration')
                r = None
                for attempt in range(5):
                    try:
                        req = urllib.request.Request(url, headers={'User-Agent': 'coho-analytics-job-access'})
                        r = json.load(urllib.request.urlopen(req, timeout=60))
                        break
                    except Exception:
                        time.sleep(3 * (attempt + 1))
                time.sleep(1)
                if not r or r.get('code') != 'Ok':
                    ok = False
                    break
                for si, s in enumerate(srcs):
                    for di, d in enumerate(dd):
                        v = r['durations'][si][di]
                        if v is not None:
                            got[s[0]][d[0]] = v
            if not ok:
                sys.exit(f'OSRM failed near cell {key}; rerun to resume from the cache')
            done.update(got)
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(done, f)
            print(f'routed {len(done)} of {len(origins)} origins', flush=True)
    return done


def build(cache):
    os.makedirs(cache, exist_ok=True)
    groups, homes, flows, names, aux_states = read_lodes(fetch_lodes(cache))
    ranking = _load('data/hna/ranking-index.json')['rankings']
    cent = _load('data/co-place-centroids.json')['byGeoid']
    # Name workplaces as the rest of the site does ("Durango (city)"), falling back to the crosswalk's name.
    names.update({r['geoid']: r['name'] for r in ranking})

    origins = []
    for r in ranking:
        if r['type'] == 'county':
            continue
        g = r['geoid']
        pos = homes.get(g) or (cent[g]['lat'], cent[g]['lng'])
        origins.append((g, pos[0], pos[1]))
    secs = route(origins, groups, os.path.join(cache, f'durations-{YEAR}.json'))

    places = {}
    for r in ranking:
        if r['type'] == 'county':
            continue
        g = r['geoid']
        d = secs[g]
        jobs = sum(n for k, (n, _, _) in groups.items() if k == 'P' + g or (d.get(k) is not None and d[k] <= MINUTES * 60))
        row = {'jobs_30min': jobs}
        fl = flows.get(g)
        if fl:
            workers = sum(fl.values())
            top = [(w, n) for w, n in fl.most_common() if w and w not in (g, '*')][:1]
            row['workers'] = workers
            row['workers_other_states'] = fl.get('*', 0)
            if top:
                w, n = top[0]
                row['top_workplace'] = {'geoid': w, 'name': names.get(w, w), 'workers': n, 'share': round(n / workers, 3)}
        places[g] = row

    counties = {}
    acc = collections.defaultdict(lambda: [0.0, 0])
    for r in ranking:
        if r['type'] != 'county' and r['geoid'] in places:
            w = (r.get('metrics') or {}).get('population') or 0
            a = acc[r['containingCounty']]
            a[0] += places[r['geoid']]['jobs_30min'] * w
            a[1] += w
    for c, (s, w) in acc.items():
        if w > 0:
            counties[c] = {'jobs_30min': round(s / w)}

    return {
        'meta': {
            'title': 'Where to build: jobs within a 30-minute drive, and where working residents work',
            'generator': 'scripts/policy/build_job_access.py',
            'generated': datetime.date.today().isoformat(),
            'lodes_year': YEAR,
            'minutes': MINUTES,
            'sources': {
                'jobs': LODES + FILES['wac'],
                'residents': LODES + FILES['rac'],
                'flows': LODES + FILES['od'],
                'flows_other_states': f'LODES8 <state>/od/<state>_od_aux_JT01_{YEAR}.csv.gz for: ' + ', '.join(aux_states),
                'crosswalk': LODES + FILES['xwalk'],
                'routing': 'OSRM on OpenStreetMap roads (router.project-osrm.org), free-flow drive times',
            },
            'note': ('Jobs within reach: all jobs in Colorado (LEHD LODES JT00, primary and secondary). Jobs across the '
                     'state line are not counted. Where residents work: primary jobs only (JT01, one per worker), '
                     'with residents who work in another state in the total. Drive times assume no traffic. A town\'s own jobs always count. Counties: population-weighted '
                     'average of their towns and Census communities.'),
        },
        'places': places,
        'counties': counties,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'coho-job-access'))
    a = ap.parse_args()
    out = build(a.cache)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(json.dumps(out, indent=1, ensure_ascii=False, sort_keys=True) + '\n')
    print(f'wrote {os.path.relpath(OUT, ROOT)}: {len(out["places"])} places, {len(out["counties"])} counties')


if __name__ == '__main__':
    main()
