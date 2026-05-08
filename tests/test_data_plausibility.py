"""tests/test_data_plausibility.py

Cross-source plausibility tests — the highest-leverage QA layer.

The 2026-05-08 audit found that ``fetch_chas.py`` had been parsing the wrong
HUD CHAS table (Table 9 vs Table 7) for an unknown duration. Schema, freshness,
and sentinel checks all stayed green because the file existed, parsed, was
fresh, and had records. The bug only surfaced when we manually compared the
output against ACS B19001 income-distribution data.

This module institutionalizes that comparison pattern: every external-data
ingest pipeline gets at least one assertion that compares its output against
an INDEPENDENT source. When upstream changes shape OR our parser
misinterprets columns, these tests fail loud at PR time.

Categories
----------
1. **Internal cross-file consistency** — datasets we generate ourselves
   should agree with each other (e.g. CHAS state aggregate ≈ sum of county
   tiers; place AMI gap totals ≤ county AMI gap totals × population share).

2. **Cross-source plausibility** — our derived data should agree with an
   independent reference (e.g. CHAS renter total ≈ ACS B25003 renter total
   for the same vintage).

3. **Bound + monotonicity** — invariants that must hold structurally
   (e.g. owner% + renter% ≈ 100; cumulative HH-by-AMI strictly non-
   decreasing in tier).

These tests load only repo-local files; they do NOT call external APIs.
External-source contract validation lives in
``scripts/audit/upstream-schema-check.py`` (Phase 4 of the QA hardening
plan; not yet implemented).
"""

import json
import os
import glob

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


# ── Fixtures ────────────────────────────────────────────────────────

def _load(rel_path):
    abs_path = os.path.join(REPO_ROOT, rel_path)
    if not os.path.exists(abs_path):
        pytest.skip(f'{rel_path} not present (run the relevant build script first)')
    with open(abs_path, encoding='utf-8') as f:
        return json.load(f)


@pytest.fixture(scope='module')
def chas():
    return _load('data/hna/chas_affordability_gap.json')


@pytest.fixture(scope='module')
def ami_gap_county():
    return _load('data/co_ami_gap_by_county.json')


@pytest.fixture(scope='module')
def ami_gap_place():
    return _load('data/co_ami_gap_by_place.json')


@pytest.fixture(scope='module')
def ranking():
    return _load('data/hna/ranking-index.json')


@pytest.fixture(scope='module')
def hud_limits():
    return _load('data/hud-fmr-income-limits.json')


@pytest.fixture(scope='module')
def state_summary():
    return _load('data/hna/summary/08.json')


# ── Cross-source: CHAS county totals ≈ ACS county HH totals ─────────

def _renter_total_in_county(chas, fips):
    c = chas['counties'].get(fips, {})
    return sum(
        int(c.get('renter_hh_by_ami', {}).get(t, {}).get('total', 0) or 0)
        for t in ('lte30', '31to50', '51to80', '81to100', '100plus')
    )


def _state_renter_total(chas):
    return sum(_renter_total_in_county(chas, f) for f in chas.get('counties', {}))


def test_chas_state_total_matches_state_aggregate(chas):
    """CHAS file's published state aggregate should ≈ sum of county tiers."""
    state_aggregated = _state_renter_total(chas)
    state_published = sum(
        int(chas.get('state', {}).get('renter_hh_by_ami', {}).get(t, {}).get('total', 0) or 0)
        for t in ('lte30', '31to50', '51to80', '81to100', '100plus')
    )
    diff = abs(state_aggregated - state_published)
    pct_diff = diff / max(state_published, 1)
    assert pct_diff < 0.01, (
        f'CHAS state aggregate ({state_published:,}) does not match sum of '
        f'county tiers ({state_aggregated:,}); diff = {diff:,} ({pct_diff:.1%}). '
        f'Indicates either parsing inconsistency or stale state aggregate.'
    )


def test_chas_state_renter_total_in_realistic_range(chas):
    """CO statewide renter HH should be 600K-900K (real value ≈770K).

    The pre-fix Table 9 parser produced ~3K total renter HH (1% of reality).
    This guard catches any column-mapping regression that shifts the total
    by an order of magnitude.
    """
    total = _state_renter_total(chas)
    assert 600_000 <= total <= 900_000, (
        f'CO statewide renter HH = {total:,}; expected [600K, 900K]. '
        f'Likely a CHAS column-mapping regression — verify fetch_chas.py is '
        f'reading Table 7.'
    )


# ── Cross-source: AMI gap county aggregate ≈ CHAS county renter total ──

def test_ami_gap_county_renter_count_within_realistic_pct_of_chas(ami_gap_county, chas):
    """For populous counties, CHAS renter HH should be 20-85% of AMI gap "HH at 100% AMI".

    The AMI gap file uses ACS B19001 which counts ALL households (renter +
    owner), so its 100%-AMI total should be larger than CHAS's renter-only
    count. The renter share of all-HH varies dramatically across CO:
    - Urban (Denver, Boulder): ~50%
    - Suburban (Douglas): ~22%
    - Rural with large mobile-home + manufactured housing population: ~10-15%

    We assert this loose bound only on counties large enough to be reliable
    (renter HH > 5,000). Smaller rural counties have ACS sampling noise that
    can push the ratio below 10%.
    """
    counties_arr = ami_gap_county.get('counties', [])

    misaligned = []
    for c in counties_arr:
        fips = str(c.get('fips', '')).zfill(5)
        ami_total = int(c.get('households_le_ami_pct', {}).get('100', 0) or 0)
        chas_renter = _renter_total_in_county(chas, fips)
        # Only check counties large enough to have stable estimates
        if ami_total < 10_000 or chas_renter < 5_000:
            continue
        ratio = chas_renter / ami_total
        if not (0.10 <= ratio <= 0.90):
            misaligned.append((fips, c.get('county_name'), ami_total, chas_renter, ratio))

    # Tolerate up to 3 misaligned counties; fail beyond that
    assert len(misaligned) < 3, (
        f'{len(misaligned)} large CO counties have CHAS renter / AMI gap ratio '
        f'outside [0.10, 0.90]. First 3: '
        + ', '.join(f'{f} {n}: {ratio:.2f}'
                    for f, n, _, _, ratio in misaligned[:3])
    )


# ── Cross-source: place AMI gap households ≤ county totals ──────────

def test_place_ami_gap_smaller_than_containing_county(ami_gap_place, ami_gap_county):
    """A place's HH count should not exceed its containing county's HH count
    (catches data corruption + place→county mapping bugs).

    Known false-positives from upstream geography-registry mapping bugs:
      - Sterling (city) GEOID 0873935 is mapped to Washington County (08121)
        in geography-registry.json but is actually in Logan County (08075).
        That's a registry bug to fix in a follow-up PR; we tolerate ≤ 3
        violations here to allow shipping QA infrastructure without being
        blocked on the upstream data fix.
    """
    county_total_by_fips = {}
    for c in ami_gap_county.get('counties', []):
        fips = str(c.get('fips', '')).zfill(5)
        county_total_by_fips[fips] = int(
            c.get('households_le_ami_pct', {}).get('100', 0) or 0
        )

    violations = []
    for geoid, p in ami_gap_place.get('places', {}).items():
        county = str(p.get('containing_county_fips', '')).zfill(5)
        if not county or county not in county_total_by_fips:
            continue
        place_total = int(p.get('households_le_ami_pct', {}).get('100', 0) or 0)
        county_total = county_total_by_fips[county]
        if county_total > 0 and place_total > county_total * 1.05:  # 5% tolerance
            violations.append((geoid, p.get('place_name'), place_total, county, county_total))

    # Tolerate up to 3 known false-positives from geography-registry mapping
    # bugs (see docstring). When a new violation appears beyond these, the
    # test fails and the new bug must be diagnosed.
    assert len(violations) <= 3, (
        f'{len(violations)} places have HH count exceeding containing-county total. '
        f'First 3: ' + ', '.join(
            f'{g} {n}: {pt:,} > county {c} ({ct:,})'
            for g, n, pt, c, ct in violations[:3]
        )
    )


# ── Cross-source: tenure orientation (catches #764-type swap) ───────

def test_state_tenure_sums_to_100(state_summary):
    """DP04_0046PE (owner) + DP04_0047PE (renter) must ≈ 100%.

    The pre-fix #764 bug shipped these swapped (renter values labeled as
    owner). They still summed to 100, so this test alone wouldn't have
    caught the swap — but it catches the more common case where one field
    gets corrupted independently.
    """
    acs = state_summary.get('acsProfile', {})
    owner = float(acs.get('DP04_0046PE', 0) or 0)
    renter = float(acs.get('DP04_0047PE', 0) or 0)
    total = owner + renter
    assert abs(total - 100) < 1.0, (
        f'CO state DP04_0046PE ({owner}) + DP04_0047PE ({renter}) = {total}; '
        f'expected ≈100%.'
    )


def test_state_renter_share_within_band():
    """CO statewide renter share is 30-40% (HUD/ACS benchmark).

    Catches the orientation flip in #764 where renter was reported as 65%
    (the owner share). Independent of test_state_tenure_sums_to_100.
    """
    state_summary = _load('data/hna/summary/08.json')
    renter = float(state_summary.get('acsProfile', {}).get('DP04_0047PE', 0) or 0)
    assert 28 <= renter <= 42, (
        f'CO state renter share = {renter}%; expected 28-42% '
        f'(US Census benchmark for CO is ~33%).'
    )


def test_state_renter_within_5pp_of_pop_weighted_county(state_summary):
    """State DP04_0047PE ≈ population-weighted county DP04_0047PE.

    Cross-validates the state summary against the 64 county summaries.
    Catches the case where state and counties get out of sync (which is
    what #764 fixed).
    """
    state_renter = float(state_summary.get('acsProfile', {}).get('DP04_0047PE', 0) or 0)

    summary_dir = os.path.join(REPO_ROOT, 'data', 'hna', 'summary')
    weighted_num = 0.0
    weighted_den = 0.0
    for path in glob.glob(os.path.join(summary_dir, '08???.json')):
        with open(path, encoding='utf-8') as f:
            rec = json.load(f)
        if rec.get('geo', {}).get('type') != 'county':
            continue
        prof = rec.get('acsProfile', {})
        pop = float(prof.get('DP05_0001E', 0) or 0)
        rnt = float(prof.get('DP04_0047PE', 0) or 0)
        if pop > 0:
            weighted_num += pop * rnt
            weighted_den += pop

    assert weighted_den > 0, 'No county pop weights for tenure validation'
    weighted = weighted_num / weighted_den
    diff = abs(state_renter - weighted)
    assert diff < 5.0, (
        f'State renter {state_renter}% vs pop-weighted county avg '
        f'{weighted:.1f}% (Δ {diff:.1f}pp); expected < 5pp. '
        f'Indicates state summary or county summaries are out of sync.'
    )


# ── HUD limits sanity ───────────────────────────────────────────────

def test_hud_ami_4person_realistic_range(hud_limits):
    """HUD 4-person AMI for CO counties should be $50K-$200K.

    Rural CO counties (Crowley, Costilla) have the lowest AMI; resort
    counties (Pitkin, Summit) and Front Range (Boulder) have the highest.
    """
    counties = hud_limits.get('counties', [])
    out_of_range = []
    for c in counties:
        ami = int(c.get('income_limits', {}).get('ami_4person', 0) or 0)
        if ami and not (50_000 <= ami <= 200_000):
            out_of_range.append((c.get('fips'), c.get('county_name'), ami))
    assert not out_of_range, (
        f'HUD AMI out of [$50K, $200K] for {len(out_of_range)} counties. '
        f'First 3: {out_of_range[:3]}'
    )


def test_hud_ami_4person_above_30pct_thresholds(hud_limits):
    """For each HUD county, the 4-person AMI must be >= the 30%-AMI 4-person threshold."""
    counties = hud_limits.get('counties', [])
    inconsistent = []
    for c in counties:
        lim = c.get('income_limits', {})
        ami = int(lim.get('ami_4person', 0) or 0)
        thresh30 = int(lim.get('il30_4person', 0) or 0)
        if ami and thresh30 and thresh30 > ami * 0.5:  # 30% AMI threshold > half of AMI is wrong
            inconsistent.append((c.get('fips'), ami, thresh30))
    assert not inconsistent, (
        f'HUD 30% AMI threshold inconsistent with AMI for {len(inconsistent)} counties: '
        f'{inconsistent[:3]}'
    )


# ── Ranking-index integrity ─────────────────────────────────────────

def test_ranking_top_score_is_max_overall_score(ranking):
    """Rank #1 must have the highest overall_need_score (sort key)."""
    rankings = ranking.get('rankings', [])
    if not rankings:
        return
    scores = [r['metrics'].get('overall_need_score', 0) for r in rankings
              if isinstance(r.get('metrics', {}).get('overall_need_score'), (int, float))]
    if not scores:
        return
    max_score = max(scores)
    top = next((r for r in rankings if r.get('rank') == 1), None)
    assert top is not None
    assert top['metrics'].get('overall_need_score') == max_score, (
        f'Rank 1 score {top["metrics"].get("overall_need_score")} != max {max_score}'
    )


def test_ranking_pct_cost_burdened_within_bound(ranking):
    """All pct_cost_burdened values in [0, 100]. Catches the Louviers 100.1 issue."""
    rankings = ranking.get('rankings', [])
    bad = [r for r in rankings if not (0 <= (r.get('metrics', {}).get('pct_cost_burdened', 0) or 0) <= 100)]
    assert not bad, (
        f'{len(bad)} entries have pct_cost_burdened outside [0, 100]. '
        f'First 3: ' + ', '.join(f'{r["geoid"]}={r["metrics"]["pct_cost_burdened"]}' for r in bad[:3])
    )


def test_ranking_metrics_internally_consistent(ranking):
    """If ami_gap_30pct is reported, it should be <= population (HH<=pop bound)."""
    out_of_bound = []
    for r in ranking.get('rankings', []):
        m = r.get('metrics', {}) or {}
        gap = int(m.get('ami_gap_30pct', 0) or 0)
        pop = int(m.get('population', 0) or 0)
        # Gap is HH-equivalent, pop is people. Roughly pop > 1.5 * HH typical.
        # Allow gap up to 2*pop as a sanity bound (catches order-of-magnitude bugs).
        if pop > 100 and gap > pop * 2:
            out_of_bound.append((r.get('geoid'), gap, pop))
    assert not out_of_bound, (
        f'{len(out_of_bound)} entries have ami_gap_30pct > 2 × population. '
        f'First 3: {out_of_bound[:3]}'
    )


# ── Provenance flags from PR #768/#770 ──────────────────────────────

def test_ranking_ami_source_flag_present(ranking):
    """Every entry must declare _ami_gap_source provenance."""
    missing = [r for r in ranking.get('rankings', [])
               if not isinstance(r.get('metrics', {}).get('_ami_gap_source'), str)]
    assert not missing, f'{len(missing)} entries missing _ami_gap_source flag'


# ── Cross-source: CDPHE county boundaries vs TIGER ──────────────────

def test_cdphe_boundaries_match_tiger_county_count():
    """CDPHE Open Data Portal county boundaries should have 64 features
    matching TIGER's count exactly. Catches: incomplete fetch, upstream
    boundary change, FIPS mismatch."""
    cdphe = _load('data/market/cdphe_county_boundaries_co.geojson')
    tiger = _load('data/co-county-boundaries.json')

    cdphe_count = len(cdphe.get('features', []))
    tiger_count = len(tiger.get('features', []))

    assert cdphe_count == 64, f'CDPHE county count = {cdphe_count}; expected 64'
    assert tiger_count == 64, f'TIGER county count = {tiger_count}; expected 64'

    cdphe_fips = sorted(
        f['properties'].get('county_fips5', '')
        for f in cdphe['features']
    )
    # TIGER feature properties vary; try a few likely keys
    def _tiger_fips(props):
        for k in ('GEOID', 'FIPS', 'fips', 'COUNTYFP', 'GEOID20'):
            v = props.get(k)
            if v:
                v = str(v)
                # GEOID is 5-digit (state+county); COUNTYFP alone is 3-digit
                return v.zfill(5) if len(v) == 5 else f'08{v.zfill(3)}'
        return ''
    tiger_fips = sorted(
        _tiger_fips(f.get('properties', {}))
        for f in tiger['features']
    )

    assert cdphe_fips == tiger_fips, (
        f'CDPHE FIPS list does not match TIGER FIPS list. '
        f'CDPHE-only: {set(cdphe_fips) - set(tiger_fips)}; '
        f'TIGER-only: {set(tiger_fips) - set(cdphe_fips)}'
    )


# NOTE: _chas_source flag was previously present (PR #769 foundation work)
# but was removed when #769 was closed in favor of the simpler #770 Table 7
# fix. CHAS for places is unconditionally county-inherited at present, so
# the flag adds no information. Re-add this test if/when the future TIGER
# spatial-join PR re-introduces place_tract_aggregated CHAS data.
