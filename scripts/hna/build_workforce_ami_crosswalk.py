#!/usr/bin/env python3
"""Build data/hna/workforce-ami-crosswalk.json: homes per job, by income band.

LODES says how many jobs a place hosts and sorts them into three pay tiers by
one job's monthly earnings (CE01 up to $1,250, CE02 $1,251 to $3,333, CE03
more). A home is needed by a household, and whether a household can afford a
rent depends on its whole income and its size, not on one job's pay: two
CE02 earners can be above 60% AMI, and a CE03 earner with four children can
be below it. This file is the step between the two, from the Census Bureau's
public microdata (ACS PUMS):

  for each LODES pay tier, the households per job, split by the household's
  income as a share of the county's income limits for its size.

Each worker counts as 1 / (wage and salary workers in the household) of a
household, so a household with two workers is one home for two jobs: the
workers-per-household step is built in. This is the chain a jobs-housing
nexus study uses (jobs, then worker households, then income tiers).

Workers: ACS PUMS 2020-2024 5-year, Colorado. People in a household (not
group quarters) who worked last week in Colorado as an employee (class of
worker 1-5, the jobs LODES counts; self-employed left out) and had wages in
the last 12 months. Region: their place-of-work PUMA (POWPUMA), the smallest
area PUMS gives for where people work; Colorado has 11.

Pay tier: wages over the months worked (weeks worked x 12/52), in LODES-year
dollars, since a LODES tier is a job's monthly pay while it is held.

Income band: household income against CHFA's income limits for the county
and household size (regular tiers; above 8 people, HUD's 8% a person on the
4-person limit), in the limits' own dollars. PUMS reports 2024 dollars;
HUD trends its incomes to the limits' year by CPI, and so does this, with
CPI-U from data/fred-data.json.

Margins: each share has a standard error from the 80 PUMS replicate weights
(successive difference replication, SE = sqrt(4/80 x sum of squared
differences)), per the PUMS user guide.

    python3 scripts/hna/build_workforce_ami_crosswalk.py [--pums-dir DIR]

Without --pums-dir it downloads the PUMS files (about 58 MB) to a temporary
folder. Rerun when a new PUMS 5-year file or new CHFA limits are published.
scripts/hna/build_workforce_need.py reads the output.
"""
import argparse
import csv
import io
import json
import math
import os
import sys
import tempfile
import urllib.request
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'hna', 'workforce-ami-crosswalk.json')
LIMITS = os.path.join(ROOT, 'data', 'chfa-income-rent-limits-2026.json')
FRED = os.path.join(ROOT, 'data', 'fred-data.json')

PUMS_PERSONS_URL = 'https://www2.census.gov/programs-surveys/acs/data/pums/2024/5-Year/csv_pco.zip'
PUMS_HOUSING_URL = 'https://www2.census.gov/programs-surveys/acs/data/pums/2024/5-Year/csv_hco.zip'
TRACT_PUMA_URL = 'https://www2.census.gov/geo/docs/reference/puma2020/2020_Census_Tract_to_2020_PUMA.txt'
PUMS_DOLLAR_YEAR = 2024
LODES_YEAR = 2023  # build_workforce_need.py LODES_YEAR

# The PUMS place-of-work code groups 2020 PUMAs. The Census Bureau publishes
# no 2020 PUMA-to-POWPUMA file for Colorado, so the grouping is written out
# here (a PUMA not listed is its own POWPUMA) and checked against the file:
# most workers who live in each PUMA work in its POWPUMA (check_grouping).
POWPUMA_OF = {}
for _p in ('00301', '00302', '00303'):
    POWPUMA_OF[_p] = '00300'  # Larimer
for _p in ('00401', '00501', '00502', '00601', '00701', '00702', '00703', '00801', '00901',
           '00902', '01101', '01201', '01202', '01301', '01401', '01501', '01601', '01602',
           '01603', '01701', '01702', '01703', '01704', '01705'):
    POWPUMA_OF[_p] = '00490'  # Denver, Boulder, Jefferson, Adams, Arapahoe, Douglas, Broomfield
for _p in ('01001', '01002', '01003'):
    POWPUMA_OF[_p] = '01000'  # Weld
for _p in ('02001', '02002', '02003', '02004', '02005', '02006'):
    POWPUMA_OF[_p] = '02007'  # El Paso, Teller
for _p in ('02101', '02301'):
    POWPUMA_OF[_p] = '02190'  # Pueblo, upper Arkansas
for _p in ('02401', '02501'):
    POWPUMA_OF[_p] = '02490'  # Mesa, Delta, Montrose, Ouray, San Miguel

TIERS = ('CE01', 'CE02', 'CE03')
TIER_TOP = (1250, 3333)  # LODES monthly earnings, nominal
BANDS = (30, 50, 60, 80, 120)  # upper edges, % of AMI; above 120 is the last band
BAND_KEYS = ('le30', '30_50', '50_60', '60_80', '80_120', 'over120')
CUMULATIVE = {'le60': 3, 'le80': 4, 'le120': 5}  # first n bands
N_REP = 80
CLASS_OF_WORKER = {'1', '2', '3', '4', '5'}  # private, nonprofit, local, state, federal employees


def download(url, folder):
    path = os.path.join(folder, url.rsplit('/', 1)[1])
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (COHO Analytics build)'})
        with urllib.request.urlopen(req, timeout=600) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


def rows(path, member):
    """CSV rows from a PUMS zip, or from the unzipped file beside it."""
    plain = os.path.join(os.path.dirname(path), member)
    if os.path.exists(plain):
        with open(plain, newline='', encoding='utf-8') as f:
            yield from csv.DictReader(f)
        return
    with zipfile.ZipFile(path) as z, z.open(member) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8', newline=''))


def cpi():
    series = json.load(open(FRED, encoding='utf-8'))['series']['CPIAUCSL']['observations']
    by = {o['date']: float(o['value']) for o in series if o.get('value') not in (None, '', '.')}

    def year(y):
        v = [x for d, x in by.items() if d.startswith('%d-' % y)]
        if len(v) != 12:
            sys.exit('CPI-U has %d months for %d, not 12' % (len(v), y))
        return sum(v) / 12
    return by, year


def limit(limits, pct, size):
    il = limits[str(pct)]['income_limits']
    if size <= 8:
        return il['%dp' % size]
    return il['4p'] * (1 + 0.08 * (size - 4))


def band_of(income, size, limits):
    for i, pct in enumerate(BANDS):
        if income <= limit(limits, pct, size):
            return i
    return len(BANDS)


def county_regions(folder):
    path = download(TRACT_PUMA_URL, folder)
    regions = {}
    with open(path, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            if r['STATEFP'] == '08':
                regions.setdefault('08' + r['COUNTYFP'], set()).add(POWPUMA_OF.get(r['PUMA5CE'], r['PUMA5CE']))
    split = {c: sorted(v) for c, v in regions.items() if len(v) != 1}
    if split or len(regions) != 64:
        sys.exit('county-to-POWPUMA does not give each of 64 counties one region: %s' % split)
    return {c: next(iter(v)) for c, v in regions.items()}


def check_grouping(home_work):
    """Most workers living in each PUMA work in its POWPUMA."""
    bad = []
    for puma, work in home_work.items():
        total = sum(work.values())
        own = work.get(POWPUMA_OF.get(puma, puma), 0)
        if total and own / total < 0.6:
            bad.append('%s: %.0f%% work in %s' % (puma, 100 * own / total, POWPUMA_OF.get(puma, puma)))
    if bad:
        sys.exit('POWPUMA grouping disagrees with where residents work: ' + '; '.join(bad))


def se(values):
    return math.sqrt(4 / N_REP * sum((v - values[0]) ** 2 for v in values[1:]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--pums-dir', help='folder holding csv_pco.zip and csv_hco.zip (or psam_p08.csv, psam_h08.csv)')
    a = ap.parse_args()
    folder = a.pums_dir or tempfile.mkdtemp(prefix='pums-')
    persons = download(PUMS_PERSONS_URL, folder)
    housing = download(PUMS_HOUSING_URL, folder)

    chfa = json.load(open(LIMITS, encoding='utf-8'))
    limits = {c['fips']: c['regular_tiers'] for c in chfa['counties']}
    effective = chfa['meta']['effective_date']  # e.g. 2026-05-01
    by_month, year_avg = cpi()
    month = effective[:7] + '-01'
    if month not in by_month:
        sys.exit('CPI-U has no value for %s, the limits\' effective month' % month)
    income_factor = by_month[month] / year_avg(PUMS_DOLLAR_YEAR)
    wage_factor = year_avg(LODES_YEAR) / year_avg(PUMS_DOLLAR_YEAR)
    region_of = county_regions(folder)

    households = {}
    for r in rows(housing, 'psam_h08.csv'):
        if r['TYPEHUGQ'] == '1' and r['HINCP'] != '':
            income = float(r['HINCP']) * float(r['ADJINC']) / 1e6 * income_factor
            households[r['SERIALNO']] = (income, int(r['NP']))

    rep_keys = ['PWGTP%d' % i for i in range(1, N_REP + 1)]
    workers_in = {}
    workers = []
    home_work = {}
    for r in rows(persons, 'psam_p08.csv'):
        if (r['COW'] not in CLASS_OF_WORKER or r['POWSP'] == '' or r['WAGP'] == ''
                or float(r['WAGP']) <= 0 or r['SERIALNO'] not in households):
            continue
        workers_in[r['SERIALNO']] = workers_in.get(r['SERIALNO'], 0) + 1
        if r['POWSP'] != '008' or r['WKWN'] in ('', '0'):
            continue
        monthly = float(r['WAGP']) * float(r['ADJINC']) / 1e6 * wage_factor / (float(r['WKWN']) * 12 / 52)
        tier = 0 if monthly <= TIER_TOP[0] else 1 if monthly <= TIER_TOP[1] else 2
        weights = [float(r['PWGTP'])] + [float(r[k]) for k in rep_keys]
        workers.append((r['SERIALNO'], r['POWPUMA'], tier, weights))
        hw = home_work.setdefault(r['PUMA'], {})
        hw[r['POWPUMA']] = hw.get(r['POWPUMA'], 0) + weights[0]
    check_grouping(home_work)

    regions = {}
    for reg in sorted(set(region_of.values())):
        regions[reg] = {'counties': sorted(c for c, v in region_of.items() if v == reg),
                        'sample_workers': [0, 0, 0]}
    for _, reg, tier, _ in workers:
        if reg in regions:
            regions[reg]['sample_workers'][tier] += 1
    thin = [(reg, TIERS[t], n) for reg, v in regions.items() for t, n in enumerate(v['sample_workers']) if n < 100]
    if thin:
        sys.exit('too few sample workers for a share: %s' % thin)

    counties = {}
    for fips in sorted(region_of):
        reg, lim = region_of[fips], limits[fips]
        jobs = [[0.0] * (N_REP + 1) for _ in TIERS]
        homes = [[[0.0] * (N_REP + 1) for _ in BAND_KEYS] for _ in TIERS]
        for serial, wreg, tier, weights in workers:
            if wreg != reg:
                continue
            income, size = households[serial]
            b = band_of(income, size, lim)
            per = 1 / workers_in[serial]
            jt, hb = jobs[tier], homes[tier][b]
            for i, w in enumerate(weights):
                jt[i] += w
                hb[i] += w * per
        tiers = {}
        for t, name in enumerate(TIERS):
            shares = [[homes[t][b][i] / jobs[t][i] for i in range(N_REP + 1)] for b in range(len(BAND_KEYS))]
            rec = {k: [round(s[0], 4), round(se(s), 4)] for k, s in zip(BAND_KEYS, shares)}
            for key, n in list(CUMULATIVE.items()) + [('all', len(BAND_KEYS))]:
                cum = [sum(shares[b][i] for b in range(n)) for i in range(N_REP + 1)]
                rec[key] = [round(cum[0], 4), round(se(cum), 4)]
            tiers[name] = rec
        counties[fips] = {'region': reg, 'tiers': tiers}

    out = {
        'meta': {
            'generated_by': 'scripts/hna/build_workforce_ami_crosswalk.py',
            'what': 'Households per job located in the county, by LODES pay tier and by household income as a share '
                    'of the county\'s income limits for its size. [share, standard error] pairs.',
            'sources': {
                'pums': 'ACS PUMS 2020-2024 5-year, Colorado: ' + PUMS_PERSONS_URL + ' and ' + PUMS_HOUSING_URL,
                'puma_counties': TRACT_PUMA_URL,
                'income_limits': chfa['meta']['source'] + ', ' + chfa['meta']['source_url'] + ' (regular tiers)',
                'cpi': 'CPI-U (CPIAUCSL), data/fred-data.json',
            },
            'workers': 'Employees (class of worker 1-5) in households, at work last week in Colorado, with wages; '
                       'each counts 1 / wage and salary workers in the household.',
            'pay_tier': 'Wages / (weeks worked x 12/52), in %d dollars: CE01 <= $1,250 a month, CE02 <= $3,333, CE03 above.' % LODES_YEAR,
            'income': 'Household income in %s dollars (PUMS %d dollars x CPI-U %s / %d average = %.4f) against the '
                      'county\'s CHFA limit for the household size.' % (effective[:7], PUMS_DOLLAR_YEAR, effective[:7],
                                                                        PUMS_DOLLAR_YEAR, income_factor),
            'standard_error': 'From the 80 PUMS replicate weights: sqrt(4/80 x sum of squared differences).',
            'bands': list(BAND_KEYS),
            'cumulative': ['le60', 'le80', 'le120', 'all'],
            'limits_effective': effective,
        },
        'regions': regions,
        'counties': counties,
    }
    lines = [' %s: %s' % (json.dumps(k), json.dumps(v)) for k, v in out.items() if k != 'counties']
    inner = ',\n'.join('  %s: %s' % (json.dumps(k), json.dumps(v, separators=(',', ':'))) for k, v in counties.items())
    lines.append(' "counties": {\n%s\n }' % inner)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('{\n' + ',\n'.join(lines) + '\n}\n')
    print('%d counties in %d regions, %d sample workers -> %s'
          % (len(counties), len(regions), len(workers), os.path.relpath(OUT, ROOT)))


if __name__ == '__main__':
    main()
