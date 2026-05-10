#!/usr/bin/env python3
"""scripts/hna/build_place_tract_membership.py

Compute Colorado place→tract spatial membership using TIGER 2024 PLACE
and TRACT shapefiles. Foundation for the TIGER PR-C2/C3 spatial-join
arc that produces accurate place-level CHAS aggregations.

Why
---
HUD CHAS Table 7 publishes household + cost-burden data at TRACT level.
LIHTC analysts need it at PLACE level (e.g. Erie, Aurora, Longmont) for
jurisdiction-wide market analysis. Places do NOT align with county
borders in 26 cases (PR #787) — Erie spans Boulder + Weld, Aurora spans
Arapahoe + Adams + Douglas, etc. Summing the underlying tracts gives
the correct picture; relying on the place's "primary county" CHAS
under-/over-estimates housing burden when a place straddles a line.

Output schema
-------------
    data/hna/place-tract-membership.json::

    {
      "meta": {
        "generated_at": "...",
        "source_place":  "TIGER 2024 PLACE shapefile (tl_2024_08_place)",
        "source_tract":  "TIGER 2024 TRACT shapefile (tl_2024_08_tract)",
        "vintage":       2024,
        "method":        "shapely intersection + area-weighted apportionment",
        "count_places":  513,
        "count_tracts":  1447,
        "count_memberships": <total place×tract pairs that overlap>
      },
      "places": {
        "0824950": {     # Erie place GEOID (7-digit: state(2) + place(5))
          "name": "Erie town",
          "place_area_sqm": <total place polygon area in sq meters>,
          "tracts": [
            {
              "tract_geoid": "08123012345",  # 11-digit
              "overlap_area_sqm": 1234567.0,
              "share_of_place_area": 0.42,   # frac of place inside this tract
              "share_of_tract_area": 0.18    # frac of tract inside this place
            },
            ...
          ]
        }
      }
    }

How
---
1. Download TIGER 2024 PLACE + TRACT shapefiles for CO (cached locally).
2. Read polygons with pyshp.
3. Reproject geometries to Colorado-appropriate projected CRS (EPSG:26913
   NAD83 / UTM zone 13N) so areas are in square meters and geographic
   distortion at CO latitude is minimal.
4. Build STRtree on tract polygons for fast spatial queries.
5. For each place: query overlapping tracts, compute intersection area,
   write membership record.

Limitations
-----------
Area-weighted apportionment assumes uniform population density within
a tract, which isn't strictly true. For a more accurate split, the
Census Bureau publishes block-level relationship files (~ TIGER BLOCK
shapefiles) but the data volume is 100× larger. Area-weighted is the
standard MVP approach and handles the cross-county-line problem
(the dominant accuracy issue) correctly.

Usage
-----
    python3 scripts/hna/build_place_tract_membership.py
    python3 scripts/hna/build_place_tract_membership.py --skip-download  # use cache
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE_DIR = os.path.join(REPO_ROOT, '.cache', 'tiger2024')
OUT_FILE = os.path.join(REPO_ROOT, 'data', 'hna', 'place-tract-membership.json')

PLACE_URL = 'https://www2.census.gov/geo/tiger/TIGER2024/PLACE/tl_2024_08_place.zip'
TRACT_URL = 'https://www2.census.gov/geo/tiger/TIGER2024/TRACT/tl_2024_08_tract.zip'
PLACE_ZIP = os.path.join(CACHE_DIR, 'tl_2024_08_place.zip')
TRACT_ZIP = os.path.join(CACHE_DIR, 'tl_2024_08_tract.zip')
PLACE_DIR = os.path.join(CACHE_DIR, 'place')
TRACT_DIR = os.path.join(CACHE_DIR, 'tract')

# EPSG:26913 = NAD83 / UTM zone 13N — appropriate for Colorado
# (covers ~the whole state with minimal distortion). Areas in sq meters.
TARGET_CRS_EPSG = 26913
COLORADO_FIPS = '08'

# TIGER PLACE classfp codes that are real human jurisdictions.
# C1 = Active incorporated place, C5 = inactive incorporated place,
# U1 = Census-designated place. Drop C7 (consolidated city), C8 (...).
ACCEPTED_CLASSFP = {'C1', 'C5', 'U1'}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def download(url: str, dest: str) -> None:
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        print(f'  cached: {dest} ({os.path.getsize(dest):,} bytes)')
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f'  downloading {url}...')
    req = urllib.request.Request(
        url, headers={'User-Agent': 'HousingAnalytics/1.0 build_place_tract_membership.py'},
    )
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, 'wb') as f:
        f.write(resp.read())
    print(f'    saved ({os.path.getsize(dest):,} bytes)')


def extract(zip_path: str, dest_dir: str) -> None:
    if os.path.exists(dest_dir) and os.listdir(dest_dir):
        return
    os.makedirs(dest_dir, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest_dir)


def find_shp(directory: str) -> str:
    for f in os.listdir(directory):
        if f.endswith('.shp'):
            return os.path.join(directory, f)
    raise RuntimeError(f'No .shp file in {directory}')


def reproject_geometry(geom, src_epsg: int, dst_epsg: int):
    """Reproject a shapely geometry from src_epsg to dst_epsg.

    Uses pyproj's Transformer. The shapely.ops.transform helper applies
    the coord transform to every vertex; for polygons with thousands of
    vertices this is fast enough.
    """
    from shapely.ops import transform
    from pyproj import Transformer
    transformer = Transformer.from_crs(
        f'EPSG:{src_epsg}', f'EPSG:{dst_epsg}', always_xy=True,
    )
    return transform(transformer.transform, geom)


def load_polygons(shp_path: str, geoid_field: str, name_field: str | None = None,
                  classfp_filter: set | None = None):
    """Yield {geoid, name, geometry} for each polygon in shp_path,
    reprojected from WGS84 (EPSG:4326) to the project CRS."""
    import shapefile
    from shapely.geometry import shape
    sf = shapefile.Reader(shp_path)
    fields = [f[0] for f in sf.fields[1:]]  # skip deletion flag
    geoid_idx = fields.index(geoid_field)
    name_idx = fields.index(name_field) if name_field else None
    classfp_idx = fields.index('CLASSFP') if 'CLASSFP' in fields else None

    print(f'    fields available: {fields}')
    for shape_rec in sf.iterShapeRecords():
        record = shape_rec.record
        if classfp_filter is not None and classfp_idx is not None:
            if record[classfp_idx] not in classfp_filter:
                continue
        try:
            geom = shape(shape_rec.shape.__geo_interface__)
        except Exception:
            continue
        if geom.is_empty:
            continue
        # TIGER shapefiles ship in EPSG:4269 (NAD83 geographic). Treat
        # that as effectively EPSG:4326 for the transformer (~cm error).
        yield {
            'geoid': str(record[geoid_idx]),
            'name': str(record[name_idx]) if name_idx is not None else None,
            'geom_wgs84': geom,
        }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--skip-download', action='store_true',
                   help='Use cached shapefiles only')
    p.add_argument('--limit-places', type=int, default=None,
                   help='Only process the first N places (debug)')
    args = p.parse_args()

    # ── Download + extract shapefiles ──────────────────────────────────
    print('── Acquire TIGER 2024 shapefiles ──')
    if not args.skip_download:
        download(PLACE_URL, PLACE_ZIP)
        download(TRACT_URL, TRACT_ZIP)
    extract(PLACE_ZIP, PLACE_DIR)
    extract(TRACT_ZIP, TRACT_DIR)

    # ── Load + reproject polygons ──────────────────────────────────────
    print('\n── Load + reproject polygons (EPSG:4269 → EPSG:26913) ──')
    place_shp = find_shp(PLACE_DIR)
    tract_shp = find_shp(TRACT_DIR)
    print(f'  PLACE: {place_shp}')
    print(f'  TRACT: {tract_shp}')

    print('  Reading places...')
    place_records = list(load_polygons(
        place_shp, geoid_field='GEOID', name_field='NAME',
        classfp_filter=ACCEPTED_CLASSFP,
    ))
    print(f'    {len(place_records)} places loaded')

    print('  Reading tracts...')
    tract_records = list(load_polygons(
        tract_shp, geoid_field='GEOID', name_field=None,
    ))
    # Filter to CO state (state FIPS = 08); shapefile is already state-scoped
    # but defensive guard catches accidentally-loaded national files.
    tract_records = [t for t in tract_records if t['geoid'].startswith('08')]
    print(f'    {len(tract_records)} CO tracts loaded')

    print('  Reprojecting to UTM zone 13N...')
    for rec in place_records:
        rec['geom'] = reproject_geometry(rec['geom_wgs84'], 4269, TARGET_CRS_EPSG)
        rec['area_sqm'] = rec['geom'].area
    for rec in tract_records:
        rec['geom'] = reproject_geometry(rec['geom_wgs84'], 4269, TARGET_CRS_EPSG)
        rec['area_sqm'] = rec['geom'].area

    # ── Build spatial index on tracts ──────────────────────────────────
    print('\n── Spatial index on tracts ──')
    from shapely.strtree import STRtree
    tract_geoms = [t['geom'] for t in tract_records]
    tract_index = STRtree(tract_geoms)
    print(f'  STRtree built on {len(tract_geoms)} tract polygons')

    # ── Compute place→tract memberships ────────────────────────────────
    print('\n── Compute place→tract memberships ──')
    if args.limit_places:
        place_records = place_records[: args.limit_places]
    memberships: dict = {}
    membership_count = 0
    for i, place in enumerate(place_records, 1):
        place_geom = place['geom']
        place_area = place['area_sqm']
        # Query candidate tracts whose bbox intersects this place
        candidate_idxs = tract_index.query(place_geom)
        tracts_out = []
        for idx in candidate_idxs:
            tract = tract_records[idx]
            tract_geom = tract['geom']
            try:
                inter = place_geom.intersection(tract_geom)
            except Exception:
                continue
            if inter.is_empty:
                continue
            overlap = inter.area
            if overlap < 1.0:  # < 1 sq m — sliver, ignore
                continue
            share_place = overlap / place_area if place_area > 0 else 0.0
            share_tract = overlap / tract['area_sqm'] if tract['area_sqm'] > 0 else 0.0
            tracts_out.append({
                'tract_geoid': tract['geoid'],
                'overlap_area_sqm': round(overlap, 1),
                'share_of_place_area': round(share_place, 4),
                'share_of_tract_area': round(share_tract, 4),
            })
        # Sort by share_of_place_area descending so the largest contributors come first
        tracts_out.sort(key=lambda r: -r['share_of_place_area'])
        memberships[place['geoid']] = {
            'name': place['name'],
            'place_area_sqm': round(place_area, 1),
            'tracts': tracts_out,
        }
        membership_count += len(tracts_out)
        if i % 50 == 0:
            print(f'  [{i:>3}/{len(place_records)}] processed; total memberships so far: {membership_count}')
    print(f'  Total: {len(memberships)} places, {membership_count} place-tract memberships')

    # ── Write output ───────────────────────────────────────────────────
    payload = {
        'meta': {
            'generated_at': utc_now(),
            'source_place': 'TIGER 2024 PLACE shapefile (tl_2024_08_place)',
            'source_tract': 'TIGER 2024 TRACT shapefile (tl_2024_08_tract)',
            'vintage': 2024,
            'method': 'shapely intersection + area-weighted apportionment',
            'projection': f'EPSG:{TARGET_CRS_EPSG} (NAD83 / UTM zone 13N)',
            'count_places': len(memberships),
            'count_tracts': len(tract_records),
            'count_memberships': membership_count,
        },
        'places': memberships,
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, sort_keys=False)
    print(f'\n✓ Wrote {OUT_FILE}')
    print(f'  ({os.path.getsize(OUT_FILE):,} bytes)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
