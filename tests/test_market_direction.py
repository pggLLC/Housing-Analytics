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
    absent = md.recent_demand('08031', {k: v for k, v in prof.items() if k[0] != '08031'})
    assert absent['households_value'] is None and absent['households_unavailable_reason']
    assert absent['net_migration'] is None and absent['net_migration_unavailable_reason']
    assert set(absent) == set(md.recent_demand('08031', prof)) | {'households_unavailable_reason',
                                                                 'net_migration_unavailable_reason'}
    full = md.recent_demand('08031', prof)
    assert full['net_migration'] is not None and 'net_migration_unavailable_reason' not in full
    for c in DOC['counties'].values():  # the committed file: every null carries its reason
        r = c['recent_demand']
        assert r['net_migration'] is not None or r.get('net_migration_unavailable_reason')
        assert r['households_value'] is not None or r.get('households_unavailable_reason')


def test_a_zero_lehd_endpoint_is_a_missing_figure_with_its_reason(tmp_path, monkeypatch):
    # a suppressed 0 must not leave a null jobs reading without a reason (#2261 review)
    import shutil
    lehd = tmp_path / 'lehd'
    shutil.copytree(md.LEHD_DIR, lehd)
    f = lehd / '08001.json'
    d = json.loads(f.read_text())
    d['annualEmployment']['2019'] = 0
    f.write_text(json.dumps(d))
    monkeypatch.setattr(md, 'LEHD_DIR', str(lehd))
    sig = md.jobs_signal('08001')
    assert sig['value'] is None and 'zero' in sig['unavailable_reason']
    assert md.jobs_signal('08005')['value'] is not None


# ---- places (towns and CDPs) ----

PLACES = DOC['places']
TOWNS = read('data/market/dola_muni_household_population.json')


def test_every_geo_config_place_has_a_row():
    geo = read('data/hna/geo-config.json')
    want = {p['geoid'] for p in geo['places'] + geo['cdps']}
    assert set(PLACES) == want
    assert all(len(g) == 7 and g.startswith('08') for g in PLACES)


def test_each_place_call_is_what_the_place_rule_gives_for_its_printed_signals():
    checked = 0
    for g, r in PLACES.items():
        assert (r['call'], r['call_basis']) == md.place_call(r['signals'], SEASONAL.get(g)), g
        for k, s in r['signals'].items():
            assert s['reading'] == md.place_reading(k, s['value']), (g, k)
        checked += 1
    assert checked > 400
    assert {r['call'] for r in PLACES.values()} >= {'steady', 'falling_demand', 'not_enough_data',
                                                    'second_home_shift'}


SEASONAL = {g: r.get('seasonal_homes') for g, r in read('data/hna/second-homes-str.json')['geographies'].items()}


def test_a_places_seasonal_share_is_the_second_homes_files():
    shown = 0
    for g, r in PLACES.items():
        src = SEASONAL.get(g)
        if src:
            assert r['seasonal_homes'] == {'share_of_housing_units': src['share_of_housing_units'],
                                           'reliability': src['reliability']}, g
            shown += 1
        else:
            assert r['seasonal_homes']['share_of_housing_units'] is None
            assert r['seasonal_homes']['unavailable_reason'], g
    assert shown > 400


def test_falling_demand_in_a_town_needs_a_market_signal_to_agree():
    shrinking = {'value': -0.8}
    sig = {'permits': {'value': None}, 'price': {'value': 1.0}, 'rent': {'value': None}, 'population': shrinking}
    assert md.place_call(sig)[0] == 'falling_demand'           # price down agrees
    sig['price']['value'] = 6.0
    assert md.place_call(sig)[0] == 'steady'                   # price up contradicts it
    sig['price']['value'] = None
    call, why = md.place_call(sig)
    assert call == 'not_enough_data' and 'confirms' in why     # households alone
    sig['price']['value'] = 1.0
    resort = {'share_of_housing_units': 0.51, 'reliability': 'reliable'}
    assert md.place_call(sig, resort)[0] == 'second_home_shift'
    assert md.place_call(sig, dict(resort, reliability='unreliable'))[0] == 'falling_demand'
    assert md.place_call(sig, dict(resort, share_of_housing_units=0.19))[0] == 'falling_demand'


def test_a_second_home_shift_call_agrees_with_its_seasonal_share():
    calls = [(g, r) for g, r in PLACES.items() if r['call'] == 'second_home_shift']
    assert calls
    for g, r in calls:
        s = r['seasonal_homes']
        assert s['share_of_housing_units'] >= DOC['meta']['places']['second_home_share'], g
        assert s['reliability'] != 'unreliable' and r['signals']['population']['reading'] == 'down', g


def test_a_towns_population_signal_agrees_with_the_dola_file():
    n = 0
    for g, r in PLACES.items():
        s = r['signals']['population']
        if r['type'] == 'cdp':
            assert s['value'] is None and 'CDP' in s['unavailable_reason']
            continue
        series = TOWNS['towns'][g]['household_population']
        a, b = series.get(str(s['from_year'])), series.get(str(s['to_year']))
        assert (s['households_from'], s['households_to']) == (a, b), g
        if s['value'] is None:
            assert s['unavailable_reason'] and not (a and b), g
        else:
            assert abs(s['value'] - ((b / a) ** 0.1 - 1) * 100) < 0.006, g
            n += 1
    assert n > 250


def test_place_permits_price_and_rent_agree_with_their_sources():
    permits = read('data/hna/permits.json')
    fhfa = read('data/market/fhfa_hpi_subcounty_co.json')['places']
    priced = permitted = 0
    for g, r in PLACES.items():
        s = r['signals']['price']
        if g in fhfa and isinstance(fhfa[g].get('annual_change_latest'), (int, float)):
            assert s['value'] == round(fhfa[g]['annual_change_latest'] * 100, 1), g
            priced += 1
        else:
            assert s['value'] is None and s['unavailable_reason'], g
        p = r['signals']['permits']
        if p['value'] is not None:
            u = permits['places'][g]['units_total']
            assert (p['units_a'], p['units_b']) == (sum(u[-10:-5]), sum(u[-5:])), g
            permitted += 1
        else:
            assert p['unavailable_reason'], g
    assert priced > 200 and permitted > 80
    denver = PLACES['0820000']['signals']['rent']
    assert denver['value'] == read('data/market/zori_rents_co.json')['cities']['denver']['yoy_change_pct']


def test_a_zillow_city_joins_one_place_and_a_shared_name_joins_none():
    places = [{'geoid': '0800001', 'label': 'Cañon City (city)'}, {'geoid': '0800002', 'label': 'Twin (town)'},
              {'geoid': '0800003', 'label': 'Twin (town)'}, {'geoid': '0800004', 'label': 'Lone (CDP)', 'type': 'cdp'},
              {'geoid': '0800005', 'label': 'Lone (town)'}]
    joined, unmatched = md.zori_places({'canon city': {'name': 'Canon City'}, 'twin': {'name': 'Twin'},
                                        'lone': {'name': 'Lone'}}, places)
    assert set(joined) == {'0800001', '0800005'} and unmatched == ['Twin']


def test_a_place_null_is_never_zero_and_always_says_why():
    for g, r in PLACES.items():
        for k, s in r['signals'].items():
            if s['value'] is None:
                assert s.get('unavailable_reason'), (g, k)


def test_a_town_shrinking_less_than_the_floor_is_not_falling_demand():
    sig = {'permits': {'value': None}, 'price': {'value': 2.0}, 'rent': {'value': None},
           'population': {'value': -0.04}}
    assert md.place_call(sig)[0] == 'steady'
    sig['population']['value'] = -0.3
    assert md.place_call(sig)[0] == 'falling_demand'
    sig['population']['value'] = None
    assert md.place_call(sig)[0] == 'not_enough_data'


def test_place_activity_agrees_with_the_ledger():
    ledger = read('data/market/development-activity.json')
    since = ledger['meta']['summary_since']
    want: dict = {}
    for p in ledger['projects']:
        if p.get('place_geoid') and (p.get('latest_year') or 0) >= since:
            want[p['place_geoid']] = want.get(p['place_geoid'], 0) + 1
    got = {g: r['affordable_activity']['projects'] for g, r in PLACES.items() if r['affordable_activity']}
    assert got == want and sum(want.values()) > 100


def test_dola_town_rows_take_the_total_row_and_a_zero_is_null():
    spec = importlib.util.spec_from_file_location(
        'fetch_dola', os.path.join(ROOT, 'scripts', 'market', 'fetch_dola_muni_households.py'))
    f = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(f)
    rows = [{'placefips': 4000, 'countyfips': 1, 'year': 2024, 'householdpopulation': '54730'},
            {'placefips': 4000, 'countyfips': 5, 'year': 2024, 'householdpopulation': '338968'},
            {'placefips': 4000, 'countyfips': 999, 'year': 2024, 'householdpopulation': '397985'},
            {'placefips': 12030, 'countyfips': 45, 'year': 2024, 'householdpopulation': '0'},
            {'placefips': 20000, 'countyfips': 31, 'year': 2024, 'householdpopulation': '712470'}]
    out = f.towns_from_rows(rows, {}, [2024])
    assert out['0804000']['household_population'] == {'2024': 397985}
    assert out['0812030']['household_population'] == {'2024': None} and out['0812030']['unavailable_reason']
    assert out['0820000']['household_population'] == {'2024': 712470}
