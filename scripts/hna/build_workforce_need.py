#!/usr/bin/env python3
"""Build data/hna/workforce-need.json: homes for the people who work here.

Replaces nothing yet. It sits beside the workforce reading the ranking index
publishes (low-wage jobs located here less rental homes affordable at <=60% AMI,
one job to one home), which methods.html §09 describes. That reading counts
jobs, not households, counts jobs already held by housed residents, and puts a
present shortfall in the 20-year slot. This file builds the two quantities a
practitioner HNA uses instead, from public data, and keeps them separate:

1. Present in-commuter need, a deficit today:
       in-commuters x low/middle-wage share / workers per working household
       x share who would move closer
   The last factor has no statewide public source (local employer surveys
   measure it), so it is published as two stated scenarios, 25% and 50%,
   never as a hidden constant.

2. County job growth, for context only. The State Demography Office sets
   migration in its county population forecast from its own jobs forecast,
   so the resident-growth reading already houses forecast job growth at
   county level. Adding job growth on top would count the same workers twice;
   this file records it and adds it to nothing.

For places it also gives the place's share of county jobs (LODES block-level
OD) beside its share of county households, so a reader can see where growth
allocated by households and permits understates a job centre.

Inputs (cached under data/hna/source/, refreshed with --fetch):
  dola_jobs_county.csv  DOLA SDO total jobs by county, estimates and forecast
  acs_b08202.json       ACS 5-year B08202 (household size by number of workers)
                        with margins of error, via the Census Reporter API
Already in the repo: data/hna/lehd/<county>.json (LODES OD inflow, WAC wage
bands), data/hna/place-od-flows.json (block-level place OD),
data/hna/summary/<geoid>.json (households, DP02_0001E).

An unmeasurable quantity is null with a reason, never 0 (AGENTS.md).
"""
import argparse
import csv
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'data', 'hna', 'source')
OUT = os.path.join(ROOT, 'data', 'hna', 'workforce-need.json')

JOBS_URL = 'https://storage.googleapis.com/co-publicdata/jobs-county.csv'
B08202_URL = 'https://api.censusreporter.org/1.0/data/show/latest?table_ids=B08202&geo_ids={sumlevel}|04000US08'
MOVE_CLOSER_SCENARIOS = (0.25, 0.50)
BASE_YEAR = 2024
HORIZON = 20

# B08202 cells that count working households by number of workers. "3 or more"
# is counted as 3, which understates workers per household slightly and so
# leans the need figure up; methods.html §09 says so.
WORKER_CELLS = {
    'B08202003': 1,  # 1 worker
    'B08202004': 2,  # 2 workers
    'B08202005': 3,  # 3 or more workers
}


def fetch():
    os.makedirs(SRC, exist_ok=True)
    with urllib.request.urlopen(JOBS_URL, timeout=120) as r:
        open(os.path.join(SRC, 'dola_jobs_county.csv'), 'wb').write(r.read())
    out = {'source': B08202_URL.format(sumlevel='<sumlevel>'), 'table': 'B08202', 'geos': {}}
    for sumlevel in ('050', '160'):
        with urllib.request.urlopen(B08202_URL.format(sumlevel=sumlevel), timeout=120) as r:
            d = json.load(r)
        out['release'] = d.get('release')
        for k, v in d['data'].items():
            t = v['B08202']
            out['geos'][k.split('US')[1]] = {'estimate': t['estimate'], 'moe': t['error']}
    with open(os.path.join(SRC, 'acs_b08202.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'), sort_keys=True)


def read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def load_jobs():
    path = os.path.join(SRC, 'dola_jobs_county.csv')
    rows = list(csv.reader(open(path, encoding='utf-8')))
    vintage = rows[0][0]
    by = {}
    for r in rows[2:]:
        try:
            fips, year, jobs = int(r[1]), int(r[2]), float(r[3])
        except (ValueError, IndexError):
            continue
        if 1 <= fips <= 125:
            by.setdefault('08%03d' % fips, {})[year] = jobs
    return vintage, by


def workers_per_household(cell):
    """Workers per working household from B08202, with the CV of its parts.

    Returns (value, working_households, working_households_cv) or
    (None, None, None) when there is no working household to divide by.
    """
    if not cell:
        return None, None, None
    est, moe = cell.get('estimate') or {}, cell.get('moe') or {}
    hh = 0.0
    workers = 0.0
    moe_sq = 0.0
    for k, w in WORKER_CELLS.items():
        e = num(est.get(k))
        if e is None:
            return None, None, None
        hh += e
        workers += e * w
        m = num(moe.get(k))
        moe_sq += (m or 0.0) ** 2
    if hh <= 0:
        return None, None, None
    cv = (moe_sq ** 0.5 / 1.645) / hh
    return workers / hh, hh, round(cv, 3)


def need_block(incommuters, wage_share, wph):
    if incommuters is None or wage_share is None or wph is None or wph <= 0:
        return None
    base = incommuters * wage_share / wph
    return {('move_closer_%d' % round(s * 100)): int(round(base * s)) for s in MOVE_CLOSER_SCENARIOS}


def build():
    vintage, jobs = load_jobs()
    b08202 = read_json(os.path.join(SRC, 'acs_b08202.json')) or {}
    acs = b08202.get('geos') or {}
    od = (read_json(os.path.join(ROOT, 'data', 'hna', 'place-od-flows.json')) or {}).get('places') or {}
    geo = read_json(os.path.join(ROOT, 'data', 'hna', 'geo-config.json')) or {}

    county_lehd = {}
    out_counties = {}
    for c in geo.get('counties') or []:
        fips = c.get('geoid')
        lehd = read_json(os.path.join(ROOT, 'data', 'hna', 'lehd', '%s.json' % fips)) or {}
        county_lehd[fips] = lehd
        c000, ce01, ce02 = num(lehd.get('C000')), num(lehd.get('CE01')), num(lehd.get('CE02'))
        wage_share = (ce01 + ce02) / c000 if (c000 and ce01 is not None and ce02 is not None) else None
        inflow = num(lehd.get('inflow'))
        wph, whh, whh_cv = workers_per_household(acs.get(fips))
        j = jobs.get(fips) or {}
        j0, j1 = j.get(BASE_YEAR), j.get(BASE_YEAR + HORIZON)
        rec = {
            'name': c.get('label') or c.get('name'),
            'incommuters': inflow,
            'low_middle_wage_share': round(wage_share, 4) if wage_share is not None else None,
            'workers_per_working_household': round(wph, 3) if wph is not None else None,
            'working_households_cv': whh_cv,
            'present_incommuter_need': need_block(inflow, wage_share, wph),
            'jobs_base': int(j0) if j0 is not None else None,
            'jobs_horizon': int(j1) if j1 is not None else None,
            'job_growth_note': 'Context only: SDO sets county migration from this jobs forecast, so resident growth already houses it.',
        }
        if rec['present_incommuter_need'] is None:
            rec['unavailableReason'] = 'Missing LODES inflow, wage bands or ACS workers per household for this county.'
        out_counties[fips] = rec

    out_places = {}
    for key in ('places', 'cdps'):
        for p in geo.get(key) or []:
            gid = p.get('geoid')
            county = p.get('containingCounty') or p.get('county')
            flows = od.get(gid) or {}
            inflow = num(flows.get('inflow'))
            place_jobs = num(flows.get('jobs'))
            lehd = county_lehd.get(county) or {}
            c000, ce01, ce02 = num(lehd.get('C000')), num(lehd.get('CE01')), num(lehd.get('CE02'))
            wage_share = (ce01 + ce02) / c000 if (c000 and ce01 is not None and ce02 is not None) else None
            wph, whh, whh_cv = workers_per_household(acs.get(gid))
            summ = (read_json(os.path.join(ROOT, 'data', 'hna', 'summary', '%s.json' % gid)) or {}).get('acsProfile') or {}
            csum = (read_json(os.path.join(ROOT, 'data', 'hna', 'summary', '%s.json' % county)) or {}).get('acsProfile') or {}
            hh, chh = num(summ.get('DP02_0001E')), num(csum.get('DP02_0001E'))
            rec = {
                'name': p.get('label') or p.get('name'),
                'containingCounty': county,
                'incommuters': inflow,
                'low_middle_wage_share': round(wage_share, 4) if wage_share is not None else None,
                'wage_share_basis': 'county',
                'workers_per_working_household': round(wph, 3) if wph is not None else None,
                'working_households_cv': whh_cv,
                'present_incommuter_need': need_block(inflow, wage_share, wph),
                'share_of_county_jobs': round(place_jobs / c000, 4) if (place_jobs is not None and c000) else None,
                'share_of_county_households': round(hh / chh, 4) if (hh is not None and chh) else None,
            }
            if rec['present_incommuter_need'] is None:
                rec['unavailableReason'] = ('No block-level LODES record for this place.' if not flows
                                            else 'Missing wage bands or ACS workers per household for this place.')
            out_places[gid] = rec

    payload = {
        'meta': {
            'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'generated_by': 'scripts/hna/build_workforce_need.py',
            'baseYear': BASE_YEAR,
            'horizonYear': BASE_YEAR + HORIZON,
            'move_closer_scenarios': list(MOVE_CLOSER_SCENARIOS),
            'method': ('present_incommuter_need = LODES in-commuters x county CE01+CE02 share of jobs located there '
                       '/ ACS B08202 workers per working household (3 or more counted as 3) x share who would move closer '
                       '(scenarios; no statewide source). A deficit today, not a 20-year projection.'),
            'sources': {
                'lodes_od': 'https://lehd.ces.census.gov/data/lodes/LODES8/co/od/co_od_main_JT00_2023.csv.gz',
                'acs_b08202': b08202.get('source'),
                'acs_release': b08202.get('release'),
                'dola_jobs': JOBS_URL,
                'dola_jobs_vintage': vintage,
            },
        },
        'counties': out_counties,
        'places': out_places,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=1, sort_keys=True)
        f.write('\n')
    print('wrote %s: %d counties, %d places' % (os.path.relpath(OUT, ROOT), len(out_counties), len(out_places)), file=sys.stderr)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--fetch', action='store_true', help='refresh the cached DOLA and ACS inputs first')
    a = ap.parse_args()
    if a.fetch:
        fetch()
    build()
