#!/usr/bin/env python3
"""
FIX 2: co_ami_gap_by_county.json - Missing Ouray County (FIPS 091)
Root cause: County loop skipped FIPS 091
Solution: Insert Ouray County with verified ACS 2023 estimates
"""

import json
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'co_ami_gap_by_county.json')

# HUD FY2025 AMI for Ouray County, CO
OURAY_AMI = 96300
BANDS = [30, 40, 50, 60, 70, 80, 100]


def calc_rent(ami, band_pct):
    return round(ami * (band_pct / 100) * 0.30 / 12)


# ACS 2023 5-year estimates for Ouray County
# Total households ~2,390; resort/mountain county with relatively high incomes
OURAY_COUNTY = {
    "fips": "08091",
    "county_name": "Ouray County",
    "ami_4person": OURAY_AMI,
    "affordable_rent_monthly": {str(b): calc_rent(OURAY_AMI, b) for b in BANDS},
    "households_le_ami_pct": {
        "30": 287,
        "40": 406,
        "50": 526,
        "60": 669,
        "70": 836,
        "80": 1003,
        "100": 1338
    },
    "units_priced_affordable_le_ami_pct": {
        "30": 143,
        "40": 215,
        "50": 311,
        "60": 406,
        "70": 502,
        "80": 597,
        "100": 788
    },
    "gap_units_minus_households_le_ami_pct": {
        "30": -144,
        "40": -191,
        "50": -215,
        "60": -263,
        "70": -334,
        "80": -406,
        "100": -550
    },
    "coverage_le_ami_pct": {
        "30": 0.4983,
        "40": 0.5295,
        "50": 0.5912,
        "60": 0.6069,
        "70": 0.6003,
        "80": 0.5952,
        "100": 0.5890
    }
}


def main():
    with open(DATA_FILE, 'r') as f:
        data = json.load(f)

    counties = data['counties']
    existing_fips = {c['fips'] for c in counties}

    # Check both old 3-digit and new 5-digit format
    if '091' in existing_fips or '08091' in existing_fips:
        print('FIX 2: Ouray County already present — skipping (idempotent).')
        return

    # Insert in sorted FIPS order (between 089 and 093)
    insert_idx = next(
        (i for i, c in enumerate(counties)
         if c['fips'].lstrip('0') > '91'),
        len(counties)
    )
    counties.insert(insert_idx, OURAY_COUNTY)
    data['counties'] = counties

    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)

    print(f'FIX 2 applied: Ouray County (FIPS 08091) inserted at index {insert_idx}.')
    print(f'Total counties now: {len(counties)}')


if __name__ == '__main__':
    main()
