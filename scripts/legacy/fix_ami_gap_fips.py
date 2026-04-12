#!/usr/bin/env python3
"""
FIX 3: co_ami_gap_by_county.json - 3-digit FIPS → 5-digit
Root cause: All county FIPS stored as 3-digit strings ("001") but GeoJSON uses 5-digit ("08001")
Solution: Normalize all county FIPS codes to 5-digit format by prefixing "08"
Note: statewide fips ("08") is left unchanged.
"""

import json
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'co_ami_gap_by_county.json')


def normalize_fips(fips_str):
    """Convert 3-digit Colorado county FIPS to 5-digit (prefix '08')."""
    if len(fips_str) == 3:
        return '08' + fips_str
    return fips_str  # already 5-digit or statewide "08"


def main():
    with open(DATA_FILE, 'r') as f:
        data = json.load(f)

    counties = data['counties']
    already_done = all(len(c['fips']) == 5 for c in counties)
    if already_done:
        print('FIX 3: All county FIPS already 5-digit — skipping (idempotent).')
        return

    changed = 0
    for county in counties:
        old = county['fips']
        new = normalize_fips(old)
        if old != new:
            county['fips'] = new
            changed += 1

    data['counties'] = counties

    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)

    print(f'FIX 3 applied: {changed} county FIPS codes normalized to 5-digit format.')
    print('Sample:', [c['fips'] for c in counties[:5]])


if __name__ == '__main__':
    main()
