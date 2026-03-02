#!/usr/bin/env python3
"""
scripts/market/build_public_market_data.py

Builds pre-computed market data artifacts for the Market Analysis page.

Outputs (in data/market/):
  - tract_centroids_co.json     : Colorado tract centroids from TIGERweb
  - acs_tract_metrics_co.json   : Per-tract ACS metrics (cost burden, vacancy, etc.)
  - hud_lihtc_co.geojson        : HUD LIHTC projects filtered to Colorado

Data sources (all public, no paid API required):
  - Census ACS 5-Year Estimates API  (optional key: CENSUS_API_KEY env var)
  - Census TIGERweb ArcGIS REST API  (public, no key)
  - HUD LIHTC via services.arcgis.com (public, no key)

Usage:
  python3 scripts/market/build_public_market_data.py

Environment variables:
  CENSUS_API_KEY   (optional) — Census API key for higher rate limits
  OUTPUT_DIR       (optional) — override output directory (default: data/market)
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CENSUS_API_KEY = os.environ.get('CENSUS_API_KEY', '')
OUTPUT_DIR = os.environ.get('OUTPUT_DIR', os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'data', 'market'
))

# Colorado FIPS
CO_FIPS = '08'

# ACS variables to fetch per tract
# B25070_010E = cost-burdened renters (30%+ gross rent / income)
# B25070_001E = total renter-occupied households
# B25004_001E = total vacant units
# B25014_005E + B25014_011E = overcrowded renter units (>1 person/room)
# B25003_003E = renter-occupied units
# B25003_001E = total occupied units
# B25064_001E = median gross rent
# B23025_002E = in labor force
# B23025_001E = civilian non-institutional population 16+
ACS_YEAR = '2022'
ACS_VARS = [
    'B25070_010E', 'B25070_001E',
    'B25004_001E',
    'B25014_005E', 'B25014_011E',
    'B25003_003E', 'B25003_001E',
    'B25064_001E',
    'B23025_002E', 'B23025_001E',
    'B01001_001E',  # total population (for tract size reference)
]

# TIGERweb — tracts layer for Colorado
TIGER_TRACTS_URL = (
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/8/query'
)

# HUD LIHTC ArcGIS endpoint
HUD_LIHTC_URL = (
    'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/'
    'LIHTC/FeatureServer/0/query'
)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def fetch_json(url, retries=3, delay=2):
    """Fetch URL and parse JSON with retry logic."""
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HousingAnalytics/1.0'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as exc:
            last_err = exc
            if attempt < retries - 1:
                time.sleep(delay * (2 ** attempt))
    raise last_err


def fetch_arcgis_paged(base_url, params, page_size=1000):
    """Fetch all pages from an ArcGIS FeatureServer query endpoint."""
    all_features = []
    offset = 0
    while True:
        p = dict(params)
        p['resultOffset'] = str(offset)
        p['resultRecordCount'] = str(page_size)
        url = base_url + '?' + urllib.parse.urlencode(p)
        data = fetch_json(url)
        features = data.get('features', [])
        all_features.extend(features)
        if not features or not data.get('exceededTransferLimit'):
            break
        offset += page_size
    return all_features


def safe_int(val, default=0):
    try:
        v = int(val)
        return 0 if v < 0 else v
    except (TypeError, ValueError):
        return default


def safe_float(val, default=0.0):
    try:
        v = float(val)
        return default if (v < 0 or v != v) else v  # filter negative & NaN
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Step 1: Fetch ACS tract data
# ---------------------------------------------------------------------------

def fetch_acs_metrics():
    """Fetch ACS tract-level metrics for Colorado."""
    print('[ACS] Fetching tract metrics…')
    vars_str = ','.join(ACS_VARS)
    params = {
        'get': 'GEO_ID,' + vars_str,
        'for': 'tract:*',
        'in': 'state:' + CO_FIPS,
    }
    if CENSUS_API_KEY:
        params['key'] = CENSUS_API_KEY

    url = ('https://api.census.gov/data/' + ACS_YEAR +
           '/acs/acs5?' + urllib.parse.urlencode(params))
    print('[ACS] URL:', url[:120], '…')

    try:
        data = fetch_json(url)
    except Exception as exc:
        print('[ACS] WARNING: Failed to fetch ACS data:', exc)
        return []

    if not data or len(data) < 2:
        print('[ACS] WARNING: No ACS data returned.')
        return []

    header = data[0]
    rows = data[1:]

    def idx(name):
        try:
            return header.index(name)
        except ValueError:
            return -1

    results = []
    for row in rows:
        state = row[idx('state')] if idx('state') >= 0 else ''
        county = row[idx('county')] if idx('county') >= 0 else ''
        tract = row[idx('tract')] if idx('tract') >= 0 else ''
        geoid = state + county + tract

        total_hh = safe_int(row[idx('B25003_001E')])
        renter_hh = safe_int(row[idx('B25003_003E')])
        cost_burdened = safe_int(row[idx('B25070_010E')])
        vacant = safe_int(row[idx('B25004_001E')])
        overcrowded = (safe_int(row[idx('B25014_005E')]) +
                       safe_int(row[idx('B25014_011E')]))
        median_rent = safe_float(row[idx('B25064_001E')])
        lf_pop = safe_int(row[idx('B23025_001E')])
        lf_in = safe_int(row[idx('B23025_002E')])
        lfp = (lf_in / lf_pop) if lf_pop > 0 else 0.0

        results.append({
            'geoid': geoid,
            'total_households': total_hh,
            'renter_households': renter_hh,
            'cost_burdened': cost_burdened,
            'vacant_units': vacant,
            'overcrowded_units': overcrowded,
            'median_gross_rent': round(median_rent, 2),
            'labor_force_participation': round(lfp, 4),
        })

    print(f'[ACS] Fetched {len(results)} tract records.')
    return results


# ---------------------------------------------------------------------------
# Step 2: Fetch TIGERweb tract centroids
# ---------------------------------------------------------------------------

def fetch_tract_centroids():
    """Fetch Colorado tract centroids from TIGERweb."""
    print('[TIGERweb] Fetching tract centroids…')
    params = {
        'where': f"STATEFP='{CO_FIPS}'",
        'outFields': 'GEOID,CENTLAT,CENTLON',
        'returnGeometry': 'false',
        'f': 'json',
        'resultRecordCount': '5000',
        'resultOffset': '0',
    }
    url = TIGER_TRACTS_URL + '?' + urllib.parse.urlencode(params)
    print('[TIGERweb] URL:', url[:120], '…')

    try:
        data = fetch_json(url)
    except Exception as exc:
        print('[TIGERweb] WARNING: Failed to fetch centroids:', exc)
        return []

    features = data.get('features', [])
    results = []
    for f in features:
        attrs = f.get('attributes', {})
        geoid = str(attrs.get('GEOID', '')).strip()
        lat = safe_float(attrs.get('CENTLAT'))
        lon = safe_float(attrs.get('CENTLON'))
        if geoid and lat and lon:
            results.append({'geoid': geoid, 'lat': lat, 'lon': lon})

    print(f'[TIGERweb] Fetched {len(results)} tract centroids.')
    return results


# ---------------------------------------------------------------------------
# Step 3: Fetch HUD LIHTC projects
# ---------------------------------------------------------------------------

def fetch_hud_lihtc():
    """Fetch HUD LIHTC projects for Colorado from ArcGIS public endpoint."""
    print('[HUD LIHTC] Fetching Colorado projects…')
    params = {
        'where': f"STATEFP='{CO_FIPS}'",
        'outFields': '*',
        'returnGeometry': 'true',
        'f': 'geojson',
        'outSR': '4326',
        'resultRecordCount': '1000',
        'resultOffset': '0',
        'returnExceededLimitFeatures': 'true',
    }

    try:
        features = fetch_arcgis_paged(HUD_LIHTC_URL, params)
    except Exception as exc:
        print('[HUD LIHTC] WARNING: Failed to fetch LIHTC data:', exc)
        return {'type': 'FeatureCollection', 'features': []}

    # Re-wrap as GeoJSON FeatureCollection if returned as ArcGIS JSON
    geojson_features = []
    for f in features:
        geom = f.get('geometry')
        props = f.get('attributes', f.get('properties', {}))
        if geom:
            geojson_features.append({
                'type': 'Feature',
                'geometry': geom,
                'properties': props,
            })

    print(f'[HUD LIHTC] Fetched {len(geojson_features)} projects.')
    return {'type': 'FeatureCollection', 'features': geojson_features}


# ---------------------------------------------------------------------------
# Step 4: Smoke-test validation
# ---------------------------------------------------------------------------

def validate_artifacts(out_dir):
    errors = []
    files = {
        'tract_centroids_co.json': lambda d: isinstance(d, list) and len(d) > 0,
        'acs_tract_metrics_co.json': lambda d: isinstance(d, list) and len(d) > 0,
        'hud_lihtc_co.geojson': lambda d: d.get('type') == 'FeatureCollection',
    }
    for fname, check in files.items():
        path = os.path.join(out_dir, fname)
        if not os.path.exists(path):
            errors.append(f'Missing: {path}')
            continue
        with open(path) as fh:
            data = json.load(fh)
        if not check(data):
            errors.append(f'Validation failed: {path}')
    return errors


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f'[build] Output directory: {OUTPUT_DIR}')

    # Fetch data
    centroids = fetch_tract_centroids()
    acs = fetch_acs_metrics()
    lihtc = fetch_hud_lihtc()

    # Fall back to placeholders if fetches returned nothing
    if not centroids:
        print('[build] WARNING: Using empty tract_centroids_co.json (fetch failed).')
    if not acs:
        print('[build] WARNING: Using empty acs_tract_metrics_co.json (fetch failed).')
    if not lihtc.get('features'):
        print('[build] WARNING: Using empty hud_lihtc_co.geojson (fetch failed).')

    # Write outputs
    centroid_path = os.path.join(OUTPUT_DIR, 'tract_centroids_co.json')
    acs_path = os.path.join(OUTPUT_DIR, 'acs_tract_metrics_co.json')
    lihtc_path = os.path.join(OUTPUT_DIR, 'hud_lihtc_co.geojson')

    with open(centroid_path, 'w') as fh:
        json.dump(centroids, fh, indent=2)
    print(f'[build] Wrote {len(centroids)} centroids → {centroid_path}')

    with open(acs_path, 'w') as fh:
        json.dump(acs, fh, indent=2)
    print(f'[build] Wrote {len(acs)} ACS records → {acs_path}')

    with open(lihtc_path, 'w') as fh:
        json.dump(lihtc, fh, indent=2)
    n = len(lihtc.get('features', []))
    print(f'[build] Wrote {n} LIHTC features → {lihtc_path}')

    # Validate
    errors = validate_artifacts(OUTPUT_DIR)
    if errors:
        print('\n[build] SMOKE TEST FAILURES:')
        for e in errors:
            print(' ', e)
        sys.exit(1)
    else:
        print('\n[build] All smoke tests passed ✅')


if __name__ == '__main__':
    main()
