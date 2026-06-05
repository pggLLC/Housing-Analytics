"""
tests/test_fmr_extractor.py — F256

Regression test for the HUD FMR extractor bug.

The old `_extract_fmr_records()` returned only the first non-empty list it
found in the API payload. HUD's /fmr/statedata/CO endpoint returns BOTH
`data.metroareas` and `data.counties` — the function silently dropped
counties, so our cache held only 17 of 64 Colorado counties.

The new `_extract_fmr_records_all()` returns every shape that's present.
This test pins that behaviour.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / 'scripts' / 'fetch_fmr_api.py'


def _load_script():
    spec = importlib.util.spec_from_file_location('fetch_fmr_api', SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_extract_all_returns_both_metroareas_and_counties():
    mod = _load_script()
    payload = {
        'data': {
            'metroareas': [
                {'code': 'METRO19740CO', 'metro_name': 'Denver MSA'},
                {'code': 'METRO14500CO', 'metro_name': 'Boulder'},
            ],
            'counties': [
                {'fips_code': '08067', 'county_name': 'La Plata County',
                 'code': 'NCNTY08067N08067'},
                {'fips_code': '08029', 'county_name': 'Delta County',
                 'code': 'NCNTY08029N08029'},
                {'fips_code': '08113', 'county_name': 'San Miguel County',
                 'code': 'NCNTY08113N08113'},
            ],
        }
    }

    all_records = mod._extract_fmr_records_all(payload)
    assert 'data.metroareas' in all_records
    assert 'data.counties' in all_records
    assert len(all_records['data.metroareas']) == 2
    assert len(all_records['data.counties']) == 3


def test_extract_all_handles_empty_payload():
    mod = _load_script()
    assert mod._extract_fmr_records_all({}) == {}
    assert mod._extract_fmr_records_all(None) == {}
    assert mod._extract_fmr_records_all({'data': {}}) == {}


def test_extract_all_handles_metroareas_only():
    """If the response shape ever changes back to metroareas-only,
    we still pull what's there — we just no longer silently drop the
    other shape if it's present."""
    mod = _load_script()
    payload = {'data': {'metroareas': [{'code': 'X', 'name': 'Y'}]}}
    all_records = mod._extract_fmr_records_all(payload)
    assert list(all_records.keys()) == ['data.metroareas']
    assert len(all_records['data.metroareas']) == 1


def test_co_county_names_full_has_all_64():
    """The fallback name dict must cover every CO county so non-metro
    records get a proper name even when the IL API hasn't been queried."""
    mod = _load_script()
    assert len(mod._CO_COUNTY_NAMES_FULL) == 64
    # Spot-check a handful of non-metro counties that used to silently
    # fall out of the cache
    for fips in ('08029', '08067', '08107', '08113', '08077'):
        assert fips in mod._CO_COUNTY_NAMES_FULL, f'{fips} missing'
        assert mod._CO_COUNTY_NAMES_FULL[fips].endswith('County')


if __name__ == '__main__':
    # Allow running standalone without pytest for quick smoke checks
    test_extract_all_returns_both_metroareas_and_counties()
    test_extract_all_handles_empty_payload()
    test_extract_all_handles_metroareas_only()
    test_co_county_names_full_has_all_64()
    print('✓ All F256 FMR extractor regression tests pass')
