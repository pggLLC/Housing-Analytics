#!/usr/bin/env python3
"""Build data/hud-home-rent-limits-co-<year>.json from HUD's HOME rent workbook.

HUD publishes the HOME Program Rent Limits once a year as one national
workbook (HOME_Limits_Rents_<year>.xlsx). huduser.gov answers scripted
requests with an empty HTTP 202, so the workbook is downloaded by hand in a
browser (docs/runbooks/home-rent-limits-refresh.md) and passed to this script.

    python3 scripts/build_home_rent_limits_co.py path/to/HOME_Limits_Rents_2026.xlsx

Only Colorado rows are kept. Every value is copied from the workbook; nothing
is computed. The test checks HUD's own "lesser of" rules against the copied
values, so a misread column fails it.
"""
import datetime
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
COLORADO_STATE_FIPS = 8

# Effective dates are stated in each year's HUD memo, not in the workbook.
EFFECTIVE_DATES = {2026: '2026-06-01'}

BEDROOMS = ['0', '1', '2', '3', '4', '5', '6']
SERIES = {
    'high_home': 'highrent',
    'low_home': 'lowrent',
    'fmr': 'fmr',
    'rent_65_ami': 'homerent65',
    'rent_50_ami': 'homerent50',
}


def required_int(row, key, county):
    value = row.get(key)
    if not isinstance(value, (int, float)) or value <= 0:
        raise SystemExit(f'{county}: {key} is {value!r}; refusing to write an unusable limit')
    return int(value)


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1])
    match = re.search(r'HOME_Limits_Rents_(\d{4})\.xlsx$', src.name)
    if not match:
        raise SystemExit(f'expected HOME_Limits_Rents_<year>.xlsx, got {src.name}')
    year = int(match.group(1))
    if year not in EFFECTIVE_DATES:
        raise SystemExit(f'add the {year} effective date from HUD\'s memo to EFFECTIVE_DATES')

    sheet = openpyxl.load_workbook(src, read_only=True).worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    header = next(rows)
    colorado = [dict(zip(header, r)) for r in rows if r[header.index('state')] == COLORADO_STATE_FIPS]

    counties = {}
    for row in colorado:
        fips = f"08{int(row['county']):03d}"
        name = row['county_name']
        record = {
            'county': name,
            'hud_area_code': row['cbsasub'],
            'hud_area_name': row['areaname'],
        }
        for out_key, prefix in SERIES.items():
            record[out_key] = {br: required_int(row, f'{prefix}_{br}', name) for br in BEDROOMS}
        counties[fips] = record

    if len(counties) != 64:
        raise SystemExit(f'expected 64 Colorado counties, found {len(counties)}')

    out = {
        'meta': {
            'source': f'HUD HOME Program Rent Limits, {year}',
            'publisher': 'U.S. Department of Housing and Urban Development (PD&R for CPD)',
            'source_page': 'https://www.huduser.gov/portal/datasets/HOME-Rent-limits.html',
            'source_file': f'https://www.huduser.gov/portal/datasets/home-datasets/files/{src.name}',
            'source_memo': f'https://www.huduser.gov/portal/datasets/home-datasets/files/{year}-HOME-RentLimits-Memo.pdf',
            'fiscal_year': year,
            'effective_date': EFFECTIVE_DATES[year],
            'retrieved': datetime.date.today().isoformat(),
            'geography': 'Colorado counties (5-digit FIPS); each county carries its HUD FMR area',
            'bedrooms': BEDROOMS,
            'rent_basis': (
                'Gross rent: the limit covers rent plus the utility allowance for any '
                'tenant-paid utilities (24 CFR 92.252).'
            ),
            'rules': {
                'high_home': 'Lesser of the FMR and 30% of income at 65% AMI (NAHA section 215).',
                'low_home': '30% of income at 50% AMI, capped by the High HOME rent.',
            },
            'not_included': (
                'HOME income limits, the lesser-of-HOME-and-LIHTC rule for mixed projects, '
                'and SRO limits are not in this file.'
            ),
        },
        'counties': dict(sorted(counties.items())),
    }
    dest = ROOT / 'data' / f'hud-home-rent-limits-co-{year}.json'
    dest.write_text(json.dumps(out, indent=2) + '\n')
    print(f'wrote {dest.relative_to(ROOT)}: {len(counties)} counties, FY{year}')


if __name__ == '__main__':
    main()
