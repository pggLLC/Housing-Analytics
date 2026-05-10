"""tests/test_place_chas_coverage.py

Plausibility tests for the place-CHAS coverage stats produced by
scripts/hna/build_place_chas_coverage_stats.py.

Verifies:
  - Schema-ish structural integrity (totals + by_county + uncovered_places)
  - Sums add up: covered_direct + covered_via_alias + zero + uncovered = total
  - Coverage % matches arithmetic
  - Per-county sum reconciles to total
  - Coverage stays above a sane floor (≥85%)
  - Phantom-alias bucket is non-empty (regression-protects PR #791
    integration — if alias wiring breaks, this drops to 0)
"""
from __future__ import annotations

import json
import pathlib

import pytest

REPO_ROOT = pathlib.Path(__file__).parent.parent
STATS_FILE = REPO_ROOT / 'data' / 'hna' / 'place-chas-coverage-stats.json'


@pytest.fixture(scope='module')
def stats():
    if not STATS_FILE.exists():
        pytest.skip('Coverage stats not present')
    with open(STATS_FILE) as f:
        return json.load(f)


class TestStructure:

    def test_has_required_top_level_keys(self, stats):
        assert 'meta' in stats
        assert 'totals' in stats
        assert 'by_county' in stats
        assert 'uncovered_places' in stats

    def test_totals_has_required_buckets(self, stats):
        t = stats['totals']
        for k in ('registry_places', 'covered_direct', 'covered_via_alias',
                  'covered_with_zero_apportion', 'uncovered_county_fallback',
                  'coverage_pct'):
            assert k in t, f'totals missing key {k}'


class TestArithmetic:

    def test_buckets_sum_to_total(self, stats):
        t = stats['totals']
        s = (
            t['covered_direct']
            + t['covered_via_alias']
            + t['covered_with_zero_apportion']
            + t['uncovered_county_fallback']
        )
        assert s == t['registry_places'], (
            f'Buckets sum ({s}) != registry_places ({t["registry_places"]})'
        )

    def test_coverage_pct_matches_arithmetic(self, stats):
        t = stats['totals']
        covered = (
            t['covered_direct']
            + t['covered_via_alias']
            + t['covered_with_zero_apportion']
        )
        expected = round(covered / t['registry_places'] * 100, 1)
        assert abs(t['coverage_pct'] - expected) < 0.05

    def test_per_county_sum_reconciles(self, stats):
        county_total = sum(c['total_places'] for c in stats['by_county'].values())
        # Allow off-by-some — geography-registry has a few stragglers tagged
        # with non-county-FIPS containingCounty values that bucket as 'unknown'.
        # If reconciliation is off by >5%, something is wrong.
        registry_total = stats['totals']['registry_places']
        diff = abs(county_total - registry_total) / registry_total
        assert diff < 0.05, (
            f'Per-county sum ({county_total}) and total ({registry_total}) '
            f'differ by {diff*100:.1f}% — expected <5%'
        )


class TestThresholds:

    def test_coverage_above_85pct_floor(self, stats):
        pct = stats['totals']['coverage_pct']
        assert pct >= 85, (
            f'Coverage {pct}% below 85% floor — likely a regression in '
            f'TIGER spatial join or phantom alias wiring.'
        )

    def test_phantom_alias_bucket_nonempty(self, stats):
        """If this hits zero, the PR #791 alias wiring has regressed —
        major CO cities like Pueblo, Englewood, Parker would silently
        fall back to county data again."""
        n = stats['totals']['covered_via_alias']
        assert n >= 25, (
            f'Phantom-alias bucket has only {n} places — expected ~29. '
            f'PR #791 alias wiring likely regressed.'
        )

    def test_uncovered_count_under_30(self, stats):
        """A reasonable upper bound on county-fallback places. If this
        creeps higher, time to investigate."""
        n = stats['totals']['uncovered_county_fallback']
        assert n <= 30, (
            f'Uncovered places: {n}. Floor was ~20 as of 2026-05-10; '
            f'>30 suggests new gaps need investigation.'
        )


class TestUncoveredList:

    def test_uncovered_list_matches_count(self, stats):
        assert len(stats['uncovered_places']) == stats['totals']['uncovered_county_fallback']

    def test_each_uncovered_has_required_fields(self, stats):
        for p in stats['uncovered_places']:
            assert 'geoid' in p
            assert 'name' in p
            assert 'county_fips' in p
            assert 'reason' in p
            assert p['reason'] in ('no_tiger_coverage', 'zero_apportionment')
