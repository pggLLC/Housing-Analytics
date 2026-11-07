#!/usr/bin/env python3
"""Build data/market/public-jobs.json: government jobs as a share of all jobs, for every Colorado county and town.

Why: County Business Patterns (data/market/cbp-workplace-size.json) counts private workplaces only, and the
largest-employer lists we can publish cover about a third of counties. In many rural counties the biggest
employers are public: the school district, the county, a hospital district, a state prison. LEHD counts those
jobs by where people work, down to the block, so every county and town gets one dated line.

Source: U.S. Census Bureau, LEHD Origin-Destination Employment Statistics (LODES 8), Workplace Area
Characteristics (WAC) files for Colorado, public domain, no key:
  https://lehd.ces.census.gov/data/
  co_wac_S000_JT00_<year>.csv.gz  all jobs
  co_wac_S000_JT02_<year>.csv.gz  all private jobs
  co_wac_S000_JT04_<year>.csv.gz  all federal jobs
  co_xwalk.csv.gz                 block -> county and place
Government = all jobs less private jobs. State and local = government less federal.
"Large private employers" = private jobs at firms with 500 or more employees NATIONWIDE (column CFS05): a chain
store counts, so this is a firm-size measure, not a local-employer one.

Limits, stated in meta: LODES adds noise to small-area counts, so a town's figure is a rounded estimate; state
employees can be reported at an administrative address rather than where they work, so a capital city or a
county with a large state office may look high and its neighbours low; LODES leaves out the self-employed,
uniformed military and some federal security agencies. Areas with fewer than MIN_JOBS jobs get null with a
reason, because a share of a tiny base is not meaningful.

Usage: python3 scripts/market/build_public_jobs.py [--year 2023] [--cache DIR]
"""
import argparse
import csv
import gzip
import json
import os
import sys
import urllib.request
from collections import defaultdict
from datetime import date

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'data', 'market', 'public-jobs.json')
RANKING = os.path.join(ROOT, 'data', 'hna', 'ranking-index.json')
PAGE = 'https://lehd.ces.census.gov/data/'
LODES = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/'
MIN_JOBS = 200
NO_PLACE = ('', '9999999', '0899999')


def fetch(cache, rel):
    path = os.path.join(cache, os.path.basename(rel))
    if not os.path.exists(path):
        tmp = path + '.part'
        req = urllib.request.Request(LODES + rel, headers={'User-Agent': 'coho-analytics-data-build'})
        with urllib.request.urlopen(req, timeout=300) as r, open(tmp, 'wb') as f:
            f.write(r.read())
        os.replace(tmp, path)
    return path


def read_wac(path, cols):
    out = {}
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            out[r['w_geocode']] = tuple(int(r[c]) for c in cols)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=2023)
    ap.add_argument('--cache', default=os.path.join(ROOT, '.cache', 'lodes'))
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    y = a.year
    files = {k: f'wac/co_wac_S000_{k}_{y}.csv.gz' for k in ('JT00', 'JT02', 'JT04')}
    files['xwalk'] = 'co_xwalk.csv.gz'
    paths = {k: fetch(a.cache, rel) for k, rel in files.items()}

    all_jobs = read_wac(paths['JT00'], ['C000'])
    private = read_wac(paths['JT02'], ['C000', 'CFS05'])
    federal = read_wac(paths['JT04'], ['C000'])

    blk = {}
    names = {}
    with gzip.open(paths['xwalk'], 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            p = r['stplc'].strip()
            p = None if p in NO_PLACE or p.endswith('99999') else p
            cty = '08' + r['cty'][-3:]
            blk[r['tabblk2020']] = (cty, p)
            if p:
                names[p] = r['stplcname'].replace(', CO', '')

    tot = defaultdict(lambda: [0, 0, 0, 0])  # all, private, federal, private at 500+ firms
    for b, (n,) in all_jobs.items():
        if b not in blk:
            continue
        cty, p = blk[b]
        pv, big = private.get(b, (0, 0))
        fd = federal.get(b, (0,))[0]
        for g in (cty, p):
            if g:
                t = tot[g]
                t[0] += n; t[1] += pv; t[2] += fd; t[3] += big

    with open(RANKING, encoding='utf-8') as fh:
        rank = json.load(fh)['rankings']
    geos = [(g['geoid'], g.get('name'), g.get('type')) for g in rank if g.get('type') in ('county', 'place')]
    assert sum(1 for _, _, t in geos if t == 'county') == 64, 'expected 64 counties in ranking-index'

    def row(geoid, name):
        if geoid not in tot:
            return None
        n, pv, fd, big = tot[geoid]
        gov = n - pv
        out = {'name': name or names.get(geoid), 'jobs': n, 'government': gov, 'federal': fd,
               'state_local': gov - fd, 'private_large_firms': big, 'government_share': None, 'shown': False, 'why_not': None}
        if n < MIN_JOBS:
            out['why_not'] = 'Fewer than %d jobs here, so a share would rest on too few to mean much.' % MIN_JOBS
            return out
        if gov < 0 or fd > gov:
            out['why_not'] = 'The LODES files disagree for this area (private or federal exceeds the total).'
            return out
        out['government_share'] = round(gov / n, 3)
        out['shown'] = True
        return out

    counties, places, missing = {}, {}, {}
    for geoid, name, t in geos:
        r = row(geoid, name)
        if r is None:
            missing[geoid] = 'No LEHD block in this area (not in the LODES crosswalk).'
            continue
        (counties if t == 'county' else places)[geoid] = r

    out = {
        'meta': {
            'title': 'Government jobs as a share of all jobs, by county and town',
            'year': y,
            'source': {'label': 'U.S. Census Bureau, LEHD Origin-Destination Employment Statistics (LODES 8), Workplace Area Characteristics, %d' % y,
                       'url': PAGE, 'files': [LODES + rel for rel in files.values()]},
            'what': 'Jobs counted where people work (all jobs, JT00). Government is all jobs less private jobs (JT02); '
                    'federal is JT04; state and local is the rest. Private jobs at large firms are those at employers '
                    'with 500 or more employees nationwide (CFS05), so a chain store counts.',
            'why': 'County Business Patterns leaves out government. This line names no employer but shows how much of '
                   'an area\'s work is public: school districts, counties, hospital districts, prisons, universities.',
            'limits': [
                'LODES adds noise to small-area counts to protect confidentiality, so a town figure is an estimate.',
                'Some state employees are reported at an administrative address, not where they work, so a county with a '
                'large state office can look high and its neighbours low.',
                'Leaves out the self-employed, uniformed military and some federal security agencies.',
                'Towns are the 2020 Census place boundaries in the LODES crosswalk; jobs outside any place count only to the county.',
            ],
            'min_jobs': MIN_JOBS,
            'shown': 'true where the share is published; otherwise why_not says why.',
            'missing': missing,
            'built': date.today().isoformat(),
            'script': 'scripts/market/build_public_jobs.py',
        },
        'counties': dict(sorted(counties.items())),
        'places': dict(sorted(places.items())),
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    shown = sum(1 for r in list(counties.values()) + list(places.values()) if r['shown'])
    print('public-jobs %d: %d counties, %d places, %d shown, %d missing' % (y, len(counties), len(places), shown, len(missing)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
