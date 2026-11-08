#!/usr/bin/env python3
"""Build the renter-household inputs for a CHFA-style capture rate.

CHFA's Market Study Guide (QAP Appendix A, "Demand Analysis") counts renter
households that could rent each proposed unit:
  * income no higher than the unit's AMI limit for the household's size;
  * income high enough that the maximum Housing Tax Credit gross rent is no
    more than 40 percent of income;
  * household no larger than the unit allows (1BR up to 2 people, 2BR up to
    3, 3BR up to 5).

No public table crosses renter income by household size at tract level, so
this file carries two published pieces the page combines:
  1. HUD CHAS 2018-2022 renter households by income tier for each tract
     (from data/market/chas_tract_co.json).
  2. For each 2020 PUMA, ACS 2020-2024 PUMS renter households by household
     size and income as a percent of the area's size-adjusted median (1-point
     bins, 0-120%, plus one bin above 120%). Incomes are in 2024 dollars
     (ADJINC) and are placed against CHFA's 2024 income limits, so both sides
     of the ratio come from the same year. A PUMA that spans counties uses
     the renter-weighted limits of its counties.

The page multiplies each tract's CHAS tier count by the share of that tier's
PUMS renters who meet the rules above for the proposed unit. Bins are in
percent of the PUMA's renter-weighted limit; the file also carries each
PUMA's and each county's 2024 50% limits, so the page can move a county's
cut-offs (CHAS tiers, rent floor, AMI limit) onto the PUMA's scale where a
PUMA spans counties with different limits.

Usage:
    python3 scripts/market/build_chfa_renter_demand.py \
        --pums psam_h08.csv --tract-puma 2020_Census_Tract_to_2020_PUMA.txt \
        --limits-2024 chfa-income-rent-limits-2024.json
    # bedroom inputs only (two-person split, 6+ size), counts untouched:
    python3 scripts/market/build_chfa_renter_demand.py --pums psam_h08.csv --bedroom-inputs-only
    # student share (college-only households), counts untouched:
    python3 scripts/market/build_chfa_renter_demand.py --pums psam_h08.csv --persons psam_p08.csv --student-inputs-only
Sources:
    https://www2.census.gov/programs-surveys/acs/data/pums/2024/5-Year/csv_hco.zip
    https://www2.census.gov/programs-surveys/acs/data/pums/2024/5-Year/csv_pco.zip (person file, students)
    https://www2.census.gov/geo/docs/maps-data/data/rel2020/2020_Census_Tract_to_2020_PUMA.txt
    https://www.chfainfo.com/getattachment/32e3fe74-40b0-445a-bb45-c35d23241acf/2024-Rent-and-income-limits.pdf
      (parsed with scripts/fetch_chfa_limits.py, YEAR=2024)
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHAS_TRACTS = ROOT / 'data/market/chas_tract_co.json'
ACS_TRACTS = ROOT / 'data/market/acs_tract_metrics_co.json'
OUT = ROOT / 'data/market/chfa_renter_demand_co.json'

MAX_BIN = 120          # 1-point bins 0..120; index 121 holds everything above 120%
SIZES = 6              # household size 1..5, index 5 holds 6 or more people
CHAS_TIERS = ('lte30', '31to50', '51to80', '81to100', '100plus')
# Two-person renters at 20-60% AMI: share living in a studio or one-bedroom
# (PUMS BDSP 0-1) against two or more bedrooms, for each PUMA from its own
# sample. Small samples are noisy, so each PUMA's share is blended with the
# statewide share as if the state added this many sample households:
# share = (n * own + K * state) / (n + K). A PUMA with 50 cases is half its
# own share, one with 150 is three quarters.
SPLIT_AMI = (20.0, 60.0)
SPLIT_PRIOR_CASES = 50


def load_tract_puma(path: Path) -> dict[str, str]:
    out = {}
    with path.open(encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            if row['STATEFP'] == '08':
                out['08' + row['COUNTYFP'] + row['TRACTCE']] = row['PUMA5CE']
    return out


def load_limits(path: Path) -> dict[str, list[float]]:
    """County FIPS -> 50% AMI income limit for 1..8 people (CHFA, same year as PUMS dollars)."""
    data = json.loads(path.read_text())
    out = {}
    for c in data['counties']:
        lim = c['regular_tiers']['50']['income_limits']
        out[c['fips']] = [float(lim[f'{n}p']) for n in range(1, 9)]
    return out


def bedroom_inputs(pums: Path, puma_lim50: dict[str, list[float]]) -> dict:
    """Two-person bedroom split and the mean size of 6+ person renter households.

    The page counts a two-person household partly toward a one-bedroom and
    partly toward a two-bedroom, in the shares two-person renters at 20-60%
    AMI in the market's own PUMA actually live in (ACS PUMS BDSP), blended
    with the statewide share where the local sample is small, instead of all
    toward the smallest unit that fits. The 6+ mean lets the page match a market area's ACS
    average renter household size.
    """
    small = defaultdict(float)
    total = defaultdict(float)
    cases = defaultdict(int)
    by_br = [0.0] * 4
    big_people = big_hh = 0.0
    with pums.open() as f:
        for row in csv.DictReader(f):
            if row['TYPEHUGQ'] != '1' or row['TEN'] not in ('3', '4'):
                continue
            puma = row['PUMA']
            if puma not in puma_lim50:
                continue
            np_ = int(row['NP'] or 0)
            wt = float(row['WGTP'])
            if np_ >= SIZES:
                big_people += wt * np_
                big_hh += wt
            if np_ != 2:
                continue
            income = float(row['HINCP'] or 0) * float(row['ADJINC']) / 1e6
            pct = max(0.0, income / puma_lim50[puma][1] * 50.0)
            if not (SPLIT_AMI[0] <= pct <= SPLIT_AMI[1]):
                continue
            br = min(int(row['BDSP'] or 0), 3)
            by_br[br] += wt
            total[puma] += wt
            cases[puma] += 1
            if br <= 1:
                small[puma] += wt
    state_total = sum(by_br)
    state_share = (by_br[0] + by_br[1]) / state_total
    pumas = {}
    for p in sorted(puma_lim50):
        n = cases[p]
        own = small[p] / total[p] if total[p] > 0 else state_share
        weight = n / (n + SPLIT_PRIOR_CASES)
        pumas[p] = [round(weight * own + (1 - weight) * state_share, 3), n, round(weight, 2), round(own, 3)]
    return {
        'two_person_split': {
            'statewide_small_share': round(state_share, 3),
            'statewide_cases': sum(cases.values()),
            'statewide_by_bedrooms': {k: round(v / state_total, 3) for k, v in zip(('studio', '1br', '2br', '3plus'), by_br)},
            'prior_cases': SPLIT_PRIOR_CASES,
            'ami_range': list(SPLIT_AMI),
            'layout': ('pumas[puma] = [share used, sample households, weight on the PUMA\'s own share, the PUMA\'s own share]; '
                       'share used = weight * own + (1 - weight) * statewide, weight = n / (n + prior_cases)'),
            'pumas': pumas,
            'source': ('Census ACS 2020-2024 5-year PUMS, Colorado housing file: renter households (TEN 3 or 4) of two people '
                       'with income 20-60% of the size-adjusted AMI (CHFA 2024 limits), by bedrooms (BDSP)'),
        },
        'size_values': [1, 2, 3, 4, 5, round(big_people / big_hh, 2)],
    }


# College enrolment in the PUMS person file: SCHG 15 = undergraduate,
# 16 = graduate or professional school.
COLLEGE_GRADES = ('15', '16')
CHAS_TIER_PCT = ((0, 30), (30, 50), (50, 80), (80, 100), (100, float('inf')))


def student_inputs(pums: Path, persons: Path, puma_lim50: dict[str, list[float]]) -> dict:
    """Share of renter households in which everyone is enrolled in college.

    Tax credit homes generally cannot go to a household made up only of
    full-time students. The ACS records college enrolment but not full- or
    part-time status, or the program's exceptions, so this share is an upper
    bound. Kept per PUMA, household size and CHAS income tier, because
    student households sit mostly at low incomes and small sizes.
    """
    all_college = {}
    with persons.open() as f:
        for row in csv.DictReader(f):
            key = row['SERIALNO']
            enrolled = row.get('SCHG', '') in COLLEGE_GRADES
            all_college[key] = all_college.get(key, True) and enrolled
    hh = defaultdict(lambda: [[0.0] * len(CHAS_TIER_PCT) for _ in range(SIZES)])
    st = defaultdict(lambda: [[0.0] * len(CHAS_TIER_PCT) for _ in range(SIZES)])
    state_hh = state_st = 0.0
    with pums.open() as f:
        for row in csv.DictReader(f):
            if row['TYPEHUGQ'] != '1' or row['TEN'] not in ('3', '4'):
                continue
            puma = row['PUMA']
            np_ = int(row['NP'] or 0)
            if puma not in puma_lim50 or np_ < 1:
                continue
            income = float(row['HINCP'] or 0) * float(row['ADJINC']) / 1e6
            pct = max(0.0, income / puma_lim50[puma][min(np_, 8) - 1] * 50.0)
            k = next(i for i, (lo, hi) in enumerate(CHAS_TIER_PCT) if pct < hi)
            wt = float(row['WGTP'])
            s = min(np_, SIZES) - 1
            hh[puma][s][k] += wt
            state_hh += wt
            if all_college.get(row['SERIALNO']):
                st[puma][s][k] += wt
                state_st += wt
    shares = {p: [[round(st[p][s][k] / hh[p][s][k], 3) if hh[p][s][k] > 0 else 0
                   for k in range(len(CHAS_TIER_PCT))] for s in range(SIZES)]
              for p in sorted(puma_lim50)}
    return {'student_share': {
        'statewide_share': round(state_st / state_hh, 4),
        'layout': 'pumas[puma][size 1..6+][CHAS tier lte30, 31to50, 51to80, 81to100, 100plus] = share of renter households in which every member is enrolled in college',
        'definition': 'Every household member attends college (PUMS SCHG 15 undergraduate or 16 graduate). ACS has no full-time flag and the program exceptions (married joint filers, single parents, job training, former foster youth) are not identified, so the share is an upper bound.',
        'pumas': shares,
        'source': 'Census ACS 2020-2024 5-year PUMS, Colorado housing and person files (TEN 3 or 4; SCHG)',
    }}


def build(pums: Path, tract_puma_path: Path, limits_path: Path) -> dict:
    tract_puma = load_tract_puma(tract_puma_path)
    limits = load_limits(limits_path)
    acs = json.loads(ACS_TRACTS.read_text())
    acs_rows = acs.get('tracts', acs)
    if isinstance(acs_rows, dict):
        acs_rows = list(acs_rows.values())
    renters = {r['geoid']: (r.get('renter_hh') or 0) for r in acs_rows}

    # Renter-weighted 50% limits for each PUMA.
    weight = defaultdict(float)
    lim_sum = defaultdict(lambda: [0.0] * 8)
    for tract, puma in tract_puma.items():
        w = renters.get(tract, 0)
        county = tract[:5]
        if w <= 0 or county not in limits:
            continue
        weight[puma] += w
        for i, v in enumerate(limits[county]):
            lim_sum[puma][i] += w * v
    puma_lim50 = {p: [v / weight[p] for v in lim_sum[p]] for p in weight}

    matrix = {p: [[0.0] * (MAX_BIN + 2) for _ in range(SIZES)] for p in puma_lim50}
    with pums.open() as f:
        for row in csv.DictReader(f):
            if row['TYPEHUGQ'] != '1' or row['TEN'] not in ('3', '4'):
                continue
            puma = row['PUMA']
            if puma not in matrix:
                continue
            np_ = int(row['NP'] or 0)
            if np_ < 1:
                continue
            income = float(row['HINCP'] or 0) * float(row['ADJINC']) / 1e6
            lim50 = puma_lim50[puma][min(np_, 8) - 1]
            pct = max(0.0, income / lim50 * 50.0)
            b = MAX_BIN + 1 if pct > MAX_BIN else int(pct)
            matrix[puma][min(np_, SIZES) - 1][b] += float(row['WGTP'])

    chas = json.loads(CHAS_TRACTS.read_text())
    tracts = {}
    for rec in chas['records']:
        gid = rec['tract_geoid']
        puma = tract_puma.get(gid)
        tiers = rec.get('renter_hh_by_ami') or {}
        counts = [int((tiers.get(t) or {}).get('total') or 0) for t in CHAS_TIERS]
        # A tract CHAS reports with zero renters in every tier is a measured
        # zero, not missing data: keep it so the page can say no one qualifies.
        if puma and tiers:
            tracts[gid] = [puma] + counts

    extra = bedroom_inputs(pums, puma_lim50)
    return {
        'meta': {
            'title': 'Renter households for a CHFA-style capture rate',
            'method': ('Qualified renters for a unit = sum over CHAS income tiers of (tract CHAS renter households in the tier) '
                       'x (share of PUMS renter households in that tier, in the tract\'s PUMA, whose size fits the unit and whose '
                       'income is between the 40%-of-income rent floor and the AMI limit). Rules from CHFA QAP Appendix A, Market Study Guide.'),
            'rules_source': 'CHFA Housing Tax Credit Qualified Allocation Plan 2027-2028 (adopted by the CHFA Board 25 September 2026, approved by the Governor 23 October 2026), Appendix A Market Study Guide, section 7 Demand Analysis',
            'sources': {
                'chas': {'name': 'HUD CHAS 2018-2022, tract renter households by HAMFI tier', 'vintage': chas['meta'].get('vintage'), 'url': chas['meta'].get('url')},
                'pums': {'name': 'Census ACS 2020-2024 5-year PUMS, Colorado housing file', 'vintage': '2020-2024',
                         'url': 'https://www2.census.gov/programs-surveys/acs/data/pums/2024/5-Year/csv_hco.zip'},
                'tract_puma': {'name': 'Census 2020 tract to 2020 PUMA relationship file',
                               'url': 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/2020_Census_Tract_to_2020_PUMA.txt'},
                'limits_for_pums': {'name': 'CHFA 2024 income limits (50% AMI by household size), matching the 2024 dollars of PUMS incomes',
                                    'url': 'https://www.chfainfo.com/getattachment/32e3fe74-40b0-445a-bb45-c35d23241acf/2024-Rent-and-income-limits.pdf'},
            },
            'renters': 'PUMS TEN 3 (rented) or 4 (occupied without payment of rent); housing units only',
            'chas_tiers': list(CHAS_TIERS),
            'size_values': 'people counted for each PUMS size row when matching a market area\'s ACS average renter household size; the last is the statewide mean of 6+ person renter households',
            'pums_layout': 'pumas[puma][size 1..6+][bin]; bin i = income i% to i+1% of the size-adjusted AMI; last bin = above 120%; weights are PUMS household weights',
            'tract_layout': 'tracts[geoid] = [puma, lte30, 31to50, 51to80, 81to100, 100plus]',
            'limits_layout': 'puma_lim50_2024[puma] and county_lim50_2024[fips] = 50% AMI income limit for 1..8 people, 2024 dollars',
            'limitations': ('PUMS shows the mix of household size and income only at PUMA level (45 areas), so every tract in a PUMA shares '
                            'the within-tier mix; the tier counts themselves are the tract\'s own. CHAS is 2018-2022; PUMS is 2020-2024.'),
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'generator': 'scripts/market/build_chfa_renter_demand.py',
        },
        'pumas': {p: [[round(v) for v in row] for row in m] for p, m in sorted(matrix.items())},
        'tracts': dict(sorted(tracts.items())),
        'puma_lim50_2024': {p: [round(v) for v in puma_lim50[p]] for p in sorted(puma_lim50)},
        'county_lim50_2024': {f: [round(v) for v in limits[f]] for f in sorted(limits)},
        'two_person_split': extra['two_person_split'],
        'size_values': extra['size_values'],
    }


def add_bedroom_inputs(pums: Path, out: Path) -> dict:
    """Add the bedroom inputs to an existing file without rebuilding its counts."""
    payload = json.loads(out.read_text())
    lim = {p: [float(v) for v in row] for p, row in payload['puma_lim50_2024'].items()}
    payload.update(bedroom_inputs(pums, lim))
    payload['meta']['size_values'] = ('people counted for each PUMS size row when matching a market area\'s ACS average renter '
                                      'household size; the last is the statewide mean of 6+ person renter households')
    payload['meta']['bedroom_inputs_added'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pums', type=Path, required=True)
    ap.add_argument('--tract-puma', type=Path)
    ap.add_argument('--limits-2024', type=Path)
    ap.add_argument('--out', type=Path, default=OUT)
    ap.add_argument('--persons', type=Path, help='PUMS person file (psam_p08.csv), for the student share')
    ap.add_argument('--student-inputs-only', action='store_true',
                    help='add the student share to the existing file; counts unchanged (needs --persons)')
    ap.add_argument('--bedroom-inputs-only', action='store_true',
                    help='add the two-person split and size values to the existing file; counts unchanged')
    a = ap.parse_args()
    if a.student_inputs_only:
        if not a.persons:
            ap.error('--persons is required for --student-inputs-only')
        payload = json.loads(a.out.read_text())
        lim = {p: [float(v) for v in row] for p, row in payload['puma_lim50_2024'].items()}
        payload.update(student_inputs(a.pums, a.persons, lim))
        payload['meta']['student_inputs_added'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    elif a.bedroom_inputs_only:
        payload = add_bedroom_inputs(a.pums, a.out)
    else:
        if not (a.tract_puma and a.limits_2024):
            ap.error('--tract-puma and --limits-2024 are required for a full build')
        payload = build(a.pums, a.tract_puma, a.limits_2024)
    a.out.write_text(json.dumps(payload, separators=(',', ':')))
    print(f'wrote {a.out} ({len(payload["pumas"])} PUMAs, {len(payload["tracts"])} tracts)')


if __name__ == '__main__':
    main()
