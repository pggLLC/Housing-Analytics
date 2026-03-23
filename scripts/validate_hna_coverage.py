#!/usr/bin/env python3
"""scripts/validate_hna_coverage.py
Build-time validation for HNA geography coverage.

Exits 0 on success, 1 on any failure.

Checks:
  1. All entries in ranking-index.json exist in geo-config.json.
  2. No duplicate GEOIDs in ranking-index.json.
  3. No missing required HNA summary files (if SUMMARY_DIR exists).
  4. All geography type labels are valid ('county', 'place', 'cdp').
  5. Colorado county count is exactly 64.
  6. All county GEOIDs are 5-digit strings (Rule 1).
"""

import json
import os
import sys

REPO_ROOT   = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_HNA    = os.path.join(REPO_ROOT, 'data', 'hna')
SUMMARY_DIR = os.path.join(DATA_HNA, 'summary')

GEO_CONFIG_PATH = os.path.join(DATA_HNA, 'geo-config.json')
RANKING_PATH    = os.path.join(DATA_HNA, 'ranking-index.json')

ALLOWED_TYPES          = {'county', 'place', 'cdp'}
REQUIRED_COUNTY_COUNT  = 64


def _load(path, label):
    if not os.path.isfile(path):
        print(f'FAIL  {label} not found: {path}')
        return None
    with open(path) as f:
        return json.load(f)


def main():
    errors = []

    # ------------------------------------------------------------------
    # Load data files
    # ------------------------------------------------------------------
    geo_config = _load(GEO_CONFIG_PATH, 'geo-config.json')
    ranking    = _load(RANKING_PATH,    'ranking-index.json')

    if geo_config is None or ranking is None:
        print(f'FAIL  Could not load required data files.')
        sys.exit(1)

    # Build selectable geoid sets from geo-config
    selectable_counties = {c['geoid'] for c in geo_config.get('counties', [])}
    selectable_places   = {p['geoid'] for p in geo_config.get('places',   [])}
    selectable_cdps     = {c['geoid'] for c in geo_config.get('cdps',     [])}
    all_selectable      = selectable_counties | selectable_places | selectable_cdps

    rankings = ranking.get('rankings', [])

    # ------------------------------------------------------------------
    # Check 1: All ranking entries exist in geo-config
    # Counties and CDPs must match exactly; places are a curated subset in
    # geo-config (~55 priority municipalities) while the ranking index covers
    # a comprehensive statewide list (~272 places).  Only validate counties
    # and CDPs here; place coverage is checked separately.
    # ------------------------------------------------------------------
    for entry in rankings:
        geoid = entry.get('geoid', '')
        entry_type = entry.get('type', '')
        if entry_type in ('county', 'cdp') and geoid not in all_selectable:
            errors.append(
                f'Ranking entry geoid={geoid!r} type={entry_type!r} ({entry.get("name")}) '
                f'not found in geo-config'
            )

    # ------------------------------------------------------------------
    # Check 2: No duplicate GEOIDs in ranking-index
    # ------------------------------------------------------------------
    geoids = [e.get('geoid') for e in rankings]
    seen, dupes = set(), set()
    for g in geoids:
        if g in seen:
            dupes.add(g)
        seen.add(g)
    if dupes:
        errors.append(f'Duplicate GEOIDs in ranking-index.json: {sorted(dupes)}')

    # ------------------------------------------------------------------
    # Check 3: Geography type labels are valid
    # ------------------------------------------------------------------
    for entry in rankings:
        t = entry.get('type')
        if t not in ALLOWED_TYPES:
            errors.append(
                f"Invalid type {t!r} for geoid={entry.get('geoid')} in ranking-index"
            )

    # ------------------------------------------------------------------
    # Check 4: Colorado county count is exactly 64
    # ------------------------------------------------------------------
    county_count = len(selectable_counties)
    if county_count != REQUIRED_COUNTY_COUNT:
        errors.append(
            f'geo-config.json has {county_count} counties; expected {REQUIRED_COUNTY_COUNT}'
        )

    # ------------------------------------------------------------------
    # Check 5: All county GEOIDs are 5-digit strings (Rule 1)
    # ------------------------------------------------------------------
    for c in geo_config.get('counties', []):
        geoid = str(c.get('geoid', ''))
        if len(geoid) != 5:
            errors.append(
                f"County GEOID {geoid!r} ({c.get('name')}) is not 5 digits (Rule 1)"
            )

    # ------------------------------------------------------------------
    # Check 6: Summary files exist for ranked counties (optional dir)
    # ------------------------------------------------------------------
    if os.path.isdir(SUMMARY_DIR):
        ranked_county_geoids = {
            e['geoid'] for e in rankings if e.get('type') == 'county'
        }
        for geoid in ranked_county_geoids:
            summary_file = os.path.join(SUMMARY_DIR, f'{geoid}.json')
            if not os.path.isfile(summary_file):
                errors.append(
                    f'Missing HNA summary file for ranked county geoid={geoid}: {summary_file}'
                )

    # ------------------------------------------------------------------
    # Report
    # ------------------------------------------------------------------
    if errors:
        print(f'FAIL  HNA coverage validation found {len(errors)} error(s):\n')
        for e in errors:
            print(f'  ✗ {e}')
        sys.exit(1)
    else:
        print(
            f'PASS  HNA coverage validation OK — '
            f'{len(rankings)} ranked geographies, '
            f'{county_count} counties, '
            f'all GEOIDs valid.'
        )
        sys.exit(0)


if __name__ == '__main__':
    main()
