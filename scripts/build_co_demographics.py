#!/usr/bin/env python3
"""Build data/co-demographics.json from the Census ACS.

Why this exists
---------------
data/co-demographics.json is the ONLY data source behind market-intelligence.html
-- its cost-burden, overcrowding, growth and rent KPIs all come from here. Until
now it had no generator and no workflow: it was hand-maintained, `updated` read
2026-01-01, and it sat on the ACS 2019-2023 release while the rest of the site
moved to 2020-2024.

The direct api.census.gov calls inside js/market-intelligence.js are dead: they
are keyless, and keyless Census requests now answer 302 for every vintage
(verified for 2022 and 2024). They never fire in practice because the cached
file loads first.

Every field records its formula in the output's `fields` block, so a later
reader can tell a definition change from a vintage change.

Usage
-----
  CENSUS_API_KEY=... python3 scripts/build_co_demographics.py
  python3 scripts/build_co_demographics.py --check      # drift gate, no key needed
"""
import json, os, sys, urllib.request, urllib.error
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'co-demographics.json')
HUD = os.path.join(ROOT, 'data', 'hud-fmr-income-limits.json')

CURRENT, PRIOR, BASE5 = 2024, 2023, 2019   # ACS 5-year releases
STATE = '08'

VARS = [
    'B01003_001E',                                            # population
    'B19013_001E',                                            # median household income
    'B25064_001E',                                            # median gross rent
    'B25077_001E',                                            # median home value
    'B25001_001E',                                            # housing units
    'B11001_001E',                                            # households
    'B25003_001E', 'B25003_002E', 'B25003_003E',              # tenure
    'B25002_001E', 'B25002_003E',                             # occupancy / vacancy
    'B25010_001E',                                            # average household size
    'B25070_001E', 'B25070_007E', 'B25070_008E',
    'B25070_009E', 'B25070_010E',                             # renter cost burden
    'B25091_001E', 'B25091_008E', 'B25091_009E',
    'B25091_010E', 'B25091_011E',                             # owner cost burden (with mortgage)
    'B25014_001E', 'B25014_005E', 'B25014_006E', 'B25014_007E',
    'B25014_011E', 'B25014_012E', 'B25014_013E',              # overcrowding
]


def fetch(year, variables, key):
    url = (f'https://api.census.gov/data/{year}/acs/acs5'
           f'?get={",".join(variables)}&for=state:{STATE}&key={key}')
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            if r.status != 200:
                raise SystemExit(f'  ACS {year}: HTTP {r.status}')
            rows = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise SystemExit(f'  ACS {year}: HTTP {e.code} — {e.reason}')
    except Exception as e:                                    # network, JSON, redirect
        raise SystemExit(f'  ACS {year}: {e}')
    if not rows or len(rows) < 2:
        raise SystemExit(f'  ACS {year}: no rows returned')
    return dict(zip(rows[0], rows[1]))


def num(d, k):
    """ACS uses large negative sentinels for suppressed values. Those are not
    zero and must never be averaged or summed as if they were."""
    v = d.get(k)
    if v in (None, ''):
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return None if f <= -666666666 else f


def ratio(n, d, places=3):
    if n is None or d in (None, 0):
        return None
    return round(n / d, places)


def statewide_ami(pop_by_county):
    """Population-weighted mean of the HUD county 4-person AMI.

    The previous hand-maintained value (97,800) had no recorded derivation, so
    it could not be reproduced or checked. This one can. It is HUD FY2026, NOT
    ACS -- a different source and vintage from every other field here, which is
    why it is labelled separately.
    """
    hud = json.load(open(HUD, encoding='utf-8'))
    num_, den = 0.0, 0.0
    used = 0
    for c in hud['counties']:
        ami = (c.get('income_limits') or {}).get('ami_4person')
        w = pop_by_county.get(c.get('fips'))
        if ami and w:
            num_ += ami * w
            den += w
            used += 1
    if not den:
        return None, 0, hud['meta'].get('source')
    return int(round(num_ / den)), used, hud['meta'].get('source')


def county_pops(key):
    url = (f'https://api.census.gov/data/{CURRENT}/acs/acs5'
           f'?get=B01003_001E&for=county:*&in=state:{STATE}&key={key}')
    with urllib.request.urlopen(url, timeout=60) as r:
        rows = json.loads(r.read().decode('utf-8'))
    head = rows[0]
    i_pop, i_st, i_co = head.index('B01003_001E'), head.index('state'), head.index('county')
    return {r[i_st] + r[i_co]: float(r[i_pop]) for r in rows[1:] if r[i_pop]}


def build(key):
    cur = fetch(CURRENT, VARS, key)
    prior = fetch(PRIOR, ['B25064_001E'], key)
    base = fetch(BASE5, ['B01003_001E', 'B11001_001E'], key)
    ami, ami_n, ami_src = statewide_ami(county_pops(key))

    pop, hh = num(cur, 'B01003_001E'), num(cur, 'B11001_001E')
    rent_burden_num = sum(filter(None, (num(cur, f'B25070_{n}E') for n in ('007', '008', '009', '010'))))
    owner_burden_num = sum(filter(None, (num(cur, f'B25091_{n}E') for n in ('008', '009', '010', '011'))))
    crowd_num = sum(filter(None, (num(cur, f'B25014_{n}E') for n in ('005', '006', '007', '011', '012', '013'))))

    out = {
        'updated': date.today().isoformat(),
        'source': f'U.S. Census Bureau — American Community Survey 5-Year Estimates ({CURRENT - 4}-{CURRENT})',
        'source_url': 'https://data.census.gov/',
        'generator': 'scripts/build_co_demographics.py',
        'state': 'Colorado',
        'fips': STATE,
        'population': int(pop) if pop else None,
        'median_household_income': int(num(cur, 'B19013_001E') or 0) or None,
        'median_hh_income': int(num(cur, 'B19013_001E') or 0) or None,
        'median_gross_rent': int(num(cur, 'B25064_001E') or 0) or None,
        'median_gross_rent_current': int(num(cur, 'B25064_001E') or 0) or None,
        'median_gross_rent_prior': int(num(prior, 'B25064_001E') or 0) or None,
        'median_home_value': int(num(cur, 'B25077_001E') or 0) or None,
        'owner_occupied_rate': ratio(num(cur, 'B25003_002E'), num(cur, 'B25003_001E')),
        'renter_occupied_rate': ratio(num(cur, 'B25003_003E'), num(cur, 'B25003_001E')),
        'housing_units': int(num(cur, 'B25001_001E') or 0) or None,
        'household_count': int(hh) if hh else None,
        'vacancy_rate': ratio(num(cur, 'B25002_003E'), num(cur, 'B25002_001E')),
        'cost_burdened_renters_pct': ratio(rent_burden_num, num(cur, 'B25070_001E')),
        'cost_burden_share': ratio(rent_burden_num, num(cur, 'B25070_001E')),
        'severe_burden_share': ratio(num(cur, 'B25070_010E'), num(cur, 'B25070_001E')),
        'cost_burdened_owners_pct': ratio(owner_burden_num, num(cur, 'B25091_001E')),
        'overcrowding_rate': ratio(crowd_num, num(cur, 'B25014_001E')),
        'population_growth_rate_5yr': ratio(pop - num(base, 'B01003_001E'), num(base, 'B01003_001E')),
        'household_growth_rate_5yr': ratio(hh - num(base, 'B11001_001E'), num(base, 'B11001_001E')),
        'household_size_avg': num(cur, 'B25010_001E'),
        'ami_estimate': ami,
        'fields': {
            'population': 'B01003_001E',
            'median_household_income': 'B19013_001E',
            'median_gross_rent': 'B25064_001E',
            'median_gross_rent_prior': f'B25064_001E, ACS {PRIOR - 4}-{PRIOR}',
            'median_home_value': 'B25077_001E',
            'housing_units': 'B25001_001E',
            'household_count': 'B11001_001E',
            'owner_occupied_rate': 'B25003_002E / B25003_001E',
            'renter_occupied_rate': 'B25003_003E / B25003_001E',
            'vacancy_rate': 'B25002_003E / B25002_001E',
            'cost_burdened_renters_pct': '(B25070_007E+008E+009E+010E) / B25070_001E — renters paying 30%+',
            'severe_burden_share': 'B25070_010E / B25070_001E — renters paying 50%+',
            'cost_burdened_owners_pct': '(B25091_008E+009E+010E+011E) / B25091_001E — owners WITH A MORTGAGE '
                                        'paying 30%+, over all owners; the numerator excludes mortgage-free owners '
                                        'by construction, so this understates burden among owners overall',
            'overcrowding_rate': '(B25014_005E+006E+007E+011E+012E+013E) / B25014_001E — >1.00 occupants per room',
            'population_growth_rate_5yr': f'B01003_001E vs ACS {BASE5 - 4}-{BASE5} (non-overlapping 5-year releases)',
            'household_growth_rate_5yr': f'B11001_001E vs ACS {BASE5 - 4}-{BASE5} (non-overlapping 5-year releases)',
            'household_size_avg': 'B25010_001E',
            'ami_estimate': f'population-weighted mean of county income_limits.ami_4person over {ami_n} counties '
                            f'— {ami_src}. HUD, not ACS: different source and vintage from every other field here.',
        },
    }
    return out


def main():
    if '--check' in sys.argv:
        if not os.path.exists(OUT):
            print('  data/co-demographics.json is missing', file=sys.stderr)
            return 2
        cur = json.load(open(OUT, encoding='utf-8'))
        want = f'({CURRENT - 4}-{CURRENT})'
        if want not in str(cur.get('source', '')):
            print(f'  data/co-demographics.json is on {cur.get("source")!r}; this script builds {want}.',
                  file=sys.stderr)
            print('  Run the "Refresh Colorado demographics" workflow (it holds CENSUS_API_KEY).', file=sys.stderr)
            return 1
        if cur.get('generator') != 'scripts/build_co_demographics.py':
            print('  data/co-demographics.json has no generator stamp — it was hand-edited.', file=sys.stderr)
            return 1
        print(f'  co-demographics is current ({cur["source"]})')
        return 0

    key = os.environ.get('CENSUS_API_KEY')
    if not key:
        print('  CENSUS_API_KEY is not set. Keyless Census requests answer 302 for every',
              file=sys.stderr)
        print('  vintage, so there is no unauthenticated path — this exits rather than', file=sys.stderr)
        print('  silently leaving the old file in place and reporting success.', file=sys.stderr)
        return 2

    out = build(key)
    missing = [k for k, v in out.items() if v is None and k != 'fields']
    if missing:
        print(f'  refusing to write: {len(missing)} field(s) came back empty: {missing}', file=sys.stderr)
        return 1

    prev = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    json.dump(out, open(OUT, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    open(OUT, 'a', encoding='utf-8').write('\n')
    print(f'  wrote {os.path.relpath(OUT, ROOT)} — {out["source"]}')
    for k in sorted(set(prev) & set(out)):
        if k in ('updated', 'source', 'fields') or prev[k] == out[k]:
            continue
        print(f'    {k:<30} {prev[k]!r} -> {out[k]!r}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
