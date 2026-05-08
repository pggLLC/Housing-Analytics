"""tests/test_chas_parsing.py

Regression guards for ``data/hna/chas_affordability_gap.json`` produced by
``scripts/fetch_chas.py``.

Prior bug these probes exist to prevent reintroducing:

1. **Wrong CHAS table.** The pre-fix parser read CHAS Table 9 (Tenure ×
   Race × Cost Burden) and treated the race-position cells as HAMFI tiers.
   This produced impossibly low ≤30% HAMFI renter counts across all 64 CO
   counties — Denver showed 1,002 (real ≈39,000+), Mesa showed 363 (real
   ≈3,800+). Statewide CO ≤30% HAMFI renter HH was ~3,000 vs real ≈165,000.

   Fixed by switching to Table 7 (Tenure × Income(5) × HHType × Cost
   Burden), the documented standard cross-tab for cost-burden by HAMFI.
   See top of scripts/fetch_chas.py for the column layout.

These tests assert plausible distributions in the on-disk CHAS data file.
Run after every regeneration. Cheap (one JSON load).
"""

import json
import os

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CHAS_PATH = os.path.join(REPO_ROOT, 'data', 'hna', 'chas_affordability_gap.json')


@pytest.fixture(scope='module')
def chas_data() -> dict:
    """Load the CHAS county data once per test session."""
    if not os.path.exists(CHAS_PATH):
        pytest.skip(f'{CHAS_PATH} not present — run scripts/fetch_chas.py first.')
    with open(CHAS_PATH, encoding='utf-8') as f:
        return json.load(f)


@pytest.fixture(scope='module')
def counties(chas_data) -> dict:
    return chas_data.get('counties', {}) or {}


def _renter_total(county: dict, tier: str) -> int:
    return int(county.get('renter_hh_by_ami', {}).get(tier, {}).get('total', 0) or 0)


def _renter_burdened(county: dict, tier: str) -> int:
    return int(county.get('renter_hh_by_ami', {}).get(tier, {}).get('cost_burdened', 0) or 0)


# ── Plausibility tests ───────────────────────────────────────────────

def test_meta_present(chas_data):
    """Metadata block exists with vintage info."""
    meta = chas_data.get('meta', {}) or {}
    assert meta, "CHAS file should have a 'meta' block"
    # Either 'vintage' or 'fiscal_year' — accept any timestamp / vintage marker
    assert any(meta.get(k) for k in ('vintage', 'generated', 'fiscal_year'))


def test_all_64_co_counties_present(counties):
    """CHAS data covers all 64 Colorado counties (state fips 08)."""
    co_keys = [k for k in counties.keys() if str(k).startswith('08')]
    assert len(co_keys) == 64, (
        f'Expected 64 CO counties in CHAS, got {len(co_keys)}: {sorted(co_keys)[:10]}...'
    )


def test_statewide_lte30_renter_count_plausible(counties):
    """Statewide CO renter HH at ≤30% HAMFI must be > 100K.

    The Table-9 parser bug produced ~3K statewide. Real value is ~165K.
    This guard would have caught the 2026-04 audit finding immediately.
    """
    statewide_lte30 = sum(_renter_total(c, 'lte30') for c in counties.values())
    assert statewide_lte30 > 100_000, (
        f'Statewide CO ≤30% HAMFI renter HH = {statewide_lte30:,}; '
        f'expected > 100,000. Likely a CHAS column-mapping bug — verify '
        f'fetch_chas.py is reading Table 7 (not Table 9 / Table 1).'
    )


def test_denver_lte30_renter_count_plausible(counties):
    """Denver County (08031) ≤30% HAMFI renter HH should be > 25,000.

    The Table-9 parser bug produced 1,002 for Denver.
    """
    denver = counties.get('08031', {})
    assert denver, 'Denver County (08031) missing from CHAS counties'
    lte30 = _renter_total(denver, 'lte30')
    assert lte30 > 25_000, (
        f'Denver ≤30% HAMFI renter HH = {lte30:,}; expected > 25,000.'
    )


def test_low_income_burden_concentration(counties):
    """≤30% AMI renters should have HIGH cost-burden share (typically 60-90%).

    Pre-fix Table 9 parser produced ~21% burden rate for Denver ≤30% AMI
    renters — implausibly low. Real value ≈73% (per HUD's national patterns,
    severe burden is concentrated in the lowest income tier).

    We assert the median CO county has burden rate >= 50% within the lte30
    tier. Allow some rural counties with small N to fall below.
    """
    rates = []
    for fips, c in counties.items():
        total = _renter_total(c, 'lte30')
        if total < 100:  # rural counties with too-small N for reliable burden %
            continue
        burdened = _renter_burdened(c, 'lte30')
        rates.append(100 * burdened / total)
    rates.sort()
    median = rates[len(rates) // 2] if rates else 0
    assert median >= 50.0, (
        f'Median CO county ≤30% HAMFI cost-burden rate = {median:.1f}% '
        f'across {len(rates)} counties; expected >= 50%. Pre-fix Table 9 '
        f'parsing produced ~21% rates — likely a column-mapping regression.'
    )


def test_per_county_lte30_burdens_dont_exceed_total(counties):
    """Sanity: cost_burdened count must not exceed total within each tier.

    Captures any future regression where the burden cells get mapped to a
    different tier or get summed over the wrong dimension.
    """
    violations = []
    for fips, c in counties.items():
        for tier in ('lte30', '31to50', '51to80', '81to100', '100plus'):
            td = c.get('renter_hh_by_ami', {}).get(tier, {}) or {}
            total = int(td.get('total', 0) or 0)
            burdened = int(td.get('cost_burdened', 0) or 0)
            if total > 0 and burdened > total:
                violations.append((fips, tier, total, burdened))
    assert not violations, (
        f'cost_burdened > total in {len(violations)} (county, tier) pairs '
        f'(first 5: {violations[:5]})'
    )


def test_five_hamfi_tiers_present(counties):
    """All 5 HAMFI tiers from Table 7 should appear in renter_hh_by_ami."""
    expected_tiers = {'lte30', '31to50', '51to80', '81to100', '100plus'}
    for fips, c in counties.items():
        renter = c.get('renter_hh_by_ami', {}) or {}
        actual = set(renter.keys())
        missing = expected_tiers - actual
        assert not missing, (
            f'County {fips} missing HAMFI tiers: {missing}. '
            f'Table 7 has 5 tiers; ensure aggregator emits all of them.'
        )
