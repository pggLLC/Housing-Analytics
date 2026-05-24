"""Focused tests for HUD FMR response parsing and county normalization."""

import os
import sys


_SCRIPTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'scripts')
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from fetch_fmr_api import (  # noqa: E402
    _expand_metroareas_to_counties,
    _extract_fmr_records,
    build_combined,
)


def _metro_record(name, code, *, eff=1000, one=1100, two=1300, three=1700, four=1900):
    return {
        'metro_name': name,
        'code': code,
        'Efficiency': eff,
        'One-Bedroom': one,
        'Two-Bedroom': two,
        'Three-Bedroom': three,
        'Four-Bedroom': four,
    }


DENVER_RECORD = _metro_record(
    'Denver-Aurora-Lakewood, CO MSA',
    'METRO19740M19740',
    eff=1348,
    one=1484,
    two=1802,
    three=2386,
    four=2750,
)
BOULDER_RECORD = _metro_record(
    'Boulder, CO MSA',
    'METRO14500M14500',
    eff=1462,
    one=1611,
    two=2008,
    three=2822,
    four=3183,
)
ALAMOSA_RECORD = _metro_record(
    'Alamosa County, CO',
    'NCNTY08003CO',
    eff=736,
    one=754,
    two=940,
    three=1263,
    four=1378,
)


def test_extract_fmr_records_detects_data_metroareas():
    payload = {'data': {'year': '2026', 'metroareas': [DENVER_RECORD, ALAMOSA_RECORD]}}

    records, shape = _extract_fmr_records(payload)

    assert shape == 'data.metroareas'
    assert records == [DENVER_RECORD, ALAMOSA_RECORD]


def test_extract_fmr_records_supports_legacy_shapes():
    legacy_payloads = [
        ({'data': [{'fips_code': '08001'}]}, 'data'),
        ({'counties': [{'fips_code': '08003'}]}, 'counties'),
        ({'results': [{'fips_code': '08005'}]}, 'results'),
        ({'fmr_data': [{'fips_code': '08007'}]}, 'fmr_data'),
        ({'data': {'counties': [{'fips_code': '08009'}]}}, 'data.counties'),
    ]

    for payload, expected_shape in legacy_payloads:
        records, shape = _extract_fmr_records(payload)
        assert shape == expected_shape
        assert len(records) == 1


def test_expand_metroareas_to_counties_maps_metro_and_non_metro_records():
    counties = _expand_metroareas_to_counties([DENVER_RECORD, ALAMOSA_RECORD], {})

    assert len([row for row in counties if row['fmr_area_code'] == 'METRO19740CO']) == 10
    alamosa = next(row for row in counties if row['fips'] == '08003')
    assert alamosa['county_name'] == 'Alamosa County'
    assert alamosa['fmr_area_name'] == 'Alamosa County FMR Area'
    assert alamosa['fmr']['two_br'] == 940


def test_expand_metroareas_to_counties_uses_il_data_for_county_name_and_ami():
    counties = _expand_metroareas_to_counties(
        [BOULDER_RECORD],
        {'08013': {'county_name': 'Boulder County (IL)', 'median_income': 135000}},
    )

    assert len(counties) == 1
    assert counties[0]['fips'] == '08013'
    assert counties[0]['county_name'] == 'Boulder County (IL)'
    assert counties[0]['fmr_area_name'] == 'Boulder HUD Metro FMR Area'
    assert counties[0]['fmr_area_code'] == 'METRO14500CO'
    assert counties[0]['fmr']['two_br'] == 2008
    assert counties[0]['income_limits']['ami_4person'] == 135000


def test_expand_metroareas_to_counties_uses_statewide_ami_fallback():
    counties = _expand_metroareas_to_counties([ALAMOSA_RECORD], {})

    assert counties[0]['income_limits']['ami_4person'] == 107200
    assert counties[0]['fips'] == '08003'


def test_build_combined_logs_detected_shape_and_normalizes_metroareas(capsys):
    result = build_combined(
        {'data': {'metroareas': [DENVER_RECORD, ALAMOSA_RECORD]}},
        None,
        '2026-01-01T00:00:00Z',
    )

    captured = capsys.readouterr()

    assert 'HUD response shape detected: data.metroareas' in captured.out
    assert result['meta']['county_count'] == 11
    assert {row['fips'] for row in result['counties'] if row['fmr_area_code'] == 'METRO19740CO'} == {
        '08001', '08005', '08014', '08019', '08031',
        '08035', '08039', '08047', '08059', '08093',
    }


def test_build_combined_preserves_legacy_flat_county_records():
    result = build_combined(
        {
            'data': [
                {
                    'fips_code': '08091',
                    'county_name': 'Ouray County',
                    'Efficiency': 700,
                    'One-Bedroom': 750,
                    'Two-Bedroom': 900,
                    'Three-Bedroom': 1100,
                    'Four-Bedroom': 1200,
                    'median_income': 82000,
                }
            ]
        },
        None,
        '2026-01-01T00:00:00Z',
    )

    assert result['counties'][0]['fips'] == '08091'
    assert result['counties'][0]['county_name'] == 'Ouray County'
    assert result['counties'][0]['income_limits']['ami_4person'] == 82000


def test_build_combined_normalizes_three_digit_county_fips():
    result = build_combined(
        {
            'data': [
                {
                    'fips_code': '091',
                    'county_name': 'Ouray County',
                    'Efficiency': 700,
                    'One-Bedroom': 750,
                    'Two-Bedroom': 900,
                    'Three-Bedroom': 1100,
                    'Four-Bedroom': 1200,
                    'median_income': 82000,
                }
            ]
        },
        None,
        '2026-01-01T00:00:00Z',
    )

    assert result['counties'][0]['fips'] == '08091'
