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
import csv
import io
import zipfile
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
    dropped = parts['dropped_cdot']['rows']
    assert len(dropped) == 3
    assert dropped[0] == {'stop_id': None, 'name': ' ', 'agency': 'MVT',
                          'coordinates': [0, 0], 'reason': 'no_location'}
    assert dropped[-1]['coordinates'] == [-121.5, 38.58]
    assert dropped[-1]['reason'] == 'outside_colorado'
    report = B.build_report(feats, parts, COUNTIES, 'fixture', [], 1)
    assert report['cdot_gaps']['dropped_rows'] == dropped


def test_non_stop_location_types_are_excluded(tmp_path, monkeypatch):
    """Parse an actual GTFS ZIP; constants matching themselves prove nothing."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as archive:
        stops = io.StringIO()
        writer = csv.writer(stops)
        writer.writerow(['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type'])
        for kind in ['', '0', '1', '2', '3', '4']:
            writer.writerow(['type-' + kind, 'Stop ' + kind, DENVER[1], DENVER[0], kind])
        archive.writestr('stops.txt', stops.getvalue())
        archive.writestr('agency.txt', 'agency_id,agency_name\nrtd,Regional Transportation District\n')
    monkeypatch.setattr(B.gtfs, 'CACHE_DIR', tmp_path)
    monkeypatch.setattr(B.gtfs, 'fetch_mdb_catalog', lambda: 'fixture')
    monkeypatch.setattr(B.gtfs, 'load_co_feeds', lambda _: [{'agency': 'Catalog name', 'url': 'fixture'}])
    monkeypatch.setattr(B.gtfs, 'fetch_url', lambda *args, **kwargs: buf.getvalue())
    rows, failed = B.fetch_feed_stops()
    assert not failed
    assert {r['stop_id'] for r in rows} == {'type-', 'type-0', 'type-1'}
    assert all(r['agency'] == 'Regional Transportation District' for r in rows)


def test_unnamed_cdot_agency_is_enriched_only_from_unambiguous_feed():
    cdot = [_row(DENVER, 'Unnamed agency', '')]
    feeds = [_row(_offset(DENVER, 20), 'Named feed stop', 'Regional Transportation District')]
    features, _ = B.merge(cdot, feeds, [], COUNTIES)
    p = features[0]['properties']
    assert p['agency'] == 'RTD'
    assert p['agency_source'] == 'agency_feed'
    assert p['sources'] == ['cdot', 'agency_feed']
    assert features[0]['geometry']['coordinates'] == list(DENVER), 'CDOT location remains primary'
    # Co-located feeds with different agencies must not pick a winner by
    # fetch order, and a distant stop must not lend its agency to CDOT.
    feeds.append(_row(_offset(DENVER, 20), 'Another feed', 'Home James'))
    for candidates in [feeds, list(reversed(feeds)), [_row(_offset(DENVER, 31), agency='RTD')]]:
        features, _ = B.merge(cdot, candidates, [], COUNTIES)
        assert features[0]['properties']['agency'] == B.UNLISTED_AGENCY


def test_private_operator_aliases_preserve_classification():
    for raw_name in ['Colorado Mountain Express', 'Epic Mountain Express']:
        features, _ = B.merge([_row(DENVER, agency='')], [_row(DENVER, agency=raw_name)], [], COUNTIES)
        p = features[0]['properties']
        assert p['agency'] == 'Epic Mountain Express'
        assert p['operator'] == 'private_shuttle'
    public, _ = B.merge([_row(DENVER, agency='Mountain Express')], [], [], COUNTIES)
    assert public[0]['properties']['operator'] == 'public', 'Crested Butte service is a different operator'


def test_unnamed_agency_uses_id_and_name_agreement_at_a_shared_stop():
    cdot = [dict(_row(DENVER, 'Shared stop', ''), stop_id='20')]
    feeds = [dict(_row(DENVER, 'Shared stop', 'RTD'), stop_id='20'),
             dict(_row(_offset(DENVER, 5), 'Different platform', 'Home James'), stop_id='20')]
    features, _ = B.merge(cdot, feeds, [], COUNTIES)
    assert features[0]['properties']['agency'] == 'RTD'
    feeds[1]['name'] = 'Shared stop'
    features, _ = B.merge(cdot, feeds, [], COUNTIES)
    assert features[0]['properties']['agency'] == B.UNLISTED_AGENCY, 'conflicting identities remain unknown'


def test_dropped_cdot_row_identifies_the_source_record():
    row = dict(_row((0, 0), 'CDOT bad position', 'MVT'), stop_id='source-963')
    features, parts = B.merge([row], [], [], COUNTIES)
    assert not features
    assert parts['dropped_cdot']['rows'] == [{
        'stop_id': 'source-963', 'name': 'CDOT bad position', 'agency': 'MVT',
        'coordinates': [0, 0], 'reason': 'no_location'}]


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
    per_agency = Counter(f['properties']['agency'] for f in feats)
    assert {a['agency']: a['cdot'] + a['agency_feed_only'] + a['unconfirmed']
            for a in report['agencies']} == dict(per_agency)
    gaps = report['cdot_gaps']
    dropped = gaps['dropped_rows']
    assert len(dropped) == gaps['rows_without_location'] + gaps['rows_outside_colorado']
    reasons = Counter(r['reason'] for r in dropped)
    assert reasons['no_location'] == gaps['rows_without_location']
    assert reasons['outside_colorado'] == gaps['rows_outside_colorado']
    assert all({'stop_id', 'name', 'agency', 'coordinates', 'reason'} <= set(r) for r in dropped)


# ── Refresh must not replace good data with a filtered-away response ────────

def _cdot_feature():
    return {'properties': {'sources': ['cdot']}}


def test_cdot_shortfall_rules():
    assert B.cdot_shortfall([], None).startswith('No CDOT stop survived')
    assert B.cdot_shortfall([{'properties': {'sources': ['osm']}}], 100).startswith('No CDOT stop survived')
    assert 'fell from 100 to 79' in B.cdot_shortfall([_cdot_feature()] * 79, 100)
    assert B.cdot_shortfall([_cdot_feature()] * 80, 100) is None
    assert B.cdot_shortfall([_cdot_feature()] * 5, None) is None   # first build: any real count


def test_out_of_state_cdot_response_does_not_overwrite(tmp_path, monkeypatch):
    """A non-empty CDOT response whose rows all fall outside Colorado
    (projected coordinates, a wrong layer) must leave both outputs untouched."""
    import shutil
    import sys
    stops = tmp_path / 'stops.geojson'
    report = tmp_path / 'report.json'
    shutil.copy(STOPS, stops)
    shutil.copy(REPORT, report)
    before = (stops.read_bytes(), report.read_bytes())
    monkeypatch.setattr(B, 'OUT_STOPS', stops)
    monkeypatch.setattr(B, 'OUT_REPORT', report)
    monkeypatch.setattr(B, 'fetch_cdot', lambda: [
        {'lon': -121.5 + i * 1e-4, 'lat': 38.58, 'name': f'S{i}', 'agency': 'X'} for i in range(500)])
    monkeypatch.setattr(sys, 'argv', ['build_transit_stops_co.py', '--skip-feeds'])
    assert B.main() == 1
    assert (stops.read_bytes(), report.read_bytes()) == before
