#!/usr/bin/env python3
"""Build data/policy/forest-service-admin-sites.json.

What the Forest Service leasing brief (research-brief.html?id=forest-service-admin-site-leases-2026)
reads about each Colorado county:

  - National Forest System acres, from the Forest Service's own land area statistics
    (the companion to its Land Areas Report), summed by county for land the Forest Service owns;
  - the county's land area, from the Census county Gazetteer, so the forest share is acres / acres;
  - the Forest Service offices and work centers in the county, from its office locations layer;
  - the towns and cities with Forest Service land within one mile of their center point.

An office is where Forest Service staff work. It is not a list of sites that can be leased: some are
rented from others, and only a regional forester recommends a site for leasing (Pub. L. 115-334,
sec. 8623(c)). The file says so in meta.limits, and the brief repeats it.

Run by hand (no workflow): python3 scripts/policy/build_forest_service_admin_sites.py
Needs network access to apps.fs.usda.gov and www2.census.gov. Standard library only.
"""
import csv
import io
import json
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data/policy/forest-service-admin-sites.json'
EDW = 'https://apps.fs.usda.gov/arcx/rest/services/EDW'
OFFICES = EDW + '/EDW_FSOfficeLocations_01/MapServer/0/query'
LANDS = EDW + '/EDW_LandsAreaStatistics_01/MapServer/0/query'
GAZETTEER = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip'
SQ_M_PER_ACRE = 4046.8564224
NEAR_MILES = 1
# Offices with no forest name that are still Forest Service units (research stations, regional and national
# offices, the Job Corps center it runs). The layer also lists private firms that only house Forest Service
# IT equipment; those carry no forest name and are left out.
FS_UNIT_PREFIXES = ('RMRS', 'Fort Collins Administrative Site', 'Region 2', 'Collbran Job Corps',
                    'WO National Business Center', 'Job Corps National Office')


def get(url, params, tries=3):
    full = url + '?' + urllib.parse.urlencode(params)
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(full, timeout=90) as r:
                data = json.load(r)
            if 'error' in data:
                raise RuntimeError(f"{url}: {data['error']}")
            return data
        except Exception:  # noqa: BLE001 - retried, then raised
            if attempt == tries - 1:
                raise
    raise RuntimeError(f'{url}: no attempts made')


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_geometry(x, y, geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        if point_in_ring(x, y, poly[0]) and not any(point_in_ring(x, y, hole) for hole in poly[1:]):
            return True
    return False


def main():
    counties = json.loads((ROOT / 'data/co-county-boundaries.json').read_text())['features']
    places = json.loads((ROOT / 'data/co-place-centroids.json').read_text())['byGeoid']

    def county_of(lng, lat):
        for f in counties:
            if in_geometry(lng, lat, f['geometry']):
                return f['properties']['GEOID']
        return None

    # Census land area by county.
    with urllib.request.urlopen(GAZETTEER, timeout=120) as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    text = z.read(z.namelist()[0]).decode('utf-8')
    land = {}
    for row in csv.DictReader(io.StringIO(text), delimiter='\t'):
        row = {k.strip(): v.strip() for k, v in row.items()}
        if row['USPS'] == 'CO':
            land[row['GEOID']] = {'name': row['NAME'], 'aland_sq_m': int(row['ALAND'])}
    if len(land) != 64:
        sys.exit(f'Gazetteer: expected 64 Colorado counties, got {len(land)}')
    by_name = {v['name'].replace(' County', '').replace(' and County', ''): g for g, v in land.items()}
    by_name.setdefault('Denver', '08031')
    by_name.setdefault('Broomfield', '08014')

    # Forest Service acres by county (Forest Service-owned land only; NON-FS rows are private land inside
    # a forest's boundary).
    stats = get(LANDS, {
        'where': "statename='Colorado' AND ownerclassification='USDA FOREST SERVICE'",
        'outStatistics': json.dumps([{'statisticType': 'sum', 'onStatisticField': 'gis_acres', 'outStatisticFieldName': 'acres'}]),
        'groupByFieldsForStatistics': 'countyname', 'f': 'json'})
    acres = {}
    for feat in stats['features']:
        a = feat['attributes']
        g = by_name.get(a['countyname'])
        if not g:
            sys.exit(f"Land statistics: unknown county {a['countyname']!r}")
        acres[g] = a['acres']

    # Offices. A few records carry no coordinates and one (Divide Ranger District, Del Norte) carries
    # coordinates in Archuleta County, so an office is placed by its listed city when that city is a
    # Colorado town or CDP, and by its coordinates otherwise.
    city_point = {}
    for v in places.values():
        city_point.setdefault(re.sub(r' (town|city|CDP|city and county)$', '', v['name']).lower(), (v['lng'], v['lat']))
    raw = get(OFFICES, {'where': "state='CO'", 'outFields': 'name,city,forest_name,district_name,latitude,longitude',
                        'returnGeometry': 'false', 'f': 'json'})['features']
    offices = []
    for feat in raw:
        a = feat['attributes']
        name = (a['name'] or '').strip()
        if not (a['forest_name'] or name.startswith(FS_UNIT_PREFIXES)):
            continue
        city = (a['city'] or '').strip()
        pt = city_point.get(city.lower().replace('canon city', 'cañon city'))
        if pt is None and a['latitude'] is not None:
            pt = (a['longitude'], a['latitude'])
        g = county_of(*pt) if pt else None
        if g is None:
            sys.exit(f'Office {name!r} ({city}) could not be placed in a county')
        offices.append({'name': name, 'city': city, 'county_geoid': g,
                        'forest': (a['forest_name'] or '').replace('\xa0', ' ').strip() or None,
                        'district': (a['district_name'] or '').strip() or None})
    offices.sort(key=lambda o: (o['county_geoid'], o['city'], o['name']))

    # Towns and cities (not CDPs) with Forest Service land within NEAR_MILES of their center point.
    towns = {g: v for g, v in places.items() if re.search(r' (town|city|city and county)$', v['name'])}

    def near(item):
        g, v = item
        res = get(LANDS, {'geometry': f"{v['lng']},{v['lat']}", 'geometryType': 'esriGeometryPoint', 'inSR': '4326',
                          'spatialRel': 'esriSpatialRelIntersects', 'distance': str(NEAR_MILES),
                          'units': 'esriSRUnit_StatuteMile', 'where': "ownerclassification='USDA FOREST SERVICE'",
                          'returnCountOnly': 'true', 'f': 'json'})
        return g, v, res['count'] > 0, county_of(v['lng'], v['lat'])

    with ThreadPoolExecutor(8) as ex:
        near_rows = list(ex.map(near, sorted(towns.items())))

    out_counties = {}
    for g in sorted(land):
        land_acres = land[g]['aland_sq_m'] / SQ_M_PER_ACRE
        ac = acres.get(g, 0)
        out_counties[g] = {
            'name': land[g]['name'],
            'nfs_acres': round(ac),
            'land_acres': round(land_acres),
            'nfs_share': round(ac / land_acres, 4),
            'office_count': sum(1 for o in offices if o['county_geoid'] == g),
            'office_cities': sorted({o['city'] for o in offices if o['county_geoid'] == g}),
            'towns_within_1_mile': sorted(v['name'] for tg, v, hit, c in near_rows if hit and c == g),
        }

    out = {
        'schema': 'forest-service-admin-sites/v1',
        'meta': {
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'built_by': 'scripts/policy/build_forest_service_admin_sites.py',
            'brief': 'forest-service-admin-site-leases-2026',
            'sources': {
                'nfs_acres': LANDS.rsplit('/query', 1)[0],
                'offices': OFFICES.rsplit('/query', 1)[0],
                'land_area': GAZETTEER,
                'town_centers': 'data/co-place-centroids.json',
                'county_boundaries': 'data/co-county-boundaries.json',
            },
            'method': ('nfs_acres sums GIS acres of land the Forest Service owns in each county; nfs_share divides it by '
                       'the Census 2024 Gazetteer land area. Offices are Forest Service records with a forest name or a '
                       'Forest Service unit name, placed by listed city. towns_within_1_mile lists incorporated towns and '
                       'cities with Forest Service-owned land within one statute mile of the Census center point.'),
            'limits': [
                'An office is where Forest Service staff work, not a site offered for lease. The layer includes buildings the Forest Service rents from others, and only a regional forester recommends sites for leasing (Pub. L. 115-334, sec. 8623(c)).',
                'Distances are from each town\'s center point, so a town with forest at its edge can be missed.',
                'Forest land near a town can be leased only as one of no more than 10 isolated, undeveloped parcels of 40 acres or less nationwide each fiscal year (sec. 8623(a)(1)(A)(iii)).',
            ],
            'county_count': len(out_counties),
            'office_count': len(offices),
        },
        'counties': out_counties,
        'offices': offices,
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)}: {len(out_counties)} counties, {len(offices)} offices, '
          f"{sum(1 for c in out_counties.values() if c['nfs_acres'])} counties with forest land, "
          f"{sum(len(c['towns_within_1_mile']) for c in out_counties.values())} towns within a mile")


if __name__ == '__main__':
    main()
