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
    federal_fiscal_year,
)
import datetime  # noqa: E402


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


COLORADO_SPRINGS_RECORD = _metro_record(
    'Colorado Springs, CO HUD Metro FMR Area',
    'METRO17820M17820',
    eff=1196,
    one=1464,
    two=1735,
    three=2413,
    four=2744,
)
TELLER_RECORD = _metro_record(
    'Teller County, CO HUD Metro FMR Area',
    'METRO17820N08119',
    eff=1029,
    one=1362,
    two=1493,
    three=2076,
    four=2505,
)


def test_teller_county_keeps_its_own_fmr_area_in_either_order():
    # HUD's FY2026 statedata lists Teller as its own HMFA inside the
    # Colorado Springs MSA. Its code shares the 17820 prefix, which once
    # gave Teller El Paso's rents; first-wins de-duping made the result
    # depend on response order.
    for records in ([COLORADO_SPRINGS_RECORD, TELLER_RECORD],
                    [TELLER_RECORD, COLORADO_SPRINGS_RECORD]):
        rows = {}
        for row in _expand_metroareas_to_counties(records, {}):
            rows.setdefault(row['fips'], row)
        assert rows['08041']['fmr']['two_br'] == 1735
        assert rows['08041']['fmr_area_code'] == 'METRO17820CO'
        assert rows['08119']['fmr']['two_br'] == 1493
        assert rows['08119']['fmr_area_code'] == 'METRO17820N08119'
        assert rows['08119']['fmr_area_name'] == 'Teller County HUD Metro FMR Area'


def test_unmapped_sub_area_code_is_not_spread_across_the_msa():
    other = _metro_record('Somewhere, CO HUD Metro FMR Area', 'METRO17820N08999', two=999)
    rows = _expand_metroareas_to_counties([other], {})
    assert all(row['fmr']['two_br'] != 999 for row in rows)


def test_expand_metroareas_to_counties_prefers_canonical_name_and_falls_back_to_il_name():
    counties = _expand_metroareas_to_counties(
        [BOULDER_RECORD],
        {'08013': {'county_name': 'Boulder County (IL)', 'median_income': 135000}},
    )

    assert len(counties) == 1
    assert counties[0]['fips'] == '08013'
    assert counties[0]['county_name'] == 'Boulder County'
    assert counties[0]['fmr_area_name'] == 'Boulder HUD Metro FMR Area'
    assert counties[0]['fmr_area_code'] == 'METRO14500CO'
    assert counties[0]['fmr']['two_br'] == 2008
    assert counties[0]['income_limits']['ami_4person'] == 135000

    unknown_fips_record = _metro_record(
        'Example County, CO',
        'NCNTY08999CO',
    )
    fallback = _expand_metroareas_to_counties(
        [unknown_fips_record],
        {'08999': {'county_name': 'Example County (IL)', 'median_income': 99000}},
    )

    assert len(fallback) == 1
    assert fallback[0]['fips'] == '08999'
    assert fallback[0]['county_name'] == 'Example County (IL)'
    assert fallback[0]['income_limits']['ami_4person'] == 99000


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

    # F120 — log message was pluralized when the parser was extended to surface
    # multiple detected shapes per response. Was: "HUD response shape detected: X"
    # Now: "HUD response shapes detected: ['X']".
    assert "HUD response shapes detected: ['data.metroareas']" in captured.out
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


def test_fetches_the_fiscal_year_in_effect():
    # FY2027 FMRs take effect Oct 1, 2026; a hard-coded year kept the
    # fetch on FY2026 after that date.
    assert federal_fiscal_year(datetime.date(2026, 9, 30)) == 2026
    assert federal_fiscal_year(datetime.date(2026, 10, 1)) == 2027
    assert federal_fiscal_year(datetime.date(2027, 1, 15)) == 2027


def test_committed_fmrs_agree_with_hud_county_records():
    # HUD's statedata response lists every county with the FMRs of the area
    # it belongs to. The combined file must carry the same numbers, whatever
    # area mapping produced them.
    import json
    root = os.path.join(os.path.dirname(__file__), '..', 'data')
    with open(os.path.join(root, 'market', 'fmr_co.json'), encoding='utf-8') as fh:
        raw = json.load(fh)['data']['data']['counties']
    with open(os.path.join(root, 'hud-fmr-income-limits.json'), encoding='utf-8') as fh:
        combined = {c['fips']: c for c in json.load(fh)['counties']}
    keys = [('Efficiency', 'efficiency'), ('One-Bedroom', 'one_br'), ('Two-Bedroom', 'two_br'),
            ('Three-Bedroom', 'three_br'), ('Four-Bedroom', 'four_br')]
    assert len(raw) == 64
    for record in raw:
        fips = str(record['fips_code'])[:5]
        got = [combined[fips]['fmr'][k] for _, k in keys]
        want = [record[k] for k, _ in keys]
        assert got == want, f"{record['county_name']} ({fips}): {got} != HUD {want}"
