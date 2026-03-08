#!/usr/bin/env python3
"""
fetch_fmr_api.py — Fetch HUD Fair Market Rents (FMR) for Colorado counties.

Fetches FMR data from the HUD API and writes JSON output to
data/market/fmr_co.json.

Usage:
    python3 scripts/fetch_fmr_api.py

Environment variables:
    HUD_API_TOKEN  — optional HUD User API token for higher rate limits

Output:
    data/market/fmr_co.json
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

OUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'market', 'fmr_co.json')
OUT_FILE = os.path.normpath(OUT_FILE)

HUD_FMR_URL = 'https://www.huduser.gov/hudapi/public/fmr/statedata/CO'
TIMEOUT = 30


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def http_get_json(url: str, token: str | None = None) -> dict | None:
    headers = {'User-Agent': 'HousingAnalytics/1.0'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        print(f'⚠ HUD FMR API error: {exc}', file=sys.stderr)
        return None


def main() -> int:
    token = os.environ.get('HUD_API_TOKEN', '').strip() or None
    print('Fetching HUD Fair Market Rents for Colorado…')
    data = http_get_json(HUD_FMR_URL, token)

    if not data:
        print('✗ Failed to fetch HUD FMR data.', file=sys.stderr)
        return 1

    output = {
        'meta': {
            'source': 'HUD Fair Market Rents API',
            'url': 'https://www.huduser.gov/hudapi/public/fmr/',
            'state': 'Colorado',
            'state_fips': '08',
            'generated': utc_now(),
        },
        'data': data,
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f)

    county_count = len(data.get('data', []) if isinstance(data.get('data'), list) else [])
    print(f'✓ Wrote FMR data ({county_count} records) to {OUT_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
