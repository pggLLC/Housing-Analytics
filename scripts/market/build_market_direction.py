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

Towns and CDPs get the same rule on what each has (the `places` block):
permits from the same BPS file; price from FHFA's tract index modelled to
the place, one year's change against the price thresholds scaled to a year;
rent where Zillow publishes the city; and DOLA household population for
incorporated towns (data/market/dola_muni_household_population.json). No
town-level jobs trend exists, so a town's demand reading is its household
population alone. A shrinking town is falling demand only when a market
signal agrees (one falling or flat, none rising); where ACS counts 20% or more
of its homes as seasonal (data/hna/second-homes-str.json) it is a second-home
shift instead, and with no market signal at all it is not enough data. The
county's call is shown beside each place for context. CDPs have no DOLA series, so
their demand is null with that reason.

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
import unicodedata

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
DOLA_TOWNS = os.path.join(ROOT, 'data', 'market', 'dola_muni_household_population.json')
SECOND_HOMES = os.path.join(ROOT, 'data', 'hna', 'second-homes-str.json')
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
# a place's price is FHFA's latest one-year change, so the county's
# three-year price thresholds are read a year at a time
# and a town's one demand signal has to fall by about 2.5% over the decade
# before it reads as shrinking, since no jobs trend corroborates it
PLACE_THRESHOLDS = dict(THRESHOLDS, price=(4.0, 1.3), population=(0.5, -0.25))
PLACE_CALLS = dict(CALLS,
                   emerging=('Household population is growing, at least two of permits, prices and rents are '
                             'rising, and none is falling.'),
                   falling_demand=('Household population is shrinking by 0.25% a year or more, at least one of '
                                   'permits, prices and rents is falling or flat, and none is rising (towns only; '
                                   'CDPs have no DOLA series).'),
                   second_home_shift=('Household population is shrinking where seasonal homes are at least '
                                      '20% of all homes: homes are leaving the year-round market, which is not '
                                      'falling demand.'),
                   not_enough_data=('Fewer than two market signals and no household population reading, or a '
                                    'shrinking household population that no permit, price or rent reading '
                                    'confirms.'))
# a town shrinking in year-round households while this share of its homes
# are seasonal is losing homes to second-home use, not losing demand
SECOND_HOME_SHARE = 0.20
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
        why = 'no DOLA estimates for this county'
        return {'from_year': None, 'to_year': None, 'households_value': None,
                'households_measure': 'households, % a year', 'households_unavailable_reason': why,
                'net_migration': None, 'net_migration_years': None, 'net_migration_unavailable_reason': why}
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
    if emp['2019'] <= 0 or emp[str(years[-1])] <= 0:
        # a zero job count is a suppressed or failed figure, not a county with no jobs
        return {'value': None, 'unavailable_reason': f'LEHD jobs for 2019 or {years[-1]} are zero or negative, '
                                                     'which is a missing figure, not a count'}
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


def place_reading(name: str, value: float | None) -> str | None:
    if value is None:
        return None
    up, down = PLACE_THRESHOLDS[name]
    return 'up' if value >= up else 'down' if value <= down else 'flat'


def place_price_signal(rec: dict | None, year: int | None) -> dict:
    v = (rec or {}).get('annual_change_latest')
    out = {'value': round(v * 100, 1) if isinstance(v, (int, float)) else None, 'to_year': year,
           'measure': '% change over the latest year, modelled from FHFA tract indexes'}
    if out['value'] is None:
        out['unavailable_reason'] = 'FHFA publishes no tract index that covers this place' if not rec else \
            'FHFA tract indexes for this place are suppressed for the latest year'
    return out


def town_population_signal(rec: dict | None, is_cdp: bool) -> dict:
    if is_cdp:
        return {'value': None, 'unavailable_reason': 'DOLA estimates cover incorporated towns only, not CDPs'}
    series = (rec or {}).get('household_population') or {}
    years = sorted(int(y) for y in series)
    if not years:
        return {'value': None, 'unavailable_reason': 'no DOLA estimates for this town'}
    a, b = years[-1] - 10, years[-1]
    out = {'value': cagr(series.get(str(b)), series.get(str(a)), 10), 'measure': 'household population, % a year',
           'from_year': a, 'to_year': b, 'households_from': series.get(str(a)), 'households_to': series.get(str(b))}
    if out['value'] is None:
        out['unavailable_reason'] = f'DOLA reports no household population for {a} or {b}'
    return out


def place_call(sig: dict, seasonal: dict | None = None) -> tuple[str, str]:
    """seasonal is the place's ACS seasonal-homes record; a share graded
    unreliable is not used."""
    r = {k: place_reading(k, sig[k]['value']) for k in ('permits', 'price', 'rent', 'population')}
    market = [k for k in ('permits', 'price', 'rent') if r[k] is not None]
    falling = [k for k in market if r[k] == 'down']
    rising = [k for k in market if r[k] == 'up']
    pop = sig['population']['value']
    if len(market) < 2 and pop is None:
        return 'not_enough_data', 'fewer than two market signals and no household population reading'
    if r['population'] == 'down':
        share = (seasonal or {}).get('share_of_housing_units')
        if share is not None and share >= SECOND_HOME_SHARE and seasonal.get('reliability') != 'unreliable':
            return 'second_home_shift', f'household population {pop:+.2f}%/yr; seasonal homes {share:.0%} of homes'
        if not market:
            return 'not_enough_data', (f'household population {pop:+.2f}%/yr, but no permit, price or rent '
                                       'reading confirms it')
        if not rising:
            return 'falling_demand', (f'household population {pop:+.2f}%/yr; '
                                      + ', '.join(f'{k} {r[k]}' for k in market))
        # a rising market signal contradicts the household decline: read on
        # the market rule, which cannot reach emerging with population down
    if len(falling) >= 2:
        return 'softening', 'falling: ' + ', '.join(falling)
    if r['population'] == 'up' and len(rising) >= 2 and not falling:
        return 'emerging', 'rising: ' + ', '.join(rising) + '; growing: population'
    return 'steady', ('rising: ' + (', '.join(rising) or 'none') + '; falling: ' + (', '.join(falling) or 'none'))


def bare_name(label: str) -> str:
    """"Fort Collins (city)" and "Fort Collins", "Cañon City" and "Canon City", read alike."""
    label = unicodedata.normalize('NFKD', label).encode('ascii', 'ignore').decode()
    return re.sub(r'\s*\((?:city|town|CDP|city and county)\)$', '', label, flags=re.I).strip().lower()


def zori_places(zori_cities: dict, places: list[dict]) -> tuple[dict, list[str]]:
    """Zillow names a city, not a place code: join each to the one place of
    that name, preferring a town over a CDP; a name two towns share joins
    neither. Returns {geoid: record} and the city names left unmatched."""
    by_name: dict[str, list[dict]] = {}
    for p in places:
        by_name.setdefault(bare_name(p['label']), []).append(p)
    out, unmatched = {}, []
    for key, rec in sorted(zori_cities.items()):
        cands = by_name.get(bare_name(rec.get('name') or key), [])
        towns = [p for p in cands if p.get('type') != 'cdp']
        pick = towns if towns else cands
        if len(pick) == 1:
            out[pick[0]['geoid']] = rec
        else:
            unmatched.append(rec.get('name') or key)
    return out, unmatched


def place_activity(projects: list[dict], since: int | None) -> dict:
    """Recent affordable projects by place, as the county summary counts them:
    a project with no unit count adds to projects_without_homes, never 0."""
    out: dict[str, dict] = {}
    for p in projects:
        g = p.get('place_geoid')
        if not g or since is None or (p.get('latest_year') or 0) < since:
            continue
        b = out.setdefault(g, {'since': since, 'projects': 0, 'homes': 0, 'projects_without_homes': 0})
        b['projects'] += 1
        if p.get('total_units'):
            b['homes'] += p['total_units']
        else:
            b['projects_without_homes'] += 1
    for b in out.values():
        if b['projects'] == b['projects_without_homes']:
            b['homes'] = None
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
    try:
        towns = read(DOLA_TOWNS)
    except OSError:
        towns = {'meta': {}, 'towns': {}}
    try:
        second_homes = read(SECOND_HOMES)
    except OSError:
        second_homes = {'meta': {}, 'geographies': {}}
    zori_by_place, zori_unmatched = zori_places(zori['cities'], geo['places'] + [dict(p, type='cdp') for p in geo['cdps']])
    activity_by_place = place_activity(activity.get('projects') or [], activity['meta'].get('summary_since'))
    places = {}
    cdps = {p['geoid'] for p in geo['cdps']}  # not every CDP row carries type: cdp
    for pl in sorted(geo['places'] + geo['cdps'], key=lambda p: p['geoid']):
        g, is_cdp = pl['geoid'], pl['geoid'] in cdps
        prec = permits['places'].get(g)
        sig = {
            'permits': permits_signal(prec, years) if prec else
            {'value': None, 'unavailable_reason': 'Census BPS reports no permits for this place'},
            'price': place_price_signal(fhfa['places'].get(g), fhfa['meta'].get('latest_year')),
            'rent': rent_signal(zori_by_place.get(g)),
            'population': town_population_signal(towns['towns'].get(g), is_cdp),
        }
        if sig['rent']['value'] is None:
            sig['rent']['unavailable_reason'] = 'Zillow publishes no rent index for this place' \
                if g not in zori_by_place else 'Zillow publishes no year-over-year change for this place'
        for k in sig:
            sig[k]['reading'] = place_reading(k, sig[k]['value'])
        sh = second_homes['geographies'].get(g) or {}
        seasonal = sh.get('seasonal_homes')
        call, why = place_call(sig, seasonal)
        county = pl.get('containingCounty')
        places[g] = {
            'name': pl['label'], 'type': 'cdp' if is_cdp else 'town', 'county_fips': county,
            'call': call, 'call_basis': why, 'signals': sig,
            'seasonal_homes': {'share_of_housing_units': seasonal.get('share_of_housing_units'),
                               'reliability': seasonal.get('reliability')} if seasonal else
            {'share_of_housing_units': None,
             'unavailable_reason': sh.get('seasonal_homes_unavailable_reason') or 'no ACS seasonal-homes record'},
            'county_call': counties.get(county, {}).get('call'),
            'affordable_activity': activity_by_place.get(g),
        }
    stamps = [stamp(d['meta']) for d in (permits, fhfa, zori, fmr_doc, activity, limits_doc, towns, second_homes)]
    stamps.append(stamp(geo))
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
            'geography': 'all 64 Colorado counties, and every town and CDP in geo-config (places)',
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
            'places': {
                'calls': PLACE_CALLS,
                'thresholds': {k: {'up_at_or_above': v[0], 'down_at_or_below': v[1]}
                               for k, v in PLACE_THRESHOLDS.items() if k != 'jobs'},
                'rule_note': ('The county rule on what a place has. Price is one year of FHFA tract indexes '
                              'modelled to the place, read against the county thresholds scaled to a year. '
                              'No town-level jobs trend exists, so demand is household population alone; '
                              'county_call is the county\'s call, for context. A town of a few hundred homes '
                              'often has fewer than two market signals: that is not_enough_data, not a guess. '
                              'With no jobs trend, a shrinking household population is falling_demand only when '
                              'a market signal agrees (one falling or flat, none rising); where seasonal homes '
                              'are 20% or more of homes (ACS, not graded unreliable) it is second_home_shift; '
                              'unconfirmed it is not_enough_data; contradicted by a rising signal it is read on '
                              'the market rule.'),
                'rule_order': ('not_enough_data (no demand reading), then for shrinking household population: '
                               'second_home_shift, not_enough_data (no market signal), falling_demand (none '
                               'rising), else on to softening, then emerging, else steady'),
                'second_home_share': SECOND_HOME_SHARE,
                'seasonal_homes_source': {'file': 'data/hna/second-homes-str.json',
                                          'source': 'ACS 5-year B25004_006 over B25001 (seasonal, recreational '
                                                    'or occasional use)',
                                          'release': (second_homes['meta'].get('acs_release') or {}).get('name')},
                'population_source': {'file': 'data/market/dola_muni_household_population.json',
                                      'source': towns['meta'].get('source'), 'url': towns['meta'].get('source_url'),
                                      'years': towns['meta'].get('years')},
                'zori_cities_unmatched': zori_unmatched,
                'call_counts': {t_: dict(sorted(
                    {c: sum(1 for r in places.values() if r['type'] == t_ and r['call'] == c)
                     for c in {r['call'] for r in places.values() if r['type'] == t_}}.items()))
                    for t_ in ('town', 'cdp')},
            },
        },
        'counties': counties,
        'places': places,
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
    print(f"64 counties: {m['call_counts']}; rent edge {m['rent_edge_counts']}; "
          f"places {m['places']['call_counts']}; wrote {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
