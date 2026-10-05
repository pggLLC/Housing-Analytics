#!/usr/bin/env python3
"""Publish local renter bedroom counts from the official 2020–24 ACS B25042.

Retain all six published renter buckets; consumers group 4 and 5+ bedrooms
only because HUD FMR stops at 4BR. No county mix substitutes for a city mix.
"""
from __future__ import annotations
import argparse
import csv
import io
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_URL = 'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b25042.dat'
OUT = ROOT / 'data/market/acs_renter_bedrooms_co.json'
FIELDS = dict(zip(('studio', '1br', '2br', '3br', '4br', '5plus'), range(10, 16)))


def build(stream, config):
    wanted = {('0500000US' if kind == 'counties' else '1600000US') + g['geoid']: (kind, g)
              for kind in ('counties', 'places', 'cdps') for g in config[kind]}
    result = {'meta': {'source': 'Census ACS 2020–2024 5-year, B25042 renter-occupied units by bedrooms',
              'source_url': SOURCE_URL, 'vintage': '2020–2024', 'table': 'B25042',
              'fields': {k: f'B25042_{v:03d}E' for k, v in FIELDS.items()},
              'method': 'Published county/place renter counts. 4BR and 5+BR are combined only when distributing rents using HUD FMR.'},
              'counties': {}, 'places': {}}
    for row in csv.DictReader(stream, delimiter='|'):
        match = wanted.get(row['GEO_ID'])
        if not match:
            continue
        kind, geo = match
        counts = {}
        for br, variable in FIELDS.items():
            value = row.get(f'B25042_E{variable:03d}', '')
            counts[br] = int(value) if value.isdigit() else None
        total = row.get('B25042_E009', '')
        total = int(total) if total.isdigit() else None
        complete = all(v is not None for v in counts.values()) and total is not None
        if complete and sum(counts.values()) != total:
            raise ValueError('Bedroom counts do not reconcile: ' + geo['geoid'])
        result['counties' if kind == 'counties' else 'places'][geo['geoid']] = {
            'geoid': geo['geoid'], 'name': geo['label'],
            'county_fips': geo['geoid'] if kind == 'counties' else geo.get('containingCounty'),
            'renter_units': total, 'bedrooms': counts,
            'unavailable_reason': None if complete and total > 0 else 'renter_bedroom_mix_unavailable'}
    if len(result['counties']) != 64 or len(result['places']) != len(config['places']) + len(config['cdps']):
        raise ValueError('Missing Colorado geographies in official B25042 source')
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
