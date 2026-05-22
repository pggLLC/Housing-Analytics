"""tests/test_fmr_parsing.py

Unit tests for the HUD FMR API response parsing and normalization logic in
scripts/fetch_fmr_api.py.

These tests cover the three new helper functions added to handle the current
HUD statedata endpoint response shape (``data.metroareas``) as well as the
legacy flat-list and ``results``/``fmr_data`` shapes.  No network calls are
made; all tests use inline mock payloads based on the actual log output from
the failing workflow run (26285286854).
"""

import os
import sys

import pytest

# Make scripts/ importable regardless of cwd
_SCRIPTS = os.path.join(os.path.dirname(__file__), '..', 'scripts')
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from fetch_fmr_api import (
    _expand_metroareas_to_counties,
    _extract_fmr_records,
    _match_metro_area,
    build_combined,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _metro_area_record(metro_name, code, eff=1200, one=1300, two=1600,
                        three=2100, four=2400):
    """Return a minimal HUD metroareas record."""
    return {
        'metro_name': metro_name,
        'code': code,
        'Efficiency': eff,
        'One-Bedroom': one,
        'Two-Bedroom': two,
        'Three-Bedroom': three,
        'Four-Bedroom': four,
    }


# Minimal payloads matching the logged API response format
_BOULDER_RECORD = _metro_area_record(
    'Boulder, CO MSA', 'METRO14500M14500',
    eff=1462, one=1611, two=2008, three=2822, four=3183,
)
_DENVER_RECORD = _metro_area_record(
    'Denver-Aurora, CO MSA', 'METRO19740M19740',
    eff=1348, one=1484, two=1802, three=2386, four=2750,
)
_ALAMOSA_RECORD = _metro_area_record(
    'Alamosa County, CO', 'NCNTY08003CO',
    eff=736, one=754, two=940, three=1263, four=1378,
)
_COSPGS_RECORD = _metro_area_record(
    'Colorado Springs, CO MSA', 'METRO17820M17820',
    eff=1100, one=1200, two=1500, three=2000, four=2300,
)

_MOCK_METROAREAS_PAYLOAD = {
    'data': {
        'year': '2025',
        'metroareas': [
            _BOULDER_RECORD,
            _DENVER_RECORD,
            _ALAMOSA_RECORD,
            _COSPGS_RECORD,
        ],
    }
}


# ---------------------------------------------------------------------------
# _extract_fmr_records
# ---------------------------------------------------------------------------

class TestExtractFmrRecords:

    def test_detects_metroareas_shape(self):
        records, shape = _extract_fmr_records(_MOCK_METROAREAS_PAYLOAD)
        assert shape == 'metroareas'
        assert len(records) == 4

    def test_detects_legacy_flat_list(self):
        payload = {'data': [{'fips_code': '08001', 'Efficiency': 1000}]}
        records, shape = _extract_fmr_records(payload)
        assert shape == 'list'
        assert len(records) == 1

    def test_detects_nested_counties_key(self):
        payload = {'data': {'counties': [{'fips': '08003'}]}}
        records, shape = _extract_fmr_records(payload)
        assert shape == 'counties'
        assert len(records) == 1

    def test_detects_results_key(self):
        payload = {'results': [{'fips': '08001'}]}
        records, shape = _extract_fmr_records(payload)
        assert shape == 'results'
        assert len(records) == 1

    def test_detects_fmr_data_key(self):
        payload = {'fmr_data': [{'fips': '08031'}]}
        records, shape = _extract_fmr_records(payload)
        assert shape == 'fmr_data'

    def test_empty_payload_returns_none(self):
        records, shape = _extract_fmr_records({})
        assert shape is None
        assert records == []

    def test_empty_metroareas_list_returns_none(self):
        payload = {'data': {'year': '2025', 'metroareas': []}}
        records, shape = _extract_fmr_records(payload)
        assert shape is None
        assert records == []

    def test_empty_data_list_returns_none(self):
        records, shape = _extract_fmr_records({'data': []})
        assert shape is None
        assert records == []


# ---------------------------------------------------------------------------
# _match_metro_area
# ---------------------------------------------------------------------------

class TestMatchMetroArea:

    def test_boulder_msa_code(self):
        result = _match_metro_area('METRO14500M14500')
        assert result is not None
        area_name, area_code = result
        assert area_name == 'Boulder HUD Metro FMR Area'
        assert area_code == 'METRO14500CO'

    def test_denver_msa_code(self):
        result = _match_metro_area('METRO19740M19740')
        assert result is not None
        assert result[0] == 'Denver-Aurora-Lakewood HUD Metro FMR Area'

    def test_colorado_springs_msa_code(self):
        result = _match_metro_area('METRO17820M17820')
        assert result is not None
        assert result[0] == 'Colorado Springs HUD Metro FMR Area'

    def test_direct_internal_code_match(self):
        # Our internal codes should also match directly
        result = _match_metro_area('METRO14500CO')
        assert result is not None
        assert result[0] == 'Boulder HUD Metro FMR Area'

    def test_hmfa_code_numeric_extraction(self):
        # Edwards HMFA: code HMFA16620CO internally, API may send HMFA16620M16620
        result = _match_metro_area('HMFA16620M16620')
        assert result is not None
        assert result[0] == 'Edwards HUD Metro FMR Area'

    def test_ncnty_code_returns_none(self):
        # Non-metro county codes should not match any metro area
        assert _match_metro_area('NCNTY08003CO') is None

    def test_unknown_code_returns_none(self):
        assert _match_metro_area('METRO99999XX') is None

    def test_empty_code_returns_none(self):
        assert _match_metro_area('') is None


# ---------------------------------------------------------------------------
# _expand_metroareas_to_counties
# ---------------------------------------------------------------------------

class TestExpandMetroareasToCounties:

    def _run(self, records, il_index=None):
        return _expand_metroareas_to_counties(records, il_index or {})

    def test_boulder_expands_to_one_county(self):
        counties = self._run([_BOULDER_RECORD])
        assert len(counties) == 1
        assert counties[0]['fips'] == '08013'

    def test_boulder_county_uses_internal_area_code(self):
        counties = self._run([_BOULDER_RECORD])
        assert counties[0]['fmr_area_code'] == 'METRO14500CO'
        assert counties[0]['fmr_area_name'] == 'Boulder HUD Metro FMR Area'

    def test_boulder_county_name_from_static_fallback(self):
        counties = self._run([_BOULDER_RECORD])
        assert counties[0]['county_name'] == 'Boulder County'

    def test_denver_expands_to_ten_counties(self):
        counties = self._run([_DENVER_RECORD])
        assert len(counties) == 10

    def test_denver_all_fips_are_valid(self):
        counties = self._run([_DENVER_RECORD])
        for c in counties:
            assert len(c['fips']) == 5, f'FIPS {c["fips"]} is not 5 digits'
            assert c['fips'].startswith('08')

    def test_alamosa_non_metro_single_county(self):
        counties = self._run([_ALAMOSA_RECORD])
        assert len(counties) == 1
        assert counties[0]['fips'] == '08003'

    def test_alamosa_fmr_values_preserved(self):
        counties = self._run([_ALAMOSA_RECORD])
        fmr = counties[0]['fmr']
        assert fmr['efficiency'] == 736
        assert fmr['two_br'] == 940
        assert fmr['four_br'] == 1378

    def test_alamosa_county_name_parsed_from_hud_name(self):
        counties = self._run([_ALAMOSA_RECORD])
        # "Alamosa County, CO" → "Alamosa County"
        assert counties[0]['county_name'] == 'Alamosa County'

    def test_alamosa_area_name_derived_from_county_name(self):
        counties = self._run([_ALAMOSA_RECORD])
        assert counties[0]['fmr_area_name'] == 'Alamosa County FMR Area'

    def test_all_fips_five_digits_rule1(self):
        all_records = [_BOULDER_RECORD, _DENVER_RECORD, _ALAMOSA_RECORD, _COSPGS_RECORD]
        counties = self._run(all_records)
        for c in counties:
            assert len(c['fips']) == 5, f'FIPS {c["fips"]} not 5 digits (Rule 1)'
            assert c['fips'].startswith('08')

    def test_income_limits_not_null_rule2(self):
        counties = self._run([_BOULDER_RECORD])
        il = counties[0]['income_limits']
        # ami_4person should be non-zero (fallback 107200)
        assert il['ami_4person'] > 0, 'ami_4person must not be zero (Rule 2)'

    def test_il_index_supplies_county_name_and_ami(self):
        il_index = {
            '08013': {
                'county_name': 'Boulder County (from IL)',
                'median_income': 135000,
            }
        }
        counties = _expand_metroareas_to_counties([_BOULDER_RECORD], il_index)
        assert counties[0]['county_name'] == 'Boulder County (from IL)'
        assert counties[0]['income_limits']['ami_4person'] == 135000

    def test_il_index_ami_used_for_income_limits(self):
        il_index = {'08013': {'median_income': 120000}}
        counties = _expand_metroareas_to_counties([_BOULDER_RECORD], il_index)
        # 50% AMI for 4-person = 120000 * 0.50 * 1.00 = 60000 (no rounding needed here)
        assert counties[0]['income_limits']['il50_4person'] == 60000

    def test_zero_ami_in_il_index_uses_statewide_fallback(self):
        # If IL row has median_income=0, the CO statewide fallback (107200) must apply
        il_index = {'08013': {'county_name': 'Boulder County', 'median_income': 0}}
        counties = _expand_metroareas_to_counties([_BOULDER_RECORD], il_index)
        ami = counties[0]['income_limits']['ami_4person']
        assert ami == 107200, f'Expected CO statewide fallback 107200, got {ami}'

    def test_skips_non_co_fips_codes(self):
        non_co = _metro_area_record('Some TX Metro', 'NCNTY48001TX',
                                    eff=900, one=1000, two=1300, three=1700, four=2000)
        counties = _expand_metroareas_to_counties([non_co], {})
        assert len(counties) == 0, 'Non-CO FIPS entries should be skipped'

    def test_affordable_rents_present(self):
        counties = self._run([_ALAMOSA_RECORD])
        ar = counties[0]['affordable_rents_60pct']
        assert 'rent_60pct_1person' in ar
        assert 'rent_60pct_4person' in ar


# ---------------------------------------------------------------------------
# build_combined integration
# ---------------------------------------------------------------------------

class TestBuildCombined:

    def test_accepts_metroareas_payload(self):
        result = build_combined(_MOCK_METROAREAS_PAYLOAD, None, '2025-01-01T00:00:00Z')
        assert 'counties' in result
        assert len(result['counties']) > 0

    def test_output_has_required_meta_keys(self):
        result = build_combined(_MOCK_METROAREAS_PAYLOAD, None, '2025-01-01T00:00:00Z')
        meta = result['meta']
        assert 'generated' in meta
        assert 'county_count' in meta
        assert meta['generated'] == '2025-01-01T00:00:00Z'

    def test_county_count_in_meta_matches_list_length(self):
        result = build_combined(_MOCK_METROAREAS_PAYLOAD, None, '2025-01-01T00:00:00Z')
        assert result['meta']['county_count'] == len(result['counties'])

    def test_all_fips_five_digits(self):
        result = build_combined(_MOCK_METROAREAS_PAYLOAD, None, '2025-01-01T00:00:00Z')
        for c in result['counties']:
            assert len(c['fips']) == 5, f'Non 5-digit FIPS: {c["fips"]}'

    def test_legacy_flat_list_still_works(self):
        legacy_payload = {
            'data': [
                {
                    'fips_code': '08001',
                    'county_name': 'Adams County',
                    'Efficiency': 1348,
                    'One-Bedroom': 1484,
                    'Two-Bedroom': 1802,
                    'Three-Bedroom': 2386,
                    'Four-Bedroom': 2750,
                    'median_income': 124100,
                },
            ]
        }
        result = build_combined(legacy_payload, None, '2025-01-01T00:00:00Z')
        assert len(result['counties']) == 1
        assert result['counties'][0]['fips'] == '08001'
        assert result['counties'][0]['income_limits']['ami_4person'] == 124100
