#!/usr/bin/env python3
"""
fetch_nhpd.py — Fetch NHPD (National Housing Preservation Database) data for Colorado.

Downloads Colorado affordable housing properties from NHPD and writes
GeoJSON output to data/market/nhpd_co.geojson.

Usage:
    python3 scripts/fetch_nhpd.py

Output:
    data/market/nhpd_co.geojson
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

OUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'market', 'nhpd_co.geojson')
OUT_FILE = os.path.normpath(OUT_FILE)

# NHPD API endpoint
NHPD_API_URL = 'https://preservationdatabase.org/api/properties/'
COLORADO_STATE = 'CO'
TIMEOUT = 60
PAGE_SIZE = 500


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def http_get_json(url: str) -> dict | list | None:
    req = urllib.request.Request(url, headers={'User-Agent': 'HousingAnalytics/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        print(f'⚠ NHPD API error: {exc}', file=sys.stderr)
        return None


def main() -> int:
    print('Fetching NHPD data for Colorado…')
    features = []
    page = 1

    while True:
        params = urllib.parse.urlencode({
            'state': COLORADO_STATE,
            'page': page,
            'page_size': PAGE_SIZE,
            'format': 'json',
        })
        url = f'{NHPD_API_URL}?{params}'
        data = http_get_json(url)

        if not data:
            break

        # Handle paginated response (DRF-style) or direct list
        if isinstance(data, dict):
            items = data.get('results', data.get('features', []))
            total = data.get('count', 0)
        elif isinstance(data, list):
            items = data
            total = len(items)
        else:
            break

        for item in items:
            # Convert to GeoJSON Feature
            lat = item.get('latitude') or item.get('lat')
            lng = item.get('longitude') or item.get('lon') or item.get('lng')
            props = {k: v for k, v in item.items() if k not in ('latitude', 'longitude', 'lat', 'lon', 'lng')}
            feature = {
                'type': 'Feature',
                'geometry': {
                    'type': 'Point',
                    'coordinates': [float(lng), float(lat)],
                } if lat and lng else None,
                'properties': props,
            }
            features.append(feature)

        if not items or (isinstance(data, dict) and not data.get('next')):
            break
        page += 1

    geojson = {
        'type': 'FeatureCollection',
        'meta': {
            'source': 'National Housing Preservation Database (NHPD)',
            'url': 'https://preservationdatabase.org/',
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

    print(f'✓ Wrote {len(features)} NHPD properties to {OUT_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
