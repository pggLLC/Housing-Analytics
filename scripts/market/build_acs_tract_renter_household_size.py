#!/usr/bin/env python3
"""Publish Colorado renter households by size for every census tract (ACS 2020-24 B25009).

The Market Analysis CHFA count matches each market area's household sizes to
these published counts (paul, 8 Nov 2026). A tract's average renter size
(B25010) can be noisy, so the count matches the whole size distribution
instead of one average.

Usage:
    python3 scripts/market/build_acs_tract_renter_household_size.py [--source acsdt5y2024-b25009.dat]
Source (no API key needed):
    https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b25009.dat
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_URL = 'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b25009.dat'
OUT = ROOT / 'data/market/acs_tract_renter_household_size_co.json'
PREFIX = '1400000US08'
# Renter universe: B25009_010 total, 011-017 household size 1 to 7+.
SIZE_COLUMNS = [f'B25009_E{v:03d}' for v in range(11, 18)]


def build(stream) -> dict:
    tracts = {}
    for row in csv.DictReader(stream, delimiter='|'):
        geo = row['GEO_ID']
        if not geo.startswith(PREFIX):
            continue
        values = [row.get(c, '') for c in SIZE_COLUMNS]
        total = row.get('B25009_E010', '')
        if not total.isdigit() or not all(v.isdigit() for v in values):
            continue  # not published: the page leaves the tract out of the match
        counts = [int(v) for v in values]
        if sum(counts) != int(total):
            raise ValueError('Household size counts do not reconcile: ' + geo)
        # 1..5 people, then 6 or more (6 and 7+ together, as the PUMS rows are)
        tracts[geo[len('1400000US'):]] = counts[:5] + [counts[5] + counts[6]]
    if len(tracts) < 1400:
        raise ValueError(f'Only {len(tracts)} Colorado tracts found in the B25009 source')
    return {
        'meta': {
            'source': 'Census ACS 2020-2024 5-year, table B25009 tenure by household size, renter-occupied',
            'source_url': SOURCE_URL,
            'vintage': '2020-2024',
            'layout': 'tracts[geoid] = renter households with 1, 2, 3, 4, 5 and 6 or more people',
            'method': 'Published tract counts; 6 and 7+ are added together. No estimate is substituted; unpublished tracts are left out.',
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'generator': 'scripts/market/build_acs_tract_renter_household_size.py',
        },
        'tracts': dict(sorted(tracts.items())),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source', type=Path)
    ap.add_argument('--out', type=Path, default=OUT)
    a = ap.parse_args()
    raw = a.source.read_bytes() if a.source else urllib.request.urlopen(SOURCE_URL, timeout=300).read()
    result = build(io.StringIO(raw.decode('utf-8-sig')))
    a.out.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    print(f'wrote {a.out} ({len(result["tracts"])} tracts)')


if __name__ == '__main__':
    main()
