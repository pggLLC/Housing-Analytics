"""data/market/bps_monthly_ytd.json: this year's building permits to date.

Each check pins an agreement, not copy: the state total is the sum of the
counties, each change is what the two printed totals give, a town Census only
estimates is null with a reason, never zero, and market-direction.json shows
exactly what this file holds.
"""
import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'scripts', 'market', 'fetch_bps_monthly.py')

_spec = importlib.util.spec_from_file_location('fetch_bps_monthly', SCRIPT)
fb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fb)


def read(rel):
    with open(os.path.join(ROOT, rel)) as fh:
        return json.load(fh)


DOC = read('data/market/bps_monthly_ytd.json')
MD = read('data/market/market-direction.json')


def block(u1, u2, u34, u5, rep=None):
    """The 24 trailing columns: (bldgs, units, value) for 1, 2, 3-4, 5+,
    then the same reported only."""
    rep = rep if rep is not None else (u1, u2, u34, u5)
    return [x for u in (u1, u2, u34, u5) + tuple(rep) for x in ('1', str(u), '100')]


def place_row(fips, months, name, units, county='001'):
    lead = ['202608', '08', '000000', county, '0', fips, '0', '0', '0', '0', '0', '0', '0', '4', '8', str(months)]
    return lead + name.split(',') + block(*units)


def lines(rows):
    return ['h1', 'h2'] + [','.join(r) for r in rows]


def test_a_town_in_two_counties_is_summed_and_a_county_balance_is_skipped():
    out = fb.places_from(lines([
        place_row('04000', 8, 'Aurora', (10, 0, 0, 40)),
        place_row('04000', 7, 'Aurora', (5, 2, 0, 0), county='005'),
        place_row('99990', 8, 'Adams County Unincorporated Area', (99, 0, 0, 0)),
        place_row('12345', 8, 'Comma, Town', (3, 0, 0, 0)),
    ]))
    assert set(out) == {'0804000', '0812345'}
    assert out['0804000']['units'] == {'total': 57, 'single_family': 15, 'multifamily': 42, 'reported': 57}
    assert out['0804000']['months_reported'] == 7
    assert out['0812345']['name'] == 'Comma, Town'


def test_reported_units_are_the_reported_only_columns():
    row = place_row('04000', 8, 'Aurora', (10, 0, 0, 40))
    row[-24:] = block(10, 0, 0, 40, rep=(6, 0, 0, 40))
    assert fb.units(row) == {'total': 50, 'single_family': 10, 'multifamily': 40, 'reported': 46}


def test_a_town_census_only_estimates_is_null_with_a_reason_never_zero():
    u = {'total': 80, 'single_family': 80, 'multifamily': 0, 'reported': 80}
    now = {'a': {'name': 'A', 'months_reported': 8, 'units': u}, 'b': {'name': 'B', 'months_reported': 0, 'units': u},
           'c': {'name': 'C', 'months_reported': 8, 'units': u}, 'd': {'name': 'D', 'months_reported': 8, 'units': u}}
    before = {'a': {'name': 'A', 'months_reported': 8, 'units': u}, 'b': {'name': 'B', 'months_reported': 8, 'units': u},
              'c': {'name': 'C', 'months_reported': 7, 'units': u}, 'd': {'name': 'D', 'months_reported': 6, 'units': u}}
    out = fb.combine(now, before, 8, True)
    assert out['a']['change_pct'] == 0.0
    assert out['c']['change_pct'] == 0.0  # one month filed late last year
    for k in ('b', 'd'):
        assert out[k]['ytd'] is None and out[k]['change_pct'] is None and out[k]['unavailable_reason'], k


def test_a_change_needs_the_floor_in_each_period():
    big, small = {'total': 60}, {'total': 49}
    assert fb.change(big, big)[0] == 0.0
    pct, why = fb.change(big, small)
    assert pct is None and str(fb.FLOOR) in why
    assert fb.change(None, big)[0] is None


def test_every_county_is_there_and_the_state_is_their_sum():
    c = DOC['counties']
    assert len(c) == 64 and all(len(g) == 5 and g.startswith('08') for g in c)
    st = DOC['meta']['state']
    assert st['ytd'] == sum(r['ytd']['total'] for r in c.values())
    assert st['prior_ytd'] == sum(r['prior_ytd']['total'] for r in c.values())
    assert st['ytd'] > 1000


def test_each_change_is_what_its_printed_totals_give():
    checked = 0
    for g, r in list(DOC['counties'].items()) + list(DOC['places'].items()):
        if r['ytd'] is None:
            assert r['change_pct'] is None and r['unavailable_reason'], g
            continue
        a, b = r['ytd'], r['prior_ytd']
        assert a['total'] == a['single_family'] + a['multifamily'] and a['reported'] <= a['total'], g
        if min(a['total'], b['total']) >= DOC['meta']['change_floor']:
            assert r['change_pct'] == round((a['total'] / b['total'] - 1) * 100, 1), g
            checked += 1
        else:
            assert r['change_pct'] is None and r['unavailable_reason'], g
    assert checked > 30


def test_a_counted_town_reported_every_month_this_year():
    m = DOC['meta']['months']
    counted = [r for r in DOC['places'].values() if r['ytd'] is not None]
    assert len(counted) > 40
    for r in counted:
        assert r['months_reported']['this_year'] >= m
        assert r['months_reported']['last_year'] >= m - fb.LATE_MONTHS


def test_market_direction_shows_what_this_file_holds():
    shown = 0
    for kind in ('counties', 'places'):
        for g, r in MD[kind].items():
            src = DOC[kind].get(g)
            got = r['permits_ytd']
            if src is None:
                assert got['ytd'] is None and got['unavailable_reason'], g
                continue
            assert {k: got[k] for k in ('ytd', 'prior_ytd', 'change_pct')} == \
                {k: src[k] for k in ('ytd', 'prior_ytd', 'change_pct')}, g
            assert got.get('unavailable_reason') == src.get('unavailable_reason'), g
            shown += got['ytd'] is not None
    assert shown > 100
    assert MD['meta']['sources']['permits_ytd']['through'] == DOC['meta']['through']
