#!/usr/bin/env python3
"""
fetch_chas.py — Fetch HUD CHAS (Comprehensive Housing Affordability Strategy) data for Colorado.

Downloads CHAS data tables from HUD and writes JSON output to
data/market/chas_co.json.

Usage:
    python3 scripts/fetch_chas.py

Output:
    data/market/chas_co.json
"""

import csv
import io
import json
import os
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone

OUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'market', 'chas_co.json')
OUT_FILE = os.path.normpath(OUT_FILE)

# HUD CHAS data — most recent available vintage (state-level download)
# URL pattern: https://www.huduser.gov/portal/datasets/cp.html
CHAS_STATE_URL = (
    'https://www.huduser.gov/portal/datasets/cp/2016thru2020-140-csv.zip'
)
COLORADO_FIPS = '08'
TIMEOUT = 120


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def http_get(url: str, timeout: int = TIMEOUT) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'HousingAnalytics/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def main() -> int:
    print('Fetching HUD CHAS data for Colorado…')
    try:
        raw = http_get(CHAS_STATE_URL)
    except Exception as exc:
        print(f'✗ Failed to download CHAS data: {exc}', file=sys.stderr)
        return 1

    records = []
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            # Find the main data CSV (typically named Table1.csv or similar)
            csv_names = [n for n in zf.namelist() if n.endswith('.csv') and 'Table' in n]
            for csv_name in csv_names[:3]:  # process first 3 tables
                with zf.open(csv_name) as cf:
                    reader = csv.DictReader(io.TextIOWrapper(cf, encoding='utf-8-sig'))
                    for row in reader:
                        if row.get('st', '').zfill(2) == COLORADO_FIPS:
                            records.append(dict(row))
    except Exception as exc:
        print(f'⚠ Could not parse CHAS ZIP: {exc}', file=sys.stderr)

    output = {
        'meta': {
            'source': 'HUD CHAS (Comprehensive Housing Affordability Strategy)',
            'url': 'https://www.huduser.gov/portal/datasets/cp.html',
            'state': 'Colorado',
            'state_fips': COLORADO_FIPS,
            'generated': utc_now(),
            'record_count': len(records),
        },
        'records': records,
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f)

    print(f'✓ Wrote {len(records)} CHAS records to {OUT_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
