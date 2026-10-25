"""The OSM land-use proxy is thinned to stay under the 5 MiB data guard.

Same-category points in one grid cell merge into one point with a count;
no OSM feature is lost from the totals and every category stays on the map.
"""

import importlib.util
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'data', 'market', 'landuse_zoning_proxy_co.geojson')
_spec = importlib.util.spec_from_file_location(
    'build_osm_landuse', os.path.join(ROOT, 'scripts', 'market', 'build_osm_landuse.py'))
builder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(builder)

KEPT_PROPS = {'name', 'zone_proxy', 'building', 'landuse', 'mf_suitability', 'count'}


def _pt(lon, lat, zone, **props):
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
            'properties': dict(zone_proxy=zone, mf_suitability=90, osm_id=1, osm_type='way',
                               levels='', landuse='', **props)}


def test_same_cell_same_category_merges_with_count():
    feats = [_pt(-104.98001, 39.74901, 'multifamily_residential', name='A', building='apartments'),
             _pt(-104.98003, 39.74903, 'multifamily_residential', name='A', building='apartments'),
             _pt(-104.98002, 39.74902, 'commercial', building='')]
    out = builder.thin_features(feats)
    assert len(out) == 2
    mf = [f for f in out if f['properties']['zone_proxy'] == 'multifamily_residential'][0]
    assert mf['properties']['count'] == 2
    assert mf['properties']['name'] == 'A'
    com = [f for f in out if f['properties']['zone_proxy'] == 'commercial'][0]
    assert 'count' not in com['properties']
    for f in out:
        assert set(f['properties']) <= KEPT_PROPS
        assert 'building' not in f['properties'] or f['properties']['building']


def test_rethinning_keeps_osm_totals():
    feats = [_pt(-105.0 + i * 0.0002, 39.7, 'townhome_residential') for i in range(20)]
    once = builder.thin_features(feats)
    twice = builder.thin_features(once)
    assert sum(f['properties'].get('count', 1) for f in once) == 20
    assert sum(f['properties'].get('count', 1) for f in twice) == 20


def test_committed_file_is_thinned_under_guard_and_keeps_totals():
    assert os.path.getsize(OUT) <= 5 * 1024 * 1024
    with open(OUT) as fh:
        doc = json.load(fh)
    meta = doc['metadata']
    feats = doc['features']
    assert meta['feature_count'] == len(feats)
    assert meta['osm_feature_count'] == sum(f['properties'].get('count', 1) for f in feats)
    pulled = {c for c, n in meta['category_counts'].items() if n}
    assert pulled <= {f['properties']['zone_proxy'] for f in feats}
    for f in feats:
        assert set(f['properties']) <= KEPT_PROPS


def test_failed_queries_keep_thinned_file_unchanged(tmp_path, monkeypatch):
    with open(OUT) as fh:
        before = json.load(fh)
    out = tmp_path / 'landuse.geojson'
    out.write_text(json.dumps(before))

    def fail(_query):
        raise RuntimeError('HTTP Error 502: Bad Gateway')

    monkeypatch.setattr(builder, 'OUT_PATH', out)
    monkeypatch.setattr(builder, 'overpass_query', fail)
    monkeypatch.setattr(builder.time, 'sleep', lambda _s: None)
    builder.main()
    after = json.loads(out.read_text())
    key = lambda f: (f['properties']['zone_proxy'], f['geometry']['coordinates'])
    assert sorted(after['features'], key=key) == sorted(before['features'], key=key)
    assert after['metadata']['osm_feature_count'] == before['metadata']['osm_feature_count']
    assert 'merged into one point' in after['metadata']['coverage_note']


def test_committed_coverage_note_discloses_merging():
    with open(OUT) as fh:
        meta = json.load(fh)['metadata']
    assert 'merged into one point' in meta['coverage_note']
