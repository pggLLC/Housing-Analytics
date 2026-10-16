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


def test_affordable_activity_carries_the_ledger_qualifications():
    ledger = read('data/market/development-activity.json')
    partial = multi = 0
    for f, c in DOC['counties'].items():
        s, a = ledger['county_summary'][f], c['affordable_activity']
        assert a['projects_without_homes'] == s['projects_without_homes'], f
        assert a['multi_county_projects'] == s['multi_county_projects'], f
        partial += bool(a['projects_without_homes'])
        multi += bool(a['multi_county_projects'])
    assert partial and multi  # the scan reached both qualifications


def test_generated_at_is_the_newest_input_stamp_under_any_key_name():
    stamps = [md.stamp(read(p)['meta']) for p in (
        'data/hna/permits.json', 'data/market/fhfa_hpi_subcounty_co.json', 'data/market/zori_rents_co.json',
        'data/market/fmr_co.json', 'data/market/development-activity.json', 'data/chfa-income-rent-limits-2026.json')]
    per_county = [md.stamp(read(f'data/hna/lehd/{f}.json')) for f in DOC['counties']
                  if os.path.exists(os.path.join(ROOT, 'data', 'hna', 'lehd', f'{f}.json'))]
    stamps.append(md.stamp(read('data/hna/geo-config.json')))  # the county list and names
    stamps.append(md.read_profiles(md.DOLA_PROFILES)[1])  # DOLA's "Prepared <month> <year>" line
    assert all(stamps) and len(per_county) > 50 and all(per_county), stamps  # every input's own stamp was found
    assert DOC['meta']['generated_at'] == max(stamps + per_county)
    # a later LEHD or projection refresh moves the stamp
    assert md.stamp({'updated': '2027-01-01T00:00:00Z'}) == '2027-01-01T00:00:00Z'
    assert md.stamp({'generated_at_utc': '2026-10-11T04:30:29Z'}) == '2026-10-11T04:30:29Z'


def test_a_later_lehd_refresh_moves_generated_at(tmp_path, monkeypatch):
    import shutil
    lehd = tmp_path / 'lehd'
    shutil.copytree(md.LEHD_DIR, lehd)
    f = lehd / '08001.json'
    d = json.loads(f.read_text())
    d['updated'] = '2030-01-01T00:00:00Z'
    f.write_text(json.dumps(d))
    monkeypatch.setattr(md, 'LEHD_DIR', str(lehd))
    assert md.build()['meta']['generated_at'] == '2030-01-01T00:00:00Z'


def test_the_rent_edge_description_names_the_measure_computed():
    # edge_pct is the 60% rent's discount below the FMR as a share of the FMR;
    # the descriptions must say so, not call it the FMR's premium over the 60% rent
    note = DOC['meta']['rent_edge_note']
    assert '(FMR - 60% rent) / FMR' in note
    for text in DOC['meta']['rent_edge'].values():
        assert 'above the 60% AMI rent by' not in text, text
    grand = DOC['counties']['08049']['rent_edge']
    assert grand['edge_pct'] == round((grand['fmr_2br'] - grand['lihtc_60_2br']) / grand['fmr_2br'] * 100, 1)


def test_population_is_household_population_so_prison_moves_do_not_read_as_demand():
    # Crowley and Bent lost prison (group quarters) population while their
    # households grew; total population called them falling demand (#2261 QA)
    prof, prepared = md.read_profiles(md.DOLA_PROFILES)
    assert prepared and len(prepared) == 7
    checked = 0
    for f, c in DOC['counties'].items():
        s = c['signals']['population']
        a, b = prof[(f, s['from_year'])], prof[(f, s['to_year'])]
        want = round((float(b['householdpopulation']) / float(a['householdpopulation'])) ** 0.1 * 100 - 100, 2)
        assert abs(s['value'] - want) <= 0.01, (f, s['value'], want)
        assert s['to_year'] == max(y for g, y in prof if g == f)
        checked += 1
    assert checked == 64
    for f in ('08025', '08011'):  # Crowley, Bent
        s = DOC['counties'][f]['signals']['population']
        assert s['total_population_value'] < 0 < s['value'] and s['group_quarters_to'] < s['group_quarters_from']
        assert DOC['counties'][f]['call'] != 'falling_demand'
    # recent households and net migration sit beside the call and agree with DOLA
    r = DOC['counties']['08031']['recent_demand']
    y = r['to_year']
    assert r['net_migration'] == int(sum(float(prof[('08031', k)]['netmigration']) for k in range(y - 4, y + 1)))


def test_a_missing_recent_demand_figure_is_null_with_its_reason():
    prof, _ = md.read_profiles(md.DOLA_PROFILES)
    gap = dict(prof)
    gap[('08031', 2022)] = dict(gap[('08031', 2022)], netmigration='')
    gap[('08031', 2019)] = dict(gap[('08031', 2019)], households='')
    r = md.recent_demand('08031', gap)
    assert r['net_migration'] is None and 'net migration missing' in r['net_migration_unavailable_reason']
    assert r['households_value'] is None and 'households missing' in r['households_unavailable_reason']
    full = md.recent_demand('08031', prof)
    assert full['net_migration'] is not None and 'net_migration_unavailable_reason' not in full
    for c in DOC['counties'].values():  # the committed file: every null carries its reason
        r = c['recent_demand']
        assert r['net_migration'] is not None or r.get('net_migration_unavailable_reason')
        assert r['households_value'] is not None or r.get('households_unavailable_reason')
