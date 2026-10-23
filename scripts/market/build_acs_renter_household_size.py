#!/usr/bin/env python3
"""Publish renter households by household size from the official 2020–24 ACS B25009.

Feeds the HNA "Renter need by bedroom count" chart. The table-based summary
file needs no Census API key, so the published site reads this file instead of
calling the API (the site ships no key).
"""
from __future__ import annotations
import argparse
import csv
import io
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_URL = 'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b25009.dat'
OUT = ROOT / 'data/market/acs_renter_household_size_co.json'
# Renter universe: B25009_010 total, 011-017 household size 1 to 7+.
FIELDS = dict(zip(('1', '2', '3', '4', '5', '6', '7+'), range(11, 18)))


def build(stream, config):
    wanted = {('0500000US' if kind == 'counties' else '1600000US') + g['geoid']: (kind, g)
              for kind in ('counties', 'places', 'cdps') for g in config[kind]}
    wanted['0400000US08'] = ('state', {'geoid': '08', 'label': 'Colorado'})
    result = {'meta': {'source': 'Census ACS 2020–2024 5-year, B25009 tenure by household size (renter-occupied)',
              'source_url': SOURCE_URL, 'vintage': '2020–2024', 'table': 'B25009',
              'fields': dict({'total': 'B25009_010E'}, **{k: f'B25009_{v:03d}E' for k, v in FIELDS.items()}),
              'method': 'Published state/county/place renter household counts by household size; no estimate is substituted.'},
              'state': {}, 'counties': {}, 'places': {}}
    for row in csv.DictReader(stream, delimiter='|'):
        match = wanted.get(row['GEO_ID'])
        if not match:
            continue
        kind, geo = match
        sizes = {}
        for size, variable in FIELDS.items():
            value = row.get(f'B25009_E{variable:03d}', '')
            sizes[size] = int(value) if value.isdigit() else None
        total = row.get('B25009_E010', '')
        total = int(total) if total.isdigit() else None
        complete = all(v is not None for v in sizes.values()) and total is not None
        if complete and sum(sizes.values()) != total:
            raise ValueError('Household size counts do not reconcile: ' + geo['geoid'])
        bucket = 'state' if kind == 'state' else 'counties' if kind == 'counties' else 'places'
        result[bucket][geo['geoid']] = {
            'geoid': geo['geoid'], 'name': geo['label'],
            'renter_households': total, 'by_size': sizes,
            'unavailable_reason': None if complete and total > 0 else 'renter_household_size_unavailable'}
    if (len(result['state']) != 1 or len(result['counties']) != 64
            or len(result['places']) != len(config['places']) + len(config['cdps'])):
        raise ValueError('Missing Colorado geographies in official B25009 source')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    config = json.loads((ROOT / 'data/hna/geo-config.json').read_text())
    raw = args.source.read_bytes() if args.source else urllib.request.urlopen(SOURCE_URL, timeout=180).read()
    result = build(io.StringIO(raw.decode('utf-8-sig')), config)
    OUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Wrote {OUT}: {len(result['counties'])} counties, {len(result['places'])} places")


if __name__ == '__main__':
    main()
