#!/usr/bin/env python3
"""
validate_qct_dda_co.py — Schema validation for the normalised QCT/DDA file
===========================================================================
Validates: data/market/qct_dda_designations_co_normalized.json

Exit codes:
  0 — all checks passed
  1 — one or more validation errors found

Run after normalize_qct_dda_co.py to confirm the output is map-ready.
"""

import json
import os
import sys

PATH = os.path.join(os.path.dirname(__file__), '..', '..',
                    'data', 'market', 'qct_dda_designations_co_normalized.json')

REQUIRED_META_KEYS = ['source', 'state_fips', 'designation_year',
                      'normalized_at', 'tract_count']
REQUIRED_TRACT_KEYS = ['geoid', 'county_fips', 'state_fips', 'tract_code',
                       'designation', 'year', 'is_qct', 'is_dda']
VALID_DESIGNATIONS = {'QCT', 'DDA', 'BOTH'}


def err(msg: str):
    print(f'  ✗ {msg}', file=sys.stderr)


def ok(msg: str):
    print(f'  ✓ {msg}')


def validate(data: dict) -> int:
    errors = 0

    # ── Meta ─────────────────────────────────────────────────────────────────
    meta = data.get('meta', {})
    for k in REQUIRED_META_KEYS:
        if k not in meta:
            err(f'meta missing key: {k}')
            errors += 1
    if meta.get('state_fips') != '08':
        err(f'meta.state_fips should be "08", got {meta.get("state_fips")!r}')
        errors += 1
    else:
        ok('meta.state_fips = "08"')

    # ── Tracts ───────────────────────────────────────────────────────────────
    tracts = data.get('tracts', [])
    ok(f'{len(tracts)} tracts found')

    seen_geoids = set()
    for i, t in enumerate(tracts):
        for k in REQUIRED_TRACT_KEYS:
            if k not in t:
                err(f'tract[{i}] missing key: {k}')
                errors += 1

        geoid = t.get('geoid', '')
        if len(str(geoid)) != 11:
            err(f'tract[{i}] geoid must be 11 chars: {geoid!r}')
            errors += 1

        county_fips = t.get('county_fips', '')
        if len(str(county_fips)) != 5:
            err(f'tract[{i}] county_fips must be 5 chars: {county_fips!r}')
            errors += 1

        if t.get('designation') not in VALID_DESIGNATIONS:
            err(f'tract[{i}] unknown designation: {t.get("designation")!r}')
            errors += 1

        if geoid in seen_geoids:
            err(f'duplicate geoid: {geoid}')
            errors += 1
        seen_geoids.add(geoid)

    if errors == 0:
        ok('All tract records are valid')

    # ── Counties ─────────────────────────────────────────────────────────────
    counties = data.get('counties', {})
    ok(f'{len(counties)} county entries found')
    for fips, county in counties.items():
        if len(str(fips)) != 5:
            err(f'county key must be 5-char FIPS: {fips!r}')
            errors += 1
            break

    return errors


def main() -> int:
    print(f'Validating: {PATH}')
    if not os.path.exists(PATH):
        print(f'ERROR: file not found: {PATH}', file=sys.stderr)
        return 1

    with open(PATH, encoding='utf-8') as fh:
        data = json.load(fh)

    errors = validate(data)

    if errors:
        print(f'\n❌ {errors} validation error(s) found.', file=sys.stderr)
        return 1

    print('\n✅ Validation passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
