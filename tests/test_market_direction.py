"""data/market/market-direction.json: county market direction and rent edge.

Each check pins an agreement, not copy: the committed file must be what the
builder makes, every call must be what the rule gives for the signals printed
beside it, every number must equal the source file it was read from, and an
absent signal is null with a reason, never zero.
"""
import importlib.util
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'scripts', 'market', 'build_market_direction.py')

_spec = importlib.util.spec_from_file_location('build_market_direction', SCRIPT)
md = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(md)


def read(rel):
    with open(os.path.join(ROOT, rel)) as fh:
        return json.load(fh)


DOC = read('data/market/market-direction.json')


def test_file_is_fresh():
    r = subprocess.run([sys.executable, SCRIPT, '--check'], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_all_64_counties_with_five_digit_fips():
    geo = read('data/hna/geo-config.json')
    assert sorted(DOC['counties']) == sorted(c['geoid'] for c in geo['counties'])
    assert len(DOC['counties']) == 64
    assert all(len(f) == 5 and f.startswith('08') for f in DOC['counties'])


def test_each_call_is_what_the_rule_gives_for_its_printed_signals():
    seen = set()
    for f, c in DOC['counties'].items():
        assert c['call'] in md.CALLS, f
        assert md.call_of(c['signals'])[0] == c['call'], f
        seen.add(c['call'])
    assert len(seen) >= 3  # the scan reached a spread of calls, not one default
    tally = {}
    for c in DOC['counties'].values():
        tally[c['call']] = tally.get(c['call'], 0) + 1
    assert DOC['meta']['call_counts'] == dict(sorted(tally.items()))


def test_an_absent_signal_is_null_with_a_reason_never_zero():
    nulls = 0
    for f, c in DOC['counties'].items():
        for name, s in c['signals'].items():
            if s['value'] is None:
                nulls += 1
                assert s.get('unavailable_reason'), (f, name)
                assert s['reading'] is None, (f, name)
            else:
                assert s['reading'] == md.reading(name, s['value']), (f, name)
    assert nulls > 0  # small counties exist; the absence path was exercised


def test_permit_change_agrees_with_permits_json_and_honours_the_floor():
    permits = read('data/hna/permits.json')
    checked = 0
    for f, c in DOC['counties'].items():
        s = c['signals']['permits']
        units = permits['counties'][f]['units_total']
        a, b = sum(units[-10:-5]), sum(units[-5:])
        assert (s['units_a'], s['units_b']) == (a, b), f
        if a < md.PERMIT_FLOOR or b < md.PERMIT_FLOOR:
            assert s['value'] is None, f
        else:
            assert s['value'] == round((b - a) / a * 100, 1), f
            checked += 1
    assert checked > 30


def test_price_and_rent_agree_with_their_sources():
    fhfa = read('data/market/fhfa_hpi_subcounty_co.json')['counties']
    zori = read('data/market/zori_rents_co.json')['counties']
    for f, c in DOC['counties'].items():
        p = c['signals']['price']
        rec = fhfa.get(f)
        if p['value'] is not None:
            by = rec['hpi_by_year']
            assert p['value'] == round((by[str(p['to_year'])] / by[str(md.PRICE_BASE_YEAR)] - 1) * 100, 1), f
        r = c['signals']['rent']
        assert r['value'] == (zori.get(f) or {}).get('yoy_change_pct'), f


def test_rent_edge_agrees_with_hud_fmr_and_chfa_rent_table():
    fmr = {c['fips_code'][:5]: c['Two-Bedroom'] for c in read('data/market/fmr_co.json')['data']['data']['counties']}
    lim = {c['fips']: c['regular_tiers']['60']['max_rents']['2br']
           for c in read('data/chfa-income-rent-limits-2026.json')['counties']}
    readings = set()
    for f, c in DOC['counties'].items():
        e = c['rent_edge']
        assert e['fmr_2br'] == fmr[f], f
        assert e['lihtc_60_2br'] == lim[f], f
        edge = round((e['fmr_2br'] - e['lihtc_60_2br']) / e['fmr_2br'] * 100, 1)
        assert e['edge_pct'] == edge, f
        want = 'no_edge' if edge <= 0 else 'thin' if edge < md.RENT_EDGE_THIN else 'clear'
        assert e['reading'] == want, f
        readings.add(want)
    assert readings == {'no_edge', 'thin', 'clear'}


def test_affordable_activity_agrees_with_the_development_ledger():
    ledger = read('data/market/development-activity.json')
    for f, c in DOC['counties'].items():
        s = ledger['county_summary'][f]
        a = c['affordable_activity']
        assert (a['projects'], a['homes']) == (s['projects'], s['homes']), f
        assert a['since'] == ledger['meta']['summary_since']


def sig(permits=None, price=None, rent=None, population=None, jobs=None):
    return {k: {'value': v} for k, v in
            dict(permits=permits, price=price, rent=rent, population=population, jobs=jobs).items()}


def test_rule_order():
    assert md.call_of(sig(permits=40, price=20, rent=5, population=1.0, jobs=8))[0] == 'emerging'
    # one falling market signal blocks emerging
    assert md.call_of(sig(permits=40, price=20, rent=-1, population=1.0, jobs=8))[0] == 'steady'
    assert md.call_of(sig(permits=-30, price=2, rent=1, population=1.0, jobs=8))[0] == 'softening'
    # shrinking people and jobs wins over rising prices
    assert md.call_of(sig(permits=40, price=20, population=-0.3, jobs=-4))[0] == 'falling_demand'
    assert md.call_of(sig(price=20))[0] == 'not_enough_data'
    # growth without two rising market signals is steady, not emerging
    assert md.call_of(sig(permits=0, price=20, rent=1, population=2.0, jobs=10))[0] == 'steady'
