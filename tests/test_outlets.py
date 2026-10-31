"""Outlet check for Housing News — scripts/news/outlets.py, outlet_review.py,
and how generate_policy_briefs.py uses them.

paul, 2026-10-31: show stories from unchecked outlets with an "Unverified
outlet" tag, review them every news run, and ask weekly. Known imposter
local-news sites (Metric Media's "Denver City Wire") are left out.
"""

import json
import sys
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'news'))

import generate_policy_briefs as gpb  # noqa: E402
import outlet_review  # noqa: E402
import outlets  # noqa: E402


@pytest.fixture(scope='module')
def geos():
    return gpb.load_geographies()


@pytest.fixture(scope='module')
def reg():
    return outlets.load_register()


def alert(title, source, domain='', date='2026-10-28'):
    a = {'title': f'{title} - {source}', 'source': source, 'date': f'{date}T12:00:00Z',
         'topic': 'affordable_housing', 'url': f'https://news.localhost/{abs(hash(title + source))}'}
    if domain:
        a['source_domain'] = domain
    return a


def test_register_entries_are_well_formed():
    data = json.loads(outlets.REGISTER_FILE.read_text(encoding='utf-8'))
    names = set()
    for o in data['outlets']:
        assert o['tier'] in outlets.CHECKED_TIERS | {'weak', 'blocked'}, o
        assert o.get('checked'), o
        if o['tier'] in ('weak', 'blocked'):
            assert o.get('label') and o.get('note'), o
        if o['tier'] == 'blocked':
            assert o.get('evidence', '').startswith('https:' + '//'), o
        key = outlets.norm_name(o['name'])
        assert key not in names, f'duplicate outlet {o["name"]}'
        names.add(key)


@pytest.mark.parametrize('name', ['Denver City Wire', 'Boulder Leader', 'SE Denver News', 'NE Colorado News'])
def test_imposter_sites_are_left_out(geos, name):
    # Before the check, any publisher named for a Colorado town was Colorado news.
    stories, counts = gpb.build_stories([alert('City council weighs new affordable housing fees', name)], geos)
    assert stories == []
    assert counts['blocked'] == 1


def test_an_unchecked_outlet_is_not_colorado_news_by_its_name_alone(geos):
    a = alert('City council weighs new affordable housing fees', 'Aurora Daily Wire')
    assert gpb.alert_scope(a, geos)[0] is None
    # A checked Colorado outlet still is.
    b = alert('City council weighs new affordable housing fees', 'Sentinel Colorado')
    assert gpb.alert_scope(b, geos)[0] == 'colorado'


def test_an_unchecked_outlet_naming_a_colorado_place_is_shown_with_a_tag(geos):
    stories, _ = gpb.build_stories([alert('Pueblo approves 120 affordable homes', 'Pueblo Daily Wire')], geos)
    assert len(stories) == 1
    assert stories[0]['sourcing'] == 'unverified'
    assert stories[0]['sourcing_label'] == 'Unverified outlet'


def test_weak_sourcing_carries_its_reason(geos):
    stories, _ = gpb.build_stories([alert('Colorado Launches Housing Hub to Speed Affordable Housing', 'Hoodline')], geos)
    assert stories[0]['sourcing'] == 'weak'
    assert stories[0]['sourcing_label'] == 'AI-written outlet'


def test_checked_outlets_carry_no_label(geos):
    stories, _ = gpb.build_stories([alert('Denver approves affordable housing plan', 'The Colorado Sun', 'coloradosun.com')], geos)
    assert stories[0]['sourcing'] == 'checked'
    assert 'sourcing_label' not in stories[0]
    assert stories[0]['source_domain'] == 'coloradosun.com'


def test_a_borrowed_name_with_another_address_is_unverified(reg):
    assert reg.lookup('The Colorado Sun', 'coloradosun.com')['status'] == 'checked'
    assert reg.lookup('The Colorado Sun', 'colorado-sun-news.com')['status'] == 'unverified'
    assert reg.lookup('Anything', 'news.coloradosun.com')['status'] == 'checked'


def test_names_are_matched_loosely_and_gov_sites_are_primary(reg):
    assert reg.lookup('Rocky Mountain Voice -')['status'] == reg.lookup('rocky mountain voice')['status']
    assert reg.lookup("Colorado Governor's Office (.gov)")['status'] == 'checked'
    assert reg.lookup('Someone', 'cdola.colorado.gov')['status'] == 'checked'
    assert reg.lookup('Someone', 'colorado-gov.news')['status'] == 'unverified'
    assert reg.lookup('Someone', 'hud.gov')['status'] == 'checked'


def test_a_review_decision_overrides_the_register():
    r = outlets.Register([{'name': 'Hoodline', 'tier': 'weak', 'label': 'AI-written outlet'}],
                         [{'name': 'Rocky Mountain Voice', 'decision': 'checked', 'decided': '2026-11-02'},
                          {'name': 'Hoodline', 'decision': 'blocked', 'decided': '2026-11-02'}])
    assert r.lookup('Rocky Mountain Voice -')['status'] == 'checked'
    assert r.lookup('Hoodline')['status'] == 'blocked'


# ── The review list and issue ────────────────────────────────────────────────

def story(source, d, sourcing='unverified', title='Headline', scope='colorado'):
    return {'title': title, 'source': source, 'date': d, 'scope': scope, 'sourcing': sourcing, 'link': 'https://news.localhost/x'}


def test_review_lists_only_unverified_outlets_and_keeps_first_listed():
    today = date(2026, 11, 2)
    stories = [story('Rocky Mountain Voice -', '2026-09-30'), story('Rocky Mountain Voice', '2026-10-30'),
               story('The Colorado Sun', '2026-11-01', 'checked'), story('Hoodline', '2026-11-01', 'weak')]
    prev = {'outlets': [{'id': outlet_review.outlet_id('Rocky Mountain Voice'), 'first_listed': '2026-10-31'}]}
    r = outlet_review.build_review(stories, prev, today)
    assert [o['name'] for o in r['outlets']] == ['Rocky Mountain Voice']
    o = r['outlets'][0]
    assert (o['stories'], o['first_seen'], o['last_seen'], o['first_listed']) == (2, '2026-09-30', '2026-10-30', '2026-10-31')
    assert r['meta']['week'] == {'since': '2026-10-27', 'checked': 1, 'unverified': 1, 'weak': 1}


def test_ticks_most_severe_wins_and_are_recorded():
    review = outlet_review.build_review([story('Rocky Mountain Voice', '2026-10-30'), story('Wire X', '2026-10-30')],
                                        None, date(2026, 11, 2))
    rmv, wx = (outlet_review.outlet_id(n) for n in ('Rocky Mountain Voice', 'Wire X'))
    body = outlet_review.issue_body(review)
    assert body.count('<!-- outlet:') == 6
    body = body.replace(f'- [ ] Checked outlet <!-- outlet:{rmv}:checked -->', f'- [x] Checked outlet <!-- outlet:{rmv}:checked -->')
    body = body.replace(f'- [ ] Weak sourcing <!-- outlet:{wx}:weak -->', f'- [x] Weak sourcing <!-- outlet:{wx}:weak -->')
    body = body.replace(f'- [ ] Block <!-- outlet:{wx}:blocked -->', f'- [X] Block <!-- outlet:{wx}:blocked -->')
    ticks = outlet_review.ticked(body)
    assert ticks == {rmv: 'checked', wx: 'blocked'}
    decisions, changed = outlet_review.apply_ticks([], ticks, review, 7, date(2026, 11, 2))
    assert changed == 2
    assert {d['name']: d['decision'] for d in decisions} == {'Rocky Mountain Voice': 'checked', 'Wire X': 'blocked'}
    # A rewrite keeps a box ticked during the run.
    assert f'- [x] Checked outlet <!-- outlet:{rmv}:checked -->' in outlet_review.issue_body(review, ticks)


def test_weekly_comment_once_a_week():
    from datetime import datetime, timezone
    now = datetime(2026, 11, 9, 9, 0, tzinfo=timezone.utc)
    bot = {'login': 'github-actions[bot]'}
    recent = [{'body': outlet_review.WEEKLY_MARKER + ' x', 'user': bot, 'created_at': '2026-11-05T09:00:00Z'}]
    old = [{'body': outlet_review.WEEKLY_MARKER + ' x', 'user': bot, 'created_at': '2026-11-02T08:00:00Z'}]
    spoof = [{'body': outlet_review.WEEKLY_MARKER, 'user': {'login': 'someone'}, 'created_at': '2026-11-08T09:00:00Z'}]
    assert not outlet_review.needs_weekly(recent, now)
    assert outlet_review.needs_weekly(old, now)
    assert outlet_review.needs_weekly(spoof, now)
    assert outlet_review.needs_weekly([], now)


# ── Codex review of #2607 ────────────────────────────────────────────────────

def test_an_unchecked_name_containing_colorado_is_not_colorado_context(geos):
    assert gpb.alert_scope(alert('Council approves affordable housing', 'Colorado Mystery Outlet'), geos)[0] is None


@pytest.mark.parametrize('domain', ['denvercitywire.com', 'boulderleader.com', 'sedenvernews.com', 'necoloradonews.com'])
def test_imposter_sites_are_blocked_by_address_too(reg, domain):
    assert reg.lookup('Some Other Name', domain)['status'] == 'blocked'
    assert reg.lookup('Denver City Wire', 'elsewhere.localhost')['status'] == 'blocked'


def test_a_name_only_entry_is_not_trusted_from_an_unknown_address():
    r = outlets.Register([{'name': 'Name Only Weekly', 'tier': 'newsroom'}])
    assert r.lookup('Name Only Weekly')['status'] == 'checked'
    assert r.lookup('Name Only Weekly', 'fake.localhost')['status'] == 'unverified'


def test_every_checked_register_entry_has_an_address():
    data = json.loads(outlets.REGISTER_FILE.read_text(encoding='utf-8'))
    assert [o['name'] for o in data['outlets'] if not o.get('domains')] == []


def test_a_gov_suffix_does_not_override_a_non_gov_address(reg):
    assert reg.lookup('Fake Department (.gov)', 'fake.localhost')['status'] == 'unverified'
    assert reg.lookup('Real Department (.gov)', 'dola.colorado.gov')['status'] == 'checked'
    assert reg.lookup('Real Department (.gov)')['status'] == 'checked'
