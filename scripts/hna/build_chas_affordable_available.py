#!/usr/bin/env python3
"""
build_chas_affordable_available.py — renter homes that are affordable AND
available to each income group, from HUD CHAS Tables 15C and 14B.

A home is "affordable and available" to households at or below an income
limit when its rent is affordable at that limit and it is either vacant for
rent or already rented by a household at or below the limit. Homes that are
cheap enough but rented by higher-income households do not count: nobody in
the group can move into them. This is the measure HUD's Worst Case Needs
reports and the National Low Income Housing Coalition's "Gap" use.

    households_minus_available(T) = renter households <= T
        - (occupied homes affordable at T rented by households <= T
           + vacant-for-rent homes affordable at T)

Tiers are cumulative (<= 50% includes <= 30%). CHAS has no 60% tier.

homes_short(T) is HUD's tier shortfall, max(0, households_minus_available(T)).

homes_short_nested(T) is this site's rule, not HUD's: the largest
households_minus_available at T or any tier inside it, floored at 0. A
wider tier adds homes that rent above what the lower-income households can
pay, and those homes cannot close the lower tier's shortfall, so it never
shows fewer homes short than a tier it contains. (HUD's figure does: in 34
of 64 counties the <= 50% one is below the <= 30% one.) The Deal
Calculator shows it, and says so.

Statewide figures are computed from the Colorado totals, like any other
geography, so its shortfall equals its households minus its homes.

HUD blocks automated downloads (every request returns HTTP 202 with an
empty body), so the national CSVs are downloaded by hand from
https://www.huduser.gov/portal/datasets/cp.html (County 050 and Place 160
zips) and their Colorado rows are kept under data/hna/source/chas/<vintage>/:

    python3 scripts/hna/build_chas_affordable_available.py --extract DIR
        DIR holds county-050-Table15C.csv, county-050-Table14B.csv,
        place-160-Table15C.csv and place-160-Table14B.csv (national).
    python3 scripts/hna/build_chas_affordable_available.py
        builds data/hna/chas_affordable_available.json from the extracts.

Column layout (checked here on every row, because the files carry no labels):
  Table 15C, renter-occupied homes: est1 total; est2 homes not split by rent
  (lacking complete kitchen or plumbing); est3 the rest. Four rent blocks
  start at est4, est25, est46, est67: rent affordable at <=30%, 30-50%,
  50-80% and >80% of HUD Area Median Family Income (HAMFI). Inside a block,
  household-income subtotals sit at +1, +5, +9, +13, +17 (<=30%, 30-50%,
  50-80%, 80-100%, >100% HAMFI), each followed by three bedroom-size cells.
  Table 14B, vacant for rent: est1 total; est2 not split; est3 the rest;
  rent subtotals at est4, est8, est12, est16 (same rent tiers), each
  followed by three bedroom-size cells.
HUD rounds every cell, so subtotals may differ from their parts by a few
units; the checks allow ROUNDING_TOLERANCE.
"""

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
VINTAGE = '2018thru2022'
VINTAGE_LABEL = '2018-2022'
SOURCE_DIR = os.path.join(REPO_ROOT, 'data', 'hna', 'source', 'chas', VINTAGE)
OUT_FILE = os.path.join(REPO_ROOT, 'data', 'hna', 'chas_affordable_available.json')
GEO_CONFIG = os.path.join(REPO_ROOT, 'data', 'hna', 'geo-config.json')
PHANTOM_ALIAS = os.path.join(REPO_ROOT, 'data', 'hna', 'place-phantom-aliases.json')
COLORADO = '08'
FILES = ('county-050-Table15C.csv', 'county-050-Table14B.csv',
         'place-160-Table15C.csv', 'place-160-Table14B.csv')

RENT_BLOCKS = (4, 25, 46, 67)
INCOME_OFFSETS = (1, 5, 9, 13, 17)
VACANT_RENT = (4, 8, 12, 16)
TIERS = (('30', 1), ('50', 2), ('80', 3))
ROUNDING_TOLERANCE = 25


def extract(national_dir):
    os.makedirs(SOURCE_DIR, exist_ok=True)
    for name in FILES:
        src = os.path.join(national_dir, name)
        with open(src, newline='', encoding='latin-1') as fh:
            reader = csv.reader(fh)
            header = next(reader)
            st = header.index('st')
            rows = [r for r in reader if r[st] == COLORADO]
        if not rows:
            sys.exit(f'{src}: no Colorado rows')
        if any(r[0] != VINTAGE for r in rows):
            sys.exit(f'{src}: rows are not vintage {VINTAGE}')
        dst = os.path.join(SOURCE_DIR, name)
        with open(dst, 'w', newline='', encoding='utf-8') as fh:
            w = csv.writer(fh, lineterminator='\n')
            w.writerow(header)
            w.writerows(rows)
        print(f'{dst}: {len(rows)} Colorado rows')


def read(name, prefix):
    out = {}
    with open(os.path.join(SOURCE_DIR, name), newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            est = {}
            for k, v in r.items():
                if k.startswith(prefix + '_est'):
                    est[int(k[len(prefix) + 4:])] = int(float(v))
            out[r['geoid'].split('US', 1)[1]] = (r['name'], est)
    return out


def near(a, b):
    return abs(a - b) <= ROUNDING_TOLERANCE


def compute(geoid, t15, t14):
    if not near(t15[2] + t15[3], t15[1]) or not near(sum(t15[b] for b in RENT_BLOCKS), t15[3]):
        raise ValueError(f'{geoid}: Table 15C rent blocks do not add up; layout changed?')
    for b in RENT_BLOCKS:
        if not near(sum(t15[b + o] for o in INCOME_OFFSETS), t15[b]):
            raise ValueError(f'{geoid}: Table 15C income cells in block {b} do not add up')
    if not near(t14[2] + t14[3], t14[1]) or not near(sum(t14[b] for b in VACANT_RENT), t14[3]):
        raise ValueError(f'{geoid}: Table 14B rent cells do not add up; layout changed?')
    occupied = [[t15[b + o] for o in INCOME_OFFSETS] for b in RENT_BLOCKS]  # [rent][income]
    vacant = [t14[b] for b in VACANT_RENT]
    households = [sum(occupied[r][i] for r in range(4)) for i in range(5)]
    tiers = {}
    worst = 0
    for tier, k in TIERS:
        hh = sum(households[:k])
        rented = sum(occupied[r][i] for r in range(k) for i in range(k))
        vac = sum(vacant[:k])
        aa = rented + vac
        worst = max(worst, hh - aa)
        tiers[tier] = {
            'renter_households': hh,
            'affordable_available_homes': aa,
            'occupied_by_group': rented,
            'vacant_for_rent': vac,
            'households_minus_available': hh - aa,
            'homes_short': max(0, hh - aa),
            'homes_short_nested': worst,
            # None, never 0, when there is nobody in the group to divide by.
            'homes_per_100_households': round(100 * aa / hh, 1) if hh > 0 else None,
        }
    return {
        'renter_homes_not_split_by_rent': t15[2],
        'vacant_for_rent_not_split_by_rent': t14[2],
        'tiers': tiers,
    }


def total(records):
    keys = ('renter_households', 'affordable_available_homes', 'occupied_by_group', 'vacant_for_rent')
    out = {'renter_homes_not_split_by_rent': sum(r['renter_homes_not_split_by_rent'] for r in records),
           'vacant_for_rent_not_split_by_rent': sum(r['vacant_for_rent_not_split_by_rent'] for r in records),
           'tiers': {}}
    worst = 0
    for tier, _ in TIERS:
        t = {k: sum(r['tiers'][tier][k] for r in records) for k in keys}
        t['households_minus_available'] = t['renter_households'] - t['affordable_available_homes']
        worst = max(worst, t['households_minus_available'])
        t['homes_short'] = max(0, t['households_minus_available'])
        t['homes_short_nested'] = worst
        t['homes_per_100_households'] = (round(100 * t['affordable_available_homes'] / t['renter_households'], 1)
                                         if t['renter_households'] > 0 else None)
        out['tiers'][tier] = t
    return out


def site_place_key():
    """CHAS GEOID -> the GEOID the site uses. A few places carry a different
    GEOID on the site (data/hna/place-phantom-aliases.json); a record whose
    CHAS GEOID is not on the site but whose alias is, is filed under the alias."""
    with open(GEO_CONFIG, encoding='utf-8') as fh:
        geo = json.load(fh)
    site = {p['geoid'] for p in geo['places'] + geo['cdps']}
    with open(PHANTOM_ALIAS, encoding='utf-8') as fh:
        aliases = json.load(fh)['aliases']
    return lambda g: aliases[g] if g not in site and aliases.get(g) in site else g


def build():
    groups = {}
    place_key = site_place_key()
    for level, width in (('county', 5), ('place', 7)):
        t15 = read(f'{level}-{"050" if level == "county" else "160"}-Table15C.csv', 'T15C')
        t14 = read(f'{level}-{"050" if level == "county" else "160"}-Table14B.csv', 'T14B')
        if set(t15) != set(t14):
            sys.exit(f'{level}: Tables 15C and 14B cover different geographies')
        recs = {}
        for g in sorted(t15):
            if len(g) != width:
                sys.exit(f'{level}: unexpected GEOID {g}')
            rec = {'name': t15[g][0].replace(', Colorado', '')}
            key = place_key(g) if level == 'place' else g
            if key != g:
                rec['chas_geoid'] = g
            rec.update(compute(g, t15[g][1], t14[g][1]))
            if key in recs:
                sys.exit(f'{level}: two CHAS rows map to {key}')
            recs[key] = rec
        groups[level] = recs
    if len(groups['county']) != 64:
        sys.exit(f'expected 64 Colorado counties, got {len(groups["county"])}')
    statewide = total(list(groups['county'].values()))
    statewide['name'] = 'Colorado'
    doc = {
        'meta': {
            'source': 'HUD CHAS (Comprehensive Housing Affordability Strategy), Tables 15C and 14B',
            'url': 'https://www.huduser.gov/portal/datasets/cp.html',
            'vintage': VINTAGE_LABEL,
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'builder': 'scripts/hna/build_chas_affordable_available.py',
            'source_extracts': f'data/hna/source/chas/{VINTAGE}/',
            'income_basis': 'HUD Area Median Family Income (HAMFI) for each area, adjusted for household size',
            'tiers': {'30': 'at or below 30% HAMFI', '50': 'at or below 50% HAMFI (includes <=30%)',
                      '80': 'at or below 80% HAMFI (includes <=50%)'},
            'method': ('Affordable and available homes at a tier = homes whose rent is affordable at the tier and '
                       'that are vacant for rent or rented by a household at or below the tier. households_minus_available = '
                       'renter households at or below the tier minus those homes; homes_short = that, floored at 0 '
                       '(HUD). homes_short_nested (this site, not HUD) = the largest households_minus_available at '
                       'the tier or any tier inside it, floored at 0: homes that rent above what lower-income '
                       'households can pay cannot close their shortfall. Statewide is computed from the sum of the '
                       '64 counties\' households and homes. Homes lacking a complete kitchen or plumbing are not split by rent '
                       'in CHAS and are left out of both sides. Small places carry wide margins of error.'),
            'county_count': len(groups['county']),
            'place_count': len(groups['place']),
        },
        'statewide': statewide,
        'counties': groups['county'],
        'places': groups['place'],
    }
    with open(OUT_FILE, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    s = statewide['tiers']
    print(f'{OUT_FILE}: {len(groups["county"])} counties, {len(groups["place"])} places; '
          f'statewide <=30% {s["30"]["homes_per_100_households"]} per 100, short {s["30"]["homes_short"]:,}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--extract', metavar='DIR', help='keep the Colorado rows of the national CSVs in DIR first')
    args = ap.parse_args()
    if args.extract:
        extract(args.extract)
    build()
