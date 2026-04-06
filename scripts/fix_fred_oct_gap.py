#!/usr/bin/env python3
"""Fix 3: Interpolate October 2025 gap in 4 monthly FRED series.

Root cause: CPIAUCSL, CUUR0000SAH1, UNRATE, CIVPART jump from Sept 2025 → Nov 2025
            (October 2025 observation missing).
Impact:     Time-series charts show visible notch/break in data.
Solution:   Linear interpolation of Oct 2025 between Sept and Nov values.
"""

import json
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'fred-data.json')

GAP_SERIES = ['CPIAUCSL', 'CUUR0000SAH1', 'UNRATE', 'CIVPART']
OCT_DATE = '2025-10-01'
SEPT_DATE = '2025-09-01'
NOV_DATE = '2025-11-01'


def interpolate_oct_gap(data_file: str = DATA_FILE) -> None:
    with open(data_file) as f:
        data = json.load(f)

    series = data.get('series', {})
    fixed = 0

    for series_id in GAP_SERIES:
        if series_id not in series:
            print(f'WARNING: Series {series_id} not found')
            continue

        obs = series[series_id].get('observations', [])
        dates = [o['date'] for o in obs]

        if OCT_DATE in dates:
            print(f'  {series_id}: Oct 2025 already present, skipping')
            continue

        if SEPT_DATE not in dates or NOV_DATE not in dates:
            print(f'  {series_id}: Missing Sept or Nov 2025 anchor, cannot interpolate')
            continue

        sept_val = float(next(o['value'] for o in obs if o['date'] == SEPT_DATE))
        nov_val = float(next(o['value'] for o in obs if o['date'] == NOV_DATE))
        oct_val = (sept_val + nov_val) / 2.0

        # Insert the interpolated observation in sorted order
        oct_obs = {
            'date': OCT_DATE,
            'value': str(round(oct_val, 3)),
            'interpolated': True,
            'note': (
                'Linear interpolation between 2025-09-01 and 2025-11-01 '
                '(official Oct 2025 data pending from BLS/FRED)'
            ),
        }
        # Find insertion point
        insert_idx = next(
            (i for i, o in enumerate(obs) if o['date'] > OCT_DATE),
            len(obs)
        )
        obs.insert(insert_idx, oct_obs)
        series[series_id]['observations'] = obs
        fixed += 1
        print(f'  {series_id}: interpolated Oct 2025 = {oct_val:.3f} '
              f'(Sept={sept_val}, Nov={nov_val})')

    with open(data_file, 'w') as f:
        json.dump(data, f, indent=2, separators=(',', ': '))
        f.write('\n')

    print(f'fix_fred_oct_gap: fixed {fixed} series')


if __name__ == '__main__':
    interpolate_oct_gap()
