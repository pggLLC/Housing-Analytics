#!/usr/bin/env python3
"""
fetch_hud_egis.py — Fetch HUD eGIS data for Colorado.

Fetches affordable housing data from the HUD eGIS REST API and writes
GeoJSON output to data/market/hud_egis_co.geojson.

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
from datetime import datetime, timezone

OUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'market', 'hud_egis_co.geojson')
OUT_FILE = os.path.normpath(OUT_FILE)

# HUD eGIS FeatureServer – multifamily housing projects, Colorado filter
HUD_EGIS_URL = (
    'https://egis.hud.gov/arcgis/rest/services/eGIS/Public_Housing_Authorities/FeatureServer/0/query'
    '?where=HA_STATE%3D%27CO%27&outFields=*&f=geojson&outSR=4326&resultRecordCount=2000'
)

TIMEOUT = 60  # seconds


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def http_get(url: str, timeout: int = TIMEOUT) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'HousingAnalytics/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_all_pages(base_url: str) -> list:
    """Fetch all pages from a HUD eGIS FeatureServer using offset pagination."""
    features = []
    offset = 0
    page_size = 1000
    while True:
        url = f"{base_url}&resultOffset={offset}&resultRecordCount={page_size}"
        try:
            raw = http_get(url)
            data = json.loads(raw)
        except Exception as exc:
            print(f'⚠ HUD eGIS fetch error at offset {offset}: {exc}', file=sys.stderr)
            break
        page_features = data.get('features', [])
        features.extend(page_features)
        # Stop when fewer records than page size are returned
        if len(page_features) < page_size:
            break
        offset += page_size
        time.sleep(0.5)  # polite delay between pages
    return features


def main() -> int:
    print('Fetching HUD eGIS data for Colorado…')
    base_url = (
        'https://egis.hud.gov/arcgis/rest/services/eGIS/Public_Housing_Authorities/FeatureServer/0/query'
        '?where=HA_STATE%3D%27CO%27&outFields=*&f=geojson&outSR=4326'
    )
    features = fetch_all_pages(base_url)

    if not features:
        print('⚠ No features returned from HUD eGIS API. Writing empty collection.', file=sys.stderr)

    geojson = {
        'type': 'FeatureCollection',
        'meta': {
            'source': 'HUD eGIS Public Housing Authorities',
            'url': 'https://egis.hud.gov/',
            'state': 'Colorado',
            'state_fips': '08',
            'generated': utc_now(),
            'feature_count': len(features),
        },
        'features': features,
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(geojson, f)

    print(f'✓ Wrote {len(features)} features to {OUT_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
