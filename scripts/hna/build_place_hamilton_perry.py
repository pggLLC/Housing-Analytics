#!/usr/bin/env python3
"""Build data/hna/place-hamilton-perry.json: towns' people by age, Hamilton-Perry.

The Scenario Builder gives a town or CDP a share of its county's forecast. By
default that is the share the HNA page uses, one number for every age and
every year. Hamilton-Perry, the standard method for places too small for a
full cohort-component forecast, lets the share differ by age and move over
time. It needs only two censuses by age and sex:

  cohort-change ratio = people aged a+10 to a+14 in 2020
                        / people aged a to a+4 in 2010
  (85+ in 2020 / 75+ in 2010 for the last group)

and carries each ratio forward a decade at a time: 2020's people aged a to
a+4, times the ratio, are the people aged a+10 to a+14 in 2030, and so on to
2050. Children under 10 come from child-woman ratios: children aged 0-4 per
woman aged 15-44 in 2020 (5-9 per woman 20-49), times the women projected.
Each sex runs separately. Where a town had no one in a group in 2010, its
county's ratio stands in.

The same arithmetic runs for every county, and the builder takes a town's
share of its county's people in each age group from the two: the town's
projection over its counties'. Applied to the county's scenario, that share
gives the town's people and, at the county's households per person, its
households. No town's figures are added up to the county here, and nothing
here replaces SDO's county forecast.

Hamilton-Perry carries 2010-2020 forward, and repeats it each decade. A
town that grew by half or more in that decade (Windsor, Monument, Erie), or
annexed land, would keep doing so and outgrow any county forecast: Windsor
would pass 100,000 people by 2044. So a town is left out (with its two
counts, for the builder to say why) unless its 2020 population was between
two-thirds and one and a half times its 2010 population. Towns new in 2020
have no 2010 count and are left out too.

Source: U.S. Census Bureau, 2010 Census Summary File 1 and 2020 Census
Demographic and Housing Characteristics File, table P12 (sex by age), for
Colorado places and counties, from data.census.gov. Cached at
data/hna/source/census_age_2010_2020.json; --fetch refreshes the cache.

    python3 scripts/hna/build_place_hamilton_perry.py [--fetch]

js/projections/cohort-component-model.js reads the output (townShares);
test/hamilton-perry-option.test.js checks it.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, 'data', 'hna', 'source', 'census_age_2010_2020.json')
OUT = os.path.join(ROOT, 'data', 'hna', 'place-hamilton-perry.json')

API = 'https://data.census.gov/api/access/data/table?id={table}&g=040XX00US08${level}'
TABLES = {2010: ('DECENNIALSF12010.P12', 'P012{:03d}'), 2020: ('DECENNIALDHC2020.P12', 'P12_{:03d}N')}
LEVELS = {'place': '1600000', 'county': '0500000'}

# Table P12's 23 age cells for each sex (male 3-25, female 27-49), combined
# into the 19 groups kept in the cache. 15-17 and 18-19 stay apart so the
# builder's 18-24 group can be formed.
CACHE_GROUPS = ['0-4', '5-9', '10-14', '15-17', '18-19', '20-24', '25-29', '30-34', '35-39',
                '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70-74', '75-79',
                '80-84', '85+']
CELLS = [[0], [1], [2], [3], [4], [5, 6, 7], [8], [9], [10], [11], [12], [13], [14],
         [15, 16], [17, 18], [19], [20], [21], [22]]
MALE_FIRST, FEMALE_FIRST = 3, 27

# The Census Bureau gave these places new codes in 2020; each 2020 code takes
# the 2010 counts of the code it replaced. Castle Pines North city is today's
# Castle Pines city, and the 2010 Castle Pines CDP is today's Castle Pines
# Village CDP.
CODE_2010 = {
    '0812387': '0812390',  # Castle Pines city <- Castle Pines North city
    '0812393': '0812387',  # Castle Pines Village CDP <- Castle Pines CDP
    '0858785': '0858758',  # Phippsburg CDP
    '0882900': '0882905',  # Watkins CDP
}

YEARS = [2020, 2030, 2040, 2050]
OUT_GROUPS = ['0-17', '18-24', '25-44', '45-64', '65+']
MIN_RATIO, MAX_RATIO = 2 / 3, 1.5  # 2020 population / 2010, to be offered


def fetch():
    """Download table P12 for both censuses and cache it, 19 groups by sex."""
    cache = {'source': 'U.S. Census Bureau, 2010 Census Summary File 1 and 2020 Census DHC, table P12 (sex by age)',
             'retrieved': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
             'groups': CACHE_GROUPS, 'place': {}, 'county': {}}
    for kind, level in LEVELS.items():
        for year, (table, col) in TABLES.items():
            url = API.format(table=table, level=level)
            # data.census.gov refuses Python's default User-Agent.
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (COHO Analytics build)'})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)['response']['data']
            head = data[0]
            gi, ni = head.index('GEO_ID'), head.index('NAME')
            idx = {n: head.index(col.format(n)) for n in range(1, 50)}
            for row in data[1:]:
                geoid = row[gi].split('US')[1]
                rec = cache[kind].setdefault(geoid, {})
                rec['name'] = row[ni].replace(', Colorado', '')  # 2020's, fetched last
                sexes = {}
                for sex, first in (('male', MALE_FIRST), ('female', FEMALE_FIRST)):
                    sexes[sex] = [sum(int(row[idx[first + c]]) for c in cells) for cells in CELLS]
                if sum(sexes['male']) + sum(sexes['female']) != int(row[idx[1]]):
                    sys.exit(f'{year} {geoid}: ages do not add to the total')
                rec[str(year)] = sexes
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, 'w') as f:
        json.dump(cache, f, separators=(',', ':'))
        f.write('\n')
    print(f'Cached {len(cache["place"])} places and {len(cache["county"])} counties to {CACHE}')


def five_year(sexes):
    """18 five-year groups (0-4 .. 80-84, 85+) by sex; 15-19 is 15-17 + 18-19."""
    out = {}
    for sex, g in sexes.items():
        out[sex] = g[:3] + [g[3] + g[4]] + g[5:]
    return out


def ratios(g10, g20, fallback=None):
    """Cohort-change and child-woman ratios by sex. A ratio whose 2010 (or
    2020 women's) count is zero takes the fallback's, or 1 for a county."""
    def pick(num, den, sex, key):
        if den > 0:
            return num / den
        return fallback[sex][key] if fallback else 1.0
    out = {}
    w20 = g20['female']
    women_15_44, women_20_49 = sum(w20[3:9]), sum(w20[4:10])
    for sex in ('male', 'female'):
        a, b = g10[sex], g20[sex]
        r = {}
        for k in range(2, 17):
            r[k] = pick(b[k], a[k - 2], sex, k)
        r[17] = pick(b[17], a[15] + a[16] + a[17], sex, 17)
        r[0] = pick(b[0], women_15_44, sex, 0)
        r[1] = pick(b[1], women_20_49, sex, 1)
        out[sex] = r
    return out


def project(g20, r):
    """2020, 2030, 2040, 2050 people by five-year group and sex."""
    rows = [g20]
    for _ in YEARS[1:]:
        prev = rows[-1]
        nxt = {}
        for sex in ('male', 'female'):
            p, q = prev[sex], r[sex]
            g = [0.0] * 18
            for k in range(2, 17):
                g[k] = p[k - 2] * q[k]
            g[17] = (p[15] + p[16] + p[17]) * q[17]
            nxt[sex] = g
        women = nxt['female']
        for sex in ('male', 'female'):
            nxt[sex][0] = r[sex][0] * sum(women[3:9])
            nxt[sex][1] = r[sex][1] * sum(women[4:10])
        rows.append(nxt)
    return rows


def out_groups(g, split_15_17):
    """The builder's five groups from 18 five-year groups (both sexes)."""
    t = [g['male'][k] + g['female'][k] for k in range(18)]
    return [
        sum(t[0:3]) + t[3] * split_15_17,
        t[3] * (1 - split_15_17) + t[4],
        sum(t[5:9]),
        sum(t[9:13]),
        sum(t[13:18]),
    ]


def run(rec, fallback=None):
    g10, g20 = five_year(rec['2010']), five_year(rec['2020'])
    r = ratios(g10, g20, fallback)
    teens = sum(rec['2020'][s][3] + rec['2020'][s][4] for s in ('male', 'female'))
    split = (sum(rec['2020'][s][3] for s in ('male', 'female')) / teens) if teens else 0.6
    return r, [[round(v, 1) for v in out_groups(g, split)] for g in project(g20, r)]


def main():
    if '--fetch' in sys.argv:
        fetch()
    with open(CACHE) as f:
        cache = json.load(f)

    counties, county_ratios = {}, {}
    for fips, rec in sorted(cache['county'].items()):
        county_ratios[fips], counties[fips] = run(rec)

    with open(os.path.join(ROOT, 'data', 'hna', 'geo-config.json')) as f:
        geo = json.load(f)
    home = {p['geoid']: p.get('containingCounty') for p in geo['places'] + geo['cdps']}

    # The site keys a few places by a code other than the Census Bureau's
    # (Central City: 0812900 here, 0812910 in the census tables).
    with open(os.path.join(ROOT, 'data', 'hna', 'place-phantom-aliases.json')) as f:
        aliases = json.load(f)['aliases']

    places, left_out = {}, {}
    for census_id, rec in sorted(cache['place'].items()):
        geoid = census_id if census_id in home else aliases.get(census_id, census_id)
        old = cache['place'].get(CODE_2010.get(census_id, census_id), {})
        if '2020' not in rec or '2010' not in old or geoid not in home:
            if '2020' in rec and geoid in home:
                left_out[geoid] = {'name': rec['name'], 'reason': 'new_in_2020'}
            continue
        p10 = sum(old['2010']['male']) + sum(old['2010']['female'])
        p20 = sum(rec['2020']['male']) + sum(rec['2020']['female'])
        if not p10 or not (MIN_RATIO <= p20 / p10 <= MAX_RATIO):
            left_out[geoid] = {'name': rec['name'], 'reason': 'changed_too_much', 'population2010': p10, 'population2020': p20}
            continue
        both = {'2010': old['2010'], '2020': rec['2020']}
        # A zero in the town's 2010 counts takes its home county's ratio.
        _, people = run(both, county_ratios.get(home[geoid]))
        places[geoid] = {'name': rec['name'], 'people': people}

    out = {
        'source': cache['source'] + ', data.census.gov',
        'method': 'Hamilton-Perry: 2010-2020 cohort-change ratios by five-year age group and sex, '
                  'child-woman ratios under 10, carried forward a decade at a time',
        'years': YEARS,
        'groups': OUT_GROUPS,
        'offeredWhen': '2020 population between two-thirds and 1.5 times 2010',
        'counties': {k: {'name': cache['county'][k]['name'], 'people': v} for k, v in counties.items()},
        'places': places,
        'leftOut': left_out,
    }
    # One geography to a line: small, and a rebuild's diff reads by place.
    lines = []
    for key, value in out.items():
        if isinstance(value, dict) and key in ('counties', 'places', 'leftOut'):
            inner = ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v, separators=(",", ":"))}' for k, v in value.items())
            lines.append(f' {json.dumps(key)}: {{\n{inner}\n }}')
        else:
            lines.append(f' {json.dumps(key)}: {json.dumps(value)}')
    with open(OUT, 'w') as f:
        f.write('{\n' + ',\n'.join(lines) + '\n}\n')
    print(f'{len(places)} places with Hamilton-Perry, {len(left_out)} left out -> {OUT}')


if __name__ == '__main__':
    main()
