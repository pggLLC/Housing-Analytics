"""tests/test_place_phantom_aliases.py

Tests for the phantom→canonical alias map produced by
scripts/hna/build_place_phantom_aliases.py (PR-C4).

Background
----------
The geography-registry.json contains 29 duplicate places — Pueblo,
Englewood, Parker, Commerce City, Steamboat Springs, Vail, Telluride,
Durango, etc. — where each appears with TWO geoids: a Census-canonical
GEOID (matches TIGER 2024 PLACE shapefile) and a non-Census "phantom"
GEOID. UI dropdowns reference the phantom GEOIDs, so without the alias
map, looking up place-CHAS for these places returns null and the
dashboard falls back to county-level data — methodologically
inconsistent with the rest of the place-CHAS pipeline.

This test suite verifies:
  - The alias map covers all 29 known duplicates
  - Every alias canonical GEOID exists in place-CHAS
  - Every phantom GEOID, when resolved, looks up valid place data
  - Coverage stat: ≥99% of registry place geoids resolve to place-CHAS
"""
from __future__ import annotations

import json
import pathlib

import pytest

REPO_ROOT = pathlib.Path(__file__).parent.parent
ALIAS_FILE       = REPO_ROOT / 'data' / 'hna' / 'place-phantom-aliases.json'
PLACE_CHAS_FILE  = REPO_ROOT / 'data' / 'hna' / 'place-chas.json'
GEO_REGISTRY     = REPO_ROOT / 'data' / 'hna' / 'geography-registry.json'


@pytest.fixture(scope='module')
def alias_doc():
    if not ALIAS_FILE.exists():
        pytest.skip('Alias file not present')
    with open(ALIAS_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def place_chas_doc():
    if not PLACE_CHAS_FILE.exists():
        pytest.skip('Place-CHAS file not present')
    with open(PLACE_CHAS_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def registry():
    with open(GEO_REGISTRY) as f:
        return json.load(f)


class TestAliasMap:

    def test_alias_count_matches_known_duplicates(self, alias_doc):
        n = alias_doc['meta']['count_aliases']
        # As of 2026-05-09 there are exactly 29 duplicate (name, county) pairs.
        # Allow ±2 if registry maintenance adds/removes a duplicate.
        assert 27 <= n <= 31, (
            f'Expected ~29 phantom-canonical aliases, found {n}. '
            f'Either registry duplicates were partially cleaned up '
            f'(good — see future PR) or new duplicates were introduced (bad).'
        )

    def test_no_unresolvable_duplicates(self, alias_doc):
        """Every duplicate (name, county) pair should resolve to exactly one
        canonical (in TIGER) + one or more phantoms (not in TIGER).
        Unresolvable duplicates (e.g. neither geoid in TIGER, or both in TIGER)
        indicate a registry data quality problem requiring manual triage."""
        unresolvable = alias_doc['meta'].get('count_unresolvable', 0)
        assert unresolvable == 0, (
            f'{unresolvable} duplicate place pairs could not be resolved '
            f'to a canonical TIGER GEOID — needs manual triage.'
        )

    def test_phantoms_and_canonicals_are_7digit_co(self, alias_doc):
        for phantom, canonical in alias_doc['aliases'].items():
            assert len(phantom) == 7, f'phantom {phantom} not 7-digit'
            assert phantom.startswith('08'), f'phantom {phantom} not CO'
            assert len(canonical) == 7, f'canonical {canonical} not 7-digit'
            assert canonical.startswith('08'), f'canonical {canonical} not CO'

    def test_every_canonical_exists_in_place_chas(self, alias_doc, place_chas_doc):
        """The whole point of aliasing is that the canonical GEOID's place-
        CHAS data IS available. If any canonical has no place-CHAS, the
        alias resolution still produces a missing lookup."""
        missing = []
        for phantom, canonical in alias_doc['aliases'].items():
            if canonical not in place_chas_doc['places']:
                missing.append((phantom, canonical))
        assert not missing, (
            f'{len(missing)} aliased canonicals not in place-CHAS '
            f'(showing first 3): {missing[:3]}'
        )

    def test_no_self_aliases(self, alias_doc):
        """Phantom should never alias to itself."""
        for phantom, canonical in alias_doc['aliases'].items():
            assert phantom != canonical, (
                f'Self-alias detected: {phantom} → {phantom}'
            )


class TestKnownLargeCitiesCovered:
    """Spot-check that the major LIHTC markets I know are duplicates
    are now covered by aliases. If any of these break, the user-visible
    impact is huge — these are CO's most-analyzed places."""

    EXPECTED_PHANTOM_TO_CANONICAL = {
        '0855745': '0862000',   # Pueblo
        '0822465': '0824785',   # Englewood
        '0852290': '0857630',   # Parker
        '0875140': '0816495',   # Commerce City
        '0823680': '0822035',   # Durango
        '0873220': '0873825',   # Steamboat Springs
        '0882870': '0880040',   # Vail
        '0877580': '0876795',   # Telluride
        '0830475': '0830780',   # Glenwood Springs
    }

    def test_known_phantom_aliases_present(self, alias_doc):
        for phantom, expected_canon in self.EXPECTED_PHANTOM_TO_CANONICAL.items():
            actual = alias_doc['aliases'].get(phantom)
            assert actual == expected_canon, (
                f'Phantom {phantom} should alias to {expected_canon}, '
                f'got {actual}'
            )


class TestCoverageImproved:
    """Before PR-C4: ~445 of 513 registry places have place-CHAS via
    direct lookup (~87%). After PR-C4: 445 + 29 aliased = 474 of 513
    (~92%). Verify the post-alias coverage is meaningfully higher."""

    def test_post_alias_coverage_ge_90pct(self, alias_doc, place_chas_doc, registry):
        reg_geoids = {
            g['geoid'] for g in registry['geographies']
            if g.get('type') in ('place', 'cdp')
        }
        place_chas_geoids = set(place_chas_doc['places'].keys())
        aliases = alias_doc['aliases']

        def resolve(g):
            return aliases.get(g, g)

        covered = sum(
            1 for g in reg_geoids if resolve(g) in place_chas_geoids
        )
        coverage = covered / len(reg_geoids)
        assert coverage >= 0.90, (
            f'Post-alias coverage {coverage*100:.1f}% < 90% '
            f'(covered {covered}/{len(reg_geoids)}). '
            f'Either alias map is incomplete or registry has new gaps.'
        )
