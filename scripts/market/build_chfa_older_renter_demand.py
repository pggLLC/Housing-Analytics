#!/usr/bin/env python3
"""Build the older-adult renter inputs for CHFA's older-adult capture rate.

CHFA's Market Study Guide (2027-2028 QAP, Appendix A, "Older Adult, New
Construction and Acquisition/Rehabilitation", printed page 85) bases demand
for an age-restricted project on:
  * "The number of estimated renter households that will be residing within
    the primary market area at the current time with a householder age of 62
    or older";
  * tenants paying no more than 40 percent of income for the maximum Housing
    Tax Credit rent;
  * "One or two-bedroom units have no more than two occupants";
and its demand table (page 87) starts from "One- and two-person older adult
households".

This file has the same shape as data/market/chfa_renter_demand_co.json, so
the same engine (PMAMarketScoring.chfaQualifiedRenters) counts it:
  1. tracts[geoid] = [puma, lte30, 31to50, 51to80, 81to100, 100plus]: HUD
     CHAS 2018-2022 Table 7 renter households of the "elderly family" type
     (two persons, either or both 62 or over) plus the "elderly non-family"
     type (a householder 62 or over living alone or with non-relatives), by
     HAMFI tier. tracts_moe[geoid] carries each tier's margin of error (90%,
     the two types combined as the root of the sum of squares).
  2. pumas[puma][size][bin]: ACS 2020-2024 PUMS renter households (TEN 3 or
     4) whose householder is 62 or older (HHLDRAGEP) and of one or two
     people, by income as a percent of the size-adjusted AMI (CHFA 2024
     limits, as the family file). Rows for three or more people are zero:
     CHFA counts one- and two-person older-adult households only.
The PUMA limits, county limits, tract-to-PUMA match and two-person split are
copied from the family file, so both counts use the same scales.

Usage:
    python3 scripts/market/build_chfa_older_renter_demand.py \
        --chas-zip .cache/chas_140_csv.zip --pums psam_h08.csv
Sources:
    https://www.huduser.gov/portal/datasets/cp/2018thru2022-140-csv.zip (Table 7)
    https://www2.census.gov/programs-surveys/acs/data/pums/2024/5-Year/csv_hco.zip
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FAMILY = ROOT / 'data/market/chfa_renter_demand_co.json'
OUT = ROOT / 'data/market/chfa_older_renter_demand_co.json'

MAX_BIN = 120
SIZES = 6
OLDER_AGE = 62
CHAS_TIERS = ('lte30', '31to50', '51to80', '81to100', '100plus')
# CHAS Table 7: renter blocks by HAMFI tier start at these columns; inside a
# block, +0 is the tier total, +1 elderly family, +13 elderly non-family
# (HUD CHAS 2018-2022 data dictionary, Table 7).
RENTER_TIER_COL = (109, 130, 151, 172, 193)
ELDERLY_FAMILY, ELDERLY_NONFAMILY = 1, 13


def chas_older(zip_path: Path) -> tuple[dict, dict]:
    est, moe = {}, {}
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith('table7.csv'))
        with z.open(name) as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding='latin-1')):
                gid = row['geoid'][-11:]
                if not gid.startswith('08'):
                    continue
                e, m = [], []
                for c in RENTER_TIER_COL:
                    cols = (c + ELDERLY_FAMILY, c + ELDERLY_NONFAMILY)
                    e.append(sum(float(row[f'T7_est{k}'] or 0) for k in cols))
                    m.append(math.sqrt(sum(float(row[f'T7_moe{k}'] or 0) ** 2 for k in cols)))
                est[gid], moe[gid] = e, m
    return est, moe


def pums_older(pums: Path, puma_lim50: dict[str, list[float]]) -> tuple[dict, dict]:
    matrix = {p: [[0.0] * (MAX_BIN + 2) for _ in range(SIZES)] for p in puma_lim50}
    cases = defaultdict(int)
    with pums.open() as f:
        for row in csv.DictReader(f):
            if row['TYPEHUGQ'] != '1' or row['TEN'] not in ('3', '4'):
                continue
            puma = row['PUMA']
            if puma not in matrix:
                continue
            np_ = int(row['NP'] or 0)
            age = int(row['HHLDRAGEP'] or 0)
            if np_ not in (1, 2) or age < OLDER_AGE:
                continue
            income = float(row['HINCP'] or 0) * float(row['ADJINC']) / 1e6
            pct = max(0.0, income / puma_lim50[puma][np_ - 1] * 50.0)
            b = MAX_BIN + 1 if pct > MAX_BIN else int(pct)
            matrix[puma][np_ - 1][b] += float(row['WGTP'])
            cases[puma] += 1
    return matrix, dict(cases)


def build(chas_zip: Path, pums: Path) -> dict:
    fam = json.loads(FAMILY.read_text())
    lim = {p: [float(v) for v in row] for p, row in fam['puma_lim50_2024'].items()}
    est, moe = chas_older(chas_zip)
    matrix, cases = pums_older(pums, lim)
    tracts, tracts_moe = {}, {}
    for gid, row in fam['tracts'].items():
        # The family file's tracts (CHAS tracts with a PUMA); a tract CHAS
        # reports with no older renters is a measured zero.
        if gid in est:
            tracts[gid] = [row[0]] + [round(v) for v in est[gid]]
            tracts_moe[gid] = [round(v) for v in moe[gid]]
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {
        'meta': {
            'title': 'Older-adult renter households for CHFA\'s older-adult capture rate',
            'method': ('Qualified older-adult renters for a unit = sum over CHAS income tiers of (tract CHAS elderly renter households '
                       'in the tier) x (share of PUMS one- and two-person renter households with a householder 62 or older, in the '
                       'tier, in the tract\'s PUMA, whose income is between the 40%-of-income rent floor and the AMI limit).'),
            'rules_source': ('CHFA Housing Tax Credit Qualified Allocation Plan 2027-2028 (adopted 25 September 2026, approved by the '
                             'Governor 23 October 2026), Appendix A Market Study Guide: "Older Adult, New Construction and '
                             'Acquisition/Rehabilitation" (printed page 85) and the Older Adult Independent Living demand table (page 87)'),
            'rules': [
                'Renter households with a householder 62 or older (CHFA, page 85).',
                'Rent no more than 40 percent of income (page 85).',
                'One- or two-bedroom units with no more than two occupants; one- and two-person older-adult households (pages 85, 87).',
                'Compared with existing age-restricted tax credit homes only; project-based Section 8 and assisted living left out (page 85).',
                'In-migration only when demonstrated from comparable projects, with supporting information (page 86).',
            ],
            'reading': ('CHFA defines older-adult projects as "over the age of 55 or 62" (page 3) but names only a 62+ householder count '
                        'for demand; a 55+ project is counted the same way here. That is COHO\'s reading, not a quoted rule.'),
            'sources': {
                'chas': {'name': 'HUD CHAS 2018-2022, Table 7, renter households of the elderly family and elderly non-family types by HAMFI tier',
                         'vintage': '2018-2022', 'url': 'https://www.huduser.gov/portal/datasets/cp.html'},
                'pums': {'name': 'Census ACS 2020-2024 5-year PUMS, Colorado housing file (HHLDRAGEP 62+, NP 1-2, TEN 3 or 4)',
                         'vintage': '2020-2024', 'url': 'https://www2.census.gov/programs-surveys/acs/data/pums/2024/5-Year/csv_hco.zip'},
                'limits_for_pums': fam['meta']['sources']['limits_for_pums'],
            },
            'chas_types': ('CHAS "elderly family" = two persons, either or both 62 or over; "elderly non-family" = a householder 62 or '
                           'over, alone or with non-relatives. In a few elderly-family households the householder is under 62.'),
            'tract_layout': 'tracts[geoid] = [puma, lte30, 31to50, 51to80, 81to100, 100plus]; tracts_moe[geoid] = 90% margins, same tiers',
            'pums_layout': 'pumas[puma][size 1..6+][bin]; only sizes 1 and 2 are filled; bin i = income i% to i+1% of the size-adjusted AMI; last bin above 120%',
            'pums_cases': cases,
            'limitations': ('PUMS gives the income mix of older renters only by PUMA, so tracts in a PUMA share it; CHAS tract counts '
                            'carry wide margins (tracts_moe). CHAS is 2018-2022; PUMS is 2020-2024.'),
            'as_of': now[:10],
            'generated': now,
            'review_by': '2027-12-31',
            'generator': 'scripts/market/build_chfa_older_renter_demand.py',
        },
        'pumas': {p: [[round(v) for v in row] for row in m] for p, m in sorted(matrix.items())},
        'tracts': dict(sorted(tracts.items())),
        'tracts_moe': dict(sorted(tracts_moe.items())),
        'puma_lim50_2024': fam['puma_lim50_2024'],
        'county_lim50_2024': fam['county_lim50_2024'],
        'two_person_split': fam.get('two_person_split'),
        'size_values': [1, 2, 3, 4, 5, 6],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chas-zip', type=Path, default=ROOT / '.cache/chas_140_csv.zip')
    ap.add_argument('--pums', type=Path, required=True)
    ap.add_argument('--out', type=Path, default=OUT)
    a = ap.parse_args()
    payload = build(a.chas_zip, a.pums)
    a.out.write_text(json.dumps(payload, separators=(',', ':')))
    print(f'wrote {a.out} ({len(payload["pumas"])} PUMAs, {len(payload["tracts"])} tracts)')


if __name__ == '__main__':
    main()
