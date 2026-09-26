"""Statewide transit-stop file (#1937 Phase 1).

Two layers:
  * the merge rules, on fixtures, so a change to the thresholds or source
    priority is caught without the network;
  * the committed file and its coverage report, which must agree with each
    other and with the Census county outlines, and must not regress on the
    counties the OpenStreetMap-only file left nearly empty.
"""

import importlib.util
import json
import os
from collections import Counter

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
STOPS = os.path.join(REPO_ROOT, 'data', 'amenities', 'transit_stops_statewide_co.geojson')
REPORT = os.path.join(REPO_ROOT, 'data', 'market', 'transit_stops_coverage_co.json')


def _builder():
    spec = importlib.util.spec_from_file_location(
        'build_transit_stops_co',
        os.path.join(REPO_ROOT, 'scripts', 'market', 'build_transit_stops_co.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


B = _builder()
COUNTIES = B.load_counties()


def _load(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


# ── Merge rules ─────────────────────────────────────────────────────────────

DENVER = (-104.9903, 39.7392)   # Denver County, 08031
ASPEN = (-106.8175, 39.1911)    # Pitkin County, 08097


def _offset(pt, metres_east):
    import math
    return (pt[0] + metres_east / (111320.0 * math.cos(math.radians(pt[1]))), pt[1])


def _row(pt, name='S', agency='RTD'):
    return {'lon': pt[0], 'lat': pt[1], 'name': name, 'agency': agency}


def test_merge_source_priority_and_thresholds():
    cdot = [
        _row(DENVER, 'Civic Center', 'RTD'),
        {'lon': 0, 'lat': 0, 'name': ' ', 'agency': 'MVT'},        # null island
        {'lon': None, 'lat': None, 'name': '', 'agency': 'MVT'},    # no geometry
        _row((-121.5, 38.58), 'Sacramento', 'El Dorado Transit'),    # outside Colorado
    ]
    feeds = [
        _row(_offset(DENVER, 20), 'Civic Center', 'Regional Transportation District'),  # same stop
        _row(_offset(DENVER, 200), 'Broadway', 'Regional Transportation District'),     # new stop
        _row(ASPEN, 'Rubey Park', 'RFTA'),
    ]
    osm = [
        {'lon': _offset(DENVER, 50)[0], 'lat': DENVER[1], 'name': 'dup of CDOT'},
        {'lon': _offset(ASPEN, 40)[0], 'lat': ASPEN[1], 'name': 'dup of feed'},
        {'lon': _offset(ASPEN, 900)[0], 'lat': ASPEN[1], 'name': 'OSM only'},
    ]
    feats, parts = B.merge(cdot, feeds, osm, COUNTIES)
    by_name = {f['properties']['name']: f['properties'] for f in feats}

    assert set(by_name) == {'Civic Center', 'Broadway', 'Rubey Park', 'OSM only'}
    assert by_name['Civic Center']['sources'] == ['cdot', 'agency_feed']
    assert by_name['Broadway']['sources'] == ['agency_feed']
    assert by_name['Broadway']['agency'] == 'RTD', 'agency aliases must collapse to one name'
    assert by_name['Rubey Park']['agency'] == 'Roaring Fork Transportation Authority'
    assert by_name['OSM only']['reliability'] == 'unconfirmed'
    assert by_name['Civic Center']['reliability'] == 'confirmed'
    assert by_name['Civic Center']['county_fips'] == '08031'
    assert by_name['Rubey Park']['county_fips'] == '08097'
    assert parts['dropped_cdot']['no_location'] == 2
    assert parts['dropped_cdot']['outside_colorado'] == 1
    assert parts['feed_added_by_agency'] == {'RTD': 1, 'Roaring Fork Transportation Authority': 1}
    assert parts['osm_added'] == 1


def test_non_stop_location_types_are_excluded():
    assert B.NON_STOP_LOCATION_TYPES == {'2', '3', '4'}


# ── Committed file ──────────────────────────────────────────────────────────

def test_every_stop_is_in_colorado_with_a_county():
    feats = _load(STOPS)['features']
    assert len(feats) > 10000, 'the statewide file has fewer stops than CDOT alone publishes'
    for f in feats:
        lon, lat = f['geometry']['coordinates']
        p = f['properties']
        assert B.in_colorado_bbox(lon, lat), f'stop outside Colorado: {p}'
        assert isinstance(p['county_fips'], str) and len(p['county_fips']) == 5 and p['county_fips'].startswith('08')
        assert p['sources'], 'every stop names its source'
        expected = 'unconfirmed' if p['sources'] == ['osm'] else 'confirmed'
        assert p['reliability'] == expected, f'reliability disagrees with sources: {p}'
        assert p['agency'] == B.normalize_agency(p['agency']) or p['agency'] == 'OpenStreetMap only', \
            f'agency name is not normalised: {p["agency"]}'


def test_report_agrees_with_the_stop_file():
    feats = _load(STOPS)['features']
    report = _load(REPORT)
    assert len(report['counties']) == 64, 'the report must carry all 64 counties'
    assert {c['county_fips'] for c in report['counties']} == {g for g, _, _ in COUNTIES}

    per_county = Counter(f['properties']['county_fips'] for f in feats)
    for c in report['counties']:
        assert c['total'] == per_county.get(c['county_fips'], 0), c
        assert c['total'] == c['cdot'] + c['agency_feed_only'] + c['unconfirmed'], c
        assert c['fixed_route_stops_found'] == (c['total'] > 0), c

    no_stop = sorted(c['county'] for c in report['counties'] if c['total'] == 0)
    assert report['counties_without_fixed_stops'] == no_stop
    assert report['totals']['stops'] == len(feats)
    assert _load(STOPS)['meta']['totals'] == report['totals']


def test_counties_the_osm_file_missed_are_now_covered():
    # OpenStreetMap-only stop counts before #1937 were Pitkin 3, San Miguel 2,
    # Montrose 3, Garfield 13, La Plata 2, Teller 0, Gilpin 0, Archuleta 0.
    floors = {'Pitkin': 150, 'San Miguel': 80, 'Montrose': 80, 'Garfield': 60,
              'La Plata': 100, 'Teller': 20, 'Gilpin': 10, 'Archuleta': 15, 'Denver': 2000}
    by_name = {c['county']: c for c in _load(REPORT)['counties']}
    short = {n: by_name[n]['total'] for n, floor in floors.items() if by_name[n]['total'] < floor}
    assert not short, f'counties below their stop floor: {short}'


def test_major_agencies_present():
    agencies = {a['agency'] for a in _load(REPORT)['agencies']}
    for needed in ['RTD', 'Mountain Metropolitan Transit', 'Transfort', 'Pueblo Transit',
                   'Roaring Fork Transportation Authority', 'Grand Valley Transit',
                   'Durango Transit', 'Summit Stage', 'Bustang Outrider']:
        assert needed in agencies, f'{needed} missing from the statewide stop file'
