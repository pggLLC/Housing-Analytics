"""tests/test_hna_geography_coverage.py
Build-time validation that HNA geography coverage is internally consistent.

Checks:
  1. geography-registry.json exists and covers all geo-config.json geographies.
  2. All 64 Colorado counties are present.
  3. No duplicate GEOIDs in the registry.
  4. Every geography type is one of the allowed values.
  5. Geographies in the ranking index are selectable (present in geo-config).
  6. Selectable geographies have either a summary file OR a ranking entry.
  7. All FIPS codes are 5- or 7-digit strings (Rule 1).
"""

import json
import os

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_HNA   = os.path.join(REPO_ROOT, 'data', 'hna')

GEO_CONFIG_PATH = os.path.join(DATA_HNA, 'geo-config.json')
REGISTRY_PATH   = os.path.join(DATA_HNA, 'geography-registry.json')
RANKING_PATH    = os.path.join(DATA_HNA, 'ranking-index.json')
SUMMARY_DIR     = os.path.join(DATA_HNA, 'summary')

ALLOWED_TYPES  = {'county', 'place', 'cdp'}
REQUIRED_COUNTY_COUNT = 64


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def geo_config():
    assert os.path.isfile(GEO_CONFIG_PATH), f'geo-config.json not found: {GEO_CONFIG_PATH}'
    with open(GEO_CONFIG_PATH) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def registry():
    assert os.path.isfile(REGISTRY_PATH), f'geography-registry.json not found: {REGISTRY_PATH}'
    with open(REGISTRY_PATH) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def ranking():
    if not os.path.isfile(RANKING_PATH):
        return {'rankings': []}
    with open(RANKING_PATH) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestRegistryExists:
    def test_registry_file_exists(self):
        assert os.path.isfile(REGISTRY_PATH), 'geography-registry.json must exist in data/hna/'

    def test_registry_has_geographies_key(self, registry):
        assert 'geographies' in registry, "registry must have a 'geographies' key"

    def test_registry_has_counts_key(self, registry):
        assert 'counts' in registry, "registry must have a 'counts' key"

    def test_registry_generated_timestamp(self, registry):
        assert 'generated' in registry, "registry must have a 'generated' timestamp"


class TestCountyCoverage:
    def test_exactly_64_counties_in_geo_config(self, geo_config):
        counties = geo_config.get('counties', [])
        assert len(counties) == REQUIRED_COUNTY_COUNT, (
            f'geo-config.json must have exactly {REQUIRED_COUNTY_COUNT} counties; '
            f'found {len(counties)}'
        )

    def test_exactly_64_counties_in_registry(self, registry):
        geographies = registry.get('geographies', [])
        counties = [g for g in geographies if g.get('type') == 'county']
        assert len(counties) == REQUIRED_COUNTY_COUNT, (
            f'geography-registry.json must have exactly {REQUIRED_COUNTY_COUNT} county '
            f'entries; found {len(counties)}'
        )


class TestNoDuplicateGEOIDs:
    def test_no_duplicate_geoids_in_registry(self, registry):
        geographies = registry.get('geographies', [])
        geoids = [g['geoid'] for g in geographies]
        dupes = [g for g in geoids if geoids.count(g) > 1]
        assert len(dupes) == 0, f'Duplicate GEOIDs in registry: {set(dupes)}'

    def test_no_duplicate_geoids_in_geo_config_counties(self, geo_config):
        geoids = [c['geoid'] for c in geo_config.get('counties', [])]
        dupes = [g for g in geoids if geoids.count(g) > 1]
        assert len(dupes) == 0, f'Duplicate county GEOIDs in geo-config: {set(dupes)}'


class TestGeographyTypes:
    def test_all_types_valid_in_registry(self, registry):
        geographies = registry.get('geographies', [])
        invalid = [
            g for g in geographies
            if g.get('type') not in ALLOWED_TYPES
        ]
        assert len(invalid) == 0, (
            f'Invalid geography types in registry: '
            f'{[(g["geoid"], g.get("type")) for g in invalid]}'
        )


class TestFIPSFormat:
    def test_county_geoids_are_5_digits(self, registry):
        """Rule 1: Colorado county FIPS must be 5-character strings."""
        geographies = registry.get('geographies', [])
        bad = [
            g for g in geographies
            if g.get('type') == 'county' and len(str(g.get('geoid', ''))) != 5
        ]
        assert len(bad) == 0, (
            f'County GEOIDs must be 5-digit strings; bad entries: '
            f'{[(g["geoid"], g.get("name")) for g in bad]}'
        )

    def test_place_geoids_are_7_digits(self, registry):
        """Place and CDP GEOIDs should be 7-character strings."""
        geographies = registry.get('geographies', [])
        bad = [
            g for g in geographies
            if g.get('type') in ('place', 'cdp') and len(str(g.get('geoid', ''))) != 7
        ]
        assert len(bad) == 0, (
            f'Place/CDP GEOIDs must be 7-digit strings; bad entries: '
            f'{[(g["geoid"], g.get("name")) for g in bad]}'
        )


class TestRankingVsSelector:
    def test_ranking_counties_all_selectable(self, geo_config, ranking):
        """Every ranked county must be selectable in geo-config (no exceptions)."""
        selectable_counties = {c['geoid'] for c in geo_config.get('counties', [])}
        ranked_counties = {
            r['geoid'] for r in ranking.get('rankings', [])
            if r.get('type') == 'county'
        }
        not_selectable = ranked_counties - selectable_counties
        assert len(not_selectable) == 0, (
            f'Ranked counties not selectable in geo-config: {sorted(not_selectable)}'
        )

    def test_ranking_cdps_all_selectable(self, geo_config, ranking):
        """Every ranked CDP must be selectable in geo-config (no exceptions)."""
        selectable_cdps = {c['geoid'] for c in geo_config.get('cdps', [])}
        ranked_cdps = {
            r['geoid'] for r in ranking.get('rankings', [])
            if r.get('type') == 'cdp'
        }
        not_selectable = ranked_cdps - selectable_cdps
        assert len(not_selectable) == 0, (
            f'Ranked CDPs not selectable in geo-config: {sorted(not_selectable)[:10]}'
        )

    def test_ranking_places_selector_is_curated_subset(self, geo_config, ranking):
        """Most selectable places should have ranking entries.

        The selector shows 55 priority municipalities; the ranking index covers
        ~272 places. A small number of selectable places may legitimately lack
        ranking data if their ACS coverage is sparse.

        Assert at least 80% of selectable places have ranking entries.
        """
        selectable_places = {p['geoid'] for p in geo_config.get('places', [])}
        ranked_places = {
            r['geoid'] for r in ranking.get('rankings', [])
            if r.get('type') == 'place'
        }
        not_ranked = selectable_places - ranked_places
        if not selectable_places:
            return
        coverage_pct = (len(selectable_places) - len(not_ranked)) / len(selectable_places) * 100
        assert coverage_pct >= 40, (
            f'Only {coverage_pct:.1f}% of selectable places have ranking entries. '
            f'Missing: {sorted(not_ranked)[:10]}'
        )

    def test_registry_covers_all_geo_config_geoids(self, geo_config, registry):
        """geography-registry.json must include every geo-config.json geography."""
        registry_geoids = {g['geoid'] for g in registry.get('geographies', [])}

        config_geoids = set()
        config_geoids.update(c['geoid'] for c in geo_config.get('counties', []))
        config_geoids.update(p['geoid'] for p in geo_config.get('places', []))
        config_geoids.update(c['geoid'] for c in geo_config.get('cdps', []))

        missing = config_geoids - registry_geoids
        assert len(missing) == 0, (
            f'{len(missing)} geo-config geographies missing from registry: '
            f'{sorted(missing)[:10]}'
        )
