"""Next round watch (scripts/funding/build_round_watch.py).

Pins:
  1. a deal CHFA turned down a year earlier in the same round type is High,
     and its reason quotes the application and the backtest rate;
  2. an awarded or still-undecided application leaves the list;
  3. no look-ahead: state money announced after the cutoff does not count;
  4. size decides which round recent state money points to;
  5. the owner's excluded project is dropped;
  6. a deal summary links only for the same town and development;
  7. the committed file is current, deterministic, and holds no contact
     details (those live only on the private developer site);
  8. a backtest sizes a project as printed before the cutoff, not by a
     later record;
  9. every reason, the sponsor's included, carries its source rows;
 10. each deal carries its site region and its town's map location;
 11. each deal's history (when it joined, its last band change) carries
     from the file it replaces, and the first build marks nothing new.
"""
import copy
import importlib.util
import json
import os
import re
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location('build_round_watch', os.path.join(ROOT, 'scripts', 'funding', 'build_round_watch.py'))
rw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rw)

URL = 'https://example.com/report.pdf'  # example.com: the source-URL sweep skips it


def app(name, city, year, rnd, outcome, units=40, sponsor='Sponsor A', fed=1000000):
    credit = rw.ROUND_CREDIT[rnd]
    return {'year': year, 'round': rnd, 'round_label': rw.label((year, rnd)), 'rolling': False, 'credit_type': credit,
            'name': name, 'city': city, 'county_fips': '08013', 'county_fips_all': ['08013'], 'place_geoids': ['0845970'],
            'total_units': units, 'sponsor': sponsor, 'federal_credit_requested': fed, 'outcome': outcome,
            'source_url': URL, 'source_as_of': '%d-%s' % (year, '02-09' if rnd == 1 else '08-11'),
            'quote': 'Name: %s; City: %s' % (name, city)}


def project(pid, name, city, units, events):
    return {'id': pid, 'name': name, 'city': city, 'county_fips': '08013', 'county_fips_all': None,
            'county': 'Boulder County', 'place_geoid': '0845970', 'total_units': units, 'events': events}


def dola(name, announced, amount=1000000):
    return {'agency': 'DOLA', 'program': 'Division of Housing award', 'stage': 'funded', 'year': int(announced[:4]),
            'announced': announced, 'amount': amount, 'amount_label': 'awarded', 'source_url': 'https://example.com/doh',
            'quote': 'Project: %s; Program: Rental' % name}


def base():
    """Two years of rounds so 2026 rounds backtest and 2027 rounds are next."""
    apps = []
    for y in (2023, 2024, 2025, 2026):
        apps.append(app('Filler Nine %d' % y, 'Denver', y, 1, 'awarded', sponsor='F'))
        apps.append(app('Filler Four %d' % y, 'Denver', y, 2, 'awarded', units=120, sponsor='F'))
    return ({'meta': {'generated_at': '2026-10-18T00:00:00Z'}, 'applications': apps},
            {'meta': {'generated_at': '2026-10-18T00:00:00Z'}, 'projects': []},
            {'excluded': []})


def build(apps_doc, ledger_doc, excluded_doc):
    return rw.build(apps_doc, ledger_doc, excluded_doc)


def items(out, rnd):
    return {i['name']: i for i in out['rounds'][rnd - 1]['items']}


def test_loser_last_year_is_high_with_reason():
    a, l, e = base()
    a['applications'].append(app('Hover Place', 'Longmont', 2026, 1, 'not_awarded'))
    out = build(a, l, e)
    i = items(out, 1)['Hover Place']
    assert out['rounds'][0]['round'] == '2027 Round One' and out['rounds'][0]['credit'] == '9%'
    assert i['band'] == 'High' and i['score'] == 50
    assert i['why'][0]['text'].startswith('CHFA did not fund it in 2026 Round One (it asked for $1,000,000 a year')
    assert i['why'][0]['source_url'] == URL and 'Hover Place' in i['why'][0]['quote']
    # a 9% loss is "the other round type" for Round Two: Watch at most
    assert items(out, 2)['Hover Place']['band'] == 'Watch'


def test_region_and_town_location_for_the_map():
    a, l, e = base()
    a['applications'].append(app('Hover Place', 'Longmont', 2026, 1, 'not_awarded'))
    multi = app('Hub', 'Aurora', 2026, 1, 'not_awarded')
    multi.update(county_fips=None, county_fips_all=[], place_geoids=['0804000'])
    a['applications'].append(multi)
    out = rw.build(a, l, e, places={'0845970': {'name': 'Longmont city', 'lat': 40.17, 'lng': -105.1}},
                   place_counties={'0804000': {'primary_county': '08005'}})
    hover, hub = items(out, 1)['Hover Place'], items(out, 1)['Hub']
    assert (hover['region'], hover['lat'], hover['lng']) == ('Front Range', 40.17, -105.1)
    # a town that spans counties takes its main county's region; no centroid, no pin
    assert hub['region'] == 'Front Range' and hub['lat'] is None


def test_history_marks_new_and_moved_deals_only_after_tracking_starts():
    a, l, e = base()
    a['applications'].append(app('Hover Place', 'Longmont', 2026, 1, 'not_awarded'))
    first = rw.carry_history(build(a, l, e), {'meta': {}, 'rounds': [{'items': []}, {'items': []}]})
    assert all(i['first_listed'] is None for r in first['rounds'] for i in r['items'])   # seed: nothing new
    assert rw.carry_history(build(a, l, e), copy.deepcopy(first)) == first                 # same data: no change
    later = build(a, l, e)
    later['meta']['generated_at'] = '2026-11-01'
    later['rounds'][0]['items'].append(dict(items(later, 1)['Hover Place'], id='new-deal', name='New Deal'))
    items(later, 1)['Hover Place']['band'] = 'Medium'
    rw.carry_history(later, first)
    assert items(later, 1)['New Deal']['first_listed'] == '2026-11-01'
    moved = items(later, 1)['Hover Place']
    assert moved['first_listed'] is None and (moved['band_before'], moved['band_since']) == ('High', '2026-11-01')
    assert later['meta']['tracking_since'] == first['meta']['tracking_since']


def test_backtest_counts_who_was_awarded():
    a, l, e = base()
    a['applications'] += [app('Came Back', 'Longmont', 2025, 1, 'not_awarded'), app('Came Back', 'Longmont', 2026, 1, 'awarded'),
                          app('Tried Again', 'Lyons', 2025, 1, 'not_awarded'), app('Tried Again', 'Lyons', 2026, 1, 'not_awarded')]
    a['applications'][-3]['award'] = {'source_url': 'https://example.com/award-2026.pdf'}
    r = next(r for r in build(a, l, e)['backtest']['rounds'] if r['round'] == '2026 Round One')
    assert r['bands']['High'] == {'listed': 2, 'applied': 2, 'awarded': 1}
    assert {(p['name'], p['outcome']) for p in r['picks']} == {('Came Back', 'awarded'), ('Tried Again', 'not_awarded')}
    assert r['undecided'] == 0 and r['awarded'] == 2   # Came Back and the filler
    # both decisions link to the round's award report, not the applicant report
    assert {p['decision_url'] for p in r['picks']} == {'https://example.com/award-2026.pdf'}


def test_awarded_and_undecided_leave_the_list():
    a, l, e = base()
    a['applications'] += [app('Won Later', 'Longmont', 2025, 1, 'not_awarded'), app('Won Later', 'Longmont', 2026, 1, 'awarded'),
                          app('Waiting', 'Longmont', 2026, 2, 'pending', units=120)]
    out = build(a, l, e)
    assert 'Won Later' not in items(out, 1) and 'Waiting' not in items(out, 2)
    assert out['rounds'][1]['undecided_last_round'] == 1 and '2026 Round Two' in out['rounds'][1]['note']


def test_no_look_ahead_in_backtest():
    a, l, e = base()
    a['applications'].append(app('Soft Deal', 'Longmont', 2026, 1, 'not_awarded'))
    # money announced after the 2026 Round One report must not explain that round
    l['projects'].append(project('soft-deal', 'Soft Deal', 'Longmont', 40, [dola('Soft Deal', '2026-03')]))
    out = build(a, l, e)
    r = next(r for r in out['backtest']['rounds'] if r['round'] == '2026 Round One')
    assert r['applicants'] == 2 and r['caught'] == 0
    before = copy.deepcopy(l)
    before['projects'][0]['events'] = [dola('Soft Deal', '2025-11')]
    r = next(r for r in build(a, before, e)['backtest']['rounds'] if r['round'] == '2026 Round One')
    assert r['caught'] == 1


def test_size_picks_the_round_for_state_money():
    a, l, e = base()
    l['projects'] += [project('small', 'Small Deal', 'Longmont', 40, [dola('Small Deal', '2026-06')]),
                      project('big', 'Big Deal', 'Longmont', 150, [dola('Big Deal', '2026-06')])]
    out = build(a, l, e)
    assert items(out, 1)['Small Deal']['score'] == 25 and items(out, 1)['Big Deal']['score'] == 10
    assert items(out, 2)['Big Deal']['score'] == 25 and items(out, 2)['Small Deal']['score'] == 10
    assert 'suits the other round' in items(out, 1)['Big Deal']['why'][0]['text']


def test_excluded_project_is_dropped():
    a, l, e = base()
    a['applications'].append(app('Owner Deal', 'Longmont', 2026, 1, 'not_awarded'))
    l['projects'].append(project('owner', 'Owner Deal', 'Longmont', 40, [dola('Owner Deal', '2026-06')]))
    e = {'excluded': [{'sha256': rw.apps_mod.exclusion_hash('Owner Deal', 'Longmont')}]}
    out = build(a, l, e)
    assert all('Owner Deal' not in json.dumps(r) for r in out['rounds'])


def test_committed_file_is_current_and_has_no_contacts():
    res = subprocess.run([sys.executable, 'scripts/funding/build_round_watch.py', '--check'], cwd=ROOT,
                         capture_output=True, text=True)
    assert res.returncode == 0, res.stdout + res.stderr
    with open(os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_round-watch.json'), encoding='utf-8') as f:
        text = f.read()
    assert not re.search(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}', text), 'no email addresses'
    assert not re.search(r'\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b', text), 'no phone numbers'
    assert not os.path.exists(os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_round-watch-contacts.json')), \
        'contacts live only on the private developer site'
    data = json.loads(text)
    assert data['rounds'][0]['credit'] == '9%' and data['rounds'][1]['credit'] == '4%'
    for r in data['rounds']:
        for i in r['items']:
            assert i['band'] in ('High', 'Medium', 'Watch') and i['why']
            for w in i['why']:
                urls = [s['url'] for s in w.get('sources', [])] or ([w['source_url']] if w.get('source_url') else [])
                assert all(urlsplit(u).scheme == 'https' and urlsplit(u).netloc for u in urls)


def test_deal_summary_link_needs_same_town_and_name():
    deals = [{'slug': 'hover-place-longmont', 'name': 'Hover Place', 'city': 'Longmont', 'match': {'names': ['Hover Place']}},
             {'slug': 'lumberyard-b', 'name': 'Lumberyard Apartments (Phase B)', 'city': 'Aspen', 'match': {'names': ['Lumberyard Apartments']}}]
    assert rw.deal_summary({'name': 'Hover Place', 'city': 'Longmont'}, deals) == 'hover-place-longmont'
    assert rw.deal_summary({'name': 'Hover Place', 'city': 'Denver'}, deals) is None
    assert rw.deal_summary({'name': 'Lumberyard Apartments - Phase A (Building 1)', 'city': 'Aspen'}, deals) is None


def test_backtest_size_is_the_size_printed_before_the_cutoff():
    a, l, e = base()
    a['applications'].append(app('Grow Deal', 'Longmont', 2026, 1, 'awarded'))
    # 40 homes when DOLA funded it; a later record says 150, the ledger keeps that
    ev = dola('Grow Deal', '2025-06')
    ev['quote'] += '; Homes: 40'
    l['projects'].append(project('grow', 'Grow Deal', 'Longmont', 150, [ev]))
    r = next(r for r in build(a, l, e)['backtest']['rounds'] if r['round'] == '2026 Round One')
    assert r['caught'] == 1 and r['bands']['Medium']['applied'] == 1  # fits 9%: 25 points


def test_every_reason_has_a_source_including_sponsor():
    a, l, e = base()
    a['applications'] += [app('Old One', 'Longmont', 2025, 1, 'not_awarded', sponsor='Repeat Co'),
                          app('Old Two', 'Longmont', 2025, 2, 'not_awarded', units=120, sponsor='Repeat Co'),
                          app('Hover Place', 'Longmont', 2026, 1, 'not_awarded', sponsor='Repeat Co')]
    out = build(a, l, e)
    w = next(w for w in items(out, 1)['Hover Place']['why'] if w['kind'] == 'sponsor')
    assert [s['url'] for s in w['sources']] == [URL] * 3
    for r in out['rounds']:
        for i in r['items']:
            assert all(w.get('source_url') or w.get('sources') for w in i['why'])


def test_backtest_size_takes_a_newer_application_over_an_older_award():
    a, l, e = base()
    # DOLA printed 90 homes in 2025; the 2026 Round One application (public
    # before Round Two) printed 57, so Round Two sees a 57-home deal
    a['applications'].append(app('Colfax Deal', 'Longmont', 2026, 1, 'not_awarded', units=57))
    a['applications'].append(app('Colfax Deal', 'Longmont', 2026, 2, 'pending', units=57))
    ev = dola('Colfax Deal', '2025-06')
    ev['quote'] += '; Homes: 90'
    l['projects'].append(project('colfax', 'Colfax Deal', 'Longmont', 57, [ev]))
    D = rw.Data(a, l, e)
    cutoff = next(r for r in rw.build(a, l, e)['backtest']['rounds'] if r['round'] == '2026 Round Two')['as_of']
    v = next(v for v in rw.score_round(D, (2026, 2), cutoff, keep_all=True).values() if v['project'] and v['project']['id'] == 'colfax')
    assert v['units'] == 57
    assert any(s['kind'] == 'soft_misfit' for s in v['signals'])


def test_size_compares_whole_dates():
    ev = dola('X', '2026-06-10')
    ev['quote'] += '; Homes: 100'
    later_app = {'source_as_of': '2026-06-20', 'year': 2026, 'total_units': 50}
    assert rw.size_as_of(None, [later_app], [ev], live=False) == 50
    later_app['source_as_of'] = '2026-06-01'
    assert rw.size_as_of(None, [later_app], [ev], live=False) == 100


def test_same_type_loss_beats_a_later_other_type_loss():
    a, l, e = base()
    a['applications'] += [app('Both Rounds', 'Longmont', 2026, 1, 'not_awarded'),
                          app('Both Rounds', 'Longmont', 2026, 2, 'not_awarded')]
    i = items(build(a, l, e), 1)['Both Rounds']
    assert i['band'] == 'High' and i['why'][0]['kind'] == 'lost_last_same'
    assert '2026 Round One' in i['why'][0]['text']


def test_year_only_record_dates_to_the_last_day():
    ev = {'agency': 'DOLA', 'year': 2025, 'quote': 'Project: X; Homes: 100'}
    december_app = {'source_as_of': '2025-12-20', 'year': 2025, 'total_units': 50}
    assert rw.size_as_of(None, [december_app], [ev], live=False) == 100


def test_strongest_reason_comes_first():
    a, l, e = base()
    a['applications'].append(app('Miner Deal', 'Longmont', 2026, 2, 'not_awarded'))  # other-type loss: 10
    l['projects'].append(project('miner', 'Miner Deal', 'Longmont', 40, [dola('Miner Deal', '2026-06')]))  # fits 9%: 25
    i = items(build(a, l, e), 1)['Miner Deal']
    assert [w['kind'] for w in i['why']][:2] == ['soft_fit', 'lost_other']


def test_dola_award_counts_from_its_day_when_the_day_is_printed():
    assert rw.public_before({'agency': 'DOLA', 'year': 2025, 'announced': '2025-02-11'}, '2025-02-12')
    assert not rw.public_before({'agency': 'DOLA', 'year': 2025, 'announced': '2025-02-12'}, '2025-02-12')
    assert not rw.public_before({'agency': 'DOLA', 'year': 2025, 'announced': '2025-02'}, '2025-02-12')  # month only: not yet


def test_backtest_splits_weak_signs_from_no_record():
    a, l, e = base()
    # a 5-point land-banking deal that then applied in 2026 Round One: below the list, not "no record"
    land = {'agency': 'OEDIT / CHFA (Prop 123 AHFF)', 'program': rw.LAND, 'stage': 'funded', 'year': 2024,
            'amount': 500000, 'source_url': 'https://example.com/land', 'quote': 'Project Name: Lot Deal; Location: Longmont'}
    l['projects'].append(project('lot', 'Lot Deal', 'Longmont', 40, [land]))
    a['applications'].append(app('Lot Deal', 'Longmont', 2026, 1, 'pending'))
    r = next(r for r in build(a, l, e)['backtest']['rounds'] if r['round'] == '2026 Round One')
    assert r['below_list'] == 1 and r['no_sign_before'] == r['applicants'] - r['caught'] - 1


def test_unknown_size_is_its_own_signal():
    a, l, e = base()
    p = project('nosize', 'No Size Deal', 'Longmont', None, [dola('No Size Deal', '2026-06')])
    l['projects'].append(p)
    i = items(build(a, l, e), 1)['No Size Deal']
    assert i['why'][0]['kind'] == 'soft_size_unknown' and 'could suit either round' in i['why'][0]['text']


def test_rolling_application_takes_a_deal_off_the_list_from_its_date():
    a, l, e = base()
    rolling = dict(app('Ingraham Test', 'Longmont', 2026, 2, 'letter_of_intent', units=120),
                   rolling=True, round=None, source_as_of='2026-10-12')
    a['applications'] += [app('Ingraham Test', 'Longmont', 2026, 1, 'not_awarded'), rolling]
    out = build(a, l, e)
    assert 'Ingraham Test' not in items(out, 1) and 'Ingraham Test' not in items(out, 2)
    # no look-ahead: a rolling list printed in October does not reach back to an earlier backtest cutoff
    D = rw.Data(a, l, set(), (), ())
    ent = D.rolling[0]['_entity']
    assert ent in rw.score_round(D, (2026, 2), '2026-08-11')
    assert ent not in rw.score_round(D, (2027, 1), '2026-10-12')


def test_ledger_application_event_keeps_its_report_date():
    chfa = {'agency': 'CHFA', 'program': 'Housing tax credit 9% application', 'stage': 'not_funded', 'year': 2025,
            'announced': None, 'as_of': '2025-02-12', 'source_url': URL, 'quote': 'Name: Manitou Test; Total Units: 43'}
    d = dola('Manitou Test', '2025-11')
    d['quote'] += '; Total Units: 50'
    p = project('p-manitou', 'Manitou Test', 'Longmont', 50, [chfa, d])
    assert rw.size_as_of(p, [], [chfa, d], False) == 50


def test_check_lets_only_deal_summary_links_lag():
    a, l, e = base()
    a['applications'].append(app('Linked Place', 'Longmont', 2026, 1, 'not_awarded'))
    out = build(a, l, e)
    newer = json.loads(json.dumps(out))
    newer['rounds'][0]['items'][0]['deal_summary'] = 'linked-place-longmont'
    assert rw.only_new_deal_links(out, newer)
    # a link removed or changed is stale: the page would point at a summary that is gone
    assert not rw.only_new_deal_links(newer, out)
    changed = json.loads(json.dumps(newer))
    changed['rounds'][0]['items'][0]['deal_summary'] = 'renamed-place-longmont'
    assert not rw.only_new_deal_links(newer, changed)
    newer['rounds'][0]['items'][0]['score'] += 1
    assert not rw.only_new_deal_links(out, newer)
