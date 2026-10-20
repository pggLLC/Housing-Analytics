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
  9. every reason, the sponsor's included, carries its source rows.
"""
import copy
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location('build_round_watch', os.path.join(ROOT, 'scripts', 'funding', 'build_round_watch.py'))
rw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rw)

URL = 'https://www.chfainfo.com/report.pdf'


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
            'announced': announced, 'amount': amount, 'amount_label': 'awarded', 'source_url': 'https://doh.colorado.gov/x',
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
    text = open(os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_round-watch.json'), encoding='utf-8').read()
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
                assert all(u.startswith('https://') for u in urls)


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
