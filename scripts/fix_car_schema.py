#!/usr/bin/env python3
"""Fix 5: Normalise field names in car-market.json to match report schema.

Root cause: car-market.json uses legacy field names:
              median_price, median_dom, price_per_sqft
            But CAR report files use canonical names:
              median_sale_price, median_days_on_market, median_price_per_sqft
Impact:     JS functions silently get undefined for mismatched fields.
Solution:   Rename to canonical schema, preserve deprecated names as legacy
            aliases (prefixed with _legacy_).
"""

import json
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'car-market.json')

# Map from legacy field name → canonical field name
FIELD_RENAMES = {
    'median_price': 'median_sale_price',
    'median_dom': 'median_days_on_market',
    'price_per_sqft': 'median_price_per_sqft',
}


def fix_car_schema(data_file: str = DATA_FILE) -> None:
    with open(data_file) as f:
        data = json.load(f)

    renamed = 0
    for legacy_key, canonical_key in FIELD_RENAMES.items():
        if legacy_key in data and canonical_key not in data:
            value = data.pop(legacy_key)
            data[canonical_key] = value
            data[f'_legacy_{legacy_key}'] = value
            renamed += 1
            print(f'  Renamed: {legacy_key} → {canonical_key} (value={value})')
        elif legacy_key in data and canonical_key in data:
            # Both exist — keep canonical, add legacy alias
            data[f'_legacy_{legacy_key}'] = data.pop(legacy_key)
            renamed += 1
            print(f'  Aliased: {legacy_key} → _legacy_{legacy_key} '
                  f'(canonical {canonical_key} already present)')
        elif canonical_key in data:
            print(f'  {canonical_key} already canonical, skipping')
        else:
            print(f'  WARNING: neither {legacy_key} nor {canonical_key} found')

    with open(data_file, 'w') as f:
        json.dump(data, f, indent=2, separators=(',', ': '))
        f.write('\n')

    print(f'fix_car_schema: processed {renamed} field renames')


if __name__ == '__main__':
    fix_car_schema()
