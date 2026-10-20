#!/usr/bin/env python3
"""Build data/hna/workforce-need.json: homes for the people who work here.

Its 25% scenario is the second part of the 20-year figure since 2026-10-20
(build_ranking_index.py incommuter_need, and the HNA page): resident growth
plus these homes. It replaced, in that figure, the workforce reading the
ranking index still publishes for its gap score (low-wage jobs located here
less rental homes affordable at <=60% AMI, one job to one home), which
methods.html §09 describes. That reading counts
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
  lodes_primary_jobs.json  LODES primary jobs (JT01): the aux OD file (Colorado
                        job, home out of state) summed by workplace county and
                        place (LEHD crosswalk), and WAC primary low/middle-wage
                        jobs by county
Already in the repo: data/hna/lehd/<county>.json (LODES OD inflow, WAC wage
bands), data/hna/place-od-flows.json (block-level place OD),
data/hna/summary/<geoid>.json (households, DP02_0001E).

An unmeasurable quantity is null with a reason, never 0 (AGENTS.md).
"""
import argparse
import csv
import gzip
import io
import json
import os
import math
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'data', 'hna', 'source')
OUT = os.path.join(ROOT, 'data', 'hna', 'workforce-need.json')

JOBS_URL = 'https://storage.googleapis.com/co-publicdata/jobs-county.csv'
# Full URLs, not templates: the source-URL sweep fetches every URL it finds.
B08202_URLS = {
    '050': 'https://api.censusreporter.org/1.0/data/show/latest?table_ids=B08202&geo_ids=050|04000US08',
    '160': 'https://api.censusreporter.org/1.0/data/show/latest?table_ids=B08202&geo_ids=160|04000US08',
}
# LODES "main" holds jobs whose worker also lives in Colorado; workers who
# live out of state are only in "aux". County inflow and place-od-flows.json
# both come from main, so aux is added here, by workplace, or border counties
# (La Plata, Archuleta, Montezuma, Larimer, Weld, Mesa) read low.
LODES_YEAR = 2023
AUX_URL = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/od/co_od_aux_JT01_2023.csv.gz'
WAC_PRIMARY_URL = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/wac/co_wac_S000_JT01_2023.csv.gz'
WAC_ALL_URL = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/wac/co_wac_S000_JT00_2023.csv.gz'
XWALK_URL = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/co_xwalk.csv.gz'
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


def _write_atomic(name, data):
    path = os.path.join(SRC, name)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


def fetch():
    """Download every input into memory, check each one, and only then
    replace the cached copies, all three together. A failed or partial
    download leaves the cache exactly as it was."""
    os.makedirs(SRC, exist_ok=True)
    with urllib.request.urlopen(JOBS_URL, timeout=120) as r:
        jobs_csv = r.read()
    _vintage, jobs = parse_jobs(jobs_csv.decode('utf-8'))
    if len(jobs) != 64:
        raise ValueError('DOLA jobs file has %d counties, not 64' % len(jobs))
    out = {'sources': list(B08202_URLS.values()), 'table': 'B08202', 'geos': {}}
    for sumlevel in ('050', '160'):
        with urllib.request.urlopen(B08202_URLS[sumlevel], timeout=120) as r:
            d = json.load(r)
        out['release'] = d.get('release')
        for k, v in d['data'].items():
            t = v['B08202']
            out['geos'][k.split('US')[1]] = {'estimate': t['estimate'], 'moe': t['error']}
    n_cty = sum(1 for k in out['geos'] if len(k) == 5)
    if n_cty != 64:
        raise ValueError('ACS B08202 has %d counties, not 64' % n_cty)
    # A partial place response must not replace a fuller cached one.
    cached = (read_json(os.path.join(SRC, 'acs_b08202.json')) or {}).get('geos') or {}
    n_plc = sum(1 for k in out['geos'] if len(k) == 7)
    n_plc_cached = sum(1 for k in cached if len(k) == 7)
    if n_plc < n_plc_cached:
        raise ValueError('ACS B08202 has %d places, fewer than the %d cached' % (n_plc, n_plc_cached))
    aux = fetch_aux()
    if len(aux['counties']) != 64 or len(aux['wac_primary_counties']) != 64:
        raise ValueError('LODES primary-job summary does not cover all 64 counties')
    # The county maps come straight from workplace FIPS, so a partial
    # crosswalk or WAC file still covers 64 counties; check the places too.
    cached_aux = read_json(os.path.join(SRC, 'lodes_primary_jobs.json')) or {}
    for key in ('places', 'wac_primary_places'):
        if len(aux.get(key) or {}) < len(cached_aux.get(key) or {}):
            raise ValueError('LODES %s has %d places, fewer than the %d cached'
                             % (key, len(aux.get(key) or {}), len(cached_aux.get(key) or {})))
    _write_atomic('dola_jobs_county.csv', jobs_csv)
    _write_atomic('acs_b08202.json', json.dumps(out, separators=(',', ':'), sort_keys=True).encode('utf-8'))
    _write_atomic('lodes_primary_jobs.json', (json.dumps(aux, indent=1, sort_keys=True) + '\n').encode('utf-8'))


def fetch_aux():
    """Primary-job inputs: out-of-state in-commuters by Colorado workplace
    county and place, and primary low/middle-wage jobs by county.

    Sums the LODES JT01 aux OD file (workplace in Colorado, home elsewhere)
    by work block, mapped to county by its first five digits and to place by
    the LEHD crosswalk; SE01+SE02 come from the records themselves. Sums the
    JT01 WAC file's C000 and CE01+CE02 by county.
    """
    with urllib.request.urlopen(XWALK_URL, timeout=300) as r:
        xw = gzip.open(io.BytesIO(r.read()), 'rt', encoding='latin-1', newline='')
        block_place = {row['tabblk2020']: row['stplc'] for row in csv.DictReader(xw)
                       if row.get('stplc') and row['stplc'] != '9999999' and len(row['stplc']) == 7}
    with urllib.request.urlopen(AUX_URL, timeout=300) as r:
        rows = csv.DictReader(gzip.open(io.BytesIO(r.read()), 'rt', encoding='utf-8', newline=''))
        counties, places = {}, {}
        for row in rows:
            w = row['w_geocode']
            if row['h_geocode'][:2] == '08':
                continue  # aux is out-of-state homes by definition; guard anyway
            vals = (int(row['S000']), int(row['SE01']) + int(row['SE02']))
            for key, book in ((w[:5], counties), (block_place.get(w), places)):
                if key:
                    t = book.setdefault(key, [0, 0])
                    t[0] += vals[0]
                    t[1] += vals[1]
    # Primary low/middle-wage jobs and all jobs by workplace, for counties
    # and (through the crosswalk) places, so a place that spans counties
    # gets the wage mix of the jobs inside its own boundary.
    wac_cty, wac_plc = {}, {}
    for idx, url in ((0, WAC_PRIMARY_URL), (1, WAC_ALL_URL)):
        with urllib.request.urlopen(url, timeout=300) as r:
            for row in csv.DictReader(gzip.open(io.BytesIO(r.read()), 'rt', encoding='utf-8', newline='')):
                w = row['w_geocode']
                for key, book in ((w[:5], wac_cty), (block_place.get(w), wac_plc)):
                    if not key:
                        continue
                    t = book.setdefault(key, [0, 0, 0])
                    if idx == 0:
                        t[0] += int(row['C000'])
                        t[1] += int(row['CE01']) + int(row['CE02'])
                    else:
                        t[2] += int(row['C000'])
    out = {
        'source': AUX_URL, 'crosswalk': XWALK_URL, 'wac_source': WAC_PRIMARY_URL,
        'wac_all_source': WAC_ALL_URL, 'year': LODES_YEAR,
        'wac_primary_counties': {k: {'primary_jobs': v[0], 'primary_low_middle_wage_jobs': v[1], 'all_jobs': v[2]}
                                 for k, v in sorted(wac_cty.items())},
        'wac_primary_places': {k: {'primary_jobs': v[0], 'primary_low_middle_wage_jobs': v[1], 'all_jobs': v[2]}
                               for k, v in sorted(wac_plc.items())},
        'fields': ['S000 primary jobs', 'SE01+SE02 primary jobs earning $3,333 a month or less'],
        'counties': {k: {'jobs': v[0], 'low_middle_wage_jobs': v[1]} for k, v in sorted(counties.items())},
        'places': {k: {'jobs': v[0], 'low_middle_wage_jobs': v[1]} for k, v in sorted(places.items())},
    }
    return out


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
    return None if math.isnan(x) else x


def parse_jobs(text):
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 3:
        raise ValueError('DOLA jobs file is empty or truncated')
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


def load_jobs():
    with open(os.path.join(SRC, 'dola_jobs_county.csv'), encoding='utf-8') as f:
        return parse_jobs(f.read())


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


def primary_low_middle_per_job(aux, county, c000):
    """Primary low/middle-wage jobs (JT01 CE01+CE02) per job of any kind
    (JT00 C000) located in the county: turns a JT00 job count into the people
    in primary low- and middle-wage jobs it represents."""
    w = (aux.get('wac_primary_counties') or {}).get(county) or {}
    lm = num(w.get('primary_low_middle_wage_jobs'))
    return lm / c000 if (lm is not None and c000) else None


def need_block(incommuters, wage_share, wph, aux_low_middle=0):
    """In-state in-commuters at the county wage share, plus out-of-state
    in-commuters' own low/middle-wage count, over workers per household."""
    if incommuters is None or wage_share is None or wph is None or wph <= 0:
        return None
    base = (incommuters * wage_share + aux_low_middle) / wph
    return {('move_closer_%d' % round(s * 100)): int(round(base * s)) for s in MOVE_CLOSER_SCENARIOS}


def build():
    vintage, jobs = load_jobs()
    b08202 = read_json(os.path.join(SRC, 'acs_b08202.json')) or {}
    acs = b08202.get('geos') or {}
    od_doc = read_json(os.path.join(ROOT, 'data', 'hna', 'place-od-flows.json')) or {}
    od_year = (od_doc.get('meta') or {}).get('year')
    # The aux and WAC inputs are LODES_YEAR; place flows from another year
    # (a dispatch of rebuild-place-od-flows.yml for 2022, say) would mix
    # vintages, so places are left unavailable rather than computed from both.
    od_mismatch = od_year is not None and int(od_year) != LODES_YEAR
    od = {} if od_mismatch else (od_doc.get('places') or {})
    geo = read_json(os.path.join(ROOT, 'data', 'hna', 'geo-config.json')) or {}
    aux = read_json(os.path.join(SRC, 'lodes_primary_jobs.json')) or {}

    county_lehd = {}
    out_counties = {}
    for c in geo.get('counties') or []:
        fips = c.get('geoid')
        lehd = read_json(os.path.join(ROOT, 'data', 'hna', 'lehd', '%s.json' % fips)) or {}
        county_lehd[fips] = lehd
        c000 = num(lehd.get('C000'))
        wage_share = primary_low_middle_per_job(aux, fips, c000)
        inflow = num(lehd.get('inflow'))
        ax = (aux.get('counties') or {}).get(fips) or {}
        wph, whh, whh_cv = workers_per_household(acs.get(fips))
        j = jobs.get(fips) or {}
        j0, j1 = j.get(BASE_YEAR), j.get(BASE_YEAR + HORIZON)
        rec = {
            'name': c.get('label') or c.get('name'),
            'incommuters': inflow,
            'incommuters_out_of_state': ax.get('jobs', 0),
            'out_of_state_low_middle_wage': ax.get('low_middle_wage_jobs', 0),
            'low_middle_wage_share': round(wage_share, 4) if wage_share is not None else None,
            'workers_per_working_household': round(wph, 3) if wph is not None else None,
            'working_households_cv': whh_cv,
            'present_incommuter_need': need_block(inflow, wage_share, wph, ax.get('low_middle_wage_jobs', 0)),
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
            ax = (aux.get('places') or {}).get(gid) or {}
            place_jobs = num(flows.get('jobs'))
            lehd = county_lehd.get(county) or {}
            c000 = num(lehd.get('C000'))
            pw = (aux.get('wac_primary_places') or {}).get(gid) or {}
            p_lm, p_all = num(pw.get('primary_low_middle_wage_jobs')), num(pw.get('all_jobs'))
            if p_lm is not None and p_all:
                wage_share, basis = p_lm / p_all, 'place'
            else:
                wage_share, basis = primary_low_middle_per_job(aux, county, c000), 'county'
            wph, whh, whh_cv = workers_per_household(acs.get(gid))
            summ = (read_json(os.path.join(ROOT, 'data', 'hna', 'summary', '%s.json' % gid)) or {}).get('acsProfile') or {}
            csum = (read_json(os.path.join(ROOT, 'data', 'hna', 'summary', '%s.json' % county)) or {}).get('acsProfile') or {}
            hh, chh = num(summ.get('DP02_0001E')), num(csum.get('DP02_0001E'))
            rec = {
                'name': p.get('label') or p.get('name'),
                'containingCounty': county,
                'incommuters': inflow,
                'incommuters_out_of_state': ax.get('jobs', 0),
                'out_of_state_low_middle_wage': ax.get('low_middle_wage_jobs', 0),
                'low_middle_wage_share': round(wage_share, 4) if wage_share is not None else None,
                'wage_share_basis': basis,
                'workers_per_working_household': round(wph, 3) if wph is not None else None,
                'working_households_cv': whh_cv,
                'present_incommuter_need': need_block(inflow, wage_share, wph, ax.get('low_middle_wage_jobs', 0)),
                'share_of_county_jobs': round(place_jobs / c000, 4) if (place_jobs is not None and c000) else None,
                'share_of_county_households': round(hh / chh, 4) if (hh is not None and chh) else None,
            }
            if rec['present_incommuter_need'] is None:
                rec['unavailableReason'] = (('Place commuting flows are LODES %s; the out-of-state and wage inputs are %s, so the two are not combined.' % (od_year, LODES_YEAR)) if od_mismatch
                                            else 'No block-level LODES record for this place.' if not flows
                                            else 'Missing wage bands or ACS workers per household for this place.')
            out_places[gid] = rec

    payload = {
        'meta': {
            'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'generated_by': 'scripts/hna/build_workforce_need.py',
            'baseYear': BASE_YEAR,
            'horizonYear': BASE_YEAR + HORIZON,
            'move_closer_scenarios': list(MOVE_CLOSER_SCENARIOS),
            'method': ('present_incommuter_need = (LODES main in-commuters (all jobs, JT00) x county primary CE01+CE02 jobs '
                       '(JT01) per job located there + LODES aux JT01 out-of-state in-commuters earning SE01+SE02) / ACS B08202 workers per working household (3 or more counted as 3) x share who would move closer '
                       '(scenarios; no statewide source). A deficit today, not a 20-year projection.'),
            'sources': {
                'lodes_od': 'https://lehd.ces.census.gov/data/lodes/LODES8/co/od/co_od_main_JT00_2023.csv.gz',
                'lodes_od_aux': aux.get('source'),
                'acs_b08202': b08202.get('sources') or b08202.get('source'),
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
        # A failed refresh keeps the cached inputs rather than failing the
        # weekly build; meta.sources carries the ACS release and DOLA vintage
        # actually used, so a stale input shows as its own vintage.
        try:
            fetch()
        except Exception as e:  # noqa: BLE001 - any network or parse failure
            print(f'warning: --fetch failed ({e}); using cached inputs under data/hna/source/', file=sys.stderr)
    build()
