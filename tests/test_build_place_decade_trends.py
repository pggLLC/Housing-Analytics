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
    # In 2024, DP04_0141PE = 30-34.9%, DP04_0142PE = 35%+. Cost-burdened
    # (30%+) is the sum of both bins, not either alone.
    assert m.rent_burden_30_plus_pct({'DP04_0141PE': 12.3, 'DP04_0142PE': 31.3}) == pytest.approx(43.6, abs=0.05)
    # The same two bins live at DP04_0139PE/DP04_0140PE in 2009 and 2014;
    # the year selects which IDs are read. Reading 2009 fields with the 2024
    # IDs (the first live run's bug) finds nothing.
    old = {'DP04_0139PE': 12.3, 'DP04_0140PE': 31.3}
    assert m.rent_burden_30_plus_pct(old, 2009) == pytest.approx(43.6, abs=0.05)
    assert m.rent_burden_30_plus_pct(old, 2014) == pytest.approx(43.6, abs=0.05)
    assert m.rent_burden_30_plus_pct(old, 2024) is None


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
        2009: {'0828745': {'DP03_0063E': 45000, 'DP04_0132E': 650, 'DP04_0139PE': 10.0, 'DP04_0140PE': 38.0}},
        2014: {'0828745': {'DP03_0062E': 55000, 'DP04_0132E': 820, 'DP04_0139PE': 9.0, 'DP04_0140PE': 37.0}},
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
        2014: {'0828745': {'DP03_0062E': 55000, 'DP04_0132E': 820, 'DP04_0139PE': 9.0, 'DP04_0140PE': 37.0}},
        2024: {'0828745': {'DP03_0062E': 87184, 'DP04_0134E': 1472, 'DP04_0141PE': 8.6, 'DP04_0142PE': 35.0}},
    }
    monkeypatch.setattr(m, 'fetch_cohort', lambda geoids, year: fixture_by_year.get(year, {}))
    monkeypatch.setattr(m, 'load_places', lambda: {'0828745': {'name': 'Fruita'}})
    monkeypatch.setattr(m, 'load_hpi_subcounty', lambda: {})

    payload = m.build(['0828745'])

    assert payload['meta']['place_count'] == 0
    assert payload['meta']['places_skipped_incomplete_history'] == 1
    assert '0828745' not in payload['places']


LATEST_OK = {'DP03_0062E': 87184, 'DP04_0134E': 1472, 'DP04_0141PE': 8.6, 'DP04_0142PE': 35.0}


def _build_one(m, monkeypatch, fixture_by_year):
    monkeypatch.setattr(m, 'fetch_cohort', lambda geoids, year: fixture_by_year.get(year, {}))
    monkeypatch.setattr(m, 'load_places', lambda: {'0828745': {'name': 'Fruita'}})
    monkeypatch.setattr(m, 'load_hpi_subcounty', lambda: {})
    return m.build(['0828745'])


def _unusable(meta):
    return {k: meta[k] for k in ('cohorts_missing_geography', 'cohorts_suppressed', 'cohorts_rejected_implausible')}


def test_build_counts_wrong_vintage_fields_as_suppressed_not_implausible(m, monkeypatch):
    """The first live run (2026-09-22) published, for every one of 336 places,
    a 2009 cohort with median_gross_rent null and median_hh_income of 0-11:
    the ACS profile variable IDs the builder fetches are not stable across
    vintages, so the 2009/2014 requests returned different fields under the
    same IDs. These are the exact values Fruita came back with. Such a
    cohort must never be written, so the place fails the earliest/latest
    check and the renderer keeps its county fallback, rather than charting
    "$111 -> $87,184" as 15 years of history.

    Which counter it lands in: with the builder reading each vintage's own
    IDs, these dicts (2024 IDs under every vintage) have NO value under the
    2009/2014 rent or income IDs — rent reads as None — so the cohort is
    classified as SUPPRESSED (a median is absent), not as implausible.
    The $111 never reaches the gate because it sits under DP03_0062E, which
    is not 2009's income ID. Either way: counted, not written.
    """
    fixture_by_year = {
        2009: {'0828745': {'DP03_0062E': 111, 'DP04_0134E': None, 'DP04_0141PE': None, 'DP04_0142PE': None}},
        2014: {'0828745': {'DP03_0062E': 54875, 'DP04_0134E': None, 'DP04_0141PE': None, 'DP04_0142PE': None}},
        2024: {'0828745': LATEST_OK},
    }
    payload = _build_one(m, monkeypatch, fixture_by_year)

    assert _unusable(payload['meta']) == {
        'cohorts_missing_geography': 0, 'cohorts_suppressed': 2, 'cohorts_rejected_implausible': 0,
    }
    assert payload['meta']['place_count'] == 0
    assert '0828745' not in payload['places']

    # The gate itself, at its edges.
    assert m.is_plausible_cohort(200, 5000) is True
    assert m.is_plausible_cohort(199, 5000) is False
    assert m.is_plausible_cohort(1472, 111) is False
    assert m.is_plausible_cohort(None, 87184) is False
    assert m.is_plausible_cohort('1472', '87184') is True


def test_build_counts_implausible_values_under_their_own_vintage_ids(m, monkeypatch):
    """The $111 "income" the first run wrote, now sitting under 2009's OWN
    income ID with a real rent beside it, is the case the gate exists for:
    both medians present, one of them impossible. That, and only that, is
    cohorts_rejected_implausible."""
    fixture_by_year = {
        2009: {'0828745': {'DP03_0063E': 111, 'DP04_0132E': 650, 'DP04_0139PE': 10.0, 'DP04_0140PE': 38.0}},
        2014: {'0828745': {'DP03_0062E': 54875, 'DP04_0132E': 150, 'DP04_0139PE': 9.0, 'DP04_0140PE': 37.0}},
        2024: {'0828745': LATEST_OK},
    }
    payload = _build_one(m, monkeypatch, fixture_by_year)

    assert _unusable(payload['meta']) == {
        'cohorts_missing_geography': 0, 'cohorts_suppressed': 0, 'cohorts_rejected_implausible': 2,
    }
    assert payload['meta']['place_count'] == 0
    assert '0828745' not in payload['places']


def test_build_counts_extractor_bookkeeping_only_as_missing_geography(m, monkeypatch):
    """ACSExtractor.fetch_all() returns a dict for EVERY requested geoid,
    even one whose DP03 and DP04 fetches both came back HTTP 204 because the
    geography did not exist in that vintage (CDPs delineated after 2009):
    that dict holds only the extractor's own _fetched_at/_geoid keys. The
    first correct run (2026-09-22) counted 161 such vintages as
    "implausible". They are cohorts_missing_geography — nothing was fetched,
    so nothing was judged — and are still never written."""
    fixture_by_year = {
        2009: {'0828745': {'_fetched_at': '2026-09-22T15:00:00Z', '_geoid': '0828745'}},
        2014: {'0828745': {'_fetched_at': '2026-09-22T15:00:00Z', '_geoid': '0828745'}},
        2024: {'0828745': dict(LATEST_OK, _fetched_at='2026-09-22T15:00:00Z', _geoid='0828745')},
    }
    payload = _build_one(m, monkeypatch, fixture_by_year)

    assert _unusable(payload['meta']) == {
        'cohorts_missing_geography': 2, 'cohorts_suppressed': 0, 'cohorts_rejected_implausible': 0,
    }
    assert payload['meta']['place_count'] == 0
    assert payload['meta']['places_skipped_incomplete_history'] == 1
    assert '0828745' not in payload['places']

    # A geoid the fetch returned nothing at all for (a monkeypatched {} or a
    # None entry) is the same case.
    assert m.classify_cohort(None, 2009) == m.COHORT_MISSING_GEOGRAPHY
    assert m.classify_cohort({}, 2009) == m.COHORT_MISSING_GEOGRAPHY
    assert m.data_fields({'_fetched_at': 'x', '_geoid': 'y'}) == {}
    assert m.data_fields({'_geoid': 'y', 'DP03_0063E': 45000}) == {'DP03_0063E': 45000}


def test_build_counts_suppressed_medians_as_suppressed(m, monkeypatch):
    """A very small place whose 2009 median rent the Census suppressed:
    fields present (income, the GRAPI bins) but rent None. A legitimate
    gate outcome — counted as cohorts_suppressed, never written, and the
    place keeps its county fallback. Income None alone is the same case."""
    fixture_by_year = {
        2009: {'0828745': {'DP03_0063E': 45000, 'DP04_0132E': None, 'DP04_0139PE': 10.0, 'DP04_0140PE': 38.0,
                           '_fetched_at': '2026-09-22T15:00:00Z', '_geoid': '0828745'}},
        2014: {'0828745': {'DP03_0062E': None, 'DP04_0132E': 820, 'DP04_0139PE': 9.0, 'DP04_0140PE': 37.0}},
        2024: {'0828745': LATEST_OK},
    }
    payload = _build_one(m, monkeypatch, fixture_by_year)

    assert _unusable(payload['meta']) == {
        'cohorts_missing_geography': 0, 'cohorts_suppressed': 2, 'cohorts_rejected_implausible': 0,
    }
    assert payload['meta']['place_count'] == 0
    assert '0828745' not in payload['places']


def test_classify_cohort_reasons_are_disjoint_and_ordered(m):
    """One reason per (place, vintage), checked in the order absent ->
    suppressed -> implausible, and None for a usable cohort."""
    ok = {'DP03_0063E': 45000, 'DP04_0132E': 650}
    assert m.classify_cohort(ok, 2009) is None
    assert m.classify_cohort({'_fetched_at': 'x', '_geoid': 'y'}, 2009) == 'missing_geography'
    assert m.classify_cohort({'DP03_0063E': 45000, 'DP04_0132E': None}, 2009) == 'suppressed'
    assert m.classify_cohort({'DP03_0063E': None, 'DP04_0132E': 650}, 2009) == 'suppressed'
    assert m.classify_cohort({'DP03_0063E': 111, 'DP04_0132E': 650}, 2009) == 'rejected_implausible'
    assert m.classify_cohort({'DP03_0063E': 45000, 'DP04_0132E': 199}, 2009) == 'rejected_implausible'
    # Year selects the IDs: the same numbers under 2024's IDs are absent in 2009.
    assert m.classify_cohort({'DP03_0062E': 45000, 'DP04_0134E': 650}, 2009) == 'suppressed'
    assert m.classify_cohort({'DP03_0062E': 45000, 'DP04_0134E': 650}, 2024) is None
    assert {m.COHORT_MISSING_GEOGRAPHY, m.COHORT_SUPPRESSED, m.COHORT_REJECTED_IMPLAUSIBLE} == {
        'missing_geography', 'suppressed', 'rejected_implausible'}


class _NoContentResponse:
    status = 204

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    @staticmethod
    def read():
        return b''


def test_extractor_logs_http_204_as_absent_geography_not_failure(m, monkeypatch):
    """A 204 from the Census API means the geography is not published in
    that vintage. ACSExtractor must say so (and count it) rather than log
    it under the same "Failed ... HTTP" line as a 400 or 500, and must still
    return the bookkeeping-only dict build() classifies as missing_geography."""
    from contextlib import redirect_stderr
    from io import StringIO
    import urllib.request

    ov = m.vintage_variables(2009)
    ex = m.ACSExtractor(sorted(ov), ['0828745'], year=2009, variables=ov)
    monkeypatch.setattr(ex._rate, 'wait', lambda: None)
    monkeypatch.setattr(urllib.request, 'urlopen', lambda *a, **k: _NoContentResponse())

    stderr = StringIO()
    with redirect_stderr(stderr):
        results = ex.fetch_all()

    log = stderr.getvalue()
    assert ex.no_content_count == 2  # DP03 + DP04
    assert log.count('No content table=') == 2
    assert 'HTTP 204 (geography not published in this vintage)' in log
    assert 'Failed table=' not in log
    assert m.data_fields(results['0828745']) == {}
    assert m.classify_cohort(results['0828745'], 2009) == m.COHORT_MISSING_GEOGRAPHY


def test_build_omits_hpi_block_when_subcounty_file_has_no_change_15y(m, monkeypatch):
    """The FHFA subcounty merge is additive-only: a place with full ACS
    history but no matching change_15y (subcounty file missing, stale, or
    the place has too little FHFA tract coverage) still gets a valid
    acs_cohorts-only record, not a dropped one.
    """
    fixture_by_year = {
        2009: {'0828745': {'DP03_0063E': 45000, 'DP04_0132E': 650, 'DP04_0139PE': 10.0, 'DP04_0140PE': 38.0}},
        2014: {'0828745': {'DP03_0062E': 55000, 'DP04_0132E': 820, 'DP04_0139PE': 9.0, 'DP04_0140PE': 37.0}},
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
        2009: {'0828745': {'DP03_0063E': 45000, 'DP04_0132E': 650, 'DP04_0139PE': 10.0, 'DP04_0140PE': 38.0}},
        2014: {'0828745': {'DP03_0062E': 55000, 'DP04_0132E': 820, 'DP04_0139PE': 9.0, 'DP04_0140PE': 37.0}},
        2024: {'0828745': {'DP03_0062E': 87184, 'DP04_0134E': 1472, 'DP04_0141PE': 8.6, 'DP04_0142PE': 35.0}},
    }
    monkeypatch.setattr(m, 'fetch_cohort', lambda geoids, year: fixture_by_year.get(year, {}))
    monkeypatch.setattr(m, 'load_places', lambda: {'0828745': {'name': 'Fruita'}})
    monkeypatch.setattr(m, 'load_hpi_subcounty', lambda: {'0828745': {'change_15y': 1.35}})

    payload = m.build(['0828745'])
    json.dumps(payload)  # must not raise


# ---------------------------------------------------------------------------
# Per-vintage variable IDs (the fix for the first live run's null/0-11 cohorts)
# ---------------------------------------------------------------------------

COHORT_FIELDS = ('income', 'rent', 'grapi_30_34', 'grapi_35_plus')

# Labels read off api.census.gov/data/<year>/acs/acs5/profile/variables.json
# on 2026-09-22 (public, keyless). Kept here so the map is auditable without
# re-fetching: each ID's label must describe the field it is mapped to.
CENSUS_LABELS = {
    2009: {
        'DP03_0062E': 'INCOME AND BENEFITS!!Total households!!$200,000 or more',        # the "income" of 111 the first run wrote for Fruita
        'DP03_0063E': 'INCOME AND BENEFITS!!Total households!!Median household income (dollars)',
        'DP04_0132E': 'GROSS RENT!!Occupied units paying rent!!Median (dollars)',
        'DP04_0134E': 'GRAPI!!Occupied units paying rent (excluding units where GRAPI cannot be computed)',  # a COUNT
        'DP04_0139PE': 'GRAPI!!30.0 to 34.9 percent',
        'DP04_0140PE': 'GRAPI!!35.0 percent or more',
        'DP04_0141PE': 'GRAPI!!Not computed',
        # DP04_0142PE / DP04_0143PE: do not exist -> whole request rejected (HTTP 400)
    },
    2014: {
        'DP03_0062E': 'INCOME AND BENEFITS!!Total households!!Median household income (dollars)',
        'DP04_0132E': 'GROSS RENT!!Occupied units paying rent!!Median (dollars)',
        'DP04_0134E': 'GRAPI!!Occupied units paying rent (excluding units where GRAPI cannot be computed)',  # a COUNT
        'DP04_0139PE': 'GRAPI!!30.0 to 34.9 percent',
        'DP04_0140PE': 'GRAPI!!35.0 percent or more',
        'DP04_0141PE': 'GRAPI!!Not computed',
        # DP04_0142PE / DP04_0143PE: do not exist -> whole request rejected (HTTP 400)
    },
    2024: {
        'DP03_0062E': 'INCOME AND BENEFITS!!Total households!!Median household income (dollars)',
        'DP04_0134E': 'GROSS RENT!!Occupied units paying rent!!Median (dollars)',
        'DP04_0141PE': 'GRAPI!!30.0 to 34.9 percent',
        'DP04_0142PE': 'GRAPI!!35.0 percent or more',
    },
}


def test_vintage_variables_cover_every_field_for_every_vintage(m):
    """Every vintage the builder fetches must map all four cohort fields —
    a missing entry would KeyError mid-run, and a vintage falling through
    to the 2024 IDs is exactly the bug the first live run shipped."""
    assert set(m.VINTAGE_VARIABLES) == set(m.VINTAGES)
    assert set(m.COHORT_FIELD_TYPES) == set(COHORT_FIELDS)
    for year in m.VINTAGES:
        ids = m.VINTAGE_VARIABLES[year]
        assert set(ids) == set(COHORT_FIELDS), f'{year} is missing a cohort field'
        for field, var_id in ids.items():
            assert var_id, f'{year}/{field} is empty'
            assert var_id.startswith(('DP03_', 'DP04_')), f'{year}/{field}={var_id} is not a DP03/DP04 profile variable'
        # Dollar medians are plain estimates (…E); GRAPI bins are percent estimates (…PE).
        assert ids['income'].endswith('E') and not ids['income'].endswith('PE')
        assert ids['rent'].endswith('E') and not ids['rent'].endswith('PE')
        assert ids['grapi_30_34'].endswith('PE')
        assert ids['grapi_35_plus'].endswith('PE')


def test_vintage_variables_match_census_labels(m):
    """Each mapped ID must be the variable whose Census label describes that
    field in that vintage (labels recorded above from the public
    variables.json), and never one of the look-alikes the first run hit."""
    for year in m.VINTAGES:
        ids = m.VINTAGE_VARIABLES[year]
        labels = CENSUS_LABELS[year]
        assert labels[ids['income']].endswith('Median household income (dollars)'), (year, ids['income'])
        assert labels[ids['rent']] == 'GROSS RENT!!Occupied units paying rent!!Median (dollars)', (year, ids['rent'])
        assert labels[ids['grapi_30_34']].endswith('30.0 to 34.9 percent'), (year, ids['grapi_30_34'])
        assert labels[ids['grapi_35_plus']].endswith('35.0 percent or more'), (year, ids['grapi_35_plus'])


def test_historical_vintage_ids_differ_from_2024_where_numbering_shifted(m):
    """The concrete shifts, pinned: 2009 income is one slot later than
    2024's; 2009/2014 rent and both GRAPI bins are two slots earlier."""
    v = m.VINTAGE_VARIABLES
    assert v[2024] == {'income': 'DP03_0062E', 'rent': 'DP04_0134E',
                       'grapi_30_34': 'DP04_0141PE', 'grapi_35_plus': 'DP04_0142PE'}
    # 2009: every one of the four moved.
    assert v[2009]['income'] == 'DP03_0063E' != v[2024]['income']
    assert v[2009]['rent'] == 'DP04_0132E' != v[2024]['rent']
    assert v[2009]['grapi_30_34'] == 'DP04_0139PE' != v[2024]['grapi_30_34']
    assert v[2009]['grapi_35_plus'] == 'DP04_0140PE' != v[2024]['grapi_35_plus']
    # 2014: income already at its modern number; the three DP04 fields not yet.
    assert v[2014]['income'] == v[2024]['income']
    assert v[2014]['rent'] == 'DP04_0132E' != v[2024]['rent']
    assert v[2014]['grapi_30_34'] == 'DP04_0139PE' != v[2024]['grapi_30_34']
    assert v[2014]['grapi_35_plus'] == 'DP04_0140PE' != v[2024]['grapi_35_plus']


def test_2024_vintage_ids_match_acs_field_mapping(m):
    """acs_field_mapping.json is the current-vintage contract for the rest
    of scripts/hna; the builder's 2024 row must be the same IDs so the two
    can't drift (and so the site's current-vintage place numbers and this
    file's 2024 cohort come from the same variables)."""
    with open(os.path.join(ROOT, 'scripts', 'hna', 'acs_field_mapping.json'), encoding='utf-8') as fh:
        mapping = json.load(fh)
    latest = m.VINTAGE_VARIABLES[m.VINTAGES[-1]]
    assert mapping['DP03'][latest['income']]['name'] == 'median_household_income'
    assert mapping['DP04'][latest['rent']]['name'] == 'median_gross_rent'
    assert mapping['DP04'][latest['grapi_30_34']]['name'] == 'grapi_30_34'
    assert mapping['DP04'][latest['grapi_35_plus']]['name'] == 'grapi_35_plus'


def test_vintage_variables_override_requests_only_that_vintages_ids(m):
    """vintage_variables() is what fetch_cohort() hands ACSExtractor: exactly
    the four IDs for that year, grouped by table, typed like the mapping file.
    Nothing from acs_field_mapping.json's 2024 DP04 list (DP04_0142PE,
    DP04_0143PE, …) may leak in — Census rejects the whole request if it does."""
    ov = m.vintage_variables(2009)
    assert ov == {
        'DP03': {'DP03_0063E': 'integer'},
        'DP04': {'DP04_0132E': 'integer', 'DP04_0139PE': 'percentage', 'DP04_0140PE': 'percentage'},
    }
    assert m.vintage_variables(2024) == {
        'DP03': {'DP03_0062E': 'integer'},
        'DP04': {'DP04_0134E': 'integer', 'DP04_0141PE': 'percentage', 'DP04_0142PE': 'percentage'},
    }

    # And ACSExtractor honours it end to end: the 2009 URL carries only the
    # 2009 IDs, and the response is coerced by the override's types.
    ex = m.ACSExtractor(sorted(ov), ['0828745'], year=2009, variables=ov)
    assert ex.table_variables('DP04') == ['DP04_0132E', 'DP04_0139PE', 'DP04_0140PE']
    url = ex._build_url('DP04', '0828745', ex.table_variables('DP04'))
    assert url.startswith('https://api.census.gov/data/2009/acs/acs5/profile?get=NAME,DP04_0132E,DP04_0139PE,DP04_0140PE&')
    assert 'for=place:28745&in=state:08' in url
    for stale in ('DP04_0134E', 'DP04_0141PE', 'DP04_0142PE', 'DP04_0143PE', 'DP04_0001E'):
        assert stale not in url
    mapped = ex._map_fields('DP04', {'NAME': 'Fruita city, Colorado', 'DP04_0132E': '650',
                                     'DP04_0139PE': '10.0', 'DP04_0140PE': '38.0', 'DP04_0134E': '812'})
    assert mapped == {'DP04_0132E': 650, 'DP04_0139PE': 10.0, 'DP04_0140PE': 38.0}
    # Without an override, the same call still reads the mapping file (the
    # current-vintage behaviour every other ACSExtractor caller relies on).
    ex_default = m.ACSExtractor(['DP04'], ['0828745'], year=2024)
    assert 'DP04_0134E' in ex_default.table_variables('DP04')
    assert 'DP04_0132E' not in ex_default.table_variables('DP04')


def test_build_reads_each_vintage_by_its_own_ids_and_records_the_map(m, monkeypatch):
    """A 2009 response keyed by the 2009 IDs (DP03_0063E, DP04_0132E, the
    0139/0140 GRAPI bins) becomes a real cohort; the same numbers under the
    2024 IDs would have been rejected. meta records the map used so a
    reader of the file can audit which variable each cohort came from."""
    fixture_by_year = {
        2009: {'0828745': {'DP03_0063E': 45000, 'DP04_0132E': 650, 'DP04_0139PE': 10.0, 'DP04_0140PE': 38.0,
                           # the look-alikes the first run read, present and ignored:
                           'DP03_0062E': 111, 'DP04_0134E': 812, 'DP04_0141PE': 4.0}},
        2014: {'0828745': {'DP03_0062E': 54875, 'DP04_0132E': 820, 'DP04_0139PE': 9.0, 'DP04_0140PE': 37.0}},
        2024: {'0828745': {'DP03_0062E': 87184, 'DP04_0134E': 1472, 'DP04_0141PE': 8.6, 'DP04_0142PE': 35.0}},
    }
    monkeypatch.setattr(m, 'fetch_cohort', lambda geoids, year: fixture_by_year.get(year, {}))
    monkeypatch.setattr(m, 'load_places', lambda: {'0828745': {'name': 'Fruita'}})
    monkeypatch.setattr(m, 'load_hpi_subcounty', lambda: {})

    payload = m.build(['0828745'])

    assert _unusable(payload['meta']) == {
        'cohorts_missing_geography': 0, 'cohorts_suppressed': 0, 'cohorts_rejected_implausible': 0,
    }
    assert payload['meta']['place_count'] == 1
    c2009, c2014, c2024 = payload['places']['0828745']['acs_cohorts']
    assert (c2009['median_hh_income'], c2009['median_gross_rent']) == (45000, 650)
    assert c2009['rent_burden_30_plus'] == pytest.approx(0.48)
    assert (c2014['median_hh_income'], c2014['median_gross_rent']) == (54875, 820)
    assert c2014['rent_burden_30_plus'] == pytest.approx(0.46)
    assert (c2024['median_hh_income'], c2024['median_gross_rent']) == (87184, 1472)
    assert payload['meta']['vintage_variables'] == {
        '2009': m.VINTAGE_VARIABLES[2009], '2014': m.VINTAGE_VARIABLES[2014], '2024': m.VINTAGE_VARIABLES[2024],
    }
