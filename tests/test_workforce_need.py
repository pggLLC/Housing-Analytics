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
        base = lehd['inflow'] * (lehd["CE01"] + lehd["CE02"]) / lehd['C000'] / wph
        assert rec['present_incommuter_need']['move_closer_25'] == round(base * 0.25), fips
        assert rec['present_incommuter_need']['move_closer_50'] == round(base * 0.50), fips
        checked += 1
    assert checked >= 60, 'only %d counties had a figure to check' % checked


def test_households_not_jobs():
    """Dividing by workers per household must make the line smaller than the
    in-commuting workers it starts from, at every scenario."""
    for rec in list(WN['counties'].values()) + list(WN['places'].values()):
        n = rec['present_incommuter_need']
        if n is None:
            continue
        assert rec['workers_per_working_household'] >= 1
        assert n['move_closer_50'] <= rec['incommuters'] * rec['low_middle_wage_share']


def test_absent_is_null_with_reason_never_zero():
    for gid, rec in list(WN['counties'].items()) + list(WN['places'].items()):
        if rec['present_incommuter_need'] is None:
            assert rec.get('unavailableReason'), gid
        if rec['workers_per_working_household'] is None:
            assert rec['present_incommuter_need'] is None, gid


def test_scenarios_are_stated():
    assert WN['meta']['move_closer_scenarios'] == [0.25, 0.5]
    assert 'deficit today' in WN['meta']['method']
