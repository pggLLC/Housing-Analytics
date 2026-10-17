"""data/hna/workforce-need.json agrees with its inputs and with its own method.

Held as agreement: each county's present in-commuter need is recomputed here
from the LODES county file and the cached ACS B08202 table, and must equal what
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
ACS = load('data/hna/source/acs_b08202.json')['geos']
AUX = load('data/hna/source/lodes_primary_jobs.json')


def test_all_64_counties_present():
    counties = WN['counties']
    assert len(counties) == 64
    assert all(len(k) == 5 and k.startswith('08') for k in counties)


def test_county_figures_recompute_from_inputs():
    checked = 0
    for fips, rec in WN['counties'].items():
        lehd = load('data/hna/lehd/%s.json' % fips)
        cell = ACS.get(fips)
        if rec['present_incommuter_need'] is None:
            assert rec.get('unavailableReason'), fips + ' is absent without a reason'
            continue
        e = cell['estimate']
        hh = e['B08202003'] + e['B08202004'] + e['B08202005']
        wph = (e['B08202003'] + 2 * e['B08202004'] + 3 * e['B08202005']) / hh
        # Out-of-state in-commuters are only in LODES aux; their own wage
        # bands are added, not the county share.
        aux = AUX['counties'].get(fips, {})
        assert rec['incommuters_out_of_state'] == aux.get('jobs', 0), fips
        # Both terms count people, not jobs: primary jobs (JT01) only. The
        # in-state inflow is JT00, so it is scaled by primary low/middle-wage
        # jobs per job of any kind located in the county.
        primary_lm = AUX['wac_primary_counties'][fips]['primary_low_middle_wage_jobs']
        assert primary_lm < lehd['CE01'] + lehd['CE02'], fips + ': primary jobs should be fewer than all jobs'
        base = (lehd['inflow'] * primary_lm / lehd['C000']
                + aux.get('low_middle_wage_jobs', 0)) / wph
        assert rec['present_incommuter_need']['move_closer_25'] == round(base * 0.25), fips
        assert rec['present_incommuter_need']['move_closer_50'] == round(base * 0.50), fips
        checked += 1
    assert checked >= 60, 'only %d counties had a figure to check' % checked


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
    """Dividing by workers per household must make the line smaller than the
    in-commuting workers it starts from, at every scenario."""
    for rec in list(WN['counties'].values()) + list(WN['places'].values()):
        n = rec['present_incommuter_need']
        if n is None:
            continue
        assert rec['workers_per_working_household'] >= 1
        assert n['move_closer_50'] <= (rec['incommuters'] * rec['low_middle_wage_share']
                                       + rec['out_of_state_low_middle_wage'])


def test_absent_is_null_with_reason_never_zero():
    for gid, rec in list(WN['counties'].items()) + list(WN['places'].items()):
        if rec['present_incommuter_need'] is None:
            assert rec.get('unavailableReason'), gid
        if rec['workers_per_working_household'] is None:
            assert rec['present_incommuter_need'] is None, gid


def test_scenarios_are_stated():
    assert WN['meta']['move_closer_scenarios'] == [0.25, 0.5]
    assert 'deficit today' in WN['meta']['method']


def test_place_wage_share_is_the_places_own_jobs():
    """A place spanning counties (Aurora: Adams, Arapahoe, Douglas) takes the
    wage mix of the jobs inside its own boundary, from the block crosswalk,
    not its configured county's. The county fallback is only for places
    the crosswalk does not cover."""
    places = AUX['wac_primary_places']
    checked = 0
    for gid, rec in WN['places'].items():
        w = places.get(gid)
        if rec['present_incommuter_need'] is None:
            continue
        if w and w['all_jobs']:
            assert rec['wage_share_basis'] == 'place', gid
            assert rec['low_middle_wage_share'] == round(w['primary_low_middle_wage_jobs'] / w['all_jobs'], 4), gid
            checked += 1
        else:
            assert rec['wage_share_basis'] == 'county', gid
    assert checked >= 400, 'only %d places had their own wage mix to check' % checked
    assert WN['places']['0804000']['wage_share_basis'] == 'place', 'Aurora is not using its own jobs'
    for fips, w in AUX['wac_primary_counties'].items():
        assert w['all_jobs'] == load('data/hna/lehd/%s.json' % fips)['C000'], fips + ': WAC JT00 total differs from the county LEHD file'


def test_place_flows_share_the_lodes_year_of_the_other_inputs():
    # Place flows from another LODES year would mix vintages; the builder
    # leaves places unavailable then, so the committed file must agree.
    od_year = load('data/hna/place-od-flows.json')['meta']['year']
    assert od_year == AUX['year'], f'place flows LODES {od_year}, aux/WAC {AUX["year"]}'
    assert any(p.get('present_incommuter_need') for p in WN['places'].values()), 'no place has a figure'
