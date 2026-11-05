#!/usr/bin/env python3
"""
scripts/build_rent_income_history.py

Rent against income, as far back as public Census files allow.

data/co-housing-costs/county-trends.json holds three ACS five-year cohorts
(2005-09, 2010-14, 2020-24). This adds the three decennial long-form points
before them, so a reader can see today against a 44-year range:

  Colorado and its counties: 1980, 1990, 2000 Census long form, read from the
      Census Bureau's "USA Counties" compendium (2011), items HSG860180D/
      HSG860190D/HSG860200D (median gross rent, specified renter-occupied units
      paying cash rent) and INC110179D/INC110189D/INC110199D (median household
      income in the prior calendar year). Its 2005-09 items (HSG860209D,
      INC110209D) are the ACS figures county-trends.json already holds; they are
      kept as `check_2005_09` so the guard test can prove the two files agree.
  Colorado, 2010-14: ACS 2014 five-year summary file (B25064, B19013), state
      row. (The county rows of that file are county-trends.json's 2014 cohort;
      the build stops if any of the 64 differ.)
  Colorado, 2020-24: data/hna/summary/08.json (DP04_0134E rent, DP03_0062E
      income), the site's statewide ACS 2024 profile.
  Incorporated cities and towns, 2000: Census 2000 Summary File 3, Colorado,
      P053001 (median household income in 1999, segment 06) and H063001
      (median gross rent, segment 59), summary level 160. Census-designated
      places are left out: their lines are redrawn every census, so a CDP in
      2000 and in 2024 is often not the same area.
  Renter homes per county, 2020-24: B25070_001 from
      data/co-housing-costs/acs_county_latest.parquet (used to size the map's
      arrows; not a measure on its own).
  CPI-U annual averages (BLS CUUR0000SA0, read via FRED series CPIAUCNS): the
      long-form income is for the calendar year before the rent was asked, so
      `median_hh_income_rent_year` moves it to the rent year's dollars
      (1979 x CPI1980/CPI1979, and so on). ACS five-year medians already put
      rent and income in the same dollars.

No inflation adjustment is needed to compare rent growth with income growth:
both are in the same year's dollars at each point. CPI is stored so a page can
also say how much each grew after inflation.

Broomfield (08014) became a county on 2001-11-15 and has no decennial figures:
its record carries nulls with a reason, as the 64-county rule requires.

Run:  python3 scripts/build_rent_income_history.py [--cache DIR]
Downloads are cached in DIR (default: a temp folder) and never committed.
"""
import argparse
import csv
import io
import json
import os
import sys
import tempfile
import subprocess
import zipfile
from datetime import datetime, timezone

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'co-housing-costs', 'rent-income-history.json')
TRENDS = os.path.join(ROOT, 'data', 'co-housing-costs', 'county-trends.json')
STATE_SUMMARY = os.path.join(ROOT, 'data', 'hna', 'summary', '08.json')
PARQUET = os.path.join(ROOT, 'data', 'co-housing-costs', 'acs_county_latest.parquet')

USA_COUNTIES = 'https://www2.census.gov/library/publications/2011/compendia/usa-counties/excel/'
SF3 = 'https://www2.census.gov/census_2000/datasets/Summary_File_3/Colorado/'
ACS14 = 'https://www2.census.gov/programs-surveys/acs/summary_file/2014/data/5_year_by_state/Colorado_All_Geographies_Not_Tracts_Block_Groups.zip'
FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS&fq=Annual&fam=avg'

DECENNIAL = [  # (rent year, income year, rent item, income item)
    (1980, 1979, 'HSG860180D', 'INC110179D'),
    (1990, 1989, 'HSG860190D', 'INC110189D'),
    (2000, 1999, 'HSG860200D', 'INC110199D'),
]
CPI_YEARS = [1979, 1980, 1989, 1990, 1999, 2000, 2009, 2014, 2024]
BROOMFIELD = '08014'


def fetch(url, cache, name):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        # curl, not urllib: FRED closes urllib connections without a response.
        subprocess.run(['curl', '-sSfL', '--retry', '3', '-m', '600', '-o', path + '.part', url], check=True)
        os.replace(path + '.part', path)
    return path


def usa_counties(cache):
    hsg = pd.read_excel(fetch(USA_COUNTIES + 'HSG04.xls', cache, 'HSG04.xls'), sheet_name='HSG04H', dtype={'STCOU': str})
    inc = pd.read_excel(fetch(USA_COUNTIES + 'INC01.xls', cache, 'INC01.xls'), sheet_name='INC01A', dtype={'STCOU': str})
    out = {}
    for df in (hsg, inc):
        df['STCOU'] = df['STCOU'].astype(str).str.zfill(5)
        for _, r in df[df['STCOU'].str.startswith('08')].iterrows():
            rec = out.setdefault(r['STCOU'], {'name': str(r['Area_name'])})
            for c in df.columns:
                if c.startswith(('HSG860', 'INC110')):
                    rec[c] = float(r[c])
    return out


def cpi(cache):
    vals = {}
    for row in csv.DictReader(open(fetch(FRED, cache, 'CPIAUCNS-annual.csv'))):
        if row['CPIAUCNS'] not in ('', '.'):
            vals[int(row['observation_date'][:4])] = float(row['CPIAUCNS'])
    return {y: vals[y] for y in CPI_YEARS}


def acs2014_state(cache, trends):
    z = zipfile.ZipFile(fetch(ACS14, cache, 'acs2014-5yr-co.zip'))
    geo = {}
    for r in csv.reader(io.TextIOWrapper(z.open('g20145co.csv'), encoding='latin-1')):
        if r[2] in ('040', '050') and r[3] == '00':
            geo[r[4]] = '08000' if r[2] == '040' else r[9] + r[10]

    def col(seq, pos):  # pos: 1-based start position from ACS_5yr_Seq_Table_Number_Lookup (2014)
        f = io.TextIOWrapper(z.open('e20145co%04d000.txt' % seq), encoding='latin-1')
        return {geo[r[5]]: float(r[pos - 1]) for r in csv.reader(f) if r[5] in geo}
    income, rent = col(58, 177), col(105, 54)  # B19013_001, B25064_001
    for g, c in trends['counties'].items():
        y14 = [x for x in c['acs_cohorts'] if x['year'] == 2014][0]
        if income[g] != y14['median_hh_income'] or rent[g] != y14['median_gross_rent']:
            sys.exit('ACS 2014 summary file and county-trends.json disagree for %s' % g)
    return rent['08000'], income['08000']


def sf3_places(cache):
    zips = {n: zipfile.ZipFile(fetch(SF3 + n, cache, n)) for n in ('cogeo_uf3.zip', 'co00006_uf3.zip', 'co00059_uf3.zip')}
    places = {}
    for line in io.TextIOWrapper(zips['cogeo_uf3.zip'].open('cogeo.uf3'), encoding='latin-1'):
        if line[8:11] == '160' and line[11:13] == '00':
            name = line[200:290].strip()
            if name.endswith(' CDP'):
                continue
            places[line[18:25]] = ('08' + line[45:50], name)

    def col(zname, member, idx):
        f = io.TextIOWrapper(zips[zname].open(member), encoding='latin-1')
        return {p[4]: p[idx] for p in (l.rstrip('\n').split(',') for l in f) if p[4] in places}
    # Field positions found by matching all 64 county rows against USA Counties (see the test).
    income = col('co00006_uf3.zip', 'co00006.uf3', 87)   # P053001
    rent = col('co00059_uf3.zip', 'co00059.uf3', 202)    # H063001
    out = {}
    for lr, (geoid, name) in places.items():
        r, i = float(rent.get(lr) or 0), float(income.get(lr) or 0)
        y = {'median_gross_rent': r if r > 0 else None, 'median_hh_income_1999': i if i > 0 else None}
        # SF3 writes 0 where it publishes no median; keep null and say which field and why.
        why = {}
        if r <= 0:
            why['median_gross_rent'] = 'Census 2000 SF3 H063001 is 0 for this place: no median gross rent was published.'
        if i <= 0:
            why['median_hh_income_1999'] = 'Census 2000 SF3 P053001 is 0 for this place: no median household income was published.'
        if why:
            y['unavailable_reason'] = why
        out[geoid] = {'name': name, 'y2000': y}
    return out


def sf3_county_check(cache):
    """The same two fields at county level, so the test can confirm the positions."""
    zips = {n: zipfile.ZipFile(fetch(SF3 + n, cache, n)) for n in ('cogeo_uf3.zip', 'co00006_uf3.zip', 'co00059_uf3.zip')}
    geo = {}
    for line in io.TextIOWrapper(zips['cogeo_uf3.zip'].open('cogeo.uf3'), encoding='latin-1'):
        if line[8:11] == '050' and line[11:13] == '00':
            geo[line[18:25]] = '08' + line[31:34]

    def col(zname, member, idx):
        f = io.TextIOWrapper(zips[zname].open(member), encoding='latin-1')
        return {geo[p[4]]: float(p[idx]) for p in (l.rstrip('\n').split(',') for l in f) if p[4] in geo}
    return col('co00059_uf3.zip', 'co00059.uf3', 202), col('co00006_uf3.zip', 'co00006.uf3', 87)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'rent-income-history-cache'))
    cache = ap.parse_args().cache
    os.makedirs(cache, exist_ok=True)

    trends = json.load(open(TRENDS))
    uc = usa_counties(cache)
    c = cpi(cache)
    rent14, inc14 = acs2014_state(cache, trends)
    prof = json.load(open(STATE_SUMMARY))['acsProfile']
    if int(prof['_acsYear']) != 2024:
        sys.exit('data/hna/summary/08.json is ACS %s, expected 2024' % prof['_acsYear'])
    pq = pd.read_parquet(PARQUET)
    renters = {r.county_fips: int(r.rent_burden_total) for r in pq[pq.acs_year == 2024].itertuples()}

    # SF3 field positions must reproduce USA Counties' 2000 county values exactly.
    sf3_rent, sf3_inc = sf3_county_check(cache)
    for g, rec in uc.items():
        if g in sf3_rent and (sf3_rent[g] != rec['HSG860200D'] or sf3_inc[g] != rec['INC110199D']):
            sys.exit('SF3 field positions do not match USA Counties for %s' % g)

    def dec_points(rec):
        pts = []
        for ry, iy, rk, ik in DECENNIAL:
            r, i = rec.get(rk) or 0, rec.get(ik) or 0
            if r > 0 and i > 0:
                pts.append({'period': str(ry), 'rent_year': ry, 'income_year': iy, 'median_gross_rent': r,
                            'median_hh_income': i, 'median_hh_income_rent_year': round(i * c[ry] / c[iy])})
        return pts

    st = uc['08000']
    colorado = dec_points(st) + [
        {'period': '2005-09', 'rent_year': 2009, 'income_year': 2009, 'median_gross_rent': st['HSG860209D'], 'median_hh_income': st['INC110209D'], 'median_hh_income_rent_year': st['INC110209D']},
        {'period': '2010-14', 'rent_year': 2014, 'income_year': 2014, 'median_gross_rent': rent14, 'median_hh_income': inc14, 'median_hh_income_rent_year': inc14},
        {'period': '2020-24', 'rent_year': 2024, 'income_year': 2024, 'median_gross_rent': float(prof['DP04_0134E']), 'median_hh_income': float(prof['DP03_0062E']), 'median_hh_income_rent_year': float(prof['DP03_0062E'])},
    ]

    counties = {}
    for g in sorted(trends['counties']):
        rec = uc.get(g, {})
        entry = {'name': trends['counties'][g]['county_name'].replace(', Colorado', ''),
                 'decennial': dec_points(rec),
                 'check_2005_09': {'median_gross_rent': rec.get('HSG860209D'), 'median_hh_income': rec.get('INC110209D')},
                 'renter_homes_2020_24': renters.get(g)}
        if g == BROOMFIELD:
            entry['decennial'] = []
            entry['decennial_missing_reason'] = 'Broomfield became a county on 2001-11-15; the 1980-2000 Census counted its area in Adams, Boulder, Jefferson and Weld.'
        counties[g] = entry
    if len(counties) != 64:
        sys.exit('expected 64 counties, got %d' % len(counties))

    places = sf3_places(cache)
    for p in places.values():
        y = p['y2000']
        y['median_hh_income_rent_year'] = round(y['median_hh_income_1999'] * c[2000] / c[1999]) if y['median_hh_income_1999'] else None

    out = {
        'meta': {
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'builder': 'scripts/build_rent_income_history.py',
            'what': 'Median gross rent and median household income, Colorado and its counties 1980-2000 (Census long form) plus Colorado 2005-09, 2010-14 and 2020-24 (ACS 5-year), and incorporated places in 2000. County ACS cohorts live in county-trends.json.',
            'method': 'Long-form income is for the calendar year before the census; median_hh_income_rent_year moves it to the rent year with CPI-U annual averages. ACS 5-year medians already state rent and income in the same dollars. Compare rent growth with income growth using median_gross_rent and median_hh_income_rent_year.',
            'comparability': 'Census says decennial long-form and ACS rent and income can be compared with care: ACS income is for the past 12 months and ACS is a rolling five-year sample. https://www.census.gov/programs-surveys/acs/guidance/comparing-acs-data.html',
            'sources': [
                {'id': 'usa_counties', 'title': 'U.S. Census Bureau, USA Counties (2011), HSG04 sheet HSG04H and INC01 sheet INC01A', 'url': USA_COUNTIES, 'items': ['HSG860180D', 'HSG860190D', 'HSG860200D', 'HSG860209D', 'INC110179D', 'INC110189D', 'INC110199D', 'INC110209D']},
                {'id': 'sf3_2000', 'title': 'U.S. Census Bureau, Census 2000 Summary File 3, Colorado (P053001, H063001)', 'url': SF3},
                {'id': 'acs_2014', 'title': 'U.S. Census Bureau, ACS 2010-2014 5-year summary file, Colorado (B25064, B19013)', 'url': ACS14},
                {'id': 'acs_2024', 'title': 'U.S. Census Bureau, ACS 2020-2024 5-year data profile, Colorado (DP04_0134E, DP03_0062E), via data/hna/summary/08.json', 'url': 'https://data.census.gov/table/ACSDP5Y2024.DP04?g=040XX00US08'},
                {'id': 'cpi_u', 'title': 'BLS CPI-U, U.S. city average, all items, annual average (CUUR0000SA0), via FRED CPIAUCNS', 'url': 'https://fred.stlouisfed.org/series/CPIAUCNS'},
            ],
            'cpi_u_annual': {str(k): v for k, v in c.items()},
        },
        'colorado': colorado,
        'counties': counties,
        'places_2000': dict(sorted(places.items())),
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print('wrote', OUT, len(counties), 'counties,', len(places), 'places')


if __name__ == '__main__':
    main()
