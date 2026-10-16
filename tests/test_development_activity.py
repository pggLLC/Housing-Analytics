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
    total = sum(c['projects'] for c in d['county_summary'].values())
    recent = [p for p in d['projects'] if p['county_fips'] and (p['latest_year'] or 0) >= d['meta']['summary_since']]
    assert total == len(recent) > 0


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
