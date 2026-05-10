"""tests/test_chas_tract_data.py

Plausibility + structure tests for tract-level CHAS data produced by
scripts/fetch_chas.py (TIGER PR-C1 foundation). Tests focus on:

  - Schema validation against schemas/chas-tract-co.schema.json
  - All ~1,447 CO tracts present
  - Tracts roll up to county totals (county chas_co.json) within rounding
  - All tract_geoid are 11-digit + start with '08'
  - county_fips field matches first 5 digits of tract_geoid
  - Per-tract burden percentages stay in [0, 1]
  - Statewide ≤30% renter HH count > 100K (sanity floor)

These guard against regressions in the new tract aggregation code path
(aggregate_to_tracts + finalize_tract_record) without re-running the
234 MB CHAS download in CI — they read the committed JSON output.
"""
from __future__ import annotations

import json
import pathlib

import pytest

REPO_ROOT = pathlib.Path(__file__).parent.parent
TRACT_FILE  = REPO_ROOT / 'data' / 'market' / 'chas_tract_co.json'
COUNTY_FILE = REPO_ROOT / 'data' / 'market' / 'chas_co.json'
SCHEMA_FILE = REPO_ROOT / 'schemas' / 'chas-tract-co.schema.json'

EXPECTED_TRACT_COUNT_MIN = 1400  # tolerate a few inactive tracts
EXPECTED_TRACT_COUNT_MAX = 1500
EXPECTED_CO_COUNTY_COUNT = 64
TIER_KEYS = ('lte30', '31to50', '51to80', '81to100', '100plus')


@pytest.fixture(scope='module')
def tract_doc():
    if not TRACT_FILE.exists():
        pytest.skip('Tract CHAS file not present (run scripts/fetch_chas.py)')
    with open(TRACT_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def county_doc():
    if not COUNTY_FILE.exists():
        pytest.skip('County CHAS file not present')
    with open(COUNTY_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def schema():
    with open(SCHEMA_FILE) as f:
        return json.load(f)


class TestSchemaValidation:

    def test_validates_against_schema(self, tract_doc, schema):
        try:
            import jsonschema
        except ImportError:
            pytest.skip('jsonschema not installed')
        jsonschema.validate(tract_doc, schema)


class TestStructure:

    def test_record_count_in_expected_range(self, tract_doc):
        n = tract_doc['meta']['record_count']
        assert EXPECTED_TRACT_COUNT_MIN <= n <= EXPECTED_TRACT_COUNT_MAX, (
            f'Expected {EXPECTED_TRACT_COUNT_MIN}-{EXPECTED_TRACT_COUNT_MAX} '
            f'tract records, found {n}'
        )
        assert n == len(tract_doc['records'])

    def test_all_tract_geoids_are_11_digit_co(self, tract_doc):
        for rec in tract_doc['records']:
            geoid = rec['tract_geoid']
            assert len(geoid) == 11, f'{geoid}: not 11 digits'
            assert geoid.startswith('08'), f'{geoid}: not a CO tract'
            assert geoid.isdigit(), f'{geoid}: contains non-digits'

    def test_county_fips_matches_first_5_of_geoid(self, tract_doc):
        for rec in tract_doc['records']:
            assert rec['county_fips'] == rec['tract_geoid'][:5], (
                f'{rec["tract_geoid"]}: county_fips ({rec["county_fips"]}) '
                f'mismatch with first 5 digits'
            )

    def test_records_sorted_by_tract_geoid(self, tract_doc):
        geoids = [r['tract_geoid'] for r in tract_doc['records']]
        assert geoids == sorted(geoids), 'records should be sorted by tract_geoid'

    def test_tracts_cover_all_64_counties(self, tract_doc):
        county_set = set(r['county_fips'] for r in tract_doc['records'])
        assert len(county_set) == EXPECTED_CO_COUNTY_COUNT, (
            f'Expected tracts in {EXPECTED_CO_COUNTY_COUNT} counties, '
            f'got {len(county_set)}: {sorted(county_set)}'
        )


class TestPlausibility:

    def test_burden_percentages_in_zero_to_one(self, tract_doc):
        for rec in tract_doc['records']:
            for tenure in ('renter_hh_by_ami', 'owner_hh_by_ami'):
                for tier in TIER_KEYS:
                    td = rec[tenure][tier]
                    pct30 = td['pct_cost_burdened_30']
                    pct50 = td['pct_cost_burdened_50']
                    assert 0 <= pct30 <= 1, (
                        f'{rec["tract_geoid"]} {tenure} {tier}: '
                        f'pct_cost_burdened_30={pct30}'
                    )
                    assert 0 <= pct50 <= 1, (
                        f'{rec["tract_geoid"]} {tenure} {tier}: '
                        f'pct_cost_burdened_50={pct50}'
                    )

    def test_severely_burdened_le_total_burdened(self, tract_doc):
        """Severely cost-burdened (>50% of income) is a SUBSET of moderately+
        cost-burdened (>30%). The 50pct count must be ≤ the 30pct count."""
        for rec in tract_doc['records']:
            for tenure in ('renter_hh_by_ami', 'owner_hh_by_ami'):
                for tier in TIER_KEYS:
                    td = rec[tenure][tier]
                    cb30 = td['cost_burdened_30pct']
                    cb50 = td['cost_burdened_50pct']
                    assert cb50 <= cb30, (
                        f'{rec["tract_geoid"]} {tenure} {tier}: '
                        f'cb50={cb50} > cb30={cb30}'
                    )

    def test_statewide_renter_lte30_above_floor(self, tract_doc):
        """Sum of all CO tract renter ≤30% HAMFI HHs must be > 100K
        (a known plausibility floor — pre-fix Table 9 parsing produced
        ~3K total which we want to catch immediately on regression)."""
        total = sum(
            r['renter_hh_by_ami']['lte30']['total']
            for r in tract_doc['records']
        )
        assert total > 100_000, (
            f'CO renter ≤30% HAMFI total ({total:,}) below 100K floor — '
            f'likely a column-mapping regression in fetch_chas.py'
        )

    def test_tract_rollup_matches_county_within_rounding(self, tract_doc, county_doc):
        """Sum of tract metrics by county must equal the corresponding
        county metric (modulo rounding). The tract aggregation runs the
        SAME extraction on the SAME source records, so the sums should
        be exact."""
        # Build per-county sum from tracts
        tract_totals = {}
        for rec in tract_doc['records']:
            cf = rec['county_fips']
            tract_totals.setdefault(cf, {'renter_lte30': 0, 'owner_total': 0})
            tract_totals[cf]['renter_lte30'] += rec['renter_hh_by_ami']['lte30']['total']
            for tier in TIER_KEYS:
                tract_totals[cf]['owner_total'] += rec['owner_hh_by_ami'][tier]['total']

        # Compare to county doc
        for county_rec in county_doc['records']:
            cf = county_rec['fips']
            if cf not in tract_totals:
                continue
            county_renter_lte30 = county_rec['renter_hh_by_ami']['lte30']['total']
            county_owner_total = county_rec['summary']['total_owner_hh']
            assert tract_totals[cf]['renter_lte30'] == county_renter_lte30, (
                f'{cf}: tract sum renter ≤30% ({tract_totals[cf]["renter_lte30"]:,}) '
                f'!= county ({county_renter_lte30:,})'
            )
            assert tract_totals[cf]['owner_total'] == county_owner_total, (
                f'{cf}: tract sum owner total ({tract_totals[cf]["owner_total"]:,}) '
                f'!= county ({county_owner_total:,})'
            )
