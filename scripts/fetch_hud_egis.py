#!/usr/bin/env python3
"""
fetch_hud_egis.py — Fetch HUD eGIS PHA data for Colorado.

Queries the HUD eGIS Public Housing Authorities MapServer endpoint
and writes GeoJSON output to data/market/hud_egis_co.geojson.

Usage:
    python3 scripts/fetch_hud_egis.py

Output:
    data/market/hud_egis_co.geojson
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

OUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'market', 'hud_egis_co.geojson')
OUT_FILE = os.path.normpath(OUT_FILE)

# HUD eGIS MapServer – Public Housing Authorities (gotit folder)
BASE_URL = 'https://egis.hud.gov/arcgis/rest/services/gotit/PublicHousing/MapServer/0/query'

TIMEOUT = 60  # seconds
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds
PAGE_SIZE = 200


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def http_get(url: str, timeout: int = TIMEOUT) -> bytes:
    """HTTP GET with retry logic."""
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HousingAnalytics/1.0'})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:
            last_exc = exc
            if attempt < MAX_RETRIES:
                print(f'  Attempt {attempt} failed: {exc}. Retrying in {RETRY_DELAY}s…',
                      file=sys.stderr)
                time.sleep(RETRY_DELAY)
    raise last_exc


def fetch_all_pages() -> list:
    """Fetch all pages from the HUD eGIS MapServer using offset pagination."""
    features = []
    offset = 0
    while True:
        params = urllib.parse.urlencode({
            'where': "STD_ST='CO'",
            'outFields': '*',
            'f': 'geojson',
            'outSR': '4326',
            'resultOffset': offset,
            'resultRecordCount': PAGE_SIZE,
        })
        url = f'{BASE_URL}?{params}'
        print(f'  Fetching offset={offset} …')
        try:
            raw = http_get(url)
            data = json.loads(raw)
        except Exception as exc:
            print(f'⚠ HUD eGIS fetch error at offset {offset}: {exc}', file=sys.stderr)
            break

        # Check for ArcGIS error response
        if 'error' in data:
            print(f'⚠ ArcGIS error: {data["error"]}', file=sys.stderr)
            break

        page_features = data.get('features', [])
        features.extend(page_features)
        print(f'    got {len(page_features)} features (total: {len(features)})')

        # Stop when fewer records than page size are returned
        if len(page_features) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.5)  # polite delay between pages
    return features


def main() -> int:
    print('Fetching HUD eGIS PHA data for Colorado…')
    features = fetch_all_pages()

    if not features:
        print('⚠ No features returned from HUD eGIS API. Writing empty collection.',
              file=sys.stderr)

    geojson = {
        'type': 'FeatureCollection',
        'meta': {
            'source': 'HUD eGIS Public Housing Authorities (MapServer)',
            'url': 'https://egis.hud.gov/arcgis/rest/services/gotit/PublicHousing/MapServer/0',
            'state': 'Colorado',
            'state_fips': '08',
            'generated': utc_now(),
            'feature_count': len(features),
        },
        'features': features,
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, indent=2)

    print(f'✓ Wrote {len(features)} features to {OUT_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
