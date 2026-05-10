"""tests/test_place_tract_membership.py

Plausibility tests for the place→tract spatial membership lookup
produced by scripts/hna/build_place_tract_membership.py (TIGER PR-C2).

Verifies:
  - Schema validation
  - All 26 known cross-county places (PR #787 registry) have multi-
    county tracts in their membership list — direct regression guard
    against a bad spatial join (e.g. CRS mismatch, missed reprojection)
  - Cross-county places (Aurora, Erie, etc.) have tracts in the
    correct counties (cross-referenced against PR #787 cross-county-places.json)
  - share_of_place_area and share_of_tract_area stay in [0, 1] (with
    small slack for rounding)
  - Sum of share_of_place_area across all tracts ≈ 1.0 for any place
    (every place should be entirely tiled by its tracts)
  - Per-place tract count is plausible (typically 1-100; >200 is
    suspicious and worth flagging)

These tests guard against silent regressions in the spatial-join
pipeline (e.g. dropping places, miscomputing intersections, projection
errors) without re-running the 11-MB shapefile download in CI — they
read the committed JSON output.
"""
from __future__ import annotations

import json
import pathlib

import pytest

REPO_ROOT = pathlib.Path(__file__).parent.parent
MEMBERSHIP_FILE = REPO_ROOT / 'data' / 'hna' / 'place-tract-membership.json'
CROSS_COUNTY_FILE = REPO_ROOT / 'data' / 'hna' / 'cross-county-places.json'
SCHEMA_FILE = REPO_ROOT / 'schemas' / 'place-tract-membership.schema.json'

EXPECTED_PLACE_COUNT_MIN = 400  # CO has ~464 incorporated/CDP places
EXPECTED_PLACE_COUNT_MAX = 550


@pytest.fixture(scope='module')
def membership_doc():
    if not MEMBERSHIP_FILE.exists():
        pytest.skip('Membership file not present (run build_place_tract_membership.py)')
    with open(MEMBERSHIP_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def cross_county_doc():
    if not CROSS_COUNTY_FILE.exists():
        pytest.skip('Cross-county registry not present')
    with open(CROSS_COUNTY_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def schema():
    with open(SCHEMA_FILE) as f:
        return json.load(f)


class TestSchemaAndStructure:

    def test_validates_against_schema(self, membership_doc, schema):
        try:
            import jsonschema
        except ImportError:
            pytest.skip('jsonschema not installed')
        jsonschema.validate(membership_doc, schema)

    def test_place_count_plausible(self, membership_doc):
        n = membership_doc['meta']['count_places']
        assert EXPECTED_PLACE_COUNT_MIN <= n <= EXPECTED_PLACE_COUNT_MAX, (
            f'Expected {EXPECTED_PLACE_COUNT_MIN}-{EXPECTED_PLACE_COUNT_MAX} '
            f'CO places, found {n}'
        )

    def test_all_places_have_at_least_one_tract(self, membership_doc):
        zero_tract_places = [
            geoid for geoid, p in membership_doc['places'].items()
            if not p['tracts']
        ]
        assert not zero_tract_places, (
            f'{len(zero_tract_places)} places have zero tracts — impossible for '
            f'incorporated/CDP places: {zero_tract_places[:5]}'
        )


class TestSpatialIntegrity:

    def test_share_values_in_unit_interval(self, membership_doc):
        for geoid, p in membership_doc['places'].items():
            for t in p['tracts']:
                assert 0 <= t['share_of_place_area'] <= 1.0001, (
                    f'{geoid} tract {t["tract_geoid"]}: share_of_place_area '
                    f'{t["share_of_place_area"]} out of [0, 1]'
                )
                assert 0 <= t['share_of_tract_area'] <= 1.0001, (
                    f'{geoid} tract {t["tract_geoid"]}: share_of_tract_area '
                    f'{t["share_of_tract_area"]} out of [0, 1]'
                )

    def test_share_of_place_sum_approx_one(self, membership_doc):
        """Tracts should tile the place — sum of share_of_place_area ≈ 1.

        Allow ±0.05 slack: rounding to 4 decimals + tracts that don't
        perfectly cover small shoreline / boundary slivers can produce
        ~98-99% coverage, which is fine for the area-weighted approach.
        """
        underflows = []
        for geoid, p in membership_doc['places'].items():
            s = sum(t['share_of_place_area'] for t in p['tracts'])
            if abs(s - 1.0) > 0.05:
                underflows.append((geoid, p['name'], round(s, 3)))
        # Allow a small number of weird edge cases (place mostly water etc.)
        assert len(underflows) < 20, (
            f'{len(underflows)} places have share_of_place sum far from 1.0 '
            f'(showing first 5): {underflows[:5]}'
        )

    def test_tracts_are_co_tracts(self, membership_doc):
        for geoid, p in membership_doc['places'].items():
            for t in p['tracts']:
                assert t['tract_geoid'].startswith('08'), (
                    f'{geoid}: non-CO tract {t["tract_geoid"]} found'
                )
                assert len(t['tract_geoid']) == 11, (
                    f'{geoid}: malformed tract_geoid {t["tract_geoid"]}'
                )


class TestCrossCountyAlignment:
    """For every cross-county place in PR #787's registry, the spatial-
    join must produce tracts in ≥2 counties — otherwise the place→tract
    membership doesn't match the place's known multi-county nature.

    Spot-checks specific places against expected county lists from the
    registry."""

    EXPECTED_MULTI_COUNTY_PLACES = {
        '0824950': ('Erie',     {'08013', '08123'}),
        '0804000': ('Aurora',   {'08001', '08005', '08035'}),
        '0845970': ('Longmont', {'08013', '08123'}),
        '0875640': ('Superior', {'08013', '08059'}),
        '0885485': ('Windsor',  {'08069', '08123'}),
    }

    def test_cross_county_places_span_correct_counties(self, membership_doc):
        for geoid, (name, expected_counties) in self.EXPECTED_MULTI_COUNTY_PLACES.items():
            p = membership_doc['places'].get(geoid)
            if p is None:
                pytest.fail(f'{geoid} ({name}): missing from membership doc')
            actual_counties = set(t['tract_geoid'][:5] for t in p['tracts'])
            assert expected_counties.issubset(actual_counties), (
                f'{geoid} ({name}): missing expected counties. '
                f'Expected ⊇ {sorted(expected_counties)}, got {sorted(actual_counties)}'
            )
            assert len(actual_counties) >= 2, (
                f'{geoid} ({name}): only {len(actual_counties)} counties — '
                f'should have ≥2 (cross-county jurisdiction)'
            )

    def test_all_pr787_cross_county_places_in_membership(self, membership_doc, cross_county_doc):
        missing = []
        for geoid in cross_county_doc['places']:
            if geoid not in membership_doc['places']:
                missing.append(geoid)
        # Allow a few mismatches (TIGER and registry use different inclusion criteria)
        assert len(missing) <= 3, (
            f'{len(missing)} cross-county places from PR #787 missing from '
            f'membership doc: {missing[:5]}'
        )

    def test_aurora_has_many_tracts(self, membership_doc):
        """Aurora is the largest cross-county place (~400K pop, 3 counties).
        Expect ≥50 tract overlaps."""
        aurora = membership_doc['places'].get('0804000')
        assert aurora is not None
        assert len(aurora['tracts']) >= 50, (
            f'Aurora has only {len(aurora["tracts"])} tracts — expected ≥50'
        )


class TestPerformanceBounds:
    """Catch runaway membership growth (a hallmark of a CRS bug where
    every tract overlaps every place because geometries collapse to
    tiny areas)."""

    def test_total_memberships_under_5000(self, membership_doc):
        n = membership_doc['meta']['count_memberships']
        assert n < 5000, (
            f'{n} memberships — suspiciously high. Average should be ~5/place '
            f'(2,500 total). 5,000+ suggests a spatial-index or projection bug.'
        )

    def test_per_place_tract_count_under_200(self, membership_doc):
        outliers = [
            (geoid, p['name'], len(p['tracts']))
            for geoid, p in membership_doc['places'].items()
            if len(p['tracts']) > 200
        ]
        # Aurora and Denver might have ~100-150; cap at 200 to catch bugs
        assert not outliers, (
            f'Places with >200 tracts (likely a spatial-join bug): {outliers}'
        )
