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

from __future__ import annotations   # PEP 604 unions (dict | list | None) on Python 3.9

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
            # A failed request is NOT an empty dataset. Breaking here and
            # carrying on wrote a zero-feature file over the last good one and
            # returned 0 -- the workflow went green while destroying data. NHPD
            # is registration-gated, so this path is reached routinely.
            if page == 1:
                print('✗ NHPD returned no usable response on the first request; '
                      'refusing to overwrite the existing file.', file=sys.stderr)
                return 1
            print(f'⚠ NHPD request failed at page {page}; keeping the '
                  f'{len(features)} feature(s) already retrieved.', file=sys.stderr)
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

    # An empty fetch must never replace a populated file. "Zero affordable
    # housing properties in Colorado" is not a finding, it is a failed request,
    # and publishing it as data is worse than publishing nothing.
    if not features:
        existing = 0
        if os.path.exists(OUT_FILE):
            try:
                with open(OUT_FILE, encoding='utf-8') as f:
                    existing = len(json.load(f).get('features', []))
            except Exception:
                existing = 0
        print(f'✗ NHPD fetch produced 0 features; refusing to overwrite '
              f'{OUT_FILE} (currently {existing} feature(s)). Exiting nonzero so '
              f'the workflow reports the failure instead of publishing an empty '
              f'dataset as current.', file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(geojson, f)

    print(f'✓ Wrote {len(features)} NHPD properties to {OUT_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
