#!/usr/bin/env python3
"""
Project-based voucher (PBV) homes by Colorado housing authority.

HUD's Picture of Subsidized Households (PSH) counts project-based vouchers
for each housing authority (program 3, sub_program "PBV, All"), but HUD
does not publish which buildings hold them. This file gives the site the
statewide and per-authority totals so the hand-checked PBV map layer
(data/affordable-housing/local-pha-roster/) can say how much it is missing.

Source: HUD Picture of Subsidized Households, PHA file, quarter ending
31 Dec 2025, 2020-census geography:
  https://www.huduser.gov/portal/datasets/assthsg.html
  https://www.huduser.gov/portal/datasets/pictures/files/PHA_2025_2020census.xlsx

total_units is HUD's "Number of units under contract for federal subsidy
and available for occupancy" (PSH 2025 data dictionary).

Usage:
  python3 scripts/build-pbv-by-pha.py path/to/PHA_2025_2020census.xlsx
"""
import json
import os
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'affordable-housing', 'pbv-by-pha-co.json')

DATASET_PAGE = 'https://www.huduser.gov/portal/datasets/assthsg.html'
FILE_URL = 'https://www.huduser.gov/portal/datasets/pictures/files/PHA_2025_2020census.xlsx'
DICTIONARY_URL = 'https://www.huduser.gov/portal/datasets/pictures/dictionary_2025.pdf'
RETRIEVED = '2026-10-23'


def num(v):
    # PSH codes -1 missing, -4 suppressed, -5 non-reporting.
    if v is None or (isinstance(v, (int, float)) and v < 0):
        return None
    return int(v)


def main(path):
    ws = openpyxl.load_workbook(path, read_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    head = list(next(rows))
    pbv, hcv, quarters = {}, {}, set()
    for r in rows:
        d = dict(zip(head, r))
        if not str(d['states']).startswith('CO') or d['program_label'] != 'Housing Choice Vouchers':
            continue
        quarters.add(d['Quarter'])
        if d['sub_program'] == 'N/A':
            hcv[d['code']] = num(d['total_units'])
        elif d['sub_program'] == 'PBV, All':
            pbv[d['code']] = d
    if quarters != {'31DEC2025'}:
        sys.exit('unexpected quarter(s): %s' % sorted(quarters))

    authorities = []
    for code, d in pbv.items():
        authorities.append({
            'code': code,
            'name': d['name'],
            'pbv_units': num(d['total_units']),
            'all_voucher_units': hcv.get(code),
        })
    authorities.sort(key=lambda a: -(a['pbv_units'] or 0))

    out = {
        'metadata': {
            'title': 'Project-based voucher homes by Colorado housing authority',
            'source': 'HUD Picture of Subsidized Households, PHA file (2020 census geography)',
            'source_url': DATASET_PAGE,
            'file_url': FILE_URL,
            'dictionary_url': DICTIONARY_URL,
            'as_of': '2025-12-31',
            'retrieved': RETRIEVED,
            'source_quote': 'total_units: "Number of units under contract for federal subsidy and available for occupancy" (PSH 2025 data dictionary); PBV rows are sub_program "PBV, All - Housing Choice Project-Based Vouchers, no breakdown".',
            'notes': [
                'HUD publishes project-based voucher counts by housing authority only. It does not publish which buildings hold them, so a full property map of Colorado PBVs is not possible from public data.',
                'all_voucher_units is the authority\'s Housing Choice Voucher total (tenant-based plus project-based) from the same file.',
                'Many PBV homes sit inside tax-credit or other properties already on the map under that program; the map does not mark them as PBV.',
                'Regenerate: python3 scripts/build-pbv-by-pha.py PHA_2025_2020census.xlsx',
            ],
        },
        'totals': {
            'authorities_with_pbv': len(authorities),
            'pbv_units': sum(a['pbv_units'] or 0 for a in authorities),
        },
        'authorities': authorities,
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, indent=2)
        f.write('\n')
    print('wrote %s: %d authorities, %d PBV homes' % (OUT, len(authorities), out['totals']['pbv_units']))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
