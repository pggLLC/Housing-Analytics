#!/usr/bin/env python3
"""Fix 7: Add 35 missing counties + flag 2025 as preliminary in lihtc-trends-by-county.json.

Root cause: 35 rural counties absent (zero LIHTC activity in 2015-2025),
            2025 data treated as final (actually preliminary — HUD YR_PIS lags 12-24 months).
Impact:     County trend chart selector shows blank for 35 selections;
            2025 treated as final data rather than preliminary.
Solution:   Insert zero-count records for missing counties;
            flag 2025 as preliminary with YR_PIS lag note.
"""

import json
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'lihtc-trends-by-county.json')

# All 64 Colorado counties
ALL_COLORADO_COUNTIES = [
    'Adams', 'Alamosa', 'Arapahoe', 'Archuleta', 'Baca', 'Bent', 'Boulder',
    'Broomfield', 'Chaffee', 'Cheyenne', 'Clear Creek', 'Conejos', 'Costilla',
    'Crowley', 'Custer', 'Delta', 'Denver', 'Dolores', 'Douglas', 'Eagle',
    'El Paso', 'Elbert', 'Fremont', 'Garfield', 'Gilpin', 'Grand', 'Gunnison',
    'Hinsdale', 'Huerfano', 'Jackson', 'Jefferson', 'Kiowa', 'Kit Carson',
    'La Plata', 'Lake', 'Larimer', 'Las Animas', 'Lincoln', 'Logan', 'Mesa',
    'Mineral', 'Moffat', 'Montezuma', 'Montrose', 'Morgan', 'Otero', 'Ouray',
    'Park', 'Phillips', 'Pitkin', 'Prowers', 'Pueblo', 'Rio Blanco',
    'Rio Grande', 'Routt', 'Saguache', 'San Juan', 'San Miguel', 'Sedgwick',
    'Summit', 'Teller', 'Washington', 'Weld', 'Yuma',
]


def fix_lihtc_trends(data_file: str = DATA_FILE) -> None:
    with open(data_file) as f:
        data = json.load(f)

    years = data.get('years', [])
    counties = data.get('counties', {})

    # Step 1: Add missing counties with zero counts
    added = 0
    for county in ALL_COLORADO_COUNTIES:
        if county not in counties:
            counties[county] = {str(y): 0 for y in years}
            added += 1

    data['counties'] = counties

    # Step 2: Flag 2025 as preliminary
    data['preliminary_years'] = [2025]
    data['preliminary_note'] = (
        'Data for 2025 is preliminary. HUD LIHTC YR_PIS (Year Placed in Service) '
        'database typically lags 12-24 months; 2025 values reflect incomplete reporting.'
    )

    # Update the existing note to reinforce this
    existing_note = data.get('note', '')
    if '2025' not in existing_note:
        data['note'] = (
            existing_note.rstrip('.') +
            '. 2025 data is preliminary (YR_PIS lag; see preliminary_note).'
        )

    with open(data_file, 'w') as f:
        json.dump(data, f, indent=2, separators=(',', ': '))
        f.write('\n')

    total_counties = len(data['counties'])
    print(f'fix_lihtc_trends: added {added} missing counties '
          f'(total now {total_counties}); flagged 2025 as preliminary')


if __name__ == '__main__':
    fix_lihtc_trends()
