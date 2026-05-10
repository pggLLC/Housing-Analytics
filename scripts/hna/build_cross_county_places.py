#!/usr/bin/env python3
"""scripts/hna/build_cross_county_places.py

Build a registry of Colorado places that span multiple counties.

Why this matters
----------------
Colorado has a number of cities/towns/CDPs that physically span 2+ counties:

  - Aurora      → Arapahoe (primary), Adams, Douglas
  - Erie        → Boulder, Weld
  - Boulder     → Boulder (primary), Weld
  - Longmont    → Boulder, Weld
  - Northglenn  → Adams, Weld
  - ...and many more

For LIHTC analysts:
  - HUD AMI is set at the COUNTY level (HMFA). A site in Erie has either
    Boulder County HUD AMI ($141K HAMFI 2025) or Weld County HUD AMI
    ($106K HAMFI 2025) depending on which side of the county line.
  - The Deal Calculator and PMA simulator currently pick the place's
    PRIMARY county (highest population share — see fix_place_county_mappings.py).
    For cross-county jurisdictions, that's a 25-30% AMI delta the user
    needs to know about.

This script queries the Census ACS hierarchy endpoint
`for=county+(or+part):*&in=state:08+place:NNNNN` for every CO place
in the geography-registry, and records the multi-county ones.

Output
------
    data/hna/cross-county-places.json

Format::

    {
      "meta": {
        "generated_at": "...",
        "source": "Census ACS county-(or-part) hierarchy",
        "vintage": 2023,
        "count_total_places": 513,
        "count_cross_county": 37
      },
      "places": {
        "0804000": {
          "name": "Aurora (city)",
          "primary_county": "08005",
          "all_counties": [
            {"fips": "08005", "name": "Arapahoe County", "population": 380000},
            {"fips": "08001", "name": "Adams County", "population": 50000},
            {"fips": "08035", "name": "Douglas County", "population": 5000}
          ]
        }
      }
    }

Usage
-----
    python3 scripts/hna/build_cross_county_places.py [--limit N]

Throttling
----------
~200ms/req. 513 places × ~200ms = ~100 seconds.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
GEO_REGISTRY = os.path.join(REPO_ROOT, 'data', 'hna', 'geography-registry.json')
OUT_FILE = os.path.join(REPO_ROOT, 'data', 'hna', 'cross-county-places.json')

DEFAULT_VINTAGE = 2023
COLORADO_FIPS = '08'
REQ_DELAY = 0.20
TIMEOUT = 8


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def http_get_json(url: str, *, retries: int = 2):
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'HousingAnalytics/1.0 build_cross_county_places.py'},
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as err:  # noqa: BLE001
            last_err = err
            if attempt < retries - 1:
                time.sleep(1)
    raise RuntimeError(f'GET {url} failed: {last_err}')


def query_county_parts(place_code5: str, vintage: int = DEFAULT_VINTAGE) -> list[dict]:
    """Return list of {fips, name, population} for each county the place touches."""
    api_key = os.environ.get('CENSUS_API_KEY', '').strip()
    qs = (
        f'get=NAME,B01001_001E'
        f'&for=county%20(or%20part):*'
        f'&in=state:{COLORADO_FIPS}+place:{place_code5}'
    )
    if api_key:
        qs += f'&key={urllib.parse.quote(api_key, safe="")}'
    url = f'https://api.census.gov/data/{vintage}/acs/acs5?{qs}'
    arr = http_get_json(url)
    if not arr or len(arr) < 2:
        return []
    header = arr[0]
    try:
        county_idx = header.index('county (or part)')
        pop_idx = header.index('B01001_001E')
        name_idx = header.index('NAME')
    except ValueError:
        return []
    parts = []
    for row in arr[1:]:
        try:
            pop = int(row[pop_idx])
        except (ValueError, TypeError):
            pop = 0
        cc3 = str(row[county_idx]).zfill(3)
        # NAME field is "Place city, County (part), State" — extract county name only
        full_name = str(row[name_idx])
        # Format example: "El Paso County (part), Colorado Springs city, Colorado"
        # We just want the county portion before the place.
        county_name = full_name.split(',')[0].strip() if ',' in full_name else full_name
        parts.append({
            'fips': f'{COLORADO_FIPS}{cc3}',
            'name': county_name,
            'population': pop,
        })
    # Sort by population descending so caller can pick the primary as parts[0]
    parts.sort(key=lambda p: p['population'], reverse=True)
    return parts


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--limit', type=int, default=None, help='Process at most N places')
    args = p.parse_args()

    with open(GEO_REGISTRY, 'r', encoding='utf-8') as f:
        registry = json.load(f)
    geos = registry.get('geographies', [])
    places = [g for g in geos if g.get('type') in ('place', 'cdp')]
    if args.limit:
        places = places[: args.limit]

    print(f'Querying {len(places)} CO places for county-parts...')

    cross_county: dict[str, dict] = {}
    api_failures = 0

    for i, p_entry in enumerate(places, 1):
        geoid = str(p_entry.get('geoid', '')).zfill(7)
        place_code5 = geoid[2:]
        try:
            parts = query_county_parts(place_code5)
        except Exception as err:  # noqa: BLE001
            api_failures += 1
            if api_failures <= 5:
                print(f'  ✗ {geoid} {p_entry.get("name", "?")[:30]}: {err}')
            continue
        if len(parts) > 1:
            cross_county[geoid] = {
                'name': p_entry.get('name', '?'),
                'primary_county': parts[0]['fips'],
                'all_counties': parts,
            }
            if len(cross_county) <= 30 or i % 50 == 0:
                county_list = ', '.join(p['name'] for p in parts)
                print(f'  + {geoid} {p_entry.get("name", "?")[:25]:<25} ({len(parts)} counties: {county_list[:60]})')
        if i % 50 == 0:
            print(f'  ... checked {i}/{len(places)}, found {len(cross_county)} cross-county places, {api_failures} API failures')
        time.sleep(REQ_DELAY)

    print()
    print(f'Summary: {len(cross_county)} cross-county places out of {len(places)} ({api_failures} API failures)')

    payload = {
        'meta': {
            'generated_at': utc_now(),
            'source': 'Census ACS county-(or-part) hierarchy',
            'vintage': DEFAULT_VINTAGE,
            'count_total_places': len(places),
            'count_cross_county': len(cross_county),
        },
        'places': cross_county,
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, sort_keys=True)
    print(f'\n✓ Wrote {OUT_FILE}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
