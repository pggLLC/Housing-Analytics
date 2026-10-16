#!/usr/bin/env python3
"""
scripts/market/build_market_direction.py — which Colorado county housing
markets are emerging, steady, softening, or losing demand, and where an
affordable deal's 60% AMI rent has an edge over the market.

Every call is a fixed rule over five signals the repo already carries, and
every signal is written next to the call with its source and years, so a
reader can disagree with the rule and still use the numbers:

  permits     Census BPS units permitted, 2021–2025 against 2016–2020
              (data/hna/permits.json); counted only when each five-year
              period has at least PERMIT_FLOOR units, because a county going
              from 7 to 34 permits is noise, not a trend
  price       FHFA House Price Index, 2022 to the latest year
              (data/market/fhfa_hpi_subcounty_co.json)
  rent        Zillow Observed Rent Index, year-over-year
              (data/market/zori_rents_co.json; larger markets only)
  population  DOLA household population, ten-year growth rate
              (data/hna/source/dola_profiles_county.csv). Household
              population leaves out group quarters (prisons, dorms, nursing
              homes), which house no one in the housing market: Crowley and
              Bent lose prison population while their households grow
  jobs        LEHD LODES jobs located in the county, 2019 to the latest year
              (data/hna/lehd/)

The rent edge compares HUD's two-bedroom Fair Market Rent (gross, 40th
percentile of recent movers) with CHFA's 60% AMI two-bedroom maximum gross
rent. Where the FMR is at or below the 60% rent, a tax-credit deal cannot
charge its 60% rent and competes with market units on price.

A missing signal is null with the reason, never zero. Writes
data/market/market-direction.json. No network.

Usage:
  python3 scripts/market/build_market_direction.py          # write
  python3 scripts/market/build_market_direction.py --check  # compare, write nothing
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

GEO_CONFIG = os.path.join(ROOT, 'data', 'hna', 'geo-config.json')
PERMITS = os.path.join(ROOT, 'data', 'hna', 'permits.json')
FHFA = os.path.join(ROOT, 'data', 'market', 'fhfa_hpi_subcounty_co.json')
ZORI = os.path.join(ROOT, 'data', 'market', 'zori_rents_co.json')
DOLA_PROFILES = os.path.join(ROOT, 'data', 'hna', 'source', 'dola_profiles_county.csv')
LEHD_DIR = os.path.join(ROOT, 'data', 'hna', 'lehd')
RENT_LIMITS = os.path.join(ROOT, 'data', 'chfa-income-rent-limits-2026.json')
FMR = os.path.join(ROOT, 'data', 'market', 'fmr_co.json')
ACTIVITY = os.path.join(ROOT, 'data', 'market', 'development-activity.json')
OUT = os.path.join(ROOT, 'data', 'market', 'market-direction.json')

PERMIT_FLOOR = 50       # units in EACH five-year period before the change is read
PRICE_BASE_YEAR = 2022  # the Front Range price peak; change since then is the correction
# (up, down): a signal at or above `up` reads up, at or below `down` reads down
THRESHOLDS = {
    'permits': (15.0, -15.0),    # % change, 2021–25 vs 2016–20
    'price': (12.0, 4.0),        # % change since 2022, nominal; 4% over three years is a real-terms fall
    'rent': (3.0, 0.0),          # % change over a year
    'population': (0.5, 0.0),    # household population, % a year over ten years
    'jobs': (5.0, 0.0),          # % change since 2019
}
RENT_EDGE_THIN = 10.0  # a 60% rent less than this % of the FMR below it is a thin edge

CALLS = {
    'emerging': ('People or jobs are growing, at least two of permits, prices and rents are rising, '
                 'and none is falling.'),
    'steady': 'Neither rising nor falling on the rule below.',
    'softening': 'At least two of permits, prices and rents are falling.',
    'falling_demand': 'Household population and jobs are both shrinking.',
    'not_enough_data': 'Fewer than two market signals and no reading of both population and jobs.',
}
EDGES = {
    'no_edge': "The FMR is at or below the 60% AMI rent: a 60% unit can't charge its 60% rent.",
    'thin': f'The 60% AMI rent is below the FMR by less than {RENT_EDGE_THIN:.0f}% of the FMR.',
    'clear': f'The 60% AMI rent is below the FMR by {RENT_EDGE_THIN:.0f}% of the FMR or more.',
}


STAMP_KEYS = ('generated_at', 'generated', 'generated_at_utc', 'updated', 'last_verified')


def stamp(meta: dict) -> str | None:
    """An input file's own refresh stamp; the builders name it differently
    (build_market_rents_co.py writes generated_at_utc, FHFA only last_verified,
    the DOLA projection and LEHD county files a top-level updated)."""
    return next((str(meta[k]) for k in STAMP_KEYS if meta.get(k)), None)


def read(path: str):
    with open(path) as fh:
        return json.load(fh)


def pct(new, old) -> float | None:
    if not isinstance(new, (int, float)) or not isinstance(old, (int, float)) or old <= 0 or new <= 0:
        return None
    return round((new / old - 1) * 100, 1)


def reading(name: str, value: float | None) -> str | None:
    if value is None:
        return None
    up, down = THRESHOLDS[name]
    return 'up' if value >= up else 'down' if value <= down else 'flat'


def permits_signal(rec: dict | None, years: list[int]) -> dict:
    units = (rec or {}).get('units_total') or []
    if len(units) != len(years) or len(years) < 10 or any(u is None for u in units[-10:]):
        return {'value': None, 'unavailable_reason': 'BPS does not carry ten full years for this county'}
    a, b = sum(units[-10:-5]), sum(units[-5:])
    out = {'period_a': f'{years[-10]}–{years[-6]}', 'units_a': a,
           'period_b': f'{years[-5]}–{years[-1]}', 'units_b': b}
    if a < PERMIT_FLOOR or b < PERMIT_FLOOR:
        out.update(value=None, unavailable_reason=f'fewer than {PERMIT_FLOOR} units in a five-year period; '
                                                  'the change would be noise')
    else:
        out['value'] = round((b - a) / a * 100, 1)
    return out


def price_signal(rec: dict | None) -> dict:
    by = (rec or {}).get('hpi_by_year') or {}
    latest = (rec or {}).get('latest_year')
    v = pct(by.get(str(latest)), by.get(str(PRICE_BASE_YEAR))) if latest else None
    out = {'from_year': PRICE_BASE_YEAR, 'to_year': latest, 'value': v}
    if v is None:
        out['unavailable_reason'] = 'FHFA publishes no index for this county' if not rec else \
            f'FHFA index missing for {PRICE_BASE_YEAR} or the latest year'
    return out


def rent_signal(rec: dict | None) -> dict:
    v = (rec or {}).get('yoy_change_pct')
    out = {'value': v if isinstance(v, (int, float)) else None, 'month': (rec or {}).get('vintage_month')}
    if out['value'] is None:
        out['unavailable_reason'] = 'Zillow publishes no rent index for this county'
    return out


def read_profiles(path: str) -> tuple[dict, str | None]:
    """DOLA county profiles: {(county fips, year): row}, and the file's own
    stamp from its first line ("Vintage 2024 Prepared October 2025")."""
    with open(path, newline='') as fh:
        first = fh.readline()
        rows = {(f"08{r['countyfips'].zfill(3)}", int(r['year'])): r for r in csv.DictReader(fh)}
    m = re.search(r'Prepared (\w+) (\d{4})', first)
    months = ('january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
              'october', 'november', 'december')
    prepared = f'{m.group(2)}-{months.index(m.group(1).lower()) + 1:02d}' \
        if m and m.group(1).lower() in months else None
    return rows, prepared


def num(row: dict | None, col: str) -> float | None:
    try:
        v = float((row or {})[col])
    except (KeyError, TypeError, ValueError):
        return None
    return v


def cagr(new, old, years: int) -> float | None:
    if not new or not old or new <= 0 or old <= 0:
        return None
    return round(((new / old) ** (1 / years) - 1) * 100, 2)


def population_signal(fips: str, prof: dict) -> dict:
    latest = max((y for f, y in prof if f == fips), default=None)
    if latest is None:
        return {'value': None, 'unavailable_reason': 'no DOLA estimates for this county'}
    base, now = prof.get((fips, latest - 10)), prof[(fips, latest)]
    out = {'value': cagr(num(now, 'householdpopulation'), num(base, 'householdpopulation'), 10),
           'measure': 'household population, % a year',
           'from_year': latest - 10, 'to_year': latest,
           # total population is shown beside it: where they part, group quarters moved
           'total_population_value': cagr(num(now, 'totalpopulation'), num(base, 'totalpopulation'), 10),
           'group_quarters_from': num(base, 'groupquarterspopulation'),
           'group_quarters_to': num(now, 'groupquarterspopulation')}
    if out['value'] is None:
        out['unavailable_reason'] = f'DOLA household population missing for {latest - 10} or {latest}'
    return out


def recent_demand(fips: str, prof: dict) -> dict:
    """Context beside the call, not part of it: DOLA households over the last
    five estimate years and net migration over the same years."""
    latest = max((y for f, y in prof if f == fips), default=None)
    if latest is None:
        return {'households_value': None, 'unavailable_reason': 'no DOLA estimates for this county'}
    years = range(latest - 4, latest + 1)
    mig = [num(prof.get((fips, y)), 'netmigration') for y in years]
    out = {'from_year': latest - 5, 'to_year': latest,
           'households_value': cagr(num(prof[(fips, latest)], 'households'),
                                    num(prof.get((fips, latest - 5)), 'households'), 5),
           'households_measure': 'households, % a year',
           'net_migration': None if any(v is None for v in mig) else int(sum(mig)),
           'net_migration_years': f'{latest - 4}–{latest}'}
    if out['households_value'] is None:
        out['households_unavailable_reason'] = f'DOLA households missing for {latest - 5} or {latest}'
    if out['net_migration'] is None:
        out['net_migration_unavailable_reason'] = \
            f'DOLA net migration missing for a year in {latest - 4}–{latest}; a partial sum is not shown'
    return out


def jobs_signal(fips: str) -> dict:
    try:
        d = read(os.path.join(LEHD_DIR, f'{fips}.json'))
    except OSError:
        return {'value': None, 'unavailable_reason': 'no LEHD county file'}
    emp = d.get('annualEmployment') or {}
    years = sorted(int(y) for y in emp if isinstance(emp[y], (int, float)))
    if 2019 not in years or years[-1] <= 2019:
        return {'value': None, 'unavailable_reason': 'LEHD jobs missing for 2019 or a later year'}
    return {'value': pct(emp[str(years[-1])], emp['2019']), 'from_year': 2019, 'to_year': years[-1],
            'jobs_from': emp['2019'], 'jobs_to': emp[str(years[-1])]}


def call_of(sig: dict) -> tuple[str, str]:
    r = {k: reading(k, sig[k]['value']) for k in THRESHOLDS}
    market = [k for k in ('permits', 'price', 'rent') if r[k] is not None]
    falling = [k for k in market if r[k] == 'down']
    rising = [k for k in market if r[k] == 'up']
    pop, jobs = sig['population']['value'], sig['jobs']['value']
    if len(market) < 2 and (pop is None or jobs is None):
        return 'not_enough_data', 'fewer than two market signals'
    if pop is not None and jobs is not None and pop < 0 and jobs < 0:
        return 'falling_demand', f'population {pop:+.2f}%/yr and jobs {jobs:+.1f}% since 2019'
    if len(falling) >= 2:
        return 'softening', 'falling: ' + ', '.join(falling)
    growing = r['population'] == 'up' or r['jobs'] == 'up'
    if growing and len(rising) >= 2 and not falling:
        return 'emerging', 'rising: ' + ', '.join(rising) + '; growing: ' + \
            ', '.join(k for k in ('population', 'jobs') if r[k] == 'up')
    return 'steady', ('rising: ' + (', '.join(rising) or 'none') + '; falling: ' + (', '.join(falling) or 'none'))


def rent_edge(fips: str, limits: dict, fmr: dict) -> dict:
    lim_rec = limits.get(fips) or {}
    tiers = lim_rec.get('regular_tiers') or {}
    lim = ((tiers.get('60') or {}).get('max_rents') or {}).get('2br')
    f = fmr.get(fips) or {}
    market = f.get('Two-Bedroom')
    out = {'fmr_2br': market if isinstance(market, (int, float)) and market > 0 else None,
           'fmr_area': f.get('metro_name'),
           'lihtc_60_2br': lim if isinstance(lim, (int, float)) and lim > 0 else None,
           'edge_pct': None, 'reading': None}
    if out['fmr_2br'] is None or out['lihtc_60_2br'] is None:
        out['unavailable_reason'] = 'no FMR or no CHFA 60% rent for this county'
        return out
    edge = round((out['fmr_2br'] - out['lihtc_60_2br']) / out['fmr_2br'] * 100, 1)
    out['edge_pct'] = edge
    out['reading'] = 'no_edge' if edge <= 0 else 'thin' if edge < RENT_EDGE_THIN else 'clear'
    return out


def build() -> dict:
    geo = read(GEO_CONFIG)
    permits = read(PERMITS)
    fhfa = read(FHFA)
    zori = read(ZORI)
    limits_doc = read(RENT_LIMITS)
    limits = {c['fips']: c for c in limits_doc['counties']}
    fmr_doc = read(FMR)
    fmr = {c['fips_code'][:5]: c for c in fmr_doc['data']['data']['counties']}
    try:
        activity = read(ACTIVITY)
    except OSError:
        activity = {'meta': {}, 'county_summary': {}}
    prof, prof_stamp = read_profiles(DOLA_PROFILES)
    years = permits['years']
    counties = {}
    for c in sorted(geo['counties'], key=lambda c: c['geoid']):
        f = c['geoid']
        sig = {
            'permits': permits_signal(permits['counties'].get(f), years),
            'price': price_signal(fhfa['counties'].get(f)),
            'rent': rent_signal(zori['counties'].get(f)),
            'population': population_signal(f, prof),
            'jobs': jobs_signal(f),
        }
        for k in sig:
            sig[k]['reading'] = reading(k, sig[k]['value'])
        call, why = call_of(sig)
        act = activity['county_summary'].get(f)
        counties[f] = {
            'name': c['label'], 'call': call, 'call_basis': why, 'signals': sig,
            'recent_demand': recent_demand(f, prof),
            'rent_edge': rent_edge(f, limits, fmr),
            'affordable_activity': {'since': activity['meta'].get('summary_since'),
                                    'projects': act['projects'], 'homes': act['homes'],
                                    # homes leaves out projects that print no count, and a
                                    # scattered site in several counties counts in each
                                    'projects_without_homes': act['projects_without_homes'],
                                    'multi_county_projects': act['multi_county_projects'],
                                    'by_stage': {k: v for k, v in act['by_stage'].items() if v['projects']}}
            if act else None,
        }
    stamps = [stamp(d['meta']) for d in (permits, fhfa, zori, fmr_doc, activity, limits_doc)] + [stamp(geo)]
    stamps.append(prof_stamp)
    for f in counties:  # the per-county jobs files
        try:
            stamps.append(stamp(read(os.path.join(LEHD_DIR, f'{f}.json'))))
        except OSError:
            continue  # a county with no file has a null signal and adds no stamp
    tally: dict[str, int] = {}
    edge_tally: dict[str, int] = {}
    for r in counties.values():
        tally[r['call']] = tally.get(r['call'], 0) + 1
        k = r['rent_edge']['reading'] or 'unavailable'
        edge_tally[k] = edge_tally.get(k, 0) + 1
    return {
        'meta': {
            'generated_at': max(str(s) for s in stamps if s),
            'generated_at_note': "the newest of the input files' own stamps, not the time this ran",
            'generator': 'scripts/market/build_market_direction.py',
            'title': 'Colorado county housing market direction and tax-credit rent edge',
            'geography': 'all 64 Colorado counties; places follow once the county rule is reviewed',
            'calls': CALLS,
            'rule_order': ('not_enough_data, then falling_demand, then softening, then emerging, else steady: '
                           'the first that applies is the call'),
            'thresholds': {k: {'up_at_or_above': v[0], 'down_at_or_below': v[1]} for k, v in THRESHOLDS.items()},
            'threshold_note': ('Thresholds are a reviewer\'s choice, not a standard. Prices are nominal: about 4% '
                               'over three years is a fall after inflation. A signal between its two thresholds '
                               'reads flat.'),
            'permit_floor': PERMIT_FLOOR,
            'rent_edge': EDGES,
            'rent_edge_note': ("HUD FMR is the 40th-percentile gross rent of recent movers for the county's FMR "
                               'area; several counties share a metro FMR, and non-metro counties often sit at '
                               'the state non-metro level. CHFA 60% rents are gross and use HUD income limits, '
                               'which hold rural counties at a national non-metro floor. Both are gross rents '
                               '(utilities included). edge_pct is (FMR - 60% rent) / FMR: the discount a 60% '
                               'unit offers against the market, as a share of the market rent, not the premium '
                               'of the FMR over the 60% rent.'),
            'sources': {
                'permits': {'file': 'data/hna/permits.json', 'source': permits['meta'].get('source'),
                            'url': (permits['meta'].get('source_urls') or [None])[0]},
                'price': {'file': 'data/market/fhfa_hpi_subcounty_co.json', 'source': fhfa['meta'].get('source'),
                          'url': fhfa['meta'].get('source_page_url') or fhfa['meta'].get('source_url')},
                'rent': {'file': 'data/market/zori_rents_co.json', 'source': zori['meta'].get('source'),
                         'url': zori['meta'].get('city_url')},
                'population': {'file': 'data/hna/source/dola_profiles_county.csv',
                               'source': 'DOLA State Demography Office, county profiles (household population, '
                                         'households, net migration)',
                               'url': 'https://storage.googleapis.com/co-publicdata/profiles-county.csv'},
                'jobs': {'file': 'data/hna/lehd/<county>.json', 'source': 'U.S. Census Bureau LEHD LODES8 (WAC)',
                         'url': 'https://lehd.ces.census.gov/data/lodes/LODES8/co/'},
                'fmr': {'file': 'data/market/fmr_co.json', 'source': fmr_doc['meta'].get('source'),
                        'fiscal_year': fmr_doc['meta'].get('fiscal_year'), 'url': fmr_doc['meta'].get('url')},
                'lihtc_rents': {'file': 'data/chfa-income-rent-limits-2026.json',
                                'source': limits_doc['meta'].get('source'),
                                'effective': limits_doc['meta'].get('effective_date'),
                                'url': limits_doc['meta'].get('source_url')},
                'affordable_activity': {'file': 'data/market/development-activity.json'},
            },
            'call_counts': dict(sorted(tally.items())),
            'rent_edge_counts': dict(sorted(edge_tally.items())),
        },
        'counties': counties,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='build and compare with the file on disk; write nothing')
    args = ap.parse_args()
    out = build()
    if args.check:
        try:
            prior = read(OUT)
        except OSError:
            print(f'{os.path.relpath(OUT, ROOT)} does not exist', file=sys.stderr)
            return 1
        same = json.dumps(prior, sort_keys=True) == json.dumps(out, sort_keys=True)
        print('fresh' if same else 'stale: run python3 scripts/market/build_market_direction.py')
        return 0 if same else 1
    with open(OUT, 'w') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    m = out['meta']
    print(f"64 counties: {m['call_counts']}; rent edge {m['rent_edge_counts']}; wrote {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
