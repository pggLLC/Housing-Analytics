#!/usr/bin/env python3
"""Build data/market/cbp-workplace-size.json: private workplaces by number of employees, for every Colorado county.

Source: U.S. Census Bureau, County Business Patterns (CBP), county file (public domain, no key needed).
  https://www.census.gov/programs-surveys/cbp.html
  https://www2.census.gov/programs-surveys/cbp/datasets/<year>/cbp<yy>co.zip

CBP counts establishments (single physical locations, not companies) in the week of March 12, by employee-size
class. It names no employer. It covers private employers only: no government, self-employed, private households,
railroads or most farm work. So a county's school district, county government or state prison never shows here.

The script tries the newest year first and keeps the first file it can download.
Usage: python3 scripts/build_cbp_workplace_size.py [--year 2023]   (writes data/market/cbp-workplace-size.json)
"""
import argparse
import csv
import io
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import date

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'market', 'cbp-workplace-size.json')
RANK = os.path.join(os.path.dirname(__file__), '..', 'data', 'hna', 'ranking-index.json')
PAGE = 'https://www.census.gov/programs-surveys/cbp.html'
URL = 'https://www2.census.gov/programs-surveys/cbp/datasets/{y}/cbp{yy}co.zip'

# Size classes as CBP prints them; the four from 100 employees up are the "large" ones.
SIZES = [('n<5', '1-4'), ('n5_9', '5-9'), ('n10_19', '10-19'), ('n20_49', '20-49'), ('n50_99', '50-99'),
         ('n100_249', '100-249'), ('n250_499', '250-499'), ('n500_999', '500-999'), ('n1000', '1,000 or more')]
LARGE = ['n100_249', 'n250_499', 'n500_999', 'n1000']
# NAICS 2017 sector titles (two-digit), as the Census Bureau names them.
SECTORS = {
    '11': 'Agriculture, forestry, fishing and hunting', '21': 'Mining, quarrying, and oil and gas extraction',
    '22': 'Utilities', '23': 'Construction', '31': 'Manufacturing', '42': 'Wholesale trade', '44': 'Retail trade',
    '48': 'Transportation and warehousing', '51': 'Information', '52': 'Finance and insurance',
    '53': 'Real estate and rental and leasing', '54': 'Professional, scientific, and technical services',
    '55': 'Management of companies and enterprises', '56': 'Administrative and support and waste management',
    '61': 'Educational services', '62': 'Health care and social assistance', '71': 'Arts, entertainment, and recreation',
    '72': 'Accommodation and food services', '81': 'Other services (except public administration)',
    '99': 'Industries not classified',
}


def num(v):
    """CBP prints 'N' (not available) or a footnote letter where a count is withheld: keep that as None."""
    v = (v or '').strip().strip('"')
    return int(v) if v.isdigit() else None


def sizes(r):
    """Counts by size class. CBP prints 'N' in a class it does not publish. When the published classes already add
    up to the establishment total, every 'N' class must be 0; otherwise those classes stay None (unknown)."""
    vals = {k: num(r[k]) for k, _ in SIZES}
    est = num(r['est'])
    known = sum(v for v in vals.values() if v is not None)
    gaps = [k for k, v in vals.items() if v is None]
    if est is not None and known == est:
        vals = {k: (v if v is not None else 0) for k, v in vals.items()}
    elif est is not None and len(gaps) == 1:
        vals[gaps[0]] = est - known  # the one unpublished class is what is left of the total
    return vals


def large_count(r, v):
    """Workplaces with 100+ employees: the sum of the four large classes when all are known, or else the total less
    the five small classes when those are all known. None when neither can be read off the file."""
    if all(v[k] is not None for k in LARGE):
        return sum(v[k] for k in LARGE)
    small = [v[k] for k, _ in SIZES if k not in LARGE]
    est = num(r['est'])
    return est - sum(small) if est is not None and all(x is not None for x in small) else None


def fetch(year):
    url = URL.format(y=year, yy=str(year)[2:])
    req = urllib.request.Request(url, headers={'User-Agent': 'coho-analytics-data-build'})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return url, r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return url, None
        raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int)
    a = ap.parse_args()
    years = [a.year] if a.year else list(range(date.today().year - 1, date.today().year - 5, -1))
    for year in years:
        url, raw = fetch(year)
        if raw:
            break
    else:
        print('cbp: no county file found for ' + ', '.join(map(str, years)), file=sys.stderr)
        return 1

    zf = zipfile.ZipFile(io.BytesIO(raw))
    name = [n for n in zf.namelist() if n.lower().endswith('.txt')][0]
    rows = csv.DictReader(io.TextIOWrapper(zf.open(name), encoding='latin-1'))
    counties = {}
    for r in rows:
        if r['fipstate'].strip('"') != '08':
            continue
        fips = '08' + r['fipscty'].strip('"')
        naics = r['naics'].strip('"')
        c = counties.setdefault(fips, {'establishments': None, 'employees': None, 'by_size': {}, 'large': None, 'large_at_most': None, 'large_by_sector': []})
        if naics == '------':
            c['establishments'] = num(r['est'])
            c['employees'] = num(r['emp']) if (r.get('emp_nf') or '').strip('"') not in ('D', 'S') else None
            v = sizes(r)
            c['by_size'] = {label: v[k] for k, label in SIZES}
            c['large'] = large_count(r, v)
            if c['large'] is None and c['establishments'] is not None:
                # Unknown, but no more than the total less the published classes under 100 employees. Published
                # large classes stay in, since they are part of the 100+ count.
                c['large_at_most'] = c['establishments'] - sum(v[k] for k, _ in SIZES if k not in LARGE and v[k] is not None)
        elif len(naics) == 6 and naics[2:] == '----':
            n = large_count(r, sizes(r))
            if n:
                c['large_by_sector'].append({'naics': naics[:2], 'sector': SECTORS.get(naics[:2], naics[:2]), 'workplaces': n})

    with open(RANK, encoding='utf-8') as fh:
        all_fips = sorted(g['geoid'] for g in json.load(fh)['rankings'] if g.get('type') == 'county')
    missing = {}
    for f in all_fips:
        if f not in counties:
            counties[f] = None
            missing[f] = 'No row for this county in the CBP file.'
        else:
            counties[f]['large_by_sector'].sort(key=lambda s: (-s['workplaces'], s['naics']))
    out = {
        'meta': {
            'title': 'Private workplaces by number of employees, by county',
            'year': year,
            'reference_week': 'week of March 12, %d' % year,
            'source': {'label': 'U.S. Census Bureau, County Business Patterns %d' % year, 'url': PAGE, 'file': url},
            'what': 'Establishments (single locations, not companies) by employee-size class, and the sectors of those '
                    'with 100 or more employees. No employer is named.',
            'excludes': 'Government (schools, counties, cities, state and federal agencies), self-employed people, '
                        'private households, railroads and most farm work.',
            'large_means': '100 or more employees at one location',
            'large_at_most': 'Where CBP withholds the large classes, the most there could be (the total less the published classes under 100 employees).',
            'large_by_sector': 'Sectors where CBP publishes the large classes; a sector it withholds is left out, so these can add to less than large.',
            'withheld': 'CBP prints N in a size class it does not publish. Where the published classes already add up to '
                        'the total, those classes are 0; otherwise they are null (unknown), never guessed.',
            'missing_counties': missing,
            'built': date.today().isoformat(),
            'script': 'scripts/build_cbp_workplace_size.py',
        },
        'counties': {f: counties[f] for f in all_fips},
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print('cbp %d: %d counties, %d missing' % (year, len(all_fips), len(missing)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
