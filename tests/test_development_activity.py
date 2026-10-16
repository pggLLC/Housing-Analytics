"""data/market/development-activity.json: the development activity ledger.

Checks the committed file is what the builder makes from the committed inputs,
that it names no sponsor or owner, that the owner exclusion list empties a
project out of every source, and the join rules that keep different projects
apart.
"""
import importlib.util
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'scripts', 'market', 'build_development_activity.py')
OUT = os.path.join(ROOT, 'data', 'market', 'development-activity.json')

_spec = importlib.util.spec_from_file_location('build_development_activity', SCRIPT)
dev = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dev)


def read_json(rel):
    with open(os.path.join(ROOT, rel)) as fh:
        return json.load(fh)


def load():
    with open(OUT) as fh:
        return json.load(fh)


def test_file_is_fresh():
    r = subprocess.run([sys.executable, SCRIPT, '--check'], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_every_event_is_sourced_and_staged():
    d = load()
    events = [e for p in d['projects'] for e in p['events']]
    assert len(d['projects']) > 500 and len(events) > len(d['projects'])  # the scan found something
    for p in d['projects']:
        assert p['stage'] in dev.STAGES
        assert p['events'], p['name']
        assert p['county_fips'] is None or (len(p['county_fips']) == 5 and p['county_fips'].startswith('08'))
    for e in events:
        assert e['source_url'] and e['source_url'].startswith('http'), e
        assert e['quote'], e
        assert e['amount'] is None or e['amount'] > 0, e  # an unknown amount is null, never 0
        assert e['amount_label'] or e['amount'] is None, e


def test_county_summary_carries_all_64_counties():
    d = load()
    assert len(d['county_summary']) == 64
    since = d['meta']['summary_since']
    recent = [p for p in d['projects'] if (p['county_fips'] or p['county_fips_all']) and (p['latest_year'] or 0) >= since]
    assert d['meta']['statewide_recent_projects'] == len(recent) > 0
    # a scattered site in several counties counts once in each of them
    total = sum(c['projects'] for c in d['county_summary'].values())
    assert total == sum(len(p['county_fips_all'] or [1]) for p in recent)
    assert sum(c['multi_county_projects'] for c in d['county_summary'].values()) == sum(
        len(p['county_fips_all']) for p in recent if p['county_fips_all'])


def test_no_sponsor_or_owner_is_named():
    d = load()
    for p in d['projects']:
        assert 'sponsor' not in p
        for e in p['events']:
            assert 'sponsor' not in e
            for field in (e['quote'] or '').split('; '):
                assert not dev.SPONSOR_FIELD.match(field), field


def test_strip_sponsor_removes_each_heading_form():
    q = ('Borrower/Sponsor: Acme LLC; Project Name: X; Owner Name: Y; Sponsor: Z; '
         'Grantee: Town; Total Units: 40')
    assert dev.strip_sponsor(q) == 'Project Name: X; Total Units: 40'


def test_exclusion_list_removes_a_project_from_every_source(tmp_path, monkeypatch):
    d = load()
    target = next(p for p in d['projects'] if len({e['agency'] for e in p['events']}) >= 1 and len(p['events']) >= 2)
    excl = tmp_path / 'excluded.json'
    names = {target['name']}
    for e in target['events']:
        for field in e['quote'].split('; '):
            k, _, v = field.partition(': ')
            if k in ('Name', 'PROJECT', 'Project Name'):
                names.add(v)
    cities = {target['city'] or ''}
    excl.write_text(json.dumps({'excluded': [
        {'sha256': dev.apps_mod.exclusion_hash(n, c)} for n in names for c in cities]}))
    monkeypatch.setattr(dev, 'EXCLUDED', str(excl))
    out = dev.build()
    assert out['meta']['excluded_events'] >= 1
    assert not any(p['id'] == target['id'] for p in out['projects'])


def test_join_rules_keep_different_projects_apart():
    same = dev.same_project
    n = dev.core_name
    assert same(n('1001 Lincoln St'), n('1001 Lincoln Street'))
    assert same(n('Canopy at Red Oak fka: Red Oak Park Phase II'), n('Canopy at Red Oak Park'))
    assert same(n('Ives II 4'), n('The Ives II'))
    assert not same(n('Walden 35'), n('Walden 35 Phase II'))
    assert not same(n('Sheridan Station'), n('Sheridan Station East (Phase II)'))
    assert not same(n('Exodus at Green Valley Ranch'), n('Reserves at Green Valley Ranch'))


def test_furthest_stage_wins_and_a_reapplication_outranks_a_loss():
    L = dev.Ledger(set(), {}, {'08031': 'Denver County'})
    L.county_places, L.city_county, L.city_counties = {}, {'denver': '08031'}, {'denver': {'08031'}}
    q = dict(source_url='https://example.org/a.pdf', quote='Name: Test Place')
    L.add('Test Place', 'Denver', '08031', dev.ev('not_funded', 2024, 'CHFA', 'p', **q))
    L.add('Test Place', 'Denver', '08031', dev.ev('applied', 2025, 'CHFA', 'p', **q))
    assert dev.finish(L)[0]['stage'] == 'applied'
    L.add('Test Place', 'Denver', '08031', dev.ev('funded', 2025, 'DOLA', 'q', **q))
    assert dev.finish(L)[0]['stage'] == 'funded'


def test_ownership_and_partner_headings_are_stripped_too():
    q = 'Project Name: X; Ownership: Some Group; General Partner: Y LLC; Total Units: 40'
    assert dev.strip_sponsor(q) == 'Project Name: X; Total Units: 40'


def test_dola_quotes_do_not_carry_the_grantee():
    d = load()
    dola = read_json('data/policy/funding-awards/dola-awards.json')['awards']
    grantees = {a['grantee'] for a in dola if a.get('grantee') and len(a['grantee']) > 5}
    quotes = [e['quote'] for p in d['projects'] for e in p['events'] if e['agency'] == 'DOLA']
    assert len(quotes) > 100
    for p in d['projects']:
        for e in p['events']:
            if e['agency'] != 'DOLA':
                continue
            for g in grantees:
                if g in e['quote']:
                    assert g in p['name'] or g in (p['city'] or ''), (g, e['quote'])


def test_no_project_name_carries_an_award_report_sponsor():
    d = load()
    rows = read_json('data/policy/funding-awards/award-rows.json')['rows']
    sponsors = {r['sponsor'] for r in rows if r.get('sponsor') and len(r['sponsor']) > 8}
    assert len(sponsors) > 50
    # a sponsor the report itself prints inside the project's name ("Metro
    # Caring" for "Metro Caring Housing") is the project's name, not a leak
    sponsors -= {r['sponsor'] for r in rows if r.get('sponsor') and r['sponsor'] in (r.get('name') or '')}
    for p in d['projects']:
        for s in sponsors:
            assert s not in p['name'], (s, p['name'])


def _ledger():
    L = dev.Ledger(set(), {}, {'08031': 'Denver County', '08041': 'El Paso County'})
    L.county_places = {}
    L.city_county = {'denver': '08031', 'colorado springs': '08041'}
    L.city_counties = {'denver': {'08031'}, 'colorado springs': {'08041'}}
    return L


def test_same_name_in_two_towns_is_two_projects_even_with_a_wrong_county():
    L = _ledger()
    q = dict(source_url='https://example.org/a.pdf', quote='Name: Ridge')
    L.add('Ridge', 'Colorado Springs', '08041', dev.ev('funded', 2016, 'CHFA', 'p', **q), 60)
    L.add('Ridge', 'Denver', '08041', dev.ev('applied', 2026, 'CHFA', 'p', **q), 140,
          counties=['08031', '08041'])  # the application lists both counties
    rows = dev.finish(L)
    assert sorted((r['city'], r['county_fips'], r['stage']) for r in rows) == [
        ('Colorado Springs', '08041', 'funded'), ('Denver', '08031', 'applied')]


def test_a_name_inside_another_joins_only_when_units_agree():
    L = _ledger()
    q = dict(source_url='https://example.org/a.pdf', quote='Name: X')
    L.add('Park Avenue West Apartments', 'Denver', '08031', dev.ev('funded', 2019, 'CHFA', 'p', **q), 122)
    L.add('Park Avenue Apartments', 'Denver', '08031', dev.ev('funded', 2025, 'CHFA', 'p', **q), 60)
    L.add('Park Avenue Apartments', 'Denver', '08031', dev.ev('applied', 2024, 'CHFA', 'p', **q), 60)
    assert len(dev.finish(L)) == 2


def test_a_project_without_units_is_counted_never_as_zero_homes():
    L = _ledger()
    q = dict(source_url='https://example.org/a.pdf', quote='Name: X')
    L.add('Alpha', 'Denver', '08031', dev.ev('funded', 2025, 'DOLA', 'p', **q))
    rows = dev.finish(L)
    s = dev.county_summary(rows, {'08031': 'Denver County'}, 2022)['08031']
    assert s['projects'] == 1 and s['projects_without_homes'] == 1 and s['homes'] is None
    assert s['by_stage']['funded']['homes'] is None
    L.add('Beta', 'Denver', '08031', dev.ev('funded', 2025, 'DOLA', 'p', **q), 40)
    s = dev.county_summary(dev.finish(L), {'08031': 'Denver County'}, 2022)['08031']
    assert (s['projects'], s['homes'], s['projects_without_homes']) == (2, 40, 1)


def test_a_scattered_site_in_two_counties_counts_in_both():
    L = _ledger()
    L.county_names['08037'], L.county_names['08117'] = 'Eagle County', 'Summit County'
    q = dict(source_url='https://example.org/a.pdf', quote='Name: X')
    L.add('Holy Cross Village (scattered site)', 'Gypsum, Silverthorne', None,
          dev.ev('letter_of_intent', 2026, 'CHFA', 'p', **q), 122, counties=['08037', '08117'])
    rows = dev.finish(L)
    assert rows[0]['county_fips'] is None and rows[0]['county_fips_all'] == ['08037', '08117']
    s = dev.county_summary(rows, {'08037': 'Eagle County', '08117': 'Summit County'}, 2023)
    for f in ('08037', '08117'):
        assert (s[f]['projects'], s[f]['homes'], s[f]['multi_county_projects']) == (1, 122, 1)
        assert s[f]['by_stage']['letter_of_intent']['projects'] == 1


def test_the_committed_ledger_keeps_the_eagle_summit_scattered_site():
    apps = read_json('data/jurisdiction-briefs/_lihtc-applications.json')['applications']
    multi = [a for a in apps if not a.get('county_fips') and len(a.get('county_fips_all') or []) > 1
             and (a.get('year') or 0) >= dev.FIRST_YEAR and dev.APP_STAGE.get(a.get('outcome'))]
    assert multi  # the scan found a multi-county application to check
    d = load()
    for a in multi:
        p = next(p for p in d['projects'] if p['county_fips_all'] == sorted(a['county_fips_all']))
        assert dev.same_project(dev.core_name(p['name']), dev.core_name(a['name']))


def test_a_dola_site_award_without_a_home_count_is_kept_with_units_null():
    dola = read_json('data/policy/funding-awards/dola-awards.json')['awards']
    assert any(a['name'] == 'Capitol City Mobile Home Park' and a['homes'] is None for a in dola)
    d = load()
    p = next(p for p in d['projects'] if 'capitol city' in p['name'].lower())
    assert {e['program'] for e in p['events']} >= {'Division of Housing award'}
    # an award that prints no homes says so; it is never a zero
    for p in d['projects']:
        for e in p['events']:
            if e.get('homes_unavailable_reason'):
                assert e['agency'] == 'DOLA'
    L = _ledger()
    q = dict(source_url='https://example.org/a.pdf', quote='Name: X')
    L.add('Gamma Park', 'Denver', '08031', dev.ev('funded', 2024, 'DOLA', 'Division of Housing award', **q), None)
    L.add('City of Denver SFR', 'Denver', '08031', dev.ev('funded', 2024, 'DOLA', 'p', **q), None)
    rows = dev.finish(L)
    assert [(r['name'], r['total_units']) for r in rows] == [('Gamma Park', None)]
    assert L.programs_left_out == 1


def test_no_quote_carries_a_phone_number_or_email():
    d = load()
    quotes = [e['quote'] or '' for p in d['projects'] for e in p['events']]
    assert len(quotes) > 1000
    for q in quotes:
        assert not dev.CONTACT.search(q), q


def test_a_line_printed_row_is_cut_before_its_sponsor_and_contact():
    line = ('Line as printed: N,F 2814 2814 Patterson Road Grand Junction 81506 $1,349,865 60 60 '
            'Example Housing Authority Pat Doe 970-555-0100 pdoe@example.org')
    want = ('Line as printed: N,F 2814 2814 Patterson Road Grand Junction 81506 $1,349,865 60 60 '
            '[sponsor and contact not copied]')
    assert dev.strip_sponsor(line) == want  # no sponsor recorded: cut after the last number
    assert dev.strip_sponsor(line, 'Example Housing Authority') == want
    # a structured quote whose project name contains its sponsor is left whole
    q = 'Project Name: Metro Caring Housing; Total Units: 40'
    assert dev.strip_sponsor(q, 'Metro Caring') == q
    # a phone or e-mail in any other field is removed too
    assert dev.strip_sponsor('Name: X; Note: call 970-555-0100 or a@b.org') == \
        'Name: X; Note: call [contact not copied] or [contact not copied]'


def test_a_printed_unit_count_wins_over_a_misparsed_ledger_count():
    q = 'Type: A/R,S; Name: Valley Sun Village; City: Cortez; Total Units: 50; Total LI Units: 50'
    assert dev.printed_units(q, 3933, 'Total Units') == 50
    assert dev.printed_units('Type: N; Name: X; Total Units: 77; Total TC Units: 70', None,
                             r'(?:Total )?(?:LI|TC) Units') == 70
    # no units field: the parsed count stands only if the row prints it
    assert dev.printed_units('Line as printed: X Denver $1,000 60 60', 60, 'Total Units') == 60
    assert dev.printed_units('Line as printed: X Denver $1,000 60 60', 3933, 'Total Units') is None
    d = load()
    rows = read_json('data/policy/funding-awards/award-rows.json')['rows']
    printed = {}
    for r in rows:
        m = __import__('re').search(r'(?:^|; )Total Units: (\d+)(?:;|$)', r['quote'] or '')
        if m and r.get('name'):
            printed.setdefault(r['name'], set()).add(int(m.group(1)))
    checked = 0
    for p in d['projects']:
        if p['name'] in printed and p['total_units'] and len(printed[p['name']]) == 1:
            award_events = [e for e in p['events'] if 'Total Units:' in (e['quote'] or '')]
            if award_events and award_events[-1] is p['events'][-1]:
                assert p['total_units'] in printed[p['name']], (p['name'], p['total_units'])
                checked += 1
    assert checked > 50
    vs = next(p for p in d['projects'] if p['name'] == 'Valley Sun Village')
    assert vs['total_units'] == 50


def test_a_dola_program_award_is_left_out_by_its_printed_text():
    dola = read_json('data/policy/funding-awards/dola-awards.json')['awards']
    programs = [a for a in dola if a.get('homes') and dev.DOLA_PROGRAM_TEXT.search(
        ' '.join(str(a.get(k) or '') for k in ('quote', 'grantee', 'program_as_printed')))]
    assert 'City of Pueblo' in {a['name'] for a in programs}  # minor repairs across opted-in areas
    d = load()
    dola_names = {e['quote'].split(';')[0] for p in d['projects'] for e in p['events'] if e['agency'] == 'DOLA'}
    for a in programs:
        assert f"Project: {a['name']}" not in dola_names, a['name']
    # a mobile home park sold to its owner-occupants is a site, not a program
    assert any(p['name'] == 'Swiss Village' for p in d['projects'])


def test_dola_homes_never_replace_a_printed_unit_count():
    L = _ledger()
    q = dict(source_url='https://example.org/a.pdf', quote='Name: X')
    L.add("King's Crossing", 'Denver', '08031', dev.ev('funded', 2024, 'CHFA', 'p', **q), 179, 178)
    L.add("King's Crossing", 'Denver', '08031', dev.ev('funded', 2025, 'DOLA', 'p', **q), 178)
    r = dev.finish(L)[0]
    assert (r['total_units'], r['restricted_units']) == (179, 178)
    L = _ledger()
    L.add('Only Dola', 'Denver', '08031', dev.ev('funded', 2025, 'DOLA', 'p', **q), 40)
    assert dev.finish(L)[0]['total_units'] == 40  # DOLA's count stands when nothing else prints one


def test_a_later_geography_refresh_moves_generated_at(tmp_path, monkeypatch):
    geo = read_json('data/hna/geo-config.json')
    geo['updated'] = '2030-01-01T00:00:00Z'
    f = tmp_path / 'geo-config.json'
    f.write_text(json.dumps(geo))
    monkeypatch.setattr(dev, 'GEO_CONFIG', str(f))
    assert dev.build()['meta']['generated_at'] == '2030-01-01T00:00:00Z'


def test_a_town_in_several_counties_keeps_its_place_in_each():
    d = load()
    cross = read_json('data/hna/cross-county-places.json')['places']
    in_county = {(g, c['fips']) for g, pl in cross.items() for c in pl['all_counties']}
    places = dev.apps_mod.load_places()
    checked = 0
    for p in d['projects']:
        g = places.get(dev.awards.norm(p['city'] or ''))
        if g and g in cross and (g, p['county_fips']) in in_county and ',' not in (p['city'] or ''):
            assert p['place_geoid'] == g, (p['name'], p['city'], p['county_fips'])
            checked += 1
    assert checked > 20  # the scan reached the cross-county towns (Aurora, Westminster, ...)
    crossbar = next(p for p in d['projects'] if p['name'].startswith('Crossbar Commons'))
    assert (crossbar['county_fips'], crossbar['place_geoid']) == ('08001', '0804000')


def test_an_award_the_ledger_prints_is_not_added_again_from_the_round_file():
    d = load()
    assert d['meta']['round_one_2026_already_in_ledger'] > 0  # the round file overlaps the ledger today
    for p in d['projects']:
        keys = [(e['agency'], e['year'], e['stage'], e['source_url']) for e in p['events']
                if e['program'] in ('2026 Round One housing tax credits',)]
        others = {(e['agency'], e['year'], e['stage'], e['source_url']) for e in p['events']
                  if e['program'] != '2026 Round One housing tax credits'}
        assert not set(keys) & others, p['name']
    L = _ledger()
    q = dict(source_url='https://example.org/round.pdf', quote='Name: X')
    L.add('Ute Mountain Homes I', 'Denver', '08031', dev.ev('funded', 2026, 'CHFA', 'LIHTC 9% + state', amount=1196414, **q), 15)
    L.add('Ute Mountain Homes I', 'Denver', '08031',
          dev.ev('funded', 2026, 'CHFA', '2026 Round One housing tax credits', amount=946447, _supplement=True, **q), 15)
    r = dev.finish(L)[0]
    assert [e['amount'] for e in r['events']] == [1196414] and L.supplement_duplicates == 1


def test_a_dola_source_title_names_the_awards_month_not_another_tables():
    # a page printing one awards table per round must not be cited with the
    # heading of a table from another month (#2261 review)
    dola = {a['id']: a for a in read_json('data/policy/funding-awards/dola-awards.json')['awards']}
    checked = 0
    for p in load()['projects']:
        for e in p['events']:
            if e['agency'] != 'DOLA' or not e.get('announced'):
                continue
            m = dev.TABLE_TITLE.match(e.get('source_title') or '')
            ann = e['announced']
            if m and len(ann) == 7:
                assert f"{m['month']} {m['year']}" == f"{dev.MONTHS[int(ann[5:7]) - 1]} {ann[:4]}", (p['name'], e)
            if 'Application Schedule' in (e.get('source_title') or ''):
                assert ('Source: ' + e['source_title']) in e['quote'], p['name']
                checked += 1
    assert checked > 10  # the scan reached the per-round table awards
    june = dola['doh-2026-06-10-02']
    assert dev.source_title(june) == 'DOH Application Schedule and Awards page: awards announced June 2026'
    aug = dict(june, announced='2025-08')
    assert dev.source_title(aug) == june['source_title']
    assert dev.source_title(dict(june, source_title='Some press release')) == 'Some press release'


def test_a_printed_county_stands_against_a_postal_town_name():
    # "Denver" is also the postal name for homes in unincorporated Adams County
    # (Elmwood North, 8000 N Pecos Street); a county the source prints, with no
    # conflicting county in its own list, is kept (#2261 review)
    L = dev.Ledger(set(), {}, {'08031': 'Denver County', '08001': 'Adams County'})
    L.county_places = {}
    L.city_county = {'denver': '08031'}
    L.city_counties = {'denver': {'08031'}}
    q = dict(source_url='https://example.org/a.pdf', quote='Name: X')
    L.add('Elmwood North', 'Denver', '08001', dev.ev('funded', 2025, 'CHFA', 'p', **q), 70, counties=['08001'])
    assert dev.finish(L)[0]['county_fips'] == '08001'
    rows = {(p['name'], p['city']): p for p in load()['projects']}
    assert rows[('Elmwood North', 'Denver')]['county_fips'] == '08001'
    assert rows[('Dawson Square', 'Denver')]['county_fips'] == '08001'
    assert rows[('Sophia', 'Englewood')]['county_fips'] == '08035'
    assert rows[('Ridge', 'Denver')]['county_fips'] == '08031'  # the corrected application still stands


def test_one_project_printed_under_two_town_labels_or_spacings_is_one_row():
    # Aster Place ("Parachute" / "Battlement Mesa"), JetWing / Jet Wing Flats,
    # Shooks Run in "Colordo Springs", Wintergreen Ridge in "Summit County" /
    # "Keystone" were each two rows (#2261 review)
    seen, rows = {}, load()['projects']
    for p in rows:
        if not (p['county_fips'] and p['total_units']):
            continue
        key = (p['county_fips'], dev.core_name(p['name']).replace(' ', ''))
        for other in seen.get(key, []):
            assert abs(other['total_units'] - p['total_units']) > 0.15 * max(other['total_units'], p['total_units']), \
                (p['name'], p['city'], other['city'])
        seen.setdefault(key, []).append(p)
    assert len(seen) > 400  # the scan covered the ledger
    L = dev.Ledger(set(), {}, {'08045': 'Garfield County', '08041': 'El Paso County'})
    L.county_places = {}
    L.city_county = {'parachute': '08045', 'colorado springs': '08041'}
    L.city_counties = {'parachute': {'08045'}, 'colorado springs': {'08041'}}
    q = dict(source_url='https://example.org/a.pdf', quote='Name: X')
    # the earlier application printed 40 units, so the award cannot join it on arrival
    L.add('Aster Place', 'Parachute', '08045', dev.ev('not_funded', 2023, 'CHFA', 'p', **q), 40)
    L.add('Aster Place', 'Battlement Mesa', '08045', dev.ev('funded', 2024, 'CHFA', 'p', **q), 58)
    L.add('Aster Place', 'Parachute', '08045', dev.ev('funded', 2024, 'CHFA', 'q', **q), 58)
    L.add('JetWing Flats', 'Colorado Springs', '08041', dev.ev('applied', 2023, 'CHFA', 'p', **q), 68)
    L.add('Jet Wing Flats', 'Colorado Springs', '08041', dev.ev('funded', 2024, 'CHFA', 'p', **q), 68)
    # a same-named project of another size in another town of the county stays apart
    L.add('Aster Place', 'Rifle', '08045', dev.ev('funded', 2025, 'CHFA', 'p', **q), 120)
    got = sorted((r['city'], len(r['events'])) for r in dev.finish(L))
    assert got == [('Colorado Springs', 2), ('Parachute', 3), ('Rifle', 1)], got


def test_a_total_only_source_keeps_the_restricted_count_and_an_adopted_place_brings_its_town():
    # OEDIT prints only a total; CHFA's LI units must survive it, and a row
    # that takes Keystone's place ID must not keep "Summit County" as its city
    L = dev.Ledger(set(), {'keystone': '0840550'}, {'08117': 'Summit County'})
    L.county_places = {'08117': {'0840550'}}
    L.city_county = {'keystone': '08117'}
    L.city_counties = {'keystone': {'08117'}}
    q = dict(source_url='https://example.org/a.pdf', quote='Name: X')
    L.add('Wintergreen Ridge', 'Summit County', '08117', dev.ev('funded', 2023, 'OEDIT', 'p', **q), 47)
    L.add('Wintergreen Ridge', 'Keystone', '08117', dev.ev('funded', 2022, 'CHFA', 'p', **q), 47, 46)
    L.add('Wintergreen Ridge', 'Keystone', '08117', dev.ev('funded', 2024, 'OEDIT', 'q', **q), 47)
    r = dev.finish(L)
    assert len(r) == 1 and (r[0]['total_units'], r[0]['restricted_units']) == (47, 46)
    assert (r[0]['city'], r[0]['place_geoid']) == ('Keystone', '0840550')
    rows = {p['id']: p for p in load()['projects']}
    assert (rows['canyon-vista-08045']['restricted_units'], rows['wintergreen-ridge-08117']['restricted_units']) == (80, 46)
    assert rows['wintergreen-ridge-08117']['city'] == 'Keystone'
    placed = [p for p in rows.values() if p['place_geoid'] and p['city']]
    assert len(placed) > 300 and not [p['id'] for p in placed if 'county' in p['city'].lower()]
