#!/usr/bin/env python3
"""Renter homes by building age and size, for every Colorado county, place and tract.

Source: Census American Community Survey 2020-2024 5-year estimates, table B25127
(tenure by year structure built by units in structure), read from the Census
table-based summary file. No API key is needed.

Why: unsubsidized older rentals (often called naturally occurring affordable
housing) are not on any public list. The closest public measure is how many
renter households live in older small and mid-size apartment buildings. This
file counts them, with margins of error, so a page can say how sure each
number is. Owner households are not counted here.

Margins of error for sums use the Census approximation: the square root of the
sum of squared margins. A count is marked reliable when its coefficient of
variation, (MOE / 1.645) / estimate, is 30% or less. The 30% line is this
file's rule, not a Census rule; Census publishes the margins and leaves the
threshold to the user.

Usage:
  python3 scripts/market/build_acs_older_rentals_co.py [--dat path/to/acsdt5y2024-b25127.dat]
"""
from __future__ import annotations

import argparse
import io
import json
import math
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / 'data/market/acs_older_rentals_co.json'
DAT_URL = ('https://www2.census.gov/programs-surveys/acs/summary_file/2024/'
           'table-based-SF/data/5YRData/acsdt5y2024-b25127.dat')
SHELLS_URL = ('https://www2.census.gov/programs-surveys/acs/summary_file/2024/'
              'table-based-SF/documentation/ACS20245YR_Table_Shells.txt')

# Renter-occupied lines of B25127 (table shell, 2024 5-year). Each era lists its
# lines for: 1 unit, 2-4, 5-19, 20-49, 50 or more, mobile home or other.
RENTER_TOTAL = 45
ERAS = {
    'built_2020_later': 46,
    'built_2000_2019': 53,
    'built_1980_1999': 60,
    'built_1960_1979': 67,
    'built_1940_1959': 74,
    'built_1939_earlier': 81,
}
SIZES = ['one_unit', 'two_to_four', 'five_to_19', 'twenty_to_49', 'fifty_plus', 'mobile_other']
OLD_ERAS = ['built_1960_1979', 'built_1940_1959', 'built_1939_earlier']
CV_LIMIT = 0.30

GROUPS = {
    'renter_total': 'All renter-occupied homes',
    'older_small_mid_pre1980': 'Renter homes in buildings of 2 to 49 homes built before 1980',
    'small_mid_1980_1999': 'Renter homes in buildings of 2 to 49 homes built 1980 to 1999',
    'older_large_pre1980': 'Renter homes in buildings of 50 or more homes built before 1980',
    'mobile_other_renter': 'Renter homes in mobile homes, boats, RVs or vans, any year',
    'single_unit_pre1980': 'Renter homes in one-unit houses built before 1980',
}


def line(era_start, size):
    return era_start + 1 + SIZES.index(size)


def group_lines():
    g = {'renter_total': [RENTER_TOTAL]}
    g['older_small_mid_pre1980'] = [line(ERAS[e], s) for e in OLD_ERAS for s in ('two_to_four', 'five_to_19', 'twenty_to_49')]
    g['small_mid_1980_1999'] = [line(ERAS['built_1980_1999'], s) for s in ('two_to_four', 'five_to_19', 'twenty_to_49')]
    g['older_large_pre1980'] = [line(ERAS[e], 'fifty_plus') for e in OLD_ERAS]
    g['mobile_other_renter'] = [line(ERAS[e], 'mobile_other') for e in ERAS]
    g['single_unit_pre1980'] = [line(ERAS[e], 'one_unit') for e in OLD_ERAS]
    return g


def num(v):
    if v in (None, '', 'null', 'N'):
        return None
    try:
        n = float(v)
    except ValueError:
        return None
    return n if math.isfinite(n) and n >= 0 else None


def summarise(row, lines):
    ests = [num(row.get('B25127_E%03d' % n)) for n in lines]
    moes = [num(row.get('B25127_M%03d' % n)) for n in lines]
    if any(e is None for e in ests):
        return None
    est = sum(ests)
    if any(m is None for m in moes):
        # An unpublished margin is unknown, never zero: no MOE, no CV, never reliable.
        return {'est': int(round(est)), 'moe': None, 'cv': None, 'reliable': False,
                'moe_note': 'Census did not publish a margin for at least one part of this count'}
    moe = math.sqrt(sum(m ** 2 for m in moes))
    cv = (moe / 1.645) / est if est > 0 else None
    return {'est': int(round(est)), 'moe': int(round(moe)), 'cv': None if cv is None else round(cv, 3),
            'reliable': bool(cv is not None and cv <= CV_LIMIT)}


def read_rows(dat):
    text = dat.read_text() if dat else urllib.request.urlopen(DAT_URL, timeout=600).read().decode('utf-8')
    f = io.StringIO(text)
    header = f.readline().strip().split('|')
    for raw in f:
        if 'US08' not in raw[:14]:
            continue
        vals = raw.rstrip('\n').split('|')
        yield dict(zip(header, vals))


def build(dat=None):
    groups = group_lines()
    out = {'meta': {
        'source': 'Census American Community Survey 2020-2024 5-year estimates, table B25127 (tenure by year structure built by units in structure)',
        'source_url': DAT_URL,
        'table_shell_url': SHELLS_URL,
        'vintage': '2020-2024',
        'acs_year': 2024,
        'tenure': 'renter-occupied homes only',
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'generator': 'scripts/market/build_acs_older_rentals_co.py',
        'groups': GROUPS,
        'moe_method': 'Sums use the square root of the sum of squared margins (Census approximation, 90% level).',
        'reliability_rule': 'reliable = coefficient of variation (MOE/1.645/estimate) of 30% or less; this file\'s rule, not a Census rule.',
        'limits': [
            'Counts renter households by the age and size of the building they live in; it does not say what rent they pay or whether a home is restricted.',
            'Census size bins are 5-19, 20-49 and 50 or more homes, and age bins end in 1979 and 1999, so they do not line up exactly with the HB24-1175 right of first offer (15 to 100 homes, over 30 years old).',
            'Small towns often have margins larger than the count; use the reliable flag before comparing places.',
        ],
    }, 'counties': {}, 'places': {}, 'tracts': {}}
    for row in read_rows(dat):
        gid = row['GEO_ID']
        summ, geo = gid[:3], gid.split('US', 1)[1]
        key = {'050': 'counties', '160': 'places', '140': 'tracts'}.get(summ)
        if not key or not geo.startswith('08'):
            continue
        rec = {g: summarise(row, lines) for g, lines in groups.items()}
        out[key][geo] = rec
    for k in ('counties', 'places', 'tracts'):
        out['meta'][k + '_count'] = len(out[k])
        out[k] = dict(sorted(out[k].items()))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dat', type=Path, help='a local copy of acsdt5y2024-b25127.dat')
    a = ap.parse_args()
    data = build(a.dat)
    OUT.write_text(json.dumps(data, separators=(',', ':')) + '\n')
    m = data['meta']
    print(f"wrote {OUT.relative_to(REPO_ROOT)}: {m['counties_count']} counties, {m['places_count']} places, {m['tracts_count']} tracts")


if __name__ == '__main__':
    main()
