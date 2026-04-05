#!/usr/bin/env python3
"""
FIX 1: co_ami_gap_by_county.json - Statewide null AMI + empty rent bands
Root cause: Statewide record generated before HUD Income Limits lookup resolved
Solution: Set ami_4person = 107,200 (HUD FY2025 Colorado state-level) and calculate rent bands
"""

import json
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'co_ami_gap_by_county.json')
AMI_STATEWIDE = 107200
BANDS = [30, 40, 50, 60, 70, 80, 100]


def calc_rent(ami, band_pct):
    """Standard HUD affordable rent formula: (AMI × band% × 30%) / 12"""
    return round(ami * (band_pct / 100) * 0.30 / 12)


def fix_statewide(data):
    statewide = data['statewide']
    if statewide['ami_4person'] is not None and statewide['affordable_rent_monthly']:
        print('Statewide record already populated — skipping (idempotent).')
        return False

    statewide['ami_4person'] = AMI_STATEWIDE
    statewide['affordable_rent_monthly'] = {
        str(b): calc_rent(AMI_STATEWIDE, b) for b in BANDS
    }
    print(f'Set statewide ami_4person={AMI_STATEWIDE}')
    print('Rent bands:', statewide['affordable_rent_monthly'])
    return True


def main():
    with open(DATA_FILE, 'r') as f:
        data = json.load(f)

    changed = fix_statewide(data)

    if changed:
        with open(DATA_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        print('FIX 1 applied: statewide AMI and rent bands written.')
    else:
        print('FIX 1: no changes needed.')


if __name__ == '__main__':
    main()
