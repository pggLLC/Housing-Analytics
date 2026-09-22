"""
Tests for scripts/hna/build_place_decade_trends.py.

The script's own fetch_cohort() calls the live Census API via ACSExtractor,
which needs CENSUS_API_KEY and cannot run in this test environment (the repo's
own CI hard-gates on this exact requirement — see the "Environment check"
step in .github/workflows/build-hna-data.yml). These tests instead exercise
build()'s data-shaping logic directly by monkeypatching fetch_cohort() with
canned per-vintage ACS field dicts, the same seam the real script uses.
"""
import importlib.util
import json
import os
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MODULE_PATH = os.path.join(ROOT, 'scripts', 'hna', 'build_place_decade_trends.py')


def _load_module():
    # scripts/hna/build_place_decade_trends.py imports `from acs_etl import
    # ACSExtractor` as a same-directory import (matches the convention
    # already used by scripts/hna/market_data_builder.py), so scripts/hna
    # must be on sys.path before the module is imported.
    hna_dir = os.path.join(ROOT, 'scripts', 'hna')
    if hna_dir not in sys.path:
        sys.path.insert(0, hna_dir)
    spec = importlib.util.spec_from_file_location('build_place_decade_trends', MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def m():
    return _load_module()


def test_rent_burden_30_plus_pct_sums_two_bins(m):
    # DP04_0141PE = 30-34.9%, DP04_0142PE = 35%+. Cost-burdened (30%+) is
    # the sum of both bins, not either alone.
    assert m.rent_burden_30_plus_pct({'DP04_0141PE': 12.3, 'DP04_0142PE': 31.3}) == pytest.approx(43.6, abs=0.05)


def test_rent_burden_30_plus_pct_handles_missing_bins(m):
    assert m.rent_burden_30_plus_pct({'DP04_0141PE': None, 'DP04_0142PE': None}) is None
    # One bin present, the other missing: treat the missing one as 0, not as
    # "burden data unavailable" — a real (if partial) figure beats a dropped one.
    assert m.rent_burden_30_plus_pct({'DP04_0141PE': 10.0, 'DP04_0142PE': None}) == pytest.approx(10.0)


def test_build_produces_county_trends_compatible_schema(m, monkeypatch):
    """A place with full 2009->2024 history gets an acs_cohorts array shaped
    exactly like county-trends.json's (year/median_gross_rent/median_hh_income/
    rent_burden_30_plus, rent_burden_30_plus as a FRACTION not a percentage),
    plus an hpi.change_15y_pct field name matching the county file (not the
    subcounty builder's own change_15y name) — this is what lets
    hna-renderers.js's renderDecadeAffordTrend() read either file identically.
    """
    fixture_by_year = {
        2009: {'0828745': {'DP03_0062E': 45000, 'DP04_0134E': 650, 'DP04_0141PE': 10.0, 'DP04_0142PE': 38.0}},
        2014: {'0828745': {'DP03_0062E': 55000, 'DP04_0134E': 820, 'DP04_0141PE': 9.0, 'DP04_0142PE': 37.0}},
        2024: {'0828745': {'DP03_0062E': 87184, 'DP04_0134E': 1472, 'DP04_0141PE': 8.6, 'DP04_0142PE': 35.0}},
    }
    monkeypatch.setattr(m, 'fetch_cohort', lambda geoids, year: fixture_by_year.get(year, {}))
    monkeypatch.setattr(m, 'load_places', lambda: {'0828745': {'name': 'Fruita'}})
    monkeypatch.setattr(m, 'load_hpi_subcounty', lambda: {'0828745': {'change_15y': 1.35}})

    payload = m.build(['0828745'])

    assert payload['meta']['place_count'] == 1
    assert payload['meta']['places_skipped_incomplete_history'] == 0

    rec = payload['places']['0828745']
    assert rec['place_name'] == 'Fruita'
    assert [c['year'] for c in rec['acs_cohorts']] == [2009, 2014, 2024]

    first, last = rec['acs_cohorts'][0], rec['acs_cohorts'][-1]
    assert first['median_gross_rent'] == 650
    assert last['median_gross_rent'] == 1472
    assert first['median_hh_income'] == 45000
    assert last['median_hh_income'] == 87184
    # 10.0 + 38.0 = 48.0% -> stored as a fraction (0.48), matching
    # county-trends.json's rent_burden_30_plus convention exactly.
    assert first['rent_burden_30_plus'] == pytest.approx(0.48)

    assert rec['hpi'] == {'change_15y_pct': 1.35}


def test_build_omits_place_missing_earliest_or_latest_vintage(m, monkeypatch):
    """A place with only some vintages is left OUT of the file entirely — a
    15-year comparison missing either endpoint isn't a 15-year comparison,
    and the renderer's existing county-inherits fallback already covers it
    honestly. This must never silently render as e.g. a 5-year comparison
    mislabeled as 15-year.
    """
    fixture_by_year = {
        2009: {},  # no 2009 estimate for this place (small-place ACS gap)
        2014: {'0828745': {'DP03_0062E': 55000, 'DP04_0134E': 820, 'DP04_0141PE': 9.0, 'DP04_0142PE': 37.0}},
        2024: {'0828745': {'DP03_0062E': 87184, 'DP04_0134E': 1472, 'DP04_0141PE': 8.6, 'DP04_0142PE': 35.0}},
    }
    monkeypatch.setattr(m, 'fetch_cohort', lambda geoids, year: fixture_by_year.get(year, {}))
    monkeypatch.setattr(m, 'load_places', lambda: {'0828745': {'name': 'Fruita'}})
    monkeypatch.setattr(m, 'load_hpi_subcounty', lambda: {})

    payload = m.build(['0828745'])

    assert payload['meta']['place_count'] == 0
    assert payload['meta']['places_skipped_incomplete_history'] == 1
    assert '0828745' not in payload['places']


def test_build_rejects_implausible_cohorts_from_wrong_vintage_fields(m, monkeypatch):
    """The first live run (2026-09-22) published, for every one of 336 places,
    a 2009 cohort with median_gross_rent null and median_hh_income of 0-11:
    the ACS profile variable IDs the builder fetches are not stable across
    vintages, so the 2009/2014 requests returned different fields under the
    same IDs. These are the exact values Fruita came back with. Such a
    cohort must be rejected at the source — counted, never written — so the
    place fails the earliest/latest check and the renderer keeps its county
    fallback, rather than charting "$111 -> $87,184" as 15 years of history.
    """
    fixture_by_year = {
        2009: {'0828745': {'DP03_0062E': 111, 'DP04_0134E': None, 'DP04_0141PE': None, 'DP04_0142PE': None}},
        2014: {'0828745': {'DP03_0062E': 54875, 'DP04_0134E': None, 'DP04_0141PE': None, 'DP04_0142PE': None}},
        2024: {'0828745': {'DP03_0062E': 87184, 'DP04_0134E': 1472, 'DP04_0141PE': 8.6, 'DP04_0142PE': 35.0}},
    }
    monkeypatch.setattr(m, 'fetch_cohort', lambda geoids, year: fixture_by_year.get(year, {}))
    monkeypatch.setattr(m, 'load_places', lambda: {'0828745': {'name': 'Fruita'}})
    monkeypatch.setattr(m, 'load_hpi_subcounty', lambda: {})

    payload = m.build(['0828745'])

    assert payload['meta']['cohorts_rejected_implausible'] == 2
    assert payload['meta']['place_count'] == 0
    assert '0828745' not in payload['places']

    # The gate itself, at its edges.
    assert m.is_plausible_cohort(200, 5000) is True
    assert m.is_plausible_cohort(199, 5000) is False
    assert m.is_plausible_cohort(1472, 111) is False
    assert m.is_plausible_cohort(None, 87184) is False
    assert m.is_plausible_cohort('1472', '87184') is True


def test_build_omits_hpi_block_when_subcounty_file_has_no_change_15y(m, monkeypatch):
    """The FHFA subcounty merge is additive-only: a place with full ACS
    history but no matching change_15y (subcounty file missing, stale, or
    the place has too little FHFA tract coverage) still gets a valid
    acs_cohorts-only record, not a dropped one.
    """
    fixture_by_year = {
        2009: {'0828745': {'DP03_0062E': 45000, 'DP04_0134E': 650, 'DP04_0141PE': 10.0, 'DP04_0142PE': 38.0}},
        2014: {'0828745': {'DP03_0062E': 55000, 'DP04_0134E': 820, 'DP04_0141PE': 9.0, 'DP04_0142PE': 37.0}},
        2024: {'0828745': {'DP03_0062E': 87184, 'DP04_0134E': 1472, 'DP04_0141PE': 8.6, 'DP04_0142PE': 35.0}},
    }
    monkeypatch.setattr(m, 'fetch_cohort', lambda geoids, year: fixture_by_year.get(year, {}))
    monkeypatch.setattr(m, 'load_places', lambda: {'0828745': {'name': 'Fruita'}})
    monkeypatch.setattr(m, 'load_hpi_subcounty', lambda: {})  # no HPI data at all

    payload = m.build(['0828745'])

    assert payload['meta']['place_count'] == 1
    assert payload['places']['0828745']['hpi'] is None


def test_output_is_valid_json_serializable(m, monkeypatch):
    fixture_by_year = {
        2009: {'0828745': {'DP03_0062E': 45000, 'DP04_0134E': 650, 'DP04_0141PE': 10.0, 'DP04_0142PE': 38.0}},
        2014: {'0828745': {'DP03_0062E': 55000, 'DP04_0134E': 820, 'DP04_0141PE': 9.0, 'DP04_0142PE': 37.0}},
        2024: {'0828745': {'DP03_0062E': 87184, 'DP04_0134E': 1472, 'DP04_0141PE': 8.6, 'DP04_0142PE': 35.0}},
    }
    monkeypatch.setattr(m, 'fetch_cohort', lambda geoids, year: fixture_by_year.get(year, {}))
    monkeypatch.setattr(m, 'load_places', lambda: {'0828745': {'name': 'Fruita'}})
    monkeypatch.setattr(m, 'load_hpi_subcounty', lambda: {'0828745': {'change_15y': 1.35}})

    payload = m.build(['0828745'])
    json.dumps(payload)  # must not raise
