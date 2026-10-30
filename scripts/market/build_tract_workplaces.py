#!/usr/bin/env python3
"""Build data/market/tract-workplaces.json: where each census tract's working residents work.

For the Market Analysis report's "Where residents work" line. For every Colorado
census tract, from the LEHD LODES origin-destination files (primary jobs, JT01,
so each worker counts once; home block to work block):

- workers: working residents of the tract, including those whose primary job is
  in another state (read from every other state's "aux" file).
- other_states: those whose primary job is in another state.
- no_town: those whose job is in Colorado but outside any town or Census community.
- to: the named Colorado places employing the most of them, with counts.

The page adds tracts up, weighted by the share of each tract inside the market
area, so the line describes the market area's residents, not one town's.

Usage:
  python3 scripts/market/build_tract_workplaces.py --cache /path/to/cache
"""
import argparse
import collections
import csv
import datetime
import gzip
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'market', 'tract-workplaces.json')

YEAR = 2023
TOP = 6
LODES = 'https://lehd.ces.census.gov/data/lodes/LODES8/'
OD = f'co/od/co_od_main_JT01_{YEAR}.csv.gz'
XWALK = 'co/co_xwalk.csv.gz'
# Every other state's residents-elsewhere file: Colorado residents whose primary job is there.
STATES = ['ak', 'al', 'ar', 'az', 'ca', 'ct', 'dc', 'de', 'fl', 'ga', 'hi', 'ia', 'id', 'il', 'in', 'ks', 'ky', 'la', 'ma',
          'md', 'me', 'mi', 'mn', 'mo', 'ms', 'mt', 'nc', 'nd', 'ne', 'nh', 'nj', 'nm', 'nv', 'ny', 'oh', 'ok', 'or', 'pa',
          'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'va', 'vt', 'wa', 'wi', 'wv', 'wy']
NO_PLACE = ('', '9999999', '99999')


def fetch(cache, rel, missing_ok=False):
    """Download one LODES file into the cache. Only a 404 may be skipped (missing_ok)."""
    path = os.path.join(cache, os.path.basename(rel))
    if os.path.exists(path):
        return path
    try:
        urllib.request.urlretrieve(LODES + rel, path + '.part')
        os.replace(path + '.part', path)
    except urllib.error.HTTPError as e:
        if missing_ok and e.code == 404:
            return None
        sys.exit(f'{LODES + rel}: HTTP {e.code}; rerun, the cache keeps what was downloaded')
    except OSError as e:
        sys.exit(f'{LODES + rel}: {e}; rerun, the cache keeps what was downloaded')
    return path


def rows(path):
    with gzip.open(path, 'rt', newline='') as f:
        yield from csv.DictReader(f)


def build(cache):
    os.makedirs(cache, exist_ok=True)
    place, names = {}, {}
    for r in rows(fetch(cache, XWALK)):
        p = r['stplc'].strip()
        if p not in NO_PLACE:
            place[r['tabblk2020']] = p
            names[p] = r['stplcname'].replace(', CO', '')
    with open(os.path.join(ROOT, 'data', 'hna', 'ranking-index.json'), encoding='utf-8') as f:
        names.update({r['geoid']: r['name'] for r in json.load(f)['rankings']})

    to = collections.defaultdict(collections.Counter)
    no_town = collections.Counter()
    other = collections.Counter()
    for r in rows(fetch(cache, OD)):
        t, n = r['h_geocode'][:11], int(r['S000'])
        w = place.get(r['w_geocode'])
        if w:
            to[t][w] += n
        else:
            no_town[t] += n
    read = []
    for st in STATES:
        path = fetch(cache, f'{st}/od/{st}_od_aux_JT01_{YEAR}.csv.gz', missing_ok=True)
        if not path:
            print('no aux file for', st, flush=True)
            continue
        read.append(st)
        for r in rows(path):
            if r['h_geocode'].startswith('08'):
                other[r['h_geocode'][:11]] += int(r['S000'])

    tracts, used = {}, set()
    for t in sorted(set(to) | set(no_town) | set(other)):
        top = to[t].most_common(TOP)
        used.update(g for g, _ in top)
        tracts[t] = {
            'workers': sum(to[t].values()) + no_town[t] + other[t],
            'other_states': other[t],
            'no_town': no_town[t],
            'to': [[g, n] for g, n in top],
        }
    return {
        'meta': {
            'title': 'Where each census tract\'s working residents work',
            'generator': 'scripts/market/build_tract_workplaces.py',
            'generated': datetime.date.today().isoformat(),
            'lodes_year': YEAR,
            'top': TOP,
            'sources': {
                'flows': LODES + OD,
                'crosswalk': LODES + XWALK,
                'flows_other_states': f'LODES8 <state>/od/<state>_od_aux_JT01_{YEAR}.csv.gz for: ' + ', '.join(read),
            },
            'note': ('Primary jobs only (JT01), so each worker counts once. Workers include residents whose primary job '
                     'is in another state. "to" lists the Colorado towns and Census communities employing the most of a '
                     'tract\'s residents; the rest work elsewhere in Colorado, outside any town, or in another state.'),
        },
        'names': {g: names.get(g, g) for g in sorted(used)},
        'tracts': tracts,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'coho-job-access'))
    a = ap.parse_args()
    out = build(a.cache)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(json.dumps(out, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n')
    print(f'wrote {os.path.relpath(OUT, ROOT)}: {len(out["tracts"])} tracts, {len(out["names"])} places')


if __name__ == '__main__':
    main()
