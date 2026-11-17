#!/usr/bin/env python3
"""Median household income by tenure (ACS 5-year table B25119) for Colorado,
its 64 counties and every place with an HNA summary file.

Writes data/hna/tenure-income.json:
  { meta: {...}, geos: { "<fips>": { all, owner, renter, all_moe, owner_moe, renter_moe } } }

Why: the owner gap compares the income needed to buy the typical home with what
owner and renter households earn, and the renter side with what renters earn.
All-household income (DP03_0062E) flatters renters and understates the gap for
first-time buyers, so each tenure gets its own median (paul, 16 Nov 2026).

Source: U.S. Census Bureau API when CENSUS_API_KEY is set; otherwise Census
Reporter's mirror of the same release (same table, same estimates; checked
against DP03_0062E = B25119_001E for Colorado, 95,470).

Usage: python3 scripts/hna/fetch_tenure_income.py [--year 2024]
"""
import argparse, datetime, json, os, sys, time, urllib.request, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUMMARY = ROOT / 'data' / 'hna' / 'summary'
OUT = ROOT / 'data' / 'hna' / 'tenure-income.json'
VARS = {'B25119_001E': 'all', 'B25119_002E': 'owner', 'B25119_003E': 'renter',
        'B25119_001M': 'all_moe', 'B25119_002M': 'owner_moe', 'B25119_003M': 'renter_moe'}


def get(url):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'coho-data-build/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if i == 3:
                raise
            print(f'retry {i + 1}: {e}', file=sys.stderr)
            time.sleep(2 ** i)


def clean(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if v < 0 else round(v)  # Census uses large negatives for "not available"


def via_census(year, key, geos):
    out = {}
    get_ = ','.join(VARS)
    base = f'https://api.census.gov/data/{year}/acs/acs5'
    calls = [('state:08', None), ('county:*', 'state:08'), ('place:*', 'state:08')]
    for for_, in_ in calls:
        q = {'get': get_, 'for': for_, 'key': key}
        if in_:
            q['in'] = in_
        rows = get(base + '?' + urllib.parse.urlencode(q))
        head = rows[0]
        for r in rows[1:]:
            d = dict(zip(head, r))
            fips = '08' + (d.get('county') or d.get('place') or '') if for_ != 'state:08' else '08'
            if fips in geos:
                out[fips] = {VARS[k]: clean(d[k]) for k in VARS}
    return out, f'https://api.census.gov/data/{year}/acs/acs5'


def via_reporter(year, geos):
    rel = f'acs{year}_5yr'
    ids = {}
    for g in geos:
        ids[{2: '04000US', 5: '05000US', 7: '16000US'}[len(g)] + g] = g
    out = {}
    keys = list(ids)
    for i in range(0, len(keys), 50):
        chunk = keys[i:i + 50]
        url = (f'https://api.censusreporter.org/1.0/data/show/{rel}?table_ids=B25119&geo_ids='
               + ','.join(chunk))
        d = get(url)
        if d.get('release', {}).get('id') != rel:
            raise SystemExit(f'unexpected release {d.get("release")}')
        for gid, t in d['data'].items():
            e, m = t['B25119']['estimate'], t['B25119']['error']
            out[ids[gid]] = {'all': clean(e.get('B25119001')), 'owner': clean(e.get('B25119002')),
                             'renter': clean(e.get('B25119003')), 'all_moe': clean(m.get('B25119001')),
                             'owner_moe': clean(m.get('B25119002')), 'renter_moe': clean(m.get('B25119003'))}
        time.sleep(0.5)
    return out, f'https://censusreporter.org/tables/B25119/ ({rel})'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=2024)
    a = ap.parse_args()
    geos = sorted(p.stem for p in SUMMARY.glob('*.json'))
    key = (os.environ.get('CENSUS_API_KEY') or '').strip()
    data, via = via_census(a.year, key, set(geos)) if key else via_reporter(a.year, geos)
    missing = [g for g in geos if g not in data]
    OUT.write_text(json.dumps({
        'meta': {
            'source': 'U.S. Census Bureau, American Community Survey 5-year, table B25119 '
                      '(median household income by tenure, inflation-adjusted dollars)',
            'url': f'https://data.census.gov/table/ACSDT5Y{a.year}.B25119',
            'vintage': f'{a.year - 4}-{a.year}',
            'fetched': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'via': via,
            'fields': 'all = all households (equals DP03_0062E); owner = owner-occupied; renter = renter-occupied; *_moe = 90% margin of error',
            'missing': missing,
        },
        'geos': {g: data[g] for g in geos if g in data},
    }, indent=1) + '\n')
    print(f'tenure-income: {len(data)} of {len(geos)} geographies, {len(missing)} missing -> {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
