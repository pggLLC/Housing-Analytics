#!/usr/bin/env python3
"""
FIX 5: data/hna/dola_sya/*.json - pyramidYear=2030 (future year)
Root cause: All 64 DOLA SYA files have pyramidYear: 2030 (projection target year)
Solution: Correct pyramidYear from 2030 to 2024 (DOLA SYA data vintage)
"""

import json
import os
import glob

SYA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'hna', 'dola_sya')
OLD_YEAR = 2030
NEW_YEAR = 2024


def main():
    pattern = os.path.join(SYA_DIR, '*.json')
    files = sorted(glob.glob(pattern))

    if not files:
        print(f'FIX 5: No SYA files found in {SYA_DIR}')
        return

    changed = 0
    skipped = 0

    for fpath in files:
        with open(fpath, 'r') as f:
            data = json.load(f)

        if data.get('pyramidYear') == NEW_YEAR:
            skipped += 1
            continue

        if data.get('pyramidYear') == OLD_YEAR:
            data['pyramidYear'] = NEW_YEAR
            with open(fpath, 'w') as f:
                json.dump(data, f, indent=2)
            changed += 1
        else:
            print(f'  WARNING: {os.path.basename(fpath)} has unexpected pyramidYear={data.get("pyramidYear")} — skipped')

    if changed == 0 and skipped == len(files):
        print(f'FIX 5: All {len(files)} SYA files already have pyramidYear={NEW_YEAR} — skipping (idempotent).')
    else:
        print(f'FIX 5 applied: {changed} files updated from pyramidYear={OLD_YEAR} → {NEW_YEAR}.')
        if skipped:
            print(f'  {skipped} files already had pyramidYear={NEW_YEAR}.')


if __name__ == '__main__':
    main()
