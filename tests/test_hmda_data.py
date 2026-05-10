"""tests/test_hmda_data.py

Plausibility + structure tests for HMDA Colorado aggregates produced by
scripts/fetch_hmda.py. Tests focus on:

  - Schema validation against schemas/hmda-co-aggregates.schema.json
  - All 64 CO counties present in the county file
  - Years coverage matches between state and county files
  - Per-county totals roll up to within 5% of state totals (sanity)
  - Denial rates fall within 0-1 range
  - Multifamily originations are a small subset of total (<5% statewide)

These guard against a silent regression where the API returns partial
data, or the per-county loop short-circuits.
"""
from __future__ import annotations

import json
import os
import pathlib

import pytest

REPO_ROOT = pathlib.Path(__file__).parent.parent
STATE_FILE = REPO_ROOT / 'data' / 'hmda' / 'co-state-trends.json'
COUNTY_FILE = REPO_ROOT / 'data' / 'hmda' / 'co-county-aggregates.json'
SCHEMA_FILE = REPO_ROOT / 'schemas' / 'hmda-co-aggregates.schema.json'

EXPECTED_CO_COUNTIES = 64


@pytest.fixture(scope='module')
def state_doc():
    if not STATE_FILE.exists():
        pytest.skip('HMDA state file not present (run scripts/fetch_hmda.py)')
    with open(STATE_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def county_doc():
    if not COUNTY_FILE.exists():
        pytest.skip('HMDA county file not present (run scripts/fetch_hmda.py)')
    with open(COUNTY_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def schema():
    with open(SCHEMA_FILE) as f:
        return json.load(f)


class TestSchemaValidation:
    """Both files must validate against the canonical schema."""

    def test_state_file_validates(self, state_doc, schema):
        try:
            import jsonschema
        except ImportError:
            pytest.skip('jsonschema not installed')
        jsonschema.validate(state_doc, schema)

    def test_county_file_validates(self, county_doc, schema):
        try:
            import jsonschema
        except ImportError:
            pytest.skip('jsonschema not installed')
        jsonschema.validate(county_doc, schema)


class TestCoverage:
    """All 64 CO counties present; year ranges match."""

    def test_all_64_counties_present(self, county_doc):
        counts = county_doc['meta']['count_counties']
        assert counts == EXPECTED_CO_COUNTIES, (
            f'Expected {EXPECTED_CO_COUNTIES} CO counties, found {counts}'
        )
        actual = len(county_doc['counties'])
        assert actual == EXPECTED_CO_COUNTIES, (
            f'Counties dict has {actual} entries, meta claims {counts}'
        )

    def test_county_fips_all_5digit_starting_08(self, county_doc):
        for fips, rec in county_doc['counties'].items():
            assert len(fips) == 5, f'{fips}: not 5 digits'
            assert fips.startswith('08'), f'{fips}: not a CO county (08*)'
            assert rec['fips'] == fips, f'{fips}: record fips mismatch'

    def test_state_and_county_year_ranges_match(self, state_doc, county_doc):
        s_years = set(state_doc['years'].keys())
        # Pick a county with non-empty years and compare
        sample = next(iter(county_doc['counties'].values()))
        c_years = set(sample['years'].keys())
        assert s_years == c_years, (
            f'Year mismatch: state={sorted(s_years)} county={sorted(c_years)}'
        )


class TestPlausibility:
    """Roll-up sanity + value-range checks."""

    def test_county_originations_roll_up_to_state_within_5pct(self, state_doc, county_doc):
        for year in state_doc['years']:
            state_orig = state_doc['years'][year]['originations']
            county_total = sum(
                rec['years'][year]['originations']
                for rec in county_doc['counties'].values()
                if year in rec['years']
            )
            if state_orig == 0:
                continue
            diff_pct = abs(state_orig - county_total) / state_orig
            assert diff_pct < 0.05, (
                f'{year}: state originations ({state_orig:,}) and county sum '
                f'({county_total:,}) differ by {diff_pct*100:.1f}% — expected <5%'
            )

    def test_denial_rates_in_zero_to_one(self, state_doc, county_doc):
        for year, m in state_doc['years'].items():
            if m['denial_rate'] is not None:
                assert 0 <= m['denial_rate'] <= 1, (
                    f'state {year}: denial_rate={m["denial_rate"]} out of [0,1]'
                )
        for fips, rec in county_doc['counties'].items():
            for year, m in rec['years'].items():
                if m['denial_rate'] is not None:
                    assert 0 <= m['denial_rate'] <= 1, (
                        f'county {fips} {year}: denial_rate={m["denial_rate"]} out of [0,1]'
                    )

    def test_multifamily_share_under_5pct_statewide(self, state_doc):
        """Multifamily originations should be <5% of total CO originations
        in any year. Single-family purchase + refi dominate volume; if MF
        share spikes above 5%, something has gone wrong with the filter."""
        for year, m in state_doc['years'].items():
            if m['originations'] == 0:
                continue
            mf_share = m['multifamily']['originations'] / m['originations']
            assert mf_share < 0.05, (
                f'{year}: MF share {mf_share*100:.2f}% — expected <5% '
                f'(MF={m["multifamily"]["originations"]}, total={m["originations"]:,})'
            )

    def test_purpose_breakdown_sums_match_originations_within_2pct(self, state_doc):
        """by_purpose is computed via a separate API call with the same
        action_taken=1 filter, so purpose counts should sum to ≈ originations.
        Allow 2% drift for HMDA's 'NA' / unmapped purpose handling."""
        for year, m in state_doc['years'].items():
            purpose_sum = sum(m['by_purpose'].values())
            origs = m['originations']
            if origs == 0:
                continue
            diff = abs(purpose_sum - origs) / origs
            assert diff < 0.02, (
                f'{year}: by_purpose sum ({purpose_sum:,}) vs originations '
                f'({origs:,}) differ by {diff*100:.2f}% — expected <2%'
            )

    def test_decision_total_at_least_originations_plus_denials(self, state_doc):
        """decision_total must be ≥ originations + denials (it also includes
        approved-but-not-accepted, action 2)."""
        for year, m in state_doc['years'].items():
            assert m['decision_total'] >= m['originations'] + m['denials'], (
                f'{year}: decision_total ({m["decision_total"]:,}) < '
                f'originations + denials ({m["originations"] + m["denials"]:,})'
            )
