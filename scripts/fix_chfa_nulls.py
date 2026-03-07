#!/usr/bin/env python3
"""
FIX 4: data/chfa-lihtc.json - Null LI_UNITS, CREDIT, DDA, NON_PROF fields
Root cause: 78 of 716 CHFA LIHTC features (10.9%) have null values
Solution: Impute nulls defensively:
  - LI_UNITS null → copy N_UNITS (pre-1987: all units were LI)
  - CREDIT null → "4" (4% bond credit, HUD default for pre-1990)
  - NON_PROF null → "2" (for-profit sponsor, conservative default)
  - DDA null → "0" (not in DDA unless explicitly set to "1")
"""

import json
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'chfa-lihtc.json')


def fix_feature_nulls(props):
    """Impute null fields and fix data integrity issues. Returns True if any field was changed."""
    changed = False

    if props.get('LI_UNITS') is None:
        props['LI_UNITS'] = props.get('N_UNITS', 0)
        changed = True

    # Cap LI_UNITS at N_UNITS (data integrity: LI units cannot exceed total units)
    n_units = props.get('N_UNITS')
    li_units = props.get('LI_UNITS')
    if li_units is not None and n_units is not None and li_units > n_units:
        props['LI_UNITS'] = n_units
        changed = True

    if props.get('CREDIT') is None:
        props['CREDIT'] = '4'
        changed = True

    if props.get('NON_PROF') is None:
        props['NON_PROF'] = '2'
        changed = True

    if props.get('DDA') is None:
        props['DDA'] = '0'
        changed = True

    return changed


def main():
    with open(DATA_FILE, 'r') as f:
        data = json.load(f)

    features = data.get('features', [])
    total_changed = 0
    fields_imputed = {'LI_UNITS': 0, 'CREDIT': 0, 'NON_PROF': 0, 'DDA': 0}

    for feat in features:
        # Support both flat properties and nested properties key
        props = feat.get('properties') if 'properties' in feat else feat

        before = {k: props.get(k) for k in fields_imputed}
        fix_feature_nulls(props)
        after = {k: props.get(k) for k in fields_imputed}

        for field in fields_imputed:
            if before[field] is None and after[field] is not None:
                fields_imputed[field] += 1

        if any(before[k] != after[k] for k in fields_imputed):
            total_changed += 1

    if total_changed == 0:
        print('FIX 4: No null fields found — skipping (idempotent).')
        return

    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)

    print(f'FIX 4 applied: {total_changed} features updated.')
    for field, count in fields_imputed.items():
        if count:
            print(f'  {field}: {count} nulls imputed')


if __name__ == '__main__':
    main()
