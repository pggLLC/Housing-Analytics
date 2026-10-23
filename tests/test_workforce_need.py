"""data/hna/workforce-need.json agrees with its inputs and with its own method.

Held as agreement: each county's and place's present in-commuter need is
recomputed here from the cached LODES in-commuters by pay tier and the ACS
PUMS crosswalk (data/hna/workforce-ami-crosswalk.json), and must equal what
the builder published. A file that drifts from its inputs, or a builder that
starts counting jobs as homes, fails.
"""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def load(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return json.load(f)


WN = load('data/hna/workforce-need.json')
AUX = load('data/hna/source/lodes_primary_jobs.json')


def test_all_64_counties_present():
    counties = WN['counties']
    assert len(counties) == 64
    assert all(len(k) == 5 and k.startswith('08') for k in counties)


XW = load('data/hna/workforce-ami-crosswalk.json')
TIERS = ('CE01', 'CE02', 'CE03')
BANDS = ('le30', '30_50', '50_60', '60_80', '80_120', 'over120')


def need(by_tier, county):
    """The builder's arithmetic, from the two committed inputs."""
    x = XW['counties'][county]['tiers']
    cut = WN['meta']['income_cut']
    homes = sum(n * x[t][cut][0] for n, t in zip(by_tier, TIERS))
    le60 = sum(n * x[t]['le60'][0] for n, t in zip(by_tier, TIERS))
    return homes, le60


def test_county_figures_recompute_from_inputs():
    checked = 0
    for fips, rec in WN['counties'].items():
        if rec['present_incommuter_need'] is None:
            assert rec.get('unavailableReason'), fips + ' is absent without a reason'
            continue
        # Primary jobs (JT01) only, so a person with two jobs is one person;
        # out-of-state in-commuters (LODES aux) are in the tier counts.
        by_tier = AUX['incommuters_by_tier']['counties'][fips]
        assert rec['incommuters_by_tier'] == by_tier, fips
        aux_out = AUX['incommuters_by_tier']['out_of_state_counties'].get(fips, [0, 0, 0])
        assert all(a <= b for a, b in zip(aux_out, by_tier)), fips + ': out-of-state in-commuters exceed all in-commuters'
        homes, le60 = need(by_tier, fips)
        assert rec['present_incommuter_need']['move_closer_25'] == round(homes * 0.25), fips
        assert rec['present_incommuter_need']['move_closer_50'] == round(homes * 0.50), fips
        assert rec['incommuter_households_le60'] == round(le60), fips
        checked += 1
    assert checked == 64, 'only %d counties had a figure to check' % checked


def test_place_figures_use_their_own_commuters_and_their_countys_crosswalk():
    checked = 0
    for gid, rec in WN['places'].items():
        if rec['present_incommuter_need'] is None:
            assert rec.get('unavailableReason'), gid
            continue
        homes, le60 = need(rec['incommuters_by_tier'], rec['containingCounty'])
        assert rec['present_incommuter_need']['move_closer_25'] == round(homes * 0.25), gid
        assert rec['incommuter_households_le60'] == round(le60), gid
        checked += 1
    assert checked >= 470, 'only %d places had a figure to check' % checked
    # Fruita's in-commuters are its own block-level count, not Mesa County's.
    fruita = WN['places']['0828745']
    assert fruita['incommuters_by_tier'] == AUX['incommuters_by_tier']['places']['0828745']
    assert sum(fruita['incommuters_by_tier']) < sum(WN['counties']['08077']['incommuters_by_tier'])


def test_the_split_by_income_adds_up_to_the_figure():
    for gid, rec in list(WN['counties'].items()) + list(WN['places'].items()):
        if rec['present_incommuter_need'] is None:
            continue
        parts = sum(rec['present_incommuter_need_by_ami'].values())
        # The crosswalk stores each share to four places, so the parts can
        # miss the whole by rounding: a few homes, or 0.05% in a big county.
        total = rec['present_incommuter_need']['move_closer_25']
        assert abs(parts - total) <= max(3, 0.0005 * total), gid
        assert rec['present_incommuter_need_moe90'] >= 0, gid


def test_crosswalk_covers_every_county_and_adds_up():
    counties = XW['counties']
    assert len(counties) == 64
    regions = XW['regions']
    assert sorted(c for r in regions.values() for c in r['counties']) == sorted(counties)
    for fips, rec in counties.items():
        assert rec['region'] in regions, fips
        for t in TIERS:
            x = rec['tiers'][t]
            assert abs(sum(x[b][0] for b in BANDS) - x['all'][0]) < 0.002, (fips, t)
            assert abs(sum(x[b][0] for b in BANDS[:3]) - x['le60'][0]) < 0.002, (fips, t)
            assert abs(sum(x[b][0] for b in BANDS[:5]) - x['le120'][0]) < 0.002, (fips, t)
            # Households per job: below one (some households hold two
            # workers), and every share carries a standard error.
            assert 0.4 < x['all'][0] < 0.9, (fips, t, x['all'])
            assert all(x[k][1] > 0 for k in x), (fips, t)
    # Higher pay, fewer households at or below 60% AMI per job.
    for fips, rec in counties.items():
        x = rec['tiers']
        assert x['CE01']['le60'][0] > x['CE03']['le60'][0], fips
        assert x['CE02']['le60'][0] > x['CE03']['le60'][0], fips
    for reg, r in regions.items():
        assert min(r['sample_workers']) >= 100, reg


def test_margin_carries_the_tiers_covariance():
    # All three tiers come from one PUMS sample, so the published margin is
    # the sum over tier pairs of n_i x n_j x cov(i, j), not each tier's error
    # alone. The covariance's diagonal is each tier's own error, squared.
    cut = WN['meta']['income_cut']
    checked = 0
    for gid, rec in list(WN['counties'].items()) + list(WN['places'].items()):
        if rec['present_incommuter_need'] is None:
            continue
        county = gid if gid in WN['counties'] else rec['containingCounty']
        x = XW['counties'][county]
        cv = x[cut + '_cov']
        for i, t in enumerate(TIERS):
            assert abs(cv[i][i] ** 0.5 - x['tiers'][t][cut][1]) < 0.0002, (county, t)
        n = rec['incommuters_by_tier']
        var = sum(n[i] * n[j] * cv[i][j] for i in range(3) for j in range(3))
        assert rec['present_incommuter_need_moe90'] == round(0.25 * 1.645 * max(0.0, var) ** 0.5), gid
        checked += 1
    assert checked > 400, checked


def test_out_of_state_commuters_are_counted():
    """LODES main omits workers who live outside Colorado. The aux file must be
    read, cover all 64 counties, and reach the border counties' figures."""
    assert len(AUX['counties']) == 64, '%d counties in the aux summary' % len(AUX['counties'])
    assert 'JT01' in AUX['source'] and 'JT01' in AUX['wac_source'], 'the inputs are not the primary-job (JT01) files'
    assert len(AUX['wac_primary_counties']) == 64, 'primary-job WAC does not cover all 64 counties'
    assert sum(v['jobs'] for v in AUX['counties'].values()) > 0, 'the aux summary is empty'
    la_plata = WN['counties']['08067']
    assert la_plata['incommuters_out_of_state'] > 0, 'La Plata (New Mexico border) shows no out-of-state commuters'


def test_households_not_jobs():
    """Households, not jobs: every scenario is below the in-commuting
    workers it converts."""
    for rec in list(WN['counties'].values()) + list(WN['places'].values()):
        n = rec['present_incommuter_need']
        if n is None:
            continue
        assert n['move_closer_50'] <= 0.5 * sum(rec['incommuters_by_tier'])


def test_absent_is_null_with_reason_never_zero():
    for gid, rec in list(WN['counties'].items()) + list(WN['places'].items()):
        if rec['present_incommuter_need'] is None:
            assert rec.get('unavailableReason'), gid
            assert rec['incommuter_households_le60'] is None, gid


def test_state_counts_only_out_of_state_commuters():
    state = WN['state']
    assert state['counties'] == 64
    total = sum(r['present_incommuter_need']['move_closer_25'] for r in WN['counties'].values())
    assert 0 < state['present_incommuter_need']['move_closer_25'] < total


def test_scenarios_are_stated():
    assert WN['meta']['move_closer_scenarios'] == [0.25, 0.5]
    assert 'deficit today' in WN['meta']['method']
    assert WN['meta']['income_cut'] == 'le120'


def test_wac_inputs_match_the_county_files():
    for fips, w in AUX['wac_primary_counties'].items():
        assert w['all_jobs'] == load('data/hna/lehd/%s.json' % fips)['C000'], fips + ': WAC JT00 total differs from the county LEHD file'


def test_place_flows_share_the_lodes_year_of_the_other_inputs():
    # Place flows from another LODES year would mix vintages; the builder
    # leaves places unavailable then, so the committed file must agree.
    od_year = load('data/hna/place-od-flows.json')['meta']['year']
    assert od_year == AUX['year'], f'place flows LODES {od_year}, aux/WAC {AUX["year"]}'
    assert any(p.get('present_incommuter_need') for p in WN['places'].values()), 'no place has a figure'
