"""M2: source agreement, not the label copy or a pinned market price."""
import csv
import importlib.util
import io
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read(rel):
    return json.loads((ROOT / rel).read_text())


redfin = load_module('redfin_m2', 'scripts/market/build_redfin_place_market_tracker.py')
acs = load_module('acs_m2', 'scripts/build_acs_rent_co.py')


def test_acs_every_published_place_and_county_median():
    actual = acs.build_artifact()
    committed = read('data/market/acs_median_rent_co.json')
    config = read('data/hna/geo-config.json')
    counts = defaultdict(int)
    for kind in ('counties', 'places', 'cdps'):
        for geo in config[kind]:
            geoid = geo['geoid']
            p = read('data/hna/summary/' + geoid + '.json')['acsProfile']
            assert str(p['_acsYear']) == '2024' and p['_acsSeries'] == 'acs5'
            expected = p['DP04_0134E']
            if expected is not None and expected <= 0:
                expected = None
            bucket = 'counties' if kind == 'counties' else 'places'
            for doc in (actual, committed):
                row = doc[bucket][geoid]
                assert row['median_gross_rent'] == expected, geoid
                assert row['county_fips'] == (geoid if kind == 'counties' else geo['containingCounty'])
                if expected is None:
                    assert row['unavailable_reason']
            counts[bucket] += 1
    assert counts['counties'] == 64
    assert counts['places'] == len(config['places']) + len(config['cdps']) > 0


def test_every_zip_place_weight_uses_homes_not_acres():
    housing = read('data/market/census2020-place-tract-housing-co.json')
    crosswalk = read('data/market/hud_zip_tract_crosswalk_co.json')
    assert housing['meta']['block_count'] > 100000
    assert housing['meta']['county_count'] == 64
    assert sum(housing['tract_housing_units'].values()) == housing['meta']['state_housing_units']
    expected = defaultdict(lambda: defaultdict(float))
    tract_places = defaultdict(list)
    for geoid, place in housing['places'].items():
        assert sum(t['housing_units'] for t in place['tracts']) == place['housing_units']
        for tract in place['tracts']:
            denominator = housing['tract_housing_units'][tract['tract_geoid']]
            assert tract['tract_housing_units'] == denominator
            if denominator:
                tract_places[tract['tract_geoid']].append((geoid, tract['housing_units'] / denominator))
    for row in crosswalk['rows']:
        for geoid, share in tract_places[row['tract']]:
            if row['res_ratio'] and share:
                expected[row['zip']][geoid] += row['res_ratio'] * share
    actual = redfin.build_zip_place_weights(crosswalk, housing)
    assert len(actual) == len(expected) > 0
    scanned = 0
    for zip_code, allocations in expected.items():
        assert {r['geoid']: r['weight'] for r in actual[zip_code]} == {
            geoid: round(weight, 6) for geoid, weight in allocations.items()}
        scanned += len(allocations)
    assert scanned > 100
    # Rural geography is the original defect: Wray's populated blocks must
    # carry the homes, not its 0.26% share of this very large tract's land.
    wray = housing['places']['0886310']['tracts']
    assert any(t['housing_units'] / t['tract_housing_units'] > .5 for t in wray)


def test_city_observation_is_not_averaged_or_relabelled():
    config = read('data/hna/geo-config.json')
    keys = ['STATE_CODE', 'REGION_TYPE', 'PROPERTY_TYPE', 'CITY', 'PERIOD_DURATION',
            'PERIOD_BEGIN', 'PERIOD_END', 'MEDIAN_SALE_PRICE', 'HOMES_SOLD', 'TABLE_ID']
    # Fixture values exercise parsing/join/window choice; real dollar amounts
    # and coverage are checked against the rebuilt artifact separately.
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=keys, delimiter='\t')
    writer.writeheader()
    base = dict(zip(keys, ['CO', 'place', 'All Residential', 'Boulder', '30',
        '2026-05-01', '2026-05-31', '431234', '21', 'test-city']))
    writer.writerow(base)
    writer.writerow(dict(base, PERIOD_DURATION='90', MEDIAN_SALE_PRICE='987654'))
    writer.writerow(dict(base, CITY='Ouray', HOMES_SOLD='2'))
    writer.writerow(dict(base, CITY='Colorado Springs', MEDIAN_SALE_PRICE='NA', HOMES_SOLD='NA'))
    stream.seek(0)
    cities, absent = redfin.city_observations(stream, config)
    row = cities['0807850']['2026-05']
    assert row['median_sale_price'] == float(base['MEDIAN_SALE_PRICE'])
    assert row['source_period_duration_days'] == 30
    assert row['source_level'] == 'redfin_city_observed'
    assert '0816000' in absent and '0816000' not in cities
    ouray = next(g['geoid'] for g in config['places'] if g['label'] == 'Ouray (city)')
    assert cities[ouray]['2026-05']['median_sale_price'] == float(base['MEDIAN_SALE_PRICE'])
    assert cities[ouray]['2026-05']['homes_sold_allocated'] == 2


def test_model_review_flag_matches_latest_real_car():
    report = redfin.latest_real_car()
    doc = read('data/market/redfin_place_market_tracker_co.json')
    scanned = flagged = 0
    for place in doc['places'].values():
        if place['source_level'] != 'redfin_zip_to_place_modeled':
            continue
        sf = report['counties'].get(place.get('county_fips'), {}).get('single_family', {})
        price = place['latest']['median_sale_price']
        if not price or not sf.get('median_sale_price') or sf.get('closed_sales', 0) < 20:
            continue
        scanned += 1
        flag = redfin.review_flag(price, place['county_fips'], report)
        assert place.get('review_flag') == flag
        if price > sf['median_sale_price'] * 1.1:
            flagged += 1
            assert flag and flag['car_median'] == sf['median_sale_price']
            assert flag['percentage_gap'] == (price / sf['median_sale_price'] - 1) * 100
    assert scanned > 0
    # Exercise the threshold even if the observed-city replacement removes
    # all current breaches; a synthetic modeled value must still be flagged.
    fips, c = next((f, c) for f, c in report['counties'].items()
                  if c['single_family']['closed_sales'] >= 20 and c['single_family']['median_sale_price'])
    assert redfin.review_flag(c['single_family']['median_sale_price'] * 1.2, fips, report)


def test_colorado_springs_uses_verified_city_observation_not_invented_zip_sales():
    source = read('data/market/redfin-city-observations-co.json')['places']['0816000']
    place = read('data/market/redfin_place_market_tracker_co.json')['places']['0816000']
    assert place['source_level'] == 'redfin_city_observed'
    assert place['latest']['median_sale_price'] == source['median_sale_price']
    assert place['latest_period'] == source['period']
    assert place['source_url'] == source['source_url']
    assert place['latest']['homes_sold_allocated'] == source['homes_sold']
    assert place['latest']['source_period_duration_days'] == source['source_period_duration_days']
